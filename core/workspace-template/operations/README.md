# operations/

Home for the Operations role agent's artifacts: process docs, scheduling,
internal reporting, and recurring-task tracking. See
`core/skills/operations/SKILL.md` for the full charter.

Also hosts **Finance** artifacts under `operations/finance/` — the
workspace template does not ship a separate top-level `finance/` folder
in v1; see `core/skills/finance/SKILL.md` for that role's charter and
suggested files (`finance/budget.csv`, `finance/invoices/`,
`finance/expenses.csv`, `finance/reports/`).

Suggested contents:
- `processes/<process-name>.md` — how a recurring thing is done
- `reports/<date>-status.md` — cross-role status rollups
- `calendar-notes.md` — calendar-related notes
- `recurring-tasks.csv` — what's on cron, cadence, last run, owner role
- `finance/` — Finance role agent's artifacts (see above)
