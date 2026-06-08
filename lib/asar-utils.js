/**
 * ASAR utilities for Hana UI Beautify.
 *
 * General list/extract/create operations delegate to @electron/asar for format
 * compatibility. Header inspection and transformPackage stay local so the
 * plugin can preserve existing ASAR metadata while replacing only targeted
 * files on older Hanako builds that do not use Electron ASAR integrity.
 *
 * ASAR format (Pickle flavour, as used by @electron/asar and Electron's original-fs):
 *   [4B: Pickle payload size] [4B: total header size as UInt32 LE]
 *   [4B: header Pickle payload size] [4B: header JSON length as Int32 LE]
 *   [N B: UTF-8 header JSON]
 *   [ padded to 4B alignment ]
 *   [ file contents, at offsets declared in header JSON ]
 *
 * The header JSON shape:
 *   { files: { "path/to/file": { offset: "1234", size: 567, executable: true }, ... } }
 *   Directories have a `files` key containing the same recursive structure.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const electronAsar = require("@electron/asar");

// ─── Pickle mini-codec (only the ops we need) ───

const SIZE_UINT32 = 4;

function align4(n) {
  return n + ((4 - (n % 4)) % 4);
}

function readUInt32LE(buf, off) {
  return buf.readUInt32LE(off);
}

function readInt32LE(buf, off) {
  return buf.readInt32LE(off);
}

function writeUInt32LE(buf, val, off) {
  buf.writeUInt32LE(val, off);
}

function writeInt32LE(buf, val, off) {
  buf.writeInt32LE(val, off);
}

/**
 * Read a header from a Pickle-format ASAR file descriptor.
 * Returns { headerJSON, headerSize } where headerSize is the total size
 * (from the file start) of all header bytes, including the pickle wrappers.
 */
function readHeader(fd) {
  // First Pickle: sizeBuf → get total header size
  const sizePicklePayloadSize = readBufferAt(fd, 0, 4);
  const picklePayloadSz = readUInt32LE(sizePicklePayloadSize, 0);
  // picklePayloadSz should be 4 (one UInt32 value)

  const sizePickleValue = readBufferAt(fd, 4, 4);
  const totalHeaderSize = readUInt32LE(sizePickleValue, 0);

  // Second Pickle: headerBuf → get the JSON string
  const headerPicklePayloadSize = readBufferAt(fd, 8, 4);
  // Skip payload-size field, the string-length field follows
  const headerStrLenBuf = readBufferAt(fd, 12, 4);
  const jsonLen = readInt32LE(headerStrLenBuf, 0);
  const jsonBuf = readBufferAt(fd, 16, jsonLen);

  const headerJSON = JSON.parse(jsonBuf.toString("utf-8"));
  // headerSize = sizePickle(8) + headerPickle = 8 + totalHeaderSize
  return { headerJSON, headerSize: totalHeaderSize + 8 };
}

function readBufferAt(fd, offset, size) {
  const buf = Buffer.alloc(size);
  const bytesRead = fs.readSync(fd, buf, 0, size, offset);
  if (bytesRead !== size) {
    throw new Error(`Short read at offset ${offset}: expected ${size} bytes, got ${bytesRead}`);
  }
  return buf;
}

// ─── Public API ───

/**
 * List all file paths in an ASAR archive, with their header info.
 * @param {string} asarPath
 * @returns {string[]}
 */
