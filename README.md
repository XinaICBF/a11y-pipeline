# a11y-pipeline

Minimal accessibility (a11y) pipeline driven by `task.ini`.

Quick overview
- Crawl pages from `base_url` and write `output/urls.json`.
- Snapshot pages to `output/dom/*.html`.
- Run axe accessibility scans to `output/raw/*.json`.
- Filter axe results to `output/filtered/*.json`.
- Generate an HTML report at `output/report/index.html`.

Prerequisites
- Node.js >= 18
- npm

Install
```bash
npm install
npm run pw:install    # downloads Playwright browsers
```

Usage
- Run the next pending task from `task.ini`:
```bash
npm run run
```
- Run the entire pipeline (all tasks):
```bash
npm run run:all
```
- Reset all tasks to `pending`:
```bash
npm run reset
```

Configuration (`task.ini`)
- Edit `task.ini` to control `base_url`, task order/status, and per-task options.
- The runner reads the first task with `status = pending` or `running` and executes only that one (unless `--all` is passed).

Outputs
- `output/urls.json` — discovered URLs (from crawl)
- `output/dom/*.html` — page snapshots
- `output/raw/*.json` — raw axe results
- `output/filtered/*.json` — filtered, aggregated violations
- `output/report/index.html` — final HTML report

Notes
- Scripts live in `scripts/` and are TypeScript files. The runner uses ts-node to execute them; a few tasks were inlined in `run-task.ts` to avoid environment/loader issues.
- If a script fails, check `task.ini` and the JSON outputs under `output/` for details.

File: [a11y-pipeline/task.ini](task.ini)
