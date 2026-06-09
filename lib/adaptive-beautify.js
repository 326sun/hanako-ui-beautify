import { applyBeautify, getStatus } from "./beautify-core.js";
import { applyRuntimeCss, inspectRuntimeCssSupport } from "./runtime-css.js";

// Runtime CSS injection is ephemeral: it lives only in the current renderer
// session and is lost on reload/restart, so it leaves no durable marker in
// app.asar. Without tracking it, `getStatus().applied` (asar-marker only) stays
// false even right after a successful runtime-css apply, and the status tool
// misleadingly reports "not applied". We record the apply in process memory so
// the status tool reflects it for the current session. It is intentionally NOT
// persisted: a fresh process must re-inject (and report not-yet-applied) so
// autoApply keeps re-running on every launch.
let runtimeCssApplied = null;

export function markRuntimeCssApplied(info) {
  runtimeCssApplied = { ...info, at: new Date().toISOString() };
}

// Test/util hook: clear the in-memory runtime-applied marker.
export function resetRuntimeCssApplied() {
  runtimeCssApplied = null;
}

export async function getAdaptiveStatus(ctx, input = {}) {
  const status = await getStatus(ctx.pluginDir, input);
  status.runtimeCss = inspectRuntimeCssSupport(ctx);
  status.supportedStrategies = [];
  if (status.runtimeCss.supported) status.supportedStrategies.push("runtime-css");
  // ASAR transform is only viable when compatible AND not code-signed on macOS
  if (status.asarCompatibility?.patchSupported && status.canWrite && !status.asarCompatibility?.codeSignWarning) {
    status.supportedStrategies.push("asar-transform");
  }
  status.bestStrategy = status.supportedStrategies[0] || null;
  if (!status.bestStrategy && !status.actionRequired) {
    status.actionRequired = "No runtime CSS injection capability is available, and ASAR patching is blocked for this Hanako build.";
  }
  // Reflect a runtime-css apply done earlier in this session. `applied` stays
  // asar-only so the autoApply gate keeps re-injecting on each launch; this is a
  // separate, session-scoped signal surfaced to the status tool and summary.
  status.runtimeApplied = runtimeCssApplied;
  if (runtimeCssApplied && !status.applied) {
    status.summary = `✅ 已通过运行时 CSS 注入美化（当前会话生效，重启 Hanako 后自动重新注入）`;
  }
  return status;
}

export async function applyAdaptiveBeautify(ctx, input = {}) {
  const strategy = input.strategy || input.mode || "auto";
  if (strategy !== "asar") {
    const runtime = await applyRuntimeCss(ctx, input);
    if (runtime.ok) {
      markRuntimeCssApplied({ strategy: runtime.strategy });
      const status = await getAdaptiveStatus(ctx, input);
      return {
        ok: true,
        changed: true,
        strategy: "runtime-css",
        runtime,
        status,
        message: `Beautify applied through Hanako runtime CSS injection (${runtime.strategy}).`,
      };
    }
    if (strategy === "runtime") {
      const status = await getAdaptiveStatus(ctx, input);
      return {
        ok: false,
        changed: false,
        strategy: "runtime-css",
        runtime,
        status,
        message: runtime.reason,
      };
    }
  }

  const status = await getAdaptiveStatus(ctx, input);
  if (!status.asarCompatibility?.patchSupported || status.asarCompatibility?.codeSignWarning) {
    return {
      ok: false,
      changed: false,
      strategy: "blocked",
      status,
      message: status.asarCompatibility?.codeSignWarning
        ? status.asarCompatibility.codeSignWarning
        : status.asarCompatibility?.integrityProtected
          ? "This Hanako build has ASAR integrity metadata. Refusing to modify app.asar because it can prevent Hanako from starting."
          : "ASAR patching is not supported for this Hanako build.",
    };
  }

  const result = await applyBeautify(ctx.pluginDir, input);
  return {
    ...result,
    strategy: "asar-transform",
  };
}
