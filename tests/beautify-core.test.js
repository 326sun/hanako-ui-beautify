/**
 * Unit tests for lib/beautify-core.js — path replacement, injection stripping, regex escaping.
 * Run: node --test tests/beautify-core.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  escapeRegExp,
  stripPreviousInjection,
  buildInlineThemeCss,
  INLINE_BEGIN,
  INLINE_END,
  applyBeautify,
  inspectRendererHealth,
} from "../lib/beautify-core.js";
import {
  createPackageWithOptions,
  extractFile,
  extractAll,
  listPackage,
  readHeaderObject,
  transformPackage,
} from "../lib/asar-utils.js";
import {
  applyAdaptiveBeautify,
  getAdaptiveStatus,
} from "../lib/adaptive-beautify.js";
import fs from "fs";
import path from "path";
import os from "os";

function align4(n) {
  return n + ((4 - (n % 4)) % 4);
}

function writeAsarFixture(asarPath, header, buffers) {
  const headerJSON = JSON.stringify(header);
  const headerLength = Buffer.byteLength(headerJSON, "utf-8");
  const headerPayloadSize = 4 + align4(headerLength);
  const headerPickle = Buffer.alloc(4 + headerPayloadSize);
  headerPickle.writeUInt32LE(headerPayloadSize, 0);
  headerPickle.writeInt32LE(headerLength, 4);
  Buffer.from(headerJSON, "utf-8").copy(headerPickle, 8);

  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);

  fs.writeFileSync(asarPath, Buffer.concat([sizePickle, headerPickle, ...buffers]));
}

function tempDir(name) {
  return path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe("escapeRegExp", () => {
  it("escapes special regex characters", () => {
    assert.equal(escapeRegExp("."), "\\.");
    assert.equal(escapeRegExp("*"), "\\*");
    assert.equal(escapeRegExp("["), "\\[");
    assert.equal(escapeRegExp("]"), "\\]");
    assert.equal(escapeRegExp("("), "\\(");
    assert.equal(escapeRegExp(")"), "\\)");
    assert.equal(escapeRegExp("\\"), "\\\\");
    assert.equal(escapeRegExp("^"), "\\^");
    assert.equal(escapeRegExp("$"), "\\$");
    assert.equal(escapeRegExp("+"), "\\+");
    assert.equal(escapeRegExp("?"), "\\?");
    assert.equal(escapeRegExp("|"), "\\|");
    assert.equal(escapeRegExp("{"), "\\{");
    assert.equal(escapeRegExp("}"), "\\}");
  });

  it("handles combination of special and normal chars", () => {
    assert.equal(escapeRegExp("hana-beautify:begin */"), "hana-beautify:begin \\*/");
  });

  it("returns empty string for empty input", () => {
    assert.equal(escapeRegExp(""), "");
  });
});

describe("stripPreviousInjection", () => {
  it("removes inline injection block", () => {
    const css = `.foo { color: red; }\n\n${INLINE_BEGIN}\n@font-face {}\n${INLINE_END}\n.bar { color: blue; }\n`;
    const result = stripPreviousInjection(css);
    assert.ok(!result.includes(INLINE_BEGIN));
    assert.ok(!result.includes(INLINE_END));
    assert.ok(result.includes(".foo { color: red; }"));
    assert.ok(result.includes(".bar { color: blue; }"));
  });

  it("removes import statement", () => {
    const css = `@import url('./themes/hana-beautify.css');\n.foo {}\n`;
    const result = stripPreviousInjection(css);
    assert.ok(!result.includes("hana-beautify.css"));
    assert.ok(result.includes(".foo {}"));
  });

  it("handles double-quoted import", () => {
    const css = `@import url("./themes/hana-beautify.css");\n.foo {}\n`;
    const result = stripPreviousInjection(css);
    assert.ok(!result.includes("hana-beautify.css"));
  });

  it("leaves non-beautify CSS untouched", () => {
    const css = `.foo { color: red; }\n.bar { color: blue; }\n`;
    const result = stripPreviousInjection(css);
    assert.equal(result.trim(), css.trim());
  });

  it("removes multiple injection blocks", () => {
    const css = `a {}\n${INLINE_BEGIN}\n/* old */\n${INLINE_END}\nb {}\n${INLINE_BEGIN}\n/* old2 */\n${INLINE_END}\nc {}\n`;
    const result = stripPreviousInjection(css);
    assert.ok(!result.includes(INLINE_BEGIN));
    assert.ok(result.includes("a {}"));
    assert.ok(result.includes("b {}"));
    assert.ok(result.includes("c {}"));
  });
});

