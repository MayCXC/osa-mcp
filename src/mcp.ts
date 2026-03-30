#!/usr/bin/env bun
/**
 * osa-mcp: MCP server that generates tools from macOS sdef files.
 *
 * Connects to a macOS host (local or via SSH), discovers all scriptable
 * apps via Launch Services, loads their sdefs with XInclude resolution
 * in a single call, and dynamically registers MCP tools.
 *
 * Usage:
 *   osa-mcp [--ssh HOST] [--timeout MS] [--discover]
 *
 * Examples:
 *   osa-mcp                                      # Local macOS, all apps
 *   osa-mcp --ssh macbook                         # Remote, all apps
 *   osa-mcp --discover                            # List scriptable apps
 *
 * env OSA_SSH_HOST   SSH host (alternative to --ssh)
 * env OSA_TIMEOUT    Timeout in ms (default: 30000)
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { parseSdef } from "./sdef.js";
import { Executor } from "./executor.js";
import { registerCommands, registerClasses } from "./generator.js";
import { DISCOVER_AND_LOAD_JXA, DISCOVER_APPS_JXA } from "./bridge.js";

// Parse CLI args
const args = process.argv.slice(2);
let sshHost = process.env.OSA_SSH_HOST;
let timeout = Number(process.env.OSA_TIMEOUT) || 30000;
let discover = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--ssh":
      sshHost = args[++i];
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

const server = new FastMCP({
  name: "osa-mcp",
  version: "0.1.0",
});

// Raw execute tool (always available)
server.addTool({
  name: "execute",
  description:
    "Execute AppleScript or JXA (JavaScript for Automation) code on the macOS host.",
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

// --- Discover mode ---

async function discoverAndList(): Promise<void> {
  console.error("[osa-mcp] Discovering scriptable apps via Launch Services...");
  const raw = await executor.execute(DISCOVER_APPS_JXA, "jxa");
  const apps = JSON.parse(raw) as Array<{
    name: string;
    bundleId: string | null;
    sdefName: string | null;
  }>;

  const withSdef = apps.filter((a) => a.sdefName);
  const withoutSdef = apps.filter((a) => !a.sdefName);

  console.error(`\n${apps.length} scriptable apps (${withSdef.length} with sdef):\n`);
  for (const a of withSdef.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`  ${a.name.padEnd(35)} ${(a.sdefName ?? "").padEnd(35)} ${a.bundleId ?? ""}`);
  }
  if (withoutSdef.length > 0) {
    console.error(`\n${withoutSdef.length} scriptable without sdef (use execute tool)`);
  }
  process.exit(0);
}

// --- Load all apps in one call ---

async function loadAllApps(): Promise<void> {
  console.error("[osa-mcp] Loading all scriptable apps...");
  const raw = await executor.execute(DISCOVER_AND_LOAD_JXA, "jxa");
  const result = JSON.parse(raw) as {
    apps: Array<{ name: string; bundleId: string | null; sdef: string }>;
    errors: Array<{ name: string; error: string }>;
  };
  const apps = result.apps;

  console.error(`[osa-mcp] ${apps.length} apps loaded`);
  if (result.errors.length > 0) {
    console.error(`[osa-mcp] ${result.errors.length} apps failed to load:`);
    for (const e of result.errors) {
      console.error(`  ${e.name}: ${e.error}`);
    }
  }

  let totalTools = 0;
  for (const app of apps) {
    try {
      const sdef = parseSdef(app.sdef);
      const appId = app.name;
      registerCommands(server, sdef, app.name, appId, executor);
      registerClasses(server, sdef, app.name, appId, executor);
      const toolCount = sdef.commands.length + sdef.classes.length * 2;
      totalTools += toolCount;
      console.error(`  ${app.name}: ${sdef.commands.length} commands, ${sdef.classes.length} classes`);
    } catch (e: any) {
      console.error(`  ${app.name}: failed (${e.message})`);
    }
  }

  console.error(`[osa-mcp] ~${totalTools} tools registered`);
}

// --- Main ---

async function main(): Promise<void> {
  if (discover) return discoverAndList();
  await loadAllApps();
  server.start({ transportType: "stdio" });
}

await main();
