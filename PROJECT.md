# ssomcp — SSO e-Service Contribution Filing (Design & Implementation)

> Unofficial MCP server that prepares and files monthly social-security
> contributions (**สปส.1-10**) to the Thai SSO e-Service, for สถานประกอบการ.
> Built on the same stack and patterns as `riniort/flowaccount-mcp`
> (TypeScript, MCP TS SDK v2, Playwright auth, Windows Credential Manager).

**Status:** design v2 · **Owner:** riniort · **Base:** riniort/flowaccount-mcp

---

## 1. Goal

One command (`/ssomcp`, per client + period) drives a delta-based monthly run:
ask employer + period → start from last month → take this month's changes
(image or xlsx) → produce a review **xlsx** + upload **txt** → validate →
on the user's word, log in and **save/attach** on e-Service → **stop**.
The final ส่ง button stays with the user unless they explicitly confirm.

### Non-goals (v1)
- ทะเบียนผู้ประกันตน (สปส.1-03 / 6-09 / 6-10) — later phase.
- e-Self Service (ม.40, individual) — different login (ThaiD).
- Standing auto-submit — never a persistent setting.

---

## 2. Scope (v1)

- Single deliverable: **แบบส่งเงินสมทบ สปส.1-10 (แยกยื่น)**, one period at a time,
  one or many employer accounts.
- **e-Service accepts the `.txt` upload only.** The `.xlsx` is a human-review
  artifact, never an upload target → the txt generator is the critical path.
- สปส.1-10/1 (รวมสาขา) is a fast follow (P4).

---

## 3. Tech stack & foundation

| Concern | Choice | Note |
|---|---|---|
| Language | TypeScript | matches flowaccount-mcp |
| Runtime | Node.js 18+ | same as base repo |
| MCP | MCP TypeScript SDK v2 | protocol negotiation 2026-07-28, legacy fallback |
| Transport | stdio | `src/index.ts` |
| Browser automation | Playwright | actuator only (P1+), reused auth flow |
| Credential store | Windows Credential Manager | via reused `auth/windows-credential.ts` |
| Encoding | TIS-620 / Windows-874 | for the txt file (see §11) |
| xlsx | SheetJS (xlsx) or exceljs | human-review summary only |
| Encryption at rest | Windows DPAPI | employee baseline file (see §8) |

**Reused wholesale from flowaccount-mcp:** `src/auth/*` (windows-credential,
session/token lifecycle), the lazy-auth pattern, the MCP-prompt→slash-command
mechanism (`/flowaccountmcp` → here `/ssomcp`), and the multi-account switch
pattern (`change_active_company` → `change_active_employer`).

---

## 4. Source tree

```
src/
  index.ts                  # stdio transport entry (as base repo)
  server.ts                 # register tools + prompts

  auth/                     # ← lifted from flowaccount-mcp
    windows-credential.ts   #   Windows Credential Manager read/relogin
    session.ts              #   keep Playwright session alive, re-login on expiry

  sso/
    txt-generator.ts        # ★ P0 core: list → 135-byte fixed-width lines (TIS-620)
    calc.ts                 # ★ P0: ceiling/rate lookup by period + rounding
    validate.ts             # ★ P0: Tier-1 asserts (self-consistency)
    xlsx-summary.ts         #   human-review summary (payroll + สมทบ + diff)
    diff.ts                 #   baseline vs this-month diff (added/removed/changed)
    reconcile.ts            # P2: Tier-2 compare computed vs e-Service verify screen
    actuator.ts             # P1: Playwright login → menu → attach → save → read summary

  config/
    field-spec.ts           # ★ 135 layout as data + padding/encoding/decimal/year (tunable)
    ceilings.ts             # ★ wage-ceiling / rate table by effective period
    prefix-codes.ts         # คำนำหน้าชื่อ → สปส. code map

  store/
    employers.ts            # ~/.ssomcp/employers.json         (non-secret cache)
    history.ts              # ~/.ssomcp/history.jsonl           (totals + status)
    baseline.ts             # ~/.ssomcp/baseline/<เลข>.json     (PII, DPAPI-encrypted)

  types.ts                  # shared interfaces (§9)
  util/
    bytes.ts                # TIS-620 encode + byte-width pad/truncate helpers
    logger.ts               # (as base repo)

test/
  txt-generator.test.ts     # golden-file + byte-length + encoding tests
  calc.test.ts              # ceiling/rounding cases per period
  validate.test.ts          # each Tier-1 rule, pass + fail
```

★ = P0, offline, unit-tested without touching the web.

---

## 5. Architecture (layers)

```
/ssomcp  (MCP prompt → slash command)
   │
   ▼
server.ts  — tool + prompt registration
   │
   ├── prepare  (offline)  sso/{calc, diff, txt-generator, validate, xlsx-summary}
   │                       + store/{employers, baseline}
   │
   └── file     (on user's word)  sso/{actuator, reconcile} + auth/*
                                  + store/{history, baseline}
```

**Only two human checkpoints:**
1. Login anomaly (captcha / expired pw / unexpected 2FA) → pause, hand to human.
2. After the review xlsx → ask "ให้ยื่นให้เลยไหม?"; system goes only to **save**.
   The final ยืนยัน/นำส่ง is the user's unless they say "ยื่นเลย".

Web and credentials are untouched until the user explicitly says ส่งประกันสังคม.

---

## 6. Auth & credentials (from flowaccount-mcp)

- **Windows Credential Manager** for user/password, keyed per employer;
  reuse `auth/windows-credential.ts` and the `*_CREDENTIAL_TARGET` env pattern.
- **Credential never enters model context.** The actuator process reads it and
  types it; the model only ever passes *which employer + which period*.
- **Lazy auth** — starting the server opens no browser and reads no secret until
  a real file operation is called.
- **Missing-credential flow** — on Windows, if the target credential is absent,
  offer to open Credential Manager and wait until it is added.
- **Multi-client** — `change_active_employer`, keyed by
  **เลขที่บัญชีนายจ้าง + ลำดับที่สาขา**; re-auth + verify active employer before any write.
