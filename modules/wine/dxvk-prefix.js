const fs = require("fs");
const path = require("path");

const BACKUP_SUFFIX = ".xenolauncher-orig";
const MANAGED_DLLS = ["d3d10core", "d3d11"];

function isEnabled(value) {
    return value === true || value === "true";
}

function getInstalledDxvkVersions(moduleRoot) {
    const versionsRoot = path.join(moduleRoot, "deps", "dxvkVersion");
    try {
        if (!fs.existsSync(versionsRoot)) return [];
        return fs
            .readdirSync(versionsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
    } catch (error) {
        console.warn("Failed to read installed DXVK versions:", error);
        return [];
    }
}

function resolveDxvkVersion(moduleRoot, args) {
    const installed = getInstalledDxvkVersions(moduleRoot);
    const requested = typeof args.dxvkVersion === "string" ? args.dxvkVersion.trim() : "";
    if (requested && installed.includes(requested)) return requested;
    return installed[0] || requested;
}

function findDxvkPayload(root) {
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        const x64 = path.join(current, "x64");
        const x32 = path.join(current, "x32");
        if (fs.existsSync(x64) || fs.existsSync(x32)) return current;

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

function removeDxvkFromPrefix(prefixPath) {
    const windowsPath = path.join(prefixPath, "drive_c", "windows");
    for (const systemDir of [path.join(windowsPath, "system32"), path.join(windowsPath, "syswow64")]) {
        for (const dllName of MANAGED_DLLS) restoreDll(systemDir, dllName);
    }
}

function applyDxvkToPrefix(prefixPath, moduleRoot, args, existingMetadata) {
    const enabled = isEnabled(args.enableDxvk);
    const previous = existingMetadata && existingMetadata.dxvk ? existingMetadata.dxvk : null;

    if (!enabled) {
        if (previous && previous.enabled) removeDxvkFromPrefix(prefixPath);
        return { enabled: false };
    }

    const version = resolveDxvkVersion(moduleRoot, args);
    if (!version) {
        throw new Error("DXVK is enabled, but no DXVK-macOS version is installed.");
    }

    if (previous && previous.enabled && previous.version && previous.version !== version) {
        removeDxvkFromPrefix(prefixPath);
    }

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

        for (const dllName of MANAGED_DLLS) {
            if (copyDll(sourceDir, systemDir, dllName)) installed.push(`${arch}/${dllName}.dll`);
        }
    }

    if (installed.length === 0) {
        throw new Error(`DXVK ${version} does not contain D3D10/11 DLLs supported by this module.`);
    }

    return {
        enabled: true,
        version,
        managedDlls: installed,
        updatedAt: new Date().toISOString(),
    };
}

function getDxvkLaunchEnv(args) {
    if (!isEnabled(args.enableDxvk)) return {};

    const env = {
        WINEDLLOVERRIDES: "d3d10core,d3d11=n,b",
    };

    if (isEnabled(args.dxvkAsync)) env.DXVK_ASYNC = "1";

    switch (args.dxvkHud) {
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
    applyDxvkToPrefix,
    getDxvkLaunchEnv,
    removeDxvkFromPrefix,
};
