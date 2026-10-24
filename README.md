# Schema.ai

Schema.ai is a privacy-aware data analyst workspace for asking plain-English questions about structured data and authorized PostgreSQL/Supabase sources. This repository contains the working chat workspace, SQL editor, Supabase migration, and integration artifacts.

## Current implementation status

Implemented in this workspace:

- Browser SaaS shell served by a dependency-free Node server.
- Supabase email authentication using the supplied project URL and anon key through `.env.local`.
- Explicit demo mode with synthetic school, sales, and inventory datasets. Demo mode is visibly labeled and never pretends to be live database execution.
- CSV upload and local schema/type/quality profiling in demo mode.
- Gemini Flash 3.8 cleaning-plan flow that preserves the raw file, applies only safe deterministic operations, and downloads a reusable cleaned CSV artifact.
- Deterministic schema-aware query planner for common filters, aggregates, rankings, and year-over-year comparisons.
- Server-side Gemini structured intent adapter. The Gemini key is never sent to the browser and the model cannot directly execute SQL.
- Optional OpenAI-compatible custom provider configuration. The key is kept in browser session storage and the configured model appears in the Chat selector.
- SQL preview, validation checks, explainability, confidence breakdown, query history, and CSV export.
- Supabase migration for tenant metadata, dataset rows, query provenance, quality reports, plugin sessions, RLS, and an RPC entry point for future server-side execution.
- Excel task-pane and Google Sheets sidebar integrations that can import selected ranges or previously downloaded cleaned CSV/JSON files, preview them, ask the shared plugin API, and explicitly write imported values to the host sheet.
- Node built-in regression tests for planner, quality checks, date resolution, CSV parsing, and SQL safety rules.

Not silently claimed as complete:

- The provided anon key cannot run migrations or create tables. Apply `supabase/migrations/001_datapilot.sql` in the Supabase SQL editor or with a privileged Supabase connection before using live persistence.
- Gemini is configured server-side through `GEMINI_API_KEY` in `.env.local`. A real provider smoke request was attempted, but the current environment timed out on the model POST request; the app reports provider failure honestly and uses the deterministic planner only as an explicitly labeled demo fallback.
- There is no LLM provider key in the workspace, so the live app uses the deterministic planner only for the clearly labeled demo workflow. A production AI adapter still needs to be connected behind a server-side provider boundary.
- Real Excel and Google Sheets host smoke tests still require those host applications, a configured Vercel API origin, and their platform authorization flows. The adapters are implemented for sideload/bound-script testing; marketplace publication is not claimed.
- No Spring Boot service is fabricated in this constrained workspace because Java/Maven are unavailable and no backend credentials were supplied. The migration and API contract leave a clean seam for replacing the local demo planner with the required private service.

## Run locally

```bash
cp .env.example .env.local
# Set DATAPILOT_SUPABASE_URL and DATAPILOT_SUPABASE_ANON_KEY in .env.local
npm run check
npm run dev
```

Open <https://schemaai-delta.vercel.app>.

The app can be explored without a Supabase schema using **Try demo mode**. Live authentication requires the configured Supabase project and its email-auth settings.

## Supabase setup

1. Open the Supabase SQL editor for the project.
2. Run `supabase/migrations/001_datapilot.sql` as a privileged project owner.
3. Create an account from the app or use an existing email-auth account.
4. Confirm email if the project requires it.
5. Use the live workspace after applying the migration.

The anon key belongs in a browser-safe environment variable and is protected by RLS. Never put a service-role key in `.env.local` exposed to the web app.

## Test commands

```bash
npm test
npm run check
```

## Project paths

- `web/` — browser application.
- `supabase/migrations/` — database schema and RLS.
- `apps/excel-addin/` — Excel manifest and task-pane adapter.
- `apps/sheets-addon/` — Apps Script manifest and sidebar adapter.
- `tests/` — deterministic regression tests.
- `docs/` — architecture, acceptance matrix, security notes, confidence scoring, and bug log.
