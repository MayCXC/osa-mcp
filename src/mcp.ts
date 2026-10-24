#!/usr/bin/env bun
/**
 * osa-mcp: MCP server for the scriptable apps on a Mac.
 *
 * Connects to a macOS host (local or via SSH), discovers all scriptable
 * apps via Launch Services, and loads their sdefs with XInclude resolution
 * in a single call. The tools serve those dictionaries: dictionary browses
 * them, command, list and get run what they define, and execute runs any
 * JXA or AppleScript.
 */

import { FastMCP } from "fastmcp";
import pkg from "../package.json" with { type: "json" };
import { Dictionary, type Discovery } from "./dictionary.js";
import { Executor } from "./executor.js";
import { addTools } from "./tools.js";

const usage = `osa-mcp ${pkg.version}: MCP server for the scriptable apps on a Mac

Usage:
  osa-mcp                    serve the apps of this Mac
  osa-mcp --ssh macbook      serve a Mac over SSH, by a host from your SSH config
  osa-mcp --ssh user@host    serve a Mac over SSH, by user and host

Environment:
  OSA_SSH_HOST               SSH host, in place of --ssh`;

const args = process.argv.slice(2);
let sshHost = process.env.OSA_SSH_HOST;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(usage);
    process.exit(0);
  }
  if (args[i] === "--ssh") sshHost = args[++i];
}

const executor = new Executor({ sshHost });

async function main(): Promise<void> {
  console.error("[osa-mcp] Loading all scriptable apps...");
  let dictionary: Dictionary | undefined;
  try {
    dictionary = new Dictionary(JSON.parse(await executor.dispatch()) as Discovery);
  } catch (e: any) {
    console.error(`[osa-mcp] Discovery failed: ${e.message}`);
    console.error("[osa-mcp] Starting with execute tool only.");
  }
  if (dictionary) {
    console.error(`[osa-mcp] ${dictionary.apps.length} apps loaded`);
    for (const app of dictionary.apps) {
      console.error(`  ${app.name}: ${app.sdef.commands.length} commands, ${app.sdef.classes.length} classes`);
    }
    for (const e of dictionary.errors) console.error(`  ${e.name}: ${e.error}`);
  }

  const server = new FastMCP({
    name: "osa-mcp",
    version: pkg.version as `${number}.${number}.${number}`,
    instructions: dictionary?.instructions() ?? "execute runs JXA or AppleScript on the Mac; its scriptable apps could not be discovered.",
  });
  addTools(server, executor, dictionary);
  server.start({ transportType: "stdio" });
}

main();
