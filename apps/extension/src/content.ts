import { MarketplaceController } from './controller.js';
import { createControls } from './renderer.js';
import type { ContentMessage, ExtensionState } from './types.js';

async function sendMessage<T>(message: ContentMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function start(): Promise<void> {
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
}

void start().catch((error: unknown) => {
  console.error('MarketScope content script could not start', error);
});