describe("buildInlineThemeCss", () => {
  const tmpDir = path.join(os.tmpdir(), "beautify-test-" + Date.now());

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces single-quoted fonts path", () => {
    const themePath = path.join(tmpDir, "theme-single.css");
    fs.writeFileSync(themePath, "url('./fonts/harmonyos-sans-sc-regular.woff2')", "utf-8");
    const result = buildInlineThemeCss(themePath);
    assert.equal(result, "url('./themes/fonts/harmonyos-sans-sc-regular.woff2')");
  });

  it("replaces double-quoted fonts path", () => {
    const themePath = path.join(tmpDir, "theme-double.css");
    fs.writeFileSync(themePath, 'url("./fonts/harmonyos-sans-sc-regular.woff2")', "utf-8");
    const result = buildInlineThemeCss(themePath);
    assert.equal(result, 'url("./themes/fonts/harmonyos-sans-sc-regular.woff2")');
  });

  it("replaces unquoted fonts path", () => {
    const themePath = path.join(tmpDir, "theme-unquoted.css");
    fs.writeFileSync(themePath, "url(./fonts/harmonyos-sans-sc-regular.woff2)", "utf-8");
    const result = buildInlineThemeCss(themePath);
    assert.equal(result, "url(./themes/fonts/harmonyos-sans-sc-regular.woff2)");
  });

  it("handles multiple font references in one file", () => {
    const themePath = path.join(tmpDir, "theme-multi.css");
    const css = [
      "url('./fonts/font-light.woff2')",
      'url("./fonts/font-regular.woff2")',
      "url(./fonts/font-bold.woff2)",
    ].join("\n");
    fs.writeFileSync(themePath, css, "utf-8");
    const result = buildInlineThemeCss(themePath);
    assert.ok(result.includes("url('./themes/fonts/font-light.woff2')"));
    assert.ok(result.includes('url("./themes/fonts/font-regular.woff2")'));
    assert.ok(result.includes("url(./themes/fonts/font-bold.woff2)"));
  });

  it("does not alter non-fonts paths", () => {
    const themePath = path.join(tmpDir, "theme-other.css");
    fs.writeFileSync(themePath, "url('./images/logo.png')\nurl('../fonts/icon.woff2')", "utf-8");
    const result = buildInlineThemeCss(themePath);
    assert.equal(result, "url('./images/logo.png')\nurl('../fonts/icon.woff2')");
  });
});

