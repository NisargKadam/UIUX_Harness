/**
 * Spawning for allowlisted commands. Commands are spawned without a shell.
 * Windows is the exception, because .cmd shims (npx.cmd) cannot run without
 * one; there the command line has already passed the metacharacter check in
 * commandPolicy.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import type { ResolvedCommand } from "../policy/commandPolicy";
import { stripAnsi } from "../text";

export interface RunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const MAX_OUTPUT = 200_000;

function spawnCommand(cmd: ResolvedCommand, cwd: string): ChildProcess {
  const isWindows = process.platform === "win32";
  return spawn(cmd.executable, cmd.args, {
    cwd,
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows, // own process group, so the whole tree can be stopped
    windowsHide: true,
  });
}

/**
 * Stop a process and everything it started. On POSIX the child leads its own
 * process group, so the group is signalled even if the direct child already
 * exited (grandchildren such as esbuild can outlive it). SIGTERM first, SIGKILL
 * after a grace period.
 */
function killTree(child: ChildProcess, graceMs = 3000): void {
  if (child.pid === undefined) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {
      child.kill();
    }
    return;
  }
  const signalGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      // group already gone
    }
  };
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), graceMs).unref();
}

/** Run a command to completion (type check, lint). */
export function runToCompletion(
  cmd: ResolvedCommand,
  cwd: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawnCommand(cmd, cwd);
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let settled = false;
    let hardStop: NodeJS.Timeout | undefined;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardStop) clearTimeout(hardStop);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, output, timedOut, durationMs: Date.now() - started });
    };
    const stop = () => {
      killTree(child);
      // If a grandchild keeps the pipes open, "close" may never fire: resolve anyway.
      hardStop = setTimeout(() => done(child.exitCode), 5000);
      hardStop.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs ?? 180_000);
    const onAbort = () => stop();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      output += `\n${err.message}`;
    });
    child.on("close", (code) => done(code));
  });
}

/** Find a free TCP port on 127.0.0.1, preferring `preferred` and counting up from it. */
export async function findFreePort(preferred = 5180, attempts = 50): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
  for (let p = preferred; p < preferred + attempts; p++) {
    if (await tryPort(p)) return p;
  }
  throw new Error("No free port found for the dev server.");
}

export interface DevServerInfo {
  url: string;
  port: number;
  prototype: string;
}

/**
 * Owns at most one long-running dev server. Starting a server for a different
 * prototype stops the previous one. Recent output is kept so the agent can read
 * compile errors the server prints.
 */
export class DevServerManager {
  private child: ChildProcess | undefined;
  private info: DevServerInfo | undefined;
  private log: string[] = [];

  get current(): DevServerInfo | undefined {
    return this.child && this.child.exitCode === null ? this.info : undefined;
  }

  recentOutput(lines = 40): string {
    return this.log.slice(-lines).join("\n");
  }

  async start(
    cmd: ResolvedCommand,
    cwd: string,
    prototype: string,
    port: number,
    readyPattern: RegExp,
    timeoutMs = 60_000,
  ): Promise<DevServerInfo> {
    const running = this.current;
    if (running && running.prototype === prototype) return running;
    this.stop();
    this.log = [];
    const child = spawnCommand(cmd, cwd);
    this.child = child;

    return new Promise<DevServerInfo>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error, info?: DevServerInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else if (info) resolve(info);
      };
      const onData = (chunk: Buffer) => {
        const text = stripAnsi(chunk.toString("utf8"));
        for (const line of text.split(/\r?\n/)) {
          if (line.trim() !== "") this.log.push(line);
        }
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        const m = readyPattern.exec(text);
        if (m?.[1]) {
          const info: DevServerInfo = { url: m[1].replace(/\/?$/, "/"), port, prototype };
          this.info = info;
          finish(undefined, info);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (err) => finish(new Error(`Dev server failed to start: ${err.message}`)));
      child.on("exit", (code) => {
        finish(new Error(`Dev server exited (code ${code ?? "?"}) before it was ready:\n${this.recentOutput(30)}`));
      });
      const timer = setTimeout(() => {
        // Fall back to probing the port: some servers print the URL in a format we do not recognise.
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          const info: DevServerInfo = { url: `http://127.0.0.1:${port}/`, port, prototype };
          this.info = info;
          finish(undefined, info);
        });
        socket.once("error", () => {
          socket.destroy();
          this.stop();
          finish(new Error(`Dev server did not become ready within ${timeoutMs / 1000}s:\n${this.recentOutput(30)}`));
        });
      }, timeoutMs);
    });
  }

  stop(): void {
    if (this.child) killTree(this.child);
    this.child = undefined;
    this.info = undefined;
  }
}
