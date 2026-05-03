// Use wine to launch Windows applications
// Thanks to Gcenx for prebuilt Wine binaries: https://github.com/Gcenx/macOS_Wine_builds
// TODO:
// DXVK dll overrides (currently experiencing major graphical issues, I'm probably doing something wrong)
// Custom prefix per game
// Handle installers
// Winetricks to make everything a bit easier
function launch(gamePath, gameFolder, gameArgs, gameName, ui) {
    const path = require("path");
    const { execFile } = require("child_process");
    const fs = require("fs");
    const os = require("os");

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
        const requested = gameArgs && typeof gameArgs.version === "string" ? gameArgs.version.trim() : "";
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

    function runBinary(binary, args, options, callback) {
        const env = { ...process.env, ...(options.env || {}) };
        const execOptions = {
            env,
            cwd: options.cwd,
        };

        if (arch === "arm64") {
            execFile("arch", ["-x86_64", binary, ...args], execOptions, callback);
        } else {
            execFile(binary, args, execOptions, callback);
        }
    }

    const wineVersion = resolveVersion();
    const wineVersionDir = path.join(versionsRoot, wineVersion);
    const wineApp = findWineApp(wineVersionDir);

    if (!wineApp) {
        showError(`Wine ${wineVersion} is not installed or does not contain a Wine app bundle.`);
        return;
    }

    // Wine Binary is only x86_64 (intel) so rosetta2 is required on Apple Silicon
    const wineBinary = path.join(wineApp, "Contents", "MacOS", "wine");
    const winebootBinary = path.join(wineApp, "Contents", "Resources", "wine", "bin", "wineboot");
    
    // Will be replaced with per-game prefix later
    const winePrefix = path.join(
            os.homedir(),
            ".wine"
        );
    
    if (!fs.existsSync(wineBinary)) {
        showError(`Wine binary not found at ${wineBinary}`);
        return;
    }

    function launchGame() {
        const launchOptions = { env: { WINEPREFIX: winePrefix }, cwd: gameFolder };

        if (arch === "arm64") {
            console.log("Apple Silicon detected, using rosetta2 to launch the game");
        } else {
            console.log("Intel architecture detected, launching the game normally");
        }

        runBinary(wineBinary, [gamePath], launchOptions, (error, stdout, stderr) => {
            if (error) {
                showError(`Error launching game: ${error.message}`);
                return;
            }
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            console.log(`Game launched: ${gamePath}`);
        });
    }

    if (!fs.existsSync(winePrefix)) {
        // Create default wine prefix with wineboot before launching.
        if (!fs.existsSync(winebootBinary)) {
            showError(`wineboot not found at ${winebootBinary}`);
            return;
        }

        console.log(
            arch === "arm64"
                ? "Apple Silicon detected, using rosetta2 to initialize wine prefix"
                : "Intel architecture detected, initializing wine prefix normally"
        );

        runBinary(winebootBinary, ["--init"], { env: { WINEPREFIX: winePrefix } }, (error, stdout, stderr) => {
            if (error) {
                showError(`Error initializing wine prefix: ${error.message}`);
                return;
            }
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            console.log(`Wine prefix initialized at ${winePrefix}`);
            launchGame();
        });
        return;
    }

    launchGame();
    
}
exports.launch = launch;
