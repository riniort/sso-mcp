import { describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import type {
  ExistingFiling,
  PortalSummary,
  SsoPortalActuator,
  SubmissionReceipt,
} from '../src/sso/actuator.js';
import { fileContribution, FilingSafetyError } from '../src/sso/filing-coordinator.js';
import type { EmployerRef, Period, RunResult } from '../src/types.js';
import { sampleContext } from './fixtures.js';

class FakeActuator implements SsoPortalActuator {
  calls: string[] = [];
  existing: ExistingFiling | null = null;
  summary: PortalSummary;

  constructor(private readonly run: RunResult) {
    this.summary = { ...run.totals, draftId: 'draft-1' };
  }

  async login(_employer: EmployerRef): Promise<void> {
    this.calls.push('login');
  }

  async findExistingFiling(_employer: EmployerRef, _period: Period): Promise<ExistingFiling | null> {
    this.calls.push('duplicate-check');
    return this.existing;
  }

  async attachAndSave(_run: RunResult, txt: Buffer): Promise<PortalSummary> {
    expect(txt.length).toBeGreaterThan(0);
    this.calls.push('save');
    return this.summary;
  }

  async submitSavedDraft(_draftId: string): Promise<SubmissionReceipt> {
    this.calls.push('submit');
    return { receiptNo: 'R-1', submittedAt: new Date('2026-09-15T00:00:00Z') };
  }

  async close(): Promise<void> {
    this.calls.push('close');
  }
}

const confirmedOptions = { allowProvisionalRule: true } as const;

describe('fileContribution', () => {
  it('stops after save by default', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    const result = await fileContribution(run, actuator, { mode: 'save_only', ...confirmedOptions });
    expect(result.status).toBe('saved');
    expect(actuator.calls).toEqual(['login', 'duplicate-check', 'save', 'close']);
  });

  it('submits only with explicit per-run confirmation', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    const result = await fileContribution(run, actuator, {
      mode: 'submit',
      explicitSubmitConfirmation: true,
      ...confirmedOptions,
    });
    expect(result.status).toBe('submitted');
    expect(actuator.calls).toEqual(['login', 'duplicate-check', 'save', 'submit', 'close']);
  });

  it('rejects submit mode before opening the portal when confirmation is absent', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    await expect(fileContribution(run, actuator, { mode: 'submit', ...confirmedOptions })).rejects.toMatchObject({
      code: 'SUBMIT_NOT_CONFIRMED',
    });
    expect(actuator.calls).toEqual([]);
  });

  it('blocks provisional rules before opening the portal', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    await expect(fileContribution(run, actuator, { mode: 'save_only' })).rejects.toMatchObject({
      code: 'PROVISIONAL_RULE',
    });
    expect(actuator.calls).toEqual([]);
  });

  it('blocks an existing filing before save', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    actuator.existing = { status: 'submitted', reference: 'old-1' };
    await expect(fileContribution(run, actuator, { mode: 'save_only', ...confirmedOptions })).rejects.toMatchObject({
      code: 'EXISTING_FILING',
    });
    expect(actuator.calls).toEqual(['login', 'duplicate-check', 'close']);
  });

  it('never submits when portal reconciliation fails', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    actuator.summary.grandTotal = run.totals.grandTotal + 1;
    await expect(fileContribution(run, actuator, {
      mode: 'submit',
      explicitSubmitConfirmation: true,
      ...confirmedOptions,
    })).rejects.toBeInstanceOf(FilingSafetyError);
    expect(actuator.calls).toEqual(['login', 'duplicate-check', 'save', 'close']);
  });

  it('fails closed when the summary cannot be parsed', async () => {
    const run = computeRun(sampleContext());
    const actuator = new FakeActuator(run);
    actuator.summary = { draftId: 'draft-1' };
    await expect(fileContribution(run, actuator, { mode: 'save_only', ...confirmedOptions })).rejects.toMatchObject({
      code: 'SUMMARY_UNREADABLE',
    });
    expect(actuator.calls).toEqual(['login', 'duplicate-check', 'save', 'close']);
  });
});
