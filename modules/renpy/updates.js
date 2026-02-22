async function checkUpdates() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const { exec } = require("child_process");

    const timeoutMs = 3000;

    function normalizeVersion(version) {
        const m = String(version || "").match(/(\d+)\.(\d+)\.(\d+)/);
        if (!m) return null;
        return `${m[1]}.${m[2]}.${m[3]}`;
    }

    function compareVersions(a, b) {
        const pa = a.split(".").map((n) => Number(n));
        const pb = b.split(".").map((n) => Number(n));

        for (let i = 0; i < 3; i += 1) {
            if (pa[i] > pb[i]) return 1;
            if (pa[i] < pb[i]) return -1;
        }
        return 0;
    }

    function getInstalledVersion() {
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
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            exec(`"${renpyPath}" --version`, { timeout: timeoutMs }, (err, stdout, stderr) => {
                if (err) {
                    resolve(null);
                    return;
                }

                const out = `${stdout || ""}\n${stderr || ""}`;
                resolve(normalizeVersion(out));
            });
        });
    }

    async function getLatestVersion() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch("https://www.renpy.org/release_list.html", {
                signal: controller.signal,
                headers: {
                    "User-Agent": "xenolauncher",
                },
            });

            if (!res.ok) {
                return null;
            }

            const html = await res.text();
            const matches = [...html.matchAll(/Ren'Py\s+(\d+\.\d+\.\d+)/g)].map((m) => m[1]);

            if (!matches.length) {
                return null;
            }

            let latest = normalizeVersion(matches[0]);
            if (!latest) return null;

            for (const candidate of matches) {
                const normalized = normalizeVersion(candidate);
                if (!normalized) continue;
                if (compareVersions(normalized, latest) > 0) {
                    latest = normalized;
                }
            }

            return latest;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    const installedVersion = await getInstalledVersion();
    const latestVersion = await getLatestVersion();

    if (!installedVersion || !latestVersion) {
        return;
    }

    if (compareVersions(latestVersion, installedVersion) <= 0) {
        return;
    }

    return {
        renpy: {
            universal: {
                link: `https://www.renpy.org/dl/${latestVersion}/renpy-${latestVersion}-sdk.zip`,
                unzip: true,
            },
        },
    };
}

exports.checkUpdates = checkUpdates;
