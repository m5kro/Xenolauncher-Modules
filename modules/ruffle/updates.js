async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const timeoutMs = 1000;

    const RELEASE_NAME_FILE_PATH = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "ruffle",
        "deps",
        "ruffle-release.txt"
    );

    function buildUniversalAssetName(tagName) {
        // Tag example: nightly-2026-01-02
        // File example: ruffle-nightly-2026_01_02-macos-universal.tar.gz
        const tagForFile = tagName.replace(/(\d{4})-(\d{2})-(\d{2})/, "$1_$2_$3");
        return `ruffle-${tagForFile}-macos-universal.tar.gz`;
    }

    // Ruffle is still in prerelease phase, this will eventually need to be changed to releases
    async function getLatestPrereleaseTag(fallbackTag) {
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
            // On failure, fall back to last known tag (local file)
            return fallbackTag ?? null;
        } finally {
            clearTimeout(timer);
        }
    }

    // 1) Check whether release file exists (no early return)
    let releaseFileExists = true;
    try {
        await fs.promises.access(RELEASE_NAME_FILE_PATH, fs.constants.F_OK);
    } catch {
        releaseFileExists = false;
        console.info(
            `[ruffle] Release file not found at "${RELEASE_NAME_FILE_PATH}". Will create it.`
        );
    }

    // 2) Read local release tag (if file exists)
    let localTag = null;
    if (releaseFileExists) {
        try {
            localTag = (await fs.promises.readFile(RELEASE_NAME_FILE_PATH, "utf8")).trim() || null;
        } catch (err) {
            console.warn(`[ruffle] Failed to read local release file: ${err.message}`);
            localTag = null;
        }
    }

    // 3) Fetch latest prerelease tag from GitHub (fallback to localTag on failure)
    const latestTag = await getLatestPrereleaseTag(localTag);

    // If we couldn't get anything at all, we can't compare or write
    if (!latestTag) return;

    // 4) Compare
    const matches = !!localTag && localTag === latestTag;

    // 5) Write latest tag unless it matches
    if (!matches) {
        try {
            await fs.promises.mkdir(path.dirname(RELEASE_NAME_FILE_PATH), { recursive: true });
            await fs.promises.writeFile(RELEASE_NAME_FILE_PATH, `${latestTag}\n`, "utf8");
        } catch (err) {
            console.warn(`[ruffle] Failed to write latest release file: ${err.message}`);
        }
    }

    // Return update JSON ONLY if there is a real mismatch (localTag existed and differs)
    const shouldUpdate = !!localTag && localTag !== latestTag;
    if (!shouldUpdate) return;

    const assetName = buildUniversalAssetName(latestTag);
    const link = `https://github.com/ruffle-rs/ruffle/releases/download/${latestTag}/${assetName}`;

    return {
        dependencies: {
            ruffle: {
                universal: {
                    link,
                    unzip: true,
                },
            },
        },
    };
}

exports.checkUpdates = checkUpdates;