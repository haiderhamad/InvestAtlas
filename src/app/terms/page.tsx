import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/components/legal/legal-document-page';

const metadataTitle = 'Terms of Service — InvestAtlas';
const metadataDescription = 'Terms governing use of the public InvestAtlas Demo.';

export const metadata: Metadata = {
  title: metadataTitle,
  description: metadataDescription,
};

export default function TermsPage() {
  return <LegalDocumentPage kind="terms" />;
}
