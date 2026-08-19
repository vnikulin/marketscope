import nodemailer from 'nodemailer';
import type Database from 'better-sqlite3';

import { ValidationError } from './validation.js';

const EMAIL_SETTING_KEY = 'smtp';

export type EmailPreset = 'GMAIL' | 'MICROSOFT_365' | 'CUSTOM';
export type SmtpSecurity = 'TLS' | 'STARTTLS' | 'NONE';

export interface SmtpConfig {
  preset: EmailPreset;
  hostname: string;
  port: number;
  security: SmtpSecurity;
  username?: string;
  password?: string;
  sender: string;
  recipients: string[];
  verifiedAt?: number;
  lastTestError?: string;
}

export interface EmailMessage {
  subject: string;
  text: string;
}

export type SendMail = (
  config: SmtpConfig,
  message: EmailMessage,
) => Promise<void>;

export const MICROSOFT_365_WARNING =
  'Microsoft is disabling SMTP AUTH basic authentication by default for existing Exchange Online tenants at the end of December 2026. Administrators can re-enable it. Microsoft will announce the final removal date in the second half of 2027. MarketScope V1 does not support OAuth2 XOAUTH2.';

export const EMAIL_PRESETS = {
  GMAIL: {
    hostname: 'smtp.gmail.com',
    port: 587,
    security: 'STARTTLS' as const,
    recommended: true,
    help: 'Requires a Google app password and 2-Step Verification.',
  },
  MICROSOFT_365: {
    hostname: 'smtp.office365.com',
    port: 587,
    security: 'STARTTLS' as const,
    recommended: false,
    warning: MICROSOFT_365_WARNING,
  },
  CUSTOM: {
    recommended: false,
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return fieldValue.trim();
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined || fieldValue === '') return undefined;
  if (typeof fieldValue !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return fieldValue;
}

function recipients(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (recipient) =>
        typeof recipient === 'string' &&
        recipient.includes('@') &&
        recipient.trim().length > 3,
    )
  ) {
    throw new ValidationError('recipients must be a non-empty email array');
  }
  return value.map((recipient) => String(recipient).trim());
}

export function parseSmtpConfig(value: unknown): SmtpConfig {
  if (!isRecord(value)) {
    throw new ValidationError('email settings must be an object');
  }
  const preset = requiredString(value, 'preset');
  if (!['GMAIL', 'MICROSOFT_365', 'CUSTOM'].includes(preset)) {
    throw new ValidationError('preset must be GMAIL, MICROSOFT_365, or CUSTOM');
  }
  const typedPreset = preset as EmailPreset;
  let hostname: string;
  let port: number;
  let security: SmtpSecurity;
  if (typedPreset === 'CUSTOM') {
    hostname = requiredString(value, 'hostname');
    const suppliedPort = value.port;
    if (
      typeof suppliedPort !== 'number' ||
      !Number.isInteger(suppliedPort) ||
      suppliedPort < 1 ||
      suppliedPort > 65_535
    ) {
      throw new ValidationError('port must be an integer from 1 to 65535');
    }
    port = suppliedPort;
    const suppliedSecurity = requiredString(value, 'security');
    if (!['TLS', 'STARTTLS', 'NONE'].includes(suppliedSecurity)) {
      throw new ValidationError('security must be TLS, STARTTLS, or NONE');
    }
    security = suppliedSecurity as SmtpSecurity;
  } else {
    const selected = EMAIL_PRESETS[typedPreset];
    hostname = selected.hostname;
    port = selected.port;
    security = selected.security;
  }

  const username = optionalString(value, 'username');
  const password = optionalString(value, 'password');
  if (
    typedPreset !== 'CUSTOM' &&
    (username === undefined || password === undefined)
  ) {
    throw new ValidationError(
      `${typedPreset} requires a username and password`,
    );
  }

  return {
    preset: typedPreset,
    hostname,
    port,
    security,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
    sender: requiredString(value, 'sender'),
    recipients: recipients(value.recipients),
  };
}

export async function sendSmtpMail(
  config: SmtpConfig,
  message: EmailMessage,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.hostname,
    port: config.port,
    secure: config.security === 'TLS',
    requireTLS: config.security === 'STARTTLS',
    ignoreTLS: config.security === 'NONE',
    tls: { minVersion: 'TLSv1.2' },
    ...(config.username === undefined
      ? {}
      : {
          auth: {
            user: config.username,
            pass: config.password ?? '',
          },
        }),
  });
  await transporter.sendMail({
    from: config.sender,
    to: config.recipients,
    subject: message.subject,
    text: message.text,
  });
}

interface SettingRow {
  value_json: string;
}

export class EmailSettingsRepository {
  readonly #database: Database.Database;
  readonly #now: () => number;

  public constructor(database: Database.Database, now: () => number) {
    this.#database = database;
    this.#now = now;
  }

  public get(): SmtpConfig | undefined {
    const row = this.#database
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(EMAIL_SETTING_KEY) as SettingRow | undefined;
    return row === undefined
      ? undefined
      : (JSON.parse(row.value_json) as SmtpConfig);
  }

  public save(config: SmtpConfig): SmtpConfig {
    const unverified = { ...config };
    delete unverified.verifiedAt;
    delete unverified.lastTestError;
    this.#write(unverified);
    return unverified;
  }

  public markVerified(): SmtpConfig {
    const config = this.get();
    if (config === undefined) throw new Error('Email settings are missing');
    const verified = { ...config, verifiedAt: this.#now() };
    delete verified.lastTestError;
    this.#write(verified);
    return verified;
  }

  public markTestFailed(error: string): void {
    const config = this.get();
    if (config === undefined) return;
    const failed = { ...config, lastTestError: error };
    delete failed.verifiedAt;
    this.#write(failed);
  }

  #write(config: SmtpConfig): void {
    this.#database
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(EMAIL_SETTING_KEY, JSON.stringify(config), this.#now());
  }
}

export function publicEmailSettings(config: SmtpConfig | undefined): unknown {
  if (config === undefined) return { configured: false };
  const safe: Partial<SmtpConfig> = { ...config };
  delete safe.password;
  return {
    ...safe,
    passwordConfigured: config.password !== undefined,
    configured: config.verifiedAt !== undefined,
  };
}
