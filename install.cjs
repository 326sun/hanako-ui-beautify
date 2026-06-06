#!/usr/bin/env node
/**
 * Install Hana UI Beautify as a community Hanako plugin.
 *
 * This installs the plugin into ~/.hanako/plugins/hana-ui-beautify.
 * The plugin itself applies/restores the renderer CSS patch when enabled.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const PLUGIN_NAME = "hana-ui-beautify";
const PLUGIN_SRC = __dirname;
const PLUGIN_DEST = path.join(os.homedir(), ".hanako", "plugins", PLUGIN_NAME);
const NODE_MODULES_SRC = path.join(PLUGIN_SRC, "node_modules");
const FONTS_SRC = path.join(PLUGIN_SRC, "fonts");

console.log("Hana UI Beautify - plugin installer");
console.log("=".repeat(50));

console.log("\n[1/4] Check dependencies...");
if (!fs.existsSync(path.join(NODE_MODULES_SRC, "@electron", "asar"))) {
  console.error("  Missing @electron/asar. Run npm install in the plugin directory first.");
  process.exit(1);
}
if (!fs.existsSync(path.join(FONTS_SRC, "harmonyos-sans-sc-regular.woff2"))) {
  console.error("  Missing HarmonyOS Sans SC fonts. Expected fonts/*.woff2.");
  process.exit(1);
}
console.log("  Dependencies found");

console.log("\n[2/4] Clean old install...");
if (fs.existsSync(PLUGIN_DEST)) {
  fs.rmSync(PLUGIN_DEST, { recursive: true, force: true });
  console.log("  Removed old version");
}

console.log("\n[3/4] Copy plugin...");
const filesToCopy = ["manifest.json", "index.js", "theme.css", "package.json"];
const dirsToCopy = ["lib", "tools"];
fs.mkdirSync(PLUGIN_DEST, { recursive: true });
for (const file of filesToCopy) {
  fs.copyFileSync(path.join(PLUGIN_SRC, file), path.join(PLUGIN_DEST, file));
}
for (const dir of dirsToCopy) {
  fs.cpSync(path.join(PLUGIN_SRC, dir), path.join(PLUGIN_DEST, dir), { recursive: true });
}
fs.cpSync(FONTS_SRC, path.join(PLUGIN_DEST, "fonts"), { recursive: true });
fs.cpSync(NODE_MODULES_SRC, path.join(PLUGIN_DEST, "node_modules"), { recursive: true });
console.log(`  Installed to ${PLUGIN_DEST}`);

console.log("\n[4/4] Verify...");
const checks = [
  "package.json",
  "manifest.json",
  "index.js",
  "theme.css",
  "fonts/harmonyos-sans-sc-regular.woff2",
  "fonts/LICENSE_Fonts",
  "lib/beautify-core.js",
  "tools/status.js",
  "tools/apply.js",
  "tools/restore.js",
  "node_modules/@electron/asar/package.json",
];
let ok = true;
for (const check of checks) {
  if (fs.existsSync(path.join(PLUGIN_DEST, check))) {
    console.log(`  OK    ${check}`);
  } else {
    console.log(`  MISS  ${check}`);
    ok = false;
  }
}

console.log("\n" + "=".repeat(50));
if (ok) {
  console.log("Hana UI Beautify plugin installed.");
  console.log("");
  console.log("To use:");
  console.log("  1. Restart Hanako");
  console.log("  2. Settings > Plugins > Enable 'Allow full-access plugins'");
  console.log("  3. Enable 'Hana UI Beautify'");
  console.log("");
  console.log("The plugin auto-applies when enabled if Hanako's resources folder is writable.");
  console.log("If Windows blocks Program Files writes, run Hanako once as administrator or use the apply tool from an elevated session.");
} else {
  console.log("Installation incomplete. Check the missing files above.");
  process.exitCode = 1;
}
