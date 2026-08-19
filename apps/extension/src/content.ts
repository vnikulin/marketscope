import { MarketplaceController } from './controller.js';
import { EXTENSION_ENABLED_KEY, extensionIsEnabled } from './enabled.js';
import { clearRendering, createControls } from './renderer.js';
import type { ContentMessage, ExtensionState } from './types.js';

async function sendMessage<T>(message: ContentMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

let activeController: MarketplaceController | undefined;
let transition: Promise<void> = Promise.resolve();

function stop(): void {
  activeController?.stop();
  activeController = undefined;
  clearRendering(document);
}

async function start(): Promise<void> {
  if (activeController !== undefined) return;
  const state = await sendMessage<ExtensionState>({ type: 'GET_STATE' });
  const controller = new MarketplaceController(document, state.preferences, {
    sendListings(listings) {
      void sendMessage({ type: 'QUEUE_LISTINGS', listings });
    },
  });
  controller.setState(state.watchlists, state.preferences);
  createControls(document, state.preferences, (preferences) => {
    controller.updatePreferences(preferences);
    void sendMessage({ type: 'SET_PREFERENCES', preferences });
  });
  controller.start();
  activeController = controller;
}

function applyEnabled(enabled: boolean): void {
  transition = transition
    .then(async () => {
      if (enabled) await start();
      else stop();
    })
    .catch((error: unknown) => {
      console.error('MarketScope content script could not change state', error);
    });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const change = changes[EXTENSION_ENABLED_KEY];
  if (change === undefined) return;
  applyEnabled(extensionIsEnabled(change.newValue));
});

void chrome.storage.local.get(EXTENSION_ENABLED_KEY).then((stored) => {
  applyEnabled(extensionIsEnabled(stored[EXTENSION_ENABLED_KEY]));
});
