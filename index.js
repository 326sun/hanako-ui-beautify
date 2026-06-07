import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { definePlugin } from "./lib/hana-runtime-compat.js";

const pluginRequire = createRequire(import.meta.url);

// Dependency self-check: beautify-core.js depends on @electron/asar.
// If this module is missing (e.g. node_modules not installed), the plugin
// degrades gracefully instead of crashing the entire Hanako process.
let depsOk = true;
try {
  pluginRequire("@electron/asar");
} catch {
  depsOk = false;
}

const runtimeState = {
  autoApplyTimer: null,
};

export default definePlugin({
  async onload(ctx) {
    if (!depsOk) {
      ctx.log.error(
        `[hanako-ui-beautify] Cannot load: @electron/asar not found. ` +
        `Install dependencies: npm install --prefix "${ctx.pluginDir}"`
      );
      return;
    }

    // Dynamic import: keep beautify-core out of the static module graph
    // so a missing @electron/asar doesn't crash the whole plugin load.
    const { PLUGIN_VERSION, initPluginVersion, applyBeautify, getStatus, resolvePaths } =
      await import("./lib/beautify-core.js");

    initPluginVersion(ctx.pluginDir);
    const statePath = path.join(ctx.dataDir, "state.json");
    fs.mkdirSync(ctx.dataDir, { recursive: true });

    let config = { autoApply: false };
    try {
      config = { ...config, ...ctx.config?.getAll?.({ redacted: false }) };
    } catch {}

    let state = {};
    try {
      if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    } catch {}

    let autoApplyQueued = false;
    try {
      const paths = resolvePaths(ctx.pluginDir, config);
      const asarMtimeMs = fs.existsSync(paths.asarPath) ? fs.statSync(paths.asarPath).mtimeMs : 0;
      const cacheValid = state.pluginVersion === PLUGIN_VERSION
        && state.asarMtimeMs === asarMtimeMs
        && state.lastStatus;
      const status = cacheValid ? state.lastStatus : await getStatus(ctx.pluginDir, config);
      state = { ...state, pluginVersion: PLUGIN_VERSION, asarMtimeMs, lastStatus: status, lastChecked: new Date().toISOString() };
      if (config.autoApply === true && !status.applied) {
        autoApplyQueued = true;
        // Write base state now: if onunload clears the timer, the cache is not lost
        try { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8"); } catch {}
        runtimeState.autoApplyTimer = setTimeout(async () => {
          let nextState = state;
          try {
            const result = await applyBeautify(ctx.pluginDir, config);
            nextState = { ...nextState, lastAutoApply: new Date().toISOString(), lastResult: result };
            ctx.log.info(`hanako-ui-beautify: ${result.message}`);
          } catch (err) {
            nextState = { ...nextState, lastError: err.message, lastErrorAt: new Date().toISOString() };
            ctx.log.warn(`hanako-ui-beautify: background auto apply skipped: ${err.message}`);
          }
          try {
            fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2), "utf-8");
          } catch {}
        }, 500);
        runtimeState.autoApplyTimer.unref?.();
        ctx.log.info("hanako-ui-beautify: queued background auto apply");
      } else {
        ctx.log.info(`hanako-ui-beautify: loaded, applied=${status.applied}`);
      }
    } catch (err) {
      state = { ...state, lastError: err.message, lastErrorAt: new Date().toISOString() };
      ctx.log.warn(`hanako-ui-beautify: auto apply skipped: ${err.message}`);
    }

    // Write state only if autoApply was NOT queued (setTimeout will write it with the result)
    if (!autoApplyQueued) {
      try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
      } catch {}
    }
  },

  async onunload(ctx) {
    if (runtimeState.autoApplyTimer) clearTimeout(runtimeState.autoApplyTimer);
    runtimeState.autoApplyTimer = null;
  },
});
