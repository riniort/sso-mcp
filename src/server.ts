import { McpServer } from '@modelcontextprotocol/server';
import { join } from 'node:path';
import { z } from 'zod';
import { computeRun } from './calc.js';
import { diffEmployees } from './diff.js';
import { prepareContribution } from './prepare.js';
import { BaselineStore } from './store/baseline.js';
import { EmployerStore, type CachedEmployer } from './store/employers.js';
import { HistoryStore } from './store/history.js';
import type { DataProtector } from './store/protector.js';
import { WindowsDpapiProtector } from './store/protector.js';
import { defaultStoreRoot } from './store/root.js';
import type { Employee, Period } from './types.js';
import {
  buildActuator,
  resolvePortalConfig,
  type PortalRuntimeConfig,
} from './sso/actuator-factory.js';
import { BrowserPortalActuator, credentialTargetFor, SsoPortalError } from './sso/browser-actuator.js';
import { writeWindowsCredential, type CredentialWriteResult } from './auth/windows-credential.js';
import type { SubmissionRecord } from './sso/submission-history.js';

const periodSchema = z.object({
  month: z.number().int().min(1).max(12),
  yearCE: z.number().int().min(1900).max(9999),
});

const employeeSchema = z.object({
  ssoId: z.string().regex(/^\d{13}$/u),
  prefixCode: z.string().regex(/^\d{3}$/u),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  wage: z.number().nonnegative().multipleOf(0.01),
});

export interface SsoMcpServerOptions {
  storeRoot?: string;
  outputRoot?: string;
  protector?: DataProtector;
  version?: string;
  /** Live-portal runtime overrides; defaults come from environment (off by default). */
  portal?: Partial<PortalRuntimeConfig>;
  /** Override the credential-capture dialog (tests inject a fake; default is the native popup). */
  credentialWriter?: (target: string, label: string) => Promise<CredentialWriteResult>;
}

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

const disabledResult = (operation: string) => ({
  isError: true,
  content: [{
    type: 'text' as const,
    text: `${operation} is disabled: the verified SSO e-Service browser adapter is not implemented. No browser, credentials, or government data were touched.`,
  }],
});

function periodKey(period: Period): string {
  return `${period.yearCE}-${String(period.month).padStart(2, '0')}`;
}

function employerKey(employer: Pick<CachedEmployer, 'accountNo' | 'branch'>): string {
  return `${employer.accountNo}-${employer.branch.padStart(6, '0')}`;
}

