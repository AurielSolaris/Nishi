import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import { base, site } from './src/deployment.mjs';
import { prepareMarkdown, decorateMarkdown, syntaxTheme } from './src/markdown.mjs';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  markdown: {
    processor: unified({
      remarkPlugins: [prepareMarkdown],
      rehypePlugins: [decorateMarkdown],
    }),
    shikiConfig: { theme: syntaxTheme, wrap: false },
  },
});
