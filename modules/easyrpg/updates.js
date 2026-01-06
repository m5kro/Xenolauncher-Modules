async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const timeoutMs = 1000;

    const DEPS_DIR = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "easyrpg",
        "deps"
    );

    const CURRENT_BUILD_PATH = path.join(DEPS_DIR, "current-build.txt");
    const LATEST_BUILD_PATH = path.join(DEPS_DIR, "latest-build.txt");

    async function readTextFileTrim(p) {
        try {
            const s = await fs.promises.readFile(p, "utf8");
            const t = String(s).trim();
            return t ? t : null;
        } catch {
            return null;
        }
    }

    async function writeTextFile(p, contents) {
        await fs.promises.mkdir(path.dirname(p), { recursive: true });
        await fs.promises.writeFile(p, `${contents}\n`, "utf8");
    }

    async function getLatestBuildFromCI() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = `https://ci.easyrpg.org/job/player-macos/api/json`;

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    "User-Agent": "xenolauncher",
                },
            });

            if (!res.ok) {
                throw new Error(`Error: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            const n = data?.builds?.[0]?.number;
            if (n === undefined || n === null) throw new Error("Response missing build number");

            const buildStr = String(n);
            console.info(`[easyrpg] Latest build number: ${buildStr}`);
            return buildStr;
        } catch (err) {
            console.error(`[easyrpg] Failed to fetch latest build number: ${err.message}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // Read current/latest from disk (if present)
    const currentBuild = await readTextFileTrim(CURRENT_BUILD_PATH);
    const latchedLatestBuild = await readTextFileTrim(LATEST_BUILD_PATH);

    // Try to fetch latest from CI
    const remoteLatestBuild = await getLatestBuildFromCI();

    // --- Fresh install / missing current ---
    // If current-build.txt doesn't exist, assume latest installed.
    // Only initialize if we successfully fetched a build number.
    if (!currentBuild) {
        if (!remoteLatestBuild) return;

        await writeTextFile(CURRENT_BUILD_PATH, remoteLatestBuild);
        await writeTextFile(LATEST_BUILD_PATH, remoteLatestBuild);
        return; // no update on fresh install
    }

    // --- Normal operation ---
    // Prefer remote build when available; otherwise fall back to latched latest build.
    const effectiveLatestBuild = remoteLatestBuild || latchedLatestBuild;
    if (!effectiveLatestBuild) return;

    // If remote says we're up-to-date, clear any stale latched value by syncing latest -> current.
    if (remoteLatestBuild && remoteLatestBuild === currentBuild) {
        if (latchedLatestBuild !== currentBuild) {
            await writeTextFile(LATEST_BUILD_PATH, currentBuild);
        }
        return; // no update
    }

    // If effective latest matches current, no update.
    if (effectiveLatestBuild === currentBuild) return;

    // Update available:
    // Latch latest-build.txt when we successfully fetched a new remote value,
    // so repeated checks still show an update even if CI fetch fails later.
    if (remoteLatestBuild && remoteLatestBuild !== latchedLatestBuild) {
        await writeTextFile(LATEST_BUILD_PATH, remoteLatestBuild);
    }

    return {
        easyrpg: {
            universal: {
                link: "https://ci.easyrpg.org/downloads/macos/EasyRPG-Player-macos.app.zip",
                unzip: true,
            },
        },
    };
}

exports.checkUpdates = checkUpdates;
