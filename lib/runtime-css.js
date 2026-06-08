import fs from "fs";
import path from "path";
import { buildInlineThemeCss } from "./beautify-core.js";

const RUNTIME_BEGIN = "/* hana-beautify-runtime:begin */";
const RUNTIME_END = "/* hana-beautify-runtime:end */";

const CANDIDATE_BUS_TYPES = [
  "renderer:insert-css",
  "renderer:insertCSS",
  "window:insert-css",
  "window:insertCSS",
  "ui:insert-css",
  "ui:insertCSS",
  "theme:insert-css",
  "theme:apply-css",
  "css:insert",
  "app:insert-css",
];

function fontDataUrl(fontPath) {
  const data = fs.readFileSync(fontPath).toString("base64");
  return `data:font/woff2;base64,${data}`;
}

export function buildRuntimeThemeCss(pluginDir) {
  const fontsDir = path.join(pluginDir, "fonts");
  let css = buildInlineThemeCss(path.join(pluginDir, "theme.css"));
  if (fs.existsSync(fontsDir)) {
    for (const file of fs.readdirSync(fontsDir).filter((name) => name.endsWith(".woff2"))) {
      const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const dataUrl = fontDataUrl(path.join(fontsDir, file));
      css = css.replace(new RegExp(`\\.\\/themes\\/fonts\\/${escaped}`, "g"), dataUrl);
    }
  }
  return `${RUNTIME_BEGIN}\n${css}\n${RUNTIME_END}\n`;
}

function capabilityAvailable(ctx, type) {
  try {
    const cap = ctx.bus?.getCapability?.(type);
    if (cap) return cap.available !== false;
  } catch {}
  try {
    if (ctx.bus?.hasHandler?.(type)) return true;
  } catch {}
  return false;
}

async function tryMethod(target, method, css) {
  if (typeof target?.[method] !== "function") return null;
  const result = await target[method](css);
  return { ok: true, strategy: `${method}()`, result };
}

export async function applyRuntimeCss(ctx, input = {}) {
  const css = buildRuntimeThemeCss(ctx.pluginDir);

  for (const [targetName, target] of [
    ["ctx.renderer", ctx.renderer],
    ["ctx.window", ctx.window],
    ["ctx.ui", ctx.ui],
    ["ctx.host", ctx.host],
  ]) {
    for (const method of ["insertCSS", "insertCss", "applyCSS", "applyCss", "addStyle", "addStyleText"]) {
      const result = await tryMethod(target, method, css);
      if (result) return { ...result, strategy: `${targetName}.${result.strategy}` };
    }
  }

  for (const type of CANDIDATE_BUS_TYPES) {
    const shouldProbe = capabilityAvailable(ctx, type) || input.probeRuntimeCss === true;
    if (!shouldProbe || typeof ctx.bus?.request !== "function") continue;
    try {
      const result = await ctx.bus.request(type, {
        id: "hana-beautify",
        css,
        source: "hanako-ui-beautify",
      });
      return { ok: true, strategy: `ctx.bus.request(${type})`, result };
    } catch (err) {
      if (input.probeRuntimeCss === true) {
        ctx.log?.debug?.(`hanako-ui-beautify: runtime CSS probe ${type} failed: ${err.message}`);
      }
    }
  }

  return {
    ok: false,
    strategy: null,
    reason: "No Hanako runtime CSS injection capability was exposed to this plugin.",
  };
}

export function inspectRuntimeCssSupport(ctx) {
  const directTargets = [];
  for (const [targetName, target] of [
    ["ctx.renderer", ctx.renderer],
    ["ctx.window", ctx.window],
    ["ctx.ui", ctx.ui],
    ["ctx.host", ctx.host],
  ]) {
    for (const method of ["insertCSS", "insertCss", "applyCSS", "applyCss", "addStyle", "addStyleText"]) {
      if (typeof target?.[method] === "function") directTargets.push(`${targetName}.${method}`);
    }
  }

  const busHandlers = CANDIDATE_BUS_TYPES.filter((type) => capabilityAvailable(ctx, type));
  let capabilities = [];
  try {
    if (typeof ctx.bus?.listCapabilities === "function") {
      capabilities = ctx.bus.listCapabilities().map((cap) => ({
        type: cap.type,
        available: cap.available !== false,
      }));
    }
  } catch {}

  return {
    supported: directTargets.length > 0 || busHandlers.length > 0,
    directTargets,
    busHandlers,
    capabilities,
  };
}
