# ssomcp

An offline-first MCP server for preparing Thailand SSO monthly contribution filings (สปส.1-10).
It exposes MCP prompts and tools over stdio, backed by private local employer, history, and
encrypted employee-baseline stores. A real Playwright adapter now logs in to SSO e-Service and
lands inside the authenticated web app; the deeper attach/save/submit write flow is registered
but stays fail-closed until its selectors are verified against a test-employer session.

## Implemented

- MCP TypeScript SDK v2 stdio server with legacy protocol fallback
- `/ssomcp`, `/ssomcp-change`, and `/ssomcp-refresh` prompts
- Offline `get_active_employer`, `change_active_employer`, `prepare_contribution`, and
  `query_history` tools
- Real Playwright login to SSO e-Service (`check_portal_login`) with verified login-form
  selectors, one login attempt, and a fail-closed stop on any captcha/OTP/error
- `check_previous_submission` — read the filed-contributions history
  (รายการประวัติการส่งเงินสมทบ) for an employer/year; verified selectors and duplicate-period lookup
- `create_employer` — register a นายจ้าง and capture its SSO login in one native popup
- Windows Credential Manager reader/writer so passwords never enter model context
- Fail-closed attach/save/submit placeholders that never touch the portal until verified
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

## Live portal use

Live browser access is **off by default** — a normal install opens no browser and reads no
credential. Enable it with environment variables:

- `SSOMCP_LIVE=1` — allow the real Playwright login/session (`check_portal_login`).
- `SSOMCP_ENABLE_WRITE_FLOW=1` — additionally allow the attach/save/submit flow. This stays
  non-functional until the `contribution` selectors in `src/sso/portal-selectors.ts` are
  confirmed from an authenticated test-employer session; until then it fails closed.
- `SSOMCP_HEADFUL=1` — show the browser window (default headless).
- `SSOMCP_CRED_PREFIX` — Windows Credential Manager target prefix (default `ssomcp`).

Live use also requires the Playwright browser binary:

```bash
npx playwright install chromium
```

Each SSO e-Service **นายจ้าง has its own login** (unlike FlowAccount, where one login reaches
many companies — so there is no company-picker after login here). Credentials live only in
**Windows Credential Manager**, one Generic Credential per employer account, keyed
`ssomcp:<accountNo>` (e.g. `ssomcp:1234567890`). The login is issued per เลขที่บัญชีนายจ้าง and
covers all of that employer's branches, so branches share one credential. Managing N client
employers means N separate logins, one per accountNo.

The easiest way to populate one is `create_employer`: it registers the นายจ้าง and, in the same
step, opens a native OS popup to capture that employer's SSO login and writes it to Credential
Manager (`CredWrite`) under the right target automatically. Pass `captureCredential: false` to add
the profile without a login for now. The password is entered in the OS dialog and written by a
child process — it never enters chat or model context.

The username is the SSO e-Service login; the password is read by a child process and typed into
the browser — it never enters chat or model context. There is exactly **one** login attempt per
run; any captcha, OTP, or unexpected screen stops and hands off to a human, never a retry loop
(a wrong-password retry on the government portal can lock the employer's account).

## Important confirmation gates

The 2026+ contribution wage floor, official rounding rule, field padding, prefix-code list,
and exact government sample-file behavior remain marked as confirmation items in `PROJECT.md`.
The generator emits a warning when a provisional ceiling rule is used. Do not use its output
for a live filing until those items have been checked against an official or accepted sample.

The Playwright login adapter and the read-only duplicate-check (previous-submission history) are
implemented with selectors verified against the live authenticated pages. The contribution
*write* flow — the ส่งเงินสมทบ menu path, file attach, save, and pre-submit summary — remains
gated (`SSOMCP_ENABLE_WRITE_FLOW`) until those selectors are captured from the upload screens, so
`upload_contribution`, `verify_summary`, and `submit_contribution` still fail closed.
