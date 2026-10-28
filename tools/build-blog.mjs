// Builds the blog from Markdown: posts/*.md become blog/<name>.html, plus the
// blog index (blog/index.html), its RSS feed (blog/feed.xml), the site map
// (sitemap.xml), robots.txt and the "From the blog" cards on the home page.
// No dependencies: run `node tools/build-blog.mjs` and commit what it writes.
// A post goes live at its date and time (India time): until then it's left out
// of everything, and the publish-blog GitHub Action rebuilds at 9:00, 12:00,
// 15:00 and 18:00 to put due posts up. `--drafts` builds scheduled posts too,
// for a local look only: never commit that build.
//
// A post starts with front matter:
//   ---
//   title: Antonelli wins in Austin and can be champion in Mexico
//   description: One or two sentences for search results and link previews.
//   date: 2026-10-29 09:00   (India time; a date alone means midnight)
//   kind: news           (news, on-this-day, history or facts)
//   circuit: br-1940     (optional: the game circuit the post's button opens)
//   image: <slug>.jpg    (optional: a JPEG in media/blog/, with alt, caption and credit)
//   alt: What the photo shows, for screen readers.
//   caption: One line under the photo.
//   credit: [Author](https://commons.wikimedia.org/…), CC BY 4.0
//   ---
// then Markdown: ## and ### headings, paragraphs, - and 1. lists, > quotes,
// ---, **bold**, *italic*, `code` and [links](https://…). Files whose names
// start with _ (like _guide.md) aren't posts. Em and en dashes stop the build:
// posts use commas, colons, brackets or "to" instead.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { TRACKS } from '../src/track.js';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://www.latebrake.in';
const PAGES = ['/', '/play.html', '/sponsors.html', '/terms.html', '/privacy.html', '/refunds.html', '/contact.html'];
const HOME_POSTS = 3;
// Kinds of post, in the order same-day posts are listed.
const KINDS = { news: 'News', 'on-this-day': 'On this day', history: 'History', facts: 'Fun facts' };
const kindOrder = (p) => Object.keys(KINDS).indexOf(p.kind);

const DRAFTS = process.argv.includes('--drafts');
// Every post is read (so a bad one fails now, not at its publish time); only due ones are built.
const all = readdirSync(new URL('posts/', ROOT))
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((f) => readPost(f));
const posts = all.filter((p) => DRAFTS || p.at <= Date.now())
  .sort((a, b) => b.at - a.at || kindOrder(a) - kindOrder(b) || a.title.localeCompare(b.title));

mkdirSync(new URL('blog/', ROOT), { recursive: true });
// Pages left over from posts that have been deleted or renamed.
for (const f of readdirSync(new URL('blog/', ROOT))) {
  if (f.endsWith('.html') && f !== 'index.html' && !posts.some((p) => `${p.slug}.html` === f)) rmSync(new URL(`blog/${f}`, ROOT));
}
for (const p of posts) write(`blog/${p.slug}.html`, postPage(p));
write('blog/index.html', indexPage(posts));
write('blog/feed.xml', feed(posts));
write('sitemap.xml', sitemap(posts));
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
updateHome(posts.slice(0, HOME_POSTS));
const waiting = all.length - posts.length;
console.log(`Built ${posts.length} post${posts.length === 1 ? '' : 's'}${waiting ? `; ${waiting} scheduled for later` : ''}.`);
if (DRAFTS) console.log('Scheduled posts are included: this build is for a local look only, don\'t commit it.');

// ---------- reading ----------

