import { createHash } from "node:crypto";
import { writeFile, mkdir, stat, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const sha1 = (s) => createHash("sha1").update(s).digest("hex");

export async function writeFileSafe(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export function parseRemote(ovpn) {
  const m = ovpn.match(/^\s*remote\s+(\S+)\s+(\d+)/m);
  if (!m) return null;
  const host = m[1];
  const port = parseInt(m[2], 10);
  if (!(port > 0 && port < 65536)) return null;
  const p = ovpn.match(/^\s*proto\s+(\S+)/m);
  const proto = (p?.[1] || "udp").toLowerCase().replace(/[46]$/, "");
  return { host, port, proto };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// خواندن از cache اگه تازه بود، وگرنه fetch + ذخیره
export async function cachedFetch(cachePath, ttlMs, fetchFn) {
  try {
    const st = await stat(cachePath);
    const age = Date.now() - st.mtimeMs;
    if (age < ttlMs) {
      console.error(`[cache] hit ${cachePath} (age ${(age / 60000).toFixed(0)}min)`);
      return await readFile(cachePath, "utf-8");
    }
    console.error(`[cache] stale ${cachePath} (age ${(age / 60000).toFixed(0)}min)`);
  } catch {
    console.error(`[cache] miss ${cachePath}`);
  }
  const data = await fetchFn();
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, data);
  console.error(`[cache] saved ${cachePath} (${(data.length / 1024).toFixed(0)} KB)`);
  return data;
}
