import { normalizePrice } from '@marketscope/filters/browser';

import type { ParsedMarketplaceListing } from './types.js';

const ITEM_LINK_SELECTOR = 'a[href*="/marketplace/item/"]';
const ITEM_ID_PATTERN = /\/marketplace\/item\/([^/?#]+)/i;
const PRICE_TEXT_PATTERN = /^(?:free|\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*k?)$/i;
const LOCATION_PATTERN = /\b[^,\n]{2,80},\s*[A-Z]{2}\b/;
const DISTANCE_PATTERN = /\b(\d+(?:\.\d+)?)\s+miles?\s+away\b/i;
const POSTED_PATTERN = /\b(?:listed|posted)\s+[^\n,]{1,40}\b/i;
const NON_TITLE_PATTERN = /^(?:free|sponsored|ships to you|shipping available|local pickup|just listed|newly listed|pending|sold)$/i;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function canonicalListingUrl(link: HTMLAnchorElement): URL {
  const url = new URL(link.href, 'https://www.facebook.com');
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'facebook.com' &&
      !url.hostname.endsWith('.facebook.com')) ||
    !url.pathname.includes('/marketplace/item/')
  ) {
    throw new Error('Listing link is not an HTTPS facebook.com item URL');
  }
  url.search = '';
  url.hash = '';
  return url;
}

export function findCardContainer(link: HTMLAnchorElement): HTMLElement {
  let card: HTMLElement = link;
  let parent = link.parentElement;
  let depth = 0;
  while (parent !== null && parent.tagName !== 'BODY' && depth < 12) {
    if (parent.querySelectorAll(ITEM_LINK_SELECTOR).length !== 1) {
      break;
    }
    card = parent;
    parent = parent.parentElement;
    depth += 1;
  }
  return card;
}

function visibleStructuralText(card: HTMLElement): string[] {
  const values = Array.from(card.querySelectorAll('[aria-hidden="true"]'))
    .map((element) => cleanText(element.textContent))
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  return values;
}

function priceText(card: HTMLElement): string | undefined {
  const candidates = Array.from(card.querySelectorAll('span'))
    .filter((element) => element.children.length === 0)
    .map((element) => cleanText(element.textContent));
  return candidates.find((value) => PRICE_TEXT_PATTERN.test(value));
}

function locationText(card: HTMLElement, ariaLabel: string): string | undefined {
  const structural = visibleStructuralText(card).find((value) =>
    LOCATION_PATTERN.test(value),
  );
  return structural ?? LOCATION_PATTERN.exec(ariaLabel)?.[0];
}

function titleText(
  card: HTMLElement,
  ariaLabel: string,
  price: string | undefined,
  location: string | undefined,
): string {
  const structural = visibleStructuralText(card).find(
    (value) =>
      value !== price &&
      value !== location &&
      !PRICE_TEXT_PATTERN.test(value) &&
      !LOCATION_PATTERN.test(value) &&
      !NON_TITLE_PATTERN.test(value),
  );
  if (structural !== undefined) {
    return structural;
  }

  const beforePrice = ariaLabel.split(/,\s*(?:free|\$\s*\d)/i, 1)[0];
  const beforeLocation = (beforePrice ?? ariaLabel).split(/,\s{2,}/, 1)[0];
  const title = cleanText(beforeLocation);
  if (title.length === 0) {
    throw new Error('Listing title is missing');
  }
  return title;
}

function allowedImageUrl(card: HTMLElement): string | undefined {
  const source = card.querySelector('img[src]')?.getAttribute('src');
  if (source === null || source === undefined) {
    return undefined;
  }
  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      (hostname === 'fbcdn.net' || hostname.endsWith('.fbcdn.net'))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseListingLink(
  link: HTMLAnchorElement,
  observedAt = Date.now(),
): { card: HTMLElement; listing: ParsedMarketplaceListing } {
  const url = canonicalListingUrl(link);
  const id = ITEM_ID_PATTERN.exec(url.pathname)?.[1];
  if (id === undefined || id.length === 0) {
    throw new Error('Listing ID is missing');
  }
  const card = findCardContainer(link);
  const rawText = cleanText(card.textContent);
  const ariaLabel = cleanText(link.getAttribute('aria-label'));
  const rawPriceText = priceText(card);
  const location = locationText(card, ariaLabel);
  const title = titleText(card, ariaLabel, rawPriceText, location);
  const distanceMatch = DISTANCE_PATTERN.exec(rawText);
  const postedAtText = POSTED_PATTERN.exec(rawText)?.[0];
  const imageUrl = allowedImageUrl(card);

  return {
    card,
    listing: {
      source: 'facebook',
      sourceListingId: decodeURIComponent(id),
      url: url.toString(),
      title,
      price: normalizePrice(rawPriceText),
      ...(rawPriceText === undefined ? {} : { priceText: rawPriceText }),
      ...(location === undefined ? {} : { location }),
      ...(distanceMatch?.[1] === undefined
        ? {}
        : { distanceMiles: Number(distanceMatch[1]) }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
      sponsored: /\bsponsored\b/i.test(rawText),
      shipping: /\b(?:ships to you|shipping available)\b/i.test(rawText),
      ...(/\blocal pickup\b/i.test(rawText) ? { localPickup: true } : {}),
      ...(postedAtText === undefined ? {} : { postedAtText }),
      rawText,
      firstSeen: observedAt,
      lastSeen: observedAt,
    },
  };
}

export function listingLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(ITEM_LINK_SELECTOR));
}
