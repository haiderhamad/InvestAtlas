import { translateAppText } from '@/lib/i18n/app-localization';

describe('provider and workspace localization', () => {
  const visibleV12Strings = [
    'Financial Data Providers',
    'AI Providers',
    'Illustrative Demo Data',
    'Read-only demo snapshot',
    'Start Local Workspace',
    'Market data is not connected',
    'Connect Tiingo',
    'The key is sent only to InvestAtlas over an authenticated request, encrypted server-side, and never displayed again in full.',
    'Hosted market prices are unavailable',
    'Hosted InvestAtlas currently has no connectable stock or crypto price provider. Your portfolio records remain available; market-dependent values stay unavailable rather than guessed.',
    'Review data availability',
    'Hosted connection unavailable',
    'You do not need to create or paste an API key for this hosted deployment.',
    'Financial provider status was requested too often. Wait a moment and try again.',
    'Retry provider status',
    'Sign out and explore Demo Snapshot',
    'Opening Demo Snapshot…',
    'Could not open the Demo Snapshot. Your Cloud Workspace was not changed.',
    'Local engineering only',
    'Personal AI keys are used only for the explicitly reviewed document and transaction import.',
    'Personal AI keys for document import',
    'Add personal AI key',
    'Supported services are OpenRouter, Groq, Google Gemini, and OpenAI. Custom endpoint URLs are disabled in the public demo so keys can only be sent to fixed official hosts.',
    'Supported services are OpenRouter, Groq, Google Gemini, and OpenAI. You can still enter any model ID available through your selected service; OpenRouter can provide access to models from many vendors. Custom endpoint URLs remain disabled so keys are sent only to fixed official hosts.',
    'A custom server URL or port is not accepted on hosted InvestAtlas because it could expose your key or private network. Choose a supported service and enter its model ID instead.',
    'Use your own API key for the reviewed document and transaction import. Keys are encrypted server-side. Each upload uses only the highest-priority enabled service and is never forwarded automatically to a fallback provider.',
    'Drop a broker statement, trade confirmation, or app screenshot. Only your highest-priority enabled AI provider receives this upload and extracts the trades — you review and confirm before anything is saved.',
    'Add a personal AI key only for the reviewed document and transaction import. Technical analysis remains deterministic and does not use this key.',
  ];

  it.each(visibleV12Strings)('provides a German translation for %s', (value) => {
    expect(translateAppText(value, 'de')).not.toBe(value);
  });

  it.each(visibleV12Strings)('provides an Arabic translation for %s', (value) => {
    expect(translateAppText(value, 'ar')).not.toBe(value);
  });
});
