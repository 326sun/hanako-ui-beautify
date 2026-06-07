import { restoreBeautify } from "../lib/beautify-core.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

const tool = defineTool({
  name: "restore",
  description: "Restore official Hanako app.asar from app.asar.bak.",
  parameters: {
  type: "object",
  properties: {
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
  },
  async execute(input = {}, ctx) {
    const result = await restoreBeautify(ctx.pluginDir, input);
    return JSON.stringify(result, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
