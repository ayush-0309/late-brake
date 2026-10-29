// Builds the blog and the circuit pages from Markdown: posts/*.md become
// blog/<name>.html and content/circuits/*.md become circuits/<name>.html, plus
// the blog index (blog/index.html), its RSS feed (blog/feed.xml), the circuits
// index, the site maps (sitemap.xml, and sitemap-news.xml for the last two
// days' posts), robots.txt and the "From the blog" cards on the home page.
// No dependencies: run `node tools/build-blog.mjs` and commit what it writes.
// A post goes live at its date and time (India time): until then it's left out
// of everything, and the publish-blog GitHub Action rebuilds every 15 minutes
// through the day to put due posts up. `--drafts` builds scheduled posts too,
// for a local look only: never commit that build.
//
// A post starts with front matter:
//   ---
//   title: Antonelli wins in Austin and can be champion in Mexico
//   description: One or two sentences for search results and link previews.
//   date: 2026-10-29 09:00   (India time; a date alone means midnight)
//   kind: news           (news, on-this-day, history or facts)
//   circuit: br-1940     (optional: the game circuit the post's button opens)
//   image: <slug>.jpg    (optional: a JPEG in media/blog/, with alt, caption and credit;
//                        its -960 and -500 copies are used too when they're there)
//   alt: What the photo shows, for screen readers.
//   caption: One line under the photo.
//   credit: [Author](https://commons.wikimedia.org/…), CC BY 4.0
//   ---
// then Markdown: ## and ### headings, paragraphs, - and 1. lists, > quotes,
// ---, **bold**, *italic*, `code` and [links](https://…). Files whose names
// start with _ (like _guide.md) aren't posts. Em and en dashes stop the build
// (use commas, colons, brackets or "to"). Posts may say F1 and Formula 1, but
// the game may not: trademarked names in the circuit pages, the site's own
// pages or the game's code stop the build too (see TRADEMARKS).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { TRACKS, buildTrack } from '../src/track.js';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://www.latebrake.in';
const PAGES = ['/', '/play.html', '/about.html', '/sponsors.html', '/terms.html', '/privacy.html', '/refunds.html', '/contact.html'];
const HOME_POSTS = 3;
// Who posts are credited to. about.html says who that is and how posts are written.
const AUTHOR = { name: 'Ayush Garg', url: `${SITE}/about.html` };
// Smaller copies of post photos (tools/commons-photo.mjs saves them), for phones and cards.
const PHOTO_WIDTHS = [500, 960];
// Kinds of post, in the order same-day posts are listed.
const KINDS = { news: 'News', 'on-this-day': 'On this day', history: 'History', facts: 'Fun facts' };
const kindOrder = (p) => Object.keys(KINDS).indexOf(p.kind);
// The championship's own marks and branded circuit names. Blog posts are news
// and history, so they use them; the game is what earns money, so it never
// does: not in its code, its pages (home, play, the shop's policy pages) or the
// circuit pages that lead into it. Cards linking to posts are the posts' words.
const TRADEMARKS = /\bF1\b|\bFormula[ -]?(1|One)\b|\bRed Bull Ring\b/i;
const GAME = [...PAGES.map((p) => p === '/' ? 'index.html' : p.slice(1)), '404.html', 'manifest.webmanifest',
  ...readdirSync(new URL('src/', ROOT)).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
const NEWS_HOURS = 48; // how far back sitemap-news.xml looks

const DRAFTS = process.argv.includes('--drafts');
for (const f of GAME) {
  const text = readFileSync(new URL(f, ROOT), 'utf8');
  // The home page's blog cards are left out, keeping line numbers.
  noTrademarks(f, f === 'index.html' ? text.replace(/<!-- blog:start -->[\s\S]*<!-- blog:end -->/, (s) => s.replace(/[^\n]/g, '')) : text);
}
// Every post is read (so a bad one fails now, not at its publish time); only due ones are built.
const all = readdirSync(new URL('posts/', ROOT))
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((f) => readPost(f));
const posts = all.filter((p) => DRAFTS || p.at <= Date.now())
  .sort((a, b) => b.at - a.at || kindOrder(a) - kindOrder(b) || a.title.localeCompare(b.title));
const circuits = readdirSync(new URL('content/circuits/', ROOT))
  .filter((f) => f.endsWith('.md'))
  .map((f) => readCircuit(f))
  .sort((a, b) => TRACKS.indexOf(a.def) - TRACKS.indexOf(b.def));

mkdirSync(new URL('blog/', ROOT), { recursive: true });
// Pages left over from posts that have been deleted or renamed.
for (const f of readdirSync(new URL('blog/', ROOT))) {
  if (f.endsWith('.html') && f !== 'index.html' && !posts.some((p) => `${p.slug}.html` === f)) rmSync(new URL(`blog/${f}`, ROOT));
}
for (const p of posts) write(`blog/${p.slug}.html`, postPage(p));
write('blog/index.html', indexPage(posts));
write('blog/feed.xml', feed(posts));
mkdirSync(new URL('circuits/', ROOT), { recursive: true });
for (const c of circuits) write(`circuits/${c.slug}.html`, circuitPage(c, posts.filter((p) => p.track?.id === c.id)));
write('circuits/index.html', circuitsIndex(circuits));
write('sitemap.xml', sitemap(posts, circuits));
write('sitemap-news.xml', newsSitemap(posts));
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/sitemap-news.xml\n`);
updateHome(posts.slice(0, HOME_POSTS));
const waiting = all.length - posts.length;
console.log(`Built ${posts.length} post${posts.length === 1 ? '' : 's'}${waiting ? `; ${waiting} scheduled for later` : ''}, and ${circuits.length} circuit pages.`);
if (DRAFTS) console.log('Scheduled posts are included: this build is for a local look only, don\'t commit it.');

// ---------- reading ----------

// Front matter and body of a Markdown file, after the dash check.
function readMarkdown(path) {
  const text = readFileSync(new URL(path, ROOT), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${path}: no front matter`);
  const lines = text.split('\n');
  const dash = lines.findIndex((line) => /[\u2013\u2014]/.test(line));
  if (dash >= 0) throw new Error(`${path}:${dash + 1}: em or en dash; use a comma, colon, brackets or "to"`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
  }));
  return { meta, body: m[2] };
}

