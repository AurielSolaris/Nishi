/**
 * Nishi icon generator.
 *
 * Renders assets/icon.png (512px), assets/icon.ico (Windows, 16-256px) and
 * assets/icon.svg from one parametric description of the mark: a blue crescent
 * moon with yellow stars around it, on a deep night-sky backdrop.
 *
 * Dependency-free: shapes are sampled with 4x supersampling and the result is
 * encoded as PNG with node:zlib. Run with `bun run icon`.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { PALETTE } from "../src/core/branding.ts";

// ---------------------------------------------------------------- geometry --
// All coordinates are normalized to a unit square so the mark scales cleanly.

const BACKDROP_RADIUS = 0.215;

const MOON = {
  // Full disc...
  outer: { x: 0.5, y: 0.505, r: 0.315 },
  // ...minus this offset disc, leaving a crescent opening to the upper right.
  cut: { x: 0.635, y: 0.395, r: 0.285 },
};

type Star = { x: number; y: number; r: number; rot: number };

const STARS: Star[] = [
  { x: 0.8, y: 0.2, r: 0.075, rot: 0 },
  { x: 0.245, y: 0.2, r: 0.052, rot: 0.35 },
  { x: 0.875, y: 0.545, r: 0.045, rot: -0.2 },
  { x: 0.735, y: 0.845, r: 0.058, rot: 0.15 },
  { x: 0.155, y: 0.66, r: 0.038, rot: -0.3 },
  { x: 0.4, y: 0.115, r: 0.03, rot: 0.2 },
];

/** Inner-to-outer radius ratio of the five-pointed stars. */
const STAR_INNER = 0.4;

// ------------------------------------------------------------------ colors --

type RGB = [number, number, number];

function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const SKY_FROM = hex(PALETTE.skyFrom);
const SKY_TO = hex(PALETTE.skyTo);
const MOON_FROM = hex(PALETTE.moonFrom);
const MOON_TO = hex(PALETTE.moonTo);
const STAR_FROM = hex(PALETTE.starFrom);
const STAR_TO = hex(PALETTE.starTo);

// ------------------------------------------------------------ shape tests ---

function inCircle(px: number, py: number, c: { x: number; y: number; r: number }): boolean {
  const dx = px - c.x;
  const dy = py - c.y;
  return dx * dx + dy * dy <= c.r * c.r;
}

/** Rounded-square backdrop covering the whole canvas. */
function inBackdrop(px: number, py: number): boolean {
  const r = BACKDROP_RADIUS;
  const cx = Math.min(Math.max(px, r), 1 - r);
  const cy = Math.min(Math.max(py, r), 1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Precomputed 10-vertex polygon for each star, plus a bounding box. */
type StarPoly = {
  pts: [number, number][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function buildStar(s: Star): StarPoly {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? s.r : s.r * STAR_INNER;
    const angle = -Math.PI / 2 + s.rot + (i * Math.PI) / 5;
    pts.push([s.x + Math.cos(angle) * radius, s.y + Math.sin(angle) * radius]);
  }
  return { pts, minX: s.x - s.r, maxX: s.x + s.r, minY: s.y - s.r, maxY: s.y + s.r };
}

const STAR_POLYS = STARS.map(buildStar);

function inPolygon(px: number, py: number, poly: StarPoly): boolean {
  if (px < poly.minX || px > poly.maxX || py < poly.minY || py > poly.maxY) return false;
  const pts = poly.pts;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// -------------------------------------------------------------- rendering ---

const SS = 4; // supersampling factor per axis

function render(size: number): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  const half = step / 2;
  const samples = SS * SS;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px * SS + sx) * step + half;
          const uy = (py * SS + sy) * step + half;

          if (!inBackdrop(ux, uy)) continue;

          // Painter's order: sky, then moon, then stars on top.
          let c = mix(SKY_FROM, SKY_TO, uy);

          if (inCircle(ux, uy, MOON.outer) && !inCircle(ux, uy, MOON.cut)) {
            const t = (uy - (MOON.outer.y - MOON.outer.r)) / (MOON.outer.r * 2);
            c = mix(MOON_FROM, MOON_TO, Math.min(Math.max(t, 0), 1));
          }

          for (const poly of STAR_POLYS) {
            if (inPolygon(ux, uy, poly)) {
              const t = (uy - poly.minY) / (poly.maxY - poly.minY);
              c = mix(STAR_FROM, STAR_TO, Math.min(Math.max(t, 0), 1));
              break;
            }
          }

          r += c[0];
          g += c[1];
          b += c[2];
          covered++;
        }
      }

      if (covered === 0) continue;

      // Average color over covered samples only; coverage drives alpha.
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round((covered / samples) * 255);
    }
  }

  return rgba;
}

// ----------------------------------------------------------- PNG encoding ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba: Buffer, size: number): Buffer {
  const stride = size * 4;
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------- ICO encoding ---

/** Vista-era ICO: each directory entry holds a complete PNG. */
function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 encodes 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette entries
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ----------------------------------------------------------- SVG emission ---

function svg(): string {
  const pct = (n: number) => +(n * 100).toFixed(3);
  const starPath = (poly: StarPoly) =>
    poly.pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${pct(x)} ${pct(y)}`).join(" ") + " Z";

  const stops = (id: string, from: string, to: string) =>
    `    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">\n` +
    `      <stop offset="0" stop-color="${from}"/>\n` +
    `      <stop offset="1" stop-color="${to}"/>\n` +
    `    </linearGradient>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" role="img" aria-label="Nishi">
  <title>Nishi</title>
  <defs>
${stops("sky", PALETTE.skyFrom, PALETTE.skyTo)}
${stops("moon", PALETTE.moonFrom, PALETTE.moonTo)}
${stops("star", PALETTE.starFrom, PALETTE.starTo)}
    <mask id="crescent">
      <circle cx="${pct(MOON.outer.x)}" cy="${pct(MOON.outer.y)}" r="${pct(MOON.outer.r)}" fill="#fff"/>
      <circle cx="${pct(MOON.cut.x)}" cy="${pct(MOON.cut.y)}" r="${pct(MOON.cut.r)}" fill="#000"/>
    </mask>
  </defs>
  <rect x="0" y="0" width="100" height="100" rx="${pct(BACKDROP_RADIUS)}" fill="url(#sky)"/>
  <circle cx="${pct(MOON.outer.x)}" cy="${pct(MOON.outer.y)}" r="${pct(MOON.outer.r)}" fill="url(#moon)" mask="url(#crescent)"/>
${STAR_POLYS.map((p) => `  <path d="${starPath(p)}" fill="url(#star)"/>`).join("\n")}
</svg>
`;
}

// --------------------------------------------------------------------- run --

mkdirSync("assets", { recursive: true });

const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const cache = new Map<number, Buffer>();

function pngFor(size: number): Buffer {
  let png = cache.get(size);
  if (!png) {
    png = encodePng(render(size), size);
    cache.set(size, png);
  }
  return png;
}

const main = pngFor(512);
await Bun.write("assets/icon.png", main);
await Bun.write("assets/icon.ico", encodeIco(ICO_SIZES.map((size) => ({ size, png: pngFor(size) }))));
await Bun.write("assets/icon.svg", svg());

console.log(`assets/icon.png  ${(main.length / 1024).toFixed(1)} KB  512x512`);
console.log(`assets/icon.ico  contains ${ICO_SIZES.join(", ")}`);
console.log("assets/icon.svg  vector source");
