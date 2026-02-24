import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ini from "ini";

type TaskName = "crawl" | "snapshot" | "axe_scan" | "filter" | "report";
const TASK_ORDER: TaskName[] = ["crawl", "snapshot", "axe_scan", "filter", "report"];

const INI_PATH = path.resolve("task.ini");

function readIni() {
  const raw = fs.readFileSync(INI_PATH, "utf-8");
  return ini.parse(raw) as Record<string, any>;
}

function writeIni(obj: any) {
  const raw = ini.stringify(obj);
  fs.writeFileSync(INI_PATH, raw, "utf-8");
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function getGlobal(cfg: any) {
  const g = cfg.global ?? {};
  const baseUrl = String(g.base_url ?? "").trim();
  if (!baseUrl) throw new Error("task.ini missing [global].base_url");
  const outputDir = path.resolve(String(g.output_dir ?? "./output"));
  return { baseUrl, outputDir };
}

function getTaskSection(cfg: any, task: TaskName) {
  const section = cfg.task?.[task];
  if (!section) throw new Error(`task.ini missing [task.${task}]`);
  return section;
}

function setStatus(cfg: any, task: TaskName, status: string) {
  cfg.task = cfg.task ?? {};
  cfg.task[task] = cfg.task[task] ?? {};
  cfg.task[task].status = status;
}

async function runNodeScript(scriptPath: string) {
  await import(pathToFileURL(scriptPath).href);
}

function resetAllTasks(cfg: any) {
  for (const t of TASK_ORDER) setStatus(cfg, t, "pending");
}

function findNextPending(cfg: any): TaskName | null {
  for (const t of TASK_ORDER) {
    const s = String(getTaskSection(cfg, t).status ?? "pending");
    if (s === "pending") return t;
    if (s === "running") return t; // allow resume
  }
  return null;
}

function scriptsMap(task: TaskName) {
  return path.resolve("..", "scripts", `${task === "axe_scan" ? "axe-scan" : task}.ts`);
}

async function runCrawlInline() {
  const iniPath = path.resolve("task.ini");
  const raw = fs.readFileSync(iniPath, "utf-8");
  const cfg = ini.parse(raw) as Record<string, any>;
  const baseUrl = String(cfg.global?.base_url ?? "").trim();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const maxPages = Number(cfg.task?.crawl?.max_pages ?? 20);

  ensureDir(outputDir);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const queue: string[] = [baseUrl];
  const visited = new Set<string>();
  const discovered: string[] = [];

  function normalizeUrl(u: string) {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  }

  function isSameOrigin(base: string, target: string) {
    return new URL(base).origin === new URL(target).origin;
  }

  while (queue.length > 0 && discovered.length < maxPages) {
    const current = normalizeUrl(queue.shift()!);
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      await page.goto(current, { waitUntil: "domcontentloaded", timeout: 30000 });
      discovered.push(current);

      const links = await page.$$eval("a[href]", (els: any) =>
        els
          .map((a: any) => a.href)
          .filter((h: any) => typeof h === "string" && h.length > 0)
      );

      for (const l of links) {
        const n = normalizeUrl(l);
        if (!isSameOrigin(baseUrl, n)) continue;
        if (visited.has(n)) continue;
        const proto = new URL(n).protocol;
        if (proto !== "http:" && proto !== "https:") continue;
        queue.push(n);
      }
    } catch {
      discovered.push(current);
    }
  }

  await browser.close();

  const outPath = path.join(outputDir, "urls.json");
  fs.writeFileSync(outPath, JSON.stringify({ baseUrl, urls: discovered }, null, 2), "utf-8");
  console.log(`Wrote ${discovered.length} urls to ${outPath}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = readIni();
  const { outputDir } = getGlobal(cfg);
  ensureDir(outputDir);

  if (args.has("--reset")) {
    resetAllTasks(cfg);
    writeIni(cfg);
    console.log("Reset all tasks to pending.");
    return;
  }

  const runAll = args.has("--all");

  while (true) {
    const next = findNextPending(cfg);
    if (!next) {
      console.log("All tasks done.");
      break;
    }

    console.log(`\n=== Next task: ${next} ===`);
    setStatus(cfg, next, "running");
    writeIni(cfg);

    try {
      if (next === "crawl") {
        await runCrawlInline();
      } else {
        await runNodeScript(scriptsMap(next));
      }
      cfg.task[next].status = "done";
      writeIni(cfg);
      console.log(`=== Task done: ${next} ===`);
    } catch (e: any) {
      cfg.task[next].status = "failed";
      writeIni(cfg);
      console.error(`=== Task failed: ${next} ===`);
      console.error(e?.message ?? e);
      process.exit(1);
    }

    if (!runAll) break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});