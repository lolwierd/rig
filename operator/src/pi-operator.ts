import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";

export interface PiOperatorOptions {
  cwd: string;
  extensionPath: string;
  sessionFile?: string;
}

export interface PiOperatorProcess {
  id: string;
  process: ChildProcess;
  cwd: string;
  sessionFile?: string;
  sessionId?: string;
  alive: boolean;
  stderr: string;
  events: EventEmitter;
  pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  nextRequestId: number;
}

let bridgeCounter = 0;

async function findPiBinary(): Promise<string> {
  return new Promise((resolve, reject) => {
    const which = spawn("which", ["pi"]);
    let stdout = "";
    which.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    which.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error("Could not find 'pi' binary"));
      }
    });
  });
}

export async function spawnOperatorPi(options: PiOperatorOptions): Promise<PiOperatorProcess> {
  const piPath = await findPiBinary();
  const id = `operator_${++bridgeCounter}`;

  const args = ["--mode", "rpc", "-e", options.extensionPath];
  if (options.sessionFile) {
    args.push("--session", options.sessionFile);
  }

  const child = spawn(piPath, args, {
    cwd: options.cwd,
    env: { ...process.env, RIG_URL: process.env.RIG_URL || "http://localhost:3100" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const bridge: PiOperatorProcess = {
    id,
    process: child,
    cwd: options.cwd,
    sessionFile: options.sessionFile,
    sessionId: undefined,
    alive: true,
    stderr: "",
    events: new EventEmitter(),
    pendingRequests: new Map(),
    nextRequestId: 0,
  };

  const rejectAll = (reason: string): void => {
    for (const pending of bridge.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    bridge.pendingRequests.clear();
  };

  child.stderr?.on("data", (chunk) => {
    bridge.stderr += chunk.toString();
  });

  const rl = readline.createInterface({ input: child.stdout!, terminal: false });
  rl.on("line", (line) => {
    try {
      const payload = JSON.parse(line);
      if (payload.type === "response" && payload.id && bridge.pendingRequests.has(payload.id)) {
        const pending = bridge.pendingRequests.get(payload.id)!;
        bridge.pendingRequests.delete(payload.id);
        clearTimeout(pending.timer);
        pending.resolve(payload);
        return;
      }
      bridge.events.emit("event", payload);
    } catch {
      // Ignore non-JSON logs.
    }
  });

  child.on("error", (error) => {
    bridge.alive = false;
    bridge.stderr += `\n[process error] ${error.message}`;
    rejectAll(`Pi process error: ${error.message}`);
    bridge.events.emit("exit", { code: null, signal: null, error: error.message });
  });

  child.on("exit", (code, signal) => {
    bridge.alive = false;
    rejectAll(`Pi exited (code=${code}, signal=${signal})`);
    bridge.events.emit("exit", { code, signal });
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!bridge.alive) {
    throw new Error(`Operator pi exited during startup. stderr: ${bridge.stderr}`);
  }

  return bridge;
}

export function sendCommand(bridge: PiOperatorProcess, command: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
  if (!bridge.alive) {
    return Promise.reject(new Error("Operator pi is not alive"));
  }

  const id = `req_${++bridge.nextRequestId}`;
  const full = { ...command, id };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pendingRequests.delete(id);
      reject(new Error(`Timeout waiting for command response: ${String(command.type)}`));
    }, timeoutMs);

    bridge.pendingRequests.set(id, { resolve, reject, timer });

    try {
      bridge.process.stdin?.write(JSON.stringify(full) + "\n");
    } catch (error: any) {
      clearTimeout(timer);
      bridge.pendingRequests.delete(id);
      reject(new Error(`Failed sending command ${String(command.type)}: ${error?.message || String(error)}`));
    }
  });
}

export function sendRaw(bridge: PiOperatorProcess, payload: Record<string, unknown>): void {
  if (!bridge.alive) return;
  bridge.process.stdin?.write(JSON.stringify(payload) + "\n");
}

export function killPi(bridge: PiOperatorProcess): void {
  if (!bridge.alive) return;
  bridge.process.kill("SIGTERM");
  setTimeout(() => {
    if (bridge.alive) {
      bridge.process.kill("SIGKILL");
    }
  }, 2000);
}