export function createSsoMcpServer(options: SsoMcpServerOptions = {}): McpServer {
  const storeRoot = options.storeRoot ?? defaultStoreRoot();
  const outputRoot = options.outputRoot ?? join(storeRoot, 'output');
  const employers = new EmployerStore(storeRoot);
  const history = new HistoryStore(storeRoot);
  const baselines = new BaselineStore(
    storeRoot,
    options.protector ?? new WindowsDpapiProtector(),
  );
  let activeEmployer: CachedEmployer | undefined;
  const portalConfig = resolvePortalConfig(process.env, storeRoot, options.portal);
  const credentialWriter = options.credentialWriter ?? writeWindowsCredential;

  const server = new McpServer({ name: 'ssomcp', version: options.version ?? '0.1.0' });

  server.registerPrompt('ssomcp', {
    title: 'Prepare an SSO contribution filing',
    description: 'Start an offline-first monthly SSO contribution workflow.',
    argsSchema: z.object({ request: z.string().optional() }),
  }, ({ request }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: request?.trim()
          ? `Prepare an SSO contribution filing. Request: ${request}. Confirm the employer and full Gregorian filing period before preparing files. Do not access the web until I explicitly ask to file.`
          : 'Prepare an SSO contribution filing. Ask me which employer and Gregorian filing period to use. Do not access the web or credentials.',
      },
    }],
  }));

  server.registerPrompt('ssomcp-change', {
    title: 'Change active employer',
    argsSchema: z.object({ employer: z.string() }),
  }, ({ employer }) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Use change_active_employer to switch to cached employer ${employer}. Report its identity and cache timestamp.` } }],
  }));

  server.registerPrompt('ssomcp-refresh', {
    title: 'Refresh employers',
    description: 'Refresh the employer cache from SSO e-Service when the adapter is available.',
  }, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Refresh the cached employer registry. If live refresh is unavailable, explain that it is disabled without touching credentials.' } }],
  }));

  server.registerTool('get_active_employer', {
    title: 'Get active employer',
    description: 'Return the active cached employer and available cached employers. Never authenticates.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => textResult({ activeEmployer: activeEmployer ?? null, employers: await employers.list() }));

  server.registerTool('change_active_employer', {
    title: 'Change active employer',
    description: 'Select a locally cached employer by nickname or accountNo:branch. Never authenticates.',
    inputSchema: z.object({ employer: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ employer }) => {
    const match = await employers.find(employer);
    if (!match) throw new Error(`employer not found in ${join(storeRoot, 'employers.json')}`);
    activeEmployer = match;
    return textResult({ activeEmployer: match });
  });

  server.registerTool('create_employer', {
    title: 'Create employer profile',
    description:
      'Register a นายจ้าง in the local employer cache and, in the same step, capture its SSO ' +
      'e-Service login into Windows Credential Manager (one login per employer, keyed by ' +
      'accountNo). The password is typed into a native OS dialog, never into chat. Set ' +
      'captureCredential=false to add the profile without a login for now.',
    inputSchema: z.object({
      nickname: z.string().min(1).describe('Short name used to switch employers, e.g. "ลูกค้า A"'),
      accountNo: z.string().regex(/^\d{10}$/u).describe('เลขที่บัญชีนายจ้าง (10 digits)'),
      branch: z.string().regex(/^\d{1,6}$/u).optional().describe('ลำดับที่สาขา; defaults to "0"'),
      name: z.string().min(1).describe('ชื่อสถานประกอบการ'),
      province: z.string().min(1).describe('Canonical province (links to the minimum-wage tier)'),
      captureCredential: z.boolean().optional().describe('Prompt for the SSO login now (default true)'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ nickname, accountNo, branch, name, province, captureCredential }) => {
    const employer: CachedEmployer = {
      nickname,
      accountNo,
      branch: branch ?? '0',
      name,
      province,
      cachedAt: new Date().toISOString(),
    };
    await employers.upsert(employer);
    activeEmployer = employer;

    let credential: CredentialWriteResult | 'skipped' | 'already-set' = 'skipped';
    if (captureCredential !== false) {
      const target = credentialTargetFor(portalConfig.credentialTargetPrefix, employer);
      credential = await credentialWriter(target, `${name} (${accountNo})`);
    }

    return textResult({
      employer,
      credential,
      next:
        credential === 'written'
          ? 'Login saved. Use check_portal_login to verify the session (needs SSOMCP_LIVE=1).'
          : credential === 'cancelled'
            ? 'Profile saved without a login; add it later via check_portal_login when prompted.'
            : credential === 'unavailable'
              ? 'Profile saved. Credential capture needs Windows; add the login manually to Credential Manager.'
              : 'Profile saved.',
    });
  });

  server.registerTool('prepare_contribution', {
    title: 'Prepare contribution files',
    description: 'Load the cached employer and encrypted prior baseline, calculate contributions, and atomically write review XLSX and upload TXT files. No network access.',
    inputSchema: z.object({
      employer: z.string().min(1).optional().describe('Cached nickname or accountNo:branch; defaults to active employer'),
      period: periodSchema,
      payDate: z.string().date().describe('Gregorian date in YYYY-MM-DD format'),
      employees: z.array(employeeSchema).min(1),
      previousEmployees: z.array(employeeSchema).optional().describe('Optional explicit baseline; otherwise load latest submitted baseline before this period'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ employer, period, payDate, employees: currentEmployees, previousEmployees }) => {
    const selected = employer ? await employers.find(employer) : activeEmployer;
    if (!selected) throw new Error('no employer selected; call change_active_employer first');
    activeEmployer = selected;

    const storedBaseline = previousEmployees === undefined
      ? await baselines.latestBefore(selected, period)
      : undefined;
    const previous = previousEmployees ?? storedBaseline?.employees ?? [];
    const employeesForRun = currentEmployees as Employee[];
    const ctx = {
      employer: selected,
      period,
      payDate: new Date(`${payDate}T00:00:00.000Z`),
      employees: employeesForRun,
    };
    const run = computeRun(ctx);
    const diff = diffEmployees(previous, employeesForRun);
    const directory = join(outputRoot, employerKey(selected), periodKey(period));
    const stem = `sso110-${periodKey(period)}`;
    const files = {
      txtPath: join(directory, `${stem}.txt`),
      xlsxPath: join(directory, `${stem}-review.xlsx`),
    };
    const prepared = await prepareContribution(ctx, previous, files);
    return textResult({
      employer: selected,
      period,
      payDate,
      baseline: storedBaseline
        ? { source: 'encrypted-store', period: storedBaseline.period, submittedAt: storedBaseline.submittedAt }
        : { source: previousEmployees === undefined ? 'none' : 'request' },
      totals: run.totals,
      diff: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
      files,
      warnings: prepared.warnings,
      next: 'Review the XLSX. Live upload remains disabled until a verified portal adapter is installed.',
    });
  });

  server.registerTool('query_history', {
    title: 'Query filing history',
    description: 'Read the local totals-only audit history. This is not proof of current e-Service state.',
    inputSchema: z.object({
      employer: z.string().min(1).optional(),
      period: periodSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ employer, period }) => {
    const selected = employer ? await employers.find(employer) : activeEmployer;
    if (employer && !selected) throw new Error(`employer not found in ${join(storeRoot, 'employers.json')}`);
    const entries = selected
      ? period
        ? await history.findForPeriod(selected.accountNo, selected.branch, period)
        : (await history.list()).filter((entry) =>
            entry.employer.accountNo === selected.accountNo &&
            entry.employer.branch.padStart(6, '0') === selected.branch.padStart(6, '0'))
      : await history.list();
    return textResult({
      entries,
      caveat: 'Local history records what ssomcp did; confirm live filing state on e-Service.',
    });
  });

  server.registerTool('check_portal_login', {
    title: 'Check SSO e-Service login',
    description:
      'Log in to SSO e-Service for the selected employer and confirm the session reached the ' +
      'authenticated web app. Read-only: it never files, attaches, or submits. One login attempt; ' +
      'stops on any captcha/OTP. Credentials come from Windows Credential Manager, never chat.',
    inputSchema: z.object({
      employer: z.string().min(1).optional().describe('Cached nickname or accountNo:branch; defaults to active employer'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ employer }) => {
    if (!portalConfig.live) {
      return disabledResult('Portal login check');
    }
    const selected = employer ? await employers.find(employer) : activeEmployer;
    if (!selected) throw new Error('no employer selected; call change_active_employer first');
    activeEmployer = selected;

    const actuator = buildActuator(portalConfig);
    try {
      await actuator.login(selected);
      const landed =
        actuator instanceof BrowserPortalActuator
          ? { url: actuator.landedUrl, title: actuator.landedTitle }
          : {};
      return textResult({
        authenticated: true,
        employer: { accountNo: selected.accountNo, branch: selected.branch, nickname: selected.nickname },
        landed,
        note: 'Login and in-app navigation verified. No filing action was taken.',
      });
    } catch (error) {
      if (error instanceof SsoPortalError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Portal login check failed [${error.code}]: ${error.message}` }],
        };
      }
      throw error;
    } finally {
      await actuator.close();
    }
  });

  server.registerTool('check_previous_submission', {
    title: 'Check previous SSO submissions',
    description:
      'Log in and read the filed-contributions history (รายการประวัติการส่งเงินสมทบ) for an ' +
      'employer and year, to see which periods are already filed before preparing a new one. ' +
      'Read-only: it queries and reads, never files.',
    inputSchema: z.object({
      employer: z.string().min(1).optional().describe('Cached nickname or accountNo:branch; defaults to active employer'),
      year: z.number().int().min(2000).max(2100).optional().describe('Gregorian year (CE); defaults to the current year'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ employer, year }) => {
    if (!portalConfig.live) {
      return disabledResult('Previous-submission check');
    }
    const selected = employer ? await employers.find(employer) : activeEmployer;
    if (!selected) throw new Error('no employer selected; call change_active_employer first');
    activeEmployer = selected;
    const yearCE = year ?? new Date().getFullYear();

    const actuator = buildActuator(portalConfig);
    const reader = actuator as {
      readSubmissionHistory?: (e: CachedEmployer, y: number) => Promise<SubmissionRecord[]>;
    };
    try {
      await actuator.login(selected);
      if (typeof reader.readSubmissionHistory !== 'function') {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'This portal actuator cannot read submission history.' }],
        };
      }
      const records = await reader.readSubmissionHistory(selected, yearCE);
      return textResult({
        employer: { accountNo: selected.accountNo, branch: selected.branch, nickname: selected.nickname },
        yearCE,
        yearBE: yearCE + 543,
        filedPeriods: records.map((record) => record.periodLabelBE),
        records,
        note: 'Read-only view of filed contributions. No filing action was taken.',
      });
    } catch (error) {
      if (error instanceof SsoPortalError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Previous-submission check failed [${error.code}]: ${error.message}` }],
        };
      }
      throw error;
    } finally {
      await actuator.close();
    }
  });

  server.registerTool('refresh_employers', {
    title: 'Refresh employers from e-Service',
    description: 'Unavailable until the verified live portal adapter is implemented.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false },
  }, async () => disabledResult('Employer refresh'));

  server.registerTool('upload_contribution', {
    title: 'Upload and save contribution',
    description: 'Unavailable until the verified live portal adapter is implemented.',
    inputSchema: z.object({ employer: z.string(), period: periodSchema, txtPath: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async () => disabledResult('Contribution upload'));

  server.registerTool('verify_summary', {
    title: 'Verify e-Service summary',
    description: 'Unavailable until the verified live portal adapter is implemented.',
    inputSchema: z.object({ employer: z.string(), period: periodSchema }),
    annotations: { readOnlyHint: true },
  }, async () => disabledResult('Summary verification'));

  server.registerTool('submit_contribution', {
    title: 'Submit contribution',
    description: 'Final submission requires explicit per-run confirmation and a verified live portal adapter.',
    inputSchema: z.object({
      employer: z.string(),
      period: periodSchema,
      explicitConfirmation: z.literal(true),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async () => disabledResult('Final contribution submission'));

  return server;
}
