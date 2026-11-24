import { cp, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { base, sitePath } from '../src/deployment.mjs';
import { pages } from '../src/pages.ts';

if (base) throw new Error('The Vercel production deployment expects SITE_BASE=/.');

const root = await realpath(new URL('../', import.meta.url));
const vercel = new URL('../.vercel/', import.meta.url);
await mkdir(vercel, { recursive: true });
if (await realpath(vercel) !== join(root, '.vercel')) {
  throw new Error('The Vercel staging directory must be inside the site directory.');
}
const output = new URL('output/', vercel);
const previous = await lstat(output).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) {
  throw new Error('The Vercel staging output must be a regular directory.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output);

const routes = pages.flatMap(({ route }) => {
  const path = sitePath(route);
  const rewrite = { src: `^${path}$`, dest: `${path}index.html` };
  if (route === '/') return [rewrite];
  return [
    { src: `^${path.slice(0, -1)}$`, status: 308, headers: { Location: path } },
    rewrite,
  ];
});

await cp(new URL('../dist/', import.meta.url), new URL('static/', output), { recursive: true });
await writeFile(new URL('config.json', output), JSON.stringify({
  version: 3,
  routes: [
    ...routes,
    { handle: 'filesystem' },
    { src: '/.*', dest: '/404.html', status: 404 },
  ],
}, null, 2) + '\n');
