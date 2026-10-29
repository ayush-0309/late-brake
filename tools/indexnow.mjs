// Tells Bing and the other IndexNow search engines about new or changed pages,
// so they crawl them in minutes rather than days:
//   node tools/indexnow.mjs blog/some-post.html circuits/monza.html …
// The key is the 32-character .txt file at the site root (its name and its
// contents are the key). The publish-blog GitHub Action runs this.

import { readdirSync } from 'node:fs';

const SITE = 'https://www.latebrake.in';
const files = process.argv.slice(2).filter((f) => f.endsWith('.html'));
if (!files.length) {
  console.log('No pages to submit.');
  process.exit(0);
}

const keyFile = readdirSync(new URL('../', import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file at the site root');
const urlList = [...new Set(files.map((f) => `${SITE}/${f.replace(/(^|\/)index\.html$/, '$1')}`))];

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key: keyFile.slice(0, 32), keyLocation: `${SITE}/${keyFile}`, urlList }),
});
// 200 and 202 both mean accepted. Anything else is logged, not fatal: indexing can wait.
console.log(`IndexNow answered ${res.status} for ${urlList.length} page${urlList.length === 1 ? '' : 's'}:\n${urlList.join('\n')}`);
