#!/usr/bin/env bun
/**
 * osa-mcp: MCP server that generates tools from macOS sdef files.
 *
 * Connects to a macOS host (local or via SSH), discovers all scriptable
 * apps via Launch Services, loads their sdefs with XInclude resolution
 * in a single call, and dynamically registers MCP tools.
 *
 * Usage:
 *   osa-mcp                         # local macOS, all apps
 *   osa-mcp --ssh macbook           # remote via SSH config
 *   osa-mcp --ssh user@host         # remote via user@host
 *
 * env OSA_SSH_HOST   SSH host (alternative to --ssh)
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { parseSdef, parseIntrinsics } from "./sdef.js";
import { Executor } from "./executor.js";
import { registerCommands, registerClasses } from "./generator.js";

const args = process.argv.slice(2);
let sshHost = process.env.OSA_SSH_HOST;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ssh") sshHost = args[++i];
}

const executor = new Executor({ sshHost });

const server = new FastMCP({
  name: "osa-mcp",
  version: "0.1.0",
});

server.addTool({
  name: "execute",
  description: "Execute AppleScript or JXA (JavaScript for Automation) code on the macOS host.",
  parameters: z.object({
    code: z.string().describe("Script code to execute"),
    language: z.enum(["applescript", "jxa"]).optional().describe("Scripting language (default: jxa)"),
  }),
  execute: async (args) => {
    try {
      return await executor.dispatch("execute", { code: args.code, language: args.language ?? "jxa" });
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});

async function main(): Promise<void> {
  console.error("[osa-mcp] Loading all scriptable apps...");
  let raw: string;
  try {
    raw = await executor.dispatch();
  } catch (e: any) {
    console.error(`[osa-mcp] Discovery failed: ${e.message}`);
    console.error("[osa-mcp] Starting with execute tool only.");
    server.start({ transportType: "stdio" });
    return;
  }
  const result = JSON.parse(raw) as {
    apps: Array<{ name: string; bundleId: string | null; sdef: string }>;
    errors: Array<{ name: string; error: string }>;
    intrinsics: string | null;
  };

  const intrinsics = result.intrinsics ? parseIntrinsics(result.intrinsics) : new Map();
  console.error(`[osa-mcp] ${intrinsics.size} intrinsic types loaded`);

  console.error(`[osa-mcp] ${result.apps.length} apps loaded`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`  ${e.name}: ${e.error}`);
  }

  for (const app of result.apps) {
    try {
      const sdef = parseSdef(app.sdef);
      const appId = app.bundleId ?? app.name;
      registerCommands(server, sdef, app.name, appId, executor, intrinsics);
      registerClasses(server, sdef, app.name, appId, executor, intrinsics);
      console.error(`  ${app.name}: ${sdef.commands.length} commands, ${sdef.classes.length} classes`);
    } catch (e: any) {
      console.error(`  ${app.name}: failed (${e.message})`);
    }
  }

  server.start({ transportType: "stdio" });
}

await main();
