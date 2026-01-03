// Launch adobe flash games (swf) using ruffle
// Some ruffle cli args just don't work for some reason, probably why ruffle is still in prerelease
// There is also an issue with an h264 dylib not having the right permissions, so some swfs may not work unless you manually fix that
// Once again this is apple, making things difficult for no reason
const launch = (gamePath, gameFolder, gameArgs) => {
    const path = require("path");
    const { exec } = require("child_process");
    const fs = require("fs");
    const os = require("os");

    // Final Ruffle binary path
    const ruffleBinary = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "ruffle",
        "deps",
        "ruffle",
        "Ruffle.app",
        "Contents",
        "MacOS",
        "ruffle"
    );

    if (!fs.existsSync(ruffleBinary)) {
        console.error(`Ruffle binary not found at ${ruffleBinary}`);
        return;
    }

    // Build CLI args from gameArgs. This is a terrible way to do and will be replaced later.
    const args = [];

    const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
    const expandTilde = (p) => {
        if (!isNonEmptyString(p)) return p;
        if (p === "~") return os.homedir();
        if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
        return p;
    };

    // If a value is false, empty, or null/undefined -> do not include it.
    const shouldInclude = (v) => {
        if (v === null || v === undefined) return false;
        if (typeof v === "boolean") return v === true;
        if (typeof v === "string") return v.trim() !== "";
        if (Array.isArray(v)) return v.length > 0;
        return true; // numbers (including 0), objects, etc.
    };

    const pushFlag = (flag, enabled) => {
        if (enabled === true) args.push(flag);
    };

    const pushOption = (flag, value) => {
        if (!shouldInclude(value)) return;
        args.push(flag, String(value));
    };

    // -P <PARAMETERS> (repeatable) — allow "key=value" or "-Pkey=value"
    if (Array.isArray(gameArgs.flashvars) && gameArgs.flashvars.length > 0) {
        for (const raw of gameArgs.flashvars) {
            if (!isNonEmptyString(raw)) continue;
            const v = raw.trim();
            args.push(v.startsWith("-P") ? v : `-P${v}`);
        }
    }

    // Graphics / power
    pushOption("--graphics", gameArgs.graphics);
    pushOption("--power", gameArgs.power);

    // Window size (0=auto -> omit)
    if (Number.isFinite(gameArgs.width) && gameArgs.width > 0) pushOption("--width", gameArgs.width);
    if (Number.isFinite(gameArgs.height) && gameArgs.height > 0) pushOption("--height", gameArgs.height);

    // Storage + directories
    pushOption("--storage", gameArgs.storage);
    if (isNonEmptyString(gameArgs.saveDirectory)) pushOption("--save-directory", expandTilde(gameArgs.saveDirectory));
    if (isNonEmptyString(gameArgs.configDirectory)) pushOption("--config", expandTilde(gameArgs.configDirectory));
    if (isNonEmptyString(gameArgs.cacheDirectory))
        pushOption("--cache-directory", expandTilde(gameArgs.cacheDirectory));

    // Execution limit (0=unlimited -> omit)
    if (Number.isFinite(gameArgs.maxExecutionDuration) && gameArgs.maxExecutionDuration > 0) {
        pushOption("--max-execution-duration", gameArgs.maxExecutionDuration);
    }

    // Base
    pushOption("--base", gameArgs.base);

    // Quality
    pushOption("--quality", gameArgs.quality);

    // Align / scale
    pushOption("--align", gameArgs.align);
    pushFlag("--force-align", gameArgs.forceAlign);

    pushOption("--scale", gameArgs.scale);
    pushFlag("--force-scale", gameArgs.forceScale);

    // Volume (0..1). Default is 1 -> omit, but allow 0 (mute)
    if (Number.isFinite(gameArgs.volume) && gameArgs.volume >= 0 && gameArgs.volume <= 1 && gameArgs.volume !== 1) {
        pushOption("--volume", gameArgs.volume);
    }

    // Network / sockets
    pushOption("--proxy", gameArgs.proxy);

    if (Array.isArray(gameArgs.socketAllow) && gameArgs.socketAllow.length > 0) {
        for (const raw of gameArgs.socketAllow) {
            if (!isNonEmptyString(raw)) continue;
            pushOption("--socket-allow", raw.trim());
        }
    }

    // These have meaningful defaults in Ruffle; keep your existing “omit default” behavior:
    if (isNonEmptyString(gameArgs.tcpConnections) && gameArgs.tcpConnections !== "ask") {
        pushOption("--tcp-connections", gameArgs.tcpConnections);
    }

    pushFlag("--upgrade-to-https", gameArgs.upgradeToHttps);

    // Fullscreen
    pushFlag("--fullscreen", gameArgs.fullscreen);

    // Loading / letterbox
    pushOption("--load-behavior", gameArgs.loadBehavior);
    pushOption("--letterbox", gameArgs.letterbox);

    // Spoofs
    pushOption("--spoof-url", gameArgs.spoofUrl);
    pushOption("--referer", gameArgs.referer);
    pushOption("--cookie", gameArgs.cookie);

    // Player emulation
    if (Number.isFinite(gameArgs.playerVersion) && gameArgs.playerVersion > 0) {
        pushOption("--player-version", gameArgs.playerVersion);
    }
    if (isNonEmptyString(gameArgs.playerRuntime) && gameArgs.playerRuntime !== "flash-player") {
        pushOption("--player-runtime", gameArgs.playerRuntime);
    }

    // Frame rate (0=auto -> omit)
    if (Number.isFinite(gameArgs.frameRate) && gameArgs.frameRate > 0) {
        pushOption("--frame-rate", gameArgs.frameRate);
    }

    // URL / filesystem policies (omit defaults)
    if (isNonEmptyString(gameArgs.openUrlMode) && gameArgs.openUrlMode !== "confirm") {
        pushOption("--open-url-mode", gameArgs.openUrlMode);
    }
    if (isNonEmptyString(gameArgs.filesystemAccessMode) && gameArgs.filesystemAccessMode !== "ask") {
        pushOption("--filesystem-access-mode", gameArgs.filesystemAccessMode);
    }

    // Misc flags
    pushFlag("--dummy-external-interface", gameArgs.dummyExternalInterface);
    pushFlag("--no-gui", gameArgs.noGui);

    // Gamepad remaps (-B <button>=<key>, repeatable)
    if (Array.isArray(gameArgs.gamepadButton) && gameArgs.gamepadButton.length > 0) {
        for (const raw of gameArgs.gamepadButton) {
            if (!isNonEmptyString(raw)) continue;
            args.push("-B", raw.trim());
        }
    }

    pushFlag("--no-avm2-optimizer", gameArgs.noAvm2Optimizer);

    // Finally add the SWF path (or URL)
    args.push(gamePath);

    function shEscape(v) {
        const s = String(v ?? "");
        // POSIX shell escaping (macOS): wrap in single quotes, escape embedded single quotes
        // foo'bar -> 'foo'\''bar'
        if (s.length === 0) return "''";
        return `'${s.replace(/'/g, `'\\''`)}'`;
    }

    const cmd = [ruffleBinary, ...args].map(shEscape).join(" ");
    console.log(`[ruffle] Launching: ${cmd}`);

    exec(cmd, { cwd: gameFolder, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (error) console.error(`[ruffle] Failed to launch: ${error.message}`);
    });
};
exports.launch = launch;
