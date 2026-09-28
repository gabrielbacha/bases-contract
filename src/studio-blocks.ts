import { encodeOptionKey, normalizeHex, normalizePaletteTemplateId, normalizePresetName } from "./colors";
import { normalizeColumnAppearance, type ColumnAppearance } from "./column-appearance";
import { isRecord, normalizeOverride, normalizePropertyStrategy } from "./normalize";
import { optionAccent, type PillColorContext } from "./pill-colors";
import { normalizeRule } from "./rules";
import type {
  ColorOverride,
  ConditionalRule,
  PaletteTemplateId,
  PropertyColorStrategy,
  RuleScope,
  StoredOption,
} from "./types";
import { equalValues } from "./value-equality";
import { patchYamlMap, readYamlMap } from "./yaml-patch";

/**
 * Everything both apps add to a `.base` file lives in one block named `basesStudio`: at the root
 * for the whole Base, and inside each native view for that view. Obsidian's own keys (`filters`,
 * `formulas`, `properties`, `summaries`, `views`) are never copied into it.
 */
export const STUDIO_KEY = "basesStudio";
/** The version written at the root. A higher version is read, but never rewritten. */
export const STUDIO_VERSION = 1;

/** Root blocks written before `basesStudio`. They are read, and removed on the next intentional save. */
export const LEGACY_EDITOR_KEY = "basesEditor";
export const LEGACY_VISUALS_KEY = "basesVisuals";
/** View blocks written before `basesStudio`. */
export const LEGACY_EDITOR_VIEW_KEY = "basesEditorView";
export const LEGACY_VISUALS_VIEW_KEY = "basesVisualsView";
/** Older plugin releases copied the Base-wide visuals block into every view under this key. */
export const LEGACY_BASE_VISUALS_KEY = "basesVisualsBase";
/** Older plugin releases kept view column appearance under this key. */
export const LEGACY_VIEW_COLUMN_APPEARANCE_KEY = "basesVisualsColumnAppearance";
export const LEGACY_ROOT_KEYS = [LEGACY_EDITOR_KEY, LEGACY_VISUALS_KEY] as const;
export const LEGACY_VIEW_KEYS = [
  LEGACY_EDITOR_VIEW_KEY,
  LEGACY_VISUALS_VIEW_KEY,
  LEGACY_BASE_VISUALS_KEY,
  LEGACY_VIEW_COLUMN_APPEARANCE_KEY,
] as const;

/**
 * The newest versions of the old blocks this contract understands; newer ones are never migrated.
 * An old per-view copy of the Base's block carried whatever version its release had, and is read
 * whatever its version.
 */
const LEGACY_VERSIONS: Readonly<Record<string, number>> = {
  [LEGACY_EDITOR_KEY]: 1,
  [LEGACY_VISUALS_KEY]: 8,
  [LEGACY_EDITOR_VIEW_KEY]: 2,
  [LEGACY_VISUALS_VIEW_KEY]: 3,
};

/**
 * One option of a property. `color` is a palette preset name, an accent `#RRGGBB`, or `none`
 * (pills of this value are not coloured).
 */
export interface StudioOption {
  value: string;
  label?: string;
  color?: string;
  /** Where the option stands in a workflow (`STATUS_CATEGORIES`); used for display, never for filters. */
  category?: string;
  [key: string]: unknown;
}

/** How a property's values show as pills. */
export interface StudioPills {
  mode?: string;
  preset?: string;
  style?: string;
  wrap?: boolean;
  [key: string]: unknown;
}

/**
 * Everything about one property in a Base. A record with `options` and no `type` only colours
 * values; the type is then inferred. Display settings (`numberFormat`, `currency`, …) are flat keys.
 */
export interface StudioProperty {
  type?: string;
  itemType?: string;
  options?: StudioOption[];
  pills?: StudioPills;
  /** The column's text style in every view (`ColumnAppearance`, stored sparsely). */
  style?: Record<string, unknown>;
  /** The value a new record gets. */
  default?: unknown;
  /**
   * For a link property: the vault path of the Base whose records its links point to
   * (`Projects/Projects.base`). The values stay ordinary wiki links; see `studioLinkTarget`.
   */
  linkTarget?: string;
  [key: string]: unknown;
}