// Stops the build at the first trademarked name in a game file. Link addresses
// can't be reworded, so only the words around them count.
function noTrademarks(path, text) {
  const words = (line) => line.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/[^\s"'<>)]+/g, '');
  const lines = text.split('\n');
  const i = lines.findIndex((line) => TRADEMARKS.test(words(line)));
  if (i >= 0) throw new Error(`${path}:${i + 1}: trademarked name "${words(lines[i]).match(TRADEMARKS)[0]}" in the game; say "the world championship", "Grand Prix racing" or the town instead`);
}

function readCircuit(file) {
  noTrademarks(`content/circuits/${file}`, readFileSync(new URL(`content/circuits/${file}`, ROOT), 'utf8'));
  const { meta, body } = readMarkdown(`content/circuits/${file}`);
  for (const key of ['id', 'title', 'description', 'place', 'country_code', 'direction']) if (!meta[key]) throw new Error(`${file}: no ${key}`);
  const def = TRACKS.find((t) => t.id === meta.id);
  if (!def) throw new Error(`${file}: unknown circuit ${meta.id}`);
  if (`${def.slug}.md` !== file) throw new Error(`${file}: should be named ${def.slug}.md, after its slug in src/track.js`);
  return { ...meta, slug: def.slug, def, track: buildTrack(def), body: markdown(body) };
}

function readPost(file) {
  const { meta, body: source } = readMarkdown(`posts/${file}`);
  for (const key of ['title', 'description', 'date', 'kind']) if (!meta[key]) throw new Error(`${file}: no ${key}`);
  if (!KINDS[meta.kind]) throw new Error(`${file}: kind must be one of ${Object.keys(KINDS).join(', ')}`);
  const when = meta.date.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/);
  if (!when) throw new Error(`${file}: date must be YYYY-MM-DD or YYYY-MM-DD HH:MM (India time)`);
  const iso = `${when[1]}T${when[2] || '00:00'}:00+05:30`;
  const track = meta.circuit ? TRACKS.find((t) => t.id === meta.circuit) : null;
  if (meta.circuit && !track) throw new Error(`${file}: unknown circuit ${meta.circuit}`);
  let image = null;
  if (meta.image) {
    for (const key of ['alt', 'credit']) if (!meta[key]) throw new Error(`${file}: an image needs ${key}`);
    const size = jpegSize(readFileSync(new URL(`media/blog/${meta.image}`, ROOT)));
    const widths = PHOTO_WIDTHS.filter((w) => existsSync(new URL(`media/blog/${sized(meta.image, w)}`, ROOT)));
    image = { file: meta.image, ...size, widths, alt: meta.alt, caption: meta.caption || '', credit: meta.credit };
  }
  const words = source.split(/\s+/).filter(Boolean).length;
  return { ...meta, day: when[1], iso, at: Date.parse(iso), slug: file.replace(/\.md$/, ''), track, image, body: markdown(source), minutes: Math.max(1, Math.round(words / 220)) };
}

