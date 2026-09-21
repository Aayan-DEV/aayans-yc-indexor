import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const store = globalThis as unknown as { __motion?: ChildProcess };

/**
 * Starts native/motion (the MacBook's accelerometer and gyro, streamed to the page on 127.0.0.1:3917) alongside the
 * server and stops it with the server. Build it once with `npm run build:motion`. Without the binary, or on a machine
 * without the sensor, nothing happens and the pile keeps ordinary gravity.
 */
export function startMotion() {
  const binary = path.join(/* turbopackIgnore: true */ process.cwd(), "native", "motion");
  if (store.__motion || process.platform !== "darwin" || !fs.existsSync(binary)) return;
  const child = spawn(binary, [], { stdio: ["ignore", "ignore", "pipe"] });
  store.__motion = child;
  child.stderr?.on("data", (line: Buffer) => console.log(`[motion] ${line.toString().trim()}`));
  child.on("exit", () => (store.__motion = undefined)); // also when the port is already taken by a copy started by hand
  const stop = () => child.kill();
  process.once("exit", stop);
  process.once("SIGINT", () => (stop(), process.exit(0)));
  process.once("SIGTERM", () => (stop(), process.exit(0)));
}
