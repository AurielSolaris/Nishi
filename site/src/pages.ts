export interface WorkbenchPage {
  filename: string;
  route: string;
  title: string;
  description: string;
  icon: string;
  language: string;
  content: string;
  order: number;
}

export const repository = 'https://github.com/AurielSolaris/Nishi';

export const pages = [
  { filename: 'home.kt', route: '/', title: 'Nishi — Desktop code editor', description: 'An Atom-inspired desktop code editor built with Kotlin/JVM, with TextMate highlighting and crash recovery for unsaved edits.', icon: 'file-code', language: 'Kotlin', content: 'home.kt.md', order: 1 },
  { filename: 'features.json', route: '/features/', title: 'Editor features', description: 'Explore split views, TextMate syntax highlighting, conflict-aware saves, and draft recovery in the Kotlin editor.', icon: 'file-json', language: 'JSON', content: 'features.json.md', order: 2 },
  { filename: 'docs.md', route: '/docs/', title: 'Documentation', description: 'Open a workspace, choose a language mode, manage drafts, and find Nishi’s Windows keyboard shortcuts.', icon: 'book-open', language: 'Markdown', content: 'docs.md.md', order: 3 },
  { filename: 'download.sh', route: '/download/', title: 'Run from source', description: 'Build and run the Kotlin/JVM editor with the checked-in Gradle wrapper.', icon: 'terminal', language: 'Shell Script', content: 'download.sh.md', order: 4 },
  { filename: 'benchmarks.csv', route: '/benchmarks/', title: 'Benchmarks', description: 'Measurement status and a reproducible protocol for editor startup and memory use.', icon: 'file-text', language: 'CSV', content: 'benchmarks.csv.md', order: 5 },
  { filename: 'roadmap.yaml', route: '/roadmap/', title: 'Roadmap', description: 'See which capabilities are available in the Kotlin rewrite and which are planned.', icon: 'file-cog', language: 'YAML', content: 'roadmap.yaml.md', order: 6 },
  { filename: 'changelog.log', route: '/changelog/', title: 'Changelog', description: 'Verified changes from the Kotlin rewrite and the earlier TypeScript editor.', icon: 'file-text', language: 'Log', content: 'changelog.log.md', order: 7 },
  { filename: 'extensions.lua', route: '/extensions/', title: 'Extensions', description: 'Current extension availability and planned Lua support.', icon: 'file-code', language: 'Lua', content: 'extensions.lua.md', order: 8 },
  { filename: 'privacy.env.local', route: '/privacy/', title: 'Privacy', description: 'What the Nishi website and desktop editor store and access.', icon: 'file-lock', language: 'Environment', content: 'privacy.env.local.md', order: 9 },
  { filename: 'LICENSE', route: '/license/', title: 'Licensing', description: 'Nishi’s Apache-2.0 and MIT component licenses and upstream notices.', icon: 'file-text', language: 'Plain Text', content: 'LICENSE.md', order: 10 },
  { filename: 'CONTRIBUTING.md', route: '/contributing/', title: 'Contributing', description: 'Project modules, Gradle checks, and how to report an issue or propose a change.', icon: 'book-open', language: 'Markdown', content: 'CONTRIBUTING.md.md', order: 11 },
] satisfies WorkbenchPage[];

export const errorPage: WorkbenchPage = {
  filename: '404.err', route: '/404.html', title: 'File not found', description: 'This page is unavailable. Browse the Nishi explorer to find what you need.', icon: 'file', language: 'Plain Text', content: '404.err.md', order: 12,
};
