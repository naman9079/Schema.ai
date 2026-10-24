# Security notes

- `.env.local` is ignored and is never bundled by the static server. The browser receives only the Supabase anon key, which is designed for client use; a service-role key must never be placed there.
- RLS policies in the migration require authenticated organization membership for tenant tables.
- Dataset text is treated as untrusted data. The demo planner does not execute instructions found in cells.
- SQL preview is generated from validated identifiers and allowlisted operations. The browser demo executor is not a substitute for a privileged live SQL executor.
- Live PostgreSQL connections and arbitrary SQL require a private backend, read-only roles, network egress restrictions, statement timeouts, and full AST policy checks before production use.
- Spreadsheet adapters send only an explicitly selected range after consent. They do not read an entire workbook by default.
