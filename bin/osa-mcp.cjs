#!/usr/bin/env node
// Runs the osa-mcp binary from the platform package installed beside this
// one. Biome's launcher, with osa-mcp's packages:
// https://github.com/biomejs/biome/blob/7d55c429c0a7232f8b68d5779ff92c00305ccd54/packages/%40biomejs/biome/bin/biome
const { platform, arch } = process;
const { execSync } = require("child_process");

function isMusl() {
  let stderr;
  try {
    stderr = execSync("ldd --version", {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    stderr = err.stderr;
  }
  if (stderr.indexOf("musl") > -1) {
    return true;
  }
  return false;
}

const PLATFORMS = {
  win32: {
    x64: "osa-mcp-windows-x64/osa-mcp.exe",
    arm64: "osa-mcp-windows-arm64/osa-mcp.exe",
  },
  darwin: {
    x64: "osa-mcp-darwin-x64/osa-mcp",
    arm64: "osa-mcp-darwin-arm64/osa-mcp",
  },
  linux: {
    x64: "osa-mcp-linux-x64/osa-mcp",
    arm64: "osa-mcp-linux-arm64/osa-mcp",
  },
  "linux-musl": {
    x64: "osa-mcp-linux-x64-musl/osa-mcp",
    arm64: "osa-mcp-linux-arm64-musl/osa-mcp",
  },
};

const binPath =
  platform === "linux" && isMusl()
    ? PLATFORMS?.["linux-musl"]?.[arch]
    : PLATFORMS?.[platform]?.[arch];

if (binPath) {
  const result = require("child_process").spawnSync(
    require.resolve(binPath),
    process.argv.slice(2),
    {
      shell: false,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  // We check `signal` instead of `status` because a child killed by a signal
  // has a null `status`, which Node turns into exit code 0. The shell
  // convention for that case is 128 + signal number.
  if (result.signal) {
    const signalNumber = require("os").constants.signals[result.signal];
    process.exitCode = signalNumber ? 128 + signalNumber : 1;
  } else {
    process.exitCode = result.status;
  }
} else {
  console.error(
    "osa-mcp doesn't ship with a prebuilt binary for your platform yet. " +
      "You can still run it with Bun from a clone of https://github.com/MayCXC/osa-mcp.",
  );
  process.exitCode = 1;
}
