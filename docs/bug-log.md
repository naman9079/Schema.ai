# Bug log

The mandatory loop is: reproduce, add a regression test, fix the root cause, rerun targeted checks, then rerun related checks.

## Fixed during initial vertical slice

| Bug | Root cause | Fix | Regression evidence |
|---|---|---|---|
| Browser showed a blank page | Static server returned `application/octet-stream` for imported `.mjs` modules | Added the `.mjs` JavaScript MIME type and verified the app in Chromium | Browser smoke test; `npm run check` |
| Landing page could render as the wrong view after navigation | Initial `view` state was `ask` even before a demo/session existed | Added explicit `home` initial state and dashboard-only view routing | Browser smoke test |
| Duplicate business keys were missed when rows differed in non-key fields | Quality logic only compared complete row fingerprints | Added business-key duplicate detection for ids, SKUs, codes, names, and similar identifiers | `npm test`; browser quality panel |
| Comparison coverage counted rows with invalid negative values as eligible | Coverage calculation used only non-null values | Separated non-null rows from valid non-negative comparison rows | `npm test`; browser result inspection |
| Direct planner tests produced null row examples | Test rows did not include UI-only row numbers | Added deterministic index fallback for quality evidence | `npm test` |
| A live Gemini request could block the demo workflow when the provider/network was unavailable | Demo mode required the provider even though it has a local deterministic planner | Added an explicit, visible demo-only fallback with the provider error in the notice; live mode still fails rather than hiding the provider problem | Gemini adapter tests; browser/demo workflow |
