import { useState, type ReactNode } from 'react';
import type { FilterVerdict } from '@marketscope/shared-types';

import { request } from './api.js';
import { formatMoney, formatRelative } from './format.js';
import type { Listing } from './types.js';

export function StatusMessage({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }): ReactNode {
  return <div className={`status status-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }): ReactNode {
  return <section className="empty-state"><div className="empty-mark">MS</div><h2>{title}</h2><p>{detail}</p></section>;
}

export function PageHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail: string; action?: ReactNode }): ReactNode {
  return <header className="page-header"><div>{eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{detail}</p></div>{action}</header>;
}

export function VerdictPanel({ verdict }: { verdict: FilterVerdict }): ReactNode {
  return <div className="verdict-panel">
    <div className="verdict-heading"><strong>Filter breakdown</strong><span className={`pill ${verdict.passed ? 'pill-pass' : 'pill-fail'}`}>{verdict.passed ? 'PASSED' : 'BLOCKED'}</span></div>
    <div className="verdict-checks">{verdict.checks.map((check, index) => <div className="verdict-row" key={`${check.rule}-${index}`}><span className={check.passed ? 'check-pass' : 'check-fail'}>{check.passed ? 'PASS' : 'FAIL'}</span><div><strong>{check.rule}</strong>{check.detail === undefined ? null : <small>{check.detail}</small>}</div></div>)}</div>
    <div className="verdict-footer"><span>Relevance <strong>{verdict.relevance}</strong></span>{verdict.failedOn === undefined ? null : <span>Reason <strong>{verdict.failedOn}</strong></span>}</div>
  </div>;
}

export function ListingCard({ listing, onFavorite }: { listing: Listing; onFavorite: (favorite: boolean) => void }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const passed = listing.evaluations.some((evaluation) => evaluation.verdict.passed);
  async function toggleFavorite(): Promise<void> {
    setBusy(true);
    try {
      await request(`/api/listings/${listing.id}/favorite`, { method: listing.favorite ? 'DELETE' : 'PUT' });
      onFavorite(!listing.favorite);
    } finally {
      setBusy(false);
    }
  }
  return <article className="listing-card" data-listing-id={listing.id}>
    <div className="listing-image">{listing.thumbnailUrl === undefined ? <span>MS</span> : <img src={listing.thumbnailUrl} alt="" />}</div>
    <div className="listing-body">
      <div className="listing-top"><div><p className="listing-price">{formatMoney(listing.price)}</p><h2>{listing.title}</h2></div><button className={`favorite-button ${listing.favorite ? 'is-favorite' : ''}`} type="button" aria-label={listing.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void toggleFavorite()} disabled={busy}>{listing.favorite ? '★' : '☆'}</button></div>
      <p className="listing-meta">{listing.location ?? 'Location unknown'}{listing.distanceMiles === undefined ? '' : ` · ${listing.distanceMiles} mi`} · Seen {formatRelative(listing.firstSeen)}</p>
      {listing.description === undefined ? null : <p className="listing-description">{listing.description}</p>}
      <div className="listing-tags"><span className={`pill ${passed ? 'pill-pass' : 'pill-fail'}`}>{passed ? 'MATCH' : 'BLOCKED'}</span>{listing.shipping ? <span className="pill">Shipping</span> : null}{listing.sponsored ? <span className="pill">Sponsored</span> : null}{listing.evaluations.filter((evaluation) => !passed || evaluation.verdict.passed).map((evaluation) => <span className="pill" key={evaluation.watchlistId}>{evaluation.watchlistName}</span>)}</div>
      <div className="listing-actions"><a className="button button-secondary" href={listing.url} target="_blank" rel="noreferrer">Open listing</a><button className="button button-quiet" type="button" onClick={() => setExpanded(!expanded)} disabled={listing.evaluations.length === 0}>{expanded ? 'Hide WHY' : 'WHY'}</button></div>
      {expanded ? <div className="evaluation-stack">{listing.evaluations.map((evaluation) => <section key={evaluation.watchlistId}><h3>{evaluation.watchlistName}</h3><VerdictPanel verdict={evaluation.verdict} /></section>)}</div> : null}
    </div>
  </article>;
}
