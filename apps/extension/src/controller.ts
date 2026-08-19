import { evaluateWithRegex } from '@marketscope/filters/browser';

import { evaluateBrowserRegex } from './browser-regex.js';
import { listingLinks, parseListingLink } from './parser.js';
import { renderEvaluation, showParserWarning } from './renderer.js';
import {
  type ExtensionPreferences,
  type ExtensionWatchlist,
  toFilterDefinition,
  toMarketplaceListing,
  type WatchlistEvaluation,
} from './types.js';

const FAILURE_LIMIT = 0.4;
const DEBOUNCE_MS = 150;

export interface ControllerDependencies {
  sendListings: (listings: ReturnType<typeof toMarketplaceListing>[]) => void;
  now?: () => number;
}

export class MarketplaceController {
  readonly #document: Document;
  readonly #dependencies: ControllerDependencies;
  readonly #processedIds = new Set<string>();
  readonly #pendingLinks = new Set<HTMLAnchorElement>();
  readonly #rendered = new Map<
    string,
    { card: HTMLElement; evaluations: WatchlistEvaluation[] }
  >();
  #watchlists: ExtensionWatchlist[] = [];
  #preferences: ExtensionPreferences;
  #observer: MutationObserver | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempted = 0;
  #failed = 0;
  #stopped = false;

  public constructor(
    document: Document,
    preferences: ExtensionPreferences,
    dependencies: ControllerDependencies,
  ) {
    this.#document = document;
    this.#preferences = preferences;
    this.#dependencies = dependencies;
  }

  public setState(
    watchlists: ExtensionWatchlist[],
    preferences: ExtensionPreferences,
  ): void {
    this.#watchlists = watchlists.filter((watchlist) => watchlist.enabled);
    this.#preferences = preferences;
  }

  public updatePreferences(preferences: ExtensionPreferences): void {
    this.#preferences = preferences;
    for (const rendered of this.#rendered.values()) {
      renderEvaluation(rendered.card, rendered.evaluations, preferences);
    }
  }

  public start(): void {
    this.enqueueLinks(listingLinks(this.#document));
    this.#observer = new MutationObserver((mutations) => {
      if (this.#stopped) return;
      const links: HTMLAnchorElement[] = [];
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('a[href*="/marketplace/item/"]')) {
            links.push(node as HTMLAnchorElement);
          }
          links.push(...listingLinks(node));
        }
      }
      this.enqueueLinks(links);
    });
    this.#observer.observe(this.#document.body, {
      childList: true,
      subtree: true,
    });
  }

  public stop(): void {
    this.#stopped = true;
    this.#observer?.disconnect();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#pendingLinks.clear();
  }

  public enqueueLinks(links: readonly HTMLAnchorElement[]): void {
    if (this.#stopped) return;
    for (const link of links) this.#pendingLinks.add(link);
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  public async flush(): Promise<void> {
    this.#timer = undefined;
    if (this.#stopped) return;
    const links = Array.from(this.#pendingLinks);
    this.#pendingLinks.clear();
    const uploads: ReturnType<typeof toMarketplaceListing>[] = [];

    for (const link of links) {
      this.#attempted += 1;
      try {
        const parsed = parseListingLink(
          link,
          this.#dependencies.now?.() ?? Date.now(),
        );
        if (this.#processedIds.has(parsed.listing.sourceListingId)) continue;
        this.#processedIds.add(parsed.listing.sourceListingId);
        const listing = toMarketplaceListing(parsed.listing);
        const evaluations: WatchlistEvaluation[] = [];
        for (const watchlist of this.#watchlists) {
          evaluations.push({
            watchlistId: watchlist.id,
            watchlistName: watchlist.name,
            verdict: await evaluateWithRegex(
              listing,
              toFilterDefinition(watchlist),
              evaluateBrowserRegex,
            ),
          });
        }
        if (this.#stopped) return;
        renderEvaluation(parsed.card, evaluations, this.#preferences);
        this.#rendered.set(parsed.listing.sourceListingId, {
          card: parsed.card,
          evaluations,
        });
        uploads.push(listing);
      } catch (error) {
        this.#failed += 1;
        console.warn('MarketScope could not parse one listing card', error);
      }
    }

    if (uploads.length > 0) this.#dependencies.sendListings(uploads);
    if (this.#failed / this.#attempted > FAILURE_LIMIT) {
      this.#stopped = true;
      this.#observer?.disconnect();
      showParserWarning(this.#document);
    }
  }
}