/** The root `basesStudio` block. */
export interface StudioBase {
  version?: number;
  palette?: string;
  properties?: Record<string, StudioProperty>;
  /** Base rules; they apply before the rules of a view. */
  rules?: unknown[];
  detailLayouts?: Record<string, unknown>;
  tableUi?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One column's settings in one view. */
export interface StudioColumn {
  wrap?: boolean;
  /** The column's text style in this view; it wins over the property's `style`. */
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The `basesStudio` block of one view. */
export interface StudioView {
  id?: string;
  renderer?: string;
  columns?: Record<string, StudioColumn>;
  /** View rules; they apply after the Base rules. */
  rules?: unknown[];
  [key: string]: unknown;
}

export type BlockWriteResult<T> =
  | { status: "saved"; source: string; persisted: T }
  | { status: "conflict"; source: string; paths: string[] }
  | { status: "read-only"; source: string; reason: string };

export type MigrationResult =
  | { status: "unchanged" | "migrated"; source: string }
  | { status: "read-only"; source: string; reason: string };

// ─── Reading ────────────────────────────────────────────────────────────────

/** Whether a root block was written by a newer contract; it is read, but never rewritten. */
export function isNewerStudio(block: unknown): boolean {
  return isRecord(block) && typeof block.version === "number" && block.version > STUDIO_VERSION;
}

/**
 * The root block of a parsed Base. Without a `basesStudio` block it is built from the old blocks,
 * so a file that was not yet migrated reads the same. Opening a file never changes it.
 */
export function readStudioBase(root: unknown): StudioBase {
  if (!isRecord(root)) return {};
  if (isRecord(root[STUDIO_KEY])) return structuredClone(root[STUDIO_KEY]) as StudioBase;
  return legacyStudioBase(root);
}

/** The block of one parsed view (`views[i]`), from `basesStudio` or else from the old view blocks. */
export function readStudioView(view: unknown): StudioView {
  if (!isRecord(view)) return {};
  if (isRecord(view[STUDIO_KEY])) return structuredClone(view[STUDIO_KEY]) as StudioView;
  return legacyStudioView(view);
}

/** One property's record (empty when the Base has none). */
export function studioProperty(block: StudioBase, propertyId: string): StudioProperty {
  const property = block.properties?.[propertyId];
  return isRecord(property) ? property : {};
}

/** The palette the Base chose. */
export function studioPalette(block: StudioBase): PaletteTemplateId | undefined {
  return typeof block.palette === "string" ? normalizePaletteTemplateId(block.palette) : undefined;
}

/** The options of a property, read leniently (a plain string is an option with that value). */
export function studioOptions(property: StudioProperty): StudioOption[] {
  if (!Array.isArray(property.options)) return [];
  return property.options.flatMap((option): StudioOption[] => {
    if (typeof option === "string") return option ? [{ value: option }] : [];
    if (!isRecord(option) || typeof option.value !== "string" || !option.value) return [];
    return [option as StudioOption];
  });
}

/**
 * The Base a link property points to: its vault path, with `/` separators and no leading slash,
 * ending in `.base`. Undefined when the property has no target or the path is not a safe vault path
 * (absolute on Windows, or with `.` or `..` segments).
 */
export function studioLinkTarget(property: StudioProperty): string | undefined {
  const raw = property.linkTarget;
  if (typeof raw !== "string") return undefined;
  const path = raw.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!/\.base$/i.test(path) || /^[a-z]:/i.test(path)) return undefined;
  const segments = path.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..") ? path : undefined;
}

/**
 * Where an option stands in a workflow, as ClickUp groups statuses: not started, in progress, or
 * finished. Apps use it to collapse finished board columns and to count progress. Filters never use
 * it: Obsidian cannot read it, so a filter lists the option values themselves.
 */
export const STATUS_CATEGORIES = ["todo", "active", "done"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];
export const STATUS_CATEGORY_LABELS: Readonly<Record<StatusCategory, string>> = {
  todo: "To do",
  active: "In progress",
  done: "Done",
};

/** An option's workflow category, or undefined when it has none (or an unknown one). */
export function optionCategory(option: Pick<StudioOption, "category">): StatusCategory | undefined {
  return STATUS_CATEGORIES.find((category) => category === option.category);
}

/** Whether a property's options have workflow categories (at least one option has one). */
export function hasStatusCategories(property: StudioProperty): boolean {
  return studioOptions(property).some((option) => optionCategory(option) !== undefined);
}

/** Whether a declared type shows its values as pills. */
export function isOptionType(type: string | undefined): boolean {
  return type === "select" || type === "multiSelect";
}

/** An option `color` as the override the colour resolver reads. */
export function optionColorOverride(color: unknown): ColorOverride | undefined {
  if (typeof color !== "string" || !color) return undefined;
  if (color === "none") return { kind: "disabled" };
  const hex = normalizeHex(color);
  if (hex) return { kind: "custom", hex };
  const name = normalizePresetName(color);
  return name ? { kind: "preset", name } : undefined;
}

/** The option `color` that stores an override. */
export function overrideOptionColor(override: ColorOverride): string {
  if (override.kind === "disabled") return "none";
  return override.kind === "custom" ? override.hex : override.name;
}

/** The colour overrides of every property, keyed by `encodeOptionKey`, as the resolver reads them. */
export function studioOverrides(block: StudioBase): Record<string, StoredOption> {
  const result: Record<string, StoredOption> = {};
  for (const [propertyId, property] of Object.entries(block.properties ?? {})) {
    if (!isRecord(property)) continue;
    for (const option of studioOptions(property)) {
      const override = optionColorOverride(option.color);
      if (!override) continue;
      const stored: StoredOption = { propertyId, value: option.value, override };
      result[encodeOptionKey(stored)] = stored;
    }
  }
  return result;
}

/** A property's pill strategy, as the colour resolver reads it. */
export function pillsStrategy(pills: unknown): PropertyColorStrategy | undefined {
  if (!isRecord(pills)) return undefined;
  const strategy = normalizePropertyStrategy({ ...pills, mode: pills.mode ?? "smart", wrapPills: pills.wrap });
  if (!strategy || (strategy.mode === "smart" && !strategy.style && !strategy.wrapPills)) return undefined;
  return strategy;
}

/** The `pills` record that stores a strategy (null: nothing to store). */
export function strategyPills(strategy: PropertyColorStrategy | undefined): StudioPills | null {
  if (!strategy) return null;
  const pills: StudioPills = {};
  if (strategy.mode !== "smart") pills.mode = strategy.mode;
  if (strategy.preset) pills.preset = strategy.preset;
  if (strategy.style && strategy.style !== "soft") pills.style = strategy.style;
  if (strategy.wrapPills) pills.wrap = true;
  return Object.keys(pills).length ? pills : null;
}

/** Every property's pill strategy. */
export function studioStrategies(block: StudioBase): Record<string, PropertyColorStrategy> {
  const result: Record<string, PropertyColorStrategy> = {};
  for (const [propertyId, property] of Object.entries(block.properties ?? {})) {
    const strategy = isRecord(property) ? pillsStrategy(property.pills) : undefined;
    if (strategy) result[propertyId] = strategy;
  }
  return result;
}

/** What decides pill colours in a Base, for `pillColor`. */
export function studioPillContext(block: StudioBase): PillColorContext {
  const palette = studioPalette(block);
  return {
    ...(palette ? { paletteTemplateId: palette } : {}),
    strategies: studioStrategies(block),
    overrides: studioOverrides(block),
  };
}

/** The column styles of every view (from each property's `style`), for `resolveColumnAppearance`. */
export function studioBaseAppearances(block: StudioBase): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [propertyId, property] of Object.entries(block.properties ?? {})) {
    if (isRecord(property) && isRecord(property.style)) result[propertyId] = property.style;
  }
  return result;
}

