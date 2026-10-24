# Schema.ai IDE workspace

Schema.ai now uses an analyst-IDE layout rather than a marketing-dashboard layout.
The goal is to make the product feel like a focused workbench: source context on
the left, an AI conversation and analysis canvas in the center, and inspectable
evidence on the right.

The root route opens directly into **Ask Data**. The former landing page is not
shown during normal visits; users move through the workspace from the IDE
navigation instead.

## Workspace sections

### 1. Source explorer

The left rail contains:

- Session context.
- Chat.
- Query History.
- Plugins.
- Settings.
- SQL Editor.

This is useful for technical users because it communicates where the current
analysis came from and gives non-technical users a simple way to switch modes.

### 2. Analyst canvas

The center pane contains:

- ChatGPT-like Schema.ai conversation surface.
- A composer with file upload, model selection, and send controls.
- Suggested questions for common analysis patterns.
- A single explicit question composer.
- Answers and technical evidence are intentionally kept out of the center chat
so the conversation remains uncluttered.

Settings contains only the **AI Provider** surface. Users can enter an
OpenAI-compatible base URL, model name, and API key; saving the provider adds
that model to the Chat model menu. The key is kept in browser session storage
and is never written to project files.

Plugins contains the Excel task pane and Google Sheets sidebar connection paths,
with setup status and the selected-range consent boundary visible in one place.

The model is presented as an analyst assistant, not as an opaque chatbot. The
answer remains attached to the dataset, query trace, validation checks, and
assumptions.

### 3. Evidence inspector

The right rail contains:

- Active dataset summary.
- Latest answer and result table.
- SQL, validation, and evidence tabs.
- Visual quality score ring.
- Passed, warning, and failed check counts.
- Schema/type list.
- Session/source status.

This is intended to make a judge or analyst understand the trustworthiness of
the result within a few seconds.

## Recommended next visual features

These should be added after the core pipeline is connected to live database
execution:

1. **Chart cards** — line, bar, and scatter charts selected from the result
   shape, with a “why this chart” explanation.
2. **Data-quality timeline** — show quality score and affected-row counts by
   imported dataset version.
3. **Column profiling** — mini histograms, distinct count, null percentage,
   min/max, and sample values per column.
4. **Comparison callouts** — absolute change, percentage change, baseline,
   denominator, and excluded-row count in one visual block.
5. **Query plan timeline** — interpreted question → schema selection → SQL
   policy → execution → validation → answer.
6. **Clarification cards** — clickable choices for time period, metric, unit,
   or business definition instead of a blank text prompt.
7. **Saved analysis notebooks** — combine several questions, charts, and
   evidence cards into a shareable report.
8. **Presentation mode** — a judge-friendly view that hides implementation
   details but preserves source, confidence, warnings, and citations.
9. **Accessibility mode** — larger cards, reduced motion, high contrast, and
   plain-language explanations.
10. **Plugin context panel** — show selected Excel/Sheets range, consent state,
    source freshness, and the destination cell/sheet before insertion.

## Why these sections exist

- AI/ML engineers need model/provider status, schema, SQL, and policy evidence.
- Data scientists need distributions, missingness, comparison coverage, and
  reproducible query provenance.
- Data analysts need fast answers, charts, filters, exports, and history.
- Non-technical users need a conversational composer, visual summaries, and
  clear explanations of warnings without reading SQL.
- Judges need a visually obvious story: question → evidence → validation →
  result → uncertainty.
