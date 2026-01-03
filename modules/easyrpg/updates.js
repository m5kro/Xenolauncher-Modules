async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const branch = "dev";
    const timeoutMs = 1000;

    const BUILD_FILE_PATH = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "easyrpg",
        "deps",
        "easyrpg-build.txt"
    );

    async function getLatestBuild(fallbackBuild) {
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

            console.info(`[easyrpg] Latest build number: ${n}`);
            return String(n);
        } catch (err) {
            console.error(`[easyrpg] Failed to fetch latest build number: ${err.message}`);
            // On failure, fall back to last known build number (local file)
            return fallbackBuild ?? null;
        } finally {
            clearTimeout(timer);
        }
    }

    // 1) Check whether BUILD file exists (no early return)
    let buildFileExists = true;
    try {
        await fs.promises.access(BUILD_FILE_PATH, fs.constants.F_OK);
    } catch {
        buildFileExists = false;
        console.info(`[easyrpg] BUILD file not found at "${BUILD_FILE_PATH}". Will create it.`);
    }

    // 2) Read local BUILD (if file exists)
    let localBuild = null;
    if (buildFileExists) {
        try {
            localBuild = (await fs.promises.readFile(BUILD_FILE_PATH, "utf8")).trim() || null;
        } catch (err) {
            console.warn(`[easyrpg] Failed to read local BUILD file: ${err.message}`);
            localBuild = null;
        }
    }

    // 3) Fetch latest BUILD from EasyRPG servers (fallback to localBuild on failure)
    const latestBuild = await getLatestBuild(localBuild);

    // If we couldn't get anything at all, we can't compare or write
    if (!latestBuild) return;

    // 4) Compare
    const matches = !!localBuild && localBuild === latestBuild;

    // 5) Write latest BUILD unless it matches
    if (!matches) {
        try {
            await fs.promises.mkdir(path.dirname(BUILD_FILE_PATH), { recursive: true });
            await fs.promises.writeFile(BUILD_FILE_PATH, `${latestBuild}\n`, "utf8");
        } catch (err) {
            console.warn(`[easyrpg] Failed to write latest BUILD file: ${err.message}`);
        }
    }

    // Return update JSON ONLY if there is a real mismatch (localBuild existed and differs)
    const shouldUpdate = !!localBuild && localBuild !== latestBuild;
    if (!shouldUpdate) return;

    return {
        easyrpg: {
            universal: {
                link: "https://ci.easyrpg.org/downloads/macos/EasyRPG-Player-macos.app.zip",
                unzip: true,
            },
        }
    };
}

exports.checkUpdates = checkUpdates;
