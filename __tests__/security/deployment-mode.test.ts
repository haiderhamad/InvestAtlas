import {
  resolveInvestAtlasDeploymentMode, modeAllowsFirebase,
  isValidPrivateOwnerUid, privateCloudAllowsUid,
} from '@/lib/runtime/deployment-mode';

describe('Self-Hosted-First deployment mode', () => {
  it('preserves legacy runtime without explicit opt-in', () => {
    expect(resolveInvestAtlasDeploymentMode(undefined)).toBe('legacy');
    expect(resolveInvestAtlasDeploymentMode('')).toBe('legacy');
  });
  it.each(['local_personal','private_cloud','public_demo'])('accepts %s', mode => {
    expect(resolveInvestAtlasDeploymentMode(mode)).toBe(mode);
  });
  it.each(['local', 'PRIVATE_CLOUD', 'unknown'])('rejects unknown mode %s', mode => {
    expect(() => resolveInvestAtlasDeploymentMode(mode)).toThrow();
  });
  it('does not enable Firebase in local mode', () => {
    expect(modeAllowsFirebase('local_personal')).toBe(false);
    expect(modeAllowsFirebase('public_demo')).toBe(false);
    expect(modeAllowsFirebase('private_cloud')).toBe(true);
    expect(modeAllowsFirebase('legacy')).toBe(true);
  });
  it('denies all users when private UID is absent or invalid', () => {
    expect(isValidPrivateOwnerUid(undefined)).toBe(false);
    expect(privateCloudAllowsUid('private_cloud', undefined, 'owner')).toBe(false);
    expect(privateCloudAllowsUid('private_cloud', 'owner-a', 'owner-b')).toBe(false);
    expect(privateCloudAllowsUid('private_cloud', 'owner-a', 'owner-a')).toBe(true);
    expect(privateCloudAllowsUid('public_demo', undefined, 'owner-b')).toBe(true);
  });
});
