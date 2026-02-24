import fs from "node:fs";
import path from "node:path";
import ini from "ini";
import { chromium } from "playwright";

const INI_PATH = path.resolve("task.ini");

function readIni() {
  return ini.parse(fs.readFileSync(INI_PATH, "utf-8")) as Record<string, any>;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeUrl(u: string) {
  // remove hash to avoid duplicates
  const url = new URL(u);
  url.hash = "";
  return url.toString();
}

function isSameOrigin(base: string, target: string) {
  return new URL(base).origin === new URL(target).origin;
}

async function main() {
  const cfg = readIni();
  const baseUrl = String(cfg.global?.base_url ?? "").trim();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const maxPages = Number(cfg["task.crawl"]?.max_pages ?? 20);

  ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const queue: string[] = [baseUrl];
  const visited = new Set<string>();
  const discovered: string[] = [];

  while (queue.length > 0 && discovered.length < maxPages) {
    const current = normalizeUrl(queue.shift()!);
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      await page.goto(current, { waitUntil: "domcontentloaded", timeout: 30000 });
      discovered.push(current);

      const links = await page.$$eval("a[href]", (els) =>
        els
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => typeof h === "string" && h.length > 0)
      );

      for (const l of links) {
        const n = normalizeUrl(l);
        if (!isSameOrigin(baseUrl, n)) continue;
        if (visited.has(n)) continue;
        // avoid mailto/tel etc.
        const proto = new URL(n).protocol;
        if (proto !== "http:" && proto !== "https:") continue;
        queue.push(n);
      }
    } catch {
      // skip unreachable pages, still record attempt
      discovered.push(current);
    }
  }

  await browser.close();
  const inputsDir = path.resolve("inputs");
  ensureDir(inputsDir);
  const outPath = path.join(inputsDir, "urls.json");
  fs.writeFileSync(outPath, JSON.stringify({ baseUrl, urls: discovered }, null, 2), "utf-8");
  console.log(`Wrote ${discovered.length} urls to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