- **Session-based, not token-reuse** — e-Service is a session-cookie web form (no
  backend API like FlowAccount). Keep the Playwright session alive; re-login from
  Credential Manager on expiry.
- **Login attempt guard — never lock the client's account.** At most **one** login
  attempt per run; on failure **pause and hand to a human**, never auto-retry in a
  loop. Any captcha / OTP / "password expired" / unexpected screen → stop and pause,
  do not guess or resubmit. Wrong-password retries on a gov portal can lock the
  employer's account, which is worse than a failed run.
- **Never commit** session files, `.env`, credential exports, or exported data.

---

## 7. Assumptions to confirm (drive config, not logic)

These are **not known for certain** and must be tunable so a real sample can
correct them without touching code. Defaults below are the P0 starting guess.

| Item | P0 default | Where | Confirm from |
|---|---|---|---|
| Text field pad | left-align, space-pad right | `field-spec.ts` | sample file |
| Numeric field pad | right-align, zero-pad left | `field-spec.ts` | sample file |
| Money encoding | satang (×100, no decimal point) | `field-spec.ts` | sample file |
| อัตราเงินสมทบ field | `0500` (= 5.00%) | `field-spec.ts` | sample file |
| Year in date fields | พ.ศ. 2-digit (2569 → `69`); internal dates stay Gregorian (§7→§12 boundary) | `field-spec.ts` | sample file |
| Line ending | CRLF | `field-spec.ts` | sample file |
| Encoding | TIS-620 / Windows-874 | `field-spec.ts` | sample file |
| Rounding | CONFIRMED: whole baht, half-up (เศษ ≥ 50 สต. ปัดขึ้น, < 50 ปัดทิ้ง) | `calc.ts` | สปส. rule + sample |
| คำนำหน้า codes | seed table | `prefix-codes.ts` | สปส. spec |
| e-Service login | plain user/password | `actuator.ts` | live check |

### Confirmed against a real accepted file (งวด 04/2565, SSOSENT 6504.txt)

Verified by decoding a genuine government-accepted upload file (kept out of the repo — real PII):

- **135-byte fixed-width records, CRLF, TIS-620** — CONFIRMED.
- **Text fields left-aligned, space-padded; numeric fields right-aligned, zero-padded** — CONFIRMED.
- **Money = satang (×100, no decimal point)** — CONFIRMED (uniform for wage and contribution;
  e.g. wage `00000000761300` = 7,613.00, contribution `000000075000` = 750.00 at the 15,000 ceiling).
- **Rate field `0500` = 5.00%; headcount right-aligned zero-padded** — CONFIRMED.
- **2-digit พ.ศ. year** — CONFIRMED (`0465` = period MMYY 04/2565; payDate DDMMYY `050565`).
- **Field layout matches `field-spec.ts` exactly** — header: account10 · branch6 · payDate6 ·
  period4 · name45 · rate4 · headcount6 · totalWage15 · totalContribution14 · employee12 ·
  employer12. Detail: ssoId13 · prefix3 · firstName30 · lastName35 · wage14 · contribution12 ·
  filler27. Header totals reconcile with the detail sums.
- **Rounding — CONFIRMED and fixed.** The file rounds เงินสมทบ to **whole baht, half-up**
  (wage 7,613.00 → 5% = 380.65 → stored **381.00**). This matches the สปส. rule (เศษตั้งแต่ 50
  สตางค์ปัดขึ้นเป็น 1 บาท, ต่ำกว่า 50 สตางค์ปัดทิ้ง). `calc.ts` now uses `roundContributionBaht`
  (was satang rounding). Resolves open question #4.
- **Open — wage field over ceiling.** The sample has no earner above the 15,000 ceiling, so whether
  the detail เงินค่าจ้าง field carries the *actual* wage or the *capped* base is still unconfirmed;
  the generator currently writes the actual wage. Confirm with an over-ceiling sample.

---

## 8. Local data (separated layers)

All local state lives **outside the repo** in `~/.ssomcp/`, never in the project
folder. `.gitignore` is a backstop, not the primary defense. `chmod 600` /
user-only. Same local-first scope as WageSnapo. **Keep the layers in
separate files — never merged.**

### 8.1 Employer cache — `~/.ssomcp/employers.json`
Lets `/ssomcp` map nickname → เลขบัญชีนายจ้าง+สาขา without hitting the web.
- **Stores (non-secret):** nickname/code, เลขที่บัญชีนายจ้าง, สาขา, ชื่อสถานประกอบการ,
  **province (canonical — code or standard name)**, `cachedAt`.
- **province is the key** that links an employer to its minimum-wage tier (§8.4);
  store it canonical (not free text) so lookup can't miss. `/ssomcp-refresh` updates it.
- Multi-branch employers may sit in different provinces → v1 keeps province at
  employer/main-branch level; per-branch province is future work (§20.1).
- **Never** credentials — those stay in Windows Credential Manager.
- **Staleness:** show "cached ณ <date>"; `/ssomcp-refresh` re-pulls + overwrites
  (client rename / new branch).
- Customer data even without passwords → out of repo, permission-restricted.

### 8.2 Usage history — `~/.ssomcp/history.jsonl`
The audit log made queryable, for multi-client "did I file it?" checks.
- **Per run:** employer, period, จำนวนคน, ยอดรวมนำส่ง, timestamp,
  status (`saved` / `submitted` / `cancelled`), receipt no. if any.
- **Answers:** "ลูกค้า A ยื่นถึงงวดไหน", "งวด 07/2569 ขาดลูกค้าไหน",
  "ยอดนำส่งเดือนนี้รวมเท่าไร", "ยื่นซ้ำงวดเดิมไหม".
- **Totals + status only** — no per-person rows here.
- **Honest reporting:** it records *what we did*, not the live web state. If asked
  "ยื่นสำเร็จจริงไหม", answer from the log **and** say to confirm on e-Service
  (the log can drift if changed outside the system).

