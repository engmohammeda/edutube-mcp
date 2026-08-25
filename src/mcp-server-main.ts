import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(moduleDir, "..", ".env") });
loadDotenv();

// LOCAL PATCH (agent-env fix): ES module imports are hoisted and evaluated
// before loadDotenv() above, so module-scope env reads such as
// `DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro"` in
// video-analysis-core/constants.ts never saw the .env values. Defer the
// server import until after dotenv has populated process.env.
const { createServer } = await import("./server.js");

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
