// Downloads a Wikimedia Commons photo for a blog post, at 1280px wide plus
// 960px and 500px copies that phones and the post cards load instead:
//   node tools/commons-photo.mjs "File:2026 Chinese GP - Mercedes - Kimi Antonelli - Qualifying.jpg" media/blog/<post>.jpg
// saves media/blog/<post>.jpg, <post>-960.jpg and <post>-500.jpg. Commit all three.
// It works the thumbnail addresses out from the file name the way Commons does,
// so no API call is needed (from the cloud, Commons' API is often rate-limited).
// The photo must be a JPEG at least 1280px wide. Commons only makes thumbnails
// at its standard widths, which is why the sizes are these.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const UA = 'LateBrakeBlog/1.0 (https://www.latebrake.in/contact.html)';
const TRIES = 3;
const WIDTHS = [1280, 960, 500]; // the first is the main file; build-blog.mjs knows the others

const [title, out] = process.argv.slice(2);
if (!title || !out?.endsWith('.jpg')) {
  console.error('Usage: node tools/commons-photo.mjs "File:<name>.jpg" media/blog/<post>.jpg');
  process.exit(1);
}

const name = title.replace(/^File:/, '').trim().replaceAll(' ', '_');
const hash = createHash('md5').update(name).digest('hex');
// Commons escapes ( ) ! ' * too, which encodeURIComponent leaves alone.
const q = encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

for (const width of WIDTHS) {
  const url = `https://thumb.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash.slice(0, 2)}/${q}/${width}px-${q}`;
  const file = width === WIDTHS[0] ? out : out.replace(/\.jpg$/, `-${width}.jpg`);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 && attempt < TRIES) {
      console.log(`Rate-limited, trying again in 20 seconds (${attempt}/${TRIES})`);
      await new Promise((resolve) => setTimeout(resolve, 20000));
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/jpeg')) {
      console.error(`Couldn't get ${url}: HTTP ${res.status} ${type}. Is it a JPEG at least 1280px wide?`);
      process.exit(1);
    }
    const data = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, data);
    console.log(`Saved ${file} (${Math.round(data.length / 1024)} KB)`);
    break;
  }
}
