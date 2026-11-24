import { site, sitePath } from '../deployment.mjs';
import { pages } from '../pages';

export function getStaticPaths() {
  return site ? [{ params: { sitemap: 'sitemap' } }] : [];
}

export function GET() {
  const entries = pages.map(({ route }) => `<url><loc>${new URL(sitePath(route), site)}</loc></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
}
