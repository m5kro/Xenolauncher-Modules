// Launches the game using NW.js
// Unfortunately, the NW.js instance being used by Xenolauncher doesn't work due to session conflicts :(
// Requires at least one NW.js version to be installed + permission fixes that are applied during the installation process
function launch(gamePath, gameFolder, gameArgs, gameName="game", ui) {
    const path = require("path");
    const { exec } = require("child_process");
    const fs = require("fs");
    const os = require("os");

    // Cheat Menu helpers
    function copyCheatFiles(targetFolder) {
        const pluginsFolder = path.join(targetFolder, "js", "plugins");
        fs.mkdirSync(pluginsFolder, { recursive: true });
        const jsSrc = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "nwjs",
            "deps",
            "cheat-js",
            "Cheat_Menu.js"
        );
        const cssSrc = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "nwjs",
            "deps",
            "cheat-css",
            "Cheat_Menu.css"
        );
        if (fs.existsSync(jsSrc)) fs.copyFileSync(jsSrc, path.join(pluginsFolder, "Cheat_Menu.js"));
        if (fs.existsSync(cssSrc)) fs.copyFileSync(cssSrc, path.join(pluginsFolder, "Cheat_Menu.css"));
    }

    function removeCheatFiles(targetFolder) {
        const pluginsFolder = path.join(targetFolder, "js", "plugins");
        const jsPath = path.join(pluginsFolder, "Cheat_Menu.js");
        const cssPath = path.join(pluginsFolder, "Cheat_Menu.css");
        if (fs.existsSync(jsPath))
            try {
                fs.unlinkSync(jsPath);
            } catch {}
        if (fs.existsSync(cssPath))
            try {
                fs.unlinkSync(cssPath);
            } catch {}
    }

    function modifyMVMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;
        let content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("PluginManager.loadScript('Cheat_Menu.js')")) return false;
        const marker = "PluginManager.setup($plugins);";
        const inject = "\nPluginManager._path= 'js/plugins/';\nPluginManager.loadScript('Cheat_Menu.js');\n";
        if (content.includes(marker)) {
            content = content.replace(marker, marker + inject);
        } else {
            // Append at the end, probably won't work
            content += "\n" + inject;
        }
        fs.writeFileSync(filePath, content, "utf-8");
        return true;
    }

    function unmodifyMVMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;

        let content = fs.readFileSync(filePath, "utf-8");
        const before = content;

        const loadRe = new RegExp(
            String.raw`\s*PluginManager\s*\.\s*loadScript\s*\(\s*(['"])[^'"]*Cheat_Menu\.js\1\s*\)\s*;?\s*`,
            "g"
        );
        content = content.replace(loadRe, "\n");

        const pathRe = /\s*PluginManager\s*\.\s*_path\s*=\s*(['"])js\/plugins\/?\1\s*;?\s*/g;
        content = content.replace(pathRe, "\n");

        if (content !== before) {
            fs.writeFileSync(filePath, content, "utf-8");
            return true;
        }
        return false;
    }

    function modifyMZMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;

        let content;
        try {
            content = fs.readFileSync(filePath, "utf-8");
        } catch (_e) {
            return false;
        }

        const url = "js/plugins/Cheat_Menu.js";
        const re = /const\s+scriptUrls\s*=\s*\[(.*?)\];/s;
        const m = content.match(re);
        if (!m) {
            // scriptUrls array not found
            return false;
        }

        const inner = m[1]; // exact inner content between [ and ], including whitespace/newlines
        if (inner.includes(url)) {
            // already present
            return false;
        }

        // Insert after rmmz_managers.js
        const managersRe = /([ \t]*)"js\/rmmz_managers\.js",(\r?\n)/;
        const newInner = inner.replace(managersRe, (_full, indent, newline) => {
            return `${_full}${indent}"${url}",${newline}`;
        });

        if (newInner === inner) {
            // rmmz_managers.js not found in scriptUrls array
            console.warn("rmmz_managers.js not found in scriptUrls; cannot insert Cheat_Menu.js");
            return false;
        }

        const replacedMatch = m[0].replace(inner, newInner);
        const newContent = content.slice(0, m.index) + replacedMatch + content.slice(m.index + m[0].length);

        try {
            fs.writeFileSync(filePath, newContent, "utf-8");
        } catch (_e) {
            return false;
        }
        return true;
    }

    function unmodifyMZMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;

        let content = fs.readFileSync(filePath, "utf-8");
        const before = content;

        // Find the scriptUrls array and remove any entry that ends with Cheat_Menu.js
        const arrayRe = /const\s+scriptUrls\s*=\s*\[(.*?)\];/s;
        const m = content.match(arrayRe);
        if (!m) return false;

        let inner = m[1];

        inner = inner.replace(/\s*,\s*(['"]).*?Cheat_Menu\.js\1\s*/g, ""); // , '...Cheat_Menu.js'
        inner = inner.replace(/\s*(['"]).*?Cheat_Menu\.js\1\s*,\s*/g, ""); // '...Cheat_Menu.js',
        inner = inner.replace(/\s*(['"]).*?Cheat_Menu\.js\1\s*/g, ""); // only item

        // Clean up stray commas/spaces
        inner = inner
            .replace(/\s*,\s*,/g, ",")
            .replace(/^\s*,\s*/, "")
            .replace(/\s*,\s*$/, "");

        const replaced =
            content.slice(0, m.index) + `const scriptUrls = [${inner}];` + content.slice(m.index + m[0].length);

        if (replaced !== before) {
            fs.writeFileSync(filePath, replaced, "utf-8");
            return true;
        }
        return false;
    }

    function applyCheatMenu(folderPath) {
        const www = path.join(folderPath, "www");
        const isMV = fs.existsSync(www) && fs.lstatSync(www).isDirectory();
        if (isMV) {
            if (modifyMVMainJs(path.join(www, "js", "main.js"))) {
                copyCheatFiles(www);
            } else {
                // Already patched; ensure files are present
                copyCheatFiles(www);
            }
        } else {
            if (modifyMZMainJs(path.join(folderPath, "js", "main.js"))) {
                copyCheatFiles(folderPath);
            } else {
                copyCheatFiles(folderPath);
            }
        }
    }

    function removeCheatMenu(folderPath) {
        const www = path.join(folderPath, "www");
        const isMV = fs.existsSync(www) && fs.lstatSync(www).isDirectory();
        if (isMV) {
            unmodifyMVMainJs(path.join(www, "js", "main.js"));
            removeCheatFiles(www);
        } else {
            unmodifyMZMainJs(path.join(folderPath, "js", "main.js"));
            removeCheatFiles(folderPath);
        }
    }

    // Protection helpers

    function readOrInitPackageJson(pkgPath) {
        if (fs.existsSync(pkgPath)) {
            try {
                return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            } catch {
                // fall through to fresh init if unreadable
            }
        }
        // Create a minimal package.json if missing or invalid
        return { name: "Game" };
    }

    function writePackageJson(pkgPath, pkgObj) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkgObj, null, 4), "utf-8");
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function addChromiumArg(pkg, flag) {
        const cur = pkg["chromium-args"];
        let args = "";

        if (typeof cur === "string") {
            args = cur;
        } else if (Array.isArray(cur)) {
            args = cur.join(" ");
        } else if (cur != null) {
            args = String(cur);
        }

        const re = new RegExp(`(^|\\s)${escapeRegExp(flag)}(?=\\s|$)`);
        if (!re.test(args)) {
            const next = (args || "").trim();
            pkg["chromium-args"] = next ? `${next} ${flag}` : flag;
            return true;
        }

        return false;
    }

    function ensureChromiumArgsField(pkg) {
        if (!("chromium-args" in pkg) || pkg["chromium-args"] == null) {
            pkg["chromium-args"] = "";
            return true;
        }
        return false;
    }

    function removeChromiumArg(pkg, flag, opts = {}) {
        const { allowValue = false } = opts;
        const cur = pkg["chromium-args"];
        let args = "";

        if (typeof cur === "string") {
            args = cur;
        } else if (Array.isArray(cur)) {
            args = cur.join(" ");
        } else if (cur != null) {
            args = String(cur);
        }

        if (!args) return false;

        const flagPattern = allowValue
            ? `${escapeRegExp(flag)}(?:=\\S+)?`
            : `${escapeRegExp(flag)}`;
        const re = new RegExp(`(^|\\s)${flagPattern}(?=\\s|$)`, "g");
        const updated = args.replace(re, " ").replace(/\\s+/g, " ").trim();

        if (updated === (args || "").trim()) return false;

        pkg["chromium-args"] = updated;
        return true;
    }

    function applyProtection(folderPath) {
        const pkgPath = path.join(folderPath, "package.json");
        const pkg = readOrInitPackageJson(pkgPath);

        // Set bg-script = 'bg.js'
        pkg["bg-script"] = "bg.js";

        // Ensure devtools aren't disabled via chromium-args
        ensureChromiumArgsField(pkg);
        removeChromiumArg(pkg, "--disable-devtools", { allowValue: true });

        writePackageJson(pkgPath, pkg);

        // Copy protection scripts next to package.json (root of gameFolder)
        const base = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "nwjs",
            "deps"
        );

        const copies = [
            { src: path.join(base, "bg", "bg.js"), dest: path.join(folderPath, "bg.js") },
            {
                src: path.join(base, "disable-child", "disable-child.js"),
                dest: path.join(folderPath, "disable-child.js"),
            },
            { src: path.join(base, "disable-net", "disable-net.js"), dest: path.join(folderPath, "disable-net.js") },
        ];

        for (const { src, dest } of copies) {
            try {
                if (fs.existsSync(src)) fs.copyFileSync(src, dest);
            } catch (e) {
                console.error("Protection copy failed:", src, "->", dest, e);
            }
        }
    }

    function removeProtection(folderPath) {
        const pkgPath = path.join(folderPath, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                if ("bg-script" in pkg) {
                    delete pkg["bg-script"];
                    writePackageJson(pkgPath, pkg);
                }
            } catch (e) {
                console.error("Failed updating package.json to remove bg-script:", e);
            }
        }

        // Remove the scripts if present
        for (const filename of ["bg.js", "disable-child.js", "disable-net.js"]) {
            const p = path.join(folderPath, filename);
            if (fs.existsSync(p)) {
                try {
                    fs.unlinkSync(p);
                } catch (e) {
                    /* ignore */
                }
            }
        }
    }

    // Pixel Patch helpers
    function patchRpgmGetPixel(gameRoot, enable) {
        const PATCH_BEGIN = "/* RPGM-Launcher getPixel finite patch begin */";
        const PATCH_END = "/* RPGM-Launcher getPixel finite patch end */";

        if (!gameRoot) return false;

        // If a file path was provided, patch relative to its directory
        try {
            if (fs.existsSync(gameRoot) && fs.lstatSync(gameRoot).isFile()) {
                gameRoot = path.dirname(gameRoot);
            }
        } catch {
            // ignore
        }

        function isDir(p) {
            try {
                return fs.existsSync(p) && fs.lstatSync(p).isDirectory();
            } catch {
                return false;
            }
        }

        const jsFolder =
            (isDir(path.join(gameRoot, "js")) && path.join(gameRoot, "js")) ||
            (isDir(path.join(gameRoot, "www", "js")) && path.join(gameRoot, "www", "js"));

        if (!jsFolder) return false;

        const corePath =
            (fs.existsSync(path.join(jsFolder, "rmmz_core.js")) && path.join(jsFolder, "rmmz_core.js")) ||
            (fs.existsSync(path.join(jsFolder, "rpg_core.js")) && path.join(jsFolder, "rpg_core.js"));

        if (!corePath) return false;

        let content;
        try {
            content = fs.readFileSync(corePath, "utf-8");
        } catch {
            return false;
        }

        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const alreadyPatched = content.includes(PATCH_BEGIN) && content.includes(PATCH_END);

        // Remove patch if disabled
        if (!enable) {
            if (!alreadyPatched) return false;
            const blockRe = /[ \t]*\/\*\s*RPGM-Launcher getPixel finite patch begin\s*\*\/[\s\S]*?[ \t]*\/\*\s*RPGM-Launcher getPixel finite patch end\s*\*\/\s*\r?\n?/g;
            const updated = content.replace(blockRe, "");
            if (updated === content) return false;
            try {
                fs.writeFileSync(corePath, updated, "utf-8");
            } catch {
                return false;
            }
            return true;
        }

        // Apply patch if enabled
        if (alreadyPatched) return false;

        const headerRe = /^([ \t]*)Bitmap\.prototype\.getPixel\s*=\s*function\s*\(\s*x\s*,\s*y\s*\)\s*\{\s*$/m;
        const m = content.match(headerRe);
        if (!m) return false;

        const indent = m[1] || "";
        const patchBlock =
            `${indent}    ${PATCH_BEGIN}${newline}` +
            `${indent}    if (!Number.isFinite(x) || !Number.isFinite(y)) {${newline}` +
            `${indent}        return '#000000';${newline}` +
            `${indent}    }${newline}` +
            `${indent}    ${PATCH_END}${newline}`;

        const updated = content.replace(headerRe, (full) => full + newline + patchBlock);

        if (updated === content) return false;

        try {
            fs.writeFileSync(corePath, updated, "utf-8");
        } catch {
            return false;
        }
        return true;
    }

    // Apply/remove getPixel finite patch (default: enabled)
    try {
        const enablePixelPatch = gameArgs ? gameArgs.applyPixelPatch !== false : true;
        patchRpgmGetPixel(gameFolder, enablePixelPatch);
    } catch (e) {
        // Non-RPGMaker games may fail here, which is fine
        console.error("getPixel patching error:", e);
    }

    // Apply or remove Cheat Menu
    try {
        if (gameArgs && gameArgs.cheat) {
            applyCheatMenu(gameFolder);
        } else {
            removeCheatMenu(gameFolder);
        }
    } catch (e) {
        // none rpgmaker games may fail here, which is fine
        console.error("Cheat Menu patching error:", e);
    }

    // Apply/remove protection
    try {
        const disableProtection = !!(gameArgs && gameArgs.disableProtection);
        if (!disableProtection) {
            applyProtection(gameFolder);
        } else {
            removeProtection(gameFolder);
        }
    } catch (e) {
        console.error("Protection setup error:", e);
    }

    if (!gameArgs || !gameArgs.version) {
        gameArgs = { version: "0.106.1" };
    }

    const nwjsPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "nwjs",
        "deps",
        "version",
        gameArgs.version,
        "nwjs-sdk-" + gameArgs.version + "-osx-" + os.arch(),
        "nwjs.app",
        "Contents",
        "MacOS",
        "nwjs"
    );

    // Check package.json in the game directory for a name; if there isn't one then give it one
    const packageJsonPath = path.join(gameFolder, "package.json");
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            if (!packageJson.name || !String(packageJson.name).trim()) {
                packageJson.name = gameName;
                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
            }
        } catch {
            // ignore malformed package.json here
        }
    }

    // Ensure devtools aren't disabled via chromium-args
    // Optionally disable encryption to avoid Safe Storage popup
    try {
        const existed = fs.existsSync(packageJsonPath);
        let pkg;

        if (existed) {
            try {
                pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            } catch {
                // Don't overwrite an unreadable package.json
                pkg = null;
            }
        } else {
            pkg = readOrInitPackageJson(packageJsonPath);
        }

        if (pkg) {
            const changedField = ensureChromiumArgsField(pkg);
            const changedDevtools = removeChromiumArg(pkg, "--disable-devtools", { allowValue: true });

            if (!existed || changedField || changedDevtools ) writePackageJson(packageJsonPath, pkg);
        }
    } catch (e) {
        console.error("Failed to sanitize chromium-args:", e);
    }

    // Launch the game using NW.js
    exec(`"${nwjsPath}" "${gameFolder}"`, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
}
exports.launch = launch;
