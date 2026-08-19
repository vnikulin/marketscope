import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, establishSessionCsrf, login, logout, request, setup } from './api.js';
import { StatusMessage } from './components.js';
import { Dashboard } from './views/Dashboard.js';
import { Diagnostics } from './views/Diagnostics.js';
import { ListingsView } from './views/Listings.js';
import { Settings } from './views/Settings.js';
import { WatchlistEditor } from './views/WatchlistEditor.js';
import { Watchlists } from './views/Watchlists.js';

type AuthState = 'loading' | 'setup' | 'login' | 'ready';

const NAV = [
  ['/', 'Dashboard', '◫'], ['/matches', 'Matches', '◎'], ['/favorites', 'Favorites', '★'], ['/history', 'History', '◷'], ['/blocked', 'Blocked', '⊘'], ['/watchlists', 'Watchlists', '≡'], ['/settings', 'Settings', '⚙'], ['/diagnostics', 'Diagnostics', '◇'],
] as const;

function currentPath(): string { return window.location.hash.replace(/^#/, '') || '/'; }

export function App(): ReactNode {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [path, setPath] = useState(currentPath());
  const [error, setError] = useState('');
  useEffect(() => {
    const onHash = (): void => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    void request<{ required: boolean }>('/api/setup/status').then(async (status) => {
      if (status.required) setAuth('setup');
      else setAuth(await establishSessionCsrf() ? 'ready' : 'login');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  async function signOut(): Promise<void> {
    try { await logout(); } finally { setAuth('login'); }
  }
  if (auth === 'loading') return <div className="splash"><Brand /><p>{error.length > 0 ? error : 'Connecting to your local server…'}</p></div>;
  if (auth === 'setup' || auth === 'login') return <AuthScreen mode={auth} onReady={() => setAuth('ready')} />;
  return <div className="app-shell">
    <aside className="sidebar"><Brand /><nav aria-label="Primary">{NAV.map(([href, label, icon]) => <a className={path === href || (href === '/watchlists' && path.startsWith('/watchlists/')) ? 'active' : ''} href={`#${href}`} key={href}><span>{icon}</span>{label}</a>)}</nav><div className="sidebar-foot"><p><span className="status-dot is-on" />Local server connected</p><button type="button" onClick={() => void signOut()}>Sign out</button></div></aside>
    <main className="main-content">{route(path)}</main>
    <nav className="mobile-nav" aria-label="Mobile primary">{NAV.slice(0, 5).map(([href, label, icon]) => <a className={path === href ? 'active' : ''} href={`#${href}`} key={href}><span>{icon}</span><small>{label}</small></a>)}<a className={['/watchlists', '/settings', '/diagnostics'].some((prefix) => path.startsWith(prefix)) ? 'active' : ''} href="#/watchlists"><span>≡</span><small>More</small></a></nav>
  </div>;
}

function route(path: string): ReactNode {
  if (path === '/') return <Dashboard />;
  if (path === '/matches' || path === '/favorites' || path === '/history' || path === '/blocked') return <ListingsView view={path.slice(1) as 'matches' | 'favorites' | 'history' | 'blocked'} />;
  if (path === '/watchlists') return <Watchlists />;
  if (path === '/watchlists/new') return <WatchlistEditor />;
  if (path.startsWith('/watchlists/')) return <WatchlistEditor id={path.slice('/watchlists/'.length)} />;
  if (path === '/settings') return <Settings />;
  if (path === '/diagnostics') return <Diagnostics />;
  return <section className="empty-state"><h1>Page not found</h1><a href="#/">Return to dashboard</a></section>;
}

function Brand(): ReactNode { return <a className="brand" href="#/"><span className="brand-mark">M</span><span><strong>MarketScope</strong><small>Local Marketplace signal</small></span></a>; }

function AuthScreen({ mode, onReady }: { mode: 'setup' | 'login'; onReady: () => void }): ReactNode {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setError('');
    try { if (mode === 'setup') await setup(username, password); else await login(username, password); onReady(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-copy"><Brand /><div><p className="eyebrow">Zero automated Facebook requests</p><h1>Your Marketplace feed, with a better filter.</h1><p>MarketScope only processes listings your browser already loaded. Your data stays on your server.</p></div><footer>Local-first · Exact WHY results · Email alerts</footer></section><section className="auth-panel"><form onSubmit={(event) => void submit(event)}><p className="eyebrow">{mode === 'setup' ? 'First run' : 'Welcome back'}</p><h2>{mode === 'setup' ? 'Create the administrator' : 'Sign in to MarketScope'}</h2><p>{mode === 'setup' ? 'Use a password with at least 12 characters.' : 'Connect to your local listing history and watchlists.'}</p>{error.length > 0 ? <StatusMessage tone="error">{error}</StatusMessage> : null}<label><span>Username</span><input autoFocus required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label><span>Password</span><input required minLength={mode === 'setup' ? 12 : undefined} type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Connecting…' : mode === 'setup' ? 'Create administrator' : 'Sign in'}</button></form></section></main>;
}
