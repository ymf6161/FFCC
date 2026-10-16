/**
 * The one rounding helper for percentages (BUILD_PLAN rule 1).
 * Applied per posting, rounded half away from zero to whole pence.
 * Integer maths only: `basisPoints` is the rate in hundredths of a percent
 * (1000 = 10%).
 */
export function applyRate(pence: number, basisPoints: number): number {
  assertInteger(pence, "pence");
  assertInteger(basisPoints, "basisPoints");
  const product = BigInt(pence) * BigInt(basisPoints);
  const divisor = 10000n;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  let quotient = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) quotient += 1n;
  const result = Number(negative ? -quotient : quotient);
  return result === 0 ? 0 : result; // never -0
}

export function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a whole number of pence, got ${value}`);
}
