import fs from "node:fs";
import path from "node:path";
import ini from "ini";

const INI_PATH = path.resolve("task.ini");

function readIni() {
  return ini.parse(fs.readFileSync(INI_PATH, "utf-8")) as Record<string, any>;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

type AxeViolation = {
  id: string;
  impact?: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  helpUrl?: string;
  tags: string[];
  nodes: Array<{ html: string; target: string[] }>;
};

function impactRank(impact?: string | null) {
  switch (impact) {
    case "critical":
      return 4;
    case "serious":
      return 3;
    case "moderate":
      return 2;
    case "minor":
      return 1;
    default:
      return 0;
  }
}

async function main() {
  const cfg = readIni();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const level = String(cfg["task.filter"]?.level ?? "AA").toUpperCase();

  const rawDir = path.join(outputDir, "raw");
  if (!fs.existsSync(rawDir)) throw new Error("Missing output/raw. Run axe_scan first.");

  const filteredDir = path.join(outputDir, "filtered");
  ensureDir(filteredDir);

  const files = fs.readdirSync(rawDir).filter((f) => f.endsWith(".json"));

  for (const f of files) {
    const full = path.join(rawDir, f);
    const data = JSON.parse(fs.readFileSync(full, "utf-8")) as any;

    const url = data.url ?? "unknown";
    const results = data.results;
    const violations: AxeViolation[] = results?.violations ?? [];

    let filtered: AxeViolation[] = violations;

    if (level === "AA") {
      filtered = violations.filter((v) => (v.tags ?? []).includes("wcag2aa"));
    } else if (level === "A") {
      filtered = violations.filter((v) => (v.tags ?? []).includes("wcag2a"));
    }

    // sort by impact desc, then id
    filtered.sort((a, b) => {
      const d = impactRank(b.impact) - impactRank(a.impact);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

    const out = {
      url,
      level,
      counts: {
        total: filtered.length,
        critical: filtered.filter((v) => v.impact === "critical").length,
        serious: filtered.filter((v) => v.impact === "serious").length,
        moderate: filtered.filter((v) => v.impact === "moderate").length,
        minor: filtered.filter((v) => v.impact === "minor").length
      },
      violations: filtered.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl ?? null,
        tags: v.tags ?? [],
        nodes: (v.nodes ?? []).slice(0, 10).map((n) => ({
          target: n.target,
          html: n.html
        }))
      }))
    };

    const outFile = path.join(filteredDir, f);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf-8");
    console.log(`Filtered: ${url} -> ${path.relative(process.cwd(), outFile)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
