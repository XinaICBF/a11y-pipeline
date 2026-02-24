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

  const show = (process.env.A11Y_SHOW ?? "").toLowerCase() === "true" || process.env.A11Y_SHOW === "1";
  const launchOpts: any = { headless: !show };
  if (show) {
    launchOpts.channel = "chrome";
    launchOpts.devtools = true;
    launchOpts.slowMo = 50;
  }
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext();
  const page = await context.newPage();

  // If credentials are provided, attempt to login first so subsequent navigations are authenticated.
  const envUser = process.env.A11Y_USER;
  const envPass = process.env.A11Y_PASS;
  if (envUser && envPass) {
    try {
      const loginUrl = String(process.env.A11Y_LOGIN_URL ?? cfg.global?.base_url ?? "");
      if (loginUrl) {
        await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 20000 });

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
          const submitSelectors = ['button[type=submit]', 'input[type=submit]', 'button[id*=login]', 'button[class*=login]'];
          let clicked = false;
          for (const s of submitSelectors) {
            const el = await page.$(s);
            if (el) {
              const beforeUrl = page.url();
              await Promise.all([
                el.click(),
                // wait for navigation or timeout
                (async () => {
                  try {
                    await page.waitForNavigation({ timeout: 5000 });
                  } catch {}
                })()
              ]);
              const afterUrl = page.url();
              if (afterUrl !== beforeUrl) {
                console.log(`Axe-scan: auth appears successful (redirected ${beforeUrl} -> ${afterUrl}).`);
              } else {
                console.log(`Axe-scan: click performed but no redirect detected (still ${afterUrl}).`);
              }
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            const special = await page.$('button.agnav-login-btn');
            if (special) {
              const beforeUrl = page.url();
              await Promise.all([
                special.click(),
                (async () => {
                  try {
                    await page.waitForNavigation({ timeout: 5000 });
                  } catch {}
                })()
              ]);
              const afterUrl = page.url();
              if (afterUrl !== beforeUrl) {
                console.log(`Axe-scan: auth appears successful (redirected ${beforeUrl} -> ${afterUrl}).`);
              } else {
                console.log(`Axe-scan: special login clicked but no redirect detected (still ${afterUrl}).`);
              }
            }
          }
        } else {
          console.log('Axe-scan: auth skipped, login form fields not found.');
        }
      }
    } catch (e) {
      console.log('Axe-scan: auth attempt failed:', String((e as any)?.message ?? e));
    }
  }

  for (const url of urls) {
    const id = sha1(url);
    const outFile = path.join(rawDir, `${id}.json`);
    try {
      // If requested, use rendered snapshot HTML instead of navigating to the live URL.
      const useSnapshots = String(process.env.A11Y_USE_SNAPSHOTS ?? "").toLowerCase() === "true";
      const domPath = path.join(outputDir, "dom", `${id}.html`);
      if (useSnapshots && fs.existsSync(domPath)) {
        const html = fs.readFileSync(domPath, "utf-8");
        await page.setContent(html, { waitUntil: "networkidle" });
      } else {
        await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      }

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
