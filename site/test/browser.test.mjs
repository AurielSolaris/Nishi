import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'astro';
import { chromium } from 'playwright-core';
import { pages } from '../src/pages.ts';

const require = createRequire(import.meta.url);
let server;
let browser;
let origin;

before(async () => {
  if (process.env.SITE_PREVIEW_ORIGIN) {
    origin = process.env.SITE_PREVIEW_ORIGIN;
  } else {
    server = await preview({ server: { host: '127.0.0.1', port: 49237 } });
    origin = `http://127.0.0.1:${server.port}`;
  }
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: 'msedge' });
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

test('deep links, refresh, back, forward and real 404 without JavaScript', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 950 } });
  try {
    const page = await context.newPage();
    for (const entry of pages) {
      assert.equal((await page.goto(origin + entry.route)).status(), 200, entry.route);
      assert.equal((await page.reload()).status(), 200, entry.route);
      assert.equal(await page.locator('main h1').count(), 1);
      for (const label of ['File explorer', 'Page tabs']) {
        const active = page.getByRole('navigation', { name: label }).locator('[aria-current="page"]');
        assert.equal(await active.getAttribute('href'), entry.route);
      }
    }
    await page.goto(origin);
    await page.getByRole('link', { name: 'Read the docs' }).click();
    await page.getByRole('link', { name: 'download.sh' }).first().click();
    assert.equal(new URL(page.url()).pathname, '/download/');
    await page.goBack();
    assert.equal(new URL(page.url()).pathname, '/docs/');
    await page.goForward();
    assert.equal(new URL(page.url()).pathname, '/download/');
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('navigation', { name: 'Page tabs' }).getByText('docs.md').click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await newTab.waitForURL(origin + '/docs/');
    assert.equal(await newTab.locator('main h1').innerText(), 'Documentation');

    assert.equal((await page.goto(origin + '/does-not-exist/')).status(), 404);
    assert.equal(await page.locator('h1').innerText(), 'File not found');
    assert.equal((await page.goto(origin + '/.env.local')).status(), 404);
    assert.equal((await page.goto(origin + '/.git/config')).status(), 404);
  } finally {
    await context.close();
  }
});

for (const width of [320, 768, 1440]) {
  test(`responsive layout, keyboard controls and reduced motion at ${width}px`, async () => {
    const context = await browser.newContext({
      javaScriptEnabled: false, reducedMotion: 'reduce', viewport: { width, height: 940 },
    });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
      const skip = page.getByRole('link', { name: 'Skip to content' });
      assert.equal(await skip.evaluate((link) => getComputedStyle(link).outlineStyle), 'solid');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');

      const menu = page.locator('.mobile-explorer summary');
      if (width <= 768) {
        assert.ok(await menu.isVisible());
        assert.equal(await page.getByRole('navigation', { name: 'File explorer' }).count(), 0);
        await menu.focus();
        await page.keyboard.press('Space');
        assert.equal(await page.getByRole('navigation', { name: 'File explorer' }).count(), 1);
        await page.getByRole('link', { name: 'features.json' }).press('Enter');
        assert.equal(new URL(page.url()).pathname, '/features/');
        assert.equal(await page.locator('.mobile-explorer').getAttribute('open'), null);
      } else {
        assert.ok(!(await menu.isVisible()));
        assert.ok(await page.getByRole('navigation', { name: 'File explorer' }).isVisible());
      }

      for (const entry of pages) {
        await page.goto(origin + entry.route);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), entry.route);
        const active = page.getByRole('navigation', { name: 'Page tabs' }).locator('[aria-current]');
        assert.equal(await active.evaluate((link) => getComputedStyle(link).transitionDuration), '0s');
        assert.ok(await active.evaluate((link) => link.getBoundingClientRect().right <= innerWidth), entry.route);
      }

      await page.goto(origin + '/benchmarks/');
      const region = page.getByRole('region', { name: 'Scrollable table' });
      assert.ok(await region.isVisible());
      if (width === 320) {
        assert.ok(await region.evaluate((node) => node.scrollWidth > node.clientWidth));
        await region.focus();
        assert.ok(await region.evaluate((node) => document.activeElement === node));
        await page.keyboard.press('ArrowRight');
        for (let attempt = 0; attempt < 10 && await region.evaluate((node) => !node.scrollLeft); attempt++) {
          await delay(50);
        }
        assert.ok(await region.evaluate((node) => node.scrollLeft > 0));
      }
      if (process.env.SITE_TEST_SCREENSHOTS) {
        await mkdir('.test-output', { recursive: true });
        await page.goto(origin);
        await page.locator('img[alt*="workbench"]').evaluate((image) => image.decode());
        await page.screenshot({ path: `.test-output/home-${width}.png` });
      }
    } finally {
      await context.close();
    }
  });
}

test('automated accessibility audit for all pages and the open mobile explorer', async () => {
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  try {
    for (const route of [...pages.map((entry) => entry.route), '/does-not-exist/']) {
      await page.goto(origin + route);
      await page.locator('.mobile-explorer summary').click();
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => {
        const results = await window.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
      });
      assert.deepEqual(violations, [], route);
    }
  } finally {
    await page.close();
  }
});
