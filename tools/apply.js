import { applyBeautify } from "../lib/beautify-core.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

const tool = defineTool({
  name: "apply",
  description: "Apply Hana UI Beautify to the installed official Hanako app.asar.",
  parameters: {
  type: "object",
  properties: {
    force: { type: "boolean", description: "Reapply even when beautify marker already exists." },
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
  },
  async execute(input = {}, ctx) {
    const result = await applyBeautify(ctx.pluginDir, input);
    return JSON.stringify(result, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
