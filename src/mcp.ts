#!/usr/bin/env bun
/**
 * osa-mcp: MCP server that generates tools from macOS sdef files.
 *
 * Connects to a macOS host (local or via SSH), reads scripting definitions
 * for specified apps, and dynamically registers MCP tools for each command
 * and class. Also provides a raw `execute` tool for arbitrary AppleScript/JXA.
 *
 * Usage:
 *   osa-mcp [--ssh HOST] [--app APPNAME] [--timeout MS]
 *
 * Examples:
 *   osa-mcp --app Mail                          # Local macOS
 *   osa-mcp --ssh macbook --app Mail --app Calendar  # Remote via SSH config
 *   osa-mcp --ssh user@192.168.1.10 --app Mail       # Remote via user@host
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

const server = new FastMCP({
  name: "osa-mcp",
  version: "0.1.0",
});

// Raw execute tool: run arbitrary AppleScript or JXA
server.addTool({
  name: "execute",
  description: "Execute AppleScript or JXA (JavaScript for Automation) code on the macOS host. Use `language` to select the scripting language.",
  parameters: z.object({
    code: z.string().describe("Script code to execute"),
    language: z.enum(["applescript", "jxa"]).optional().describe("Scripting language (default: jxa)"),
  }),
  execute: async (args) => {
    try {
      return await executor.execute(args.code, args.language ?? "jxa");
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});

// List all scriptable apps on the host
async function listScriptableApps(): Promise<void> {
  console.error("[osa-mcp] Discovering scriptable apps...");
  try {
    const output = await executor.run("find", [
      "/System/Applications", "/Applications",
      "-name", "'*.sdef'", "-type", "f",
    ]);
    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/\/([^/]+)\.app\/Contents\/Resources\/(.+\.sdef)$/);
      if (match) {
        console.error(`  ${match[1]} (${match[2]})`);
      }
    }
  } catch (e: any) {
    console.error(`[osa-mcp] Discovery failed: ${e.message}`);
  }
  process.exit(0);
}

// Discover and register tools from sdef files
async function discoverApps(): Promise<void> {
  if (discover) return listScriptableApps();

  if (apps.length === 0) {
    console.error("[osa-mcp] No apps specified. Use --app or OSA_APPS env var.");
    console.error("[osa-mcp] Starting with execute tool only.");
    return;
  }

  for (const appName of apps) {
    try {
      console.error(`[osa-mcp] Loading sdef for ${appName}...`);

      // Find the app bundle path using osascript (more reliable than mdfind over SSH)
      const appPath = await executor.execute(
        `Application("${appName}").pathTo(this).toString()`,
        "jxa"
      ).catch(() => null) ?? await executor.execute(
        `POSIX path of (path to application "${appName}")`,
        "applescript"
      ).catch(() => null);

      const cleanPath = appPath?.replace(/\/$/, "");

      if (!cleanPath) {
        console.error(`[osa-mcp] App not found: ${appName}`);
        continue;
      }

      // Find the sdef file in the app bundle
      let sdefXml: string | null = null;
      let appId = cleanPath.split("/").pop()?.replace(/\.app$/, "") ?? appName;

      try {
        // Find any .sdef in the Resources directory
        const sdefPath = await executor.run("find", [
          `${cleanPath}/Contents/Resources`, "-name", "'*.sdef'", "-type", "f",
        ]).then((s) => s.split("\n")[0]?.trim());

        if (sdefPath) {
          sdefXml = await executor.readFile(sdefPath);
        }
      } catch {}

      if (!sdefXml) {
        console.error(`[osa-mcp] No sdef found for ${appName} in ${cleanPath}`);
        continue;
      }

      // Parse and register
      const sdef = parseSdef(sdefXml);

      console.error(`[osa-mcp] ${appName}: ${sdef.commands.length} commands, ${sdef.classes.length} classes`);

      registerCommands(server, sdef, appName, appId, executor);
      registerClasses(server, sdef, appName, appId, executor);

      console.error(`[osa-mcp] ${appName}: tools registered`);
    } catch (e: any) {
      console.error(`[osa-mcp] Failed to load ${appName}: ${e.message}`);
    }
  }
}

// Initialize and start
await discoverApps();
server.start({ transportType: "stdio" });
