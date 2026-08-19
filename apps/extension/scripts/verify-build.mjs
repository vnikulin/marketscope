import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const extensionRoot = resolve(import.meta.dirname, '..');
const contentPath = resolve(extensionRoot, 'dist/content.js');
const popupScriptPath = resolve(extensionRoot, 'dist/popup.js');
const popupDocumentPath = resolve(extensionRoot, 'popup.html');
const workerPath = resolve(extensionRoot, 'dist/assets/regex-worker.js');
const manifestPath = resolve(extensionRoot, 'manifest.json');

const content = await readFile(contentPath, 'utf8');
new Script(content, { filename: contentPath });

await access(workerPath);
await access(popupScriptPath);
await access(popupDocumentPath);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const workerIsExposed = manifest.web_accessible_resources?.some(
  (entry) =>
    entry.resources?.includes('dist/assets/regex-worker.js') &&
    entry.matches?.includes('https://www.facebook.com/*'),
);

if (!workerIsExposed) {
  throw new Error(
    'The packaged regex worker is not exposed to Facebook pages.',
  );
}

if (manifest.action?.default_popup !== 'popup.html') {
  throw new Error('The toolbar action does not open the MarketScope popup.');
}

console.log('Extension bundle passed classic-script and worker checks.');
