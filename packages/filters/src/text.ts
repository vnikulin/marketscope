export function normalizeText(text: string): string {
  return text.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase();
}
