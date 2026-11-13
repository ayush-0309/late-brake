// Receives a video from the trailer page (tools/trailer/) and writes it to
// launch/trailer/, which git leaves out. Run it next to the dev server:
//   node tools/trailer/save.mjs        (listens on http://localhost:5174)

import { createServer } from 'node:http';
import { mkdirSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../../launch/trailer/', import.meta.url);
mkdirSync(dir, { recursive: true });

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
  if (req.method !== 'POST' || !/^[\w.-]+\.mp4$/.test(name)) return res.writeHead(400).end('POST an .mp4 with ?name=');
  const path = fileURLToPath(new URL(name, dir));
  req.pipe(createWriteStream(path)).on('finish', () => {
    console.log(`Saved ${path}`);
    res.end('ok');
  });
}).listen(5174, 'localhost', () => console.log('Saving trailers to launch/trailer/ (http://localhost:5174)'));
