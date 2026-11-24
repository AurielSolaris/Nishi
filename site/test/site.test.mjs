import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { parse } from 'parse5';
import config from '../astro.config.mjs';
import { base, site, sitePath } from '../src/deployment.mjs';
import { pages, errorPage } from '../src/pages.ts';

const output = process.env.SITE_TEST_OUTPUT ?? 'dist';
const registry = [...pages, errorPage];
const origin = site ?? 'https://nishi.invalid';

function* elements(node) {
  if (node.tagName) yield node;
  for (const child of node.childNodes ?? []) yield* elements(child);
}

function attr(node, name) {
  return node.attrs.find((attribute) => attribute.name === name)?.value;
}

function textContent(node) {
  return node.value ?? (node.childNodes ?? []).map(textContent).join('');
}

function artifact(path) {
  assert.ok(path === sitePath('/') || path.startsWith(base + '/'), `Outside base: ${path}`);
  const relative = path.slice(base.length + 1);
  return join(output, relative, path.endsWith('/') ? 'index.html' : '');
}

test('registry has unique routes, metadata, filenames and Markdown sources', async () => {
  for (const key of ['route', 'filename', 'content', 'order', 'title', 'description']) {
    assert.equal(new Set(registry.map((page) => page[key])).size, registry.length, key);
  }
  assert.deepEqual(registry.map(({ order }) => order), registry.map((_, index) => index + 1));
  assert.deepEqual((await readdir('src/content')).sort(), registry.map(({ content }) => content).sort());
  for (const page of pages) assert.match(page.route, /^\/(?:[a-z-]+\/)*$/);
  assert.equal(pages[0].route, '/');
});

test('static Markdown, navigation, metadata, images, routes and all internal links', async () => {
  const documents = new Map();
  for (const page of registry) {
    const address = sitePath(page.route);
    const html = await readFile(artifact(address), 'utf8');
    documents.set(address, [...elements(parse(html))]);
  }

  for (const page of registry) {
    const address = sitePath(page.route);
    const tags = documents.get(address);
    const find = (name) => tags.find(({ tagName }) => tagName === name);
    const main = find('main');
    const content = [...elements(main)];
    const headings = content.filter(({ tagName }) => /^h[1-6]$/.test(tagName));
    assert.equal(headings.filter(({ tagName }) => tagName === 'h1').length, 1, address);
    assert.ok(headings.every((heading) => attr(heading, 'id')), address);
    assert.equal(new Set(headings.map((heading) => attr(heading, 'id'))).size, headings.length, address);
    assert.ok(content.some(({ tagName }) => tagName === 'p'), address);
    assert.ok(find('title') && textContent(find('title')).includes(page.title), address);
    assert.ok(tags.some((tag) => tag.tagName === 'meta' && attr(tag, 'name') === 'description' &&
      attr(tag, 'content') === page.description), address);
    assert.ok(!find('script'), `Unexpected client script in ${address}`);

    const navs = tags.filter(({ tagName }) => tagName === 'nav');
    for (const nav of navs) {
      const links = [...elements(nav)].filter(({ tagName }) => tagName === 'a');
      const expected = attr(nav, 'aria-label') === 'Page tabs' || page !== errorPage ? [address] : [];
      assert.deepEqual(links.filter((a) => attr(a, 'aria-current') === 'page').map((a) => attr(a, 'href')), expected);
      if (attr(nav, 'aria-label') === 'File explorer') {
        assert.deepEqual(links.map((link) => attr(link, 'href')), pages.map((file) => sitePath(file.route)));
      }
    }

    const canonical = tags.find((tag) => tag.tagName === 'link' && attr(tag, 'rel') === 'canonical');
    assert.equal(canonical && attr(canonical, 'href'), site && page !== errorPage ? new URL(address, site).href : undefined);

    for (const tag of tags) {
      const value = ['a', 'link'].includes(tag.tagName) ? attr(tag, 'href') : attr(tag, 'src');
      if (!value) continue;
      const url = new URL(value, new URL(address, origin));
      if (url.origin !== origin) continue;
      const target = documents.get(url.pathname);
      if (url.hash) {
        assert.ok(target?.some((node) => attr(node, 'id') === decodeURIComponent(url.hash.slice(1))), `${address} → ${value}`);
      } else if (!target) {
        assert.ok((await readFile(artifact(url.pathname))).length, `${address} → ${value}`);
      }
      if (tag.tagName === 'img') {
        assert.ok(Number(attr(tag, 'width')) > 0 && Number(attr(tag, 'height')) > 0);
        assert.notEqual(attr(tag, 'alt'), undefined);
      }
    }
  }

  const home = documents.get(sitePath('/'));
  const screenshot = home.find((tag) => tag.tagName === 'img' && attr(tag, 'src')?.includes('workbench'));
  assert.match(attr(screenshot, 'alt'), /workbench/);
  const docs = documents.get(sitePath('/docs/'));
  for (const name of ['table', 'th', 'ol', 'code', 'pre']) assert.ok(docs.some(({ tagName }) => tagName === name));
  assert.ok(documents.get(sitePath('/benchmarks/')).some(({ tagName }) => tagName === 'blockquote'));
  assert.ok(documents.get(sitePath(errorPage.route)).some((tag) => tag.tagName === 'meta' && attr(tag, 'content') === 'noindex'));

  const robots = await readFile(artifact(sitePath('/robots.txt')), 'utf8');
  assert.match(robots, /User-agent: \*\nAllow: \//);
  if (site) {
    assert.ok(robots.includes(`Sitemap: ${new URL(sitePath('/sitemap.xml'), site)}`));
    const sitemap = await readFile(artifact(sitePath('/sitemap.xml')), 'utf8');
    assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]),
      pages.map(({ route }) => new URL(sitePath(route), site).href));
  } else {
    assert.doesNotMatch(robots, /Sitemap:/);
  }
});

