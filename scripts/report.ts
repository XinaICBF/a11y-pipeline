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

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const cfg = readIni();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));

  const filteredDir = path.join(outputDir, "filtered");
  if (!fs.existsSync(filteredDir)) throw new Error("Missing output/filtered. Run filter first.");

  const reportDir = path.join(outputDir, "report");
  ensureDir(reportDir);

  const files = fs.readdirSync(filteredDir).filter((f) => f.endsWith(".json"));

  const pages = files.map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(filteredDir, f), "utf-8")) as any;
    return p;
  });

  // Sort pages by total desc
  pages.sort((a, b) => (b.counts?.total ?? 0) - (a.counts?.total ?? 0));

  const total = pages.reduce((sum, p) => sum + (p.counts?.total ?? 0), 0);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>A11y Report</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; }
    .meta { color: #444; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    th { background: #f6f6f6; text-align: left; }
    .pill { display:inline-block; padding:2px 8px; border-radius: 999px; background:#eee; font-size:12px; }
    details { margin: 8px 0; }
    code { background: #f6f6f6; padding: 1px 4px; border-radius: 4px; }
    .impact-critical { font-weight: 700; }
    .impact-serious { font-weight: 600; }
  </style>
</head>
<body>
  <h1>A11y Report (Minimal)</h1>
  <div class="meta">
    Pages: ${pages.length} &nbsp;|&nbsp; Total AA violations: ${total} &nbsp;|&nbsp; Generated: ${escapeHtml(
      new Date().toISOString()
    )}
  </div>

  <h2>Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Page</th>
        <th>Total</th>
        <th>Critical</th>
        <th>Serious</th>
        <th>Moderate</th>
        <th>Minor</th>
      </tr>
    </thead>
    <tbody>
      ${pages
        .map(
          (p) => `<tr>
        <td>${escapeHtml(p.url)}</td>
        <td><span class="pill">${p.counts.total}</span></td>
        <td>${p.counts.critical}</td>
        <td>${p.counts.serious}</td>
        <td>${p.counts.moderate}</td>
        <td>${p.counts.minor}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <h2>Details</h2>
  ${pages
    .map((p) => {
      const rows = (p.violations ?? [])
        .map((v: any) => {
          const impact = v.impact ?? "unknown";
          const impactClass =
            impact === "critical"
              ? "impact-critical"
              : impact === "serious"
              ? "impact-serious"
              : "";
          const nodeList = (v.nodes ?? [])
            .map(
              (n: any) =>
                `<li><div><code>${escapeHtml((n.target ?? []).join(", "))}</code></div><div><pre>${escapeHtml(
                  n.html ?? ""
                )}</pre></div></li>`
            )
            .join("");

          return `<details>
  <summary class="${impactClass}">${escapeHtml(v.id)} <span class="pill">${escapeHtml(
            impact
          )}</span> — ${escapeHtml(v.help)}</summary>
  <div>${escapeHtml(v.description)}</div>
  ${
    v.helpUrl
      ? `<div>Help: <a href="${escapeHtml(v.helpUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
          v.helpUrl
        )}</a></div>`
      : ""
  }
  <div>Tags: ${escapeHtml((v.tags ?? []).join(", "))}</div>
  <ul>${nodeList}</ul>
</details>`;
        })
        .join("");

      return `<section style="margin-bottom:24px;">
  <h3>${escapeHtml(p.url)} <span class="pill">total ${p.counts.total}</span></h3>
  ${rows || "<div>No AA violations.</div>"}
</section>`;
    })
    .join("")}

</body>
</html>`;

  const outFile = path.join(reportDir, "index.html");
  fs.writeFileSync(outFile, html, "utf-8");
  console.log(`Report written: ${path.relative(process.cwd(), outFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
