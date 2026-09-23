import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SERVER_INFO } from "@engmohammeda/edutube-core";

async function readPackageJson(relativePath: string): Promise<{ version?: string }> {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as { version?: string };
}

/**
 * Guards against version drift between the MCP server identity, the npm package
 * and the registry manifest (a real defect that shipped in 0.4.0: SERVER_INFO
 * still advertised "youtube-analyzer-gemini" 0.3.0).
 */
export async function run(): Promise<void> {
  const root = await readPackageJson("../../package.json");
  const registry = await readPackageJson("../../server.json");

  assert.equal(SERVER_INFO.name, "edutube-mcp");
  assert.equal(SERVER_INFO.version, root.version, "SERVER_INFO.version must match package.json");
  assert.equal(registry.version, root.version, "server.json version must match package.json");
  const packages = (registry as unknown as { packages?: Array<{ version?: string }> }).packages ?? [];
  for (const entry of packages) {
    assert.equal(entry.version, root.version, "server.json package version must match package.json");
  }
}
