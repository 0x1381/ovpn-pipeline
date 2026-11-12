/**
 * VPN Gate public API.
 * CSV format; configs are base64 in "OpenVPN_ConfigData_Base64".
 * Designed for slow networks: long timeouts, retries, streaming progress, disk cache.
 */
import { cachedFetch } from "../lib/util.js";

const URL = "https://www.vpngate.net/api/iphone/";
const CACHE_PATH = "./.cache/vpngate.csv";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchOnce(timeoutMs) {
  const res = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ovpn-pipeline/1.1)",
      "Accept": "text/csv,text/plain,*/*",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const chunks = [];
  let received = 0;
  let lastLog = Date.now();
  let lastBytes = 0;

  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (Date.now() - lastLog > 3000) {
      const pct = total ? ((received / total) * 100).toFixed(1) : "?";
      const kbps = (((received - lastBytes) / 1024) / ((Date.now() - lastLog) / 1000)).toFixed(1);
      console.error(`[vpngate]   ${(received / 1024).toFixed(0)} KB (${pct}%)  ${kbps} KB/s`);
      lastLog = Date.now();
      lastBytes = received;
    }
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text || text.length < 1000) throw new Error(`small body (${text.length})`);
  if (!text.includes("OpenVPN_ConfigData_Base64")) throw new Error("missing config column");
  return text;
}

async function fetchWithRetry({ attempts = 3, baseTimeout = 600000 } = {}) {
  // 10min, 15min, 20min
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const timeout = baseTimeout + i * 300000;
    try {
      console.error(`[vpngate] attempt ${i + 1}/${attempts} (timeout ${timeout / 60000}min)...`);
      const t0 = Date.now();
      const text = await fetchOnce(timeout);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.error(`[vpngate] OK, ${(text.length / 1024).toFixed(0)} KB in ${secs}s`);
      return text;
    } catch (e) {
      lastErr = e;
      console.error(`[vpngate] attempt ${i + 1} failed: ${e.message}`);
      if (i < attempts - 1) {
        console.error(`[vpngate] retrying in 10s...`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
  throw lastErr;
}

export async function fetchFromVpnGate() {
  const text = await cachedFetch(CACHE_PATH, CACHE_TTL_MS, () => fetchWithRetry());

  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("*"));
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const idx = (name) => headers.indexOf(name);

  const iHost    = idx("HostName");
  const iIp      = idx("IP");
  const iPing    = idx("Ping");
  const iSpeed   = idx("Speed");
  const iCountry = idx("CountryLong");
  const iCC      = idx("CountryShort");
  const iScore   = idx("Score");
  const iConfig  = idx("OpenVPN_ConfigData_Base64");

  if (iConfig < 0) throw new Error("VPN Gate CSV: missing config column");

  const servers = [];
  for (let n = 1; n < lines.length; n++) {
    const cols = lines[n].split(",");
    if (cols.length < headers.length) continue;
    const b64 = cols[iConfig];
    if (!b64 || b64.length < 100) continue;
    let ovpn;
    try { ovpn = Buffer.from(b64, "base64").toString("utf-8"); }
    catch { continue; }
    servers.push({
      hostname:  cols[iHost],
      ip:        cols[iIp],
      ping:      parseInt(cols[iPing], 10) || 0,
      speedBps:  parseInt(cols[iSpeed], 10) || 0,
      country:   cols[iCountry],
      countryCC: cols[iCC],
      score:     parseInt(cols[iScore], 10) || 0,
      ovpn,
      source:    "vpngate",
    });
  }
  console.error(`[vpngate] parsed ${servers.length} entries`);
  return servers;
}
