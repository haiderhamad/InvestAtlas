import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/components/legal/legal-document-page';

const metadataTitle = 'Privacy Policy — InvestAtlas';
const metadataDescription = 'How the public InvestAtlas Demo processes and protects data.';

export const metadata: Metadata = {
  title: metadataTitle,
  description: metadataDescription,
};

export default function PrivacyPage() {
  return <LegalDocumentPage kind="privacy" />;
}
