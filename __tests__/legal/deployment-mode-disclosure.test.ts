import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Deployment-mode UX disclosures', () => {
  it('explains a local workspace instead of offering an unavailable Firebase login', () => {
    const login = read('src/app/login/page.tsx');
    expect(login).toContain("INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'");
    expect(login).toContain("'Data stays in this browser'");
    expect(login).toContain("INVESTATLAS_DEPLOYMENT_MODE === 'public_demo'");
    expect(login).toContain("t('Back to Dashboard')");
  });
  it('does not describe private cloud and localhost as the operator public Demo', () => {
    const gate = read('src/components/legal/legal-acceptance-gate.tsx');
    expect(gate).toContain("INVESTATLAS_DEPLOYMENT_MODE === 'local_personal'");
    expect(gate).toContain("INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud'");
    expect(gate).toContain('This is a private installation.');
    expect(gate).toContain('Portfolio entries stay in this browser');
    expect(gate).toContain('InvestAtlas is a public Demo.');
  });
  it('includes German and Arabic private-hosted notice', () => {
    const i18n = read('src/lib/i18n/app-localization.ts');
    expect(i18n).toContain('Dies ist eine private Installation.');
    expect(i18n).toContain('هذا تثبيت خاص.');
  });
});
