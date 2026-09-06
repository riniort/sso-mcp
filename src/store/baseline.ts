import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Employee, EmployerRef, Period } from '../types.js';
import { atomicWritePrivateFile } from './fs.js';
import type { DataProtector } from './protector.js';

export interface SubmittedBaseline {
  employer: Pick<EmployerRef, 'accountNo' | 'branch'>;
  period: Period;
  employees: Employee[];
  submittedAt: string;
}

interface BaselineCollection {
  version: 1;
  baselines: SubmittedBaseline[];
}

interface EncryptedEnvelope {
  version: 1;
  protector: string;
  ciphertext: string;
}

const periodNumber = (period: Period): number => period.yearCE * 12 + period.month - 1;

function employerKey(employer: Pick<EmployerRef, 'accountNo' | 'branch'>): string {
  if (!/^\d{10}$/.test(employer.accountNo)) throw new Error('employer accountNo must be 10 digits');
  if (!/^\d{1,6}$/.test(employer.branch)) throw new Error('employer branch must be 1-6 digits');
  return `${employer.accountNo}-${employer.branch.padStart(6, '0')}`;
}

function validateBaseline(baseline: SubmittedBaseline): void {
  employerKey(baseline.employer);
  if (baseline.period.month < 1 || baseline.period.month > 12) throw new Error('invalid baseline period');
  if (Number.isNaN(Date.parse(baseline.submittedAt))) throw new Error('invalid baseline submittedAt');
  const ids = new Set<string>();
  for (const employee of baseline.employees) {
    if (!/^\d{13}$/.test(employee.ssoId)) throw new Error('baseline ssoId must be 13 digits');
    if (ids.has(employee.ssoId)) throw new Error(`duplicate baseline ssoId=${employee.ssoId}`);
    ids.add(employee.ssoId);
  }
}

export class BaselineStore {
  constructor(
    private readonly root: string,
    private readonly protector: DataProtector,
    private readonly retentionPeriods = 3,
  ) {
    if (!Number.isInteger(retentionPeriods) || retentionPeriods < 1) {
      throw new Error('retentionPeriods must be a positive integer');
    }
  }

  private pathFor(employer: Pick<EmployerRef, 'accountNo' | 'branch'>): string {
    return join(this.root, 'baseline', `${employerKey(employer)}.json.dpapi`);
  }

  private async readCollection(employer: Pick<EmployerRef, 'accountNo' | 'branch'>): Promise<BaselineCollection> {
    let envelope: EncryptedEnvelope;
    try {
      envelope = JSON.parse(await readFile(this.pathFor(employer), 'utf8')) as EncryptedEnvelope;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, baselines: [] };
      throw error;
    }
    if (envelope.version !== 1 || envelope.protector !== this.protector.id || !envelope.ciphertext) {
      throw new Error('unsupported or mismatched baseline encryption envelope');
    }
    const plaintext = await this.protector.unprotect(Buffer.from(envelope.ciphertext, 'base64'));
    const collection = JSON.parse(plaintext.toString('utf8')) as BaselineCollection;
    if (collection.version !== 1 || !Array.isArray(collection.baselines)) {
      throw new Error('unsupported baseline payload');
    }
    collection.baselines.forEach(validateBaseline);
    return collection;
  }

  /** The only write path: callers must supply a dataset confirmed submitted on e-Service. */
  async saveSubmitted(baseline: SubmittedBaseline): Promise<void> {
    validateBaseline(baseline);
    const collection = await this.readCollection(baseline.employer);
    const filtered = collection.baselines.filter(
      (candidate) => periodNumber(candidate.period) !== periodNumber(baseline.period),
    );
    filtered.push(baseline);
    filtered.sort((a, b) => periodNumber(b.period) - periodNumber(a.period));
    const payload: BaselineCollection = { version: 1, baselines: filtered.slice(0, this.retentionPeriods) };
    const ciphertext = await this.protector.protect(Buffer.from(JSON.stringify(payload), 'utf8'));
    const envelope: EncryptedEnvelope = {
      version: 1,
      protector: this.protector.id,
      ciphertext: ciphertext.toString('base64'),
    };
    await atomicWritePrivateFile(this.pathFor(baseline.employer), `${JSON.stringify(envelope)}\n`);
  }

  async getPeriod(
    employer: Pick<EmployerRef, 'accountNo' | 'branch'>,
    period: Period,
  ): Promise<SubmittedBaseline | undefined> {
    return (await this.readCollection(employer)).baselines.find(
      (baseline) => periodNumber(baseline.period) === periodNumber(period),
    );
  }

  async latestBefore(
    employer: Pick<EmployerRef, 'accountNo' | 'branch'>,
    period: Period,
  ): Promise<SubmittedBaseline | undefined> {
    const before = periodNumber(period);
    return (await this.readCollection(employer)).baselines
      .filter((baseline) => periodNumber(baseline.period) < before)
      .sort((a, b) => periodNumber(b.period) - periodNumber(a.period))[0];
  }
}
