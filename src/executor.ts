/**
 * executor.ts: Run AppleScript or JXA on a macOS host.
 *
 * Supports local execution (when running on macOS) or remote via SSH.
 * Uses temp files for robustness with long scripts.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Language = "applescript" | "jxa";

export interface ExecutorOptions {
  /** SSH host (from ~/.ssh/config or user@host). Omit for local execution. */
  sshHost?: string;
  /** Timeout in milliseconds. Default 30000. */
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runProcess(
  cmd: string,
  args: string[],
  timeout: number
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2000);
      reject(new Error(`Execution timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class Executor {
  private sshHost?: string;
  private timeout: number;

  constructor(opts: ExecutorOptions = {}) {
    this.sshHost = opts.sshHost;
    this.timeout = opts.timeout ?? 30000;
  }

  /** Check if we're running remotely. */
  get isRemote(): boolean {
    return !!this.sshHost;
  }

  /** Execute a script. If data is provided, it's base64-encoded and
   *  passed as argv[0]. The script must use `function run(argv)` to receive it. */
  async execute(code: string, language: Language = "jxa", data?: unknown): Promise<string> {
    const langFlag = language === "jxa" ? "JavaScript" : "AppleScript";
    const dataArg = data !== undefined
      ? Buffer.from(JSON.stringify(data)).toString("base64")
      : undefined;

    if (this.isRemote) {
      return this.executeRemote(code, langFlag, dataArg);
    }
    return this.executeLocal(code, langFlag, dataArg);
  }

  /** Read a file from the macOS host. */
  async readFile(path: string): Promise<string> {
    if (this.isRemote) {
      const result = await runProcess(
        "ssh",
        [this.sshHost!, "cat", path],
        this.timeout
      );
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read ${path}: ${result.stderr}`);
      }
      return result.stdout;
    }
    return Bun.file(path).text();
  }

  /** Run a command on the macOS host and return stdout. */
  async run(cmd: string, args: string[]): Promise<string> {
    if (this.isRemote) {
      const result = await runProcess(
        "ssh",
        [this.sshHost!, cmd, ...args],
        this.timeout
      );
      if (result.exitCode !== 0) {
        throw new Error(`${cmd} failed: ${result.stderr}`);
      }
      return result.stdout;
    }
    const result = await runProcess(cmd, args, this.timeout);
    if (result.exitCode !== 0) {
      throw new Error(`${cmd} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  private async executeLocal(code: string, langFlag: string, dataArg?: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "osa-"));
    const ext = langFlag === "JavaScript" ? ".js" : ".scpt";
    const path = join(dir, `script${ext}`);

    try {
      await writeFile(path, code, "utf-8");
      const args = ["-l", langFlag, path];
      if (dataArg) args.push(dataArg);
      const result = await runProcess("/usr/bin/osascript", args, this.timeout);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `osascript exited with code ${result.exitCode}`);
      }
      return result.stdout;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async executeRemote(code: string, langFlag: string, dataArg?: string): Promise<string> {
    const sshArgs = [this.sshHost!, "osascript", "-l", langFlag, "-"];
    if (dataArg) sshArgs.push(dataArg);

    return new Promise((resolve, reject) => {
      const proc = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 2000);
        reject(new Error(`Remote execution timed out after ${this.timeout}ms`));
      }, this.timeout);

      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        if (exitCode !== 0) {
          reject(new Error(stderr || `osascript exited with code ${exitCode}`));
        } else {
          resolve(stdout.trimEnd());
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.stdin.write(code);
      proc.stdin.end();
    });
  }
}