/** The column styles of one view (from `columns[id].style`), for `resolveColumnAppearance`. */
export function studioViewAppearances(view: StudioView): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [propertyId, column] of Object.entries(view.columns ?? {})) {
    if (isRecord(column) && isRecord(column.style)) result[propertyId] = column.style;
  }
  return result;
}

/** A column style as stored: only what differs from the default. Null for the default style. */
export function storedColumnAppearance(appearance: ColumnAppearance): Record<string, unknown> | null {
  const normalized = normalizeColumnAppearance(appearance);
  const stored: Record<string, unknown> = {};
  if (normalized.tone !== "default") stored.tone = normalized.tone;
  if (normalized.bold) stored.bold = true;
  if (normalized.color) stored.color = normalized.color;
  if (normalized.align) stored.align = normalized.align;
  return Object.keys(stored).length ? stored : null;
}

/** The property IDs of a view whose cells always wrap. */
export function studioWrapColumns(view: StudioView): string[] {
  return Object.entries(view.columns ?? {}).flatMap(([propertyId, column]) =>
    isRecord(column) && column.wrap === true ? [propertyId] : [],
  );
}

/** The readable rules of a block, in order; `scope` says which block they came from. */
export function studioRules(block: StudioBase | StudioView, scope: RuleScope): ConditionalRule[] {
  if (!Array.isArray(block.rules)) return [];
  return block.rules.flatMap((candidate, index) => {
    const rule = normalizeRule(candidate, index, { scope });
    return rule ? [rule] : [];
  });
}