// ---------- Markdown (the small part of it posts need) ----------

function markdown(src) {
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{2,4})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`); continue; }
    const item = line.match(/^([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      flushPara();
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(item[2]);
      continue;
    }
    if (list) { list.items[list.items.length - 1] += ' ' + line; continue; } // a list item carried onto the next line
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const external = /^https?:/.test(href);
    return `<a href="${href}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// ---------- pages ----------

function postPage(p) {
  const url = `${SITE}/blog/${p.slug}.html`;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: p.title, description: p.description, datePublished: p.iso, dateModified: p.iso,
        author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
        publisher: { '@type': 'Organization', name: 'Late Brake', logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` } },
        image: shareImage(p), mainEntityOfPage: url,
      },
      breadcrumbs([['Late Brake', `${SITE}/`], ['Blog', `${SITE}/blog/`], [p.title, url]]),
    ],
  };
  return page({
    title: `${p.title} · Late Brake`, description: p.description, url, type: 'article', image: p.image,
    head: `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
    body: `
  <main class="wrap">
    <article>
      <p class="meta"><a href="./">Blog</a> · ${KINDS[p.kind]} · <time datetime="${p.iso}">${longDate(p.day)}</time> · ${p.minutes} min read</p>
      <h1>${esc(p.title)}</h1>
      <p class="lead">${esc(p.description)}</p>
      <p class="byline">By <a href="../about.html" rel="author">${AUTHOR.name}</a></p>
${figure(p.image)}
      <div class="post-body">
${p.body}
      </div>
      <p class="how">Researched and written with the help of AI, using the sources above. <a href="../about.html#how-posts-are-written">How we write posts</a></p>
    </article>
${drive(p.track)}
  </main>`,
  });
}

// The way into the game: straight onto the post's circuit when it has one.
function drive(track) {
  if (!track) {
    return `    <aside class="drive">
      <p class="kicker">Late Brake</p>
      <h2>Race six real circuits on Late Brake</h2>
      <p>Monza, Spa, Silverstone, Monaco, Interlagos and Spielberg at true scale. Free in your browser, no install.</p>
      <a class="drive-btn" href="../play.html">Play Late Brake</a>
    </aside>`;
  }
  return `    <aside class="drive">
      <p class="kicker">Late Brake</p>
      <h2>Drive ${esc(track.name)} on Late Brake</h2>
      <p>Free in your browser, no install. Bronze at ${lapTime(track.medals[0])}, gold at ${lapTime(track.medals[2])}: how close can you get?</p>
      <a class="drive-btn" href="../play.html?track=${track.id}">Drive it now</a>
      <a class="drive-more" href="../circuits/${track.slug}.html">The ${esc(track.name)} circuit: history and corners</a>
    </aside>`;
}

