# Spreadsheet plugin setup

## Excel

1. Serve the task pane from HTTPS during development.
2. Replace the example `localhost:3000` URLs in `apps/excel-addin/manifest.xml` with the actual task-pane origin.
3. Sideload the manifest in Excel using the Office add-in sideload flow.
4. Select a non-empty range, preview it, and explicitly confirm before sending.
5. Configure the task pane's shared API base URL through the host deployment rather than placing database credentials in the workbook.

## Google Sheets

1. Create an Apps Script project bound to a test spreadsheet.
2. Add `Code.gs`, `sidebar.html`, and `appsscript.json`.
3. Replace the example logo and backend configuration with approved deployment values.
4. Authorize the minimal current-spreadsheet scopes as the current user.
5. Test with a non-sensitive sheet and confirm that only the selected range is sent.

Host smoke tests are blocked in this workspace because Excel and Apps Script deployments are not available in the container. The adapters intentionally do not claim marketplace publication or host verification.