const RULE_KNOWN_KEYS = [
  "id",
  "name",
  "enabled",
  "propertyId",
  "operator",
  "operand",
  "target",
  "scope",
  "color",
  "backgroundOpacity",
  "fontColor",
  "bold",
  "strikethrough",
  "overridePillColors",
] as const;

/**
 * The saved rules for `rules`: each given rule over its saved record (so unknown fields stay), then
 * every saved rule this contract cannot read, unchanged. `scope` is never saved; the block says it.
 */
export function storedRules(existing: unknown, rules: readonly ConditionalRule[]): unknown[] {
  const raw = Array.isArray(existing) ? existing : [];
  const readable = new Map<string, Record<string, unknown>>();
  const unreadable: unknown[] = [];
  raw.forEach((candidate, index) => {
    const rule = normalizeRule(candidate, index, { scope: "base" });
    if (rule && isRecord(candidate)) readable.set(rule.id, candidate);
    else unreadable.push(structuredClone(candidate));
  });
  const stored = rules.map((rule) => {
    const item = structuredClone(readable.get(rule.id) ?? {});
    for (const key of RULE_KNOWN_KEYS) delete item[key];
    const { scope: _scope, ...fields } = structuredClone(rule);
    return { ...fields, ...item };
  });
  return [...stored, ...unreadable];
}

// ─── Editing helpers (on a block draft) ─────────────────────────────────────

/** Renames a property everywhere in a root block: its record and the rules that test it. */
export function renameStudioBaseProperty(block: StudioBase, from: string, to: string): void {
  if (block.properties && from in block.properties) block.properties = renameKey(block.properties, from, to);
  renameRuleProperty(block.rules, from, to);
}

/** Renames a property everywhere in a view block: its column and the rules that test it. */
export function renameStudioViewProperty(view: StudioView, from: string, to: string): void {
  if (view.columns && from in view.columns) view.columns = renameKey(view.columns, from, to);
  renameRuleProperty(view.rules, from, to);
}

/** Removes deleted properties' records. Rules stay: removing them needs an explicit cleanup. */
export function removeStudioBaseProperties(block: StudioBase, propertyIds: readonly string[]): void {
  for (const id of propertyIds) delete block.properties?.[id];
}

/** Removes deleted properties' columns from a view block. */
export function removeStudioViewProperties(view: StudioView, propertyIds: readonly string[]): void {
  for (const id of propertyIds) delete view.columns?.[id];
}

function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key === from ? to : key, value]));
}

function renameRuleProperty(rules: unknown, from: string, to: string): void {
  if (!Array.isArray(rules)) return;
  for (const rule of rules) if (isRecord(rule) && rule.propertyId === from) rule.propertyId = to;
}

// ─── Migration from the old blocks ──────────────────────────────────────────

