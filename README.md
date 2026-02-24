# a11y-pipeline

Minimal accessibility (a11y) pipeline driven by `task.ini`.

Quick overview
- Crawl pages and write `inputs/urls.json` (user-provided or produced by crawl).
- Snapshot pages to `output/dom/*.html`.
- Run axe accessibility scans and save raw JSON to `output/raw/*.json`.
- Filter and aggregate results to `output/filtered/*.json`.
- Generate an HTML report at `output/report/index.html`.

Prerequisites
- Node.js >= 18
- npm

Install
```powershell
npm install
npm run pw:install    # downloads Playwright browsers
```

Usage
- Run the next pending task from `task.ini`:
```powershell
npm run run
```
- Run the entire pipeline (all tasks):
```powershell
npm run run:all
```
- Reset all tasks to `pending`:
```powershell
npm run reset
```

Files & outputs
- `inputs/urls.json`: canonical URL list used for snapshotting (gitignored).
- `output/dom/`: saved HTML snapshots.
- `output/raw/`: raw axe JSON results per page.
- `output/filtered/`: filtered/aggregated JSON results per page.
- `output/report/index.html`: final HTML report.

Key environment variables & flags
- `A11Y_SHOW=true` : run browsers in headful mode (useful for debugging).
- `A11Y_USER`, `A11Y_PASS`, `A11Y_LOGIN_URL` : credentials and login page URL used by the crawler and `axe-scan` to perform a best-effort login.
- `A11Y_URLS` or `A11Y_EXTRA_PATHS` : comma-separated list of paths to snapshot (relative to `base_url` in `task.ini`).
- `A11Y_CLEAN=true` or `--clean` : remove the previous `output/` directory before running.
- `A11Y_USE_SNAPSHOTS=true` : instruct `axe-scan` to use saved snapshots from `output/dom/` instead of navigating live.
- `A11Y_INCLUDE_ALL=true` or `--include-all` : tell the `filter` step to include all violations (do not filter by WCAG tags).

Filter CLI
- Run only the filter step and include all violations:
```powershell
$env:A11Y_INCLUDE_ALL='true'; node --loader ts-node/esm scripts/filter.ts --include-all
```

Debugging `axe-scan`
- Run `axe-scan` under the Node inspector (ts-node ESM loader):
```powershell
npm run axe:debug
```

Orchestrator & behavior
- `run-task.ts` reads `task.ini` and runs tasks in this order: `crawl`, `snapshot`, `axe_scan`, `filter`, `report`.
- `crawl` now takes a pre-login snapshot, attempts a best-effort login when credentials are provided, snapshots the requested URL list, and writes `inputs/urls.json` (so the input list survives `--clean`).
- The `filter` step by default filters violations by WCAG tags: level `AA` keeps `wcag2aa` and level `A` keeps `wcag2a`. Use `A11Y_INCLUDE_ALL` / `--include-all` to disable tag-based filtering.

Post-run behavior
- After the orchestrator completes a run it automatically resets the last three tasks so the pipeline will start at `axe_scan` on the next invocation. Concretely, `task.axe_scan`, `task.filter`, and `task.report` are set to `pending` when the run finishes. This keeps the pipeline ready to re-run scans and report generation without re-running crawl/snapshot steps.
- If you prefer this to be optional, change the behavior in `run-task.ts` (search for the "Reset tasks" comment) or ask me to add a configuration toggle.

Notes & security
- `inputs/urls.json` is intentionally gitignored to avoid committing sensitive URLs or site-specific paths.
- Login automation is best-effort and uses common selectors; customize if your site uses a non-standard flow.

If you want more examples (task.ini snippets, sample `A11Y_URLS`, or expanded reporting options), tell me what to add.
