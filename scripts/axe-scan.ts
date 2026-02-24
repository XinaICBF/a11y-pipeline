import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ini from "ini";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const INI_PATH = path.resolve("task.ini");

function readIni() {
  return ini.parse(fs.readFileSync(INI_PATH, "utf-8")) as Record<string, any>;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function main() {
  const cfg = readIni();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const inputsDir = path.resolve("inputs");
  const includeTags = parseCsv(String(cfg["task.axe_scan"]?.include ?? "wcag2a,wcag2aa"));

  const urlsPath = path.join(inputsDir, "urls.json");
  if (!fs.existsSync(urlsPath)) throw new Error("Missing inputs/urls.json. Provide URL list or run crawl first.");

  const { urls } = JSON.parse(fs.readFileSync(urlsPath, "utf-8")) as { urls: string[] };

  const rawDir = path.join(outputDir, "raw");
  ensureDir(rawDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const url of urls) {
    const id = sha1(url);
    const outFile = path.join(rawDir, `${id}.json`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });

      const results = await new AxeBuilder({ page }).withTags(includeTags).analyze();

      fs.writeFileSync(
        outFile,
        JSON.stringify(
          {
            url,
            timestamp: new Date().toISOString(),
            includeTags,
            results
          },
          null,
          2
        ),
        "utf-8"
      );
      console.log(`Axe: ${url} -> ${path.relative(process.cwd(), outFile)}`);
    } catch (e) {
      fs.writeFileSync(
        outFile,
        JSON.stringify({ url, error: String((e as any)?.message ?? e) }, null, 2),
        "utf-8"
      );
      console.log(`Axe failed: ${url}`);
    }
  }

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