/** The root block built from `basesEditor` and `basesVisuals` (or an old per-view copy of it). */
function legacyStudioBase(root: Record<string, unknown>): StudioBase {
  const editor = isRecord(root[LEGACY_EDITOR_KEY]) ? root[LEGACY_EDITOR_KEY] : {};
  const visuals = isRecord(root[LEGACY_VISUALS_KEY]) ? root[LEGACY_VISUALS_KEY] : legacyViewCopy(root.views);
  const block: StudioBase = {};
  const properties: Record<string, StudioProperty> = {};
  const property = (id: string): StudioProperty => (properties[id] ??= {});

  for (const [key, value] of Object.entries(editor)) {
    if (key === "schemaVersion" || key === "propertyTypes" || key === "recordDefaults") continue;
    block[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(visuals)) {
    if (VISUALS_KNOWN_KEYS.has(key) || key in block) continue;
    block[key] = structuredClone(value);
  }
  if (typeof visuals.paletteTemplateId === "string") block.palette = visuals.paletteTemplateId;

  const types = isRecord(editor.propertyTypes) ? editor.propertyTypes : {};
  for (const [id, annotation] of Object.entries(types)) {
    if (!isRecord(annotation)) continue;
    const record = structuredClone(annotation) as StudioProperty;
    if (Array.isArray(annotation.options)) record.options = annotation.options.flatMap(legacyDeclaredOption);
    properties[id] = record;
  }
  const defaults = isRecord(editor.recordDefaults) ? editor.recordDefaults : {};
  for (const [id, value] of Object.entries(defaults)) property(id).default = structuredClone(value);

  const strategies = isRecord(visuals.propertyStrategies) ? visuals.propertyStrategies : {};
  for (const [id, raw] of Object.entries(strategies)) {
    if (!isRecord(raw)) continue;
    const { wrapPills, ...rest } = structuredClone(raw);
    const pills: StudioPills = { ...rest };
    if (wrapPills === true) pills.wrap = true;
    if (pills.mode === "smart") delete pills.mode;
    if (pills.style === "soft") delete pills.style;
    if (pills.mode !== "single") delete pills.preset;
    if (Object.keys(pills).length) property(id).pills = pills;
  }

  const overrides = isRecord(visuals.options) ? visuals.options : {};
  for (const raw of Object.values(overrides)) {
    if (!isRecord(raw) || typeof raw.propertyId !== "string" || typeof raw.value !== "string") continue;
    const override = normalizeOverride(raw.override);
    const id = raw.propertyId.trim();
    const value = raw.value.trim();
    if (!override || !id || !value) continue;
    const record = property(id);
    const options = (record.options ??= []);
    const declared = options.find((option) => option.value === value);
    // A declared option's own colour was shown first, so it stays.
    if (declared) declared.color ??= overrideOptionColor(override);
    else options.push({ value, color: overrideOptionColor(override) });
  }

  const appearances = isRecord(visuals.columnAppearances) ? visuals.columnAppearances : {};
  for (const [id, raw] of Object.entries(appearances)) {
    const style = storedColumnAppearance(normalizeColumnAppearance(raw));
    if (style) property(id).style = style;
  }

  if (Object.keys(properties).length) block.properties = properties;
  const rules = legacyRules(visuals.rules, legacyVersion(visuals) <= 7, "migrated-rule-");
  if (rules.length) block.rules = rules;
  return block;
}

/** The view block built from `basesEditorView`, `basesVisualsView` and the older appearance key. */
function legacyStudioView(view: Record<string, unknown>): StudioView {
  const editor = isRecord(view[LEGACY_EDITOR_VIEW_KEY]) ? view[LEGACY_EDITOR_VIEW_KEY] : {};
  const visuals = isRecord(view[LEGACY_VISUALS_VIEW_KEY]) ? view[LEGACY_VISUALS_VIEW_KEY] : {};
  const block: StudioView = {};
  const columns: Record<string, StudioColumn> = {};
  for (const [key, value] of Object.entries(editor)) {
    if (key === "schemaVersion" || key === "wrapColumns") continue;
    block[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(visuals)) {
    if (key === "schemaVersion" || key === "rules" || key === "columnAppearances" || key in block) continue;
    block[key] = structuredClone(value);
  }
  if (Array.isArray(editor.wrapColumns)) {
    for (const id of editor.wrapColumns) if (typeof id === "string" && id) (columns[id] ??= {}).wrap = true;
  }
  const appearances = isRecord(visuals.columnAppearances)
    ? visuals.columnAppearances
    : isRecord(view[LEGACY_VIEW_COLUMN_APPEARANCE_KEY])
      ? view[LEGACY_VIEW_COLUMN_APPEARANCE_KEY]
      : {};
  for (const [id, raw] of Object.entries(appearances)) {
    // In a view, a default style is kept: it turns the Base's style off there.
    (columns[id] ??= {}).style = storedColumnAppearance(normalizeColumnAppearance(raw)) ?? {};
  }
  if (Object.keys(columns).length) block.columns = columns;
  const rules = legacyRules(visuals.rules, legacyVersion(visuals) <= 2, "migrated-view-rule-");
  if (rules.length) block.rules = rules;
  return block;
}

const VISUALS_KNOWN_KEYS = new Set([
  "schemaVersion",
  "paletteTemplateId",
  "options",
  "knownProperties",
  "rules",
  "propertyStrategies",
  "columnAppearances",
]);

function legacyVersion(block: Record<string, unknown>): number {
  return typeof block.schemaVersion === "number" ? block.schemaVersion : 0;
}

/** The first old per-view copy of the Base-wide visuals block. */
function legacyViewCopy(views: unknown): Record<string, unknown> {
  if (!Array.isArray(views)) return {};
  for (const view of views) if (isRecord(view) && isRecord(view[LEGACY_BASE_VISUALS_KEY])) return view[LEGACY_BASE_VISUALS_KEY];
  return {};
}

/** A declared option as stored now; an old pastel colour becomes the accent it stood for. */
function legacyDeclaredOption(option: unknown): StudioOption[] {
  if (typeof option === "string") return option ? [{ value: option }] : [];
  if (!isRecord(option) || typeof option.value !== "string" || !option.value) return [];
  const result = structuredClone(option) as StudioOption;
  if (typeof option.color === "string") {
    const accent = optionAccent(option.color);
    if (accent) result.color = accent;
  }
  return [result];
}

/**
 * Old rules as stored now: exact (an old block's missing opacity is written as the one it meant),
 * without `scope`, and each with an `id`. Unknown fields and unreadable rules stay.
 */
function legacyRules(value: unknown, legacy: boolean, idPrefix: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) return structuredClone(candidate);
    const withId =
      typeof candidate.id === "string" && candidate.id.trim() ? candidate : { ...candidate, id: `${idPrefix}${index}` };
    const rule = normalizeRule(withId, index, { scope: "base", legacy });
    if (!rule) {
      const { scope: _scope, ...rest } = structuredClone(withId);
      return rest;
    }
    return storedRules([withId], [rule])[0];
  });
}

