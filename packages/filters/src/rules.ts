import { normalizeText } from './text.js';

export type UnknownPolicy = 'ALLOW' | 'BLOCK' | 'FLAG';
export type ListingTypePolicy = 'ALLOW' | 'BLOCK';
export type ListingType =
  'sponsored' | 'shipping' | 'localPickup' | 'dealer' | 'sold' | 'pending';

export interface RuleEvaluation {
  passed: boolean;
  flagged: boolean;
  detail: string;
}

export interface PriceRules {
  minCents?: number;
  maxCents?: number;
  includeFree?: boolean;
  excludeFree?: boolean;
  unknownPolicy?: UnknownPolicy;
}

export interface LocationRules {
  allowedCities?: readonly string[];
  blockedCities?: readonly string[];
  allowedStates?: readonly string[];
  blockedStates?: readonly string[];
  maxDistanceMiles?: number;
  unknownPolicy?: UnknownPolicy;
}

export interface ListingTypeRules {
  sponsored?: ListingTypePolicy;
  shipping?: ListingTypePolicy;
  localPickup?: ListingTypePolicy;
  dealer?: ListingTypePolicy;
  sold?: ListingTypePolicy;
  pending?: ListingTypePolicy;
}

export interface ListingTypeFacts {
  sponsored: boolean;
  shipping: boolean;
  localPickup?: boolean;
  dealer?: boolean;
  sold?: boolean;
  pending?: boolean;
}

export interface ListingTypeEvaluation extends RuleEvaluation {
  type: ListingType;
}

const DEFAULT_LISTING_TYPE_RULES: Required<ListingTypeRules> = {
  sponsored: 'BLOCK',
  shipping: 'BLOCK',
  localPickup: 'ALLOW',
  dealer: 'ALLOW',
  sold: 'ALLOW',
  pending: 'ALLOW',
};

function evaluateUnknown(
  policy: UnknownPolicy,
  subject: string,
): RuleEvaluation {
  switch (policy) {
    case 'ALLOW':
      return {
        passed: true,
        flagged: false,
        detail: `${subject} unknown; allowed`,
      };
    case 'BLOCK':
      return {
        passed: false,
        flagged: false,
        detail: `${subject} unknown; blocked`,
      };
    case 'FLAG':
      return {
        passed: true,
        flagged: true,
        detail: `${subject} unknown; flagged`,
      };
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function evaluatePriceRule(
  priceCents: number | undefined,
  rules: PriceRules = {},
): RuleEvaluation {
  if (priceCents === undefined) {
    return evaluateUnknown(rules.unknownPolicy ?? 'ALLOW', 'price');
  }

  if (priceCents === 0) {
    if (rules.excludeFree === true) {
      return {
        passed: false,
        flagged: false,
        detail: 'free listings excluded',
      };
    }
    if (rules.includeFree === true) {
      return { passed: true, flagged: false, detail: 'free listing included' };
    }
  }

  if (rules.minCents !== undefined && priceCents < rules.minCents) {
    return {
      passed: false,
      flagged: false,
      detail: `${formatCents(priceCents)} is below ${formatCents(rules.minCents)}`,
    };
  }

  if (rules.maxCents !== undefined && priceCents > rules.maxCents) {
    return {
      passed: false,
      flagged: false,
      detail: `${formatCents(priceCents)} is above ${formatCents(rules.maxCents)}`,
    };
  }

  return {
    passed: true,
    flagged: false,
    detail: `${formatCents(priceCents)} allowed`,
  };
}

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => normalizeText(value).trim()));
}

export function evaluateLocationRule(
  location: string | undefined,
  distanceMiles: number | undefined,
  rules: LocationRules = {},
): RuleEvaluation {
  const unknownPolicy = rules.unknownPolicy ?? 'ALLOW';
  const hasNamedRules =
    (rules.allowedCities?.length ?? 0) > 0 ||
    (rules.blockedCities?.length ?? 0) > 0 ||
    (rules.allowedStates?.length ?? 0) > 0 ||
    (rules.blockedStates?.length ?? 0) > 0;

  if (
    (location === undefined || location.trim().length === 0) &&
    hasNamedRules
  ) {
    return evaluateUnknown(unknownPolicy, 'location');
  }

  if (location !== undefined && location.trim().length > 0) {
    const parts = location.split(',').map((part) => normalizeText(part).trim());
    const city = parts[0] ?? '';
    const state = parts.at(-1) ?? '';
    const blockedCities = normalizedSet(rules.blockedCities);
    const blockedStates = normalizedSet(rules.blockedStates);
    const allowedCities = normalizedSet(rules.allowedCities);
    const allowedStates = normalizedSet(rules.allowedStates);

    if (blockedCities.has(city)) {
      return {
        passed: false,
        flagged: false,
        detail: `${location} city blocked`,
      };
    }
    if (blockedStates.has(state)) {
      return {
        passed: false,
        flagged: false,
        detail: `${location} state blocked`,
      };
    }
    if (allowedCities.size > 0 && !allowedCities.has(city)) {
      return {
        passed: false,
        flagged: false,
        detail: `${location} city not allowed`,
      };
    }
    if (allowedStates.size > 0 && !allowedStates.has(state)) {
      return {
        passed: false,
        flagged: false,
        detail: `${location} state not allowed`,
      };
    }
  }

  if (rules.maxDistanceMiles !== undefined) {
    if (distanceMiles === undefined) {
      return evaluateUnknown(unknownPolicy, 'distance');
    }
    if (distanceMiles > rules.maxDistanceMiles) {
      return {
        passed: false,
        flagged: false,
        detail: `${distanceMiles} miles exceeds ${rules.maxDistanceMiles} miles`,
      };
    }
  }

  return {
    passed: true,
    flagged: false,
    detail:
      distanceMiles === undefined
        ? (location ?? 'location not restricted')
        : `${distanceMiles} miles allowed`,
  };
}

export function evaluateListingTypeRules(
  facts: ListingTypeFacts,
  rules: ListingTypeRules = {},
): ListingTypeEvaluation[] {
  const configured = { ...DEFAULT_LISTING_TYPE_RULES, ...rules };
  const types: readonly ListingType[] = [
    'sponsored',
    'shipping',
    'localPickup',
    'dealer',
    'sold',
    'pending',
  ];

  return types.map((type) => {
    const present = facts[type] === true;
    const policy = configured[type];
    const passed = policy === 'ALLOW' || !present;
    return {
      type,
      passed,
      flagged: false,
      detail: present ? `${type} ${policy.toLowerCase()}` : `not ${type}`,
    };
  });
}
