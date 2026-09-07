# ssomcp

An offline-first MCP server for preparing Thailand SSO monthly contribution filings (สปส.1-10).
It exposes MCP prompts and tools over stdio, backed by private local employer, history, and
encrypted employee-baseline stores. It does not yet contain a verified Playwright adapter, so
live refresh, upload, verification, and submission are registered but deliberately fail closed.

## Implemented

- MCP TypeScript SDK v2 stdio server with legacy protocol fallback
- `/ssomcp`, `/ssomcp-change`, and `/ssomcp-refresh` prompts
- Offline `get_active_employer`, `change_active_employer`, `prepare_contribution`, and
  `query_history` tools
- Fail-closed live filing tool placeholders that never touch the browser or credentials
- Contribution calculation selected by Gregorian filing period
- Floor/ceiling clamping and satang rounding
- Tier-1 consistency and duplicate-ID validation
- Data-driven 135-byte fixed-width TIS-620/Windows-874 TXT records
- Buddhist Era conversion only at the TXT formatting boundary
- Employer/employee delta comparison
- Human-review XLSX generated from the same immutable calculation result as TXT
- Unit tests for calculation, validation, encoding, widths, diffs, and XLSX/TXT total parity
- Portal adapter contract with a deliberately disabled default implementation
- One-attempt filing coordinator with duplicate-period guard
- Fail-closed reconciliation against all five portal summary totals
- Hard save-versus-submit boundary with per-run explicit confirmation
- Atomic local employer registry with credential-field rejection
- Totals-only JSONL filing history with no employee rows
- Submitted-only baseline store encrypted with Windows DPAPI
- Configurable baseline retention and previous-period lookup

## Run

```bash
npm install
npm run check
npm start
```

Node.js 20 or newer is required. After `npm run build`, configure an MCP host to run the
compiled stdio entry. For example:

```json
{
  "mcpServers": {
    "ssomcp": {
      "command": "node",
      "args": ["C:\\path\\to\\sso-mcp\\dist\\src\\index.js"]
    }
  }
}
```

For an offline sample without an MCP host:

```bash
npm run prepare:sample
```

The sample command writes `out/sso110-sample.txt` and
`out/sso110-review-sample.xlsx`.

## Storage workflow

Runtime state lives outside the repository under `~/.ssomcp/`:

- `employers.json` maps nicknames to employer account and branch records.
- `baseline/*.json.dpapi` contains submitted-only employee baselines encrypted with Windows
  DPAPI. `prepare_contribution` loads the latest baseline before the requested period unless
  `previousEmployees` is supplied explicitly.
- `history.jsonl` contains totals and statuses only; `query_history` never returns employee rows.
- `output/<account>-<branch>/<YYYY-MM>/` receives atomically written TXT and review XLSX files.

The employer refresh tool will populate `employers.json` once the portal adapter is implemented.
Until then, tests or trusted local setup code can populate it through `EmployerStore`; credentials
must never be placed in that file.

## Important confirmation gates

The 2026+ contribution wage floor, official rounding rule, field padding, prefix-code list,
and exact government sample-file behavior remain marked as confirmation items in `PROJECT.md`.
The generator emits a warning when a provisional ceiling rule is used. Do not use its output
for a live filing until those items have been checked against an official or accepted sample.

The live Playwright adapter remains intentionally absent until the current portal flow,
selectors, duplicate lookup, and pre-submit summary are verified with a test employer.
