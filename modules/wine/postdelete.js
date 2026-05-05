// Cleans up prefix after game deletion
async function postDelete(gameName, gameFolder, gamePath, ui) {
    const fs = require("fs");
    const {
        MANAGED_BY,
        getAutomaticPrefix,
        readMetadata,
    } = require("./prefix.js");

    const prefixPath = getAutomaticPrefix(gameName, gameFolder, gamePath);
    if (!fs.existsSync(prefixPath)) return;

    const metadata = readMetadata(prefixPath);
    const isManagedAutomaticPrefix =
        metadata && metadata.managedBy === MANAGED_BY && metadata.automaticPrefix === true;

    if (!isManagedAutomaticPrefix) {
        console.warn(`Skipping Wine prefix cleanup for unmanaged prefix: ${prefixPath}`);
        return;
    }

    try {
        fs.rmSync(prefixPath, { recursive: true, force: true });
        console.log(`Removed Wine prefix: ${prefixPath}`);
    } catch (error) {
        console.error(`Failed to remove Wine prefix ${prefixPath}:`, error);
        if (ui && typeof ui.alert === "function") {
            await ui.alert(`Failed to remove Wine prefix: ${error.message}`, "Wine Cleanup Error");
        }
    }
}

exports.postDelete = postDelete;
