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
        "ruffle",
        "deps"
    );

    const CURRENT_TAG_PATH = path.join(DEPS_DIR, "current-release.txt");
    const LATEST_TAG_PATH = path.join(DEPS_DIR, "latest-release.txt");

    function buildUniversalAssetName(tagName) {
        // Tag example: nightly-2026-01-02
        // File example: ruffle-nightly-2026_01_02-macos-universal.tar.gz
        const tagForFile = tagName.replace(/(\d{4})-(\d{2})-(\d{2})/, "$1_$2_$3");
        return `ruffle-${tagForFile}-macos-universal.tar.gz`;
    }

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

    // Ruffle is still in prerelease phase, this will eventually need to be changed to releases
    async function getLatestPrereleaseTagFromGitHub() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = "https://api.github.com/repos/ruffle-rs/ruffle/releases?per_page=50";

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
            if (!Array.isArray(data)) {
                throw new Error("GitHub response was not an array of releases");
            }

            const latestPrerelease = data.find((r) => r && r.prerelease === true);
            const tagName = latestPrerelease?.tag_name;

            if (typeof tagName !== "string" || !tagName) {
                throw new Error("No prerelease tag_name found in GitHub releases response");
            }

            console.info(`[ruffle] Latest prerelease tag: ${tagName}`);
            return tagName;
        } catch (err) {
            console.error(`[ruffle] Failed to fetch latest prerelease tag: ${err.message}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // Read current/latest from disk (if present)
    const currentTag = await readTextFileTrim(CURRENT_TAG_PATH);
    const latchedLatestTag = await readTextFileTrim(LATEST_TAG_PATH);

    // Try to fetch latest from GitHub
    const remoteLatestTag = await getLatestPrereleaseTagFromGitHub();

    // --- Fresh install / missing current ---
    // If current-release.txt doesn't exist, assume latest installed.
    // Only initialize if we successfully fetched a tag.
    if (!currentTag) {
        if (!remoteLatestTag) return;

        await writeTextFile(CURRENT_TAG_PATH, remoteLatestTag);
        await writeTextFile(LATEST_TAG_PATH, remoteLatestTag);
        return; // no update on fresh install
    }

    // --- Normal operation ---
    // Prefer remote tag when available; otherwise fall back to latched latest tag.
    const effectiveLatestTag = remoteLatestTag || latchedLatestTag;
    if (!effectiveLatestTag) return;

    // If remote says we're up-to-date, clear any stale latched value by syncing latest -> current.
    if (remoteLatestTag && remoteLatestTag === currentTag) {
        if (latchedLatestTag !== currentTag) {
            await writeTextFile(LATEST_TAG_PATH, currentTag);
        }
        return; // no update
    }

    // If effective latest matches current, no update.
    if (effectiveLatestTag === currentTag) return;

    // Update available:
    // Latch latest-release.txt when we successfully fetched a new remote value,
    // so repeated checks still show an update even if GitHub fetch fails later.
    if (remoteLatestTag && remoteLatestTag !== latchedLatestTag) {
        await writeTextFile(LATEST_TAG_PATH, remoteLatestTag);
    }

    // Build download link using the *effective* latest tag
    const tagForDownload = remoteLatestTag || latchedLatestTag;
    if (!tagForDownload) return;

    const assetName = buildUniversalAssetName(tagForDownload);
    const link = `https://github.com/ruffle-rs/ruffle/releases/download/${tagForDownload}/${assetName}`;

    return {
        ruffle: {
            universal: {
                link,
                unzip: true,
            },
        },
    };
}

exports.checkUpdates = checkUpdates;