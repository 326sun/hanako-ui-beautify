/**
 * Pure Node.js ASAR reader/writer — zero external dependencies.
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
import crypto from "crypto";

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
  const fd = fs.openSync(asarPath, "r");
  try {
    const { headerJSON, headerSize } = readHeader(fd);
    const info = resolveFileNode(headerJSON, filePath);
    if (!info || info.size === undefined) {
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
  const fd = fs.openSync(asarPath, "r");
  try {
    const { headerJSON, headerSize } = readHeader(fd);
    function walk(node, prefix) {
      if (!node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const full = prefix ? `${prefix}/${name}` : name;
        if (child.files !== undefined) {
          const dirPath = path.join(destDir, full);
          fs.mkdirSync(dirPath, { recursive: true });
          walk(child, full);
        } else {
          const filePath = path.join(destDir, full);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          const dataOffset = headerSize + parseInt(child.offset, 10);
          const content = readBufferAt(fd, dataOffset, child.size);
          fs.writeFileSync(filePath, content);
          if (child.executable) {
            try { fs.chmodSync(filePath, 0o755); } catch {}
          }
        }
      }
    }
    walk(headerJSON, "");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Create an ASAR archive from a source directory.
 * @param {string} srcDir — source directory path
 * @param {string} destPath — destination .asar file path
 * @param {object} [_options] — reserved, currently unused
 * @returns {Promise<void>}
 */
export async function createPackageWithOptions(srcDir, destPath, _options = {}) {
  // 1. Crawl filesystem
  const fileList = [];
  function crawl(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        crawl(full, archivePath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        fileList.push({ full, archivePath, size: stat.size, executable: false });
      }
    }
  }
  crawl(srcDir, "");

  // 2. Build header tree
  const header = { files: {} };
  for (const file of fileList) {
    const parts = file.archivePath.split("/");
    let node = header;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
      node = node.files[parts[i]];
    }
    const name = parts[parts.length - 1];
    node.files[name] = { size: file.size, offset: "0" }; // offset filled below
    if (file.executable) node.files[name].executable = true;
  }

  // 3. Compute offsets: files start after the header
  const headerJSON = JSON.stringify(header);
  // header Pickle: payload_size(4) + writeInt(len)(4) + string(len) → aligned to 4
  const headerPicklePayload = 4 + align4(headerJSON.length);
  // size Pickle: payload_size(4) + writeUInt32(4) = 8
  const sizePickle = 8;
  // Total header prefix: size pickle(8) + header pickle payload(4) + header pickle data = 8 + headerPicklePayload
  const totalHeaderSize = sizePickle + headerPicklePayload;

  // Fill offsets
  let currentOffset = BigInt(0);
  for (const file of fileList) {
    const parts = file.archivePath.split("/");
    let node = header;
    for (let i = 0; i < parts.length - 1; i++) node = node.files[parts[i]];
    node.files[parts[parts.length - 1]].offset = currentOffset.toString();
    currentOffset += BigInt(file.size);
  }

  // 4. Write the archive
  const updatedHeaderJSON = JSON.stringify(header);
  const headerStrLen = Buffer.byteLength(updatedHeaderJSON, "utf-8");

  // Build buffers
  const headerJSONBuf = Buffer.from(updatedHeaderJSON, "utf-8");
  // headerPickle: payload size(4) + writeInt(strLen)(4) + actual string + alignment padding
  const headerPayloadSize = 4 + align4(headerStrLen);
  const headerPickle = Buffer.alloc(4 + headerPayloadSize); // 4 for pickle header + payload
  writeUInt32LE(headerPickle, headerPayloadSize, 0);  // payload size
  writeInt32LE(headerPickle, headerStrLen, 4);         // string length
  headerJSONBuf.copy(headerPickle, 8);                 // string content

  // sizePickle: payload size(4) + UInt32(4) = 8
  const sizePickleBuf = Buffer.alloc(8);
  writeUInt32LE(sizePickleBuf, 4, 0);                      // payload size = 4
  writeUInt32LE(sizePickleBuf, headerPickle.length, 4);    // total header pickle size

  // Write to file
  const fd = fs.openSync(destPath, "w");
  try {
    fs.writeSync(fd, sizePickleBuf);
    fs.writeSync(fd, headerPickle);
    for (const file of fileList) {
      const content = fs.readFileSync(file.full);
      fs.writeSync(fd, content);
    }
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