// A circuit's page: what the real place is like, then racing it in the game.
function circuitPage(c, related) {
  const url = `${SITE}/circuits/${c.slug}.html`;
  const name = c.def.name, heading = c.title.split(':')[0];
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', name: c.title, description: c.description, url,
        isPartOf: { '@type': 'WebSite', name: 'Late Brake', url: `${SITE}/` },
        about: {
          '@type': 'Place', name: heading,
          address: { '@type': 'PostalAddress', addressLocality: c.place.split(',')[0], addressCountry: c.country_code },
        },
      },
      breadcrumbs([['Late Brake', `${SITE}/`], ['Circuits', `${SITE}/circuits/`], [heading, url]]),
    ],
  };
  const fact = (label, value) => `        <div><dt>${label}</dt><dd>${value}</dd></div>`;
  const posts = related.slice(0, 5).map((p) => `        <li><a href="../blog/${p.slug}.html">${esc(p.title)}</a> <span class="meta">${longDate(p.day)}</span></li>`).join('\n');
  return page({
    title: `${c.title} · Late Brake`, description: c.description, url, type: 'website',
    head: `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
    body: `
  <main class="wrap">
    <article>
      <p class="meta"><a href="./">Circuits</a> · ${esc(c.place)}</p>
      <h1>${esc(heading)}</h1>
      <p class="lead">${esc(c.description)}</p>
      <figure class="track-map">
        ${trackSvg(c.track, name)}
        <figcaption>The ${esc(name)} layout in Late Brake, run ${c.direction}. The red line is the start.</figcaption>
      </figure>
      <dl class="circuit-facts">
${fact('Length in the game', `${(c.track.length / 1000).toFixed(2)} km`)}
${fact('Direction', c.direction[0].toUpperCase() + c.direction.slice(1))}
${fact('Bronze', lapTime(c.def.medals[0]))}
${fact('Silver', lapTime(c.def.medals[1]))}
${fact('Gold', lapTime(c.def.medals[2]))}
      </dl>
      <div class="post-body">
${c.body}
        <h2>Race it on Late Brake</h2>
        <p>Late Brake's ${esc(name)} follows the real circuit's shape at true scale, run ${c.direction} like the real thing.
          Set a lap and race your own ghost, take on up to three AI rivals, or race friends online, free in your browser.
          Beat the medal times above to unlock new car colours.</p>
${posts ? `        <h2>${esc(name)} on the blog</h2>\n        <ul class="related">\n${posts}\n        </ul>` : ''}
      </div>
    </article>
${drive(c.def)}
  </main>`,
  });
}

function circuitsIndex(list) {
  const cards = list.map((c) => `      <li>
        <a class="post-card has-image" href="${c.slug}.html">
          ${trackSvg(c.track, c.def.name, { small: true })}
          <span class="meta">${esc(c.place)} · ${(c.track.length / 1000).toFixed(2)} km</span>
          <strong>${esc(c.title.split(':')[0])}</strong>
          <span>${esc(c.description)}</span>
        </a>
      </li>`).join('\n');
  const url = `${SITE}/circuits/`;
  const data = { '@context': 'https://schema.org', ...breadcrumbs([['Late Brake', `${SITE}/`], ['Circuits', url]]) };
  return page({
    title: 'Race real circuits free in your browser · Late Brake', type: 'website', url,
    description: 'Six real circuits at true scale, from Monza and Silverstone to Monaco and Interlagos. Learn their history and corners, then race them free online.',
    head: `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
    body: `
  <main class="wrap">
    <h1>The circuits</h1>
    <p class="lead">Six real circuits, laid out at true scale and run in their real direction. Read how each one works, then race it free in your browser.</p>
    <ul class="post-list">
${cards}
    </ul>
  </main>`,
  });
}

