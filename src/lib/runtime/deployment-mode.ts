export type InvestAtlasDeploymentMode = 'legacy' | 'local_personal' | 'private_cloud' | 'public_demo';

export function resolveInvestAtlasDeploymentMode(raw: string | undefined): InvestAtlasDeploymentMode {
  if (raw === undefined || raw === '') return 'legacy';
  if (raw === 'local_personal' || raw === 'private_cloud' || raw === 'public_demo') return raw;
  throw new Error('Invalid InvestAtlas deployment mode');
}

export const INVESTATLAS_DEPLOYMENT_MODE = resolveInvestAtlasDeploymentMode(
  process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE,
);

export function modeAllowsFirebase(mode: InvestAtlasDeploymentMode): boolean {
  return mode === 'legacy' || mode === 'private_cloud';
}

export function isValidPrivateOwnerUid(value: string | undefined): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    && !value.toLowerCase().includes('placeholder')
    && !value.toLowerCase().includes('replace');
}

export function privateCloudAllowsUid(
  mode: InvestAtlasDeploymentMode,
  configuredUid: string | undefined,
  actualUid: string,
): boolean {
  return mode !== 'private_cloud'
    || (isValidPrivateOwnerUid(configuredUid) && configuredUid === actualUid);
}