function readPost(file) {
  const text = readFileSync(new URL(`posts/${file}`, ROOT), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
  }));
  for (const key of ['title', 'description', 'date', 'kind']) if (!meta[key]) throw new Error(`${file}: no ${key}`);
  if (!KINDS[meta.kind]) throw new Error(`${file}: kind must be one of ${Object.keys(KINDS).join(', ')}`);
  const when = meta.date.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/);
  if (!when) throw new Error(`${file}: date must be YYYY-MM-DD or YYYY-MM-DD HH:MM (India time)`);
  const iso = `${when[1]}T${when[2] || '00:00'}:00+05:30`;
  const track = meta.circuit ? TRACKS.find((t) => t.id === meta.circuit) : null;
  if (meta.circuit && !track) throw new Error(`${file}: unknown circuit ${meta.circuit}`);
  const dash = text.split('\n').findIndex((line) => /[\u2013\u2014]/.test(line));
  if (dash >= 0) throw new Error(`${file}:${dash + 1}: em or en dash; use a comma, colon, brackets or "to"`);
  let image = null;
  if (meta.image) {
    for (const key of ['alt', 'credit']) if (!meta[key]) throw new Error(`${file}: an image needs ${key}`);
    const size = jpegSize(readFileSync(new URL(`media/blog/${meta.image}`, ROOT)));
    image = { file: meta.image, ...size, alt: meta.alt, caption: meta.caption || '', credit: meta.credit };
  }
  const words = m[2].split(/\s+/).filter(Boolean).length;
  return { ...meta, day: when[1], iso, at: Date.parse(iso), slug: file.replace(/\.md$/, ''), track, image, body: markdown(m[2]), minutes: Math.max(1, Math.round(words / 220)) };
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
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: p.title, description: p.description, datePublished: p.iso, dateModified: p.iso,
    author: { '@type': 'Organization', name: 'Late Brake', url: SITE },
    publisher: { '@type': 'Organization', name: 'Late Brake', logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` } },
    image: shareImage(p), mainEntityOfPage: url,
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
${figure(p.image)}
      <div class="post-body">
${p.body}
      </div>
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
      <p>Monza, Spa, Silverstone, Monaco, Interlagos and the Red Bull Ring at true scale. Free in your browser, no install.</p>
      <a class="drive-btn" href="../play.html">Play Late Brake</a>
    </aside>`;
  }
  const time = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace(/\.0$/, '')}`;
  return `    <aside class="drive">
      <p class="kicker">Late Brake</p>
      <h2>Drive ${esc(track.name)} on Late Brake</h2>
      <p>Free in your browser, no install. Bronze at ${time(track.medals[0])}, gold at ${time(track.medals[2])}: how close can you get?</p>
      <a class="drive-btn" href="../play.html?track=${track.id}">Drive it now</a>
    </aside>`;
}

function indexPage(list) {
  const cards = list.map((p) => `      <li>
        <a class="post-card${p.image ? ' has-image' : ''}" href="${p.slug}.html">
${p.image ? `          <img src="../media/blog/${p.image.file}" alt="" width="${p.image.w}" height="${p.image.h}" loading="lazy">\n` : ''}          <span class="meta">${KINDS[p.kind]} · <time datetime="${p.iso}">${longDate(p.day)}</time></span>
          <strong>${esc(p.title)}</strong>
          <span>${esc(p.description)}</span>
        </a>
      </li>`).join('\n');
  return page({
    title: 'Blog · Late Brake', type: 'website', url: `${SITE}/blog/`,
    description: 'Formula 1 news, history, fun facts and what happened on this day, from the makers of Late Brake.',
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
  <!-- Built by tools/build-blog.mjs from posts/: edit the Markdown, not this file. -->
  <nav class="nav" aria-label="Main">
    <div class="wrap">
      <a class="logo" href="../">LATE<span>BRAKE</span></a>
      <span class="nav-links"><a href="./">Blog</a><a class="nav-play" href="../play.html">Play</a></span>
    </div>
  </nav>
${body}

  <footer>
    <div class="wrap">
      <span>Late Brake is an independent game and isn't affiliated with any racing series, team or circuit.</span>
      <nav aria-label="Site">
        <a href="./">Blog</a>
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

function sitemap(list) {
  const urls = [...PAGES.map((p) => [p, null]), ['/blog/', list[0]?.day], ...list.map((p) => [`/blog/${p.slug}.html`, p.day])];
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([path, date]) => `  <url><loc>${SITE}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n')}
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
${p.image ? `          <img src="media/blog/${p.image.file}" alt="" width="${p.image.w}" height="${p.image.h}" loading="lazy">\n` : ''}          <span class="post-date">${KINDS[p.kind]} · ${longDate(p.day)}</span>
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
        <img src="../media/blog/${image.file}" alt="${esc(image.alt)}" width="${image.w}" height="${image.h}">
        <figcaption>${image.caption ? `${inline(image.caption)} ` : ''}<span class="credit">Photo: ${inline(image.credit)}</span></figcaption>
      </figure>`;
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
