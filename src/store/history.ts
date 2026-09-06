import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Period, RunResult } from '../types.js';
import { ensurePrivateDirectory } from './fs.js';

export type FilingStatus = 'saved' | 'submitted' | 'cancelled';

export interface HistoryEntry {
  employer: {
    nickname: string;
    accountNo: string;
    branch: string;
    name: string;
  };
  period: Period;
  headcount: number;
  totalWage: number;
  grandTotal: number;
  timestamp: string;
  status: FilingStatus;
  receiptNo?: string;
}

function samePeriod(a: Period, b: Period): boolean {
  return a.month === b.month && a.yearCE === b.yearCE;
}

function validate(entry: HistoryEntry): void {
  if (!/^\d{10}$/.test(entry.employer.accountNo)) throw new Error('invalid employer accountNo in history');
  if (!/^\d{1,6}$/.test(entry.employer.branch)) throw new Error('invalid employer branch in history');
  if (entry.period.month < 1 || entry.period.month > 12) throw new Error('invalid history period');
  if (!Number.isInteger(entry.headcount) || entry.headcount < 0) throw new Error('invalid history headcount');
  if (Number.isNaN(Date.parse(entry.timestamp))) throw new Error('invalid history timestamp');
  if (entry.status === 'submitted' && !entry.receiptNo) throw new Error('submitted history requires receiptNo');
  if ('employees' in entry || 'lines' in entry) throw new Error('per-person data must not enter history');
}

export function historyEntryFromRun(
  run: RunResult,
  status: FilingStatus,
  options: { timestamp?: Date; receiptNo?: string } = {},
): HistoryEntry {
  const receiptNo = options.receiptNo;
  const entry: HistoryEntry = {
    employer: {
      nickname: run.ctx.employer.nickname,
      accountNo: run.ctx.employer.accountNo,
      branch: run.ctx.employer.branch,
      name: run.ctx.employer.name,
    },
    period: run.ctx.period,
    headcount: run.totals.headcount,
    totalWage: run.totals.totalWage,
    grandTotal: run.totals.grandTotal,
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    status,
    ...(receiptNo === undefined ? {} : { receiptNo }),
  };
  validate(entry);
  return entry;
}

export class HistoryStore {
  private readonly root: string;
  private readonly path: string;

  constructor(root: string) {
    this.root = root;
    this.path = join(root, 'history.jsonl');
  }

  async append(entry: HistoryEntry): Promise<void> {
    validate(entry);
    await ensurePrivateDirectory(this.root);
    const handle = await open(this.path, 'a', 0o600);
    try {
      await handle.write(`${JSON.stringify(entry)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async list(): Promise<HistoryEntry[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => {
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          validate(entry);
          return entry;
        } catch (error) {
          throw new Error(`invalid history record at line ${index + 1}`, { cause: error });
        }
      });
  }

  async findForPeriod(accountNo: string, branch: string, period: Period): Promise<HistoryEntry[]> {
    return (await this.list()).filter(
      (entry) =>
        entry.employer.accountNo === accountNo &&
        entry.employer.branch.padStart(6, '0') === branch.padStart(6, '0') &&
        samePeriod(entry.period, period),
    );
  }

  async latest(accountNo: string, branch: string): Promise<HistoryEntry | undefined> {
    return (await this.list())
      .filter(
        (entry) =>
          entry.employer.accountNo === accountNo &&
          entry.employer.branch.padStart(6, '0') === branch.padStart(6, '0'),
      )
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  }
}
