import { applyBeautify } from "../lib/beautify-core.js";

export const name = "apply";
export const description = "Apply Hana UI Beautify to the installed official Hanako app.asar.";

export const parameters = {
  type: "object",
  properties: {
    force: { type: "boolean", description: "Reapply even when beautify marker already exists." },
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
};

export async function execute(input = {}, ctx) {
  const result = await applyBeautify(ctx.pluginDir, input);
  return JSON.stringify(result, null, 2);
}
