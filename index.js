import fs from "fs";
import path from "path";
import { applyBeautify, getStatus } from "./lib/beautify-core.js";

export default class HanaUiBeautifyPlugin {
  async onload() {
    const ctx = this.ctx;
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

    try {
      const status = await getStatus(ctx.pluginDir, config);
      state = { ...state, lastStatus: status, lastChecked: new Date().toISOString() };
      if (config.autoApply !== false && !status.applied) {
        this._autoApplyTimer = setTimeout(async () => {
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
        this._autoApplyTimer.unref?.();
        ctx.log.info("hanako-ui-beautify: queued background auto apply");
      } else {
        ctx.log.info(`hanako-ui-beautify: loaded, applied=${status.applied}`);
      }
    } catch (err) {
      state = { ...state, lastError: err.message, lastErrorAt: new Date().toISOString() };
      ctx.log.warn(`hanako-ui-beautify: auto apply skipped: ${err.message}`);
    }

    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    } catch {}
  }

  async onunload() {
    if (this._autoApplyTimer) clearTimeout(this._autoApplyTimer);
  }
}
