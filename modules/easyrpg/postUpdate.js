async function postUpdate(updatedDeps) {
    const fs = require("fs");
    const path = require("path");
    const DEPS_DIR = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "easyrpg",
        "deps"
    );
    const currentPath = path.join(DEPS_DIR, "current-build.txt");
    const latestPath = path.join(DEPS_DIR, "latest-build.txt");

    try {
        if (!fs.existsSync(latestPath)) return;

        const latest = (await fs.promises.readFile(latestPath, "utf8")).trim();
        if (!latest) return;

        await fs.promises.mkdir(path.dirname(currentPath), { recursive: true });
        await fs.promises.writeFile(currentPath, `${latest}\n`, "utf8");
    } catch (e) {
        console.warn("[easyrpg] postupdate failed:", e);
    }
}

exports.postUpdate = postUpdate;
