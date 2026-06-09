import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as asar from "./asar-utils.js";

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

const HOST_SELECTOR_PROBES = [
  ".yuan-chip",
  ".ob-provider-trigger",
  ".msg-card",
  ".float-sidebar",
  ".browser-floating-card",
];

const CORE_RENDERER_FILES = [
  "desktop/dist-renderer/index.html",
  "desktop/dist-renderer/settings.html",
  "desktop/dist-renderer/lib/i18n.js",
  "desktop/dist-renderer/locales/zh.json",
  "desktop/dist-renderer/locales/en.json",
];

const CORE_I18N_KEYS = [
  "settings.title",
  "settings.tabs.agent",
  "settings.agent.title",
  "settings.save",
];

// Resolve the resources directory for a given install root. macOS ships the
// app inside a bundle (Hanako.app/Contents/Resources); Windows/Linux use a
// flat resources/ next to the executable. Getting this right also fixes the
// Info.plist and _CodeSignature lookups, which are computed relative to it.
export function resourcesDirFor(hanakoDir) {
  if (process.platform === "darwin") return path.join(hanakoDir, "Contents", "Resources");
  return path.join(hanakoDir, "resources");
}

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
    if (fs.existsSync(path.join(resourcesDirFor(dir), "app.asar"))) return dir;
  }
  return candidates[0];
}

