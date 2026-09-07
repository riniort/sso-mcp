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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ssomcp-server-test-'));
  roots.push(root);
  const protector = new TestProtector();
  const server = createSsoMcpServer({ storeRoot: root, outputRoot: join(root, 'output'), protector });
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
