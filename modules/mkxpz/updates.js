async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const branch = "dev";
    const timeoutMs = 1000;

    const SHA_FILE_PATH = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "mkxpz",
        "deps",
        "mkxpz-sha.txt"
    );

    async function getLatestSha(fallbackSha) {
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
            // On failure, fall back to last known SHA (local file)
            return fallbackSha ?? null;
        } finally {
            clearTimeout(timer);
        }
    }

    // 1) Check whether SHA file exists (no early return)
    let shaFileExists = true;
    try {
        await fs.promises.access(SHA_FILE_PATH, fs.constants.F_OK);
    } catch {
        shaFileExists = false;
        console.info(`[mkxpz] SHA file not found at "${SHA_FILE_PATH}". Will create it.`);
    }

    // 2) Read local SHA (if file exists)
    let localSha = null;
    if (shaFileExists) {
        try {
            localSha = (await fs.promises.readFile(SHA_FILE_PATH, "utf8")).trim() || null;
        } catch (err) {
            console.warn(`[mkxpz] Failed to read local SHA file: ${err.message}`);
            localSha = null;
        }
    }

    // 3) Fetch latest SHA from GitHub (fallback to localSha on failure)
    const latestSha = await getLatestSha(localSha);

    // If we couldn't get anything at all, we can't compare or write
    if (!latestSha) return;

    // 4) Compare
    const matches = !!localSha && localSha === latestSha;

    // 5) Write latest SHA unless it matches
    if (!matches) {
        try {
            await fs.promises.mkdir(path.dirname(SHA_FILE_PATH), { recursive: true });
            await fs.promises.writeFile(SHA_FILE_PATH, `${latestSha}\n`, "utf8");
        } catch (err) {
            console.warn(`[mkxpz] Failed to write latest SHA file: ${err.message}`);
        }
    }

    // Return update JSON ONLY if there is a real mismatch (localSha existed and differs)
    const shouldUpdate = !!localSha && localSha !== latestSha;
    if (!shouldUpdate) return;

    return {
        mkxpz: {
            universal: {
                link: "https://github.com/m5kro/mkxp-z/releases/download/launcher/Z-universal.zip",
                unzip: true,
            },
        }
    };
}

exports.checkUpdates = checkUpdates;
