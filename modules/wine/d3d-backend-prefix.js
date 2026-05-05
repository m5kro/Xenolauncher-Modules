const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BACKUP_SUFFIX = ".xenolauncher-orig";
const DXMT_BACKUP_DIR = ".xenolauncher-dxmt-backup";
const MOLTENVK_BACKUP_DIR = ".xenolauncher-moltenvk-backup";
const BACKEND_DLLS = ["dxgi", "d3d10", "d3d10_1", "d3d10core", "d3d11", "winemetal", "nvapi64", "nvngx"];
const DXVK_DLLS = ["dxgi", "d3d10", "d3d10_1", "d3d10core", "d3d11"];
const DXMT_WINDOWS_DLLS = ["dxgi", "d3d10core", "d3d11", "winemetal"];
const MOLTENVK_LIB_NAMES = ["libMoltenVK.dylib", "libvulkan.1.dylib", "libvulkan.dylib"];

function isEnabled(value) {
    return value === true || value === "true";
}

function normalizeBackend(args) {
    const requested = typeof args.d3dBackend === "string" ? args.d3dBackend.trim().toLowerCase() : "";
    if (requested === "dxvk" || requested === "dxmt") return requested;
    if (!requested && isEnabled(args.enableDxvk)) return "dxvk";
    return "none";
}

function getInstalledVersions(moduleRoot, dependencyName) {
    const versionsRoot = path.join(moduleRoot, "deps", dependencyName);
    try {
        if (!fs.existsSync(versionsRoot)) return [];
        return fs
            .readdirSync(versionsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
    } catch (error) {
        console.warn(`Failed to read installed ${dependencyName} versions:`, error);
        return [];
    }
}

function resolveBackendVersion(moduleRoot, args, backend) {
    const dependencyName = backend === "dxmt" ? "dxmtVersion" : "dxvkVersion";
    const argName = backend === "dxmt" ? "dxmtVersion" : "dxvkVersion";
    const installed = getInstalledVersions(moduleRoot, dependencyName);
    const requested = typeof args[argName] === "string" ? args[argName].trim() : "";
    if (requested && installed.includes(requested)) return requested;
    return installed[0] || requested;
}

function resolveMoltenVkVersion(moduleRoot, args) {
    const installed = getInstalledVersions(moduleRoot, "moltenvkVersion");
    const requested = typeof args.moltenvkVersion === "string" ? args.moltenvkVersion.trim() : "";
    if (requested && installed.includes(requested)) return requested;
    return installed[0] || requested;
}

function findDxvkPayload(root) {
    return findPayload(root, (current) => {
        const x64 = path.join(current, "x64");
        const x32 = path.join(current, "x32");
        return fs.existsSync(x64) || fs.existsSync(x32);
    });
}

function findDxmtPayload(root) {
    return findPayload(root, (current) => {
        const x64Windows = path.join(current, "x86_64-windows");
        const i386Windows = path.join(current, "i386-windows");
        const x64Unix = path.join(current, "x86_64-unix");
        return fs.existsSync(x64Windows) || fs.existsSync(i386Windows) || fs.existsSync(x64Unix);
    });
}

function findMoltenVkPayload(root) {
    return findPayload(root, (current) => {
        return fs.existsSync(path.join(current, "libMoltenVK.dylib"));
    });
}

function findPayload(root, matches) {
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        if (matches(current)) return current;

        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) stack.push(path.join(current, entry.name));
        }
    }
    return null;
}

function restoreDll(systemDir, dllName, removeIfUnbacked = false) {
    const target = path.join(systemDir, `${dllName}.dll`);
    const backup = `${target}${BACKUP_SUFFIX}`;

    if (fs.existsSync(backup)) {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        fs.renameSync(backup, target);
    } else if (removeIfUnbacked && fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
    }
}

function copyDll(sourceDir, systemDir, dllName) {
    const source = path.join(sourceDir, `${dllName}.dll`);
    if (!fs.existsSync(source)) return false;

    fs.mkdirSync(systemDir, { recursive: true });
    const target = path.join(systemDir, `${dllName}.dll`);
    const backup = `${target}${BACKUP_SUFFIX}`;

    if (fs.existsSync(target) && !fs.existsSync(backup)) {
        fs.renameSync(target, backup);
    } else if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
    }

    fs.copyFileSync(source, target);
    return true;
}

