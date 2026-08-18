const PRICE_PATTERN =
  /^\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([kK])?$/;

export function normalizePrice(
  priceText: string | null | undefined,
): number | null {
  const trimmed = priceText?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }

  if (trimmed.toLowerCase() === 'free') {
    return 0;
  }

  const match = PRICE_PATTERN.exec(trimmed);
  if (match === null) {
    return null;
  }

  const numericText = match[1];
  if (numericText === undefined) {
    return null;
  }

  const amount = Number(numericText.replaceAll(',', ''));
  const multiplier = match[2] === undefined ? 1 : 1_000;
  const cents = Math.round(amount * multiplier * 100);

  return Number.isSafeInteger(cents) ? cents : null;
}
