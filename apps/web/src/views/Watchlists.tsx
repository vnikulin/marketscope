import { useEffect, useState, type ReactNode } from 'react';

import { request } from '../api.js';
import { EmptyState, PageHeader, StatusMessage } from '../components.js';
import { formatDate } from '../format.js';
import type { Watchlist } from '../types.js';

export function Watchlists(): ReactNode {
  const [watchlists, setWatchlists] = useState<Watchlist[]>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load(): Promise<void> {
    const response = await request<{ watchlists: Watchlist[] }>('/api/watchlists');
    setWatchlists(response.watchlists);
  }
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  async function action(path: string, success: string, method = 'POST'): Promise<void> {
    setError('');
    await request(path, { method });
    setMessage(success);
    await load();
  }
  async function remove(watchlist: Watchlist): Promise<void> {
    if (!window.confirm(`Delete ${watchlist.name}?`)) return;
    await action(`/api/watchlists/${watchlist.id}`, 'Watchlist deleted.', 'DELETE');
  }
  return <>
    <PageHeader title="Watchlists" detail="Precise rules applied in the browser and on the server." action={<a className="button button-primary" href="#/watchlists/new">New watchlist</a>} />
    {error.length > 0 ? <StatusMessage tone="error">{error}</StatusMessage> : null}{message.length > 0 ? <StatusMessage tone="success">{message}</StatusMessage> : null}
    {watchlists === undefined ? <div className="loading-grid" aria-label="Loading watchlists" /> : watchlists.length === 0 ? <EmptyState title="Create your first watchlist" detail="Add required terms, exclusions, price, and location rules." /> : <div className="watchlist-grid">{watchlists.map((watchlist) => <article className="watchlist-card" key={watchlist.id}>
      <div className="watchlist-heading"><div><span className={`status-dot ${watchlist.enabled ? 'is-on' : ''}`} />{watchlist.enabled ? 'Active' : 'Paused'}</div><span className={`pill ${watchlist.seeded ? 'pill-pass' : ''}`}>{watchlist.seeded ? 'Seeded' : 'Awaiting first browse'}</span></div>
      <h2>{watchlist.name}</h2><p>{watchlist.termMode === 'BOOLEAN' ? watchlist.booleanExpression : watchlist.requiredTerms.join(` ${watchlist.termMode} `) || 'No required terms'}</p>
      <dl><div><dt>Relevance</dt><dd>{watchlist.relevanceThreshold}+</dd></div><div><dt>Email</dt><dd>{watchlist.emailEnabled ? 'On' : 'Off'}</dd></div><div><dt>Updated</dt><dd>{formatDate(watchlist.updatedAt)}</dd></div></dl>
      <div className="card-actions"><a className="button button-secondary" href={`#/watchlists/${watchlist.id}`}>Edit</a><button className="button button-quiet" type="button" onClick={() => void action(`/api/watchlists/${watchlist.id}/duplicate`, 'Watchlist duplicated.')}>Duplicate</button><button className="button button-quiet" type="button" onClick={() => void action(`/api/watchlists/${watchlist.id}/${watchlist.enabled ? 'pause' : 'resume'}`, watchlist.enabled ? 'Watchlist paused.' : 'Watchlist resumed.')}>{watchlist.enabled ? 'Pause' : 'Resume'}</button><button className="button button-danger" type="button" onClick={() => void remove(watchlist)}>Delete</button></div>
    </article>)}</div>}
  </>;
}
