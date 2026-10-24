# Spreadsheet plugin setup

## Shared raw-file workflow

1. Upload a raw CSV, TXT, or JSON file in the Schema.ai IDE.
2. Open the Chat analysis dock and click **Clean with Gemini**.
3. Schema.ai sends schema metadata and a bounded sample to the server-side Gemini Flash 3.8 cleaning planner.
4. The browser applies only the returned safe operations, keeps the raw dataset unchanged, and records the change counts.
5. Click **Download cleaned CSV**.
6. The downloaded CSV is an ordinary local file. It can be imported later from either plugin, including after closing and reopening the IDE.

The cleaning endpoint is `POST /api/ai/clean`. The plugin question endpoint is `POST /api/plugin/ask`. Both endpoints keep the Gemini key on the private/server side and accept only bounded tabular payloads.

## Excel

1. Serve the task pane from HTTPS during development or use the deployed Vercel origin.
2. Replace the example `localhost:3000` URLs in `apps/excel-addin/manifest.xml` with the actual Vercel origin.
3. Sideload the manifest in Excel using the Office add-in sideload flow.
4. Either select a non-empty range or use **Import downloaded file** to choose a cleaned CSV/JSON file from disk.
5. Preview and explicitly confirm before sending to `POST /api/plugin/ask`.
6. Use **Write imported file to sheet** only when you want the selected/imported data copied into the active worksheet.
7. Configure the task pane's shared API base URL through the host deployment rather than placing database credentials in the workbook.

## Google Sheets

1. Create an Apps Script project bound to a test spreadsheet.
2. Add `Code.gs`, `sidebar.html`, and `appsscript.json`.
3. Set the Apps Script property `SCHEMA_AI_API_BASE` to the Vercel origin.
4. Replace the example logo with an approved deployment value.
5. Authorize the current-spreadsheet, container UI, and external request scopes as the current user.
6. Either preview a selected range or choose **Import downloaded file** in the sidebar.
7. Confirm before sending and use **Write imported file to sheet** only when desired.

Host smoke tests are blocked in this workspace because Excel and Apps Script deployments are not available in the container. The adapters intentionally do not claim marketplace publication or host verification.
