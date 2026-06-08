import fs from "fs";
import path from "path";
import { definePlugin } from "./lib/hana-runtime-compat.js";
import { PLUGIN_VERSION, initPluginVersion, resolvePaths } from "./lib/beautify-core.js";
import { applyAdaptiveBeautify, getAdaptiveStatus } from "./lib/adaptive-beautify.js";

const runtimeState = {
  autoApplyTimer: null,
};

export default definePlugin({
  async onload(ctx) {

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
      const status = cacheValid ? state.lastStatus : await getAdaptiveStatus(ctx, config);
      state = { ...state, pluginVersion: PLUGIN_VERSION, asarMtimeMs, lastStatus: status, lastChecked: new Date().toISOString() };
      // Cooldown: if a previous background apply failed recently for this same
      // app.asar (unchanged mtime), don't retry on every launch. A Hanako update
      // (new mtime) or 6h elapsed clears the cooldown.
      const AUTO_APPLY_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
      const erroredRecently = !!state.lastErrorAt
        && state.lastErrorAsarMtimeMs === asarMtimeMs
        && Date.now() - new Date(state.lastErrorAt).getTime() < AUTO_APPLY_RETRY_COOLDOWN_MS;
      if (config.autoApply === true && !status.applied && erroredRecently) {
        ctx.log.info(`hanako-ui-beautify: auto apply on cooldown after recent failure (${state.lastError}); skipping this launch`);
      } else if (config.autoApply === true && !status.applied) {
        autoApplyQueued = true;
        // Write base state now: if onunload clears the timer, the cache is not lost
        try { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8"); } catch {}
        runtimeState.autoApplyTimer = setTimeout(async () => {
          let nextState = state;
          try {
            const result = await applyAdaptiveBeautify(ctx, config);
            nextState = { ...nextState, lastAutoApply: new Date().toISOString(), lastResult: result, lastError: null, lastErrorAt: null, lastErrorAsarMtimeMs: null };
            ctx.log.info(`hanako-ui-beautify: ${result.message}`);
          } catch (err) {
            nextState = { ...nextState, lastError: err.message, lastErrorAt: new Date().toISOString(), lastErrorAsarMtimeMs: asarMtimeMs };
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
