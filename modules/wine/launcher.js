// Use wine to launch Windows applications
// Thanks to Gcenx for prebuilt Wine binaries: https://github.com/Gcenx/macOS_Wine_builds
// TODO:
// Add D9VK support later for Direct3D 9 games.
// Handle installers
// Winetricks to make everything a bit easier
function launch(gamePath, gameFolder, gameArgs, gameName, ui) {
    const path = require("path");
    const { execFile } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    const {
        MANAGED_BY,
        isValidPrefix,
        readMetadata,
        resolvePrefix,
        writeMetadata,
    } = require("./prefix.js");
    const { applyD3dBackendToPrefix, getD3dBackendLaunchEnv } = require("./d3d-backend-prefix.js");

    const arch = os.arch();
    const moduleRoot = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "wine"
    );
    const versionsRoot = path.join(moduleRoot, "deps", "version");
    const args = gameArgs || {};

    function showError(message) {
        console.error(message);
        if (ui && typeof ui.alert === "function") {
            ui.alert(message, "Wine Launch Error").catch(() => {});
        }
    }

    function getInstalledVersions() {
        try {
            if (!fs.existsSync(versionsRoot)) return [];
            return fs
                .readdirSync(versionsRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
        } catch (error) {
            console.warn("Failed to read installed Wine versions:", error);
            return [];
        }
    }

    function resolveVersion() {
        const installed = getInstalledVersions();
        const requested = typeof args.version === "string" ? args.version.trim() : "";
        if (requested && installed.includes(requested)) return requested;
        if (installed.includes("11.7-staging")) return "11.7-staging";
        return installed[0] || requested || "11.7-staging";
    }

    function findWineApp(versionDir) {
        const stack = [versionDir];
        while (stack.length) {
            const current = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const fullPath = path.join(current, entry.name);
                if (entry.name.endsWith(".app") && entry.name.toLowerCase().startsWith("wine")) {
                    const wineBinary = path.join(fullPath, "Contents", "MacOS", "wine");
                    if (fs.existsSync(wineBinary)) return fullPath;
                }
                stack.push(fullPath);
            }
        }
        return null;
    }

    function execWineBinary(binary, binaryArgs, options = {}) {
        const env = { ...process.env, ...(options.env || {}) };
        const execOptions = {
            env,
            cwd: options.cwd,
        };

        return new Promise((resolve, reject) => {
            const command = arch === "arm64" ? "arch" : binary;
            const commandArgs = arch === "arm64" ? ["-x86_64", binary, ...binaryArgs] : binaryArgs;

            execFile(command, commandArgs, execOptions, (error, stdout, stderr) => {
                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);
                if (error) reject(error);
                else resolve();
            });
        });
    }

    function resolveWineboot(wineApp, wineBinary) {
        const wineRoot = path.join(wineApp, "Contents", "Resources", "wine");
        const nativeWineboot = path.join(wineRoot, "bin", "wineboot");
        if (fs.existsSync(nativeWineboot)) {
            return { binary: nativeWineboot, argsPrefix: [] };
        }

        for (const builtinDir of ["x86_64-windows", "i386-windows"]) {
            const builtinWineboot = path.join(wineRoot, "lib", "wine", builtinDir, "wineboot.exe");
            if (fs.existsSync(builtinWineboot)) {
                return { binary: wineBinary, argsPrefix: ["wineboot.exe"] };
            }
        }

        return null;
    }

    function execWineboot(wineboot, winebootArgs, options = {}) {
        return execWineBinary(wineboot.binary, [...wineboot.argsPrefix, ...winebootArgs], options);
    }

    function launchGame(wineBinary, winePrefix, launchEnv) {
        const env = { ...process.env, WINEPREFIX: winePrefix, ...(launchEnv || {}) };
        const execOptions = { env, cwd: gameFolder };
        const command = arch === "arm64" ? "arch" : wineBinary;
        const commandArgs = arch === "arm64" ? ["-x86_64", wineBinary, gamePath] : [gamePath];

        console.log(
            arch === "arm64"
                ? "Apple Silicon detected, using rosetta2 to launch the game"
                : "Intel architecture detected, launching the game normally"
        );

        execFile(command, commandArgs, execOptions, (error, stdout, stderr) => {
            if (error) {
                showError(`Error launching game: ${error.message}`);
                return;
            }
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            console.log(`Game launched: ${gamePath}`);
        });
    }

    function buildMetadata(prefixPath, automatic, existingMetadata, wineVersion, wineApp, d3dBackendState) {
        const now = new Date().toISOString();
        return {
            schema: 1,
            managedBy: MANAGED_BY,
            automaticPrefix: automatic,
            gameName: gameName || "",
            gamePath,
            gameFolder,
            prefixPath,
            wineVersion,
            wineApp,
            d3dBackend: d3dBackendState,
            createdAt: existingMetadata && existingMetadata.createdAt ? existingMetadata.createdAt : now,
            updatedAt: now,
        };
    }

    async function run() {
        const wineVersion = resolveVersion();
        const wineVersionDir = path.join(versionsRoot, wineVersion);
        const wineApp = findWineApp(wineVersionDir);

        if (!wineApp) {
            throw new Error(`Wine ${wineVersion} is not installed or does not contain a Wine app bundle.`);
        }

        // Gcenx macOS Wine builds are x86_64, so Rosetta is required on Apple Silicon.
        const wineBinary = path.join(wineApp, "Contents", "MacOS", "wine");

        if (!fs.existsSync(wineBinary)) {
            throw new Error(`Wine binary not found at ${wineBinary}`);
        }

        const wineboot = resolveWineboot(wineApp, wineBinary);
        if (!wineboot) {
            throw new Error(`wineboot not found in ${wineApp}`);
        }

        const { prefixPath: winePrefix, automatic } = resolvePrefix(args, gameName, gameFolder, gamePath);
        fs.mkdirSync(path.dirname(winePrefix), { recursive: true });

        const existingMetadata = readMetadata(winePrefix);
        const validPrefix = isValidPrefix(winePrefix);
        const wineEnv = { WINEPREFIX: winePrefix };

        if (!validPrefix) {
            console.log(`Initializing Wine prefix at ${winePrefix}`);
            await execWineboot(wineboot, ["--init"], { env: { ...wineEnv, WINEARCH: "win64" } });
            if (!isValidPrefix(winePrefix)) {
                throw new Error(`Wine prefix initialization did not create a valid prefix at ${winePrefix}`);
            }
        } else if (existingMetadata && existingMetadata.wineVersion && existingMetadata.wineVersion !== wineVersion) {
            console.log(`Wine version changed from ${existingMetadata.wineVersion} to ${wineVersion}; updating prefix.`);
            await execWineboot(wineboot, ["--update"], { env: wineEnv });
        }

        const d3dBackendState = applyD3dBackendToPrefix(winePrefix, moduleRoot, args, existingMetadata);

        try {
            writeMetadata(
                winePrefix,
                buildMetadata(winePrefix, automatic, existingMetadata, wineVersion, wineApp, d3dBackendState)
            );
        } catch (error) {
            console.warn("Failed to write Wine prefix metadata:", error);
        }

        launchGame(wineBinary, winePrefix, getD3dBackendLaunchEnv(args, d3dBackendState));
    }

    run().catch((error) => {
        showError(error && error.message ? error.message : String(error));
    });
}

exports.launch = launch;
