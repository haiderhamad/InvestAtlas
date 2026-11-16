import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('transaction spot-price autofill trust boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/layout/global-add-modal.tsx'),
    'utf8',
  );

  it('cancels superseded requests and ignores late responses', () => {
    expect(source).toContain('const spotRequestIdRef = useRef(0)');
    expect(source).toContain('const controller = new AbortController()');
    expect(source).toContain('spotRequestIdRef.current !== requestId');
    expect(source).toContain('controller.abort()');
  });

  it('invalidates a previous automatic value without deleting a custom value', () => {
    expect(source).toContain("priceSourceRef.current === 'spot'");
    expect(source).toContain('invalidateAutoSpotPrice()');
    expect(source).toContain('useState(editTransaction?.price ?? 0)');
  });

  it('preserves an existing transaction price until its pricing context changes', () => {
    expect(source).toContain(
      'const spotContextDirtyRef = useRef(!editTransaction)',
    );
    expect(source).toContain('if (!spotContextDirtyRef.current) return;');
    expect(source).toContain('markSpotContextDirty()');
  });
});
