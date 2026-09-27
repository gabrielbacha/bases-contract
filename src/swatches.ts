/** A named colour offered in a colour picker. */
export interface Swatch {
  name: string;
  hex: string;
}

/** Text colours for formatting rules, strong enough to read on any row. */
export const RULE_TEXT_SWATCHES: readonly Swatch[] = [
  { name: "Red", hex: "#C62828" },
  { name: "Orange", hex: "#D9730D" },
  { name: "Yellow", hex: "#A37B00" },
  { name: "Green", hex: "#2E7D32" },
  { name: "Blue", hex: "#1F6FD1" },
  { name: "Purple", hex: "#7B3FE4" },
  { name: "Pink", hex: "#C2185B" },
  { name: "Grey", hex: "#6B6B6B" },
];

/**
 * Pale fills for formatting rules: light versions of the text colours, shown at full strength.
 * Blocks older than the opacity contract saved these without an opacity, meaning 100.
 */
export const RULE_FILL_SWATCHES: readonly Swatch[] = [
  { name: "Red", hex: "#FDE2E1" },
  { name: "Orange", hex: "#FDE9D7" },
  { name: "Yellow", hex: "#FBF3C9" },
  { name: "Green", hex: "#DFF3E3" },
  { name: "Blue", hex: "#DDE9FB" },
  { name: "Purple", hex: "#EBE3FB" },
  { name: "Pink", hex: "#FBE1EE" },
  { name: "Grey", hex: "#ECECEC" },
];