export function resolvePaths(pluginDir, input = {}) {
  const hanakoDir = input.hanakoInstallDir || defaultHanakoDir();
  const runId = `${process.pid}-${Date.now()}`;
  const resourcesDir = resourcesDirFor(hanakoDir);
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
    // Staged archive lives in resourcesDir so the final publish is an atomic
    // same-volume rename, not a non-atomic cross-volume copy that can leave a
    // half-written app.asar — a classic cause of "app won't launch".
    stagedAsarPath: path.join(resourcesDir, `.hana-beautify.staged-${runId}.asar`),
    infoPlistPath: path.join(resourcesDir, "..", "Info.plist"),
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

// Each Hanako update produces a new source hash and therefore a new full-size
// backup (tens of MB) that is never reused. Keep only the newest `keep` hashed
// backups so the backup dir doesn't grow without bound. `protectPath` (the
// backup matching the currently-deployed asar) is always kept and does not
// count against the quota, so the backup needed to restore the live install can
// never be pruned. The legacy single-file backup is left untouched.
function pruneOldBackups(paths, { keep = 3, protectPath = null } = {}) {
  try {
    if (!fs.existsSync(paths.backupDir)) return;
    const protectResolved = protectPath ? path.resolve(protectPath) : null;
    const hashed = fs.readdirSync(paths.backupDir)
      .filter((name) => name.startsWith("app.asar.") && name.endsWith(".bak"))
      .map((name) => {
        const full = path.join(paths.backupDir, name);
        return { path: full, resolved: path.resolve(full), mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let kept = 0;
    for (const entry of hashed) {
      if (protectResolved && entry.resolved === protectResolved) continue; // always keep the active backup
      if (kept < keep) { kept++; continue; }
      fs.rmSync(entry.path, { force: true });
    }
  } catch {}
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
      // Re-acquire can still lose to a concurrent process that grabbed the lock
      // between our rm and open; surface that as the friendly "already running"
      // error instead of a raw EEXIST.
      try {
        fd = fs.openSync(paths.lockPath, "wx");
      } catch (retryErr) {
        if (retryErr.code === "EEXIST") {
          throw new Error(`Another Hana UI Beautify operation is running: ${paths.lockPath}`);
        }
        throw retryErr;
      }
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
  // accessSync(W_OK) is unreliable on Windows: it reflects the read-only file
  // attribute, not NTFS ACLs or UAC virtualization, so it can report writable
  // when an actual write into Program Files would fail. Probe with a real
  // create+unlink instead, falling back to accessSync if the dir is missing.
  try {
    const probe = path.join(resourcesDir, `.hana-beautify-write-test-${process.pid}-${Date.now()}`);
    const fd = fs.openSync(probe, "wx");
    fs.closeSync(fd);
    fs.rmSync(probe, { force: true });
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        fs.accessSync(resourcesDir, fs.constants.W_OK);
        return true;
      } catch {}
    }
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
    asarCompatibility: null,
    selectorReport: null,
    rendererHealth: null,
  };

  try {
    if (fs.existsSync(paths.fontsDir)) {
      status.fontFiles = fs.readdirSync(paths.fontsDir).filter((name) => name.endsWith(".woff2"));
    }
    if (status.exists) {
      const { headerJSON } = asar.readHeaderObject(paths.asarPath);
      status.asarCompatibility = inspectAsarCompatibility(paths, headerJSON);
      const packageFiles = asar.listPackage(paths.asarPath);
      const stylesPath = packageFiles.find((file) => {
        const f = file.replaceAll("\\", "/");
        return f === "styles.css" || f.endsWith("/styles.css");
      });
      if (!stylesPath) throw new Error("styles.css not found in app.asar");
      const extractPath = stylesPath.replace(/^[\\/]+/, "");
      const styles = asar.extractFile(paths.asarPath, extractPath).toString("utf-8");
      status.markerCount = (styles.match(new RegExp(escapeRegExp(INLINE_BEGIN), "g")) || []).length;
      status.markerApplied = status.markerCount > 0;
      status.sourceHash = sourceHashFromCss(styles);
      status.asarThemePath = packageFiles.find((file) => {
        const f = file.replaceAll("\\", "/");
        return f === "themes/hana-beautify.css" || f.endsWith("/themes/hana-beautify.css");
      }) || null;
      status.asarFontCount = packageFiles
        .filter((file) => {
          const normalized = file.replaceAll("\\", "/");
          return normalized.includes("themes/fonts/") && normalized.endsWith(".woff2");
        })
        .length;
      status.assetsPresent = !!status.asarThemePath && status.fontFiles.length > 0 && status.asarFontCount >= status.fontFiles.length;
      status.applied = status.markerApplied && status.assetsPresent;
      status.selectorReport = inspectSelectorCompatibility(paths.asarPath, packageFiles);
      status.rendererHealth = inspectRendererHealth(paths.asarPath, packageFiles);
    }
    status.needsAdmin = !status.canWrite && status.exists;
    if (status.asarCompatibility && !status.asarCompatibility.patchSupported) {
      status.actionRequired = status.asarCompatibility.reasons.join("; ");
    }
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

function readJsonFromAsar(asarPath, filePath) {
  return JSON.parse(asar.extractFile(asarPath, filePath).toString("utf-8"));
}

function getNestedValue(obj, dottedKey) {
  return dottedKey.split(".").reduce((cursor, part) => cursor && cursor[part], obj);
}

export function inspectRendererHealth(asarPath, packageFiles = asar.listPackage(asarPath)) {
  const fileSet = new Set(packageFiles.map((file) => file.replaceAll("\\", "/")));
  const missingFiles = CORE_RENDERER_FILES.filter((file) => !fileSet.has(file));
  const invalidFiles = [];
  const missingI18nKeys = [];

  for (const file of CORE_RENDERER_FILES.filter((item) => fileSet.has(item))) {
    try {
      const text = asar.extractFile(asarPath, file).toString("utf-8");
      if (file.endsWith(".html") && !text.includes("<html")) invalidFiles.push(file);
      if (file.endsWith("/i18n.js") && !text.includes("locales/")) invalidFiles.push(file);
      if (file.endsWith(".json")) JSON.parse(text);
    } catch {
      invalidFiles.push(file);
    }
  }

  for (const localePath of ["desktop/dist-renderer/locales/zh.json", "desktop/dist-renderer/locales/en.json"]) {
    if (!fileSet.has(localePath)) continue;
    try {
      const locale = readJsonFromAsar(asarPath, localePath);
      for (const key of CORE_I18N_KEYS) {
        const value = getNestedValue(locale, key);
        if (typeof value !== "string" || value === key || value.length === 0) {
          missingI18nKeys.push(`${localePath}:${key}`);
        }
      }
    } catch {
      invalidFiles.push(localePath);
    }
  }

  return {
    ok: missingFiles.length === 0 && invalidFiles.length === 0 && missingI18nKeys.length === 0,
    missingFiles,
    invalidFiles: [...new Set(invalidFiles)],
    missingI18nKeys,
  };
}

function assertRendererHealth(asarPath, label) {
  const report = inspectRendererHealth(asarPath);
  if (!report.ok) {
    throw new Error(`${label} renderer health check failed: ${JSON.stringify(report)}`);
  }
  return report;
}

export function inspectAsarCompatibility(paths, header) {
  const integrityReasons = detectAsarIntegrity(paths, header);
  const unpacked = [];
  (function walk(node, prefix) {
    if (!node?.files) return;
    for (const [name, child] of Object.entries(node.files)) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (child?.unpacked) unpacked.push(full);
      if (child?.files) walk(child, full);
    }
  })(header, "");
  const reasons = [...integrityReasons];
  if (unpacked.length) reasons.push(`asar contains unpacked entries (${unpacked.length}); transform mode can preserve them, extract/repack mode is forbidden`);

  // macOS: detect code signing — patching app.asar breaks the seal.
  // The signature lives next to Resources under Contents/_CodeSignature, so
  // derive it from resourcesDir rather than the bundle's parent directory.
  let codeSignWarning = null;
  if (process.platform === "darwin") {
    const codeResources = path.join(paths.resourcesDir, "..", "_CodeSignature", "CodeResources");
    if (fs.existsSync(codeResources)) {
      codeSignWarning = "macOS code signature detected. Patching app.asar will invalidate the signature; Gatekeeper may block Hanako on next launch. Consider runtime CSS injection instead.";
      reasons.push(codeSignWarning);
    }
  }

  return {
    patchSupported: integrityReasons.length === 0 && !codeSignWarning,
    integrityProtected: integrityReasons.length > 0,
    integrityReasons,
    unpackedCount: unpacked.length,
    unpackedSamples: unpacked.slice(0, 10),
    reasons,
    codeSignWarning,
  };
}

function inspectSelectorCompatibility(asarPath, packageFiles) {
  const cssFiles = packageFiles.filter((file) => file.replaceAll("\\", "/").endsWith(".css"));
  const cssText = [];
  for (const file of cssFiles) {
    try {
      cssText.push(asar.extractFile(asarPath, file).toString("utf-8"));
    } catch {}
  }
  const joined = cssText.join("\n");
  const probes = HOST_SELECTOR_PROBES.map((selector) => ({
    selector,
    foundInHostCss: joined.includes(selector),
  }));
  return {
    checkedCssFiles: cssFiles.length,
    probes,
    missingSelectors: probes.filter((item) => !item.foundInHostCss).map((item) => item.selector),
  };
}

function stylesPathsFromAsar(asarPath) {
  return asar.listPackage(asarPath)
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => f === "styles.css" || f.endsWith("/styles.css"));
}

// Reasons this build must NOT be patched, because Electron validates the asar
// at launch and a repack would change the hash → app refuses to start.
function detectAsarIntegrity(paths, header) {
  const reasons = [];
  try {
    const nodes = asar.collectIntegrityNodes(header);
    if (nodes.length) reasons.push(`asar header carries per-file integrity metadata (${nodes.length} entries)`);
  } catch {}
  try {
    if (fs.existsSync(paths.infoPlistPath)) {
      const plist = fs.readFileSync(paths.infoPlistPath, "utf-8");
      if (plist.includes("ElectronAsarIntegrity")) reasons.push("Info.plist declares ElectronAsarIntegrity");
    }
  } catch {}
  return reasons;
}

// Publish a staged archive over the target. Prefer an atomic same-volume
// rename; only fall back to copy when the staged file is on another volume.
function publishAtomically(stagedPath, targetPath) {
  try {
    fs.renameSync(stagedPath, targetPath);
  } catch (err) {
    if (err.code === "EXDEV") {
      fs.copyFileSync(stagedPath, targetPath);
      fs.rmSync(stagedPath, { force: true });
    } else {
      throw err;
    }
  }
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

    const { headerJSON } = asar.readHeaderObject(paths.asarPath);
    const integrityReasons = detectAsarIntegrity(paths, headerJSON);
    if (integrityReasons.length) {
      throw new Error(`Refusing to patch app.asar because Electron integrity validation metadata is present: ${integrityReasons.join("; ")}`);
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
        assertRendererHealth(paths.asarPath, "Source app.asar");
      } catch (verifyErr) {
        throw new Error(`Source app.asar is corrupt, aborting: ${verifyErr.message}`);
      }
      fs.mkdirSync(paths.backupDir, { recursive: true });
      fs.copyFileSync(paths.asarPath, backupPath);
    }

    try {
      const stylesCssPaths = stylesPathsFromAsar(paths.asarPath);
      if (stylesCssPaths.length === 0) throw new Error("styles.css not found in app.asar");

      const fontFiles = fs.readdirSync(paths.fontsDir).filter((name) => name.endsWith(".woff2"));
      const replacements = new Map();
      const additions = [];
      for (const cssPath of stylesCssPaths) {
        let css = asar.extractFile(paths.asarPath, cssPath).toString("utf-8");
        css = stripPreviousInjection(css);
        css = `${css.trimEnd()}\n\n${INLINE_BEGIN}\n${SOURCE_HASH_PREFIX}${sourceHash} */\n${buildInlineThemeCss(paths.themePath)}\n${INLINE_END}\n`;
        replacements.set(cssPath, Buffer.from(css, "utf-8"));

        const normalizedCssPath = cssPath.replaceAll("\\", "/");
        const stylesDir = path.posix.dirname(normalizedCssPath);
        const themesDir = stylesDir === "." ? "themes" : `${stylesDir}/themes`;
        additions.push({
          archivePath: `${themesDir}/hana-beautify.css`,
          data: Buffer.from(fs.readFileSync(paths.themePath, "utf-8"), "utf-8"),
        });
        for (const file of fontFiles) {
          additions.push({
            archivePath: `${themesDir}/fonts/${file}`,
            data: fs.readFileSync(path.join(paths.fontsDir, file)),
          });
        }
      }

      asar.transformPackage(paths.asarPath, paths.tempAsarPath, { replacements, additions });

      // Integrity check: verify the repacked asar is structurally sound AND
      // the injected styles.css is correctly extractable (catches offset bugs).
      try {
        const pkg = asar.listPackage(paths.tempAsarPath);
        const stylePath = pkg.find((f) => f.replaceAll("\\", "/").endsWith("/styles.css"));
        if (!stylePath) throw new Error("styles.css missing in repacked asar");
        const extracted = asar.extractFile(paths.tempAsarPath, stylePath).toString("utf-8");
        if (!extracted.includes(INLINE_BEGIN) || !extracted.includes(SOURCE_HASH_PREFIX)) {
          throw new Error("Beautify marker missing from repacked styles.css");
        }
        assertRendererHealth(paths.tempAsarPath, "Repacked app.asar");
      } catch (verifyErr) {
        throw new Error(`Repacked asar failed integrity check: ${verifyErr.message}. Original app.asar is untouched.`);
      }

      fs.copyFileSync(paths.tempAsarPath, paths.stagedAsarPath);
      publishAtomically(paths.stagedAsarPath, paths.asarPath);

      // Deploy verification: listPackage + extractFile for styles.css.
      try {
        const pkg = asar.listPackage(paths.asarPath);
        const stylePath = pkg.find((f) => f.replaceAll("\\", "/").endsWith("/styles.css"));
        if (!stylePath) throw new Error("styles.css missing in deployed asar");
        const extracted = asar.extractFile(paths.asarPath, stylePath).toString("utf-8");
        if (!extracted.includes(INLINE_BEGIN)) throw new Error("Beautify marker missing from deployed styles.css");
        assertRendererHealth(paths.asarPath, "Deployed app.asar");
      } catch (deployErr) {
        // Deploy failed — attempt automatic rollback if backup exists.
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, paths.asarPath);
          throw new Error(`Deployed asar is corrupt; rolled back from backup. Cause: ${deployErr.message}`);
        }
        throw new Error(`Deployed asar is corrupt and no backup to roll back. Cause: ${deployErr.message}`);
      }

    } finally {
      try { fs.rmSync(paths.tempAsarPath, { force: true }); } catch {}
      try { fs.rmSync(paths.stagedAsarPath, { force: true }); } catch {}
    }

    // Apply succeeded — prune old backups, but never the one that matches the
    // asar we just deployed (so a later restore of this install always works).
    pruneOldBackups(paths, { protectPath: backupPath });

    const after = await getStatus(pluginDir, input);
    after.needsRestart = true;
    return { ok: true, changed: true, backupPath, status: after, message: "Beautify applied. Restart Hanako or reload the main window to see the updated renderer assets." };
  });
}

