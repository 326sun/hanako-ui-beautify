/**
 * Unit tests for lib/runtime-css.js and the adaptive runtime-applied status
 * signal in lib/adaptive-beautify.js, plus the getStatus diagnostics switch.
 * Run: node --test tests/runtime-css.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildRuntimeThemeCss,
  applyRuntimeCss,
  inspectRuntimeCssSupport,
} from "../lib/runtime-css.js";
import {
  applyAdaptiveBeautify,
  getAdaptiveStatus,
  resetRuntimeCssApplied,
} from "../lib/adaptive-beautify.js";
import { getStatus, initPluginVersion } from "../lib/beautify-core.js";

function tempDir(name) {
  return path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

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

// Minimal renderer-health-compliant asar with a custom styles.css payload.
function buildHealthyAsarFixture(asarPath, stylesCss) {
  const files = [
    ["desktop/dist-renderer/index.html", "<html><head></head><body></body></html>"],
    ["desktop/dist-renderer/settings.html", "<html><head></head><body></body></html>"],
    ["desktop/dist-renderer/lib/i18n.js", "fetch('locales/zh.json')"],
    ["desktop/dist-renderer/locales/zh.json", JSON.stringify({ settings: { title: "设置", tabs: { agent: "Agent" }, agent: { title: "Agent" }, save: "保存" } })],
    ["desktop/dist-renderer/locales/en.json", JSON.stringify({ settings: { title: "Settings", tabs: { agent: "Agent" }, agent: { title: "Agent" }, save: "Save" } })],
    ["desktop/dist-renderer/styles.css", stylesCss],
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
}

// Build a plugin dir with a theme.css referencing one font and that font file.
function makePluginDir(name) {
  const pluginDir = tempDir(name);
  fs.mkdirSync(path.join(pluginDir, "fonts"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({ version: "0.0.0" }), "utf-8");
  fs.writeFileSync(
    path.join(pluginDir, "theme.css"),
    "@font-face{src:url('./fonts/test.woff2')}\n.x{font-family:test}",
    "utf-8"
  );
  fs.writeFileSync(path.join(pluginDir, "fonts", "test.woff2"), "FONTBYTES", "utf-8");
  return pluginDir;
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

describe("buildRuntimeThemeCss", () => {
  it("inlines fonts as base64 data URLs and wraps in runtime markers", () => {
    const pluginDir = makePluginDir("rt-build");
    try {
      const css = buildRuntimeThemeCss(pluginDir);
      assert.match(css, /hana-beautify-runtime:begin/);
      assert.match(css, /hana-beautify-runtime:end/);
      // The font path is replaced with a data URL, not left as a relative path.
      assert.ok(!css.includes("./themes/fonts/test.woff2"));
      const expected = `data:font/woff2;base64,${Buffer.from("FONTBYTES", "utf-8").toString("base64")}`;
      assert.ok(css.includes(expected));
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});

describe("applyRuntimeCss", () => {
  it("uses a direct ctx.renderer.insertCSS target", async () => {
    const pluginDir = makePluginDir("rt-direct");
    try {
      const inserted = [];
      const ctx = { pluginDir, renderer: { insertCSS(css) { inserted.push(css); return "key"; } }, log: silentLog };
      const result = await applyRuntimeCss(ctx);
      assert.equal(result.ok, true);
      assert.equal(result.strategy, "ctx.renderer.insertCSS()");
      assert.equal(inserted.length, 1);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });

  it("prefers ctx.renderer over later targets", async () => {
    const pluginDir = makePluginDir("rt-order");
    try {
      const hits = [];
      const ctx = {
        pluginDir,
        renderer: { insertCSS() { hits.push("renderer"); return 1; } },
        window: { insertCSS() { hits.push("window"); return 2; } },
        log: silentLog,
      };
      const result = await applyRuntimeCss(ctx);
      assert.equal(result.strategy, "ctx.renderer.insertCSS()");
      assert.deepEqual(hits, ["renderer"]);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });

  it("falls back to an advertised bus capability", async () => {
    const pluginDir = makePluginDir("rt-bus");
    try {
      const requests = [];
      const ctx = {
        pluginDir,
        bus: {
          getCapability(type) { return type === "renderer:insert-css" ? { available: true } : null; },
          async request(type, payload) { requests.push({ type, payload }); return "ok"; },
        },
        log: silentLog,
      };
      const result = await applyRuntimeCss(ctx);
      assert.equal(result.ok, true);
      assert.equal(result.strategy, "ctx.bus.request(renderer:insert-css)");
      assert.equal(requests.length, 1);
      assert.match(requests[0].payload.css, /hana-beautify-runtime:begin/);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });

  it("only probes unadvertised bus types when probeRuntimeCss is set", async () => {
    const pluginDir = makePluginDir("rt-probe");
    try {
      let calls = 0;
      const makeCtx = () => ({
        pluginDir,
        bus: { getCapability() { return null; }, hasHandler() { return false; }, async request() { calls++; return "ok"; } },
        log: silentLog,
      });
      // Without the probe flag, no unadvertised request is attempted.
      const noProbe = await applyRuntimeCss(makeCtx());
      assert.equal(noProbe.ok, false);
      assert.equal(calls, 0);
      // With the probe flag, candidate bus types are tried.
      const withProbe = await applyRuntimeCss(makeCtx(), { probeRuntimeCss: true });
      assert.equal(withProbe.ok, true);
      assert.ok(calls >= 1);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });

  it("returns ok:false with a reason when no channel is available", async () => {
    const pluginDir = makePluginDir("rt-none");
    try {
      const ctx = { pluginDir, bus: {}, log: silentLog };
      const result = await applyRuntimeCss(ctx);
      assert.equal(result.ok, false);
      assert.equal(result.strategy, null);
      assert.match(result.reason, /no .*runtime css/i);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});

describe("inspectRuntimeCssSupport", () => {
  it("reports direct targets and advertised bus handlers", () => {
    const ctx = {
      renderer: { insertCSS() {} },
      bus: {
        getCapability(type) { return type === "theme:apply-css" ? { available: true } : null; },
        listCapabilities() { return [{ type: "theme:apply-css", available: true }]; },
      },
    };
    const report = inspectRuntimeCssSupport(ctx);
    assert.equal(report.supported, true);
    assert.ok(report.directTargets.includes("ctx.renderer.insertCSS"));
    assert.ok(report.busHandlers.includes("theme:apply-css"));
  });

  it("reports unsupported when nothing is exposed", () => {
    const report = inspectRuntimeCssSupport({ bus: {} });
    assert.equal(report.supported, false);
    assert.deepEqual(report.directTargets, []);
    assert.deepEqual(report.busHandlers, []);
  });
});

describe("adaptive runtime-applied status signal", () => {
  beforeEach(() => resetRuntimeCssApplied());
  afterEach(() => resetRuntimeCssApplied());

  it("surfaces a runtime-css apply in the subsequent status without flipping durable applied", async () => {
    const pluginDir = makePluginDir("rt-status");
    const hanakoDir = tempDir("rt-status-hanako");
    const resourcesDir = path.join(hanakoDir, "resources");
    fs.mkdirSync(resourcesDir, { recursive: true });
    try {
      initPluginVersion(pluginDir);
      // Integrity-locked asar so the asar path is blocked; runtime-css is the
      // only viable route, which is exactly the scenario this signal targets.
      writeAsarFixture(
        path.join(resourcesDir, "app.asar"),
        { files: { "styles.css": { size: 6, offset: "0", integrity: { algorithm: "SHA256", hash: "locked" } } } },
        [Buffer.from("body{}", "utf-8")]
      );
      const ctx = { pluginDir, renderer: { insertCSS() { return "k"; } }, bus: {}, log: silentLog };

      const before = await getAdaptiveStatus(ctx, { hanakoInstallDir: hanakoDir });
      assert.equal(before.runtimeApplied, null);

      const apply = await applyAdaptiveBeautify(ctx, { hanakoInstallDir: hanakoDir });
      assert.equal(apply.strategy, "runtime-css");

      const after = await getAdaptiveStatus(ctx, { hanakoInstallDir: hanakoDir });
      assert.ok(after.runtimeApplied, "runtimeApplied should be set after a runtime-css apply");
      assert.match(after.summary, /运行时 CSS/);
      // Durable applied stays false so autoApply keeps re-injecting each launch.
      assert.equal(after.applied, false);

      resetRuntimeCssApplied();
      const reset = await getAdaptiveStatus(ctx, { hanakoInstallDir: hanakoDir });
      assert.equal(reset.runtimeApplied, null);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(hanakoDir, { recursive: true, force: true });
    }
  });
});

describe("getStatus diagnostics switch", () => {
  it("skips the expensive selector/renderer probes when diagnostics:false", async () => {
    const pluginDir = makePluginDir("rt-diag");
    const hanakoDir = tempDir("rt-diag-hanako");
    const resourcesDir = path.join(hanakoDir, "resources");
    fs.mkdirSync(resourcesDir, { recursive: true });
    try {
      initPluginVersion(pluginDir);
      buildHealthyAsarFixture(path.join(resourcesDir, "app.asar"), "body{color:red}");

      const full = await getStatus(pluginDir, { hanakoInstallDir: hanakoDir });
      assert.notEqual(full.selectorReport, null);
      assert.notEqual(full.rendererHealth, null);

      const lite = await getStatus(pluginDir, { hanakoInstallDir: hanakoDir }, { diagnostics: false });
      assert.equal(lite.selectorReport, null);
      assert.equal(lite.rendererHealth, null);
      // Core apply/marker state is still computed.
      assert.equal(lite.exists, true);
      assert.equal(lite.markerApplied, false);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      fs.rmSync(hanakoDir, { recursive: true, force: true });
    }
  });
});
