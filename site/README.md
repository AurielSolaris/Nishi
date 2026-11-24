# Nishi website

The marketing and documentation workbench uses Astro, TypeScript and SCSS. Run the following commands from `site/` with Node.js 22.12 or newer. Keep this directory in the Nishi checkout so the build can use the original desktop icon, Lucide icons, notices, and workbench screenshot.

```sh
npm ci
npm run dev
npm run check
npm run build
npm test
npm run test:browser
```

`npm run check` runs Astro diagnostics and TypeScript checks. The output checks read `dist/` and verify registry integrity, generated Markdown, links and assets, safe highlighting, metadata and the compressed CSS and JavaScript budgets. The browser checks use Microsoft Edge by default. Set `BROWSER_EXECUTABLE` to the path of another Chromium executable when needed. Set `SITE_TEST_SCREENSHOTS=1` to save desktop, tablet and phone screenshots under `.test-output/`. Use `npm run preview` to preview the built site manually.

## Update content

- Edit the Markdown files in `src/content/`. Their final `.md` extension selects the parser. Changing a displayed filename does not change the Markdown format.
- To add a page, add its Markdown file and register its route, filename, title, description, icon, display language and order in `src/pages.ts`. The registry supplies the routes, explorer and sitemap. Provide one level-one heading, and keep existing heading text stable where other pages link to it.
- Write internal links as root-relative URLs using the registered routes. Use relative filesystem paths for local Markdown images and include descriptive alt text. The build rewrites internal root-relative links for the configured base path and emits optimized images with dimensions.
- Supported fence languages are Kotlin, Bash, PowerShell, JSON, YAML, Lua and plain text. Other fences become plain text. Raw HTML is stripped and unsupported URL schemes fail the build.
- The explorer and tabs use native links. Home, docs and download are always available in the tab strip alongside the current page. The mobile explorer uses native disclosure. The site ships zero client JavaScript and stores no tab preferences.

## Build for a host

`npm run build` generates `dist/`. Set the build environment variable `SITE_URL` to the public HTTP(S) origin to enable canonical URLs and the sitemap. Set `SITE_BASE` to a URL prefix such as `/nishi/` when mounting the site below the host root. Place the output at that prefix. Serve directory indexes and configure the host to return `404.html` with HTTP 404 for missing routes. On a shared host, its root `robots.txt` should point at the site’s sitemap.

The Vercel production origin is `https://nishi-kt.vercel.app`. Use that origin as `SITE_URL` and leave `SITE_BASE` at its root default. Link this directory once with `vercel link --project nishi-kt`. Run `npm run build`, then `npm run package:vercel` and `vercel deploy --prebuilt --prod`. The package includes the static build with explicit directory routes and a 404 fallback. Set `SITE_PREVIEW_ORIGIN` to the deployed origin to run the same browser checks against production.
