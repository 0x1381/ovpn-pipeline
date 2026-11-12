import { mkdir, rm, writeFile } from "node:fs/promises";
import { sha1, writeFileSafe } from "./lib/util.js";

const CONFIG_DIR = "./configs";
const JSON_DIR   = "./json";

function rank(s) {
  const pingPenalty = Math.min(s.ping || 9999, 9999);
  return (s.score || 0) * 1e6 - pingPenalty * 1e3 + (s.speedBps || 0) / 1e6;
}

/**
 * @param servers  همه‌ی سرورها (بعد از probe)
 * @param opts.limit  حداکثر تعداد کانفیگ سالم که ذخیره می‌شود (پیش‌فرض 100)
 */
export async function emit(servers, { limit = 100 } = {}) {
  await rm(CONFIG_DIR, { recursive: true, force: true });
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(JSON_DIR,   { recursive: true });

  const healthyAll = servers
    .filter((s) => s.probe?.ok)
    .sort((a, b) => rank(b) - rank(a));

  const healthy = healthyAll.slice(0, limit);

  const rows = [];
  for (const s of healthy) {
    const hash = sha1(s.ovpn).slice(0, 10);
    const name = `${s.countryCC || "XX"}_${hash}.ovpn`;
    await writeFileSafe(`${CONFIG_DIR}/${name}`, s.ovpn);
    rows.push({
      name,
      hostname:  s.hostname,
      ip:        s.ip,
      country:   s.country,
      countryCC: s.countryCC,
      ping:      s.ping,
      speedMbps: (s.speedBps / 1e7).toFixed(2),
      score:     (s.score / 1e5).toFixed(1),
      proto:     s.remote.proto,
      port:      s.remote.port,
      source:    s.source,
    });
  }

  await writeFile(
    `${JSON_DIR}/servers.json`,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        totalProbed: servers.length,
        totalHealthy: healthyAll.length,
        saved: rows.length,
        limit,
        servers: rows,
      },
      null, 2
    )
  );

  await writeFile("./README.md", renderReadme(rows, healthyAll.length, limit));
  console.error(
    `[emit] healthy=${healthyAll.length}  saved=${rows.length}  (limit=${limit})`
  );
  return rows.length;
}

function renderReadme(rows, totalHealthy, limit) {
  const now = new Date().toUTCString();
  const lines = [
    `# OpenVPN Configs (auto-generated)`,
    ``,
    `Auto-refreshed by GitHub Actions. **Only reachable servers are listed.**`,
    ``,
    `- Last update: **${now}**`,
    `- Healthy servers found: **${totalHealthy}**`,
    `- Saved in this repo: **${rows.length}** (limit ${limit})`,
    ``,
    `## Usage`,
    ``,
    `1. Download any \`.ovpn\` from [\`configs/\`](./configs).`,
    `2. Connect: \`sudo openvpn --config <file>\`.`,
    `3. For VPN Gate servers, use username \`vpn\` / password \`vpn\`.`,
    ``,
    `> Data sourced from public APIs (VPN Gate). Use at your own risk.`,
    `> These are volunteer servers — do not send sensitive traffic through them.`,
    ``,
    `## Servers`,
    ``,
    `| Country | Host | IP | Port | Proto | Ping | Speed | Score | Config |`,
    `|---------|------|----|------|-------|------|-------|-------|--------|`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.countryCC} | ${r.hostname} | ${r.ip} | ${r.port} | ${r.proto} | ${r.ping}ms | ${r.speedMbps} | ${r.score} | [⬇](./configs/${r.name}) |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
