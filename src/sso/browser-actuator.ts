import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { EmployerRef, Period, RunResult } from '../types.js';
import type {
  ExistingFiling,
  PortalSummary,
  SsoPortalActuator,
  SubmissionReceipt,
} from './actuator.js';
import { classifyLoginResult, type LoginPageState } from './login-result.js';
import { PORTAL, type PortalSelectors } from './portal-selectors.js';
import {
  findSubmittedPeriod,
  parseHistoryRows,
  type SubmissionRecord,
} from './submission-history.js';
import { readWindowsCredential, type LoginCredential } from '../auth/windows-credential.js';

export class SsoPortalError extends Error {
  constructor(
    public readonly code:
      | 'CREDENTIAL_MISSING'
      | 'LOGIN_FAILED'
      | 'NEEDS_HUMAN'
      | 'WRITE_FLOW_UNVERIFIED'
      | 'PLAYWRIGHT_MISSING',
    message: string,
  ) {
    super(message);
    this.name = 'SsoPortalError';
  }
}

/** A credential provider returns the login for one employer, or null if absent. */
export type CredentialProvider = (employer: EmployerRef) => Promise<LoginCredential | null>;

/** Minimal launcher seam so tests can inject a fake browser without Playwright. */
export type BrowserLauncher = (options: { headless: boolean }) => Promise<Browser>;

export interface BrowserPortalActuatorOptions {
  headless?: boolean;
  loginTimeoutMs?: number;
  selectors?: PortalSelectors;
  launcher?: BrowserLauncher;
  credentialProvider?: CredentialProvider;
  /** Windows Credential Manager target prefix; combined with accountNo. */
  credentialTargetPrefix?: string;
  /**
   * Directory for persisted sessions. Each นายจ้าง has its own login, so the session
   * (storageState) is stored per employer account as `<dir>/<accountNo>.json` and never
   * shared across employers — reusing one employer's cookies for another would be wrong.
   */
  storageStateDir?: string;
  /**
   * The deep ส่งเงินสมทบ write flow (findExistingFiling/attachAndSave/submitSavedDraft)
   * is UNVERIFIED against a real authenticated session. It stays off until a
   * test-employer session confirms the selectors in portal-selectors.ts.
   */
  enableWriteFlow?: boolean;
}

const DEFAULT_LOGIN_TIMEOUT = 45000;

/**
 * Windows Credential Manager target for one employer, e.g. ssomcp:1234567890.
 *
 * Unlike FlowAccount (one login reaches many companies), each SSO e-Service นายจ้าง has its
 * own login. The login is issued per employer account (เลขที่บัญชีนายจ้าง) and covers all of
 * that employer's branches, so the credential is keyed by accountNo alone — branches share it.
 */
export function credentialTargetFor(prefix: string, employer: EmployerRef): string {
  return `${prefix}:${employer.accountNo}`;
}

async function defaultLauncher(options: { headless: boolean }): Promise<Browser> {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new SsoPortalError(
      'PLAYWRIGHT_MISSING',
      'Playwright is not installed. Run "npm install" and "npx playwright install chromium".',
    );
  }
  return chromium.launch({ headless: options.headless });
}

/**
 * Real Playwright implementation of the portal boundary.
 *
 * Verified today: login to SSO e-Service and landing inside the authenticated web
 * app, with exactly one login attempt and a fail-closed stop on any captcha/OTP or
 * unexpected screen. The write flow is deliberately gated until its selectors are
 * confirmed from a test-employer session.
 */
export class BrowserPortalActuator implements SsoPortalActuator {
  private readonly headless: boolean;
  private readonly loginTimeoutMs: number;
  private readonly selectors: PortalSelectors;
  private readonly launcher: BrowserLauncher;
  private readonly credentialProvider: CredentialProvider;
  private readonly storageStateDir: string | undefined;
  private readonly enableWriteFlow: boolean;

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private loggedIn = false;

  constructor(options: BrowserPortalActuatorOptions = {}) {
    this.headless = options.headless ?? true;
    this.loginTimeoutMs = options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT;
    this.selectors = options.selectors ?? PORTAL;
    this.launcher = options.launcher ?? defaultLauncher;
    this.storageStateDir = options.storageStateDir;
    this.enableWriteFlow = options.enableWriteFlow ?? false;
    const prefix = options.credentialTargetPrefix ?? 'ssomcp';
    this.credentialProvider =
      options.credentialProvider ??
      ((employer) => readWindowsCredential(credentialTargetFor(prefix, employer)));
  }

  /** Result of the last login, for read-only "prove the session works" reporting. */
  landedUrl: string | undefined;
  landedTitle: string | undefined;

  async login(employer: EmployerRef): Promise<void> {
    if (this.loggedIn) return;

    const credential = await this.credentialProvider(employer);
    if (!credential) {
      throw new SsoPortalError(
        'CREDENTIAL_MISSING',
        `No SSO e-Service credential found for นายจ้าง ${employer.accountNo}. ` +
          'Each employer has its own login; add it to Windows Credential Manager and never paste it into chat.',
      );
    }

    // Session is isolated per นายจ้าง: never reuse one employer's cookies for another.
    const sessionFile = this.storageStateDir
      ? join(this.storageStateDir, `${employer.accountNo}.json`)
      : undefined;

    this.browser = await this.launcher({ headless: this.headless });
    const reuseSession = Boolean(sessionFile && existsSync(sessionFile));
    this.context = await this.browser.newContext(
      reuseSession ? { storageState: sessionFile! } : {},
    );
    this.page = await this.context.newPage();
    const page = this.page;
    const { login } = this.selectors;

    await page.goto(this.selectors.loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.loginTimeoutMs,
    });

