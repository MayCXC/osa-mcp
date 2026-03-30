#!/usr/bin/env bun
/**
 * osa-mcp: MCP server that generates tools from macOS sdef files.
 *
 * Connects to a macOS host (local or via SSH), discovers scriptable apps
 * via Launch Services, loads their sdef with XInclude resolution, and
 * dynamically registers MCP tools.
 *
 * Usage:
 *   osa-mcp [--ssh HOST] [--app NAME] [--timeout MS] [--discover]
 *
 * Examples:
 *   osa-mcp --app Mail                          # Local macOS
 *   osa-mcp --ssh macbook --app Mail --app Calendar  # Remote via SSH config
 *   osa-mcp --discover                          # List all scriptable apps
 *
 * env OSA_SSH_HOST   SSH host (alternative to --ssh)
 * env OSA_APPS       Comma-separated app names (alternative to --app)
 * env OSA_TIMEOUT    Timeout in ms (default: 30000)
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { parseSdef } from "./sdef.js";
import { Executor } from "./executor.js";
import { registerCommands, registerClasses } from "./generator.js";
import { DISCOVER_APPS_JXA, buildLoadSdefJxa, buildFindAppJxa } from "./bridge.js";

// Parse CLI args
const args = process.argv.slice(2);
let sshHost = process.env.OSA_SSH_HOST;
const apps: string[] = process.env.OSA_APPS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
let timeout = Number(process.env.OSA_TIMEOUT) || 30000;
let discover = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--ssh":
      sshHost = args[++i];
      break;
    case "--app":
      apps.push(args[++i]);
      break;
    case "--timeout":
      timeout = Number(args[++i]);
      break;
    case "--discover":
      discover = true;
      break;
  }
}

const executor = new Executor({ sshHost, timeout });

// --- Discover mode: list all scriptable apps and exit ---

async function discoverAndList(): Promise<void> {
  console.error("[osa-mcp] Discovering scriptable apps via Launch Services...");
  try {
    const raw = await executor.execute(DISCOVER_APPS_JXA, "jxa");
    const apps = JSON.parse(raw) as Array<{
      name: string;
      bundleId: string | null;
      sdefName: string | null;
      path: string;
    }>;

    const withSdef = apps.filter((a) => a.sdefName);
    const withoutSdef = apps.filter((a) => !a.sdefName);

    console.error(`\n${apps.length} scriptable apps (${withSdef.length} with sdef):\n`);
    for (const a of withSdef.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(`  ${a.name.padEnd(35)} ${(a.sdefName ?? "").padEnd(35)} ${a.bundleId ?? ""}`);
    }
    if (withoutSdef.length > 0) {
      console.error(`\n${withoutSdef.length} scriptable apps without sdef (use execute tool):`);
      for (const a of withoutSdef.sort((a, b) => a.name.localeCompare(b.name))) {
        console.error(`  ${a.name.padEnd(35)} ${a.bundleId ?? ""}`);
      }
    }
  } catch (e: any) {
    console.error(`[osa-mcp] Discovery failed: ${e.message}`);
  }
  process.exit(0);
}

// --- Load an app's sdef via JXA + NSXMLDocument with XInclude ---

async function loadAppSdef(appName: string): Promise<{ sdefXml: string; appId: string } | null> {
  // First, discover the app to get its path and sdef name
  console.error(`[osa-mcp] Discovering ${appName}...`);
  const raw = await executor.execute(DISCOVER_APPS_JXA, "jxa");
  const allApps = JSON.parse(raw) as Array<{
    name: string;
    bundleId: string | null;
    sdefName: string | null;
    path: string;
  }>;

  // Match by name (case-insensitive) or bundle ID
  const match = allApps.find(
    (a) =>
      a.name.toLowerCase() === appName.toLowerCase() ||
      a.bundleId?.toLowerCase() === appName.toLowerCase()
  );

  if (!match) {
    console.error(`[osa-mcp] App not found: ${appName}`);
    return null;
  }

  if (!match.sdefName) {
    console.error(`[osa-mcp] ${match.name} is scriptable but has no sdef (use execute tool)`);
    return null;
  }

  // Load the sdef with XInclude resolution
  console.error(`[osa-mcp] Loading sdef for ${match.name} (${match.sdefName})...`);
  const jxa = buildLoadSdefJxa(match.path, match.sdefName);
  const result = await executor.execute(jxa, "jxa");

  // Check if the result is a JSON error or raw XML
  if (result.startsWith("{")) {
    const err = JSON.parse(result);
    if (err.error) {
      console.error(`[osa-mcp] Failed to load sdef: ${err.error}`);
      return null;
    }
  }

  const appId = match.path.split("/").pop()?.replace(/\.app$/, "") ?? appName;
  return { sdefXml: result, appId };
}

// --- Main ---

const server = new FastMCP({
  name: "osa-mcp",
  version: "0.1.0",
});

// Raw execute tool
server.addTool({
  name: "execute",
  description:
    "Execute AppleScript or JXA (JavaScript for Automation) code on the macOS host. Use `language` to select the scripting language.",
  parameters: z.object({
    code: z.string().describe("Script code to execute"),
    language: z
      .enum(["applescript", "jxa"])
      .optional()
      .describe("Scripting language (default: jxa)"),
  }),
  execute: async (args) => {
    try {
      return await executor.execute(args.code, args.language ?? "jxa");
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});

async function main(): Promise<void> {
  if (discover) return discoverAndList();

  if (apps.length === 0) {
    console.error("[osa-mcp] No apps specified. Use --app or OSA_APPS env var.");
    console.error("[osa-mcp] Use --discover to list scriptable apps.");
    console.error("[osa-mcp] Starting with execute tool only.");
  }

  // Load sdef for each app (reuse the discovery query)
  let discoveryCache: string | null = null;

  for (const appName of apps) {
    try {
      const loaded = await loadAppSdef(appName);
      if (!loaded) continue;

      const sdef = parseSdef(loaded.sdefXml);
      console.error(
        `[osa-mcp] ${appName}: ${sdef.commands.length} commands, ${sdef.classes.length} classes, ${sdef.enums.length} enums`
      );

      registerCommands(server, sdef, appName, loaded.appId, executor);
      registerClasses(server, sdef, appName, loaded.appId, executor);

      console.error(`[osa-mcp] ${appName}: tools registered`);
    } catch (e: any) {
      console.error(`[osa-mcp] Failed to load ${appName}: ${e.message}`);
    }
  }

  server.start({ transportType: "stdio" });
}

await main();
