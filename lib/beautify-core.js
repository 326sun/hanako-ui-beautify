import fs from "fs";
import path from "path";
import os from "os";
import * as asar from "@electron/asar";

export const PLUGIN_VERSION = "0.1.1";
export const INLINE_BEGIN = "/* hana-beautify:begin */";
export const INLINE_END = "/* hana-beautify:end */";

export function defaultHanakoDir() {
  if (process.env.HANAKO_INSTALL_DIR) return process.env.HANAKO_INSTALL_DIR;
  const candidates = ["C:\\Program Files\\HanaAgent", "C:\\Program Files\\Hanako"];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "resources", "app.asar"))) return dir;
  }
  return candidates[0];
}

export function resolvePaths(pluginDir, input = {}) {
  const hanakoDir = input.hanakoInstallDir || defaultHanakoDir();
  return {
    hanakoDir,
    resourcesDir: path.join(hanakoDir, "resources"),
    asarPath: path.join(hanakoDir, "resources", "app.asar"),
    backupPath: path.join(hanakoDir, "resources", "app.asar.bak"),
    tempDir: path.join(os.tmpdir(), `hana-ui-beautify-${Date.now()}`),
    tempAsarPath: path.join(os.tmpdir(), `hana-ui-beautify-${Date.now()}.asar`),
    themePath: path.join(pluginDir, "theme.css"),
    fontsDir: path.join(pluginDir, "fonts"),
  };
}

