export {};

const EXTENSION_ENABLED_KEY = 'extensionEnabled';

function extensionIsEnabled(value: unknown): boolean {
  return value !== false;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`MarketScope popup control is missing: ${selector}`);
  }
  return element;
}

const toggle = requiredElement<HTMLInputElement>('#extension-enabled');
const status = requiredElement<HTMLElement>('#extension-status');

function render(enabled: boolean): void {
  toggle.checked = enabled;
  status.textContent = enabled
    ? 'Filtering this browser'
    : 'Filtering is paused';
  status.dataset.enabled = String(enabled);
}

const stored = await chrome.storage.local.get(EXTENSION_ENABLED_KEY);
render(extensionIsEnabled(stored[EXTENSION_ENABLED_KEY]));

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  toggle.disabled = true;
  void chrome.storage.local
    .set({ [EXTENSION_ENABLED_KEY]: enabled })
    .then(() => render(enabled))
    .finally(() => {
      toggle.disabled = false;
    });
});