// The circuit's outline as an SVG, from the same geometry the game drives on.
function trackSvg(t, name, { small = false } = {}) {
  const [w, h, pad] = small ? [320, 180, 12] : [720, 420, 28];
  const b = t.bounds;
  const sc = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxY - b.minY));
  const ox = (w - (b.maxX - b.minX) * sc) / 2 - b.minX * sc, oy = (h - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
  const X = (x) => (x * sc + ox).toFixed(1), Y = (y) => (y * sc + oy).toFixed(1);
  const step = Math.max(1, Math.floor(t.n / 500));
  const pts = [];
  for (let i = 0; i < t.n; i += step) pts.push(`${X(t.xs[i])},${Y(t.ys[i])}`);
  const d = `M${pts.join('L')}Z`;
  const r = small ? 7 : 13;
  const line = `<line x1="${X(t.xs[0] - t.nx[0] * r / sc)}" y1="${Y(t.ys[0] - t.ny[0] * r / sc)}" x2="${X(t.xs[0] + t.nx[0] * r / sc)}" y2="${Y(t.ys[0] + t.ny[0] * r / sc)}" stroke="#e8112d" stroke-width="${small ? 3 : 5}" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Map of the ${esc(name)} circuit"${small ? ' aria-hidden="true"' : ''}><path d="${d}" fill="none" stroke="#2a2f38" stroke-width="${small ? 7 : 12}" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f3f4f6" stroke-width="${small ? 2.5 : 4}" stroke-linejoin="round"/>${line}</svg>`;
}

// 1:26.5 style, as the game shows medal times.
function lapTime(s) {
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace(/\.0$/, '')}`;
}

function indexPage(list) {
  const cards = list.map((p) => `      <li>
        <a class="post-card${p.image ? ' has-image' : ''}" href="${p.slug}.html">
${p.image ? `          ${photo(p.image, '../media/blog/', '(max-width: 600px) calc(100vw - 82px), 220px')}\n` : ''}          <span class="meta">${KINDS[p.kind]} · <time datetime="${p.iso}">${longDate(p.day)}</time></span>
          <strong>${esc(p.title)}</strong>
          <span>${esc(p.description)}</span>
        </a>
      </li>`).join('\n');
  return page({
    title: 'F1 news, history and fun facts · Late Brake', type: 'website', url: `${SITE}/blog/`,
    description: 'Formula 1 news, race weekend times in India, history, fun facts and what happened on this day in F1.',
    head: `<link rel="alternate" type="application/rss+xml" title="Late Brake blog" href="feed.xml">`,
    body: `
  <main class="wrap">
    <h1>Blog</h1>
    <p class="lead">Formula 1 news, history, fun facts and what happened on this day. When we write about a circuit that's in the game, it's one click away.</p>
    <ul class="post-list">
${cards || '      <li>The first posts are on their way.</li>'}
    </ul>
    <p class="meta"><a href="feed.xml">RSS feed</a></p>
  </main>`,
  });
}

function page({ title, description, url, type, head, body, image = null }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b0d10">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Late Brake">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${image ? `${SITE}/media/blog/${image.file}` : `${SITE}/og.png`}">
  <meta property="og:image:width" content="${image ? image.w : 1200}">
  <meta property="og:image:height" content="${image ? image.h : 630}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../icon-180.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../pages.css">
  ${head}
  <!-- Microsoft Clarity: heatmaps and session recordings -->
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "z47gtgl7zi");
  </script>
</head>
<body>
  <!-- Built by tools/build-blog.mjs from posts/ and content/: edit the Markdown, not this file. -->
  <nav class="nav" aria-label="Main">
    <div class="wrap">
      <a class="logo" href="../">LATE<span>BRAKE</span></a>
      <span class="nav-links"><a href="../circuits/">Circuits</a><a href="../blog/">Blog</a><a class="nav-play" href="../play.html">Play</a></span>
    </div>
  </nav>
${body}

  <footer>
    <div class="wrap">
      <span>Late Brake is an independent game and isn't affiliated with any racing series, team or circuit.</span>
      <nav aria-label="Site">
        <a href="../circuits/">Circuits</a>
        <a href="../blog/">Blog</a>
        <a href="../about.html">About</a>
        <a href="../terms.html">Terms</a>
        <a href="../privacy.html">Privacy</a>
        <a href="../contact.html">Contact</a>
      </nav>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------- feed, site map, home page ----------

function feed(list) {
  const items = list.slice(0, 30).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE}/blog/${p.slug}.html</link>
      <guid>${SITE}/blog/${p.slug}.html</guid>
      <pubDate>${new Date(p.at).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Late Brake blog</title>
    <link>${SITE}/blog/</link>
    <description>Formula 1 news, history, fun facts and what happened on this day.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

function sitemap(list, circuitList) {
  const urls = [
    ...PAGES.map((p) => [p, null]),
    ['/circuits/', null], ...circuitList.map((c) => [`/circuits/${c.slug}.html`, null]),
    ['/blog/', list[0]?.day], ...list.map((p) => [`/blog/${p.slug}.html`, p.day]),
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([path, date]) => `  <url><loc>${SITE}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

