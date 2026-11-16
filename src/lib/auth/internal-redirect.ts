const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/i;
const ENCODED_CONTROL_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const INTERNAL_REDIRECT_ORIGIN = 'https://investatlas.invalid';

/**
 * Returns a same-origin application path suitable for Next.js navigation.
 * Untrusted schemes, protocol-relative URLs and browser-normalized backslashes
 * fall back to the supplied safe path.
 */
export function normalizeInternalRedirectPath(
  candidate: string | null | undefined,
  fallback = '/',
): string {
  if (
    !candidate
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || CONTROL_CHARACTER_PATTERN.test(candidate)
    || ENCODED_PATH_SEPARATOR_PATTERN.test(candidate)
    || ENCODED_CONTROL_PATTERN.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, INTERNAL_REDIRECT_ORIGIN);
    if (parsed.origin !== INTERNAL_REDIRECT_ORIGIN) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
