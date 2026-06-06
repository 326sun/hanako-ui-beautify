import { restoreBeautify } from "../lib/beautify-core.js";

export const name = "restore";
export const description = "Restore official Hanako app.asar from app.asar.bak.";

export const parameters = {
  type: "object",
  properties: {
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
};

export async function execute(input = {}, ctx) {
  const result = await restoreBeautify(ctx.pluginDir, input);
  return JSON.stringify(result, null, 2);
}
