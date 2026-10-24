#!/usr/bin/env node
// Runs osa-mcp: the compiled binary from the platform package installed
// beside this one, as esbuild and Biome publish theirs, or in a checkout,
// which has no platform package, the TypeScript source on bun.
// https://github.com/evanw/esbuild/blob/main/lib/npm/node-platform.ts
// https://github.com/biomejs/biome/blob/main/packages/%40biomejs/biome/bin/biome

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

const { platform, arch } = process;

// The glibc and musl packages share os and cpu, so npm installs both on Linux.
// https://github.com/lovell/detect-libc/blob/main/lib/detect-libc.js
function musl() {
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return false;
  }
}

const pkg = `osa-mcp-${platform === "win32" ? "windows" : platform}-${arch}${platform === "linux" && musl() ? "-musl" : ""}`;
let command;
let args = process.argv.slice(2);
try {
  command = createRequire(import.meta.url).resolve(`${pkg}/osa-mcp${platform === "win32" ? ".exe" : ""}`);
} catch {
  command = process.versions.bun ? process.execPath : "bun";
  args = [fileURLToPath(new URL("../src/mcp.ts", import.meta.url)), ...args];
}

const child = spawn(command, args, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", (e) => {
  console.error(`osa-mcp: no ${pkg} package, and running the source needs bun (${e.message})`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? 128 + (constants.signals[signal] ?? 0)));
