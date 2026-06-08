import { applyAdaptiveBeautify } from "../lib/adaptive-beautify.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

const tool = defineTool({
  name: "apply",
  description: "Apply Hana UI Beautify using the safest supported strategy for this Hanako build.",
  parameters: {
  type: "object",
  properties: {
    force: { type: "boolean", description: "Reapply even when beautify marker already exists." },
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
    strategy: { type: "string", enum: ["auto", "runtime", "asar"], description: "Preferred apply strategy. auto tries runtime CSS first, then safe ASAR transform." },
    probeRuntimeCss: { type: "boolean", description: "Try candidate runtime CSS bus requests even when they are not advertised." },
  },
  required: [],
  },
  async execute(input = {}, ctx) {
    const result = await applyAdaptiveBeautify(ctx, input);
    return JSON.stringify(result, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