export function canWriteResources(resourcesDir) {
  try {
    fs.accessSync(resourcesDir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function stripPreviousInjection(css) {
  return css
    .replace(/^@import\s+url\(['"]\.\/themes\/hana-beautify\.css['"]\);\r?\n?/m, "")
    .replace(new RegExp(`${escapeRegExp(INLINE_BEGIN)}[\\s\\S]*?${escapeRegExp(INLINE_END)}\\r?\\n?`, "g"), "");
}

export function buildInlineThemeCss(themePath) {
  return fs.readFileSync(themePath, "utf-8")
    .replaceAll("url('./fonts/", "url('./themes/fonts/")
    .replaceAll("url(\"./fonts/", "url(\"./themes/fonts/");
}

export function findFiles(dir, filename) {
  const results = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === filename) results.push(full);
    }
  }
  walk(dir);
  return results;
}

export function getStatus(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  const status = {
    pluginVersion: PLUGIN_VERSION,
    hanakoDir: paths.hanakoDir,
    asarPath: paths.asarPath,
    backupPath: paths.backupPath,
    exists: fs.existsSync(paths.asarPath),
    backupExists: fs.existsSync(paths.backupPath),
    canWrite: canWriteResources(paths.resourcesDir),
    applied: false,
    markerCount: 0,
    fontFiles: [],
    error: null,
    needsRestart: false,
  };

  try {
    if (fs.existsSync(paths.fontsDir)) {
      status.fontFiles = fs.readdirSync(paths.fontsDir).filter((name) => name.endsWith(".woff2"));
    }
    if (status.exists) {
      const packageFiles = asar.listPackage(paths.asarPath);
      const stylesPath = packageFiles.find((file) => file.replaceAll("\\", "/").endsWith("/styles.css"));
      if (!stylesPath) throw new Error("styles.css not found in app.asar");
      const extractPath = stylesPath.replace(/^[\\/]+/, "");
      const styles = asar.extractFile(paths.asarPath, extractPath).toString("utf-8");
      status.markerCount = (styles.match(new RegExp(escapeRegExp(INLINE_BEGIN), "g")) || []).length;
      status.applied = status.markerCount > 0;
    }
  } catch (err) {
    status.error = err.message;
  }
  return status;
}

export async function applyBeautify(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  const before = await getStatus(pluginDir, input);
  if (!before.exists) throw new Error(`app.asar not found: ${paths.asarPath}`);
  if (!before.canWrite) {
    throw new Error(`No write permission for ${paths.resourcesDir}. Run Hanako as administrator once, or apply with an elevated installer.`);
  }
  if (before.applied && !input.force) {
    return { ok: true, changed: false, status: before, message: "Beautify is already applied." };
  }

  if (!fs.existsSync(paths.backupPath)) {
    fs.copyFileSync(paths.asarPath, paths.backupPath);
  }

  if (fs.existsSync(paths.tempDir)) fs.rmSync(paths.tempDir, { recursive: true, force: true });
  fs.mkdirSync(paths.tempDir, { recursive: true });

  try {
    asar.extractAll(paths.asarPath, paths.tempDir);
    const stylesCssPaths = findFiles(paths.tempDir, "styles.css");
    if (stylesCssPaths.length === 0) throw new Error("styles.css not found in app.asar");

    const fontFiles = fs.readdirSync(paths.fontsDir).filter((name) => name.endsWith(".woff2"));
    for (const cssPath of stylesCssPaths) {
      let css = fs.readFileSync(cssPath, "utf-8");
      css = stripPreviousInjection(css);
      css = `${css.trimEnd()}\n\n${INLINE_BEGIN}\n${buildInlineThemeCss(paths.themePath)}\n${INLINE_END}\n`;
      fs.writeFileSync(cssPath, css, "utf-8");

      const themesDir = path.join(path.dirname(cssPath), "themes");
      const targetFontsDir = path.join(themesDir, "fonts");
      fs.mkdirSync(targetFontsDir, { recursive: true });
      fs.copyFileSync(paths.themePath, path.join(themesDir, "hana-beautify.css"));
      for (const file of fontFiles) {
        fs.copyFileSync(path.join(paths.fontsDir, file), path.join(targetFontsDir, file));
      }
    }

    // Repack to a temp file first — if this fails the original asar is untouched.
    await asar.createPackageWithOptions(paths.tempDir, paths.tempAsarPath, {});

    // Integrity check: verify the repacked asar is readable before deploying.
    try {
      asar.listPackage(paths.tempAsarPath);
    } catch (verifyErr) {
      throw new Error(`Repacked asar failed integrity check: ${verifyErr.message}. Original app.asar is untouched.`);
    }

    fs.copyFileSync(paths.tempAsarPath, paths.asarPath);

    // Double-check the deployed asar on disk.
    try {
      asar.listPackage(paths.asarPath);
    } catch (deployErr) {
      // Deploy failed — attempt automatic rollback if backup exists.
      if (fs.existsSync(paths.backupPath)) {
        fs.copyFileSync(paths.backupPath, paths.asarPath);
        throw new Error(`Deployed asar is corrupt; rolled back from backup. Cause: ${deployErr.message}`);
      }
      throw new Error(`Deployed asar is corrupt and no backup to roll back. Cause: ${deployErr.message}`);
    }

    fs.rmSync(paths.tempAsarPath, { force: true });
  } finally {
    fs.rmSync(paths.tempDir, { recursive: true, force: true });
    try { fs.rmSync(paths.tempAsarPath, { force: true }); } catch {}
  }

  const after = await getStatus(pluginDir, input);
  after.needsRestart = true;
  return { ok: true, changed: true, status: after, message: "Beautify applied. Restart Hanako or reload the main window to see the updated renderer assets." };
}

export async function restoreBeautify(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  if (!fs.existsSync(paths.backupPath)) throw new Error(`Backup not found: ${paths.backupPath}`);
  if (!canWriteResources(paths.resourcesDir)) {
    throw new Error(`No write permission for ${paths.resourcesDir}. Run Hanako as administrator once, or restore with an elevated installer.`);
  }
  fs.copyFileSync(paths.backupPath, paths.asarPath);
  const status = await getStatus(pluginDir, input);
  status.needsRestart = true;
  return { ok: true, changed: true, status, message: "Beautify restored from app.asar.bak. Restart Hanako to see the original renderer assets." };
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
