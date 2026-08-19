import { useEffect, useState, type ReactNode } from 'react';

import { request } from '../api.js';
import { PageHeader, StatusMessage } from '../components.js';
import { formatBytes, formatDate } from '../format.js';
import type { Diagnostics as DiagnosticsData } from '../types.js';

export function Diagnostics(): ReactNode {
  const [data, setData] = useState<DiagnosticsData>();
  const [error, setError] = useState('');
  async function load(): Promise<void> { const response = await request<DiagnosticsData>('/api/diagnostics'); setData(response); }
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  return <>
    <PageHeader title="Diagnostics" detail="Current server, database, parser, email, queue, and storage health." action={<button className="button button-secondary" type="button" onClick={() => void load()}>Refresh</button>} />
    {error.length > 0 ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {data === undefined ? <div className="loading-grid" aria-label="Loading diagnostics" /> : <>
      {data.parser.sampledCards >= 500 && data.parser.successRate !== null && data.parser.successRate < 0.85 ? <StatusMessage tone="error"><strong>FACEBOOK PARSER WARNING</strong><br />Marketplace page structure may have changed. Filtering accuracy is degraded. Check for a MarketScope update.</StatusMessage> : null}
      <section className="diagnostic-grid">
        <Diagnostic label="Server" value={`v${data.serverVersion}`} detail={`Up ${Math.floor(data.uptimeMs / 60_000)} minutes`} ok />
        <Diagnostic label="Extension" value={`v${data.extensionVersion}`} detail="Reported package version" ok />
        <Diagnostic label="Database" value={data.database.status} detail={`${formatBytes(data.database.bytes)} · ${data.database.journalMode.toUpperCase()}`} ok={data.database.status === 'ok'} />
        <Diagnostic label="Last ingest" value={formatDate(data.lastListingIngestedAt)} detail={`${data.listingsLast24Hours} listings in 24 hours`} ok={data.lastListingIngestedAt !== null} />
        <Diagnostic label="Parser sample" value={data.parser.successRate === null ? 'Awaiting data' : `${Math.round(data.parser.successRate * 100)}%`} detail={`${data.parser.sampledCards} cards sampled`} ok={data.parser.successRate === null || data.parser.successRate >= 0.85} />
        <Diagnostic label="SMTP" value={data.smtp.configured ? 'Verified' : 'Not verified'} detail={data.smtp.lastError ?? `Last send: ${formatDate(data.smtp.lastSendAt)}`} ok={data.smtp.configured} />
        <Diagnostic label="Notification queue" value={String(data.notificationQueueDepth)} detail="Waiting or retrying" ok={data.notificationQueueDepth === 0} />
        <Diagnostic label="Thumbnails" value={formatBytes(data.thumbnailCache.bytes)} detail={`${data.thumbnailCache.files} cached files`} ok />
        <Diagnostic label="Disk free" value={formatBytes(data.diskFreeBytes)} detail="Database volume" ok={data.diskFreeBytes === null || data.diskFreeBytes > 1_073_741_824} />
      </section>
      <section className="settings-card"><div className="settings-title"><div><p className="eyebrow">Schema</p><h2>Applied migrations</h2></div><span>{data.database.migrations.length} current</span></div><ol className="migration-list">{data.database.migrations.map((migration) => <li key={migration.version}><strong>{String(migration.version).padStart(3, '0')} {migration.name}</strong><span>{formatDate(migration.appliedAt)}</span></li>)}</ol></section>
      <div className="diagnostic-actions"><a className="button button-primary" href="/api/diagnostics/export" download>Export diagnostics</a><button className="button button-secondary" type="button" disabled title="Parser tests run against bundled fixtures in the extension test suite">Test parser</button><a className="button button-secondary" href="#/settings">Test email</a></div>
    </>}
  </>;
}

function Diagnostic({ label, value, detail, ok }: { label: string; value: string; detail: string; ok: boolean }): ReactNode {
  return <article className="diagnostic-card"><div><span className={`status-dot ${ok ? 'is-on' : ''}`} />{label}</div><strong>{value}</strong><p>{detail}</p></article>;
}