describe("asar metadata handling", () => {
  it("preserves executable metadata when creating a package", async () => {
    const dir = tempDir("beautify-asar-exec");
    const asarPath = path.join(dir, "app.asar");
    fs.mkdirSync(dir, { recursive: true });
    try {
      const scriptPath = path.join(dir, "run.sh");
      fs.writeFileSync(scriptPath, "#!/bin/sh\necho ok\n", "utf-8");
      try { fs.chmodSync(scriptPath, 0o755); } catch {}

      await createPackageWithOptions(dir, asarPath);

      const { headerJSON } = readHeaderObject(asarPath);
      const executableOnFs = (fs.statSync(scriptPath).mode & 0o111) !== 0;
      assert.equal(headerJSON.files["run.sh"].executable, executableOnFs ? true : undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts unpacked nodes from app.asar.unpacked backing files", () => {
    const dir = tempDir("beautify-asar-unpacked");
    fs.mkdirSync(dir, { recursive: true });
    try {
      const asarPath = path.join(dir, "app.asar");
      const outDir = path.join(dir, "out");
      const unpackedDir = path.join(dir, "app.asar.unpacked");
      fs.mkdirSync(unpackedDir, { recursive: true });
      fs.writeFileSync(path.join(unpackedDir, "native.node"), "native-backing", "utf-8");
      writeAsarFixture(
        asarPath,
        {
          files: {
            "styles.css": { size: 6, offset: "0" },
            "native.node": { size: 14, unpacked: true },
          },
        },
        [Buffer.from("body{}", "utf-8")]
      );

      extractAll(asarPath, outDir);

      assert.equal(fs.readFileSync(path.join(outDir, "styles.css"), "utf-8"), "body{}");
      assert.equal(fs.readFileSync(path.join(outDir, "native.node"), "utf-8"), "native-backing");
      assert.equal(extractFile(asarPath, "native.node").toString("utf-8"), "native-backing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("transforms archives without dropping unpacked, executable, or unknown metadata", () => {
    const dir = tempDir("beautify-asar-transform");
    fs.mkdirSync(dir, { recursive: true });
    try {
      const src = path.join(dir, "src.asar");
      const dest = path.join(dir, "dest.asar");
      writeAsarFixture(
        src,
        {
          files: {
            "styles.css": {
              size: 15,
              offset: "0",
              executable: true,
              integrity: { algorithm: "SHA256", hash: "original" },
              customFlag: "keep-me",
            },
            "native.node": {
              size: 0,
              unpacked: true,
            },
          },
        },
        [Buffer.from("body{color:red}", "utf-8")]
      );

      transformPackage(src, dest, {
        replacements: new Map([["styles.css", Buffer.from("body{color:blue}", "utf-8")]]),
        additions: [{ archivePath: "themes/hana-beautify.css", data: Buffer.from(".x{}", "utf-8") }],
      });

      const { headerJSON } = readHeaderObject(dest);
      assert.equal(headerJSON.files["styles.css"].executable, true);
      assert.deepEqual(headerJSON.files["styles.css"].integrity, { algorithm: "SHA256", hash: "original" });
      assert.equal(headerJSON.files["styles.css"].customFlag, "keep-me");
      assert.equal(headerJSON.files["native.node"].unpacked, true);
      assert.deepEqual(listPackage(dest).sort(), ["native.node", "styles.css", "themes/hana-beautify.css"].sort());
      assert.equal(extractFile(dest, "styles.css").toString("utf-8"), "body{color:blue}");
      assert.equal(extractFile(dest, "themes/hana-beautify.css").toString("utf-8"), ".x{}");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses apply when source asar carries integrity metadata", async () => {
    const pluginDir = tempDir("beautify-plugin-integrity");
    const hanakoDir = tempDir("beautify-hanako-integrity");
    const resourcesDir = path.join(hanakoDir, "resources");
    fs.mkdirSync(path.join(pluginDir, "fonts"), { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({ version: "0.0.0" }), "utf-8");
      fs.writeFileSync(path.join(pluginDir, "theme.css"), ".x{font-family:test}", "utf-8");
      fs.writeFileSync(path.join(pluginDir, "fonts", "test.woff2"), "font", "utf-8");
      writeAsarFixture(
        path.join(resourcesDir, "app.asar"),
        {
          files: {
            "styles.css": {
              size: 6,
              offset: "0",
              integrity: { algorithm: "SHA256", hash: "locked" },
            },
          },
        },
        [Buffer.from("body{}", "utf-8")]
      );

      await assert.rejects(
        () => applyBeautify(pluginDir, { hanakoInstallDir: hanakoDir }),
        /integrity validation metadata/
      );
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(hanakoDir, { recursive: true, force: true });
    }
  });

  it("adaptive apply uses runtime CSS before ASAR patching", async () => {
    const pluginDir = tempDir("beautify-plugin-runtime");
    const hanakoDir = tempDir("beautify-hanako-runtime");
    const resourcesDir = path.join(hanakoDir, "resources");
    fs.mkdirSync(path.join(pluginDir, "fonts"), { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({ version: "0.0.0" }), "utf-8");
      fs.writeFileSync(path.join(pluginDir, "theme.css"), ".x{font-family:test}", "utf-8");
      fs.writeFileSync(path.join(pluginDir, "fonts", "test.woff2"), "font", "utf-8");
      writeAsarFixture(
        path.join(resourcesDir, "app.asar"),
        { files: { "styles.css": { size: 6, offset: "0", integrity: { algorithm: "SHA256", hash: "locked" } } } },
        [Buffer.from("body{}", "utf-8")]
      );
      const inserted = [];
      const ctx = {
        pluginDir,
        renderer: { insertCSS(css) { inserted.push(css); return "css-key"; } },
        bus: {},
        log: { debug() {}, info() {}, warn() {}, error() {} },
      };

      const result = await applyAdaptiveBeautify(ctx, { hanakoInstallDir: hanakoDir });

      assert.equal(result.ok, true);
      assert.equal(result.strategy, "runtime-css");
      assert.equal(inserted.length, 1);
      assert.match(inserted[0], /hana-beautify-runtime:begin/);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(hanakoDir, { recursive: true, force: true });
    }
  });

  it("adaptive status reports blocked ASAR when no runtime CSS capability exists", async () => {
    const pluginDir = tempDir("beautify-plugin-blocked");
    const hanakoDir = tempDir("beautify-hanako-blocked");
    const resourcesDir = path.join(hanakoDir, "resources");
    fs.mkdirSync(path.join(pluginDir, "fonts"), { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({ version: "0.0.0" }), "utf-8");
      fs.writeFileSync(path.join(pluginDir, "theme.css"), ".x{}", "utf-8");
      writeAsarFixture(
        path.join(resourcesDir, "app.asar"),
        { files: { "styles.css": { size: 6, offset: "0", integrity: { algorithm: "SHA256", hash: "locked" } } } },
        [Buffer.from("body{}", "utf-8")]
      );
      const ctx = {
        pluginDir,
        bus: {},
        log: { debug() {}, info() {}, warn() {}, error() {} },
      };

      const status = await getAdaptiveStatus(ctx, { hanakoInstallDir: hanakoDir });
      const result = await applyAdaptiveBeautify(ctx, { hanakoInstallDir: hanakoDir });

      assert.equal(status.asarCompatibility.integrityProtected, true);
      assert.equal(status.bestStrategy, null);
      assert.equal(result.ok, false);
      assert.equal(result.strategy, "blocked");
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(hanakoDir, { recursive: true, force: true });
    }
  });

  it("renderer health detects missing settings i18n keys", () => {
    const dir = tempDir("beautify-renderer-health");
    fs.mkdirSync(dir, { recursive: true });
    try {
      const asarPath = path.join(dir, "app.asar");
      const files = [
        ["desktop/dist-renderer/index.html", "<html></html>"],
        ["desktop/dist-renderer/settings.html", "<html></html>"],
        ["desktop/dist-renderer/lib/i18n.js", "fetch('locales/zh.json')"],
        ["desktop/dist-renderer/locales/zh.json", JSON.stringify({ settings: { title: "设置", tabs: {}, agent: {}, save: "保存" } })],
        ["desktop/dist-renderer/locales/en.json", JSON.stringify({ settings: { title: "Settings", tabs: { agent: "Agent" }, agent: { title: "Agent" }, save: "Save" } })],
      ];
      let offset = 0;
      const header = { files: {} };
      const buffers = [];
      for (const [archivePath, text] of files) {
        const data = Buffer.from(text, "utf-8");
        const parts = archivePath.split("/");
        let node = header;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
          node = node.files[parts[i]];
        }
        node.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
        offset += data.length;
        buffers.push(data);
      }
      writeAsarFixture(asarPath, header, buffers);

      const report = inspectRendererHealth(asarPath);

      assert.equal(report.ok, false);
      assert.ok(report.missingI18nKeys.includes("desktop/dist-renderer/locales/zh.json:settings.tabs.agent"));
      assert.ok(report.missingI18nKeys.includes("desktop/dist-renderer/locales/zh.json:settings.agent.title"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