### 8.3 Employee baseline — `~/.ssomcp/baseline/<เลขนายจ้าง>.json` (one per employer)
Prior period's employee list — what the delta model reads on "point at last month".
**Most sensitive file in the system:** เลขบัตรประชาชน + ชื่อ-สกุล + ค่าจ้าง for many
people across many clients → treat as a customer PII database (PDPA scope), not config.
- **Stores only what delta/txt need:** เลขประกันสังคม, คำนำหน้า (code), ชื่อ, นามสกุล, ค่าจ้าง.
- **Submitted-only:** the *successfully submitted* dataset, never a draft (avoids drift).
- **Encrypt at rest** — key bound to the machine via Windows DPAPI. The volume of ID
  numbers makes it worth it (unlike `employers.json`).
- **Retention:** keep only the last N periods; purge older baselines.
- Out of repo, `chmod 600` (worst file to leak).

### 8.4 Minimum-wage reference — `~/.ssomcp/minimum-wage.json` (validation only)
Provincial legal minimum wage, used **only** to warn if an employee's wage looks
below the legal floor for their province. **This is NOT the ปกส. contribution floor**
(`CeilingRule.wageFloor`, a single national figure ~1,650/month). Two different
concepts — never wire this into the contribution calc.
- **Structure:** per tier → daily rate + list of provinces; plus `effectiveDate`,
  `announcementRef`, `sourceUrl`.
- **Current data (seed):** ประกาศคณะกรรมการค่าจ้าง ฉบับที่ 14, effective 1 ก.ค. 2568,
  337–400 บาท/วัน, 17 tiers (กทม.+ปริมณฑล = 400). No new 2569 announcement as of Aug 2569.
