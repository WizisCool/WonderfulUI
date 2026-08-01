export function releaseTagMismatch(
  version: string,
  refType: string | undefined,
  refName: string | undefined,
): string | undefined {
  if (refType !== 'tag') return undefined;

  const expectedTag = `v${version}`;
  if (refName === expectedTag) return undefined;
  return `release tag must be ${expectedTag}, got ${refName || '(empty)'}`;
}
