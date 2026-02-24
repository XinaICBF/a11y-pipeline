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
  return path.resolve("scripts", `${task === "axe_scan" ? "axe-scan" : task}.ts`);
  }

async function runCrawlInline() {
  const iniPath = path.resolve("task.ini");
  const raw = fs.readFileSync(iniPath, "utf-8");
  const cfg = ini.parse(raw) as Record<string, any>;
  const baseUrl = String(cfg.global?.base_url ?? "").trim();
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));

  ensureDir(outputDir);
  const domDir = path.join(outputDir, "dom");
  ensureDir(domDir);

  const { chromium } = await import("playwright");
  const show = (process.env.A11Y_SHOW ?? "").toLowerCase() === "true" || process.env.A11Y_SHOW === "1";
  const launchOpts: any = { headless: !show };
  if (show) {
    launchOpts.channel = "chrome";
    launchOpts.devtools = true;
    launchOpts.slowMo = 50;
  }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const crypto = await import("node:crypto");
  const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

  // First: open the login page (or base) and take a pre-login snapshot
  const loginUrl = String(process.env.A11Y_LOGIN_URL ?? baseUrl);
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 20000 });
    const loginHtml = await page.content();
    const loginId = sha1(loginUrl);
    const loginOut = path.join(domDir, `${loginId}.html`);
    fs.writeFileSync(loginOut, loginHtml, "utf-8");
    console.log(`Login snapshot: ${loginUrl} -> ${path.relative(process.cwd(), loginOut)}`);
  } catch (e) {
    console.log(`Login snapshot failed: ${String((e as any)?.message ?? e)}`);
  }

  // Attempt auth if credentials provided
  const envUser = process.env.A11Y_USER;
  const envPass = process.env.A11Y_PASS;
  if (envUser && envPass) {
    try {
      // attempt to find and fill login form fields (best-effort)
      const userSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[name="user"]',
        'input[id*=user]'
      ];
      const passSelectors = ['input[type="password"]', 'input[name="password"]', 'input[id*=pass]'];

      let userSel: string | null = null;
      for (const s of userSelectors) {
        try {
          await page.waitForSelector(s, { timeout: 2000 });
          userSel = s;
          break;
        } catch {}
      }

      let passSel: string | null = null;
      for (const s of passSelectors) {
        try {
          await page.waitForSelector(s, { timeout: 2000 });
          passSel = s;
          break;
        } catch {}
      }

      if (userSel && passSel) {
        await page.fill(userSel, envUser);
        await page.fill(passSel, envPass);
        // try common submit buttons
        const submitSelectors = ['button[type=submit]', 'input[type=submit]', 'button[id*=login]', 'button[class*=login]'];
        let clicked = false;
        for (const s of submitSelectors) {
          const el = await page.$(s);
          if (el) {
            await el.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          const special = await page.$('button.agnav-login-btn');
          if (special) await special.click();
        }
        try {
          await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch {}
        console.log('Auth attempt completed (credentials used from env).');
      } else {
        console.log('Auth skipped: login form fields not found.');
      }
    } catch (e) {
      console.log('Auth attempt failed:', String((e as any)?.message ?? e));
    }
  }

  // After login, use only the user-specified URL list for snapshotting.
  // Read URLs from env var `A11Y_URLS` (comma-separated) or fallback to defaults.
  const rawList = process.env.A11Y_URLS ?? process.env.A11Y_EXTRA_PATHS ?? "/home,/advisor-dashboard,/programme,/organisation";
  const parts = String(rawList).split(",").map((p) => p.trim()).filter(Boolean);
  const urls: string[] = [];
  for (const p of parts) {
    try {
      const full = new URL(p, baseUrl).toString();
      urls.push(full);
    } catch {
      // ignore
    }
  }

  const captured: string[] = [];
  for (const url of urls) {
    const id = sha1(url);
    const outFile = path.join(domDir, `${id}.html`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      const html = await page.content();
      fs.writeFileSync(outFile, html, 'utf-8');
      console.log(`Snapshot: ${url} -> ${path.relative(process.cwd(), outFile)}`);
      captured.push(url);
    } catch (e) {
      fs.writeFileSync(outFile, `<!-- SNAPSHOT FAILED: ${url} -->\n`, 'utf-8');
      console.log(`Snapshot failed: ${url}`);
      captured.push(url);
    }
  }

  await browser.close();

  // write urls.json with the user-provided list (captured) to inputs/ (not output/)
  const inputsDir = path.resolve("inputs");
  ensureDir(inputsDir);
  const outPath = path.join(inputsDir, "urls.json");
  fs.writeFileSync(outPath, JSON.stringify({ baseUrl, urls: captured }, null, 2), "utf-8");
  console.log(`Wrote ${captured.length} urls to ${outPath}`);

  // mark snapshot task done so the separate snapshot step is skipped
  try {
    const cfg2 = ini.parse(fs.readFileSync(iniPath, 'utf-8')) as Record<string, any>;
    cfg2.task = cfg2.task ?? {};
    cfg2.task.snapshot = cfg2.task.snapshot ?? {};
    cfg2.task.snapshot.status = 'done';
    fs.writeFileSync(iniPath, ini.stringify(cfg2), 'utf-8');
  } catch {}
}

