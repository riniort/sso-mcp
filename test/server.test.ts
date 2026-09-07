import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSsoMcpServer } from '../src/server.js';
import { BaselineStore } from '../src/store/baseline.js';
import { EmployerStore } from '../src/store/employers.js';
import type { DataProtector } from '../src/store/protector.js';
import type { SsoPortalActuator } from '../src/sso/actuator.js';
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

const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];

type ServerOptions = NonNullable<Parameters<typeof createSsoMcpServer>[0]>;

async function setup(
  portal?: ServerOptions['portal'],
  credentialWriter?: ServerOptions['credentialWriter'],
) {
  const root = await mkdtemp(join(tmpdir(), 'ssomcp-server-test-'));
  roots.push(root);
  const protector = new TestProtector();
  const server = createSsoMcpServer({
    storeRoot: root,
    outputRoot: join(root, 'output'),
    protector,
    ...(portal ? { portal } : {}),
    ...(credentialWriter ? { credentialWriter } : {}),
  });
  const client = new Client({ name: 'ssomcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { root, protector, client };
}

function jsonText(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== 'text') throw new Error('expected text tool result');
  return JSON.parse(first.text) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MCP server', () => {
  it('advertises the designed prompts and tools', async () => {
    const { client } = await setup();
    expect((await client.listPrompts()).prompts.map(({ name }) => name).sort()).toEqual([
      'ssomcp', 'ssomcp-change', 'ssomcp-refresh',
    ]);
    expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
      'change_active_employer',
      'check_portal_login',
      'check_previous_submission',
      'create_employer',
      'get_active_employer',
      'prepare_contribution',
      'query_history',
      'refresh_employers',
      'submit_contribution',
      'upload_contribution',
      'verify_summary',
    ]);
  });

  it('connects employer and encrypted baseline storage to offline preparation', async () => {
    const { root, protector, client } = await setup();
    const ctx = sampleContext();
    await new EmployerStore(root).upsert({ ...ctx.employer, cachedAt: '2026-09-07T00:00:00.000Z' });
    await new BaselineStore(root, protector).saveSubmitted({
      employer: ctx.employer,
      period: { month: 7, yearCE: 2026 },
      employees: [ctx.employees[0]!],
      submittedAt: '2026-08-20T00:00:00.000Z',
    });

    const changed = await client.callTool({ name: 'change_active_employer', arguments: { employer: 'demo' } });
    expect(jsonText(changed).activeEmployer).toMatchObject({ nickname: 'demo' });
    const result = await client.callTool({
      name: 'prepare_contribution',
      arguments: {
        period: ctx.period,
        payDate: '2026-09-15',
        employees: ctx.employees,
      },
    });
    expect(result.isError).not.toBe(true);
    const value = jsonText(result);
    expect(value.baseline).toMatchObject({ source: 'encrypted-store', period: { month: 7, yearCE: 2026 } });
    expect(value.diff).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(value.totals).toMatchObject({ headcount: 2, grandTotal: 1915 });
    const files = value.files as { txtPath: string; xlsxPath: string };
    expect((await readFile(files.txtPath)).length).toBe(3 * 137);
    expect((await readFile(files.xlsxPath)).subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('creates an employer profile and triggers credential capture for that นายจ้าง', async () => {
    const writes: Array<{ target: string; label: string }> = [];
    const { root, client } = await setup(undefined, async (target, label) => {
      writes.push({ target, label });
      return 'written';
    });

    const result = await client.callTool({
      name: 'create_employer',
      arguments: {
        nickname: 'ลูกค้า A',
        accountNo: '1234567890',
        name: 'บริษัท เอ จำกัด',
        province: 'กรุงเทพมหานคร',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(jsonText(result)).toMatchObject({
      employer: { accountNo: '1234567890', branch: '0', nickname: 'ลูกค้า A' },
      credential: 'written',
    });
    // One credential per employer, keyed by accountNo only.
    expect(writes).toEqual([{ target: 'ssomcp:1234567890', label: 'บริษัท เอ จำกัด (1234567890)' }]);

    const persisted = await new EmployerStore(root).find('ลูกค้า A');
    expect(persisted).toMatchObject({ accountNo: '1234567890', province: 'กรุงเทพมหานคร' });
  });

  it('creates an employer profile without a login when asked', async () => {
    let called = false;
    const { client } = await setup(undefined, async () => {
      called = true;
      return 'written';
    });
    const result = await client.callTool({
      name: 'create_employer',
      arguments: {
        nickname: 'ลูกค้า B',
        accountNo: '9876543210',
        name: 'บริษัท บี จำกัด',
        province: 'นนทบุรี',
        captureCredential: false,
      },
    });
    expect(jsonText(result)).toMatchObject({ credential: 'skipped' });
    expect(called).toBe(false);
  });

  it('keeps the portal login check disabled unless live', async () => {
    const { client } = await setup();
    const result = await client.callTool({ name: 'check_portal_login', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/i);
  });

  it('runs the portal login check against a live actuator when configured', async () => {
    const calls: string[] = [];
    const fakeActuator: SsoPortalActuator = {
      async login() { calls.push('login'); },
      async findExistingFiling() { return null; },
      async attachAndSave() { throw new Error('unused'); },
      async submitSavedDraft() { throw new Error('unused'); },
      async close() { calls.push('close'); },
    };
    const { root, client } = await setup({ live: true, createActuator: () => fakeActuator });
    const ctx = sampleContext();
    await new EmployerStore(root).upsert({ ...ctx.employer, cachedAt: '2026-09-07T00:00:00.000Z' });

    const result = await client.callTool({
      name: 'check_portal_login',
      arguments: { employer: 'demo' },
    });
    expect(result.isError).not.toBe(true);
    expect(jsonText(result)).toMatchObject({ authenticated: true });
    expect(calls).toEqual(['login', 'close']);
  });

  it('reads previous submissions for the selected year when live', async () => {
    const fakeActuator = {
      async login() {},
      async findExistingFiling() { return null; },
      async attachAndSave() { throw new Error('unused'); },
      async submitSavedDraft() { throw new Error('unused'); },
      async close() {},
      async readSubmissionHistory() {
        return [
          {
            month: 7, yearCE: 2026, periodLabelBE: '07/2569', payDateBE: '14/08/2569',
            totalWage: 42796, ratePercent: 5, headcount: 5, contribution: 4280, surcharge: 0,
          },
        ];
      },
    };
    const { root, client } = await setup({ live: true, createActuator: () => fakeActuator });
    const ctx = sampleContext();
    await new EmployerStore(root).upsert({ ...ctx.employer, cachedAt: '2026-09-07T00:00:00.000Z' });

    const result = await client.callTool({
      name: 'check_previous_submission',
      arguments: { employer: 'demo', year: 2026 },
    });
    expect(result.isError).not.toBe(true);
    expect(jsonText(result)).toMatchObject({ yearBE: 2569, filedPeriods: ['07/2569'] });
  });

  it('keeps live filing tools registered but fail-closed', async () => {
    const { client } = await setup();
    const result = await client.callTool({
      name: 'submit_contribution',
      arguments: {
        employer: 'demo',
        period: { month: 8, yearCE: 2026 },
        explicitConfirmation: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(jsonText.bind(null, result)).toThrow();
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });
});
