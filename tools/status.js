import { getStatus } from "../lib/beautify-core.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

const tool = defineTool({
  name: "status",
  description: "Check whether Hana UI Beautify is installed, applied, writable, and ready.",
  parameters: {
  type: "object",
  properties: {
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
  },
  async execute(input = {}, ctx) {
    const status = await getStatus(ctx.pluginDir, input);
    return JSON.stringify(status, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
