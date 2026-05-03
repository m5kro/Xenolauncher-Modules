async function getAvailable() {
    const url = "https://api.github.com/repos/Gcenx/macOS_Wine_builds/releases?per_page=100";
    const res = await fetch(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "xenolauncher",
        },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const releases = await res.json();
    const out = {};
    const priority = { staging: 0, devel: 1, stable: 2 };

    for (const release of releases || []) {
        if (!release || release.draft) continue;

        const tag = release.tag_name;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        if (!tag || assets.length === 0) continue;

        const candidates = assets
            .map((asset) => {
                const name = asset && asset.name ? String(asset.name) : "";
                const match = name.match(/^wine-(staging|devel|stable)-.+-osx64\.tar\.xz$/i);
                if (!match || !asset.browser_download_url) return null;
                const channel = match[1].toLowerCase();
                return {
                    channel,
                    link: asset.browser_download_url,
                };
            })
            .filter(Boolean)
            .sort((a, b) => priority[a.channel] - priority[b.channel]);

        if (!candidates.length) continue;

        out[tag] = {
            universal: {
                link: candidates[0].link,
                unzip: true,
            },
        };
    }

    return out;
}

exports.getAvailable = getAvailable;