function restoreManagedPrefixDll(windowsPath, managedDll) {
    const parts = String(managedDll || "").split("/");
    if (parts.length !== 2) return false;

    const [arch, fileName] = parts;
    const dllName = path.basename(fileName, ".dll");
    if (!dllName) return false;

    if (arch === "x64") {
        restoreDll(path.join(windowsPath, "system32"), dllName, true);
        return true;
    }
    if (arch === "x32") {
        restoreDll(path.join(windowsPath, "syswow64"), dllName, true);
        return true;
    }

    return false;
}

function removeD3dBackendFromPrefix(prefixPath, previous) {
    const windowsPath = path.join(prefixPath, "drive_c", "windows");
    const managedPrefixDlls = previous && Array.isArray(previous.managedPrefixDlls) ? previous.managedPrefixDlls : [];

    for (const managedDll of managedPrefixDlls) restoreManagedPrefixDll(windowsPath, managedDll);

    for (const systemDir of [path.join(windowsPath, "system32"), path.join(windowsPath, "syswow64")]) {
        for (const dllName of BACKEND_DLLS) restoreDll(systemDir, dllName);
    }
}

function getPreviousBackend(existingMetadata) {
    if (!existingMetadata) return null;
    if (existingMetadata.d3dBackend) return existingMetadata.d3dBackend;
    if (existingMetadata.dxvk && existingMetadata.dxvk.enabled) {
        return {
            enabled: true,
            backend: "dxvk",
            version: existingMetadata.dxvk.version,
            managedDlls: existingMetadata.dxvk.managedDlls || [],
        };
    }
    return null;
}

function shouldRestorePrevious(previous, backend, version) {
    if (!previous || !previous.enabled) return false;
    if (previous.backend !== backend) return true;
    return Boolean(previous.version && version && previous.version !== version);
}

function applyD3dBackendToPrefix(prefixPath, moduleRoot, args, existingMetadata, wineApp) {
    const backend = normalizeBackend(args || {});
    const previous = getPreviousBackend(existingMetadata);

    if (backend === "none") {
        if (previous && previous.enabled) removeD3dBackendFromPrefix(prefixPath, previous);
        return { enabled: false, backend: "none" };
    }

    const version = resolveBackendVersion(moduleRoot, args || {}, backend);
    if (!version) {
        throw new Error(`${backend.toUpperCase()} is selected, but no ${backend.toUpperCase()} version is installed.`);
    }

    if (shouldRestorePrevious(previous, backend, version)) {
        removeD3dBackendFromPrefix(prefixPath, previous);
    }

    if (backend === "dxvk") return applyDxvkToPrefix(prefixPath, moduleRoot, version, args || {}, wineApp);
    return applyDxmt(prefixPath, moduleRoot, version, wineApp);
}

function applyDxvkToPrefix(prefixPath, moduleRoot, version, args, wineApp) {
    const versionRoot = path.join(moduleRoot, "deps", "dxvkVersion", version);
    if (!fs.existsSync(versionRoot)) {
        throw new Error(`DXVK ${version} is not installed.`);
    }

    const payloadRoot = findDxvkPayload(versionRoot);
    if (!payloadRoot) {
        throw new Error(`DXVK ${version} is installed but does not contain x64/x32 DLL folders.`);
    }

    const windowsPath = path.join(prefixPath, "drive_c", "windows");
    const installed = [];

    for (const { arch, systemDir } of [
        { arch: "x64", systemDir: path.join(windowsPath, "system32") },
        { arch: "x32", systemDir: path.join(windowsPath, "syswow64") },
    ]) {
        const sourceDir = path.join(payloadRoot, arch);
        if (!fs.existsSync(sourceDir)) continue;

        for (const dllName of DXVK_DLLS) {
            if (copyDll(sourceDir, systemDir, dllName)) installed.push(`${arch}/${dllName}.dll`);
        }
    }

    if (installed.length === 0) {
        throw new Error(`DXVK ${version} does not contain D3D10/11 DLLs supported by this module.`);
    }

    const moltenvk = applyMoltenVkForDxvk(moduleRoot, args || {}, wineApp);

    return {
        enabled: true,
        backend: "dxvk",
        version,
        mode: "prefix-dlls",
        managedDlls: installed,
        moltenvk,
        updatedAt: new Date().toISOString(),
    };
}

function isWineCxBundle(wineApp) {
    return typeof wineApp === "string" && path.basename(wineApp).toLowerCase().startsWith("wine crossover");
}

function backupMoltenVkBundleFile(wineResourcesRoot, relativePath) {
    const target = path.join(wineResourcesRoot, relativePath);
    if (!fs.existsSync(target)) return;

    const backup = path.join(wineResourcesRoot, MOLTENVK_BACKUP_DIR, relativePath);
    if (fs.existsSync(backup)) return;

    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
}

