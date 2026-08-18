import type {
  FilterCheck,
  FilterVerdict,
  MarketplaceListing,
} from '@marketscope/shared-types';

import { evaluateBooleanAst, parseBooleanExpression } from './boolean.js';
import { evaluateRegex } from './regex.js';
import { calculateRelevance, type OptionalTerm } from './relevance.js';
import {
  evaluateListingTypeRules,
  evaluateLocationRule,
  evaluatePriceRule,
  type ListingTypeRules,
  type LocationRules,
  type PriceRules,
} from './rules.js';
import {
  matchesExactPhrase,
  matchesLooseTerm,
  matchesTerms,
  type TermMode,
} from './terms.js';
import { normalizeText } from './text.js';

export interface FilterableListing extends MarketplaceListing {
  dealer?: boolean;
  sold?: boolean;
  pending?: boolean;
}

export type RegexRule =
  | string
  | {
      pattern: string;
      flags?: string;
    };

export interface FilterDefinition {
  termMode: TermMode;
  requiredTerms?: readonly string[];
  booleanExpression?: string;
  optionalTerms?: readonly OptionalTerm[];
  excludedTerms?: readonly string[];
  regexPatterns?: readonly RegexRule[];
  price?: PriceRules;
  location?: LocationRules;
  listingTypes?: ListingTypeRules;
  relevanceThreshold?: number;
}

const LISTING_TYPE_LABELS = {
  sponsored: 'Sponsored',
  shipping: 'Shipping',
  localPickup: 'Local pickup',
  dealer: 'Dealer',
  sold: 'Sold',
  pending: 'Pending',
} as const;

function requiredChecks(
  definition: FilterDefinition,
  searchText: string,
): FilterCheck[] {
  if (definition.termMode === 'BOOLEAN') {
    const parsed = parseBooleanExpression(definition.booleanExpression ?? '');
    if (!parsed.ok) {
      return [
        {
          rule: 'Required: Boolean expression',
          passed: false,
          detail: `${parsed.error.message} at offset ${parsed.error.offset}`,
        },
      ];
    }

    const passed = evaluateBooleanAst(parsed.ast, searchText);
    return [
      {
        rule: 'Required: Boolean expression',
        passed,
        detail: passed ? 'matched' : 'did not match',
      },
    ];
  }

  const terms = (definition.requiredTerms ?? []).filter(
    (term) => term.trim().length > 0,
  );
  if (terms.length === 0) {
    return [];
  }

  if (definition.termMode === 'ANY') {
    const passed = matchesTerms(searchText, terms, 'ANY');
    return [
      {
        rule: `Required: any of ${terms.join(', ')}`,
        passed,
        detail: passed ? 'matched' : 'no required term matched',
      },
    ];
  }

  const normalizedSearchText = normalizeText(searchText);
  return terms.map((term) => {
    const passed =
      definition.termMode === 'EXACT_PHRASE'
        ? matchesExactPhrase(normalizedSearchText, term)
        : matchesLooseTerm(normalizedSearchText, term);
    return {
      rule: `Required: ${term}`,
      passed,
      detail: passed ? 'matched' : 'did not match',
    };
  });
}

function excludedChecks(
  excludedTerms: readonly string[],
  normalizedSearchText: string,
): FilterCheck[] {
  return excludedTerms
    .filter((term) => term.trim().length > 0)
    .map((term) => {
      const matched = matchesLooseTerm(normalizedSearchText, term);
      return {
        rule: `Excluded: ${term}`,
        passed: !matched,
        detail: matched ? 'matched excluded term' : 'not present',
      };
    });
}

function resolveRegexRule(rule: RegexRule): { pattern: string; flags: string } {
  return typeof rule === 'string'
    ? { pattern: rule, flags: 'iu' }
    : { pattern: rule.pattern, flags: rule.flags ?? 'iu' };
}

export async function evaluate(
  listing: FilterableListing,
  definition: FilterDefinition,
): Promise<FilterVerdict> {
  const searchText = `${listing.title} ${listing.description ?? ''} ${listing.rawText}`;
  const normalizedSearchText = normalizeText(searchText);
  const checks: FilterCheck[] = [
    ...requiredChecks(definition, searchText),
    ...excludedChecks(definition.excludedTerms ?? [], normalizedSearchText),
  ];

  for (const configuredRegex of definition.regexPatterns ?? []) {
    const regex = resolveRegexRule(configuredRegex);
    const result = await evaluateRegex(regex.pattern, searchText, regex.flags);
    checks.push({
      rule: `Regex: ${regex.pattern}`,
      passed: result.matched && result.error === undefined,
      detail:
        result.error ??
        `${result.matched ? 'matched' : 'did not match'}${
          result.inputTruncated ? '; input capped at 4KB' : ''
        }`,
    });
  }

  const price = evaluatePriceRule(listing.price, definition.price);
  checks.push({ rule: 'Price', passed: price.passed, detail: price.detail });

  const location = evaluateLocationRule(
    listing.location,
    listing.distanceMiles,
    definition.location,
  );
  checks.push({
    rule: 'Location',
    passed: location.passed,
    detail: location.detail,
  });

  for (const result of evaluateListingTypeRules(
    listing,
    definition.listingTypes,
  )) {
    checks.push({
      rule: LISTING_TYPE_LABELS[result.type],
      passed: result.passed,
      detail: result.detail,
    });
  }

  const relevance = calculateRelevance(listing, definition.optionalTerms ?? []);
  const relevanceThreshold = definition.relevanceThreshold ?? 0;
  checks.push({
    rule: `Relevance >= ${relevanceThreshold}`,
    passed: relevance >= relevanceThreshold,
    detail: `${relevance}`,
  });

  const firstFailure = checks.find((check) => !check.passed);
  return {
    passed: firstFailure === undefined,
    checks,
    relevance,
    ...(firstFailure === undefined ? {} : { failedOn: firstFailure.rule }),
  };
}
