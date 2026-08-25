/**
 * Nishi brand constants.
 *
 * The mark is a blue crescent moon ringed by yellow stars — "nishi"
 * (निशा / নিশি), Sanskrit and Bengali for "night". These values are the single
 * source of truth for the icon generator, the app chrome, and the default
 * theme's accent colors.
 */

export const BRAND = {
  name: "Nishi",
  tagline: "A modern resurrection of Atom",
  identifier: "dev.nishi.editor",
  version: "0.2.1",
  codename: "Core Editor",
} as const;

/** Icon + chrome palette. Keep in sync with src/mainview/index.css tokens. */
export const PALETTE = {
  /** Crescent moon — top to bottom of the gradient. */
  moonFrom: "#7FB3FF",
  moonTo: "#3D7BEB",
  /** Stars. */
  starFrom: "#FFE889",
  starTo: "#FFC93A",
  /** Icon backdrop — deep night sky. */
  skyFrom: "#141D38",
  skyTo: "#080C1A",
  /** App chrome. */
  bg: "#0F1420",
  bgElevated: "#161C2B",
  border: "#242D42",
  text: "#C7D1E4",
  textDim: "#7A879F",
  accent: "#4C8DFF",
} as const;

export type BrandPalette = typeof PALETTE;