function copyMoltenVkBundleFile(source, wineResourcesRoot, relativePath, patchedFiles) {
    backupMoltenVkBundleFile(wineResourcesRoot, relativePath);

    const target = path.join(wineResourcesRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    codesignIfPossible(target);
    patchedFiles.push(relativePath);
}

function writeMoltenVkIcd(wineResourcesRoot, icdRelativePath, libPath) {
    const icdPath = path.join(wineResourcesRoot, icdRelativePath);
    backupMoltenVkBundleFile(wineResourcesRoot, icdRelativePath);
    fs.mkdirSync(path.dirname(icdPath), { recursive: true });
    fs.writeFileSync(
        icdPath,
        `${JSON.stringify(
            {
                file_format_version: "1.0.0",
                ICD: {
                    library_path: libPath,
                    api_version: "1.4.0",
                    is_portability_driver: true,
                },
            },
            null,
            4
        )}\n`,
        "utf8"
    );
}

function applyMoltenVkForDxvk(moduleRoot, args, wineApp) {
    if (!isWineCxBundle(wineApp)) return { enabled: false, reason: "not-winecx" };

    const version = resolveMoltenVkVersion(moduleRoot, args || {});
    if (!version) {
        throw new Error("DXVK on WineCX requires MoltenVK, but no MoltenVK version is installed.");
    }

    const versionRoot = path.join(moduleRoot, "deps", "moltenvkVersion", version);
    if (!fs.existsSync(versionRoot)) {
        throw new Error(`MoltenVK ${version} is not installed.`);
    }

    const payloadRoot = findMoltenVkPayload(versionRoot);
    if (!payloadRoot) {
        throw new Error(`MoltenVK ${version} is installed but does not contain libMoltenVK.dylib.`);
    }

    const sourceLib = path.join(payloadRoot, "libMoltenVK.dylib");
    const wineResourcesRoot = path.join(wineApp, "Contents", "Resources");
    const wineLibDir = path.join(wineResourcesRoot, "wine", "lib");
    const patchedFiles = [];

    for (const libName of MOLTENVK_LIB_NAMES) {
        copyMoltenVkBundleFile(sourceLib, wineResourcesRoot, path.join("wine", "lib", libName), patchedFiles);
    }

    const icdRelativePath = path.join("vulkan", "icd.d", "MoltenVK_icd.json");
    const libPath = path.join(wineLibDir, "libMoltenVK.dylib");
    writeMoltenVkIcd(wineResourcesRoot, icdRelativePath, libPath);
    patchedFiles.push(icdRelativePath);

    return {
        enabled: true,
        version,
        mode: "winecx-bundle",
        wineApp,
        payloadRoot,
        libDir: wineLibDir,
        icdPath: path.join(wineResourcesRoot, icdRelativePath),
        backupRoot: path.join(wineResourcesRoot, MOLTENVK_BACKUP_DIR),
        managedFiles: patchedFiles,
        updatedAt: new Date().toISOString(),
    };
}

function backupWineBundleFile(wineLibRoot, relativePath) {
    const target = path.join(wineLibRoot, relativePath);
    if (!fs.existsSync(target)) return;

    const backup = path.join(wineLibRoot, DXMT_BACKUP_DIR, relativePath);
    if (fs.existsSync(backup)) return;

    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
}

function copyDxmtWineBundleFile(source, wineLibRoot, relativePath, patchedFiles) {
    if (!fs.existsSync(source)) return;

    backupWineBundleFile(wineLibRoot, relativePath);

    const target = path.join(wineLibRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    patchedFiles.push(relativePath);
}

function codesignIfPossible(filePath) {
    try {
        execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", filePath], { stdio: "ignore" });
    } catch (error) {
        console.warn(`Failed to codesign ${filePath}:`, error && error.message ? error.message : error);
    }
}

function copyDxmtDllsToPrefix(prefixPath, payloadRoot) {
    const windowsPath = path.join(prefixPath, "drive_c", "windows");
    const installed = [];

    for (const { arch, sourceDir, systemDir } of [
        {
            arch: "x64",
            sourceDir: path.join(payloadRoot, "x86_64-windows"),
            systemDir: path.join(windowsPath, "system32"),
        },
        {
            arch: "x32",
            sourceDir: path.join(payloadRoot, "i386-windows"),
            systemDir: path.join(windowsPath, "syswow64"),
        },
    ]) {
        if (!fs.existsSync(sourceDir)) continue;

        for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".dll")) continue;
            const dllName = path.basename(entry.name, ".dll");
            if (copyDll(sourceDir, systemDir, dllName)) installed.push(`${arch}/${entry.name}`);
        }
    }

    return installed;
}