// Posts from the last two days in Google's news site map format.
function newsSitemap(list) {
  const recent = list.filter((p) => Date.now() - p.at < NEWS_HOURS * 3600e3);
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${recent.map((p) => `  <url>
    <loc>${SITE}/blog/${p.slug}.html</loc>
    <news:news>
      <news:publication><news:name>Late Brake</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>${p.iso}</news:publication_date>
      <news:title>${esc(p.title)}</news:title>
    </news:news>
  </url>`).join('\n')}
</urlset>
`;
}

// The latest posts as cards between the blog markers in index.html.
function updateHome(latest) {
  const file = new URL('index.html', ROOT);
  const html = readFileSync(file, 'utf8');
  const start = '<!-- blog:start -->', end = '<!-- blog:end -->';
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error('index.html: blog markers missing');
  const section = latest.length ? `
    <section class="wrap" aria-labelledby="blogTitle">
      <h2 id="blogTitle">From the blog</h2>
      <div class="grid">
${latest.map((p) => `        <a class="card post" href="blog/${p.slug}.html">
${p.image ? `          ${photo(p.image, 'media/blog/', '(max-width: 651px) calc(100vw - 40px), (max-width: 963px) calc(50vw - 26px), 340px')}\n` : ''}          <span class="post-date">${KINDS[p.kind]} · ${longDate(p.day)}</span>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.description)}</p>
        </a>`).join('\n')}
      </div>
      <p class="more"><a href="blog/">All posts →</a></p>
    </section>
    ` : '\n    ';
  writeFileSync(file, html.slice(0, a + start.length) + section + html.slice(b));
}

// ---------- helpers ----------

// The photo under the headline, with its caption and credit.
function figure(image) {
  if (!image) return '';
  return `      <figure class="hero-photo">
        ${photo(image, '../media/blog/', '(max-width: 760px) calc(100vw - 40px), 720px', { alt: image.alt, lazy: false })}
        <figcaption>${image.caption ? `${inline(image.caption)} ` : ''}<span class="credit">Photo: ${inline(image.credit)}</span></figcaption>
      </figure>`;
}

// A post photo with its smaller copies, so each browser loads the smallest one
// that fills `sizes` (the width it's shown at) on its screen.
function photo(image, dir, sizes, { alt = '', lazy = true } = {}) {
  const set = [...image.widths.map((w) => `${dir}${sized(image.file, w)} ${w}w`), `${dir}${image.file} ${image.w}w`];
  return `<img src="${dir}${image.file}"${image.widths.length ? ` srcset="${set.join(', ')}" sizes="${sizes}"` : ''} alt="${esc(alt)}" width="${image.w}" height="${image.h}"${lazy ? ' loading="lazy"' : ''}>`;
}

// The name of a photo's smaller copy: antonelli.jpg at 500px is antonelli-500.jpg.
function sized(file, width) {
  return file.replace(/\.jpg$/, `-${width}.jpg`);
}

// Home › section › page, for search results.
function breadcrumbs(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
}

function shareImage(p) {
  return p.image ? `${SITE}/media/blog/${p.image.file}` : `${SITE}/og.png`;
}

// Width and height from a JPEG's frame header, for the <img> tags.
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length; i += 2 + buf.readUInt16BE(i + 2)) {
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
  }
  throw new Error('image is not a JPEG');
}

function write(path, text) {
  writeFileSync(new URL(path, ROOT), text);
}

function longDate(d) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
