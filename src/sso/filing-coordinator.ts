import type { RunResult } from '../types.js';
import { generateTxt } from '../txt-generator.js';
import type { ExistingFiling, SsoPortalActuator, SubmissionReceipt } from './actuator.js';
import { reconcileSummary, type ReconcileDifference } from './reconcile.js';

export type FilingMode = 'save_only' | 'submit';

export interface FilingOptions {
  mode: FilingMode;
  /** Must be true for this exact invocation; never persist it as a preference. */
  explicitSubmitConfirmation?: boolean;
  /** Exceptional recovery path after the existing portal state has been reviewed by a human. */
  allowExistingFilingOverride?: boolean;
  /** Temporary escape hatch while the 2026+ wage floor remains unconfirmed. */
  allowProvisionalRule?: boolean;
}

export type FilingResult =
  | { status: 'saved'; draftId: string; warnings: string[] }
  | { status: 'submitted'; draftId: string; receipt: SubmissionReceipt; warnings: string[] };

export class FilingSafetyError extends Error {
  constructor(
    public readonly code:
      | 'PROVISIONAL_RULE'
      | 'EXISTING_FILING'
      | 'SUMMARY_UNREADABLE'
      | 'SUMMARY_MISMATCH'
      | 'MISSING_DRAFT_ID'
      | 'SUBMIT_NOT_CONFIRMED',
    message: string,
    public readonly details?: ExistingFiling | ReconcileDifference[],
  ) {
    super(message);
    this.name = 'FilingSafetyError';
  }
}

/**
 * Runs one filing attempt. There is deliberately no retry loop around login or any portal action.
 */
export async function fileContribution(
  run: RunResult,
  actuator: SsoPortalActuator,
  options: FilingOptions,
): Promise<FilingResult> {
  // Finish all offline validation before credentials or the browser are touched.
  const generated = generateTxt(run);
  if (run.rule.provisional && options.allowProvisionalRule !== true) {
    throw new FilingSafetyError(
      'PROVISIONAL_RULE',
      'Live filing is blocked because the contribution rule is still provisional',
    );
  }
  if (options.mode === 'submit' && options.explicitSubmitConfirmation !== true) {
    throw new FilingSafetyError(
      'SUBMIT_NOT_CONFIRMED',
      'Final submission requires explicit confirmation for this run',
    );
  }

  try {
    await actuator.login(run.ctx.employer); // exactly one attempt
    const existing = await actuator.findExistingFiling(run.ctx.employer, run.ctx.period);
    if (existing && options.allowExistingFilingOverride !== true) {
      throw new FilingSafetyError(
        'EXISTING_FILING',
        `Portal already contains a ${existing.status} filing for this employer and period`,
        existing,
      );
    }

    const summary = await actuator.attachAndSave(run, generated.buf);
    const reconciliation = reconcileSummary(run, summary);
    if (!reconciliation.ok) {
      const unreadable = reconciliation.differences.some((difference) => difference.reason === 'missing');
      throw new FilingSafetyError(
        unreadable ? 'SUMMARY_UNREADABLE' : 'SUMMARY_MISMATCH',
        unreadable ? 'Portal summary is incomplete or unreadable' : 'Portal summary does not match local totals',
        reconciliation.differences,
      );
    }
    if (!summary.draftId) {
      throw new FilingSafetyError('MISSING_DRAFT_ID', 'Portal saved the data but returned no draft identifier');
    }

    if (options.mode === 'save_only') {
      return { status: 'saved', draftId: summary.draftId, warnings: generated.warnings };
    }

    const receipt = await actuator.submitSavedDraft(summary.draftId);
    return { status: 'submitted', draftId: summary.draftId, receipt, warnings: generated.warnings };
  } finally {
    await actuator.close();
  }
}
