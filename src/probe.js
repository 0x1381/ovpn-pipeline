import { connect } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapLimit } from "./lib/util.js";

const exec = promisify(execFile);

export function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => finish(true));
    sock.on("timeout", () => finish(false));
    sock.on("error",   () => finish(false));
  });
}

export async function icmpProbe(host, timeoutMs = 2000) {
  try {
    const args =
      process.platform === "win32"
        ? ["-n", "1", "-w", String(timeoutMs), host]
        : ["-c", "1", "-W", String(Math.ceil(timeoutMs / 1000)), host];
    const { stdout } = await exec("ping", args, { timeout: timeoutMs + 1000 });
    const m = stdout.match(/time[=<]\s*([\d.]+)\s*ms/);
    return { ok: true, latency: m ? parseFloat(m[1]) : null };
  } catch {
    return { ok: false, latency: null };
  }
}

export async function probeAll(servers, { concurrency = 32, timeout = 3000 } = {}) {
  return mapLimit(servers, concurrency, async (s) => {
    const { host, port } = s.remote;
    const [tcpOk, icmp] = await Promise.all([
      tcpProbe(host, port, timeout),
      icmpProbe(host, timeout),
    ]);
    const ok = tcpOk || icmp.ok;
    return { ...s, probe: { tcp: tcpOk, icmp: icmp.ok, latency: icmp.latency, ok } };
  });
}
