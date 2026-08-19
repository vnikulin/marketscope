import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { request } from '../api.js';
import { PageHeader, StatusMessage } from '../components.js';
import type {
  ListingPolicy,
  TermMode,
  UnknownPolicy,
  Watchlist,
  WatchlistInput,
} from '../types.js';
import { consumeListingWatchlistDraft } from '../watchlist-draft.js';

interface EditorState {
  name: string;
  searchUrl: string;
  termMode: TermMode;
  requiredTerms: string;
  booleanExpression: string;
  optionalTerms: string;
  excludedTerms: string;
  regexPatterns: string;
  minPrice: string;
  maxPrice: string;
  freePolicy: 'NEUTRAL' | 'INCLUDE' | 'EXCLUDE';
  priceUnknown: UnknownPolicy;
  allowedCities: string;
  blockedCities: string;
  allowedStates: string;
  blockedStates: string;
  maxDistance: string;
  locationUnknown: UnknownPolicy;
  sponsored: ListingPolicy;
  shipping: ListingPolicy;
  localPickup: ListingPolicy;
  dealer: ListingPolicy;
  sold: ListingPolicy;
  pending: ListingPolicy;
  relevanceThreshold: string;
  emailEnabled: boolean;
  enabled: boolean;
  ignoreOlderThanDays: string;
  alertOnPriceChange: 'DECREASE' | 'ANY' | 'NEVER';
}

const EMPTY: EditorState = {
  name: '',
  searchUrl: '',
  termMode: 'ANY',
  requiredTerms: '',
  booleanExpression: '',
  optionalTerms: '',
  excludedTerms: '',
  regexPatterns: '',
  minPrice: '',
  maxPrice: '',
  freePolicy: 'NEUTRAL',
  priceUnknown: 'FLAG',
  allowedCities: '',
  blockedCities: '',
  allowedStates: '',
  blockedStates: '',
  maxDistance: '',
  locationUnknown: 'FLAG',
  sponsored: 'BLOCK',
  shipping: 'BLOCK',
  localPickup: 'ALLOW',
  dealer: 'ALLOW',
  sold: 'BLOCK',
  pending: 'BLOCK',
  relevanceThreshold: '0',
  emailEnabled: true,
  enabled: true,
  ignoreOlderThanDays: '30',
  alertOnPriceChange: 'DECREASE',
};

function newEditorState(): EditorState {
  const listingDraft = consumeListingWatchlistDraft();
  const sourceUrl = new URLSearchParams(window.location.search).get(
    'sourceUrl',
  );
  if (sourceUrl === null) {
    return listingDraft === undefined ? EMPTY : { ...EMPTY, ...listingDraft };
  }
  try {
    const source = new URL(sourceUrl);
    if (
      source.protocol !== 'https:' ||
      source.hostname !== 'www.facebook.com' ||
      !source.pathname.startsWith('/marketplace/')
    ) {
      return EMPTY;
    }
    const query = source.searchParams.get('query')?.trim() ?? '';
    return {
      ...EMPTY,
      name: query || 'Facebook Marketplace search',
      searchUrl: source.toString(),
      requiredTerms: query.split(/\s+/u).filter(Boolean).join(', '),
    };
  } catch {
    return EMPTY;
  }
}

