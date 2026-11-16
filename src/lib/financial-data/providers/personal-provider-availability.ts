export type ProviderActivationSummary = {
  id?: unknown;
  isActive?: unknown;
};

export type PersonalProviderHintMode =
  | 'connect'
  | 'hosted_unavailable'
  | null;

export function resolvePersonalFinancialProviderAvailability(
  providers: readonly ProviderActivationSummary[],
): boolean | null {
  const provider = providers.find((candidate) => candidate.id === 'tiingo_browser_byok');
  if (!provider || typeof provider.isActive !== 'boolean') return null;
  return provider.isActive;
}

export function resolvePersonalProviderHintMode(input: {
  isSignedIn: boolean;
  pathname: string;
  providerAvailability: boolean | null;
  hasConnection: boolean | null;
  dismissed: boolean | null;
}): PersonalProviderHintMode {
  if (
    !input.isSignedIn
    || input.pathname !== '/'
    || input.dismissed === null
    || input.dismissed
    || input.providerAvailability === null
  ) {
    return null;
  }

  if (!input.providerAvailability) return 'hosted_unavailable';
  return input.hasConnection === false ? 'connect' : null;
}
