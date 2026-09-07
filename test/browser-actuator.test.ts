import { describe, expect, it } from 'vitest';
import {
  BrowserPortalActuator,
  credentialTargetFor,
  SsoPortalError,
} from '../src/sso/browser-actuator.js';
import { buildActuator, resolvePortalConfig } from '../src/sso/actuator-factory.js';
import { UnconfiguredPortalActuator } from '../src/sso/actuator.js';
import type { EmployerRef, Period, RunResult } from '../src/types.js';

const employer: EmployerRef = {
  nickname: 'demo',
  accountNo: '1234567890',
  branch: '0',
  name: 'บริษัท ทดสอบ จำกัด',
  province: 'กรุงเทพมหานคร',
};
const period: Period = { month: 8, yearCE: 2026 };
const emptyRun = {} as RunResult;

describe('credentialTargetFor', () => {
  it('keys the credential per นายจ้าง (accountNo), shared across branches', () => {
    expect(credentialTargetFor('ssomcp', employer)).toBe('ssomcp:1234567890');
    // A second branch of the same employer resolves to the same login target.
    expect(credentialTargetFor('ssomcp', { ...employer, branch: '000001' })).toBe('ssomcp:1234567890');
  });
});

describe('BrowserPortalActuator credential handling', () => {
  it('fails closed when no credential is available (no browser launched)', async () => {
    let launched = false;
    const actuator = new BrowserPortalActuator({
      credentialProvider: async () => null,
      launcher: async () => {
        launched = true;
        throw new Error('launcher should not be called without a credential');
      },
    });
    await expect(actuator.login(employer)).rejects.toMatchObject({ code: 'CREDENTIAL_MISSING' });
    expect(launched).toBe(false);
  });
});

describe('BrowserPortalActuator write-flow gate', () => {
  const actuator = new BrowserPortalActuator({ credentialProvider: async () => null });

  it('requires a login before the (verified, read-only) duplicate check', async () => {
    await expect(actuator.findExistingFiling(employer, period)).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
    });
  });

  it('blocks attach-and-save until the write flow is verified', async () => {
    await expect(actuator.attachAndSave(emptyRun, Buffer.from('x'))).rejects.toBeInstanceOf(
      SsoPortalError,
    );
  });

  it('blocks final submission until the write flow is verified', async () => {
    await expect(actuator.submitSavedDraft('draft-1')).rejects.toMatchObject({
      code: 'WRITE_FLOW_UNVERIFIED',
    });
  });
});

describe('resolvePortalConfig / buildActuator', () => {
  it('defaults to disabled (unconfigured actuator, no browser)', () => {
    const config = resolvePortalConfig({}, '/tmp/store');
    expect(config).toMatchObject({ live: false, enableWriteFlow: false, headless: true });
    expect(buildActuator(config)).toBeInstanceOf(UnconfiguredPortalActuator);
  });

  it('enables the live browser actuator when SSOMCP_LIVE is set', () => {
    const config = resolvePortalConfig({ SSOMCP_LIVE: '1', SSOMCP_HEADFUL: '1' }, '/tmp/store');
    expect(config).toMatchObject({ live: true, headless: false });
    expect(buildActuator(config)).toBeInstanceOf(BrowserPortalActuator);
  });

  it('honors an explicit createActuator override', () => {
    const sentinel = new UnconfiguredPortalActuator();
    const config = resolvePortalConfig({ SSOMCP_LIVE: '1' }, '/tmp/store', {
      createActuator: () => sentinel,
    });
    expect(buildActuator(config)).toBe(sentinel);
  });
});
