import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as asar from "@electron/asar";

function readPluginVersion(pluginDir) {
  try {
    const manifestPath = path.join(pluginDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      return manifest.version || "0.1.0";
    }
  } catch {}
  return "0.1.0";
}

// 延迟求值：首次访问时从 manifest.json 读取，避免硬编码与 manifest/package.json 不同步
export let PLUGIN_VERSION;
export function initPluginVersion(pluginDir) {
  PLUGIN_VERSION = readPluginVersion(pluginDir);
  return PLUGIN_VERSION;
}
export const INLINE_BEGIN = "/* hana-beautify:begin */";
export const INLINE_END = "/* hana-beautify:end */";
export const SOURCE_HASH_PREFIX = "/* hana-beautify:source-sha256=";

export function defaultHanakoDir() {
  if (process.env.HANAKO_INSTALL_DIR) return process.env.HANAKO_INSTALL_DIR;
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Hanako", "C:\\Program Files\\HanaAgent");
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Hanako.app");
  } else {
    candidates.push("/opt/hanako", path.join(os.homedir(), ".local/share/hanako"));
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "resources", "app.asar"))) return dir;
  }
  return candidates[0];
}

export function resolvePaths(pluginDir, input = {}) {
  const hanakoDir = input.hanakoInstallDir || defaultHanakoDir();
  const runId = `${process.pid}-${Date.now()}`;
  const resourcesDir = path.join(hanakoDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const currentHash = fs.existsSync(asarPath) ? hashFile(asarPath) : null;
  const backupDir = path.join(resourcesDir, ".hana-beautify-backups");
  return {
    hanakoDir,
    resourcesDir,
    asarPath,
    backupDir,
    backupPath: currentHash ? path.join(backupDir, `app.asar.${currentHash.slice(0, 16)}.bak`) : path.join(resourcesDir, "app.asar.bak"),
    legacyBackupPath: path.join(resourcesDir, "app.asar.bak"),
    lockPath: path.join(resourcesDir, ".hana-beautify.lock"),
    tempDir: path.join(os.tmpdir(), `hana-ui-beautify-${runId}`),
    tempAsarPath: path.join(os.tmpdir(), `hana-ui-beautify-${runId}.asar`),
    themePath: path.join(pluginDir, "theme.css"),
    fontsDir: path.join(pluginDir, "fonts"),
  };
}

export function hashFile(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function readKnownBackups(paths) {
  const backups = [];
  try {
    if (fs.existsSync(paths.backupDir)) {
      for (const name of fs.readdirSync(paths.backupDir)) {
        if (!name.startsWith("app.asar.") || !name.endsWith(".bak")) continue;
        const full = path.join(paths.backupDir, name);
        backups.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
      }
    }
  } catch {}
  try {
    if (fs.existsSync(paths.legacyBackupPath)) {
      backups.push({ path: paths.legacyBackupPath, legacy: true, mtimeMs: fs.statSync(paths.legacyBackupPath).mtimeMs });
    }
  } catch {}
  return backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function withAsarLock(paths, fn) {
  fs.mkdirSync(paths.resourcesDir, { recursive: true });
  let fd = null;
  try {
    try {
      fd = fs.openSync(paths.lockPath, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const stale = fs.existsSync(paths.lockPath) && Date.now() - fs.statSync(paths.lockPath).mtimeMs > 10 * 60_000;
      if (!stale) throw new Error(`Another Hana UI Beautify operation is running: ${paths.lockPath}`);
      fs.rmSync(paths.lockPath, { force: true });
      fd = fs.openSync(paths.lockPath, "wx");
    }
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await fn();
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(paths.lockPath, { force: true }); } catch {}
    }
  }
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

function sourceHashFromCss(css) {
  const start = css.indexOf(SOURCE_HASH_PREFIX);
  if (start < 0) return null;
  const end = css.indexOf("*/", start);
  if (end < 0) return null;
  return css.slice(start + SOURCE_HASH_PREFIX.length, end).trim() || null;
}

export function buildInlineThemeCss(themePath) {
  return fs.readFileSync(themePath, "utf-8")
    .replace(/url\((['"]?)\.\/fonts\//g, "url($1./themes/fonts/");
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
  const backups = readKnownBackups(paths);
  const status = {
    pluginVersion: PLUGIN_VERSION,
    hanakoDir: paths.hanakoDir,
    asarPath: paths.asarPath,
    backupPath: paths.backupPath,
    legacyBackupPath: paths.legacyBackupPath,
    backups: backups.map((item) => item.path),
    exists: fs.existsSync(paths.asarPath),
    backupExists: backups.length > 0,
    canWrite: canWriteResources(paths.resourcesDir),
    applied: false,
    markerApplied: false,
    assetsPresent: false,
    sourceHash: null,
    markerCount: 0,
    fontFiles: [],
    asarThemePath: null,
    asarFontCount: 0,
    error: null,
    needsRestart: false,
    needsAdmin: false,
    actionRequired: null,
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
      status.markerApplied = status.markerCount > 0;
      status.sourceHash = sourceHashFromCss(styles);
      status.asarThemePath = packageFiles.find((file) => file.replaceAll("\\", "/").endsWith("/themes/hana-beautify.css")) || null;
      status.asarFontCount = packageFiles
        .filter((file) => {
          const normalized = file.replaceAll("\\", "/");
          return normalized.includes("themes/fonts/") && normalized.endsWith(".woff2");
        })
        .length;
      status.assetsPresent = !!status.asarThemePath && status.fontFiles.length > 0 && status.asarFontCount >= status.fontFiles.length;
      status.applied = status.markerApplied && status.assetsPresent;
    }
    status.needsAdmin = !status.canWrite && status.exists;
    if (status.needsAdmin) {
      status.actionRequired = "Run Hanako as administrator to enable auto-apply, or use the apply tool from an elevated session.";
    }
  } catch (err) {
    status.error = err.message;
  }
  // Summary computed outside try/catch so exceptions still get a readable message
  status.summary = status.error
    ? `❌ 检查失败: ${status.error}`
    : status.applied
      ? (status.needsRestart ? "✅ 已美化，需重启 Hanako 生效" : "✅ 已美化")
      : status.markerApplied
        ? "⚠️ 检测到美化标记但资源不完整，建议 force 重新应用或 restore"
      : (status.needsAdmin ? "❌ 需要管理员权限才能应用美化" : "未应用，调用 apply 工具安装美化");
  return status;
}

export async function applyBeautify(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  return await withAsarLock(paths, async () => {
    const before = await getStatus(pluginDir, input);
    if (!before.exists) throw new Error(`app.asar not found: ${paths.asarPath}`);
    if (!before.canWrite) {
      throw new Error(`No write permission for ${paths.resourcesDir}. Run Hanako as administrator once, or apply with an elevated installer.`);
    }
    if (before.applied && !input.force) {
      return { ok: true, changed: false, status: before, message: "Beautify is already applied." };
    }

    const sourceHash = before.sourceHash || hashFile(paths.asarPath);
    const backupPath = path.join(paths.backupDir, `app.asar.${sourceHash.slice(0, 16)}.bak`);
    if (!fs.existsSync(backupPath)) {
      if (before.markerApplied) {
        throw new Error(`Original backup for patched app.asar is missing: ${backupPath}. Restore from a known backup before force reapplying.`);
      }
      // Verify source asar integrity before backing up
      try {
        asar.listPackage(paths.asarPath);
      } catch (verifyErr) {
        throw new Error(`Source app.asar is corrupt, aborting: ${verifyErr.message}`);
      }
      fs.mkdirSync(paths.backupDir, { recursive: true });
      fs.copyFileSync(paths.asarPath, backupPath);
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
        css = `${css.trimEnd()}\n\n${INLINE_BEGIN}\n${SOURCE_HASH_PREFIX}${sourceHash} */\n${buildInlineThemeCss(paths.themePath)}\n${INLINE_END}\n`;
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
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, paths.asarPath);
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
    return { ok: true, changed: true, backupPath, status: after, message: "Beautify applied. Restart Hanako or reload the main window to see the updated renderer assets." };
  });
}

export async function restoreBeautify(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  return await withAsarLock(paths, async () => {
    const before = await getStatus(pluginDir, input);
    const preferred = before.sourceHash
      ? path.join(paths.backupDir, `app.asar.${before.sourceHash.slice(0, 16)}.bak`)
      : null;
    const backupPath = input.backupPath
      || (preferred && fs.existsSync(preferred) ? preferred : null)
      || readKnownBackups(paths)[0]?.path;
    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error(`Backup not found. Checked ${paths.backupDir} and ${paths.legacyBackupPath}`);
    }
    if (!canWriteResources(paths.resourcesDir)) {
      throw new Error(`No write permission for ${paths.resourcesDir}. Run Hanako as administrator once, or restore with an elevated installer.`);
    }
    try {
      asar.listPackage(backupPath);
    } catch (verifyErr) {
      throw new Error(`Backup asar failed integrity check: ${verifyErr.message}. Restore aborted.`);
    }
    fs.copyFileSync(backupPath, paths.asarPath);
    try {
      asar.listPackage(paths.asarPath);
    } catch (deployErr) {
      throw new Error(`Restored app.asar failed integrity check: ${deployErr.message}`);
    }
    const status = await getStatus(pluginDir, input);
    status.needsRestart = true;
    return { ok: true, changed: true, backupPath, status, message: "Beautify restored from backup. Restart Hanako to see the original renderer assets." };
  });
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
