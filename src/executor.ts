/**
 * executor.ts: Run operations on a macOS host via dispatch.js.
 *
 * All operations go through a single JXA script (dispatch.js) that
 * handles discovery, commands, list/get, and arbitrary execution.
 * User data is base64-encoded and passed as argv, never interpolated.
 * No timeout: if Claude Code kills the tool, the process tree dies.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

export type Language = "applescript" | "jxa";

export interface ExecutorOptions {
  sshHost?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Track child processes. Kill them when the MCP client disconnects
// (stdin closes) or the process receives a signal.
const children = new Set<import("node:child_process").ChildProcess>();
function killChildren() {
  for (const child of children) child.kill("SIGKILL");
}
process.on("exit", killChildren);
process.on("SIGTERM", killChildren);
process.on("SIGINT", killChildren);
process.stdin.on("end", killChildren);
process.stdin.on("close", killChildren);

function runProcess(cmd: string, args: string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    children.add(proc);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      children.delete(proc);
      resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: code ?? 1 });
    });
    proc.on("error", (err) => {
      children.delete(proc);
      reject(err);
    });

    if (stdin !== undefined) {
      proc.stdin!.write(stdin);
      proc.stdin!.end();
    }
  });
}

const DISPATCH_PATH = join(import.meta.dir, "dispatch.js");

export class Executor {
  private sshHost?: string;

  constructor(opts: ExecutorOptions = {}) {
    this.sshHost = opts.sshHost;
  }

  get isRemote(): boolean {
    return !!this.sshHost;
  }

  /** Call dispatch.js with an operation and optional data. All argv are base64. */
  async dispatch(op: string, data?: unknown): Promise<string> {
    const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
    const args = data !== undefined ? [b64(op), b64(data)] : [b64(op)];

    const result = this.isRemote
      ? await runProcess(
          "ssh", [this.sshHost!, "osascript", "-l", "JavaScript", "-", ...args],
          await Bun.file(DISPATCH_PATH).text()
        )
      : await runProcess("/usr/bin/osascript", ["-l", "JavaScript", DISPATCH_PATH, ...args]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }

  /** Run arbitrary AppleScript or JXA. */
  async execute(code: string, language: Language = "jxa"): Promise<string> {
    if (language === "jxa") return this.dispatch("execute", { code });

    const result = this.isRemote
      ? await runProcess("ssh", [this.sshHost!, "osascript", "-l", "AppleScript", "-"], code)
      : await runProcess("/usr/bin/osascript", ["-l", "AppleScript", "-e", code]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }
}
