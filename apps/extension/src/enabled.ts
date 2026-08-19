export const EXTENSION_ENABLED_KEY = 'extensionEnabled';

export function extensionIsEnabled(value: unknown): boolean {
  return value !== false;
}