function joined(values: readonly string[] | undefined): string {
  return (values ?? []).join(', ');
}
function stateFrom(watchlist: Watchlist): EditorState {
  return {
    name: watchlist.name,
    searchUrl: watchlist.searchUrl,
    termMode: watchlist.termMode,
    requiredTerms: joined(watchlist.requiredTerms),
    booleanExpression: watchlist.booleanExpression ?? '',
    optionalTerms: watchlist.optionalTerms
      .map((term) => (typeof term === 'string' ? term : term.value))
      .join(', '),
    excludedTerms: joined(watchlist.excludedTerms),
    regexPatterns: watchlist.regexPatterns
      .map((pattern) =>
        typeof pattern === 'string' ? pattern : pattern.pattern,
      )
      .join('\n'),
    minPrice:
      watchlist.priceRules.minCents === undefined
        ? ''
        : String(watchlist.priceRules.minCents / 100),
    maxPrice:
      watchlist.priceRules.maxCents === undefined
        ? ''
        : String(watchlist.priceRules.maxCents / 100),
    freePolicy: watchlist.priceRules.includeFree
      ? 'INCLUDE'
      : watchlist.priceRules.excludeFree
        ? 'EXCLUDE'
        : 'NEUTRAL',
    priceUnknown: watchlist.priceRules.unknownPolicy ?? 'FLAG',
    allowedCities: joined(watchlist.locationRules.allowedCities),
    blockedCities: joined(watchlist.locationRules.blockedCities),
    allowedStates: joined(watchlist.locationRules.allowedStates),
    blockedStates: joined(watchlist.locationRules.blockedStates),
    maxDistance:
      watchlist.locationRules.maxDistanceMiles === undefined
        ? ''
        : String(watchlist.locationRules.maxDistanceMiles),
    locationUnknown: watchlist.locationRules.unknownPolicy ?? 'FLAG',
    sponsored: watchlist.listingTypeRules.sponsored ?? 'BLOCK',
    shipping: watchlist.listingTypeRules.shipping ?? 'BLOCK',
    localPickup: watchlist.listingTypeRules.localPickup ?? 'ALLOW',
    dealer: watchlist.listingTypeRules.dealer ?? 'ALLOW',
    sold: watchlist.listingTypeRules.sold ?? 'BLOCK',
    pending: watchlist.listingTypeRules.pending ?? 'BLOCK',
    relevanceThreshold: String(watchlist.relevanceThreshold),
    emailEnabled: watchlist.emailEnabled,
    enabled: watchlist.enabled,
    ignoreOlderThanDays:
      watchlist.ignoreOlderThanDays === undefined
        ? ''
        : String(watchlist.ignoreOlderThanDays),
    alertOnPriceChange: watchlist.alertOnPriceChange,
  };
}

