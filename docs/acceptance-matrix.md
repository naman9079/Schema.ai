# DataPilot acceptance matrix

| Capability | Implemented | Automated check | External prerequisite |
|---|---:|---:|---|
| Demo mode and honest status | Yes | UI smoke/manual | None |
| CSV parsing and profiling | Yes | `npm test` | None |
| Schema-aware SQL preview | Yes | planner tests | None |
| Validation and confidence breakdown | Yes | quality tests | None |
| Query history and CSV export | Yes | browser/manual | None |
| Supabase email auth | Yes | live auth manual | Supabase email provider |
| Live tenant persistence | Migration and client path | migration review | Apply migration with privileged access |
| Live SQL execution | RPC seam only | policy tests in migration review | Apply migration; server-side executor |
| Excel task pane | Adapter and manifest | static checks | Office host and auth setup |
| Google Sheets sidebar | Adapter and manifest | static checks | Apps Script deployment and auth |
| LLM-backed SQL planning | Not enabled without provider | Not run | Server-side model credentials |

The synthetic prompt-injection row uses a non-declining value pair, so the
school decline acceptance question returns School A and School B while still
proving that untrusted cell text is preserved and does not control the planner.
