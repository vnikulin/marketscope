import type { MarketplaceListing } from '@marketscope/shared-types';

import { matchesExactPhrase, matchesLooseTerm } from './terms.js';
import { normalizeText } from './text.js';

export type OptionalTerm =
  | string
  | {
      value: string;
      weight?: number;
      match?: 'LOOSE' | 'EXACT_PHRASE';
    };

interface ResolvedOptionalTerm {
  value: string;
  weight: number;
  match: 'LOOSE' | 'EXACT_PHRASE';
}

function resolveTerm(term: OptionalTerm): ResolvedOptionalTerm | undefined {
  const resolved: ResolvedOptionalTerm =
    typeof term === 'string'
      ? { value: term, weight: 1, match: 'LOOSE' }
      : {
          value: term.value,
          weight: term.weight ?? 1,
          match: term.match ?? 'LOOSE',
        };

  if (
    resolved.value.trim().length === 0 ||
    !Number.isFinite(resolved.weight) ||
    resolved.weight <= 0
  ) {
    return undefined;
  }
  return resolved;
}

function termMatches(text: string, term: ResolvedOptionalTerm): boolean {
  return term.match === 'EXACT_PHRASE'
    ? matchesExactPhrase(text, term.value)
    : matchesLooseTerm(text, term.value);
}

export function calculateRelevance(
  listing: MarketplaceListing,
  optionalTerms: readonly OptionalTerm[],
): number {
  const terms = optionalTerms
    .map(resolveTerm)
    .filter((term): term is ResolvedOptionalTerm => term !== undefined);
  if (terms.length === 0) {
    return 0;
  }

  const title = normalizeText(listing.title);
  const body = normalizeText(
    `${listing.description ?? ''} ${listing.rawText}`.trim(),
  );
  let earnedWeight = 0;
  let availableWeight = 0;

  for (const term of terms) {
    const phraseMultiplier = term.match === 'EXACT_PHRASE' ? 2 : 1;
    availableWeight += term.weight * 3 * phraseMultiplier;

    if (termMatches(title, term)) {
      earnedWeight += term.weight * 3 * phraseMultiplier;
    } else if (termMatches(body, term)) {
      earnedWeight += term.weight * phraseMultiplier;
    }
  }

  return Math.round((earnedWeight / availableWeight) * 100);
}
