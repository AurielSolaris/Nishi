/**
 * SCSS loader for Bun's bundler.
 *
 * Lets index.html link styles/index.scss directly, so SCSS is the only
 * stylesheet abstraction in the tree — no generated .css file to keep in sync.
 */

import type { BunPlugin } from "bun";
import { compile } from "sass";

const sassPlugin: BunPlugin = {
  name: "nishi-scss",
  setup(build) {
    build.onLoad({ filter: /\.scss$/ }, (args) => {
      const result = compile(args.path, { style: "expanded", sourceMap: false });
      return { contents: result.css, loader: "css" };
    });
  },
};

export default sassPlugin;
