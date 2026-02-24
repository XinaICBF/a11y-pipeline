import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ini from "ini";
import { chromium } from "playwright";

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

async function main() {
  const cfg = readIni();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const waitStrategy = String(cfg["task.snapshot"]?.wait_strategy ?? "networkidle");

  const urlsPath = path.join(outputDir, "urls.json");
  if (!fs.existsSync(urlsPath)) throw new Error("Missing output/urls.json. Run crawl first.");

  const { urls } = JSON.parse(fs.readFileSync(urlsPath, "utf-8")) as { urls: string[] };

  const domDir = path.join(outputDir, "dom");
  ensureDir(domDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const url of urls) {
    const id = sha1(url);
    const outFile = path.join(domDir, `${id}.html`);
    try {
      await page.goto(url, { waitUntil: waitStrategy as any, timeout: 45000 });
      const html = await page.content();
      fs.writeFileSync(outFile, html, "utf-8");
      console.log(`Snapshot: ${url} -> ${path.relative(process.cwd(), outFile)}`);
    } catch (e) {
      // still write something to keep pipeline going
      fs.writeFileSync(outFile, `<!-- SNAPSHOT FAILED: ${url} -->\n`, "utf-8");
      console.log(`Snapshot failed: ${url}`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