export function listPackage(asarPath) {
  electronAsar.uncache?.(asarPath);
  const fd = fs.openSync(asarPath, "r");
  try {
    const { headerJSON } = readHeader(fd);
    const files = [];
    function walk(node, prefix) {
      if (!node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const full = prefix ? `${prefix}/${name}` : name;
        if (child.files !== undefined) {
          walk(child, full);
        } else {
          files.push(full);
        }
      }
    }
    walk(headerJSON, "");
    return files;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract a single file from an ASAR archive.
 * @param {string} asarPath
 * @param {string} filePath — path inside the archive, e.g. "app/styles.css"
 * @returns {Buffer}
 */
export function extractFile(asarPath, filePath) {
  const normalized = filePath.replace(/^[\\/]+/, "");
  electronAsar.uncache?.(asarPath);
  try {
    return electronAsar.extractFile(asarPath, normalized);
  } catch (err) {
    const fd = fs.openSync(asarPath, "r");
    try {
      const { headerJSON } = readHeader(fd);
      const info = resolveFileNode(headerJSON, normalized);
      if (info?.unpacked) {
        throw new Error(`"${normalized}" is marked as unpacked and has no bytes inside ${asarPath}`);
      }
      if (info?.link !== undefined) {
        throw new Error(`"${normalized}" is a link entry and has no bytes inside ${asarPath}`);
      }
    } finally {
      fs.closeSync(fd);
    }
    try {
      return extractFileFromArchiveBytes(asarPath, normalized);
    } catch {
      throw err;
    }
  }
}

function extractFileFromArchiveBytes(asarPath, filePath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const { headerJSON, headerSize } = readHeader(fd);
    const info = resolveFileNode(headerJSON, filePath);
    if (!info) {
      throw new Error(`"${filePath}" not found in ${asarPath}`);
    }
    if (info.unpacked) {
      throw new Error(`"${filePath}" is marked as unpacked and has no bytes inside ${asarPath}`);
    }
    if (info.link !== undefined) {
      throw new Error(`"${filePath}" is a link entry and has no bytes inside ${asarPath}`);
    }
    if (info.size === undefined) {
      throw new Error(`"${filePath}" not found in ${asarPath}`);
    }
    const dataOffset = headerSize + parseInt(info.offset, 10);
    return readBufferAt(fd, dataOffset, info.size);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract all files from an ASAR archive into a destination directory.
 * @param {string} asarPath
 * @param {string} destDir
 */
export function extractAll(asarPath, destDir) {
  electronAsar.uncache?.(asarPath);
  electronAsar.extractAll(asarPath, destDir);
}

/**
 * Create an ASAR archive from a source directory.
 * @param {string} srcDir — source directory path
 * @param {string} destPath — destination .asar file path
 * @param {object} [_options] — reserved, currently unused
 * @returns {Promise<void>}
 */
export async function createPackageWithOptions(srcDir, destPath, _options = {}) {
  await electronAsar.createPackageWithOptions(srcDir, destPath, _options || {});
  electronAsar.uncache?.(destPath);
}

/**
 * Serialize an ASAR header tree plus an ordered list of file-content buffers
 * into a Pickle-format archive. The buffer order MUST match the offset order
 * assigned in the header (i.e. the order leaves are visited when walking).
 */
function serializeAndWrite(destPath, header, buffers) {
  const headerJSON = JSON.stringify(header);
  const headerStrLen = Buffer.byteLength(headerJSON, "utf-8");
  const headerJSONBuf = Buffer.from(headerJSON, "utf-8");

  // headerPickle: payload_size(4) + writeInt(strLen)(4) + string + alignment padding
  const headerPayloadSize = 4 + align4(headerStrLen);
  const headerPickle = Buffer.alloc(4 + headerPayloadSize);
  writeUInt32LE(headerPickle, headerPayloadSize, 0);  // payload size
  writeInt32LE(headerPickle, headerStrLen, 4);         // string length
  headerJSONBuf.copy(headerPickle, 8);                 // string content

  // sizePickle: payload_size(4) + UInt32 = headerPickle.length
  const sizePickleBuf = Buffer.alloc(8);
  writeUInt32LE(sizePickleBuf, 4, 0);
  writeUInt32LE(sizePickleBuf, headerPickle.length, 4);

  const fd = fs.openSync(destPath, "w");
  try {
    fs.writeSync(fd, sizePickleBuf);
    fs.writeSync(fd, headerPickle);
    for (const b of buffers) fs.writeSync(fd, b);
    // Flush to disk so the subsequent atomic rename publishes a complete file.
    try { fs.fsyncSync(fd); } catch {}
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read just the header tree of an ASAR archive.
 * @returns {{ headerJSON: object, headerSize: number }}
 */
export function readHeaderObject(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    return readHeader(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Detect ASAR integrity metadata embedded in the header (per-file `integrity`
 * blocks). When present, repacking the archive will invalidate the hashes that
 * Electron's `EnableEmbeddedAsarIntegrityValidation` fuse checks at launch, so
 * the caller must refuse rather than brick startup.
 * @returns {string[]} archive paths carrying integrity metadata
 */
export function collectIntegrityNodes(header) {
  const hits = [];
  (function walk(node, prefix) {
    if (!node.files) return;
    for (const [name, child] of Object.entries(node.files)) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (child && child.integrity) hits.push(full);
      if (child && child.files) walk(child, full);
    }
  })(header, "");
  return hits;
}

function insertHeaderFileNode(header, archivePath, node) {
  const parts = archivePath.split("/");
  let cursor = header;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor.files) cursor.files = {};
    if (!cursor.files[parts[i]] || !cursor.files[parts[i]].files) {
      cursor.files[parts[i]] = { files: {} };
    }
    cursor = cursor.files[parts[i]];
  }
  if (!cursor.files) cursor.files = {};
  cursor.files[parts[parts.length - 1]] = node;
}

/**
 * Rewrite an ASAR archive, replacing the bytes of selected existing files and
 * appending new files, while preserving every other node verbatim — including
 * `executable`, `unpacked`, `link` flags and any unknown keys. This is far
 * safer than extract→crawl→repack, which silently drops that metadata and can
 * produce an archive that Electron's native loader rejects.
 *
 * Unpacked (`unpacked: true`) and symlink (`link`) nodes carry no bytes inside
 * the archive and are left untouched; their backing files in `app.asar.unpacked`
 * are not modified by this function.
 *
 * @param {string} srcAsar
 * @param {string} destAsar
 * @param {object} mutations
 * @param {Map<string,Buffer>} [mutations.replacements] archivePath → new bytes
 * @param {Array<{archivePath:string,data:Buffer}>} [mutations.additions]
 */
export function transformPackage(srcAsar, destAsar, mutations = {}) {
  const replacements = mutations.replacements || new Map();
  const additions = mutations.additions || [];
  const additionMap = new Map(additions.map((a) => [a.archivePath.replace(/^[\\/]+/, ""), a.data]));

  const fd = fs.openSync(srcAsar, "r");
  try {
    const { headerJSON: original, headerSize } = readHeader(fd);
    // Deep clone so we can reassign offsets without mutating the source tree we
    // still read original bytes from.
    const newHeader = JSON.parse(JSON.stringify(original));

    for (const add of additions) {
      insertHeaderFileNode(newHeader, add.archivePath.replace(/^[\\/]+/, ""), { size: add.data.length });
    }

    const buffers = [];
    let offset = BigInt(0);
    (function walk(node, prefix) {
      if (!node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const full = prefix ? `${prefix}/${name}` : name;
        if (child.files) { walk(child, full); continue; }
        if (child.unpacked) continue;          // stored in app.asar.unpacked, no bytes here
        if (child.link !== undefined) continue; // symlink, no bytes

        let data;
        if (replacements.has(full)) data = replacements.get(full);
        else if (additionMap.has(full)) data = additionMap.get(full);
        else {
          const srcInfo = resolveFileNode(original, full);
          if (!srcInfo || srcInfo.size === undefined || srcInfo.offset === undefined) {
            throw new Error(`Cannot resolve source bytes for "${full}" during transform`);
          }
          data = readBufferAt(fd, headerSize + parseInt(srcInfo.offset, 10), srcInfo.size);
        }
        child.size = data.length;
        child.offset = offset.toString();
        offset += BigInt(data.length);
        buffers.push(data);
      }
    })(newHeader, "");

    serializeAndWrite(destAsar, newHeader, buffers);
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Helpers ───

function resolveFileNode(header, filePath) {
  const parts = filePath.replace(/^[\\/]+/, "").split(/[\\/]/);
  let node = header;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}
