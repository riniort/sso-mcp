/**
 * Pure decision logic for a single login attempt. Kept separate from Playwright so
 * the safety-critical rules (never auto-retry, stop on captcha/OTP, fail closed on
 * an unreadable outcome) can be unit-tested without a browser. See PROJECT.md §6.
 */
export interface LoginPageState {
  /** URL after the submit attempt settled. */
  url: string;
  /** Whether the login password field is still present (i.e. we never left the form). */
  stillOnLoginForm: boolean;
  /** Count of matched captcha/OTP/"needs human" hint elements. */
  humanRequiredHits: number;
  /** Any visible login error text (must be free of credentials/PII). */
  errorText?: string | undefined;
}

export type LoginOutcome =
  | { ok: true }
  | {
      ok: false;
      code: 'NEEDS_HUMAN' | 'LOGIN_FAILED';
      message: string;
    };

/**
 * Classify the result of the single permitted login attempt. Any ambiguity resolves
 * to a stop — this function never suggests another attempt.
 */
export function classifyLoginResult(state: LoginPageState): LoginOutcome {
  if (state.humanRequiredHits > 0) {
    return {
      ok: false,
      code: 'NEEDS_HUMAN',
      message:
        'SSO e-Service showed a captcha or OTP challenge. Stopping without retrying; ' +
        'a human must complete the login to avoid locking the employer account.',
    };
  }
  if (state.stillOnLoginForm) {
    const detail = state.errorText?.trim();
    return {
      ok: false,
      code: 'LOGIN_FAILED',
      message: detail
        ? `Login did not succeed (still on the login form): ${detail}`
        : 'Login did not succeed; the login form is still showing. Not retrying, to avoid account lockout.',
    };
  }
  return { ok: true };
}
