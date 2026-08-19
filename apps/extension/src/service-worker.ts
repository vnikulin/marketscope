import {
  getExtensionState,
  type KeyValueStorage,
  ListingUploadQueue,
  setPreferences,
  ThumbnailUploader,
  transportKeys,
} from './transport.js';
import { QUICK_ADD_MENU_ID, watchlistEditorUrl } from './quick-add.js';
import type { ConnectionSettings, ContentMessage } from './types.js';

function chromeStorage(area: chrome.storage.StorageArea): KeyValueStorage {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const values = await area.get(key);
      return values[key] as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      await area.set({ [key]: value });
    },
  };
}

const localStorage = chromeStorage(chrome.storage.local);
const sessionStorage = chromeStorage(chrome.storage.session);
const request = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, init);
const UPLOAD_RETRY_ALARM = 'marketscope-upload-retry';
const thumbnailUploader = new ThumbnailUploader(localStorage, request);
const uploadQueue = new ListingUploadQueue(
  sessionStorage,
  localStorage,
  request,
  (delay) => {
    void chrome.alarms.create(UPLOAD_RETRY_ALARM, {
      when: Date.now() + delay,
    });
  },
  (listings) => thumbnailUploader.upload(listings),
);

void uploadQueue.recover();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: QUICK_ADD_MENU_ID,
      title: 'Add current search to MarketScope',
      contexts: ['page', 'link', 'image', 'video'],
      documentUrlPatterns: ['https://www.facebook.com/marketplace/*'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== QUICK_ADD_MENU_ID || info.pageUrl === undefined)
    return;
  const marketplaceUrl = info.pageUrl;
  void localStorage
    .get<ConnectionSettings>(transportKeys.connection)
    .then(async (connection) => {
      if (connection === undefined) {
        throw new Error('Connect MarketScope before using quick add');
      }
      await chrome.tabs.create({
        url: watchlistEditorUrl(connection, marketplaceUrl),
      });
    })
    .catch((error: unknown) => {
      console.error('MarketScope could not open quick add', error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPLOAD_RETRY_ALARM) void uploadQueue.flush();
});

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse): boolean => {
    const handle = async (): Promise<unknown> => {
      switch (message.type) {
        case 'GET_STATE':
          return getExtensionState(localStorage, request);
        case 'QUEUE_LISTINGS':
          await uploadQueue.enqueue(message.listings);
          return { queued: message.listings.length };
        case 'SET_PREFERENCES':
          await setPreferences(localStorage, message.preferences);
          return { saved: true };
      }
    };
    void handle().then(sendResponse, (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      sendResponse({ error: detail });
    });
    return true;
  },
);
