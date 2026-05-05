async function getAvailable() {
    const [gcenx, winecx] = await Promise.all([getGcenxWineBuilds(), getWineCxBuilds()]);
    return { ...winecx, ...gcenx };
}

async function fetchGithubReleases(url) {
    const res = await fetch(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "xenolauncher",
        },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    return await res.json();
}

async function getGcenxWineBuilds() {
    const releases = await fetchGithubReleases(
        "https://api.github.com/repos/Gcenx/macOS_Wine_builds/releases?per_page=100"
    );
    const out = {};

    for (const release of releases || []) {
        if (!release || release.draft) continue;

        const tag = release.tag_name;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        if (!tag || assets.length === 0) continue;

        for (const asset of assets) {
            const name = asset && asset.name ? String(asset.name) : "";
            const match = name.match(/^wine-(staging|devel|stable)-.+-osx64\.tar\.xz$/i);
            if (!match || !asset.browser_download_url) continue;

            const channel = match[1].toLowerCase();
            out[`${tag}-${channel}`] = {
                universal: {
                    link: asset.browser_download_url,
                    unzip: true,
                },
            };
        }
    }

    return out;
}

async function getWineCxBuilds() {
    const releases = await fetchGithubReleases(
        "https://api.github.com/repos/srimanachanta/winecx-dist/releases?per_page=100"
    );
    const out = {};

    for (const release of releases || []) {
        if (!release || release.draft) continue;

        const assets = Array.isArray(release.assets) ? release.assets : [];
        for (const asset of assets) {
            const name = asset && asset.name ? String(asset.name) : "";
            const match = name.match(/^winecx-(.+)-osx64\.tar\.gz$/i);
            if (!match || !asset.browser_download_url) continue;

            out[`${match[1]}-crossover`] = {
                universal: {
                    link: asset.browser_download_url,
                    unzip: true,
                },
            };
        }
    }

    return out;
}

exports.getAvailable = getAvailable;
