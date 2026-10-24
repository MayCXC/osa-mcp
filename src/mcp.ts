#!/usr/bin/env bun
/**
 * osa-mcp: MCP server for the scriptable apps on a Mac.
 *
 * Connects to a macOS host (local or via SSH) and serves its scriptable apps
 * through two tools: search runs code over the apps' AppleScript
 * dictionaries, which it reads from the Mac on every search, and execute runs
 * JXA or AppleScript there.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import pkg from "../package.json" with { type: "json" };
import { Dictionaries, type App } from "./dictionaries.js";
import { Executor } from "./executor.js";
import { registerExecuteTool, registerSearchTool } from "./tools.js";

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
const dictionaries = new Dictionaries(executor);

/** The server for the connection, its search tool naming the apps found as it starts. */
async function createServer(): Promise<McpServer> {
  let apps: App[] = [];
  try {
    apps = (await dictionaries.load()).apps;
  } catch (e) {
    console.error(`[osa-mcp] Discovery failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const server = new McpServer({ name: "osa-mcp", version: pkg.version });
  registerSearchTool(server, dictionaries, apps);
  registerExecuteTool(server, executor);
  return server;
}

serveStdio(createServer);
console.error("[osa-mcp] serving on stdio");
