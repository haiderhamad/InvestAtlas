import type { ShariahStatus } from '@/lib/types/shariah';

export const SHARIAH_DECISION_STATUSES = [
  'compliant',
  'non_compliant',
  'review_required',
  'insufficient_data',
] as const;

export type ShariahDecisionStatus = (typeof SHARIAH_DECISION_STATUSES)[number];

export interface ShariahDecisionInput {
  legacyStatus?: ShariahStatus | null;
  hasVerifiedEvidence?: boolean;
  requiresManualReview?: boolean;
  evaluationFailed?: boolean;
}

export function resolveShariahDecision({
  legacyStatus,
  hasVerifiedEvidence = false,
  requiresManualReview = false,
  evaluationFailed = false,
}: ShariahDecisionInput): ShariahDecisionStatus {
  if (evaluationFailed || !legacyStatus) {
    return 'insufficient_data';
  }

  if (legacyStatus === 'Non-Compliant') {
    return 'non_compliant';
  }

  if (
    requiresManualReview ||
    legacyStatus === 'Doubtful' ||
    legacyStatus === 'Blocked: Source Conflict'
  ) {
    return 'review_required';
  }

  if (
    legacyStatus === 'Blocked: Insufficient Evidence' ||
    legacyStatus === 'Not Screenable'
  ) {
    return 'insufficient_data';
  }

  return hasVerifiedEvidence ? 'compliant' : 'review_required';
}

export function isShariahCompliant(status: ShariahDecisionStatus): boolean {
  return status === 'compliant';
}

export function toLegacyShariahStatus(status: ShariahDecisionStatus): ShariahStatus {
  switch (status) {
    case 'compliant':
      return 'Compliant';
    case 'non_compliant':
      return 'Non-Compliant';
    case 'review_required':
      return 'Doubtful';
    case 'insufficient_data':
      return 'Blocked: Insufficient Evidence';
  }
}

export function getShariahDecisionLabel(status: ShariahDecisionStatus): string {
  switch (status) {
    case 'compliant':
      return 'Compliant';
    case 'non_compliant':
      return 'Non-compliant';
    case 'review_required':
      return 'Review required';
    case 'insufficient_data':
      return 'Insufficient data';
  }
}

/**
 * Translation key shared by API-backed and catalogue-backed decisions. Detailed
 * provider evidence can be shown separately once a dated source is available.
 */
export function getShariahDecisionReason(status: ShariahDecisionStatus): string {
  switch (status) {
    case 'compliant':
      return 'Current dated evidence meets the implemented screening methodology.';
    case 'non_compliant':
      return 'The implemented core-activity screen flags this asset as non-compliant. This is informational and not a religious ruling.';
    case 'review_required':
      return 'The stored catalogue entry lacks current dated evidence. Manual review is required.';
    case 'insufficient_data':
      return 'No current, verifiable Shariah evidence is available for this asset in InvestAtlas.';
  }
}
