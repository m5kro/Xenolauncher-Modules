// Manages Wine prefixes for games launched with the wine module
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const METADATA_FILE = ".xenolauncher-wine.json";
const MANAGED_BY = "xenolauncher-wine";

function expandTilde(value) {
    if (typeof value !== "string") return value;
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return value;
}

function getPrefixRoot() {
    return path.join(os.homedir(), "Library", "Application Support", "xenolauncher", "wine", "prefixes");
}

function safeName(gameName, gamePath) {
    const fallback = gamePath ? path.basename(gamePath, path.extname(gamePath)) : "game";
    const raw = String(gameName || fallback || "game").trim();
    const safe = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
    return safe || "game";
}

// Just to make sure no collisions happen
function shortHash(value) {
    return crypto.createHash("sha1").update(String(value || "game")).digest("hex").slice(0, 8);
}

function getAutomaticPrefix(gameName, gameFolder, gamePath) {
    const key = gameFolder || gamePath || gameName || "game";
    return path.join(getPrefixRoot(), `${safeName(gameName, gamePath)}-${shortHash(key)}`);
}

function resolvePrefix(gameArgs, gameName, gameFolder, gamePath) {
    const customPrefix = gameArgs && typeof gameArgs.winePrefix === "string" ? gameArgs.winePrefix.trim() : "";
    if (customPrefix) {
        return {
            prefixPath: expandTilde(customPrefix),
            automatic: false,
        };
    }

    return {
        prefixPath: getAutomaticPrefix(gameName, gameFolder, gamePath),
        automatic: true,
    };
}

function getMetadataPath(prefixPath) {
    return path.join(prefixPath, METADATA_FILE);
}

function readMetadata(prefixPath) {
    try {
        const metadataPath = getMetadataPath(prefixPath);
        if (!fs.existsSync(metadataPath)) return null;
        return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch (error) {
        console.warn("Failed to read Wine prefix metadata:", error);
        return null;
    }
}

function writeMetadata(prefixPath, nextMetadata) {
    const metadataPath = getMetadataPath(prefixPath);
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    const tmpPath = `${metadataPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(nextMetadata, null, 2), "utf8");
    fs.renameSync(tmpPath, metadataPath);
}

function isValidPrefix(prefixPath) {
    return fs.existsSync(path.join(prefixPath, "drive_c")) && fs.existsSync(path.join(prefixPath, "user.reg"));
}

module.exports = {
    MANAGED_BY,
    METADATA_FILE,
    getAutomaticPrefix,
    getMetadataPath,
    isValidPrefix,
    readMetadata,
    resolvePrefix,
    writeMetadata,
};
