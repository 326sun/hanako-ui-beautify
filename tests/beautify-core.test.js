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
} from "../lib/beautify-core.js";
import fs from "fs";
import path from "path";
import os from "os";

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
