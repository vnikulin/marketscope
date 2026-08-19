import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../../apps/server/dist/src/app.js';

const runtimeDirectory = mkdtempSync(join(tmpdir(), 'marketscope-e2e-'));
const server = await createServer({
  databasePath: join(runtimeDirectory, 'marketscope.db'),
  thumbnailDirectory: join(runtimeDirectory, 'thumbnails'),
  backupDirectory: join(runtimeDirectory, 'backups'),
  startRetention: false,
  startNotifications: false,
  sendMail: async () => {},
});

const preflight = await server.app.inject({ method: 'GET', url: '/api/auth/preflight' });
const setup = await server.app.inject({
  method: 'POST',
  url: '/api/setup',
  headers: { 'x-csrf-token': preflight.json().csrfToken },
  payload: { username: 'admin', password: 'correct horse battery staple' },
});
const cookie = setup.headers['set-cookie'].split(';', 1)[0];
const headers = { cookie, 'x-csrf-token': setup.json().csrfToken };
const watchlist = {
  name: 'Garmin chartplotters',
  searchUrl: 'https://www.facebook.com/marketplace/search/?query=garmin',
  termMode: 'ALL',
  requiredTerms: ['garmin'],
  optionalTerms: ['gpsmap'],
  excludedTerms: ['case'],
  regexPatterns: [],
  priceRules: { maxCents: 100000, unknownPolicy: 'BLOCK' },
  locationRules: { allowedStates: ['NY'], unknownPolicy: 'BLOCK' },
  listingTypeRules: { sponsored: 'BLOCK', shipping: 'BLOCK' },
  relevanceThreshold: 0,
  emailEnabled: true,
  enabled: true,
  ignoreOlderThanDays: 30,
  alertOnPriceChange: 'DECREASE',
};
await server.app.inject({ method: 'POST', url: '/api/watchlists', headers, payload: watchlist });
const tokenResponse = await server.app.inject({ method: 'POST', url: '/api/extension-tokens', headers, payload: { name: 'E2E browser' } });
await server.app.inject({
  method: 'POST',
  url: '/api/extension/listings',
  headers: { authorization: `Bearer ${tokenResponse.json().token}` },
  payload: {
    listings: [
      {
        source: 'facebook', sourceListingId: 'e2e-match', url: 'https://www.facebook.com/marketplace/item/e2e-match/', title: 'Garmin GPSMAP 1042xsv', description: 'Excellent condition with cables', price: 50000, priceText: '$500', location: 'Freeport, NY', distanceMiles: 8, sellerName: '<script>Seller</script>', sponsored: false, shipping: false, localPickup: true, postedAtText: 'Listed 2 hours ago', postedAtEstimate: Date.now() - 7200000, rawText: 'Garmin GPSMAP 1042xsv $500 Freeport, NY',
      },
      {
        source: 'facebook', sourceListingId: 'e2e-blocked', url: 'https://www.facebook.com/marketplace/item/e2e-blocked/', title: '<img src=x onerror=alert(1)> Garmin case', description: 'Protective carrying case', price: 12000, priceText: '$120', location: 'Freeport, NY', sponsored: false, shipping: false, localPickup: true, postedAtText: 'Listed today', postedAtEstimate: Date.now() - 3600000, rawText: 'Garmin case $120 Freeport, NY',
      },
    ],
  },
});

await server.app.listen({ host: '127.0.0.1', port: 3106 });

process.once('SIGINT', async () => {
  await server.app.close();
  process.exit(0);
});
process.on('exit', () => {
  rmSync(runtimeDirectory, { recursive: true, force: true });
});
