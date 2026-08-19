import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { request, restoreBackup } from '../api.js';
import { PageHeader, StatusMessage } from '../components.js';
import type { EmailSettings } from '../types.js';

interface EmailForm {
  preset: 'GMAIL' | 'MICROSOFT_365' | 'CUSTOM';
  hostname: string;
  port: string;
  security: 'TLS' | 'STARTTLS' | 'NONE';
  username: string;
  password: string;
  sender: string;
  recipients: string;
}

const EMPTY: EmailForm = { preset: 'GMAIL', hostname: 'smtp.gmail.com', port: '587', security: 'STARTTLS', username: '', password: '', sender: '', recipients: '' };
const MICROSOFT_WARNING = 'Microsoft is disabling SMTP AUTH basic authentication by default for existing Exchange Online tenants at the end of December 2026. Administrators can re-enable it. Microsoft will announce the final removal date in the second half of 2027. MarketScope V1 does not support OAuth2 XOAUTH2.';

export function Settings(): ReactNode {
  const [email, setEmail] = useState<EmailForm>(EMPTY);
  const [savedEmail, setSavedEmail] = useState<EmailSettings>();
  const [retention, setRetention] = useState<'7' | '30' | '90' | 'forever'>('30');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [includeHistory, setIncludeHistory] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const update = <K extends keyof EmailForm>(key: K, value: EmailForm[K]): void => setEmail((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    void Promise.all([
      request<{ retentionDays: 7 | 30 | 90 | null }>('/api/settings'),
      request<{ settings: EmailSettings }>('/api/settings/email'),
    ]).then(([settings, emailResponse]) => {
      setRetention(settings.retentionDays === null ? 'forever' : String(settings.retentionDays) as '7' | '30' | '90');
      const saved = emailResponse.settings;
      setSavedEmail(saved);
      if (saved.preset !== undefined) setEmail({ preset: saved.preset, hostname: saved.hostname ?? '', port: String(saved.port ?? 587), security: saved.security ?? 'STARTTLS', username: saved.username ?? '', password: '', sender: saved.sender ?? '', recipients: saved.recipients?.join(', ') ?? '' });
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  function choosePreset(preset: EmailForm['preset']): void {
    setEmail((current) => preset === 'GMAIL' ? { ...current, preset, hostname: 'smtp.gmail.com', port: '587', security: 'STARTTLS' } : preset === 'MICROSOFT_365' ? { ...current, preset, hostname: 'smtp.office365.com', port: '587', security: 'STARTTLS' } : { ...current, preset });
  }
  async function saveEmail(event: FormEvent): Promise<void> {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const body = { ...email, port: Number(email.port), recipients: email.recipients.split(',').map((item) => item.trim()).filter(Boolean), ...(email.password.length === 0 ? {} : { password: email.password }) };
      const response = await request<{ settings: EmailSettings }>('/api/settings/email', { method: 'PUT', body: JSON.stringify(body) });
      setSavedEmail(response.settings); setMessage('Email settings saved. Send a test email to verify them.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function testEmail(): Promise<void> {
    setError(''); setMessage('');
    try { const response = await request<{ settings: EmailSettings }>('/api/settings/email/test', { method: 'POST' }); setSavedEmail(response.settings); setMessage('Test email sent successfully.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function saveRetention(): Promise<void> {
    await request('/api/settings/retention', { method: 'PUT', body: JSON.stringify({ retentionDays: retention === 'forever' ? null : Number(retention) }) }); setMessage('Retention setting saved.');
  }
  async function restore(event: FormEvent): Promise<void> {
    event.preventDefault(); const selected = file.current?.files?.[0]; if (selected === undefined) return;
    setError(''); setMessage('');
    try { const value = JSON.parse(await selected.text()) as unknown; await restoreBackup(value); setMessage('Backup restored. A pre-restore database snapshot was saved.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <>
    <PageHeader title="Settings" detail="Configure email, retention, pairing, backup, and restore." />
    {error.length > 0 ? <StatusMessage tone="error">{error}</StatusMessage> : null}{message.length > 0 ? <StatusMessage tone="success">{message}</StatusMessage> : null}
    <div className="settings-stack">
      <section className="settings-card"><div className="settings-title"><div><p className="eyebrow">Notifications</p><h2>Email delivery</h2></div><span className={`pill ${savedEmail?.configured ? 'pill-pass' : ''}`}>{savedEmail?.configured ? 'Verified' : 'Not verified'}</span></div>
        <form className="form-grid" onSubmit={(event) => void saveEmail(event)}>
          <label><span>Provider</span><select value={email.preset} onChange={(event) => choosePreset(event.target.value as EmailForm['preset'])}><option value="GMAIL">Gmail, recommended</option><option value="MICROSOFT_365">Microsoft 365</option><option value="CUSTOM">Custom SMTP</option></select></label>
          <label><span>Security</span><select value={email.security} disabled={email.preset !== 'CUSTOM'} onChange={(event) => update('security', event.target.value as EmailForm['security'])}><option>STARTTLS</option><option>TLS</option><option>NONE</option></select></label>
          <label><span>Hostname</span><input required value={email.hostname} disabled={email.preset !== 'CUSTOM'} onChange={(event) => update('hostname', event.target.value)} /></label><label><span>Port</span><input required type="number" value={email.port} disabled={email.preset !== 'CUSTOM'} onChange={(event) => update('port', event.target.value)} /></label>
          <label><span>Username</span><input value={email.username} onChange={(event) => update('username', event.target.value)} autoComplete="username" /></label><label><span>{email.preset === 'GMAIL' ? '16-digit Google app password' : 'Password'}</span><input type="password" value={email.password} onChange={(event) => update('password', event.target.value)} autoComplete="new-password" placeholder={savedEmail?.passwordConfigured ? 'Saved, enter to replace' : ''} /></label>
          <label><span>Sender</span><input required type="email" value={email.sender} onChange={(event) => update('sender', event.target.value)} /></label><label><span>Recipients, comma separated</span><input required value={email.recipients} onChange={(event) => update('recipients', event.target.value)} /></label>
          {email.preset === 'GMAIL' ? <div className="field-wide form-note"><strong>Google verification happens in your Google Account, not inside MarketScope.</strong><ol><li>Turn on 2-Step Verification for the Google Account.</li><li>Create a 16-digit app password in Google Account settings.</li><li>Paste that app password above, then save and send a test email.</li></ol><a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noreferrer">Open Google’s app-password instructions</a><p>Google may hide app passwords for work or school accounts, Advanced Protection, or accounts configured only with security keys.</p></div> : null}{email.preset === 'MICROSOFT_365' ? <p className="field-wide warning-note">{MICROSOFT_WARNING}</p> : null}
          <div className="field-wide form-actions"><button className="button button-primary" type="submit">Save email settings</button><button className="button button-secondary" type="button" onClick={() => void testEmail()} disabled={savedEmail === undefined}>Send test email</button></div>
        </form>
      </section>
      <section className="settings-card"><p className="eyebrow">Storage</p><h2>Listing retention</h2><div className="inline-setting"><label><span>Keep unfavorited listings</span><select value={retention} onChange={(event) => setRetention(event.target.value as typeof retention)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="forever">Forever</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveRetention()}>Save retention</button></div></section>
      <section className="settings-card"><p className="eyebrow">Data safety</p><h2>Backup and restore</h2><p>Exports never include your SMTP password. Restore validates the file and saves a database snapshot first.</p><div className="backup-grid"><div><label className="toggle-field"><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} /><span>Include observed listing history</span></label><a className="button button-secondary" href={`/api/backup?includeHistory=${includeHistory}`} download>Download backup</a></div><form onSubmit={(event) => void restore(event)}><label><span>MarketScope backup file</span><input ref={file} required type="file" accept="application/json,.json" /></label><button className="button button-danger" type="submit">Restore backup</button></form></div></section>
      <section className="settings-card"><p className="eyebrow">Browser</p><h2>Pair an extension</h2><p>Create a one-time pairing token here, then paste it into the extension service worker setup.</p><Pairing /></section>
    </div>
  </>;
}

function Pairing(): ReactNode {
  const [name, setName] = useState('Daily browser'); const [token, setToken] = useState('');
  async function create(): Promise<void> { const response = await request<{ token: string }>('/api/extension-tokens', { method: 'POST', body: JSON.stringify({ name }) }); setToken(response.token); }
  return <div className="pairing"><label><span>Browser name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => void create()}>Create pairing token</button>{token.length === 0 ? null : <output><strong>Copy now. It won't be shown again.</strong><code>{token}</code></output>}</div>;
}
