import { normalizeText } from './text.js';

export type TermMode = 'ALL' | 'ANY' | 'EXACT_PHRASE' | 'BOOLEAN';

export function matchesLooseTerm(
  normalizedText: string,
  term: string,
): boolean {
  const words = normalizeText(term).split(/\s+/u).filter(Boolean);
  return (
    words.length > 0 && words.every((word) => normalizedText.includes(word))
  );
}

export function matchesExactPhrase(
  normalizedText: string,
  phrase: string,
): boolean {
  const normalizedPhrase = normalizeText(phrase).trim();
  return (
    normalizedPhrase.length > 0 && normalizedText.includes(normalizedPhrase)
  );
}

export function matchesTerms(
  text: string,
  terms: readonly string[],
  mode: Exclude<TermMode, 'BOOLEAN'>,
): boolean {
  const normalizedText = normalizeText(text);
  const populatedTerms = terms.filter((term) => term.trim().length > 0);

  if (mode === 'ANY') {
    return populatedTerms.some((term) =>
      matchesLooseTerm(normalizedText, term),
    );
  }

  if (mode === 'EXACT_PHRASE') {
    return populatedTerms.every((term) =>
      matchesExactPhrase(normalizedText, term),
    );
  }

  return populatedTerms.every((term) => matchesLooseTerm(normalizedText, term));
}
