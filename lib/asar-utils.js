/**
 * ASAR reader/writer — thin wrapper over @electron/asar.
 * All operations delegate to the Electron-native asar library
 * for guaranteed format compatibility with the Electron runtime.
 */

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const asar = _require("@electron/asar");

// ─── Read operations (sync) ───

/**
 * List all file paths in an ASAR archive.
 * @param {string} asarPath
 * @returns {string[]}
 */
export function listPackage(asarPath) {
  return asar.listPackage(asarPath);
}

/**
 * Extract a single file from an ASAR archive.
 * @param {string} asarPath
 * @param {string} filePath — path inside the archive
 * @returns {Buffer}
 */
export function extractFile(asarPath, filePath) {
  return asar.extractFile(asarPath, filePath);
}

/**
 * Extract all files from an ASAR archive into a destination directory.
 * @param {string} asarPath
 * @param {string} destDir
 */
export function extractAll(asarPath, destDir) {
  asar.extractAll(asarPath, destDir);
}

// ─── Write operations ───

/**
 * Create an ASAR archive from a source directory.
 * @param {string} srcDir
 * @param {string} destPath
 * @param {object} [_options]
 * @returns {Promise<void>}
 */
export function createPackageWithOptions(srcDir, destPath, _options = {}) {
  return asar.createPackageWithOptions(srcDir, destPath, {});
}
