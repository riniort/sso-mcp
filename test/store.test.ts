import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import { BaselineStore, type SubmittedBaseline } from '../src/store/baseline.js';
import { EmployerStore } from '../src/store/employers.js';
import { HistoryStore, historyEntryFromRun } from '../src/store/history.js';
import type { DataProtector } from '../src/store/protector.js';
import type { Period } from '../src/types.js';
import { sampleContext } from './fixtures.js';

class TestProtector implements DataProtector {
  readonly id = 'test-xor-v1';

  async protect(plaintext: Buffer): Promise<Buffer> {
    return Buffer.from(plaintext.map((byte) => byte ^ 0xa5));
  }

  async unprotect(ciphertext: Buffer): Promise<Buffer> {
    return this.protect(ciphertext);
  }
}

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ssomcp-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.length = 0;
});

describe('EmployerStore', () => {
  it('upserts employers without credential fields and uses private files', async () => {
    const root = await temporaryRoot();
    const store = new EmployerStore(root);
    await store.upsert({
      ...sampleContext().employer,
      cachedAt: '2026-09-07T00:00:00.000Z',
    });
    expect((await store.find('demo'))?.name).toBe('นิติบุคคลทดสอบ');
    const raw = await readFile(join(root, 'employers.json'), 'utf8');
    expect(raw).not.toMatch(/password|credential/iu);
    if (process.platform !== 'win32') expect((await stat(join(root, 'employers.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('HistoryStore', () => {
  it('stores totals and status without per-person rows', async () => {
    const root = await temporaryRoot();
    const store = new HistoryStore(root);
    const run = computeRun(sampleContext());
    await store.append(historyEntryFromRun(run, 'submitted', {
      timestamp: new Date('2026-09-07T01:00:00.000Z'),
      receiptNo: 'SSO-001',
    }));
    const entries = await store.findForPeriod('0000000000', '0', { month: 8, yearCE: 2026 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ headcount: 2, grandTotal: 1_916, status: 'submitted' });
    expect(await readFile(join(root, 'history.jsonl'), 'utf8')).not.toContain('0000000000000');
  });
});

describe('BaselineStore', () => {
  const baseline = (period: Period): SubmittedBaseline => ({
    employer: { accountNo: '0000000000', branch: '0' },
    period,
    employees: sampleContext().employees,
    submittedAt: new Date(Date.UTC(period.yearCE, period.month - 1, 20)).toISOString(),
  });

  it('stores only encrypted submitted datasets', async () => {
    const root = await temporaryRoot();
    const store = new BaselineStore(root, new TestProtector());
    await store.saveSubmitted(baseline({ month: 8, yearCE: 2026 }));
    const path = join(root, 'baseline', '0000000000-000000.json.dpapi');
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('ทดสอบหนึ่ง');
    expect(raw).not.toContain('0000000000000');
    expect((await store.getPeriod({ accountNo: '0000000000', branch: '0' }, { month: 8, yearCE: 2026 }))?.employees)
      .toHaveLength(2);
  });

  it('retains only the configured number of periods and selects the prior baseline', async () => {
    const root = await temporaryRoot();
    const store = new BaselineStore(root, new TestProtector(), 2);
    await store.saveSubmitted(baseline({ month: 6, yearCE: 2026 }));
    await store.saveSubmitted(baseline({ month: 7, yearCE: 2026 }));
    await store.saveSubmitted(baseline({ month: 8, yearCE: 2026 }));
    expect(await store.getPeriod({ accountNo: '0000000000', branch: '0' }, { month: 6, yearCE: 2026 }))
      .toBeUndefined();
    expect((await store.latestBefore({ accountNo: '0000000000', branch: '0' }, { month: 9, yearCE: 2026 }))?.period)
      .toEqual({ month: 8, yearCE: 2026 });
  });
});
