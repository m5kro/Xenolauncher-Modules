// Thanks to KhronosGroup and MoltenVK contributors: https://github.com/KhronosGroup/MoltenVK
async function getAvailable() {
    const url = "https://api.github.com/repos/KhronosGroup/MoltenVK/releases?per_page=100";
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

    for (const release of releases || []) {
        if (!release || release.draft || release.prerelease || !release.tag_name) continue;
        if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
        if (/-rc/i.test(release.tag_name)) continue;

        const assets = Array.isArray(release.assets) ? release.assets : [];
        const asset = assets.find((candidate) => {
            const name = candidate && candidate.name ? String(candidate.name) : "";
            return name === "MoltenVK-macos-privateapi.tar" && candidate.browser_download_url;
        });

        if (!asset) continue;

        out[`${release.tag_name}-privateapi`] = {
            universal: {
                link: asset.browser_download_url,
                unzip: true,
            },
        };
    }

    return out;
}

exports.getAvailable = getAvailable;