function applyDxmt(prefixPath, moduleRoot, version, wineApp) {
    const versionRoot = path.join(moduleRoot, "deps", "dxmtVersion", version);
    if (!fs.existsSync(versionRoot)) {
        throw new Error(`DXMT ${version} is not installed.`);
    }
    if (!wineApp) {
        throw new Error("DXMT requires a selected Wine app bundle.");
    }

    const payloadRoot = findDxmtPayload(versionRoot);
    if (!payloadRoot) {
        throw new Error(`DXMT ${version} is installed but does not contain Wine builtin DLL folders.`);
    }

    const wineLibRoot = path.join(wineApp, "Contents", "Resources", "wine", "lib", "wine");
    if (!fs.existsSync(wineLibRoot)) {
        throw new Error(`Wine bundle does not contain a lib/wine directory: ${wineLibRoot}`);
    }

    const patchedFiles = [];

    for (const archDir of ["x86_64-windows", "i386-windows"]) {
        for (const dllName of DXMT_WINDOWS_DLLS) {
            copyDxmtWineBundleFile(
                path.join(payloadRoot, archDir, `${dllName}.dll`),
                wineLibRoot,
                path.join(archDir, `${dllName}.dll`),
                patchedFiles
            );
        }
    }

    const winemetalSo = path.join("x86_64-unix", "winemetal.so");
    copyDxmtWineBundleFile(path.join(payloadRoot, winemetalSo), wineLibRoot, winemetalSo, patchedFiles);

    const patchedWinemetalSo = path.join(wineLibRoot, winemetalSo);
    if (fs.existsSync(patchedWinemetalSo)) codesignIfPossible(patchedWinemetalSo);

    if (patchedFiles.length === 0) {
        throw new Error(`DXMT ${version} does not contain files supported by this module.`);
    }

    const managedPrefixDlls = copyDxmtDllsToPrefix(prefixPath, payloadRoot);
    if (managedPrefixDlls.length === 0) {
        throw new Error(`DXMT ${version} does not contain prefix DLLs supported by this module.`);
    }

    return {
        enabled: true,
        backend: "dxmt",
        version,
        mode: "wine-bundle-and-prefix-dlls",
        wineApp,
        payloadRoot,
        backupRoot: path.join(wineLibRoot, DXMT_BACKUP_DIR),
        managedBundleFiles: patchedFiles,
        managedPrefixDlls,
        managedDlls: managedPrefixDlls,
        updatedAt: new Date().toISOString(),
    };
}

function getD3dBackendLaunchEnv(args, backendState) {
    const safeArgs = args || {};
    const backend = backendState && backendState.enabled ? backendState.backend : normalizeBackend(safeArgs);
    if (backend === "none") return {};

    if (backend === "dxmt") {
        return {
            WINE_MF_MFT_SKIP_VERIFY: "1",
            WINEDLLOVERRIDES: "nvapi,nvapi64=;mf,mfplat,mfreadwrite,mfplay=b;d3d11,d3d10core,dxgi,winemetal=b",
        };
    }

    const env = {
        WINEDLLOVERRIDES: "dxgi,d3d10,d3d10_1,d3d10core,d3d11=n,b",
    };

    if (backendState && backendState.moltenvk && backendState.moltenvk.enabled) {
        env.DYLD_LIBRARY_PATH = process.env.DYLD_LIBRARY_PATH
            ? `${backendState.moltenvk.libDir}:${process.env.DYLD_LIBRARY_PATH}`
            : backendState.moltenvk.libDir;
        env.VK_ICD_FILENAMES = backendState.moltenvk.icdPath;
    }

    if (isEnabled(safeArgs.dxvkAsync)) env.DXVK_ASYNC = "1";

    switch (safeArgs.dxvkHud) {
        case "fps":
            env.DXVK_HUD = "fps";
            break;
        case "devinfo-fps":
            env.DXVK_HUD = "devinfo,fps";
            break;
        case "full":
            env.DXVK_HUD = "full";
            break;
        default:
            break;
    }

    return env;
}

module.exports = {
    applyD3dBackendToPrefix,
    getD3dBackendLaunchEnv,
    normalizeBackend,
    removeD3dBackendFromPrefix,
};