export async function restoreBeautify(pluginDir, input = {}) {
  const paths = resolvePaths(pluginDir, input);
  return await withAsarLock(paths, async () => {
    const before = await getStatus(pluginDir, input);
    const known = readKnownBackups(paths);
    let backupPath;
    if (input.backupPath) {
      backupPath = input.backupPath;
    } else if (before.sourceHash) {
      // The patched asar records the exact hash of its original. Restore only
      // that original — never silently fall back to the newest backup, which
      // could belong to a different Hanako version that "launches" but ships a
      // mismatched renderer.
      const preferred = path.join(paths.backupDir, `app.asar.${before.sourceHash.slice(0, 16)}.bak`);
      if (fs.existsSync(preferred)) {
        backupPath = preferred;
      } else {
        // Hashed backup gone (pruned, or made by an old single-backup version).
        // Accept any known backup whose actual content hash matches the recorded
        // source hash; otherwise refuse and let the user pick one explicitly.
        const match = known.find((b) => { try { return hashFile(b.path) === before.sourceHash; } catch { return false; } });
        if (!match) {
          const available = known.map((b) => b.path).join(", ") || "(none)";
          throw new Error(`No backup matching the patched app.asar (source ${before.sourceHash.slice(0, 16)}) was found. Refusing to restore a different Hanako version automatically. Available backups: ${available}. Pass backupPath to override.`);
        }
        backupPath = match.path;
      }
    } else {
      // asar carries no beautify source hash (not patched, or marker missing) —
      // best effort: the most recent known backup.
      backupPath = known[0]?.path;
    }
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
