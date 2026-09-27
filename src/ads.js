// Ad inventory. Every board, painted runoff logo and grandstand roof in the
// game draws its creative from here, so sponsors are a data change only.
//
// A creative is either text or an image:
//   { text: 'ACME', bg: '#000000', fg: '#ffffff' }
//   { image: 'ads/acme.png', bg: '#ffffff' }   // path relative to play.html
// Images are drawn to fit the board, keeping their aspect ratio. Boards are
// 12 m × 1.4 m (about 9:1); roof and ground slots are wider and taller.

// Placeholder creatives shown until real sponsors are added.
export const ADS = [
  { text: 'YOUR BRAND HERE', bg: '#ffffff', fg: '#15171b' },
  { text: 'LATE BRAKE', bg: '#e8112d', fg: '#ffffff' },
  { text: 'AD SPACE', bg: '#15171b', fg: '#ffd23f' },
  { text: 'SPONSOR', bg: '#1d4ed8', fg: '#ffffff' },
  { text: 'BRAKE LATER', bg: '#ffd23f', fg: '#15171b' },
];

// Per-circuit inventory for sponsored tracks, keyed by circuit id
// (see src/track.js). When present it replaces ADS on that circuit.
// Example: 'it-1922': [{ text: 'ACME', bg: '#000', fg: '#fff' }],
export const TRACK_ADS = {};

export function adsFor(trackId) {
  const list = TRACK_ADS[trackId];
  return list && list.length ? list : ADS;
}

const images = new Map();
function imageFor(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const widths = new Map();
function textWidth(ctx, text) {
  const key = ctx.font + '|' + text;
  let w = widths.get(key);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

// Draw a creative centered on the current origin, `len` along x and `h`
// along y (meters). `angle` is the slot's world rotation, used to keep text
// reading left-to-right on screen. `painted` = logo painted on the ground:
// no panel, just the brand color.
export function drawAd(ctx, ad, len, h, angle, painted = false) {
  if (!painted) {
    ctx.fillStyle = ad.bg || '#ffffff';
    ctx.fillRect(-len / 2, -h / 2, len, h);
  }
  ctx.save();
  if (Math.cos(angle) < 0) ctx.rotate(Math.PI);

  const img = ad.image ? imageFor(ad.image) : null;
  if (img) {
    const s = Math.min((len * 0.94) / img.naturalWidth, (h * 0.9) / img.naturalHeight);
    const w = img.naturalWidth * s, ih = img.naturalHeight * s;
    ctx.drawImage(img, -w / 2, -ih / 2, w, ih);
  } else if (ad.text) {
    // Canvas text is laid out at 20× and scaled down so tiny world sizes stay crisp.
    const S = 20;
    ctx.scale(1 / S, 1 / S);
    ctx.font = `800 ${Math.round(h * 0.78 * S)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = textWidth(ctx, ad.text), max = len * 0.9 * S;
    if (w > max) ctx.scale(max / w, 1);
    // Painted logos use whichever brand color shows up on dark tarmac.
    ctx.fillStyle = painted ? (luma(ad.bg) > 0.35 ? ad.bg : ad.fg) || '#ffffff' : ad.fg || '#111111';
    ctx.fillText(ad.text, 0, h * 0.05 * S);
  }
  ctx.restore();
}

function luma(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 1;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
