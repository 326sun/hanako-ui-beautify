import { applyBeautify, getStatus } from "./beautify-core.js";
import { applyRuntimeCss, inspectRuntimeCssSupport } from "./runtime-css.js";

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
  return status;
}

export async function applyAdaptiveBeautify(ctx, input = {}) {
  const strategy = input.strategy || input.mode || "auto";
  if (strategy !== "asar") {
    const runtime = await applyRuntimeCss(ctx, input);
    if (runtime.ok) {
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
