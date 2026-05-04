const fs = require("fs");
const path = require("path");

const BACKUP_SUFFIX = ".xenolauncher-orig";
const BACKEND_DLLS = ["dxgi", "d3d10", "d3d10_1", "d3d10core", "d3d11", "winemetal"];
const DXVK_DLLS = ["dxgi", "d3d10", "d3d10_1", "d3d10core", "d3d11"];

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

function restoreDll(systemDir, dllName) {
    const target = path.join(systemDir, `${dllName}.dll`);
    const backup = `${target}${BACKUP_SUFFIX}`;

    if (fs.existsSync(backup)) {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        fs.renameSync(backup, target);
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

function removeD3dBackendFromPrefix(prefixPath) {
    const windowsPath = path.join(prefixPath, "drive_c", "windows");
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

function applyD3dBackendToPrefix(prefixPath, moduleRoot, args, existingMetadata) {
    const backend = normalizeBackend(args || {});
    const previous = getPreviousBackend(existingMetadata);

    if (backend === "none") {
        if (previous && previous.enabled) removeD3dBackendFromPrefix(prefixPath);
        return { enabled: false, backend: "none" };
    }

    const version = resolveBackendVersion(moduleRoot, args || {}, backend);
    if (!version) {
        throw new Error(`${backend.toUpperCase()} is selected, but no ${backend.toUpperCase()} version is installed.`);
    }

    if (shouldRestorePrevious(previous, backend, version)) {
        removeD3dBackendFromPrefix(prefixPath);
    }

    if (backend === "dxvk") return applyDxvkToPrefix(prefixPath, moduleRoot, version);
    return applyDxmt(moduleRoot, version);
}

function applyDxvkToPrefix(prefixPath, moduleRoot, version) {
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

    return {
        enabled: true,
        backend: "dxvk",
        version,
        mode: "prefix-dlls",
        managedDlls: installed,
        updatedAt: new Date().toISOString(),
    };
}

function applyDxmt(moduleRoot, version) {
    const versionRoot = path.join(moduleRoot, "deps", "dxmtVersion", version);
    if (!fs.existsSync(versionRoot)) {
        throw new Error(`DXMT ${version} is not installed.`);
    }

    const payloadRoot = findDxmtPayload(versionRoot);
    if (!payloadRoot) {
        throw new Error(`DXMT ${version} is installed but does not contain Wine builtin DLL folders.`);
    }

    return {
        enabled: true,
        backend: "dxmt",
        version,
        mode: "winedllpath",
        payloadRoot,
        managedDlls: [],
        updatedAt: new Date().toISOString(),
    };
}

function getD3dBackendLaunchEnv(args, backendState) {
    const safeArgs = args || {};
    const backend = backendState && backendState.enabled ? backendState.backend : normalizeBackend(safeArgs);
    if (backend === "none") return {};

    if (backend === "dxmt") {
        const env = {
            WINEDLLOVERRIDES: "dxgi,d3d10core,d3d11,winemetal=b;d3d10,d3d10_1=b",
        };
        if (backendState && backendState.payloadRoot) {
            env.WINEDLLPATH = process.env.WINEDLLPATH
                ? `${backendState.payloadRoot}:${process.env.WINEDLLPATH}`
                : backendState.payloadRoot;
        }
        return env;
    }

    const env = {
        WINEDLLOVERRIDES: "dxgi,d3d10,d3d10_1,d3d10core,d3d11=n,b",
    };

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
