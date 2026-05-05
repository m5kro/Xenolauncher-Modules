// Use wine to launch Windows applications
// Thanks to Gcenx for prebuilt Wine binaries: https://github.com/Gcenx/macOS_Wine_builds
// Thanks to crossover for Wine CX
// TODO:
// Improve post-install executable selection UI.
// Winetricks for stuff that needs it
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
            maxBuffer: 50 * 1024 * 1024,
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

    function findWineserver(wineApp) {
        const wineserver = path.join(wineApp, "Contents", "Resources", "wine", "bin", "wineserver");
        return fs.existsSync(wineserver) ? wineserver : null;
    }

    function getGamesPath() {
        return path.join(os.homedir(), "Library", "Application Support", "Xenolauncher", "games.json");
    }

    function stripExtension(value) {
        const base = path.basename(String(value || ""));
        return base.replace(/\.(exe|lnk)$/i, "");
    }

    function normalizeMatch(value) {
        return stripExtension(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function pathMatchText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function compactMatch(value) {
        return String(value || "").replace(/\s+/g, "");
    }

    function isRejectedExecutableName(exeName) {
        const compact = compactMatch(exeName).toLowerCase();
        if (/^unins\d*$/.test(compact)) return true;
        if (/^uninstall(er)?$/.test(compact)) return true;
        if (/^setup$/.test(compact)) return true;
        if (/^install(er)?$/.test(compact)) return true;
        return (
            compact.includes("dxsetup") ||
            compact.includes("vcredist") ||
            compact.includes("redist") ||
            compact.includes("dotnet") ||
            compact.includes("crashreporter") ||
            compact.endsWith("runtime") ||
            compact.endsWith("repair") ||
            compact.endsWith("modify") ||
            compact.endsWith("helper") ||
            compact.endsWith("updater")
        );
    }

    function isRejectedExecutablePath(candidatePath) {
        const parts = candidatePath.split(path.sep).map((part) => part.toLowerCase());
        for (let i = 0; i < parts.length - 1; i++) {
            if (parts[i] !== "program files" && parts[i] !== "program files (x86)") continue;
            const child = parts[i + 1];
            return (
                child === "common files" ||
                child === "internet explorer" ||
                child === "windows media player" ||
                child === "windows nt"
            );
        }
        return false;
    }

    function walkMatchingFiles(root, predicate) {
        const matches = [];
        if (!root || !fs.existsSync(root)) return matches;

        const stack = [root];
        while (stack.length) {
            const current = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                } else if (entry.isFile() && predicate(fullPath, entry.name)) {
                    matches.push(fullPath);
                }
            }
        }

        return matches;
    }

    function getExecutableSearchRoots(winePrefix) {
        const driveC = path.join(winePrefix, "drive_c");
        return [
            path.join(driveC, "Program Files"),
            path.join(driveC, "Program Files (x86)"),
            path.join(driveC, "users"),
            path.join(driveC, "ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        ];
    }

    function collectExeState(winePrefix) {
        const state = new Map();
        for (const root of getExecutableSearchRoots(winePrefix)) {
            for (const exePath of walkMatchingFiles(root, (fullPath) => fullPath.toLowerCase().endsWith(".exe"))) {
                try {
                    state.set(exePath, fs.statSync(exePath).mtimeMs);
                } catch {}
            }
        }
        return state;
    }

    function collectShortcutNames(winePrefix) {
        const driveC = path.join(winePrefix, "drive_c");
        const roots = [
            path.join(driveC, "users"),
            path.join(driveC, "ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        ];
        const names = new Set();

        for (const root of roots) {
            for (const shortcutPath of walkMatchingFiles(root, (fullPath) => fullPath.toLowerCase().endsWith(".lnk"))) {
                const normalized = normalizeMatch(shortcutPath);
                if (normalized) {
                    names.add(normalized);
                    names.add(compactMatch(normalized));
                }
            }
        }

        return names;
    }

    function scoreExecutableCandidate(candidatePath, beforeState, shortcutNames, normalizedGameName) {
        const basename = path.basename(candidatePath);
        const exeName = normalizeMatch(basename);
        const parentName = normalizeMatch(path.basename(path.dirname(candidatePath)));
        const fullText = pathMatchText(candidatePath);
        const compactGameName = compactMatch(normalizedGameName);
        const exeCompact = compactMatch(exeName);
        const parentCompact = compactMatch(parentName);
        const fullCompact = compactMatch(fullText);
        const previousMtime = beforeState.get(candidatePath);
        let score = 0;

        if (normalizedGameName) {
            if (exeName === normalizedGameName || exeCompact === compactGameName) score += 10000;
            if (parentName === normalizedGameName || parentCompact === compactGameName) score += 7000;
            if (fullText.includes(normalizedGameName) || fullCompact.includes(compactGameName)) score += 5000;
        }

        if (shortcutNames.has(exeName) || shortcutNames.has(exeCompact)) score += 4000;

        let modified = false;
        if (previousMtime === undefined) {
            score += 2000;
            modified = true;
        } else {
            try {
                const currentMtime = fs.statSync(candidatePath).mtimeMs;
                if (currentMtime > previousMtime + 1) {
                    score += 1000;
                    modified = true;
                }
            } catch {}
        }

        if (/\/program files( \(x86\))?\//i.test(candidatePath)) score += 500;
        if (/\/(desktop|start menu|programs)\//i.test(candidatePath)) score += 250;

        return { score, modified };
    }

    function findInstalledExecutable(winePrefix, beforeState) {
        const shortcutNames = collectShortcutNames(winePrefix);
        const normalizedGameName = normalizeMatch(gameName);
        const seen = new Set();
        const candidates = [];

        for (const root of getExecutableSearchRoots(winePrefix)) {
            for (const exePath of walkMatchingFiles(root, (fullPath) => fullPath.toLowerCase().endsWith(".exe"))) {
                if (seen.has(exePath)) continue;
                seen.add(exePath);

                if (isRejectedExecutablePath(exePath)) continue;
                if (isRejectedExecutableName(normalizeMatch(path.basename(exePath)))) continue;

                const scored = scoreExecutableCandidate(exePath, beforeState, shortcutNames, normalizedGameName);
                if (scored.score <= 0) continue;

                let mtimeMs = 0;
                try {
                    mtimeMs = fs.statSync(exePath).mtimeMs;
                } catch {}

                candidates.push({ path: exePath, score: scored.score, modified: scored.modified, mtimeMs });
            }
        }

        candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
            return a.path.localeCompare(b.path);
        });

        return candidates[0] || null;
    }

    function updateGamePathAfterInstall(nextGamePath) {
        if (!gameName) throw new Error("Cannot update games.json because the game name is empty.");

        const gamesPath = getGamesPath();
        if (!fs.existsSync(gamesPath)) throw new Error(`games.json not found at ${gamesPath}`);

        const games = JSON.parse(fs.readFileSync(gamesPath, "utf8"));
        const gameId = Object.keys(games).find((id) => games[id] && games[id].gameTitle === gameName);
        if (!gameId) throw new Error(`Could not find a game named "${gameName}" in games.json.`);

        games[gameId].gamePath = nextGamePath;
        games[gameId].gameArgs = { ...(games[gameId].gameArgs || {}), isInstaller: false };

        fs.writeFileSync(gamesPath, JSON.stringify(games, null, 2), "utf8");
    }

    function openPrefixInFinder(winePrefix) {
        execFile("open", [winePrefix], (error) => {
            if (error) console.warn(`Failed to open Wine prefix in Finder: ${error.message}`);
        });
    }

    async function waitForWineserver(wineApp, winePrefix, launchEnv) {
        const wineserver = findWineserver(wineApp);
        if (!wineserver) return;
        await execWineBinary(wineserver, ["-w"], { env: { WINEPREFIX: winePrefix, ...(launchEnv || {}) } });
    }

    async function handleInstallerResult(winePrefix, beforeState) {
        const detected = findInstalledExecutable(winePrefix, beforeState);
        if (!detected) {
            if (ui && typeof ui.alert === "function") {
                await ui.alert(
                    `Installer finished, but Xenolauncher could not find the installed executable. Please edit the game path manually.\n\nPrefix:\n${winePrefix}`,
                    "Wine Installer"
                );
            }
            return "manual";
        }

        const confirmed =
            ui && typeof ui.confirm === "function"
                ? await ui.confirm(
                      `Installer finished. Is this the correct executable?\n\n${detected.path}`,
                      "Wine Installer"
                  )
                : false;

        if (!confirmed) {
            if (ui && typeof ui.alert === "function") {
                await ui.alert(
                    `Executable detection was not confirmed. Please edit the game path manually.\n\nDetected candidate:\n${detected.path}\n\nPrefix:\n${winePrefix}`,
                    "Wine Installer"
                );
            }
            return "manual";
        }

        try {
            updateGamePathAfterInstall(detected.path);
            if (ui && typeof ui.alert === "function") {
                await ui.alert(
                    `Updated ${gameName} to launch:\n\n${detected.path}`,
                    "Wine Installer"
                );
            }
            return "updated";
        } catch (error) {
            if (ui && typeof ui.alert === "function") {
                await ui.alert(
                    `The executable was confirmed, but Xenolauncher could not update games.json automatically. Please edit the game path manually.\n\n${error.message}`,
                    "Wine Installer"
                );
            }
            return "manual";
        }
    }

    async function runInstaller(wineBinary, wineApp, winePrefix, launchEnv) {
        const beforeState = collectExeState(winePrefix);
        const env = { WINEPREFIX: winePrefix, ...(launchEnv || {}) };

        console.log(`Running installer: ${gamePath}`);
        try {
            await execWineBinary(wineBinary, [gamePath], { env, cwd: gameFolder });
        } catch (error) {
            console.warn(`Installer exited with an error: ${error.message}`);
        }

        try {
            await waitForWineserver(wineApp, winePrefix, launchEnv);
        } catch (error) {
            console.warn(`Failed while waiting for Wine installer processes: ${error.message}`);
        }

        const result = await handleInstallerResult(winePrefix, beforeState);
        if (result !== "updated") {
            openPrefixInFinder(winePrefix);
        }
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

        const d3dBackendState = applyD3dBackendToPrefix(winePrefix, moduleRoot, args, existingMetadata, wineApp);

        try {
            writeMetadata(
                winePrefix,
                buildMetadata(winePrefix, automatic, existingMetadata, wineVersion, wineApp, d3dBackendState)
            );
        } catch (error) {
            console.warn("Failed to write Wine prefix metadata:", error);
        }

        const launchEnv = getD3dBackendLaunchEnv(args, d3dBackendState);
        if (args.isInstaller === true) {
            await runInstaller(wineBinary, wineApp, winePrefix, launchEnv);
        } else {
            launchGame(wineBinary, winePrefix, launchEnv);
        }
    }

    run().catch((error) => {
        showError(error && error.message ? error.message : String(error));
    });
}

exports.launch = launch;
