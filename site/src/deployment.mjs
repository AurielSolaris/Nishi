const configuredBase = process.env.SITE_BASE ?? '/';
if (!/^\/(?:[\w-]+\/)*[\w-]*\/?$/.test(configuredBase) || configuredBase.includes('//')) {
  throw new Error('SITE_BASE must be a URL path such as /nishi/.');
}

export const base = configuredBase.replace(/\/$/, '');
export const site = process.env.SITE_URL || undefined;

if (site) {
  const url = new URL(site);
  if (!['https:', 'http:'].includes(url.protocol) || url.href !== url.origin + '/' ||
      url.username || url.password) {
    throw new Error('SITE_URL must be an HTTP(S) origin. Set its path through SITE_BASE.');
  }
}

/** @param {string} route */
export function sitePath(route) {
  return base + route;
}
