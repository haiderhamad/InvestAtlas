const MAX_LOGICAL_ID_LENGTH = 512;

/**
 * Top-level legacy collections share one physical document-ID namespace.
 * Prefix every new document with the authenticated UID so two users can safely
 * import or create the same logical record ID.
 */
export function getUserScopedDocumentId(userId: string, logicalId: string): string {
  const normalizedUserId = userId.trim();
  const normalizedLogicalId = logicalId.trim();

  if (!normalizedUserId || !normalizedLogicalId) {
    throw new Error('A user ID and logical document ID are required.');
  }
  if (normalizedLogicalId.length > MAX_LOGICAL_ID_LENGTH) {
    throw new Error('The logical document ID is too long.');
  }

  return `${encodeURIComponent(normalizedUserId)}~${encodeURIComponent(normalizedLogicalId)}`;
}
