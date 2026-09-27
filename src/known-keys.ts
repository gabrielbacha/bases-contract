import { EDITOR_KEY, EDITOR_VIEW_KEY } from "./editor-blocks";
import {
  BASE_VISUALS_KEY,
  LEGACY_BASE_VISUALS_KEY,
  LEGACY_VIEW_COLUMN_APPEARANCE_KEY,
  VIEW_VISUALS_KEY,
} from "./visual-blocks";

/** Root keys of a `.base` file that Obsidian itself defines. */
export const NATIVE_ROOT_KEYS = ["filters", "formulas", "properties", "views", "summaries"] as const;
/** Root keys that editors of Bases add. Obsidian keeps them as they are. */
export const EXTENSION_ROOT_KEYS = [BASE_VISUALS_KEY, EDITOR_KEY] as const;

/** View keys that Obsidian itself defines. */
export const NATIVE_VIEW_KEYS = [
  "type",
  "name",
  "filters",
  "order",
  "sort",
  "limit",
  "groupBy",
  "rowHeight",
  "columnSize",
  "summaries",
] as const;
/**
 * View keys that the two apps add, including keys older releases wrote. The old keys are read,
 * then removed on the next intentional edit.
 */
export const EXTENSION_VIEW_KEYS = [
  VIEW_VISUALS_KEY,
  EDITOR_VIEW_KEY,
  LEGACY_BASE_VISUALS_KEY,
  LEGACY_VIEW_COLUMN_APPEARANCE_KEY,
  "basesVisualsDateFormats",
] as const;

export const KNOWN_ROOT_KEYS: ReadonlySet<string> = new Set([...NATIVE_ROOT_KEYS, ...EXTENSION_ROOT_KEYS]);
export const KNOWN_VIEW_KEYS: ReadonlySet<string> = new Set([...NATIVE_VIEW_KEYS, ...EXTENSION_VIEW_KEYS]);
