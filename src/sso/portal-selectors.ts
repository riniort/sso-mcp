/**
 * Portal selectors as data, so a real test-employer session can correct them
 * without touching actuator logic (same "config drives, not logic" principle as
 * field-spec.ts / ceilings.ts).
 *
 * `login` is VERIFIED against the live DOM of https://www.sso.go.th/eservices/esv/login.do
 * (captured 2026-09): a server-rendered servlet form that POSTs `cmd=doLogin`,
 * `login`, `password`. These are safe to rely on.
 *
 * `contribution` is UNVERIFIED: the deep ส่งเงินสมทบ → แยกยื่น → แนบไฟล์ → บันทึก flow
 * and its summary screen can only be confirmed from an authenticated test-employer
 * session (PROJECT.md §14, open questions §17.6/§17.7). Until then the browser
 * actuator keeps the write flow gated off. When you capture a real session, fill
 * these in and flip `enableWriteFlow`.
 */
export interface PortalSelectors {
  loginUrl: string;
  login: {
    /** How to tell we are still sitting on the unauthenticated login form. */
    passwordField: string;
    usernameField: string;
    submitButton: string;
    /** Elements whose presence means "stop, hand to a human" (never auto-retry). */
    humanRequiredHints: string[];
    /** Container(s) that may hold a login error message to surface (no PII). */
    errorText: string[];
  };
  /** UNVERIFIED — see file header. */
  contribution: {
    menuUrl?: string;
    fileInput?: string;
    saveButton?: string;
    submitButton?: string;
    summaryTable?: string;
  };
}

export const PORTAL: PortalSelectors = {
  loginUrl: 'https://www.sso.go.th/eservices/esv/login.do',
  login: {
    // Verified: input#tx_userName[name=login], input#tx_password[name=password],
    // and an input[type=button] whose value is "เข้าสู่ระบบ" that submits the form.
    usernameField: '#tx_userName',
    passwordField: '#tx_password',
    submitButton: 'input[type="button"][value="เข้าสู่ระบบ"]',
    humanRequiredHints: [
      '[id*="captcha" i]',
      '[class*="captcha" i]',
      'img[src*="captcha" i]',
      'input[name*="otp" i]',
      '[id*="otp" i]',
    ],
    errorText: ['.alert-danger', '.error', '#errorMsg', '.login-error'],
  },
  contribution: {
    // menuUrl / fileInput / saveButton / submitButton / summaryTable:
    // capture from a real authenticated test-employer session before enabling.
  },
};