async function runSnapshotInline() {
  const iniPath = path.resolve("task.ini");
  const raw = fs.readFileSync(iniPath, "utf-8");
  const cfg = ini.parse(raw) as Record<string, any>;
  const outputDir = path.resolve(String(cfg.global?.output_dir ?? "./output"));
  const waitStrategy = String(cfg.task?.snapshot?.wait_strategy ?? "networkidle");

  const inputsDir = path.resolve("inputs");
  const urlsPath = path.join(inputsDir, "urls.json");
  if (!fs.existsSync(urlsPath)) throw new Error("Missing inputs/urls.json. Provide URL list or run crawl first.");

  const { urls } = JSON.parse(fs.readFileSync(urlsPath, "utf-8")) as { urls: string[] };

  const domDir = path.join(outputDir, "dom");
  ensureDir(domDir);

  const { chromium } = await import("playwright");
  const show = (process.env.A11Y_SHOW ?? "").toLowerCase() === "true" || process.env.A11Y_SHOW === "1";
  const launchOpts: any = { headless: !show };
  if (show) {
    launchOpts.channel = "chrome";
    launchOpts.devtools = true;
    launchOpts.slowMo = 50;
  }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const crypto = await import("node:crypto");
  const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

  for (const url of urls) {
    const id = sha1(url);
    const outFile = path.join(domDir, `${id}.html`);
    try {
      await page.goto(url, { waitUntil: waitStrategy as any, timeout: 45000 });
      const html = await page.content();
      fs.writeFileSync(outFile, html, "utf-8");
      console.log(`Snapshot: ${url} -> ${path.relative(process.cwd(), outFile)}`);
    } catch (e) {
      fs.writeFileSync(outFile, `<!-- SNAPSHOT FAILED: ${url} -->\n`, "utf-8");
      console.log(`Snapshot failed: ${url}`);
    }
  }

  await browser.close();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = readIni();
  const { outputDir } = getGlobal(cfg);
  // If requested, remove previous output before proceeding.
  const shouldClean = args.has("--clean") || (String(process.env.A11Y_CLEAN ?? "").toLowerCase() === "true");
  if (shouldClean) {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log(`Removed previous output directory: ${outputDir}`);
    } catch (e) {
      console.log(`Failed to clean output directory: ${String((e as any)?.message ?? e)}`);
    }
  }
  ensureDir(outputDir);

  if (args.has("--reset")) {
    resetAllTasks(cfg);
    writeIni(cfg);
    console.log("Reset all tasks to pending.");
    return;
  }

  let runAll = args.has("--all");
  const autoAfterCrawl = Boolean(cfg.global?.auto_run_after_crawl);

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
      } else if (next === "snapshot") {
        await runSnapshotInline();
      } else {
        await runNodeScript(scriptsMap(next));
      }
      cfg.task[next].status = "done";
      writeIni(cfg);
      console.log(`=== Task done: ${next} ===`);
      // If user requested auto-run after crawl, enable running remaining tasks
      if (next === "crawl" && autoAfterCrawl) {
        runAll = true;
      }
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