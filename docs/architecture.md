# Architecture

The current vertical slice is intentionally small and portable:

```text
Browser -> Node static server -> Supabase Auth/PostgREST
                      \-> private Gemini intent adapter -> schema-bound planner
                      \-> deterministic demo fallback (explicitly labeled)

Excel task pane / Sheets sidebar -> shared API base URL -> future private API
```

The Supabase migration separates application metadata from imported dataset rows. Every tenant-owned table carries an organization id and has RLS policies requiring authenticated membership. Query provenance stores the question, SQL preview, status, validation evidence, and confidence components.

The production seam is the `ask`/query-run contract. A private backend should receive verified identity, authorized schema metadata, and a bounded question; generate SQL with a provider adapter; inspect the full SQL AST; execute only through a restricted read-only role; and persist the same provenance envelope. The browser must never receive a service-role key or direct database password.

Gemini is called only by the server through `services/gemini.mjs` using the
current Interactions API path. The API key
is read from `GEMINI_API_KEY`, never sent through `/config.js`, and is not
included in the structured plan returned to the browser. The model returns
intent metadata only; it does not return executable SQL. The application then
binds the intent to the authorized schema and applies local safety checks.

## Why the first slice is dependency-light

The workspace began empty and the container did not have Java, Maven, Docker, or PostgreSQL tools available. A dependency-free browser/server slice makes the user-visible workflow testable now without fabricating a Spring Boot build or hiding missing provider credentials. The migration and contracts are structured so the private Java/Python services can replace the local planner without changing the user-facing response shape.