test('Markdown safely highlights the supported languages and escapes plain fallback', async (t) => {
  const { markdown } = config;
  const processor = await createMarkdownProcessor({ ...markdown.processor.options, shikiConfig: markdown.shikiConfig });
  const examples = [
    ['kotlin', 'val x = "test"'], ['bash', 'echo "test"'], ['powershell', '$x = "test"'],
    ['json', '{"x": 1}'], ['yaml', 'x: "test"'], ['lua', 'local x = true'],
  ];
  const fences = examples.map(([language, example]) => ['```' + language, example, '```'].join('\n'));
  const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  fences.push(['```unrecognized-language', payload, '```'].join('\n'));
  const { code } = await processor.render(['# Heading', payload, ...fences].join('\n\n'), {});
  const tags = [...elements(parse(code))];
  assert.ok(!tags.some(({ tagName }) => ['script', 'img'].includes(tagName)));
  const blocks = tags.filter(({ tagName }) => tagName === 'pre');
  for (const [index, [language, example]] of examples.entries()) {
    assert.equal(attr(blocks[index], 'data-language'), language);
    assert.equal(textContent(blocks[index]).trim(), example);
    assert.ok([...elements(blocks[index])].some((tag) => attr(tag, 'style')?.includes('var(--syntax-')), language);
  }
  assert.equal(textContent(blocks.at(-1)).trim(), payload);
  assert.ok(![...elements(blocks.at(-1))].some((tag) => attr(tag, 'style')?.includes('var(--syntax-')));
  assert.match(code, /id="heading"/);
  const loggedError = t.mock.method(console, 'error', () => {});
  await assert.rejects(processor.render('[Unsafe](javascript:alert%281%29)', {}), /Unsupported Markdown URL protocol/);
  loggedError.mock.restore();
});

test('production output contains only public assets and fits first-load budgets', async (t) => {
  const files = await readdir(output, { recursive: true, withFileTypes: true });
  for (const file of files.filter((entry) => entry.isFile())) {
    const name = file.name;
    assert.ok(/^(?:(?:index|404)\.html|robots\.txt|sitemap\.xml|(?:apache|lucide|notice)\.txt|[\w.-]+\.(?:png|webp|css))$/.test(name), name);
  }

  const html = await readFile(artifact(sitePath('/')), 'utf8');
  const tags = [...elements(parse(html))];
  const css = await Promise.all(tags.filter((tag) => tag.tagName === 'link' && attr(tag, 'rel') === 'stylesheet')
    .map((tag) => readFile(artifact(attr(tag, 'href')))));
  const gzip = css.reduce((total, file) => total + gzipSync(file).length, 0);
  const brotli = css.reduce((total, file) => total + brotliCompressSync(file).length, 0);
  assert.equal(tags.filter(({ tagName }) => tagName === 'script').length, 0);
  assert.ok(gzip > 0 && gzip <= 30 * 1024 && brotli <= 30 * 1024);
  t.diagnostic(`Home first load: JavaScript 0 B; CSS ${gzip} B gzip / ${brotli} B Brotli`);
});
