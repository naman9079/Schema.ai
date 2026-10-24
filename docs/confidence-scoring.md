# Confidence scoring

The current deterministic score is a heuristic, not a calibrated probability. It starts at 100 and subtracts bounded penalties for missing values, duplicates, invalid domain values, incomplete comparison coverage, and unresolved assumptions. Critical failures can change the outcome to `insufficient_data` or `blocked` instead of being hidden by an average.

Every response exposes:

- `score` — integer from 0 to 100 when evaluated.
- `components` — named deductions and their evidence.
- `version` — currently `heuristic-v1`.
- `label` — high, medium, low, or unknown.

The score does not prove that the question was interpreted correctly. Clarification is required when time periods or columns are ambiguous.
