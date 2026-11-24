import { site, sitePath } from '../deployment.mjs';

export function GET() {
  const sitemap = site ? `Sitemap: ${new URL(sitePath('/sitemap.xml'), site)}\n` : '';
  return new Response(`User-agent: *\nAllow: /\n${sitemap}`);
}
