import { normalizeHex, resolveRuleColor } from "./colors";

/**
 * A column's text style, shared by every app that shows a Base: the tone of its values' text,
 * whether they are bold, and (optionally) how its cells align. It is stored in `basesStudio` as a
 * property's `style` (every view) or as a view's `columns[id].style` (that view only, which wins).
 */
export const COLUMN_TONES = ["default", "muted", "faint", "custom"] as const;
export type ColumnTone = (typeof COLUMN_TONES)[number];
/** How a column's cells align; without one, each app aligns by the column's type (numbers right). */
export const COLUMN_ALIGNMENTS = ["left", "center", "right"] as const;
export type ColumnAlignment = (typeof COLUMN_ALIGNMENTS)[number];

export interface ColumnAppearance {
  /** default: normal text; muted: secondary text; faint: the faintest text; custom: `color`. */
  tone: ColumnTone;
  bold: boolean;
  /** The text colour of a custom tone, as `#RRGGBB`. */
  color?: string;
  /** The cells' alignment, when it overrides the one the column's type gives. */
  align?: ColumnAlignment;
}

export const DEFAULT_COLUMN_APPEARANCE: ColumnAppearance = Object.freeze({ tone: "default", bold: false });

/** How strongly pills show in a muted or faint column (their opacity), so they recede with the text. */
export const COLUMN_TONE_OPACITY: Readonly<Record<"muted" | "faint", number>> = Object.freeze({
  muted: 0.82,
  faint: 0.62,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored appearance read leniently: an unknown tone is the default one, and a custom tone
 * without a valid colour is the default one too.
 */
export function normalizeColumnAppearance(value: unknown): ColumnAppearance {
  if (!isRecord(value)) return { ...DEFAULT_COLUMN_APPEARANCE };
  const tone: ColumnTone =
    value.tone === "muted" || value.tone === "faint" || value.tone === "custom" ? value.tone : "default";
  const color = tone === "custom" && typeof value.color === "string" ? normalizeHex(value.color) : null;
  const align = COLUMN_ALIGNMENTS.find((item) => item === value.align);
  return {
    tone: tone === "custom" && !color ? "default" : tone,
    bold: value.bold === true,
    ...(color ? { color } : {}),
    ...(align ? { align } : {}),
  };
}

/** Whether an appearance changes nothing (such an entry is removed rather than saved). */
export function isDefaultColumnAppearance(appearance: ColumnAppearance): boolean {
  return appearance.tone === "default" && !appearance.bold && !appearance.align;
}

/**
 * The appearance a column shows in a view: the view's own entry when it has one, otherwise the
 * Base's. `scope` says where it came from (null: neither has one).
 */
export function resolveColumnAppearance(
  propertyId: string,
  baseAppearances: Record<string, unknown> | undefined,
  viewAppearances: Record<string, unknown> | undefined,
): { appearance: ColumnAppearance; scope: "view" | "base" | null } {
  if (viewAppearances && Object.prototype.hasOwnProperty.call(viewAppearances, propertyId))
    return { appearance: normalizeColumnAppearance(viewAppearances[propertyId]), scope: "view" };
  if (baseAppearances && Object.prototype.hasOwnProperty.call(baseAppearances, propertyId))
    return { appearance: normalizeColumnAppearance(baseAppearances[propertyId]), scope: "base" };
  return { appearance: { ...DEFAULT_COLUMN_APPEARANCE }, scope: null };
}

/**
 * A custom tone's text colour for light and dark themes: the chosen colour, adjusted where it
 * would be hard to read on that theme's background. Null for the other tones.
 */
export function columnAppearanceColors(appearance: ColumnAppearance): { light: string; dark: string } | null {
  if (appearance.tone !== "custom" || !appearance.color) return null;
  const resolved = resolveRuleColor(appearance.color);
  return { light: resolved.foregroundLight, dark: resolved.foregroundDark };
}

/** "Muted + Bold + Center", "Custom", "Default": a short summary for menus. */
export function describeColumnAppearance(appearance: ColumnAppearance): string {
  const title = (word: string): string => word[0]!.toUpperCase() + word.slice(1);
  const tone = appearance.tone === "default" ? "" : title(appearance.tone);
  const align = appearance.align ? title(appearance.align) : "";
  return [tone, appearance.bold ? "Bold" : "", align].filter(Boolean).join(" + ") || "Default";
}