function parts(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function optionalNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}
function payload(state: EditorState): WatchlistInput {
  const min = optionalNumber(state.minPrice);
  const max = optionalNumber(state.maxPrice);
  const distance = optionalNumber(state.maxDistance);
  const older = optionalNumber(state.ignoreOlderThanDays);
  return {
    name: state.name,
    searchUrl: state.searchUrl,
    termMode: state.termMode,
    requiredTerms: parts(state.requiredTerms),
    ...(state.termMode === 'BOOLEAN' &&
    state.booleanExpression.trim().length > 0
      ? { booleanExpression: state.booleanExpression }
      : {}),
    optionalTerms: parts(state.optionalTerms),
    excludedTerms: parts(state.excludedTerms),
    regexPatterns: state.regexPatterns
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    priceRules: {
      ...(min === undefined ? {} : { minCents: Math.round(min * 100) }),
      ...(max === undefined ? {} : { maxCents: Math.round(max * 100) }),
      ...(state.freePolicy === 'INCLUDE' ? { includeFree: true } : {}),
      ...(state.freePolicy === 'EXCLUDE' ? { excludeFree: true } : {}),
      unknownPolicy: state.priceUnknown,
    },
    locationRules: {
      ...(parts(state.allowedCities).length === 0
        ? {}
        : { allowedCities: parts(state.allowedCities) }),
      ...(parts(state.blockedCities).length === 0
        ? {}
        : { blockedCities: parts(state.blockedCities) }),
      ...(parts(state.allowedStates).length === 0
        ? {}
        : { allowedStates: parts(state.allowedStates) }),
      ...(parts(state.blockedStates).length === 0
        ? {}
        : { blockedStates: parts(state.blockedStates) }),
      ...(distance === undefined ? {} : { maxDistanceMiles: distance }),
      unknownPolicy: state.locationUnknown,
    },
    listingTypeRules: {
      sponsored: state.sponsored,
      shipping: state.shipping,
      localPickup: state.localPickup,
      dealer: state.dealer,
      sold: state.sold,
      pending: state.pending,
    },
    relevanceThreshold: Number(state.relevanceThreshold),
    emailEnabled: state.emailEnabled,
    enabled: state.enabled,
    ...(older === undefined ? {} : { ignoreOlderThanDays: older }),
    alertOnPriceChange: state.alertOnPriceChange,
  };
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}): ReactNode {
  const labels: Record<string, string> = {
    ALL: 'ALL, every required term',
    ANY: 'ANY, at least one required term',
    EXACT_PHRASE: 'EXACT PHRASE',
  };
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WatchlistEditor({ id }: { id?: string }): ReactNode {
  const [state, setState] = useState<EditorState>(() =>
    id === undefined ? newEditorState() : EMPTY,
  );
  const [loading, setLoading] = useState(id !== undefined);
  const [error, setError] = useState('');
  const update = <K extends keyof EditorState>(
    key: K,
    value: EditorState[K],
  ): void => setState((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (
      id !== undefined ||
      !new URLSearchParams(window.location.search).has('sourceUrl')
    ) {
      return;
    }
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('sourceUrl');
    window.history.replaceState(null, '', cleanUrl);
  }, [id]);
  useEffect(() => {
    if (id === undefined) return;
    void request<{ watchlists: Watchlist[] }>('/api/watchlists')
      .then((response) => {
        const found = response.watchlists.find(
          (watchlist) => watchlist.id === id,
        );
        if (found === undefined) throw new Error('Watchlist not found');
        setState(stateFrom(found));
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setLoading(false));
  }, [id]);
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      await request(
        id === undefined ? '/api/watchlists' : `/api/watchlists/${id}`,
        {
          method: id === undefined ? 'POST' : 'PUT',
          body: JSON.stringify(payload(state)),
        },
      );
      window.location.hash = '/watchlists';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  if (loading)
    return <div className="loading-grid" aria-label="Loading watchlist" />;
  return (
    <>
      <PageHeader
        eyebrow="Precision filters"
        title={id === undefined ? 'New watchlist' : 'Edit watchlist'}
        detail="Every rule below appears in the saved WHY result for each observed listing."
      />
      {error.length > 0 ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : null}
      <form className="editor-form" onSubmit={(event) => void save(event)}>
        <section className="form-section">
          <div>
            <p className="eyebrow">01</p>
            <h2>Source and terms</h2>
            <p>
              MarketScope stores the search URL as an opaque link. It never
              opens it automatically.
            </p>
          </div>
          <div className="form-grid">
            <label className="field-wide">
              <span>Name</span>
              <input
                required
                value={state.name}
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <label className="field-wide">
              <span>Marketplace search URL</span>
              <input
                required
                type="url"
                value={state.searchUrl}
                onChange={(event) => update('searchUrl', event.target.value)}
                placeholder="https://www.facebook.com/marketplace/search/..."
              />
            </label>
            <Choice
              label="Term mode"
              value={state.termMode}
              onChange={(value) => update('termMode', value as TermMode)}
              options={['ALL', 'ANY', 'EXACT_PHRASE', 'BOOLEAN']}
            />
            {state.termMode === 'BOOLEAN' ? (
              <label className="field-wide">
                <span>Boolean expression</span>
                <textarea
                  value={state.booleanExpression}
                  onChange={(event) =>
                    update('booleanExpression', event.target.value)
                  }
                  placeholder={
                    '("GPSMAP" OR "ECHOMAP") AND Garmin AND NOT case'
                  }
                />
              </label>
            ) : (
              <label className="field-wide">
                <span>Required terms, comma separated</span>
                <input
                  value={state.requiredTerms}
                  onChange={(event) =>
                    update('requiredTerms', event.target.value)
                  }
                />
              </label>
            )}
            <label>
              <span>Optional terms</span>
              <input
                value={state.optionalTerms}
                onChange={(event) =>
                  update('optionalTerms', event.target.value)
                }
              />
            </label>
            <label>
              <span>Excluded terms</span>
              <input
                value={state.excludedTerms}
                onChange={(event) =>
                  update('excludedTerms', event.target.value)
                }
              />
            </label>
            <label className="field-wide">
              <span>Regex patterns, one per line</span>
              <textarea
                value={state.regexPatterns}
                onChange={(event) =>
                  update('regexPatterns', event.target.value)
                }
              />
            </label>
          </div>
        </section>
        <section className="form-section">
          <div>
            <p className="eyebrow">02</p>
            <h2>Price and location</h2>
            <p>
              Prices use whole dollars here. Set the ZIP code and radius in
              Facebook before saving the search URL. MarketScope can enforce a
              maximum distance only when Facebook displays one.
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>Minimum price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={state.minPrice}
                onChange={(event) => update('minPrice', event.target.value)}
              />
            </label>
            <label>
              <span>Maximum price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={state.maxPrice}
                onChange={(event) => update('maxPrice', event.target.value)}
              />
            </label>
            <Choice
              label="Free listings"
              value={state.freePolicy}
              onChange={(value) =>
                update('freePolicy', value as EditorState['freePolicy'])
              }
              options={['NEUTRAL', 'INCLUDE', 'EXCLUDE']}
            />
            <Choice
              label="Unknown price"
              value={state.priceUnknown}
              onChange={(value) =>
                update('priceUnknown', value as UnknownPolicy)
              }
              options={['ALLOW', 'FLAG', 'BLOCK']}
            />
            <label>
              <span>Allowed cities</span>
              <input
                value={state.allowedCities}
                onChange={(event) =>
                  update('allowedCities', event.target.value)
                }
              />
            </label>
            <label>
              <span>Blocked cities</span>
              <input
                value={state.blockedCities}
                onChange={(event) =>
                  update('blockedCities', event.target.value)
                }
              />
            </label>
            <label>
              <span>Allowed states</span>
              <input
                value={state.allowedStates}
                onChange={(event) =>
                  update('allowedStates', event.target.value)
                }
              />
            </label>
            <label>
              <span>Blocked states</span>
              <input
                value={state.blockedStates}
                onChange={(event) =>
                  update('blockedStates', event.target.value)
                }
              />
            </label>
            <label>
              <span>Maximum displayed distance, miles</span>
              <input
                type="number"
                min="0"
                value={state.maxDistance}
                onChange={(event) => update('maxDistance', event.target.value)}
              />
            </label>
            <Choice
              label="Unknown location"
              value={state.locationUnknown}
              onChange={(value) =>
                update('locationUnknown', value as UnknownPolicy)
              }
              options={['ALLOW', 'FLAG', 'BLOCK']}
            />
          </div>
        </section>
        <section className="form-section">
          <div>
            <p className="eyebrow">03</p>
            <h2>Listing controls</h2>
            <p>Block unwanted listing types before relevance is considered.</p>
          </div>
          <div className="form-grid">
            {(
              [
                'sponsored',
                'shipping',
                'localPickup',
                'dealer',
                'sold',
                'pending',
              ] as const
            ).map((key) => (
              <Choice
                key={key}
                label={key.replace(/([A-Z])/g, ' $1')}
                value={state[key]}
                onChange={(value) => update(key, value as ListingPolicy)}
                options={['ALLOW', 'BLOCK']}
              />
            ))}
            <label>
              <span>Minimum relevance</span>
              <input
                type="number"
                min="0"
                max="100"
                required
                value={state.relevanceThreshold}
                onChange={(event) =>
                  update('relevanceThreshold', event.target.value)
                }
              />
            </label>
            <label>
              <span>Ignore older than days</span>
              <input
                type="number"
                min="1"
                value={state.ignoreOlderThanDays}
                onChange={(event) =>
                  update('ignoreOlderThanDays', event.target.value)
                }
              />
            </label>
            <Choice
              label="Price change alerts"
              value={state.alertOnPriceChange}
              onChange={(value) =>
                update(
                  'alertOnPriceChange',
                  value as EditorState['alertOnPriceChange'],
                )
              }
              options={['DECREASE', 'ANY', 'NEVER']}
            />
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={state.emailEnabled}
                onChange={(event) =>
                  update('emailEnabled', event.target.checked)
                }
              />
              <span>Email new matches</span>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span>Watchlist active</span>
            </label>
          </div>
        </section>
        <footer className="form-actions">
          <a className="button button-secondary" href="#/watchlists">
            Cancel
          </a>
          <button className="button button-primary" type="submit">
            Save watchlist
          </button>
        </footer>
      </form>
    </>
  );
}
