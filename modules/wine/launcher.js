// Use wine to launch Windows applications
// Thanks to Gcenx for prebuilt Wine binaries: https://github.com/Gcenx/macOS_Wine_builds
// TODO:
// DXVK dll overrides (currently experiencing major graphical issues, I'm probably doing something wrong)
// Custom prefix per game
// Handle installers
// Multiple Wine versions
// Winetricks to make everything a bit easier
function launch(gamePath, gameFolder, gameArgs) {
    const path = require("path");
    const { exec } = require("child_process");
    const fs = require("fs");
    const os = require("os");

    const arch = os.arch();

    // Wine Binary is only x86_64 (intel) so rosetta2 is required on Apple Silicon
    const wineBinary = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "wine",
            "deps",
            "version",
            "11.0-rc4",
            "Wine Staging.app",
            "Contents",
            "MacOS",
            "wine"
        );
    
    // Will be replaced with per-game prefix later
    const winePrefix = path.join(
            os.homedir(),
            ".wine"
        );
    
    if (!fs.existsSync(wineBinary)) {
        console.error(`Wine binary not found at ${wineBinary}`);
    }

    if (!fs.existsSync(winePrefix)) {
        // Create default wine prefix with wineboot
        const winebootBinary = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "wine",
            "deps",
            "version",
            "11.0-rc4",
            "Wine Staging.app",
            "Contents",
            "Resources",
            "wine",
            "bin",
            "wineboot"
        );
        if (arch === "arm64") {
            console.log("Apple Silicon detected, using rosetta2 to initialize wine prefix");
            exec(`"arch -x86_64 ${winebootBinary}" --init`, { env: { WINEPREFIX: winePrefix } }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error initializing wine prefix: ${error.message}`);
                    return;
                }
                console.log(`Wine prefix initialized at ${winePrefix}`);
            });
        } else {
            console.log("Intel architecture detected, initializing wine prefix normally");
            exec(`"${winebootBinary}" --init`, { env: { WINEPREFIX: winePrefix } }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error initializing wine prefix: ${error.message}`);
                    return;
                }
                console.log(`Wine prefix initialized at ${winePrefix}`);
            });
        }
    }

    // Launch the game, gameArgs currently not used
    if (arch === "arm64") {
        console.log("Apple Silicon detected, using rosetta2 to launch the game");
        exec(`arch --x86_64 "${wineBinary}" "${gamePath}"`, { env: { WINEPREFIX: winePrefix } }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error launching game: ${error.message}`);
                return;
            }
            console.log(`Game launched: ${gamePath}`);
        });
    } else {
        console.log("Intel architecture detected, launching the game normally");
        exec(`"${wineBinary}" "${gamePath}"`, { env: { WINEPREFIX: winePrefix } }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error launching game: ${error.message}`);
                return;
            }
            console.log(`Game launched: ${gamePath}`);
        });
    }
    
}
exports.launch = launch;