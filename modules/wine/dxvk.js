// Thanks to Gcenx for DXVK-macOS builds: https://github.com/Gcenx/DXVK-macOS
// Thanks to doitsujin and DXVK contributors for DXVK: https://github.com/doitsujin/dxvk
async function getAvailable() {
    const url = "https://api.github.com/repos/Gcenx/DXVK-macOS/releases?per_page=100";
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
        if (!release || release.draft || !release.tag_name) continue;

        const assets = Array.isArray(release.assets) ? release.assets : [];
        const asset = assets.find((candidate) => {
            const name = candidate && candidate.name ? String(candidate.name) : "";
            return (
                /^dxvk-macOS-.*\.tar\.gz$/i.test(name) &&
                !/builtin/i.test(name) &&
                !/crossover/i.test(name) &&
                candidate.browser_download_url
            );
        });

        if (!asset) continue;

        out[release.tag_name] = {
            universal: {
                link: asset.browser_download_url,
                unzip: true,
            },
        };
    }

    return out;
}

exports.getAvailable = getAvailable;
