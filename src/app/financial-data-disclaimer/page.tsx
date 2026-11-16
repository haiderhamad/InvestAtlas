import type { Metadata } from 'next';
import { LegalDocumentPage } from '@/components/legal/legal-document-page';

const metadataTitle = 'Financial Data Disclaimer — InvestAtlas';
const metadataDescription = 'Source, calculation, freshness, AI, and availability boundaries for InvestAtlas financial data.';

export const metadata: Metadata = {
  title: metadataTitle,
  description: metadataDescription,
};

export default function FinancialDataDisclaimerPage() {
  return <LegalDocumentPage kind="financial-data" />;
}
