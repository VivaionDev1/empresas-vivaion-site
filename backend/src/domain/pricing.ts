export type PriceInput = { productId: string; quantity: number; unitPriceCents: number };
export type Tier = { minimumSeats: number; discountBps: number };
export type PriceLine = PriceInput & { discountBps: number; discountedUnitCents: number; lineTotalCents: number };
export type PriceQuote = { quantity: number; discountBps: number; totalCents: number; currency: "BRL"; lines: PriceLine[] };

/** Non-stackable discounts: best applicable percentage, applied per seat. */
export function calculateQuote(lines: PriceInput[], baseDiscountBps: number, tiers: Tier[]): PriceQuote {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 30) throw new Error("Invalid cart");
  if (![baseDiscountBps, ...tiers.map((tier) => tier.discountBps)].every((n) => Number.isInteger(n) && n >= 0 && n <= 10000)) throw new Error("Invalid discounts");
  if (tiers.some((tier) => !Number.isSafeInteger(tier.minimumSeats) || tier.minimumSeats < 1)) throw new Error("Invalid tier minimum");
  for (const item of lines) {
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 ||
        !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents <= 0 || item.unitPriceCents > 1e9) throw new Error("Invalid cart item");
  }
  const quantity = lines.reduce((sum, item) => sum + item.quantity, 0);
  const volume = Math.max(0, ...tiers.filter((tier) => quantity >= tier.minimumSeats).map((tier) => tier.discountBps));
  const discountBps = Math.max(baseDiscountBps, volume);
  const resultLines: PriceLine[] = lines.map((item) => {
    const discountedUnitCents = Math.round(item.unitPriceCents * (10000 - discountBps) / 10000);
    return { ...item, discountBps, discountedUnitCents, lineTotalCents: discountedUnitCents * item.quantity };
  });
  const totalCents = resultLines.reduce((sum, item) => sum + item.lineTotalCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error("Cart total overflow");
  return { quantity, discountBps, totalCents, currency: "BRL", lines: resultLines };
}
