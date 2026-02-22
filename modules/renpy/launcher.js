function launch(gamePath, gameFolder, gameArgs, gameName, ui) {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const renpyDepsPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "renpy",
        "deps",
        "renpy"
    );

    // Renpy has the version number in the unzipped folder name
    function resolveRenpyPath() {
        const directPath = path.join(renpyDepsPath, "renpy.sh");
        if (fs.existsSync(directPath)) return directPath;

        try {
            const subfolders = fs
                .readdirSync(renpyDepsPath, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && /^renpy-\d+\.\d+\.\d+-sdk$/.test(entry.name))
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

            for (const folder of subfolders) {
                const candidate = path.join(renpyDepsPath, folder, "renpy.sh");
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch {
            return null;
        }

        return null;
    }

    const renpyPath = resolveRenpyPath();
    if (!renpyPath) {
        console.error("Unable to locate renpy.sh in Ren'Py dependency folder.");
        return;
    }

    const baseSaveDir = gameArgs && typeof gameArgs.savedir === "string" && gameArgs.savedir.trim()
        ? gameArgs.savedir
        : "~/Library/Application Support/xenolauncher/renpysaves/";
    const expandedBaseSaveDir = baseSaveDir.startsWith("~/")
        ? path.join(os.homedir(), baseSaveDir.slice(2))
        : baseSaveDir;
    const saveGameName = gameName && String(gameName).trim() ? String(gameName) : "game";
    const savedir = path.join(expandedBaseSaveDir, saveGameName);
    const command = gameArgs && typeof gameArgs.command === "string" ? gameArgs.command : "";

    const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const launchCommand = `${quote(renpyPath)} --savedir ${quote(savedir)} ${quote(gameFolder)}${command ? ` ${quote(command)}` : ""}`;

    exec(launchCommand, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
}

exports.launch = launch;