    const onLoginForm = await page
      .locator(login.passwordField)
      .first()
      .isVisible()
      .catch(() => false);

    // A reused session may land us straight inside the app; only type if the form is shown.
    if (onLoginForm) {
      await page.fill(login.usernameField, credential.username);
      await page.fill(login.passwordField, credential.password);
      // Exactly one attempt (PROJECT.md §6). No retry loop anywhere.
      await Promise.allSettled([
        page.waitForLoadState('networkidle', { timeout: this.loginTimeoutMs }),
        page.click(login.submitButton, { timeout: this.loginTimeoutMs }),
      ]);
    }

    const state = await this.readLoginState();
    const outcome = classifyLoginResult(state);
    if (!outcome.ok) {
      throw new SsoPortalError(outcome.code, outcome.message);
    }

    this.loggedIn = true;
    this.landedUrl = page.url();
    this.landedTitle = await page.title().catch(() => '');

    if (sessionFile) {
      await mkdir(dirname(sessionFile), { recursive: true }).catch(() => {});
      await this.context.storageState({ path: sessionFile }).catch(() => {});
    }
  }

  private async readLoginState(): Promise<LoginPageState> {
    const page = this.page!;
    const { login } = this.selectors;
    const stillOnLoginForm = await page
      .locator(login.passwordField)
      .first()
      .isVisible()
      .catch(() => false);

    let humanRequiredHits = 0;
    for (const hint of login.humanRequiredHints) {
      humanRequiredHits += await page.locator(hint).count().catch(() => 0);
    }

    let errorText: string | undefined;
    for (const selector of login.errorText) {
      const text = await page
        .locator(selector)
        .first()
        .textContent()
        .catch(() => null);
      if (text && text.trim()) {
        errorText = text.trim().slice(0, 200);
        break;
      }
    }

    return { url: page.url(), stillOnLoginForm, humanRequiredHits, errorText };
  }

  private ensureWriteFlow(operation: string): never | void {
    if (!this.enableWriteFlow) {
      throw new SsoPortalError(
        'WRITE_FLOW_UNVERIFIED',
        `${operation} is not available: the SSO e-Service contribution write flow has not been ` +
          'verified against a test-employer session. Login works, but the menu path, file input, ' +
          'save, and summary selectors in portal-selectors.ts must be confirmed before enabling it.',
      );
    }
  }

  /**
   * Read the รายการประวัติการส่งเงินสมทบ table on infoEmployeeContribute.do for one year.
   * Read-only: it only queries and parses, never files. Selectors verified from a live session.
   */
  async readSubmissionHistory(employer: EmployerRef, yearCE: number): Promise<SubmissionRecord[]> {
    if (!this.loggedIn || !this.page) {
      throw new SsoPortalError('LOGIN_FAILED', 'Not logged in; call login() first');
    }
    const page = this.page;
    const { history, login } = this.selectors;

    await page.goto(this.selectors.previousSubmissionUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.loginTimeoutMs,
    });

    // A session that dropped bounces back to the login form; do not silently re-login.
    const bounced = await page.locator(login.passwordField).first().isVisible().catch(() => false);
    if (bounced) {
      throw new SsoPortalError('LOGIN_FAILED', 'Session expired before reading submission history');
    }

    const yearBE = String(yearCE + 543);
    await page.selectOption(history.accountSelect, employer.accountNo).catch(() => {});
    await page.selectOption(history.branchSelect, employer.branch.padStart(6, '0')).catch(() => {});
    await page.selectOption(history.yearSelect, yearBE);
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: this.loginTimeoutMs }),
      page.click(history.searchButton, { timeout: this.loginTimeoutMs }),
    ]);

    const rows = (await page.evaluate(`
      (function () {
        var tables = Array.prototype.slice.call(document.querySelectorAll('table'));
        var target = tables.filter(function (t) {
          return ((t.rows[0] && t.rows[0].innerText) || '').indexOf('งวดเงินสมทบ') >= 0;
        })[0];
        if (!target) return [];
        return Array.prototype.slice.call(target.rows).map(function (r) {
          return Array.prototype.slice.call(r.cells).map(function (c) {
            return ((c.innerText || '')).trim();
          });
        });
      })()
    `)) as string[][];

    return parseHistoryRows(rows);
  }

  async findExistingFiling(employer: EmployerRef, period: Period): Promise<ExistingFiling | null> {
    const records = await this.readSubmissionHistory(employer, period.yearCE);
    const hit = findSubmittedPeriod(records, period);
    if (!hit) return null;
    return { status: 'submitted', reference: hit.payDateBE };
  }

  async attachAndSave(_run: RunResult, _txt: Buffer): Promise<PortalSummary> {
    this.ensureWriteFlow('Attach-and-save');
    throw new SsoPortalError('WRITE_FLOW_UNVERIFIED', 'Attach-and-save not yet implemented');
  }

  async submitSavedDraft(_draftId: string): Promise<SubmissionReceipt> {
    this.ensureWriteFlow('Final submission');
    throw new SsoPortalError('WRITE_FLOW_UNVERIFIED', 'Final submission not yet implemented');
  }

  async close(): Promise<void> {
    this.loggedIn = false;
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = undefined;
    this.page = undefined;
    this.browser = undefined;
  }
}