- **Refresh:** rates change by announcement → store effective date + ref, and re-seed
  when a new ประกาศ lands (don't hardcode-and-forget).
- Really a payroll-domain reference → candidate to **share with WageSnapo** rather
  than duplicate (§20.2).

---

## 9. Data model (types.ts)

```ts
// One insured employee row (also the Detail record source)
interface Employee {
  ssoId: string;        // เลขประจำตัวประกันสังคม / บัตร ปชช. (13)
  prefixCode: string;   // คำนำหน้า code (3) — from prefix-codes.ts
  firstName: string;    // ชื่อ (30)
  lastName: string;     // นามสกุล (35)
  wage: number;         // ค่าจ้าง (THB, 2 dp)
}

// Per-person computed contribution
interface Contribution {
  employee: Employee;
  baseWage: number;     // clamp(wage, floor, ceiling) for the period
  employeeShare: number;// round(baseWage * rate)
  employerShare: number;// = employeeShare
}

interface EmployerRef {
  nickname: string;
  accountNo: string;    // เลขที่บัญชีนายจ้าง (10)
  branch: string;       // ลำดับที่สาขา (6)
  name: string;         // ชื่อสถานประกอบการ (45)
  province: string;     // canonical — links to minimum-wage tier (§8.4)
}

// INTERNAL DATES ARE GREGORIAN (ค.ศ.) EVERYWHERE.
// พ.ศ. exists only as output, produced at the txt-writer boundary (see §12).
interface Period { month: number; yearCE: number; } // e.g. 2026, NOT 2569

// Everything one run needs
interface RunContext {
  employer: EmployerRef;
  period: Period;
  payDate: Date;        // วันที่ชำระเงิน (Gregorian)
  employees: Employee[];
  ceilingRule: CeilingRule;
}

interface CeilingRule {           // config/ceilings.ts
  from: Period; to?: Period;      // effective window (Gregorian)
  ratePercent: number;            // 5
  wageFloor: number;              // min base (confirm current value — §17)
  wageCeiling: number;            // 17500 for 2569–2571
  maxContribution: number;        // 875
}

interface FieldSpec {             // config/field-spec.ts, per field
  name: string; length: number;
  align: 'left' | 'right';
  pad: ' ' | '0';
  kind: 'const' | 'text' | 'int' | 'money' | 'dateDDMMYY' | 'periodMMYY';
}

// Diff for delta model (diff.ts)
interface EmployeeDiff {
  added: Employee[];
  removed: Employee[];
  changed: { before: Employee; after: Employee; fields: string[] }[];
}

// SINGLE COMPUTATION POINT (calc.ts). Numbers are computed ONCE here;
// both writers below consume this read-only. Nothing recomputes downstream.
interface RunResult {
  ctx: RunContext;
  lines: Contribution[];     // per person
  totals: {
    headcount: number;
    totalWage: number;
    employeeTotal: number;
    employerTotal: number;
    grandTotal: number;      // employeeTotal + employerTotal
  };
}
function computeRun(ctx: RunContext): RunResult;      // the only place math happens
// writers are pure consumers:
function writeTxt(r: RunResult): Buffer;              // txt-generator.ts
function writeXlsx(r: RunResult, diff: EmployeeDiff): Buffer; // xlsx-summary.ts
```

---

## 10. Contribution calculation (calc.ts)

Rate **5%**, applied to the wage **clamped between a floor and a ceiling**.
**Lookup, never hardcode.** Both bounds matter: a wage below the floor still
contributes on the floor (e.g. part-month / low wage), not on the raw wage.
`wageFloor` here is the ปกส. contribution floor (single national figure) — **not**
the provincial minimum wage (§8.4), which is a separate labour-law rate used only
for a validation warning.

### config/ceilings.ts
| Effective period | Wage floor | Wage ceiling | Rate | Max / person / month |
|---|---|---|---|---|
| before 2569 | 1,650 * | 15,000 | 5% | 750 |
| 2569–2571 | (confirm) * | 17,500 | 5% | 875 |
| next step | (confirm) * | 20,000 | 5% | 1,000 |

\* The 2569 กฎกระทรวง set **both** ค่าจ้างขั้นต่ำและขั้นสูง. The ceiling is
confirmed (17,500). **The floor value for 2569 must be confirmed** against the
กฎกระทรวง before P0 ships (§17) — 1,650 is the pre-2569 figure, seeded pending check.

### Algorithm (per employee)
```
rule        = ceilings.lookup(period)          // by MM/YYYY
baseWage    = clamp(employee.wage, rule.wageFloor, rule.wageCeiling)
share       = roundSatang(baseWage * rule.ratePercent / 100)   // ≤ rule.max
employeeShare = employerShare = share
```
- `roundSatang` rule is a **confirm item** (§7); apply identically to xlsx and txt.
- Employer matches employee (both 5%).
- Header totals are sums of Detail (single source of truth) — never recomputed
  separately for the header.
- **Single-computation invariant.** `computeRun()` produces `RunResult` **once**;
  `writeTxt` and `writeXlsx` are pure read-only consumers of it. Neither writer
  formats or re-derives a number on its own — this is what guarantees xlsx and txt
  can never drift. Enforced in code (writers take `RunResult`, not raw employees),
  and asserted in tests (same `RunResult` → txt totals == xlsx totals).

---

## 11. สปส.1-10 text file spec

Fixed-width, **135 bytes/line** (TIS-620). One Header (`1`), then N Detail (`2`).
Layout per panyame.com — **confirm padding/decimal/encoding/year against a real
sample before trusting** (§7).

### Header (type = 1) — 135
| # | Field | Len | Note |
|---|---|---|---|
| 1 | ประเภท | 1 | const `1` |
| 2 | เลขที่บัญชีนายจ้าง | 10 | |
| 3 | ลำดับที่สาขา | 6 | |
| 4 | วันที่ชำระเงิน | 6 | `ddMMyy` (year: confirm) |
| 5 | งวดค่าจ้าง | 4 | `MMyy` |
| 6 | ชื่อสถานประกอบการ | 45 | text |
| 7 | อัตราเงินสมทบ | 4 | e.g. `0500` |
| 8 | จำนวนผู้ประกันตน | 6 | = count(Detail) |
| 9 | ค่าจ้างรวม | 15 | = Σ Detail wage |
| 10 | เงินสมทบรวม | 14 | = ลูกจ้าง + นายจ้าง |
| 11 | เงินสมทบส่วนผู้ประกันตน | 12 | |
| 12 | เงินสมทบส่วนนายจ้าง | 12 | |

### Detail (type = 2) — 135
| # | Field | Len | Note |
|---|---|---|---|
| 1 | ประเภท | 1 | const `2` |
| 2 | เลขประจำตัวประกันสังคม | 13 | บัตร ปชช. |
| 3 | คำนำหน้าชื่อ | 3 | **code**, not the word |
| 4 | ชื่อ | 30 | text |
| 5 | นามสกุล | 35 | text |
| 6 | ค่าจ้าง | 14 | |
| 7 | เงินสมทบ | 12 | |
| 8 | ว่าง | 27 | filler spaces |

### Reject-risk checklist (locked in the generator)
- [ ] **TIS-620 / Windows-874**, not UTF-8. Count **bytes**, not chars.
- [ ] Text left-align space-pad; numeric right-align zero-pad.
- [ ] Money decimal handling (satang vs dot).
- [ ] Year format in date fields.
- [ ] Line ending (CRLF).
- [ ] คำนำหน้า code table.
- [ ] assert Header totals == Σ Detail.

---

## 12. txt generator (txt-generator.ts) — P0 core

Data-driven from `field-spec.ts`; the layout is a table, not hardcoded slicing.

### Algorithm
```
function buildLine(spec: FieldSpec[], values): Buffer
  parts = for each field:
    raw   = format(value, field.kind)     // int/money/date/period → digit string
    bytes = tis620.encode(raw)            // Thai text → single-byte
    fit   = field.align === 'left'
              ? padOrTruncRight(bytes, field.length, field.pad)
              : padOrTruncLeft(bytes,  field.length, field.pad)
    assert fit.length === field.length     // byte length, not char length
  line = concat(parts)
  assert line.length === 135               // hard guard
  return line

file = buildLine(HEADER_SPEC, header)
     + CRLF
     + employees.map(e => buildLine(DETAIL_SPEC, detail(e))).join(CRLF)
     + CRLF
write(file, encoding: 'tis620')            // never utf-8
```

### Rules
- **Byte-accurate**: all pad/trunc in `util/bytes.ts` operates on TIS-620 bytes.
- **พ.ศ. only here.** `format()` is the **single boundary** where Gregorian → พ.ศ.
  happens (`dateDDMMYY`, `periodMMYY` add 543 and take the last 2 digits).
  Everything upstream stays Gregorian (§9) — no `+543` anywhere else in the code.
- **Truncation is logged, not silent** — if a name exceeds its field, warn (a
  truncated name on a gov filing should surface, not vanish).
- **Money**: `money` kind emits satang integer (or dotted, per config).
- Generator **calls validate.ts (Tier-1) before writing** — fail → no file.

---

## 13. Validation (2-tier)

Two independent checks; both mandatory; a fail at either blocks submit.

### Tier 1 — internal, before upload (validate.ts, offline)
Asserts in P0; if any fail, **no file is written**.
- `Header.จำนวนคน == count(Detail)`
- `Header.ค่าจ้างรวม == Σ Detail.ค่าจ้าง`
- `Header.เงินสมทบรวม == Σ Detail.เงินสมทบ`
- `Header.เงินสมทบรวม == ส่วนลูกจ้าง + ส่วนนายจ้าง`
- per person: `เงินสมทบ == round(clamp(ค่าจ้าง, floor, ceiling) × 5%)` and `≤ max`
- every line is exactly **135 bytes**
- no duplicate เลขประจำตัวประกันสังคม within the file

### Tier 2 — reconcile vs e-Service, before submit (reconcile.ts, P2)
**Precondition (must verify against the live site — §17):** e-Service must show a
recomputed summary (จำนวนคน / ยอดรวม) that the actuator can read **before** the final
ยืนยัน. If it only shows totals *after* submit, this whole before-submit safety model
does not hold and P2 must be redesigned — so prove this first.
- reads the on-screen summary and compares to computed totals
- all match → pass, wait for the user's word
- any mismatch → **stop, do not submit**, show the diff (field, ours vs theirs)
- **fail-closed:** if the summary can't be located or parsed, **STOP and force a
  human to check** — never treat "couldn't read it" as pass.

### Pre-submit duplicate guard (dup-check + crash recovery)
Filing สปส.1-10 twice for the same period is a serious error; local history alone
misses a crash mid-submit or an out-of-system manual filing.
- **Before attaching/saving:** query e-Service for this employer+period
  ("ดึงข้อมูลจากรายการก่อนหน้า" / existing submission). If already submitted →
  **stop and warn**, do not proceed without explicit user override.
- **Idempotency / crash recovery:** if a run is interrupted after upload, on next
  start reconcile local history against the site to determine true state before
  offering to continue — never blind-resubmit.
- Local history is a convenience index, **not** the source of truth for "already filed".

### Sanity flags (warn, don't block)
- **Period-over-period delta** — headcount or total differs from last period by
  more than a per-employer threshold (default ±20%). Catches missing people,
  duplicated data, wrong-client file. Surfaced at the checkpoint.
- **Below provincial minimum wage** — an employee's wage looks below the legal
  minimum for their province (lookup `employer.province` → `minimum-wage.json`, §8.4).
  Warn only (part-time / daily / mid-month hires are legitimately lower); never
  blocks and never touches the ปกส. calc.

---

## 14. Pipeline / workflow

Delta-based: each month starts from last period's finalized data and applies
only what changed. Web opens **only** at the ส่งประกันสังคม step.

```
Step 1  /ssomcp → ask: which employer? which period?    (no web, no credential)

Step 2  load baseline = previous period's finalized dataset (store/baseline)
        take input: image OR xlsx from user
        user points at last month and states changes (new hire / resign / wage)
        → diff.ts applies changes as a REVIEWED diff (echo back, confirm)

Step 3  xlsx-summary: payroll + เงินสมทบ for month XX + diff vs last month
        → send xlsx to user, ask "ให้ยื่นให้เลยไหม?"
          (state plainly: system goes only to SAVE; final ส่ง is the user's,
           unless they confirm "ยื่นเลย")
        → txt-generator builds sso110.txt from the same numbers
        → Tier-1 validate (offline)

--- web opens here, only on explicit "ส่งประกันสังคม" ---

        → login (Credential Manager, session)
        → DUP-CHECK: is this employer+period already submitted? → yes = stop/warn
        → e-Service: ส่งเงินสมทบ → แยกยื่น → เลือกนายจ้าง+งวด → แนบไฟล์ → SAVE
        → Tier-2 reconcile (fail-closed) + sanity flags
        → STOP at the summary screen (saved, not submitted)
        → final ยืนยัน/นำส่ง = USER presses it
             └─ exception: user said "ยื่นเลย/ยืนยัน" → system presses it
        → on submit: capture receipt; save as next baseline; append history
```

---

## 15. MCP surface

**Prompts**
- `/ssomcp [request]` — entry point; loads context, asks employer + period.
- `/ssomcp-change <employer>` — switch + verify active employer.
- `/ssomcp-refresh` — re-pull employer registry, overwrite cache.

**Tools**
- `get_active_employer` — auth on demand, report active employer.
- `change_active_employer` — switch + re-auth + verify.
- `prepare_contribution` — diff + calc + build xlsx + txt + Tier-1 validate (no network).
- `upload_contribution` — login → attach → save → return verify-screen totals.
- `verify_summary` — Tier-2 reconcile computed vs on-screen; pass/fail + diff.
- `submit_contribution` — save/attach + reconcile, then **stop at save**. Presses
  final ยืนยัน only on explicit per-run user confirmation; never by default.
- `refresh_employers` — re-fetch registry, overwrite cache.
- `query_history` — answer usage questions from local history (§8.2).

### 15.1 Command behavior
- **`/ssomcp`** (bare) → ask **which employer + which period**. No web, no credential.
  - employer accepts a nickname/code, mapped to เลขบัญชีนายจ้าง + สาขา
    (show a code→name table like `/flowaccountchange`).
  - period accepts `MM/YYYY` or "last month"; **echo the full period back and confirm**
    (period slips are common early in the month).
- **`/ssomcp <employer> <period>`** → straight into Step 2 (load baseline, take input).
- **`/ssomcp-change <employer>`** → switch + verify active employer only.
- **`/ssomcp-refresh`** → re-pull registry, overwrite cache.
- Web/credential touched **only** on explicit ส่งประกันสังคม.
- After the summary xlsx, the system **asks** "ให้ยื่นให้เลยไหม?" and states it will go
  only to **save**; the final ส่ง is the user's unless they confirm "ยื่นเลย".

---

## 16. Safety & controls

- **Save ≠ Submit — hard boundary.** System goes up to *save/แนบไฟล์* and the
  reconcile screen, then **stops**. Final ยืนยัน/นำส่ง is the **user's**; only an
  explicit per-run "ยื่นเลย" lets the system press it. No standing auto-submit.
- **No double-submission** — verify against e-Service that the period isn't already
  filed before proceeding; crash recovery reconciles with the site, never blind-resubmits.
- **Fail-closed verify** — if the pre-submit summary can't be read/parsed, stop and
  force a human; "couldn't read it" is never treated as pass.
- **No login retry loop** — one attempt per run, then pause; protects the client's
  account from lockout on a gov portal.
- **Audit/history** every run: employer, period, counts, totals, timestamp, status.
- **Test employer first** — never debug against a live account.
- **Credential out of model context**; no plaintext; nothing sensitive committed.
- **PII discipline** — baseline encrypted at rest; per-person data never in history/logs.
- Gov write ≠ private-system write — verify + user approval are mandatory.

---

## 17. Open questions (confirm before build)

1. e-Service **employer** login — still plain user/password, or captcha/OTP now?
   (v1 assumes user/password.)
2. Real สปส.1-10 sample to lock the §7 config values (padding / decimal / year / encoding).
3. คำนำหน้าชื่อ code list.
4. Rounding rule for สตางค์.
5. **Wage floor for 2569** — the กฎกระทรวง set ค่าจ้างขั้นต่ำ too; confirm the number
   (§10 seeds 1,650 pending check).
6. **Does e-Service show recomputed totals BEFORE the final submit?** The Tier-2
   before-submit safety model depends on it (§13). If not, P2 must be redesigned.
7. Does e-Service expose whether a period is **already submitted** (for the dup guard)?

**Resolved:** e-Service accepts `.txt` only; `.xlsx` is human-review (see §2).

---

## 18. Phases

- **P0** — `txt-generator` + `calc` + `validate` + `field-spec`/`ceilings` config + unit tests.
  Offline; produces a self-consistent txt with zero web access. **Start here.**
- **P1** — `actuator`: login + attach + save + read verify screen (save-only, never submits).
- **P2** — `reconcile` (Tier-2, fail-closed) + pre-submit dup-check + crash recovery
  + sanity flags + ask-to-file + save-stop (submit only on explicit confirm).
- **P3** — `store/employers` + `/ssomcp-refresh`, `store/history` + `query_history`,
  `store/baseline` (DPAPI) + delta model, multi-employer batch.
- **P4** — สปส.1-10/1 (รวมสาขา), then ทะเบียน (1-03 / 6-09 / 6-10).

### P0 test plan (test/)
- **txt-generator**: golden-file compare; every line == 135 bytes; TIS-620 round-trip;
  Thai name at exactly/over field length (truncation warns); money → satang encoding;
  date/period formatting; CRLF; **พ.ศ. conversion only at format()** (feed 2026 → expect `69`,
  and no `+543` anywhere upstream).
- **calc**: wage below floor / at floor / between / at ceiling / above ceiling, per period rule;
  min-base and max-cap applied (floor→min share; 750 / 875 / 1000 caps);
  rounding edge cases (…x.995, …x.005); employer == employee share.
- **single-computation**: same `RunResult` → `writeTxt` totals == `writeXlsx` totals (no drift).
- **validate**: each Tier-1 rule green path + a crafted failure each (count mismatch,
  total mismatch, share split mismatch, per-person miscalc, 134/136-byte line, dup SSO id).

---

## 19. Reference implementation (P0)

Working TypeScript for the offline core. Values marked `CONFIRM` are the §17
open items — they live in config/comments so a real sample corrects them without
touching logic. Requires `iconv-lite` for TIS-620.

### types.ts
```ts
export interface Employee {
  ssoId: string;      // เลขประจำตัวประกันสังคม / บัตร ปชช. (13)
  prefixCode: string; // คำนำหน้า code (3)
  firstName: string;  // ชื่อ (30)
  lastName: string;   // นามสกุล (35)
  wage: number;       // ค่าจ้างจริง (THB, 2dp)
}
export interface Contribution {
  employee: Employee;
  baseWage: number;       // clamp(wage, floor, ceiling)
  employeeShare: number;
  employerShare: number;  // = employeeShare
}
export interface EmployerRef {
  nickname: string; accountNo: string; branch: string; name: string;
  province: string; // canonical — links to minimum-wage tier (§8.4)
}
export interface Period { month: number; yearCE: number; } // Gregorian, e.g. 2026
export interface CeilingRule {
  from: Period; to?: Period;
  ratePercent: number; wageFloor: number; wageCeiling: number; maxContribution: number;
}
export interface RunContext {
  employer: EmployerRef; period: Period; payDate: Date; // Gregorian
  employees: Employee[];
}
export interface RunResult {
  ctx: RunContext; rule: CeilingRule; lines: Contribution[];
  totals: {
    headcount: number; totalWage: number;
    employeeTotal: number; employerTotal: number; grandTotal: number;
  };
}
export type FieldKind =
  'const' | 'text' | 'int' | 'money' | 'dateDDMMYY' | 'periodMMYY';
export interface FieldSpec {
  name: string; length: number; align: 'left' | 'right'; pad: ' ' | '0';
  kind: FieldKind; const?: string;
}
```

### util/num.ts
```ts
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const round2 = (x: number) => Math.round(x * 100) / 100;   // 2dp
export const pad2 = (n: number) => String(n).padStart(2, '0');
```

### util/bytes.ts  (TIS-620 is single-byte, so byte length == char count for valid Thai)
```ts
import iconv from 'iconv-lite';
export const encodeTIS620 = (s: string) => iconv.encode(s, 'tis620');

export function fitLeft(s: string, len: number, pad = ' ') {
  const b = encodeTIS620(s);
  if (b.length === len) return { buf: b, truncated: false };
  if (b.length > len)  return { buf: b.subarray(0, len), truncated: true };
  return { buf: Buffer.concat([b, encodeTIS620(pad.repeat(len - b.length))]), truncated: false };
}
export function fitRight(s: string, len: number, pad = '0') {
  const b = encodeTIS620(s);
  if (b.length === len) return { buf: b, truncated: false };
  if (b.length > len)  return { buf: b.subarray(b.length - len), truncated: true };
  return { buf: Buffer.concat([encodeTIS620(pad.repeat(len - b.length)), b]), truncated: false };
}
```

### config/ceilings.ts
```ts
import { CeilingRule, Period } from '../types';
const num = (p: Period) => p.yearCE * 12 + (p.month - 1);

// wageFloor for 2026+ is UNCONFIRMED (§17). 1650 = pre-2569 figure, seeded pending check.
export const CEILING_RULES: CeilingRule[] = [
  { from: {month:1,yearCE:2000}, to:{month:12,yearCE:2025},
    ratePercent:5, wageFloor:1650, wageCeiling:15000, maxContribution:750 },
  { from: {month:1,yearCE:2026}, to:{month:12,yearCE:2028},
    ratePercent:5, wageFloor:1650 /*CONFIRM*/, wageCeiling:17500, maxContribution:875 },
  { from: {month:1,yearCE:2029}, to:{month:12,yearCE:2031},
    ratePercent:5, wageFloor:1650 /*CONFIRM*/, wageCeiling:20000, maxContribution:1000 },
];
export function lookupCeiling(p: Period): CeilingRule {
  const n = num(p);
  const r = CEILING_RULES.find(x => n >= num(x.from) && (!x.to || n <= num(x.to)));
  if (!r) throw new Error(`no ceiling rule for ${p.month}/${p.yearCE}`);
  return r;
}
```

### calc.ts  ← the ONLY place math happens (§8/§10 invariant)
```ts
import { RunContext, RunResult, Contribution } from './types';
import { lookupCeiling } from './config/ceilings';
import { sum, round2 } from './util/num';

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
export const roundSatang = (baht: number) => round2(baht);   // CONFIRM rule (§17)

export function computeRun(ctx: RunContext): RunResult {
  const rule = lookupCeiling(ctx.period);
  const lines: Contribution[] = ctx.employees.map(emp => {
    const baseWage = clamp(emp.wage, rule.wageFloor, rule.wageCeiling);
    const share = Math.min(roundSatang(baseWage * rule.ratePercent / 100), rule.maxContribution);
    return { employee: emp, baseWage, employeeShare: share, employerShare: share };
  });
  const employeeTotal = round2(sum(lines.map(l => l.employeeShare)));
  const employerTotal = round2(sum(lines.map(l => l.employerShare)));
  return {
    ctx, rule, lines,
    totals: {
      headcount: lines.length,
      totalWage: round2(sum(lines.map(l => l.employee.wage))), // ค่าจ้างทั้งสิ้น — CONFIRM: raw vs capped
      employeeTotal, employerTotal,
      grandTotal: round2(employeeTotal + employerTotal),
    },
  };
}
```

### validate.ts  (Tier-1)
```ts
import { RunResult } from './types';
import { sum, round2 } from './util/num';

export function validateTier1(r: RunResult): string[] {
  const e: string[] = [], t = r.totals;
  if (t.headcount !== r.lines.length) e.push('headcount != count(detail)');
  if (round2(sum(r.lines.map(l => l.employee.wage))) !== t.totalWage) e.push('totalWage != Σ wage');
  if (round2(t.employeeTotal + t.employerTotal) !== t.grandTotal) e.push('grandTotal != employee + employer');
  for (const l of r.lines) {
    const want = Math.min(round2(Math.min(Math.max(l.employee.wage, r.rule.wageFloor), r.rule.wageCeiling)
                    * r.rule.ratePercent / 100), r.rule.maxContribution);
    if (l.employeeShare !== want) e.push(`per-person miscalc ssoId=${l.employee.ssoId}`);
    if (l.employeeShare > r.rule.maxContribution) e.push(`over max ssoId=${l.employee.ssoId}`);
  }
  const seen = new Set<string>();
  for (const l of r.lines) {
    if (seen.has(l.employee.ssoId)) e.push(`duplicate ssoId=${l.employee.ssoId}`);
    seen.add(l.employee.ssoId);
  }
  return e; // empty = pass
}
```

### config/field-spec.ts  (align/pad/kind are §7 CONFIRM knobs)
```ts
import { FieldSpec } from '../types';
export const HEADER_SPEC: FieldSpec[] = [
  { name:'recordType',        length:1,  align:'left',  pad:' ', kind:'const', const:'1' },
  { name:'accountNo',         length:10, align:'left',  pad:' ', kind:'text' },   // CONFIRM align
  { name:'branch',            length:6,  align:'right', pad:'0', kind:'int' },
  { name:'payDate',           length:6,  align:'right', pad:'0', kind:'dateDDMMYY' },
  { name:'period',            length:4,  align:'right', pad:'0', kind:'periodMMYY' },
  { name:'employerName',      length:45, align:'left',  pad:' ', kind:'text' },
  { name:'rate',              length:4,  align:'right', pad:'0', kind:'int' },     // 5 -> "0005"? CONFIRM (maybe 0500)
  { name:'headcount',         length:6,  align:'right', pad:'0', kind:'int' },
  { name:'totalWage',         length:15, align:'right', pad:'0', kind:'money' },
  { name:'totalContribution', length:14, align:'right', pad:'0', kind:'money' },
  { name:'employeeContribution', length:12, align:'right', pad:'0', kind:'money' },
  { name:'employerContribution', length:12, align:'right', pad:'0', kind:'money' },
]; // Σ = 135
export const DETAIL_SPEC: FieldSpec[] = [
  { name:'recordType',   length:1,  align:'left',  pad:' ', kind:'const', const:'2' },
  { name:'ssoId',        length:13, align:'left',  pad:' ', kind:'text' },  // CONFIRM align/pad
  { name:'prefixCode',   length:3,  align:'left',  pad:' ', kind:'text' },
  { name:'firstName',    length:30, align:'left',  pad:' ', kind:'text' },
  { name:'lastName',     length:35, align:'left',  pad:' ', kind:'text' },
  { name:'wage',         length:14, align:'right', pad:'0', kind:'money' },
  { name:'contribution', length:12, align:'right', pad:'0', kind:'money' },
  { name:'filler',       length:27, align:'left',  pad:' ', kind:'const', const:'' },
]; // Σ = 135
```

### txt-generator.ts  ← pure consumer of RunResult; พ.ศ. only inside format()
```ts
import { FieldSpec, Period, RunResult } from './types';
import { HEADER_SPEC, DETAIL_SPEC } from './config/field-spec';
import { fitLeft, fitRight, encodeTIS620 } from './util/bytes';
import { pad2 } from './util/num';

const CRLF = Buffer.from('\r\n', 'latin1');

// THE ONLY +543 IN THE CODEBASE:
function format(f: FieldSpec, v: any): string {
  switch (f.kind) {
    case 'const':  return f.const ?? '';
    case 'text':   return String(v ?? '');
    case 'int':    return String(Math.trunc(Number(v)));
    case 'money':  return String(Math.round(Number(v) * 100));            // satang — CONFIRM
    case 'dateDDMMYY': { const d = v as Date;
      return pad2(d.getDate()) + pad2(d.getMonth()+1) + pad2((d.getFullYear()+543)%100); }
    case 'periodMMYY': { const p = v as Period;
      return pad2(p.month) + pad2((p.yearCE+543)%100); }
  }
}
function buildLine(spec: FieldSpec[], vals: Record<string, any>) {
  const warnings: string[] = []; const parts: Buffer[] = [];
  for (const f of spec) {
    const raw = format(f, vals[f.name]);
    const fit = f.align === 'left' ? fitLeft(raw, f.length, f.pad)
                                   : fitRight(raw, f.length, f.pad);
    if (fit.truncated) warnings.push(`truncated ${f.name}: "${raw}"`);
    if (fit.buf.length !== f.length) throw new Error(`${f.name} width ${fit.buf.length}!=${f.length}`);
    parts.push(fit.buf);
  }
  const buf = Buffer.concat(parts);
  if (buf.length !== 135) throw new Error(`line ${buf.length} != 135 bytes`);
  return { buf, warnings };
}

export function generateTxt(r: RunResult): { buf: Buffer; warnings: string[] } {
  const t = r.totals, c = r.ctx, warnings: string[] = [];
  const header = buildLine(HEADER_SPEC, {
    accountNo: c.employer.accountNo, branch: c.employer.branch,
    payDate: c.payDate, period: c.period, employerName: c.employer.name,
    rate: r.rule.ratePercent, headcount: t.headcount, totalWage: t.totalWage,
    totalContribution: t.grandTotal,
    employeeContribution: t.employeeTotal, employerContribution: t.employerTotal,
  });
  warnings.push(...header.warnings);
  const details = r.lines.map(l => {
    const d = buildLine(DETAIL_SPEC, {
      ssoId: l.employee.ssoId, prefixCode: l.employee.prefixCode,
      firstName: l.employee.firstName, lastName: l.employee.lastName,
      wage: l.employee.wage, contribution: l.employeeShare,
    });
    warnings.push(...d.warnings);
    return d.buf;
  });
  const lines = [header.buf, ...details];
  const buf = Buffer.concat(lines.flatMap((b, i) => i === 0 ? [b] : [CRLF, b]).concat([CRLF]));
  return { buf, warnings };
}
```

### orchestration (prepare, offline) — glue
```ts
import { RunContext } from './types';
import { computeRun } from './calc';
import { validateTier1 } from './validate';
import { generateTxt } from './txt-generator';
import { writeFileSync } from 'fs';

export function prepare(ctx: RunContext, outPath: string) {
  const run = computeRun(ctx);                 // math once
  const errs = validateTier1(run);             // Tier-1
  if (errs.length) throw new Error('Tier-1 failed:\n' + errs.join('\n')); // no file on fail
  const { buf, warnings } = generateTxt(run);  // pure consumer
  writeFileSync(outPath, buf);                 // raw TIS-620 bytes
  return { run, warnings };                    // xlsx-summary consumes the same `run`
}
```

---

## 20. Future development

### 20.1 Near-term hardening (deferred robustness, do after P0–P2 basics)
- **Payroll as source of truth (#1).** Today the delta model trusts the user to
  recall changes. Better: pull the period's numbers from WageSnapo / the payroll
  output and **reconcile** ssomcp's set against it before filing, so a wage change
  the user forgot can't be filed silently. This is the single biggest correctness gap.
- **Server-derived baseline (#5).** Prefer the previous *submitted* data from
  e-Service ("ใช้ข้อมูลเดิม") as the baseline, with the local file as a cache only —
  avoids desync when a period was filed manually or before adopting ssomcp.
- **Baseline backup / recovery (#6).** DPAPI ties the encrypted baseline to one
  machine. Add an encrypted **export + passphrase** for backup and machine
  migration, and keep the `store` layer abstract so it isn't hard-bound to DPAPI
  (path to macOS/Linux later).
- **Late-filing surcharge — เงินเพิ่ม (#12).** สปส.1-10 has a surcharge when filed
  late. v1 assumes on-time only; add the surcharge fields + calc, or keep an
  explicit guard that refuses late periods until supported.
- **Approval audit (#13).** Bind who approved a given submission (and when) to the
  history record — meaningful for a gov filing done on a client's behalf.
- **Portal-change resilience (#14).** The actuator drives an unofficial web flow;
  add a **canary check** of key selectors/labels at start of a run and fail
  gracefully with a clear "e-Service layout changed" message instead of misclicking.
  Revisit the ToS/appropriateness of automating a government portal periodically.
- **Image input hardening (#10).** OCR of เลข ปชช./ชื่อไทย/ค่าจ้าง is high-risk on a
  gov filing. Either restrict image input to *confirmed-one-at-a-time changes*, or
  drop it from v1 and rely on xlsx, until OCR confidence + confirmation is solid.
- **Per-branch / per-employee province.** Minimum wage follows the employee's actual
  work location, not the head office. When an employer spans provinces, store province
  at branch level or allow a per-person override (v1 keeps it at employer level).

### 20.2 Longer-term features
- **More forms.** สปส.1-10/1 (รวมสาขา), then ทะเบียน: สปส.1-03 (แจ้งเข้า),
  6-09 (แจ้งออก), 6-10 (เปลี่ยนแปลง) — reuse the same actuator + credential + baseline.
- **Deadline reminders.** Filing is monthly with a due date; a scheduler that flags
  "งวด XX ยังไม่ยื่น" across all cached employers before the deadline (ties to §8.2 history).
- **Multi-client dashboard.** One view of every employer's filing status for the
  period (filed / saved / pending / มีปัญหา) — natural extension of `query_history`.
- **Receipt archival.** After submit, auto-download ใบเสร็จ + สปส.1-10 PDF per period
  (cf. ACC SSO Downloader) into an organized per-client folder for audit.
- **e-Payment step.** After นำส่ง, surface the payment channel / QR so the whole
  cycle (file → pay) is one flow — still user-confirmed for the money movement.
- **Firm / multi-user mode.** Shared setup for an accounting firm: per-staff
  credentials, role-based access to clients, centralized (still encrypted) baseline
  + audit — aligns with WageSnapo's "for accounting firms" target.
- **Cross-platform.** Abstract Windows-only pieces (Credential Manager, DPAPI) so
  ssomcp can run on macOS/Linux with the equivalent keychain/secret store.
- **Config sync with WageSnapo.** Share the employer registry and employee baseline
  with WageSnapo instead of maintaining a parallel copy, so payroll and filing stay
  in lockstep by construction.

---

## 21. References
- File layout: panyame.com — รูปแบบไฟล์ Text สปส.1-10
- Auth/credential base: riniort/flowaccount-mcp (`src/auth/*`)
- Pattern: EASY-ACC prepare/run split
- Contribution ceiling 2569–2571 (17,500 → 875): SSO stepwise adjustment, effective 1 Jan 2569
