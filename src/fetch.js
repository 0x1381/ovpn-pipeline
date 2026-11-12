import { fetchFromVpnGate } from "./sources/vpngate.js";

const SOURCES = [fetchFromVpnGate];

export async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map((f) => f()));
  const out = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error("[fetch] source failed:", r.reason?.message);
  }
  console.error(`[fetch] total ${out.length} raw entries`);
  return out;
}
