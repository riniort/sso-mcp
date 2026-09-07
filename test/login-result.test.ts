import { describe, expect, it } from 'vitest';
import { classifyLoginResult } from '../src/sso/login-result.js';

describe('classifyLoginResult', () => {
  it('accepts a session that left the login form with no challenge', () => {
    expect(
      classifyLoginResult({
        url: 'https://www.sso.go.th/eservices/esv/main.do',
        stillOnLoginForm: false,
        humanRequiredHits: 0,
      }),
    ).toEqual({ ok: true });
  });

  it('stops for a captcha/OTP challenge instead of retrying', () => {
    const outcome = classifyLoginResult({
      url: 'https://www.sso.go.th/eservices/esv/login.do',
      stillOnLoginForm: true,
      humanRequiredHits: 1,
    });
    expect(outcome).toMatchObject({ ok: false, code: 'NEEDS_HUMAN' });
  });

  it('prefers the human-required stop even if still on the form', () => {
    const outcome = classifyLoginResult({
      url: 'https://www.sso.go.th/eservices/esv/login.do',
      stillOnLoginForm: true,
      humanRequiredHits: 2,
      errorText: 'รหัสผ่านไม่ถูกต้อง',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'NEEDS_HUMAN' });
  });

  it('reports a plain login failure with any surfaced error text', () => {
    const outcome = classifyLoginResult({
      url: 'https://www.sso.go.th/eservices/esv/login.do',
      stillOnLoginForm: true,
      humanRequiredHits: 0,
      errorText: 'รหัสผ่านไม่ถูกต้อง',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'LOGIN_FAILED' });
    expect((outcome as { message: string }).message).toContain('รหัสผ่านไม่ถูกต้อง');
  });
});
