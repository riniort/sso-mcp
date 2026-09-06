import type { EmployerRef, Period, RunResult } from '../types.js';

export interface ExistingFiling {
  status: 'saved' | 'submitted';
  reference?: string;
}

export interface PortalSummary {
  draftId?: string;
  headcount?: number;
  totalWage?: number;
  employeeTotal?: number;
  employerTotal?: number;
  grandTotal?: number;
}

export interface SubmissionReceipt {
  receiptNo: string;
  submittedAt: Date;
}

/**
 * Narrow boundary for the future Playwright implementation.
 *
 * Credential lookup and typing happen inside the implementation. Implementations must never
 * return credentials, cookies, or page content containing employee PII through this interface.
 */
export interface SsoPortalActuator {
  login(employer: EmployerRef): Promise<void>;
  findExistingFiling(employer: EmployerRef, period: Period): Promise<ExistingFiling | null>;
  attachAndSave(run: RunResult, txt: Buffer): Promise<PortalSummary>;
  submitSavedDraft(draftId: string): Promise<SubmissionReceipt>;
  close(): Promise<void>;
}

/**
 * Intentionally non-functional until the real e-Service flow and selectors are verified.
 * This prevents a scaffold build from ever writing to the government portal by accident.
 */
export class UnconfiguredPortalActuator implements SsoPortalActuator {
  private unavailable(): never {
    throw new Error('SSO portal actuator is not configured; live filing is disabled');
  }

  async login(_employer: EmployerRef): Promise<void> {
    this.unavailable();
  }

  async findExistingFiling(_employer: EmployerRef, _period: Period): Promise<ExistingFiling | null> {
    return this.unavailable();
  }

  async attachAndSave(_run: RunResult, _txt: Buffer): Promise<PortalSummary> {
    return this.unavailable();
  }

  async submitSavedDraft(_draftId: string): Promise<SubmissionReceipt> {
    return this.unavailable();
  }

  async close(): Promise<void> {
    // No resources exist in the disabled adapter.
  }
}
