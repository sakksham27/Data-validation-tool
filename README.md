# Data Health Lab — AI Data Quality Assistant

A zero-cost, fully working data quality tool:

- Upload **Excel (.xlsx/.xls)**, **CSV**, or **PDF** files
- Optionally connect a **Postgres-compatible database** and pick which tables to check
- Detects **missing values**, **schema drift** (vs. your last run), and **outliers/anomalies**
- Suggests **SQL fixes** (rule-based — works with zero AI, zero cost)
- Optional **AI narrative notes** via free Cloudflare Workers AI
- Auto-generates a **Markdown documentation report** and a **downloadable .sql fix file**

Everything in `/frontend` runs 100% client-side. The `/worker` backend is **optional** —
only needed if you want database connections or AI-written notes. Without it, file
upload + rule-based diagnostics work completely, for free, forever.

---

## Part 1 — Deploy the frontend (GitHub Pages, free)

1. Create a new GitHub repo (e.g. `data-health-lab`) and push the contents of `/frontend`
   to its root (or to a `/docs` folder — either works).
   ```bash
   cd frontend
   git init
   git add .
   git commit -m "Data Health Lab"
   git branch -M main
   git remote add origin https://github.com/<you>/data-health-lab.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Source: Deploy from branch → main → / (root)**.
3. Wait ~1 minute. Your tool is live at `https://<you>.github.io/data-health-lab/`.

That's it — file upload, profiling, anomaly detection, drift detection, SQL suggestions,
and markdown/SQL export all work immediately with **no backend at all**.

---

## Part 2 — (Optional) Deploy the Worker for database connections + AI notes

Requires a free Cloudflare account (no credit card needed for the free tier used here).

1. Install Wrangler and log in:
   ```bash
   cd worker
   npm install
   npx wrangler login
   ```
2. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler will print your Worker URL, e.g. `https://data-health-lab-worker.<you>.workers.dev`.
3. Workers AI is enabled automatically via the `[ai]` binding in `wrangler.toml` — no extra
   signup, it's included in every Cloudflare account's free monthly allowance.
4. Open your GitHub Pages site → **AI settings tab** → paste the Worker URL → **Save**.
   Now the **Connect database** tab and **Generate AI notes** button will work.

### Database support notes
- Currently supports **Postgres-compatible** databases (Neon, Supabase, RDS Postgres,
  Cloud SQL Postgres, self-hosted Postgres reachable from the internet).
- The connection string is sent directly to your own Worker over HTTPS and used only
  for the duration of that one request — it is never logged or stored server-side.
  It IS stored in your browser's memory for the session so you don't have to retype it,
  but never written to localStorage.
- Want MySQL/SQL Server support too? Swap `postgres` in `worker/src/index.js` for a
  driver like `mysql2` (works the same way over Cloudflare's TCP sockets) and add a
  second code path — the frontend's `db-client.js` doesn't care which driver backs it.

---

## How the checks work

| Check | Method |
|---|---|
| Missing values | Blank/NULL/NA-style detection per column, with % missingness |
| Schema drift | Compares current column set/types against the last run for the same dataset name (stored in your browser's localStorage) |
| Outliers/anomalies | IQR (Tukey fence) + z-score (>3σ) + domain heuristics (e.g. age > 120, negative prices) |
| SQL fix suggestions | Rule-based: median-impute numeric, mode/`'Unknown'`-impute categorical, `CHECK` constraints + review queries for outliers |
| Documentation | Auto-generated Markdown report: column profile table, anomalies, drift, and suggested fixes |
| AI narrative notes | Optional — profile JSON is sent to your Worker, which calls Cloudflare Workers AI (Llama 3.1 8B, free tier) to write a plain-English summary |

## Try it with the example from the brief

Paste this as a 1-column CSV (`customer_age.csv`):

```
customer_age
23
24
NULL
500
27
```

Upload it — you'll see: 1 missing value flagged, `500` flagged as an outlier (both by
IQR fence and by the age > 120 domain rule), and a suggested SQL fix to median-impute
the NULL and a review query + `CHECK` constraint for the outlier.

## Project structure

```
frontend/
  index.html         UI shell
  styles.css          Design system (data-diagnostics theme)
  app.js               Glue: tabs, upload, DB flow, rendering, exports
  quality-engine.js   Core: profiling, anomalies, drift, fix suggestions, docs
  file-parsers.js      Excel/CSV via SheetJS, PDF table extraction via pdf.js
  db-client.js          Talks to the optional Worker backend
worker/
  src/index.js         Cloudflare Worker: DB table listing, sampling, AI proxy
  wrangler.toml         Worker config (includes free Workers AI binding)
  package.json
```

## Limitations (being upfront)

- **PDF table extraction** is best-effort (position-based clustering of text). Clean,
  ruled tables extract well; scanned images or complex multi-line cells may need manual
  cleanup — the tool falls back to raw text extraction when it can't detect a table.
- **Schema drift** compares against your own browser's last run (localStorage), not a
  central history — clearing browser storage resets the baseline.
- **Database support** ships with Postgres-compatible drivers only out of the box.
- Workers AI free tier has a daily request cap; rule-based suggestions have no cap since
  they run entirely in your browser.
