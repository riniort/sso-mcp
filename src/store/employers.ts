import { join } from 'node:path';
import type { EmployerRef } from '../types.js';
import { atomicWritePrivateFile, readJsonOr } from './fs.js';

export interface CachedEmployer extends EmployerRef {
  cachedAt: string;
}

interface EmployerFile {
  version: 1;
  employers: CachedEmployer[];
}

const EMPTY_FILE: EmployerFile = { version: 1, employers: [] };

function key(employer: Pick<EmployerRef, 'accountNo' | 'branch'>): string {
  return `${employer.accountNo}:${employer.branch.padStart(6, '0')}`;
}

function validateEmployer(employer: CachedEmployer): void {
  if (!employer.nickname.trim()) throw new Error('employer nickname is required');
  if (!/^\d{10}$/.test(employer.accountNo)) throw new Error('employer accountNo must be 10 digits');
  if (!/^\d{1,6}$/.test(employer.branch)) throw new Error('employer branch must be 1-6 digits');
  if (!employer.name.trim()) throw new Error('employer name is required');
  if (!employer.province.trim()) throw new Error('canonical employer province is required');
  if (Number.isNaN(Date.parse(employer.cachedAt))) throw new Error('cachedAt must be an ISO date');
  const forbidden = employer as CachedEmployer & { password?: unknown; credential?: unknown };
  if (forbidden.password !== undefined || forbidden.credential !== undefined) {
    throw new Error('credentials must not be stored in employers.json');
  }
}

export class EmployerStore {
  private readonly path: string;

  constructor(root: string) {
    this.path = join(root, 'employers.json');
  }

  async list(): Promise<CachedEmployer[]> {
    const file = await readJsonOr<EmployerFile>(this.path, EMPTY_FILE);
    if (file.version !== 1 || !Array.isArray(file.employers)) throw new Error('unsupported employers file');
    file.employers.forEach(validateEmployer);
    return [...file.employers].sort((a, b) => a.nickname.localeCompare(b.nickname, 'th'));
  }

  async find(reference: string): Promise<CachedEmployer | undefined> {
    const normalized = reference.trim().toLocaleLowerCase('en-US');
    return (await this.list()).find(
      (employer) =>
        employer.nickname.toLocaleLowerCase('en-US') === normalized || key(employer) === reference,
    );
  }

  async replaceAll(employers: CachedEmployer[]): Promise<void> {
    employers.forEach(validateEmployer);
    const accountKeys = new Set<string>();
    const nicknames = new Set<string>();
    for (const employer of employers) {
      const accountKey = key(employer);
      const nickname = employer.nickname.toLocaleLowerCase('en-US');
      if (accountKeys.has(accountKey)) throw new Error(`duplicate employer account/branch: ${accountKey}`);
      if (nicknames.has(nickname)) throw new Error(`duplicate employer nickname: ${employer.nickname}`);
      accountKeys.add(accountKey);
      nicknames.add(nickname);
    }
    const file: EmployerFile = { version: 1, employers };
    await atomicWritePrivateFile(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }

  async upsert(employer: CachedEmployer): Promise<void> {
    validateEmployer(employer);
    const employers = await this.list();
    const index = employers.findIndex((candidate) => key(candidate) === key(employer));
    if (index >= 0) employers[index] = employer;
    else employers.push(employer);
    await this.replaceAll(employers);
  }
}