/** Whether a parsed Base still has any old block. */
function hasLegacyBlocks(root: Record<string, unknown>): boolean {
  if (LEGACY_ROOT_KEYS.some((key) => key in root)) return true;
  return (
    Array.isArray(root.views) && root.views.some((view) => isRecord(view) && LEGACY_VIEW_KEYS.some((key) => key in view))
  );
}

/**
 * Why a parsed Base (or `{ views: [view] }`) must not be rewritten: a block in it was saved by a
 * newer version. Null when it may be.
 */
export function newerBlockReason(root: Record<string, unknown>): string | null {
  if (isNewerStudio(root[STUDIO_KEY])) return "basesStudio was saved by a newer version";
  const newer = (block: unknown, key: string): boolean =>
    key in LEGACY_VERSIONS &&
    isRecord(block) &&
    typeof block.schemaVersion === "number" &&
    block.schemaVersion > LEGACY_VERSIONS[key]!;
  for (const key of LEGACY_ROOT_KEYS) if (newer(root[key], key)) return `${key} was saved by a newer version`;
  if (Array.isArray(root.views)) {
    for (const view of root.views) {
      if (!isRecord(view)) continue;
      for (const key of LEGACY_VIEW_KEYS) if (newer(view[key], key)) return `${key} was saved by a newer version`;
    }
  }
  return null;
}

/**
 * Moves every old block of a file into `basesStudio` and removes the old blocks, in one step. It
 * runs only as part of an intentional save; a file that already has only `basesStudio` is unchanged.
 * Old blocks saved by a newer version make the file read-only rather than simplified.
 */
export function migrateToStudio(source: string): MigrationResult {
  const read = readYamlMap(source, []);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  if (read.status !== "present") return { status: "unchanged", source };
  const root = read.value;
  if (!hasLegacyBlocks(root)) return { status: "unchanged", source };
  const newer = newerBlockReason(root);
  if (newer) return { status: "read-only", source, reason: newer };

  let next = source;
  const patch = (path: readonly (string | number)[], desired: Record<string, unknown> | null): string | null => {
    const result = patchYamlMap(next, path, desired);
    if (result.status === "read-only") return result.reason;
    next = result.source;
    return null;
  };
  // Views first, from the last, so the root edits never move a view that is still to be patched.
  const views = Array.isArray(root.views) ? root.views : [];
  for (let index = views.length - 1; index >= 0; index -= 1) {
    const view = views[index];
    if (!isRecord(view) || !LEGACY_VIEW_KEYS.some((key) => key in view)) continue;
    if (!(STUDIO_KEY in view)) {
      const block = compactStudioView(legacyStudioView(view));
      const failed = Object.keys(block).length ? patch(["views", index, STUDIO_KEY], block) : null;
      if (failed) return { status: "read-only", source, reason: failed };
    }
    for (const key of LEGACY_VIEW_KEYS) {
      if (!(key in view)) continue;
      const failed = patch(["views", index, key], null);
      if (failed) return { status: "read-only", source, reason: failed };
    }
  }
  if (!(STUDIO_KEY in root)) {
    const block = compactStudioBase(legacyStudioBase(root));
    const failed = Object.keys(block).length ? patch([STUDIO_KEY], block) : null;
    if (failed) return { status: "read-only", source, reason: failed };
  }
  for (const key of LEGACY_ROOT_KEYS) {
    if (!(key in root)) continue;
    const failed = patch([key], null);
    if (failed) return { status: "read-only", source, reason: failed };
  }
  return { status: "migrated", source: next };
}

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * Writes the root block: the edits from `baseline` (the block as the caller last read it) to
 * `next` are applied onto the block now in `source`, field by field. Edits to the same field made
 * meanwhile are conflicts. The file is migrated first. An edit that changes nothing leaves `source`
 * as it is, even when the file still has the old blocks.
 */
