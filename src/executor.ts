/**
 * executor.ts: Run operations on a macOS host via dispatch.js.
 *
 * All operations go through a single JXA script (dispatch.js) that
 * handles discovery, commands, list/get, and arbitrary execution.
 * User data is base64-encoded and passed as argv, never interpolated.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

export type Language = "applescript" | "jxa";

export interface ExecutorOptions {
  sshHost?: string;
  timeout?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runProcess(
  cmd: string,
  args: string[],
  stdin?: string,
  timeout = 30000
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2000);
      reject(new Error(`Timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
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
  private timeout: number;

  constructor(opts: ExecutorOptions = {}) {
    this.sshHost = opts.sshHost;
    this.timeout = opts.timeout ?? 30000;
  }

  get isRemote(): boolean {
    return !!this.sshHost;
  }

  /** Call dispatch.js with an operation and optional data. */
  async dispatch(op: string, data?: unknown): Promise<string> {
    const args: string[] = [op];
    if (data !== undefined) {
      args.push(Buffer.from(JSON.stringify(data)).toString("base64"));
    }

    let result: ExecResult;
    if (this.isRemote) {
      // Pipe dispatch.js via stdin, pass op and data as argv after "-"
      const script = await Bun.file(DISPATCH_PATH).text();
      result = await runProcess(
        "ssh",
        [this.sshHost!, "osascript", "-l", "JavaScript", "-", ...args],
        script,
        this.timeout
      );
    } else {
      result = await runProcess(
        "/usr/bin/osascript",
        ["-l", "JavaScript", DISPATCH_PATH, ...args],
        undefined,
        this.timeout
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }

  /** Run arbitrary AppleScript or JXA. For the execute tool. */
  async execute(code: string, language: Language = "jxa"): Promise<string> {
    if (language === "jxa") {
      return this.dispatch("execute", { code, language });
    }
    // AppleScript goes directly through osascript, not dispatch.js
    const langFlag = "AppleScript";
    let result: ExecResult;
    if (this.isRemote) {
      result = await runProcess(
        "ssh",
        [this.sshHost!, "osascript", "-l", langFlag, "-"],
        code,
        this.timeout
      );
    } else {
      result = await runProcess(
        "/usr/bin/osascript",
        ["-l", langFlag, "-e", code],
        undefined,
        this.timeout
      );
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
    }
    return result.stdout;
  }
}
