# ssomcp

Offline-first tooling for preparing Thailand SSO monthly contribution filings (สปส.1-10).
This repository contains the **P0 offline core** plus the testable **P1/P2 safety contract**.
It does not yet contain a configured Playwright adapter, so it cannot log in to SSO e-Service,
save, or submit a live filing.

## Implemented

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
npm run prepare:sample
```

The sample command writes `out/sso110-sample.txt` and
`out/sso110-review-sample.xlsx`.

## Important confirmation gates

The 2026+ contribution wage floor, official rounding rule, field padding, prefix-code list,
and exact government sample-file behavior remain marked as confirmation items in `PROJECT.md`.
The generator emits a warning when a provisional ceiling rule is used. Do not use its output
for a live filing until those items have been checked against an official or accepted sample.

The live Playwright adapter remains intentionally absent until the current portal flow,
selectors, duplicate lookup, and pre-submit summary are verified with a test employer.