export function writeStudioBase(
  source: string,
  baseline: StudioBase | undefined,
  next: StudioBase,
): BlockWriteResult<StudioBase> {
  const read = readYamlMap(source, []);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  const root = read.status === "present" ? read.value : {};
  if (isNewerStudio(root[STUDIO_KEY]))
    return { status: "read-only", source, reason: "basesStudio was saved by a newer version" };
  const current = compactStudioBase(readStudioBase(root));
  const conflicts: string[] = [];
  const merged = compactStudioBase(
    mergeValues(compactStudioBase(baseline ?? current), compactStudioBase(next), current, "", conflicts) as StudioBase,
  );
  if (conflicts.length) return { status: "conflict", source, paths: conflicts };
  if (equalValues(merged, current)) return { status: "saved", source, persisted: current };
  const migrated = migrateToStudio(source);
  if (migrated.status === "read-only") return migrated;
  const patched = patchYamlMap(migrated.source, [STUDIO_KEY], Object.keys(merged).length ? merged : null);
  if (patched.status === "read-only") return { status: "read-only", source, reason: patched.reason };
  return { status: "saved", source: patched.source, persisted: merged };
}

/** Writes one view's block, as `writeStudioBase` writes the root block. */
export function writeStudioView(
  source: string,
  viewIndex: number,
  baseline: StudioView | undefined,
  next: StudioView,
): BlockWriteResult<StudioView> {
  const read = readYamlMap(source, []);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  const root = read.status === "present" ? read.value : {};
  if (isNewerStudio(root[STUDIO_KEY]))
    return { status: "read-only", source, reason: "basesStudio was saved by a newer version" };
  const views = Array.isArray(root.views) ? root.views : [];
  if (!isRecord(views[viewIndex])) return { status: "read-only", source, reason: "The view does not exist." };
  const current = compactStudioView(readStudioView(views[viewIndex]));
  const conflicts: string[] = [];
  const merged = compactStudioView(
    mergeValues(compactStudioView(baseline ?? current), compactStudioView(next), current, "view", conflicts) as StudioView,
  );
  if (conflicts.length) return { status: "conflict", source, paths: conflicts };
  if (equalValues(merged, current)) return { status: "saved", source, persisted: current };
  const migrated = migrateToStudio(source);
  if (migrated.status === "read-only") return migrated;
  const patched = patchYamlMap(
    migrated.source,
    ["views", viewIndex, STUDIO_KEY],
    Object.keys(merged).length ? merged : null,
  );
  if (patched.status === "read-only") return { status: "read-only", source, reason: patched.reason };
  return { status: "saved", source: patched.source, persisted: merged };
}

/** Changes the root block with `change`, applied to a copy of the block now in `source`. */
export function updateStudioBase(source: string, change: (block: StudioBase) => void): BlockWriteResult<StudioBase> {
  const read = readYamlMap(source, []);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  const current = readStudioBase(read.status === "present" ? read.value : {});
  const draft = structuredClone(current);
  change(draft);
  return writeStudioBase(source, current, draft);
}

/** Changes one view's block with `change`, applied to a copy of the block now in `source`. */
export function updateStudioView(
  source: string,
  viewIndex: number,
  change: (view: StudioView) => void,
): BlockWriteResult<StudioView> {
  const read = readYamlMap(source, ["views", viewIndex]);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  if (read.status !== "present") return { status: "read-only", source, reason: "The view does not exist." };
  const current = readStudioView(read.value);
  const draft = structuredClone(current);
  change(draft);
  return writeStudioView(source, viewIndex, current, draft);
}

/**
 * Applies the change from `previous` to `next` onto `current`, field by field, in memory (an app
 * that keeps unsaved choices rebases them with it). Where both changed the same field, `current`
 * is kept and the field's path is in `conflicts`.
 */
export function mergeStudioBase(
  previous: StudioBase,
  next: StudioBase,
  current: StudioBase,
): { block: StudioBase; conflicts: string[] } {
  const conflicts: string[] = [];
  const merged = mergeValues(
    compactStudioBase(previous),
    compactStudioBase(next),
    compactStudioBase(current),
    "",
    conflicts,
  );
  return { block: compactStudioBase(isRecord(merged) ? merged : {}), conflicts };
}

/** `mergeStudioBase` for a view's block. */
export function mergeStudioView(
  previous: StudioView,
  next: StudioView,
  current: StudioView,
): { block: StudioView; conflicts: string[] } {
  const conflicts: string[] = [];
  const merged = mergeValues(
    compactStudioView(previous),
    compactStudioView(next),
    compactStudioView(current),
    "view",
    conflicts,
  );
  return { block: compactStudioView(isRecord(merged) ? merged : {}), conflicts };
}

/**
 * The root block as saved: `version` first, and no empty records, lists, options or styles. A
 * block with nothing to save is empty (it is then removed).
 */
