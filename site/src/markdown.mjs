import { sitePath } from './deployment.mjs';

const fenceLanguages = new Map(Object.entries({
  kotlin: 'kotlin', kt: 'kotlin', bash: 'bash', sh: 'bash', shell: 'bash',
  powershell: 'powershell', ps1: 'powershell', json: 'json', yaml: 'yaml',
  yml: 'yaml', lua: 'lua', text: 'text', txt: 'text', plaintext: 'text',
}));

export function prepareMarkdown() {
  return (tree) => {
    function prepare(node) {
      if (node.children) {
        node.children = node.children.filter((child) => child.type !== 'html');
        node.children.forEach(prepare);
      }

      if (node.type === 'code') {
        node.lang = fenceLanguages.get(node.lang?.toLowerCase()) ?? 'text';
        node.meta = null;
      }

      if (typeof node.url === 'string') {
        const url = new URL(node.url, 'https://nishi.invalid/');
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
          throw new Error(`Unsupported Markdown URL protocol: ${url.protocol}`);
        }
        if (node.url.startsWith('/') && !node.url.startsWith('//')) {
          node.url = sitePath(node.url);
        }
      }
    }
    prepare(tree);
  };
}

export function decorateMarkdown() {
  return (tree) => {
    function wrap(node) {
      if (node.type !== 'element') return node;
      if (!['table', 'pre'].includes(node.tagName)) {
        return { ...node, children: node.children.map(wrap) };
      }
      delete node.properties.tabIndex;
      return {
        type: 'element', tagName: 'div',
        properties: {
          className: ['scroll-region'], tabIndex: 0, role: 'region',
          ariaLabel: node.tagName === 'table' ? 'Scrollable table' : 'Scrollable code block',
        },
        children: [node],
      };
    }
    tree.children = tree.children.map(wrap);
  };
}

export const syntaxTheme = {
  name: 'nishi-night',
  type: 'dark',
  colors: {
    'editor.background': 'var(--editor-inset)',
    'editor.foreground': 'var(--text)',
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--syntax-comment)' } },
    { scope: ['keyword', 'storage', 'constant.language'], settings: { foreground: 'var(--syntax-keyword)' } },
    { scope: ['string'], settings: { foreground: 'var(--syntax-string)' } },
    { scope: ['constant.numeric', 'variable', 'support.variable'], settings: { foreground: 'var(--syntax-number)' } },
    { scope: ['entity.name', 'support.function', 'support.type', 'support.type.property-name', 'entity.other.attribute-name'], settings: { foreground: 'var(--syntax-name)' } },
  ],
};
