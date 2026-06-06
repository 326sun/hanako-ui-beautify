import { getStatus } from "../lib/beautify-core.js";

export const name = "status";
export const description = "Check whether Hana UI Beautify is installed, applied, writable, and ready.";

export const parameters = {
  type: "object",
  properties: {
    hanakoInstallDir: { type: "string", description: "Optional Hanako install directory." },
  },
  required: [],
};

export async function execute(input = {}, ctx) {
  const status = await getStatus(ctx.pluginDir, input);
  return JSON.stringify(status, null, 2);
}
