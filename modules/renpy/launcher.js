function launch(gamePath, gameFolder, gameArgs, gameName, ui) {
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const renpyPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "renpy",
        "deps",
        "renpy",
        "renpy.sh"
    );

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
    const launchCommand = `${quote(renpyPath)} --savedir ${quote(savedir)} ${quote(gameFolder)} ${quote(command)}`;

    exec(launchCommand, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
}

exports.launch = launch;
