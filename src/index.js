import { fetchAll } from "./fetch.js";
import { probeAll } from "./probe.js";
import { parseRemote } from "./lib/util.js";
import { emit } from "./emit.js";

function parseArgs(argv) {
  const out = { limit: 100 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      out.limit = parseInt(argv[++i], 10);
      if (!(out.limit > 0)) throw new Error("--limit must be > 0");
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  console.error(`[config] limit=${args.limit}`);

  console.error("[1/4] fetching sources...");
  const raw = await fetchAll();

  console.error("[2/4] validating remote lines...");
  const valid = raw
    .map((s) => ({ ...s, remote: parseRemote(s.ovpn) }))
    .filter((s) => s.remote && s.ovpn.length > 200);
  console.error(`      ${valid.length}/${raw.length} passed validation`);

  if (valid.length === 0) {
    console.error("[fatal] no valid entries; aborting to keep previous configs");
    process.exit(1);
  }

  // Early exit: اگه سرورهای سالمِ کافی داشتیم، لازم نیست همه رو probe کنیم.
  // ولی چون probe موازی و سریعه، فعلاً همه رو probe می‌کنیم و بعد limit اعمال می‌شه.
  console.error("[3/4] probing (TCP + ICMP)...");
  const probed = await probeAll(valid, { concurrency: 32, timeout: 3000 });

  console.error("[4/4] emitting...");
  const kept = await emit(probed, { limit: args.limit });

  process.exit(kept === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
