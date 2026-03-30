/**
 * executor.ts: Run operations on a macOS host via dispatch.js.
 *
 * All operations go through a single JXA script (dispatch.js) that
 * handles discovery, commands, list/get, and arbitrary execution.
 * User data is base64-encoded and passed as argv, never interpolated.
 * No timeout: if Claude Code kills the tool, the process tree dies.
 */

import { spawn, type ChildProcess } from "node:child_process";
import dispatchScript from "./dispatch.js" with { type: "text" };

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
const children = new Set<ChildProcess>();
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

export class Executor {
  private sshHost?: string;

  constructor(opts: ExecutorOptions = {}) {
    this.sshHost = opts.sshHost;
  }

  get isRemote(): boolean {
    return !!this.sshHost;
  }

  /** Call dispatch.js. No args = discover. Otherwise op + data, all base64. */
  async dispatch(op?: string, data?: unknown): Promise<string> {
    const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
    const args = op ? (data !== undefined ? [b64(op), b64(data)] : [b64(op)]) : [];

    const osascript = ["-l", "JavaScript", "-", ...args];
    const cmd = this.isRemote
      ? { bin: "ssh", args: [this.sshHost!, "osascript", ...osascript] }
      : { bin: "osascript", args: osascript };
    const result = await runProcess(cmd.bin, cmd.args, dispatchScript);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }

}
