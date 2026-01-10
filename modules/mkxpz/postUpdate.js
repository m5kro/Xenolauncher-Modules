async function postUpdate (updatedDeps) {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const DEPS_DIR = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "mkxpz",
        "deps"
    );
    const currentPath = path.join(DEPS_DIR, "current-sha.txt");
    const latestPath = path.join(DEPS_DIR, "latest-sha.txt");

    try {
        if (!fs.existsSync(latestPath)) return;

        // Replace current with latest (keep latest around too)
        const latest = (await fs.promises.readFile(latestPath, "utf8")).trim();
        if (!latest) return;

        await fs.promises.mkdir(path.dirname(currentPath), { recursive: true });
        await fs.promises.writeFile(currentPath, `${latest}\n`, "utf8");
    } catch (e) {
        console.warn("[mkxpz] postupdate failed:", e);
    }
};
exports.postUpdate = postUpdate;
