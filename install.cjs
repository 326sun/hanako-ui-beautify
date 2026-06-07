#!/usr/bin/env node
/**
 * Install Hana UI Beautify as a community Hanako plugin.
 *
 * This installs the plugin into ~/.hanako/plugins/hanako-ui-beautify.
 * The plugin itself applies/restores the renderer CSS patch when enabled.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PLUGIN_NAME = "hanako-ui-beautify";
const PLUGIN_SRC = __dirname;
const PLUGIN_DEST = path.join(os.homedir(), ".hanako", "plugins", PLUGIN_NAME);
const NODE_MODULES_SRC = path.join(PLUGIN_SRC, "node_modules");
const FONTS_SRC = path.join(PLUGIN_SRC, "fonts");

console.log("Hana UI Beautify - plugin installer");
console.log("=".repeat(50));

// ── Prerequisite checks ──
console.log("\n[1/5] Check dependencies...");
if (!fs.existsSync(path.join(NODE_MODULES_SRC, "@electron", "asar"))) {
  console.error("  Missing @electron/asar. Run npm install in the plugin directory first.");
  process.exit(1);
}
if (!fs.existsSync(path.join(FONTS_SRC, "harmonyos-sans-sc-regular.woff2"))) {
  console.error("  Missing HarmonyOS Sans SC fonts. Expected fonts/*.woff2.");
  process.exit(1);
}
console.log("  Dependencies found");

// ── Syntax check ──
console.log("\n[2/5] Syntax check before install...");
const JS_FILES = [
  "index.js",
  "lib/beautify-core.js",
  "lib/hana-runtime-compat.js",
  "tools/status.js",
  "tools/apply.js",
  "tools/restore.js",
];
let syntaxOk = true;
for (const file of JS_FILES) {
  const fullPath = path.join(PLUGIN_SRC, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`  MISS  ${file}`);
    syntaxOk = false;
    continue;
  }
  try {
    execSync(`node --check "${fullPath}"`, { stdio: "pipe" });
    console.log(`  OK    ${file}`);
  } catch (err) {
    console.log(`  FAIL  ${file}: ${err.stderr?.toString().trim() || err.message}`);
    syntaxOk = false;
  }
}

// Validate manifest.json
try {
  JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, "manifest.json"), "utf-8"));
  console.log("  OK    manifest.json (valid JSON)");
} catch (err) {
  console.log(`  FAIL  manifest.json: ${err.message}`);
  syntaxOk = false;
}

// Version consistency
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, "manifest.json"), "utf-8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, "package.json"), "utf-8"));
  if (manifest.version !== pkg.version) {
    console.log(`  WARN  version mismatch: manifest=${manifest.version}, package=${pkg.version}`);
  } else {
    console.log(`  OK    version consistent: ${manifest.version}`);
  }
} catch (err) {
  console.log(`  WARN  version consistency check failed: ${err.message}`);
}

if (!syntaxOk) {
  console.error("\nSyntax errors found. Fix them before installing.");
  process.exit(1);
}

// ── Clean ──
console.log("\n[3/5] Clean old install...");
if (fs.existsSync(PLUGIN_DEST)) {
  fs.rmSync(PLUGIN_DEST, { recursive: true, force: true });
  console.log("  Removed old version");
}

// ── Copy ──
console.log("\n[4/5] Copy plugin...");
const filesToCopy = ["manifest.json", "index.js", "theme.css", "package.json", "README.md", "INSTALL.md", "LICENSE"];
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

// ── Verify deployed files ──
console.log("\n[5/5] Verify...");
const checks = [
  "package.json",
  "README.md",
  "INSTALL.md",
  "LICENSE",
  "manifest.json",
  "index.js",
  "theme.css",
  "fonts/harmonyos-sans-sc-regular.woff2",
  "fonts/LICENSE_Fonts",
  "lib/beautify-core.js",
  "lib/hana-runtime-compat.js",
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
  console.log("By default the plugin only checks status. Use the apply tool to apply the patch.");
  console.log("If autoApply is enabled and Hanako's resources folder is writable, the plugin applies in the background.");
  console.log("If Windows blocks Program Files writes, run Hanako once as administrator or use the apply tool from an elevated session.");
} else {
  console.log("Installation incomplete. Check the missing files above.");
  process.exitCode = 1;
}
