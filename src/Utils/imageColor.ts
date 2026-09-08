/**
 * Sample a representative colour from an image (used to auto-set a player's
 * colour from their commander art, so it's not a second thing to configure).
 * Cosmetic and best-effort: any failure (tainted canvas, load error) resolves
 * to null and the caller keeps the existing colour.
 */

const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const computeColor = (img: HTMLImageElement): string | null => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Average, weighted toward saturated pixels and away from near-black/white.
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (pr + pg + pb) / 3;
    if (sat < 0.12 || lum < 24 || lum > 236) continue;
    const w = sat;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }
  if (weight === 0) {
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      weight += 1;
    }
  }
  r /= weight;
  g /= weight;
  b /= weight;

  // Land it in a band that works as a card background and behaves with the
  // existing light/dark contrast logic.
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, clamp(s, 0.4, 0.85), clamp(l, 0.34, 0.56));
};

export const getCachedImageColor = (
  url: string
): string | null | undefined => cache.get(url);

export const sampleImageColor = (url: string): Promise<string | null> => {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let result: string | null = null;
      try {
        result = computeColor(img);
      } catch {
        result = null;
      }
      cache.set(url, result);
      inFlight.delete(url);
      resolve(result);
    };
    img.onerror = () => {
      cache.set(url, null);
      inFlight.delete(url);
      resolve(null);
    };
    img.src = url;
  });

  inFlight.set(url, request);
  return request;
};
