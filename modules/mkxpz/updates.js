async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const branch = "dev";
    const timeoutMs = 1000;

    const DEPS_DIR = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "mkxpz",
        "deps"
    );

    const CURRENT_SHA_PATH = path.join(DEPS_DIR, "current-sha.txt");
    const LATEST_SHA_PATH = path.join(DEPS_DIR, "latest-sha.txt");

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

    async function getLatestShaFromGitHub() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = `https://api.github.com/repos/m5kro/mkxp-z/commits/${encodeURIComponent(branch)}`;

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    Accept: "application/vnd.github+json",
                    "User-Agent": "xenolauncher",
                },
            });

            if (!res.ok) {
                throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            if (!data || typeof data.sha !== "string" || !data.sha) {
                throw new Error("GitHub response missing 'sha'");
            }

            console.info(`[mkxpz] Latest commit SHA: ${data.sha}`);
            return data.sha;
        } catch (err) {
            console.error(`[mkxpz] Failed to fetch latest commit SHA: ${err.message}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // Read current/latest from disk (if present)
    const currentSha = await readTextFileTrim(CURRENT_SHA_PATH);
    const latchedLatestSha = await readTextFileTrim(LATEST_SHA_PATH);

    // Try to fetch latest from GitHub
    const remoteLatestSha = await getLatestShaFromGitHub();

    // --- Fresh install / missing current ---
    // If current-sha.txt doesn't exist (or is empty), assume "latest installed".
    // Only do this if we successfully fetched a SHA (otherwise we can't safely initialize).
    if (!currentSha) {
        if (!remoteLatestSha) return;

        // Initialize both to the same value
        await writeTextFile(CURRENT_SHA_PATH, remoteLatestSha);
        await writeTextFile(LATEST_SHA_PATH, remoteLatestSha);
        return; // no update on fresh install
    }

    // --- Normal operation ---
    // Prefer remote SHA when available; otherwise fall back to latched latest SHA.
    const effectiveLatestSha = remoteLatestSha || latchedLatestSha;
    if (!effectiveLatestSha) return; // nothing to compare

    // If remote says we're up-to-date, clear any stale "latched update" by syncing latest -> current.
    if (remoteLatestSha && remoteLatestSha === currentSha) {
        if (latchedLatestSha !== currentSha) {
            await writeTextFile(LATEST_SHA_PATH, currentSha);
        }
        return; // no update
    }

    // If effective latest matches current, no update.
    if (effectiveLatestSha === currentSha) {
        return;
    }

    // Update available:
    // Latch the latest SHA (only overwrite if we actually got a remote SHA).
    // This ensures repeated checks still show an update even if GitHub fetch fails later.
    if (remoteLatestSha && remoteLatestSha !== latchedLatestSha) {
        await writeTextFile(LATEST_SHA_PATH, remoteLatestSha);
    }

    return {
        mkxpz: {
            universal: {
                link: "https://github.com/m5kro/mkxp-z/releases/download/launcher/Z-universal.zip",
                unzip: true,
            },
        },
    };
}

exports.checkUpdates = checkUpdates;