export function compactStudioBase(block: StudioBase): StudioBase {
  const result = structuredClone(block);
  delete result.version;
  if (isRecord(result.properties)) {
    for (const [id, property] of Object.entries(result.properties)) {
      if (!isRecord(property)) continue;
      for (const key of ["options", "pills", "style"] as const) if (isEmpty(property[key])) delete property[key];
      if (!Object.keys(property).length) delete result.properties[id];
    }
  }
  for (const key of ["properties", "rules", "detailLayouts", "tableUi"] as const)
    if (isEmpty(result[key])) delete result[key];
  if (result.palette === undefined) delete result.palette;
  return Object.keys(result).length ? { version: STUDIO_VERSION, ...result } : {};
}

/** A view block as saved: no empty columns or lists. A view style that is empty stays: it turns a Base style off. */
export function compactStudioView(view: StudioView): StudioView {
  const result = structuredClone(view);
  if (isRecord(result.columns)) {
    for (const [id, column] of Object.entries(result.columns)) {
      if (!isRecord(column)) continue;
      if (column.wrap === false) delete column.wrap;
      if (!Object.keys(column).length) delete result.columns[id];
    }
  }
  for (const key of ["columns", "rules"] as const) if (isEmpty(result[key])) delete result[key];
  return result;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

// ─── Three-way merge ────────────────────────────────────────────────────────

/** Lists merged item by item, by this key: rules by `id`, options by `value`. Other lists are one value. */
const LIST_KEYS: Readonly<Record<string, string>> = { rules: "id", options: "value" };

/**
 * Applies the change from `previous` to `next` onto `current`. Records merge key by key; keyed
 * lists merge item by item, with their order compared on its own. A value that both sides changed
 * differently is a conflict (its path is added to `conflicts`, and `current` is kept).
 */
function mergeValues(
  previous: unknown,
  next: unknown,
  current: unknown,
  path: string,
  conflicts: string[],
  key = "",
): unknown {
  if (equalValues(previous, next)) return structuredClone(current);
  if (equalValues(previous, current) || equalValues(next, current)) return structuredClone(next);
  if (isRecord(next) && isRecord(current)) {
    const baseline = isRecord(previous) ? previous : {};
    const merged: Record<string, unknown> = {};
    for (const field of new Set([...Object.keys(current), ...Object.keys(next)])) {
      const value = mergeValues(baseline[field], next[field], current[field], join(path, field), conflicts, field);
      if (value !== undefined) merged[field] = value;
    }
    return merged;
  }
  const listKey = LIST_KEYS[key];
  if (listKey && Array.isArray(next) && Array.isArray(current)) {
    const merged = mergeList(Array.isArray(previous) ? previous : [], next, current, listKey, path, conflicts);
    if (merged) return merged;
  }
  conflicts.push(path || "block");
  return structuredClone(current);
}

function mergeList(
  previous: unknown[],
  next: unknown[],
  current: unknown[],
  key: string,
  path: string,
  conflicts: string[],
): unknown[] | null {
  const byKey = (items: unknown[]): Map<string, unknown> | null => {
    const map = new Map<string, unknown>();
    for (const item of items) {
      const id = isRecord(item) ? item[key] : typeof item === "string" && key === "value" ? item : undefined;
      if (typeof id !== "string" || map.has(id)) return null;
      map.set(id, item);
    }
    return map;
  };
  const [before, after, now] = [byKey(previous), byKey(next), byKey(current)];
  if (!before || !after || !now) return null;
  const merged = new Map<string, unknown>();
  for (const id of new Set([...now.keys(), ...after.keys()])) {
    const value = mergeValues(before.get(id), after.get(id), now.get(id), `${path}.${id}`, conflicts);
    if (value !== undefined) merged.set(id, value);
  }
  const ids = (map: Map<string, unknown>): string[] => [...map.keys()];
  const orderChanged = !equalValues(ids(before), ids(after));
  // Both sides moved the same items to different places. (Adding or removing items is not a move.)
  const moved = (map: Map<string, unknown>): string[] => ids(map).filter((id) => before.has(id) && after.has(id) && now.has(id));
  if (
    !equalValues(moved(before), moved(after)) &&
    !equalValues(moved(before), moved(now)) &&
    !equalValues(moved(after), moved(now))
  )
    conflicts.push(`${path} order`);
  const order = orderChanged ? [...ids(after), ...ids(now)] : [...ids(now), ...ids(after)];
  return [...new Set(order)].flatMap((id) => (merged.has(id) ? [merged.get(id)] : []));
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
