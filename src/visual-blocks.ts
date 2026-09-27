import { parse as parseYaml } from "yaml";

import { normalizePaletteTemplateId } from "./colors";
import { isRecord, normalizePropertyStrategies, normalizeStoredOptions } from "./normalize";
import { normalizeRule } from "./rules";
import {
  type ConditionalRule,
  type PaletteTemplateId,
  type PropertyColorStrategy,
  type RuleScope,
  type StoredOption,
} from "./types";
import { equalValues } from "./value-equality";
import { patchYamlMap, readYamlMap } from "./yaml-patch";

/** The Base-wide block at the root of a `.base` file. */
export const BASE_VISUALS_KEY = "basesVisuals";
/** The per-view block inside `views[i]`. */
export const VIEW_VISUALS_KEY = "basesVisualsView";
/** Older releases copied the Base-wide block into every view under this key. */
export const LEGACY_BASE_VISUALS_KEY = "basesVisualsBase";
/** Older releases kept view column appearance under this key. */
export const LEGACY_VIEW_COLUMN_APPEARANCE_KEY = "basesVisualsColumnAppearance";

/**
 * Schema versions. Version 8 (Base) and 3 (view) introduced the opacity contract: a rule's
 * `backgroundOpacity` is 0–100 and a missing value means 100. Older blocks are read with the old
 * meaning and written in the new form on the next intentional edit.
 */
export const BASE_VISUALS_SCHEMA_VERSION = 8;
export const VIEW_VISUALS_SCHEMA_VERSION = 3;
const LEGACY_BASE_VISUALS_SCHEMA = 7;
const LEGACY_VIEW_VISUALS_SCHEMA = 2;

export interface BaseVisualData {
  schemaVersion: number;
  paletteTemplateId?: PaletteTemplateId;
  options: Record<string, StoredOption>;
  knownProperties: Record<string, { propertyId: string }>;
  rules: ConditionalRule[];
  propertyStrategies: Record<string, PropertyColorStrategy>;
  columnAppearances?: Record<string, unknown>;
  /** Latest on-disk block used as the three-way merge baseline. Never serialized directly. */
  rawSource?: Record<string, unknown>;
}

export interface ViewVisualData {
  schemaVersion: number;
  rules: ConditionalRule[];
  columnAppearances: Record<string, unknown>;
  rawSource?: Record<string, unknown>;
}

/** Whether a block was written by a newer contract; such a block is read but never rewritten. */
export function isNewerVisualSchema(value: unknown, scope: RuleScope): boolean {
  const current = scope === "base" ? BASE_VISUALS_SCHEMA_VERSION : VIEW_VISUALS_SCHEMA_VERSION;
  return isRecord(value) && typeof value.schemaVersion === "number" && value.schemaVersion > current;
}

export function emptyBaseData(): BaseVisualData {
  return {
    schemaVersion: BASE_VISUALS_SCHEMA_VERSION,
    options: {},
    knownProperties: {},
    rules: [],
    propertyStrategies: {},
    rawSource: {},
  };
}

export function emptyViewData(): ViewVisualData {
  return { schemaVersion: VIEW_VISUALS_SCHEMA_VERSION, rules: [], columnAppearances: {} };
}

/** Reads one list of saved rules; rules that cannot be read are left out (writers keep them). */
export function normalizeRules(value: unknown, scope: RuleScope, legacy: boolean): ConditionalRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    const rule = normalizeRule(candidate, index, { scope, legacy });
    return rule ? [rule] : [];
  });
}

export function normalizeBaseData(value: unknown): BaseVisualData | null {
  if (!isRecord(value)) return null;
  const legacy = !(typeof value.schemaVersion === "number" && value.schemaVersion > LEGACY_BASE_VISUALS_SCHEMA);
  const propertyStrategies = normalizePropertyStrategies(value.propertyStrategies);
  if (isRecord(value.propertyStrategies)) {
    for (const [propertyId, raw] of Object.entries(value.propertyStrategies)) {
      const strategy = propertyStrategies[propertyId];
      if (!strategy || !isRecord(raw)) continue;
      if (raw.style === "soft" && strategy.style === undefined) strategy.style = "soft";
      if (raw.wrapPills === false && strategy.wrapPills === undefined) strategy.wrapPills = false;
    }
  }
  return {
    schemaVersion: BASE_VISUALS_SCHEMA_VERSION,
    ...(typeof value.paletteTemplateId === "string"
      ? { paletteTemplateId: normalizePaletteTemplateId(value.paletteTemplateId) }
      : {}),
    options: Object.fromEntries(
      Object.entries(normalizeStoredOptions(value.options)).filter(([, option]) => option.override !== undefined),
    ),
    knownProperties: {},
    rules: normalizeRules(value.rules, "base", legacy),
    propertyStrategies,
    ...(isRecord(value.columnAppearances) ? { columnAppearances: structuredClone(value.columnAppearances) } : {}),
    rawSource: structuredClone(value),
  };
}

export function normalizeViewData(value: unknown, legacyAppearances?: unknown): ViewVisualData {
  if (!isRecord(value)) {
    return {
      ...emptyViewData(),
      columnAppearances: isRecord(legacyAppearances) ? structuredClone(legacyAppearances) : {},
    };
  }
  const legacy = !(typeof value.schemaVersion === "number" && value.schemaVersion > LEGACY_VIEW_VISUALS_SCHEMA);
  return {
    schemaVersion: VIEW_VISUALS_SCHEMA_VERSION,
    rules: normalizeRules(value.rules, "view", legacy),
    columnAppearances: isRecord(value.columnAppearances)
      ? structuredClone(value.columnAppearances)
      : isRecord(legacyAppearances)
        ? structuredClone(legacyAppearances)
        : {},
    rawSource: structuredClone(value),
  };
}

export function mergeBaseChanges(
  previous: BaseVisualData,
  next: BaseVisualData,
  current: BaseVisualData,
): BaseVisualData {
  const merged: BaseVisualData = {
    ...structuredClone(current),
    options: mergeRecordChanges(previous.options, next.options, current.options),
    knownProperties: mergeRecordChanges(previous.knownProperties, next.knownProperties, current.knownProperties),
    rules: mergeRuleChanges(previous.rules, next.rules, current.rules),
    propertyStrategies: mergeRecordChanges(
      previous.propertyStrategies,
      next.propertyStrategies,
      current.propertyStrategies,
    ),
  };
  const paletteTemplateId = equalValues(previous.paletteTemplateId, next.paletteTemplateId)
    ? current.paletteTemplateId
    : next.paletteTemplateId;
  if (paletteTemplateId) merged.paletteTemplateId = paletteTemplateId;
  else delete merged.paletteTemplateId;
  const appearances = mergeRecordChanges(
    previous.columnAppearances ?? {},
    next.columnAppearances ?? {},
    current.columnAppearances ?? {},
  );
  if (Object.keys(appearances).length) merged.columnAppearances = appearances;
  else delete merged.columnAppearances;
  return merged;
}

export function mergeViewChanges(
  previous: ViewVisualData,
  next: ViewVisualData,
  current: ViewVisualData,
): ViewVisualData {
  return {
    schemaVersion: VIEW_VISUALS_SCHEMA_VERSION,
    rules: mergeRuleChanges(previous.rules, next.rules, current.rules),
    columnAppearances: mergeRecordChanges(
      previous.columnAppearances,
      next.columnAppearances,
      current.columnAppearances,
    ),
    ...(current.rawSource ? { rawSource: structuredClone(current.rawSource) } : {}),
  };
}

export function mergeRecordChanges<T>(
  previous: Record<string, T>,
  next: Record<string, T>,
  current: Record<string, T>,
): Record<string, T> {
  const merged = structuredClone(current);
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (equalValues(previous[key], next[key])) continue;
    if (key in next) merged[key] = mergeChangedValue(previous[key], next[key], current[key]) as T;
    else delete merged[key];
  }
  return merged;
}

/** Applies the rule edits between `previous` and `next` onto `current`, field by field. */
export function mergeRuleChanges(
  previous: ConditionalRule[],
  next: ConditionalRule[],
  current: ConditionalRule[],
): ConditionalRule[] {
  if (equalValues(previous, next)) return structuredClone(current);
  const previousById = new Map(previous.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.map((rule) => [rule.id, rule]));
  const mergedById = new Map(current.map((rule) => [rule.id, structuredClone(rule)]));
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) mergedById.delete(id);
  }
  for (const rule of next) {
    if (!equalValues(previousById.get(rule.id), rule)) {
      mergedById.set(
        rule.id,
        mergeChangedValue(previousById.get(rule.id), rule, mergedById.get(rule.id)) as ConditionalRule,
      );
    }
  }
  const orderChanged = !equalValues(
    previous.map((rule) => rule.id),
    next.map((rule) => rule.id),
  );
  const order = orderChanged
    ? [...next.map((rule) => rule.id), ...current.map((rule) => rule.id)]
    : current.map((rule) => rule.id);
  return [...new Set(order)].flatMap((id) => {
    const rule = mergedById.get(id);
    return rule ? [rule] : [];
  });
}

function mergeChangedValue(previous: unknown, next: unknown, current: unknown): unknown {
  if (!isRecord(next) || !isRecord(current)) return structuredClone(next);
  const baseline = isRecord(previous) ? previous : {};
  const merged = structuredClone(current);
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
    if (equalValues(baseline[key], next[key])) continue;
    if (key in next) merged[key] = mergeChangedValue(baseline[key], next[key], current[key]);
    else delete merged[key];
  }
  return merged;
}

const BASE_VISUAL_KNOWN_KEYS = [
  "schemaVersion",
  "paletteTemplateId",
  "options",
  "knownProperties",
  "rules",
  "propertyStrategies",
  "columnAppearances",
] as const;

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

/** The block to save: the recognised choices, over every field and rule this contract does not know. */
export function compactBaseData(data: BaseVisualData, existing?: unknown): Record<string, unknown> {
  const result = isRecord(existing) ? structuredClone(existing) : {};
  for (const key of BASE_VISUAL_KNOWN_KEYS) delete result[key];
  result.schemaVersion = BASE_VISUALS_SCHEMA_VERSION;
  if (data.paletteTemplateId) result.paletteTemplateId = data.paletteTemplateId;
  const options = mergeObjectRecords(
    isRecord(existing) ? existing.options : undefined,
    data.options,
    isStoredOptionData,
    ["propertyId", "value", "override"],
  );
  if (Object.keys(options).length) result.options = options;
  const rules = mergeRuleRecords(isRecord(existing) ? existing.rules : undefined, data.rules, "base");
  if (rules.length) result.rules = rules;
  const strategies = mergeObjectRecords(
    isRecord(existing) ? existing.propertyStrategies : undefined,
    data.propertyStrategies,
    isPropertyStrategyData,
    ["mode", "preset", "style", "wrapPills"],
  );
  if (Object.keys(strategies).length) result.propertyStrategies = strategies;
  if (Object.keys(data.columnAppearances ?? {}).length) {
    result.columnAppearances = mergeOpaqueRecord(
      isRecord(existing) ? existing.columnAppearances : undefined,
      data.columnAppearances ?? {},
    );
  }
  return result;
}

export function compactViewData(data: ViewVisualData, existing?: unknown): Record<string, unknown> {
  const result = isRecord(existing) ? structuredClone(existing) : {};
  delete result.schemaVersion;
  delete result.rules;
  delete result.columnAppearances;
  result.schemaVersion = VIEW_VISUALS_SCHEMA_VERSION;
  const rules = mergeRuleRecords(isRecord(existing) ? existing.rules : undefined, data.rules, "view");
  if (rules.length) result.rules = rules;
  if (Object.keys(data.columnAppearances).length) {
    result.columnAppearances = mergeOpaqueRecord(
      isRecord(existing) ? existing.columnAppearances : undefined,
      data.columnAppearances,
    );
  }
  return result;
}

/** Whether a compacted block holds anything besides its schema version (otherwise it is removed). */
export function hasExtensionChoices(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => key !== "schemaVersion");
}

function mergeObjectRecords<T>(
  existing: unknown,
  desired: Record<string, T>,
  isRecognized: (value: unknown) => boolean,
  knownKeys: readonly string[],
): Record<string, unknown> {
  const raw = isRecord(existing) ? existing : {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecognized(value)) result[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(desired)) {
    const item = isRecord(raw[key]) ? structuredClone(raw[key]) : {};
    for (const knownKey of knownKeys) delete item[knownKey];
    Object.assign(item, structuredClone(value));
    result[key] = item;
  }
  return result;
}

/** Saved rules: the recognised ones as given (keeping unknown keys), then every unreadable one unchanged. */
function mergeRuleRecords(existing: unknown, desired: ConditionalRule[], scope: RuleScope): unknown[] {
  const raw = Array.isArray(existing) ? existing : [];
  const recognizedById = new Map<string, Record<string, unknown>>();
  const unrecognized: unknown[] = [];
  raw.forEach((candidate, index) => {
    if (isRecord(candidate) && typeof candidate.id === "string" && normalizeRule(candidate, index, { scope })) {
      recognizedById.set(candidate.id, candidate);
    } else {
      unrecognized.push(structuredClone(candidate));
    }
  });
  const rules = desired.map((rule) => {
    const item = structuredClone(recognizedById.get(rule.id) ?? {});
    for (const key of RULE_KNOWN_KEYS) delete item[key];
    Object.assign(item, structuredClone(rule));
    return item;
  });
  return [...rules, ...unrecognized];
}

function mergeOpaqueRecord(existing: unknown, desired: Record<string, unknown>): Record<string, unknown> {
  const raw = isRecord(existing) ? existing : {};
  return Object.fromEntries(
    Object.entries(desired).map(([key, value]) => [
      key,
      isRecord(raw[key]) && isRecord(value)
        ? { ...structuredClone(raw[key]), ...structuredClone(value) }
        : structuredClone(value),
    ]),
  );
}

function isStoredOptionData(value: unknown): boolean {
  if (!isRecord(value) || typeof value.propertyId !== "string" || typeof value.value !== "string") return false;
  const normalized = Object.values(normalizeStoredOptions({ candidate: value }))[0];
  return normalized?.override !== undefined && equalValues(normalized.override, value.override);
}

function isPropertyStrategyData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const normalized = normalizePropertyStrategies({ candidate: value }).candidate;
  if (!normalized) return false;
  const known = Object.fromEntries(
    ["mode", "preset", "style", "wrapPills"].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  );
  return equalValues(normalized, known);
}

export function readBaseVisualBlock(source: string): unknown {
  const read = readYamlMap(source, [BASE_VISUALS_KEY]);
  return read.status === "present" ? read.value : undefined;
}

export type BlockWriteResult<T> =
  | { status: "saved"; source: string; persisted: T }
  | { status: "conflict"; source: string; paths: string[] }
  | { status: "read-only"; source: string; reason: string };

/**
 * Writes the Base-wide block: the edits from `data.rawSource` (the block as last read) to `data`
 * are applied onto the block now in `source`. Same-field edits made meanwhile are conflicts.
 * Legacy per-view copies are removed. An edit that changes nothing leaves `source` unchanged.
 */
export function writeBaseVisuals(source: string, data: BaseVisualData): BlockWriteResult<BaseVisualData> {
  const read = readYamlMap(source, [BASE_VISUALS_KEY]);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  if (read.status === "block-invalid") return { status: "read-only", source, reason: "basesVisuals is not a mapping" };
  const latest = read.status === "present" ? read.value : undefined;
  if (isNewerVisualSchema(latest, "base"))
    return { status: "read-only", source, reason: "basesVisuals was saved by a newer version" };
  const conflicts = findBaseConflicts(data.rawSource, data, latest);
  if (conflicts.length) return { status: "conflict", source, paths: conflicts };
  const rebased = data.rawSource
    ? mergeBaseChanges(
        normalizeBaseData(data.rawSource) ?? emptyBaseData(),
        data,
        normalizeBaseData(latest) ?? emptyBaseData(),
      )
    : data;
  const compact = compactBaseData(rebased, latest);
  const views = safeParseRecord(source)?.views;
  const legacyCopies = Array.isArray(views) && views.some((view) => isRecord(view) && LEGACY_BASE_VISUALS_KEY in view);
  const current = normalizeBaseData(latest);
  // An edit that changes no choice does not rewrite the file, even when the block is an old version.
  if (current && !legacyCopies && sameBaseChoices(normalizeBaseData(compact) ?? emptyBaseData(), current))
    return { status: "saved", source, persisted: current };
  const patched = patchYamlMap(source, [BASE_VISUALS_KEY], hasExtensionChoices(compact) ? compact : null);
  if (patched.status === "read-only") return { status: "read-only", source, reason: patched.reason };
  let next = patched.source;
  if (legacyCopies && Array.isArray(views)) {
    for (let index = views.length - 1; index >= 0; index -= 1) {
      const migrated = patchYamlMap(next, ["views", index, LEGACY_BASE_VISUALS_KEY], null);
      if (migrated.status !== "read-only") next = migrated.source;
    }
  }
  const persisted = normalizeBaseData(readBaseVisualBlock(next)) ?? emptyBaseData();
  return { status: "saved", source: next, persisted };
}

/**
 * Writes one view's block: the edits from `baseline` to `data` are applied onto the view block now
 * in `source`, keeping every field and rule this contract does not know. The legacy column
 * appearance key is folded in and removed.
 */
export function writeViewVisuals(
  source: string,
  viewIndex: number,
  baseline: ViewVisualData,
  data: ViewVisualData,
): BlockWriteResult<ViewVisualData> {
  const path = ["views", viewIndex, VIEW_VISUALS_KEY] as const;
  const read = readYamlMap(source, path);
  if (read.status === "document-invalid") return { status: "read-only", source, reason: read.reason };
  if (read.status === "block-invalid")
    return { status: "read-only", source, reason: "basesVisualsView is not a mapping" };
  const latestRaw = read.status === "present" ? read.value : undefined;
  if (isNewerVisualSchema(latestRaw, "view"))
    return { status: "read-only", source, reason: "basesVisualsView was saved by a newer version" };
  const view = readYamlMap(source, ["views", viewIndex]);
  const legacyAppearances = view.status === "present" ? view.value[LEGACY_VIEW_COLUMN_APPEARANCE_KEY] : undefined;
  const latest = normalizeViewData(latestRaw, legacyAppearances);
  const conflicts = findViewConflicts(baseline, data, latest);
  if (conflicts.length) return { status: "conflict", source, paths: conflicts };
  const compact = compactViewData(mergeViewChanges(baseline, data, latest), latestRaw);
  if (
    latestRaw !== undefined &&
    legacyAppearances === undefined &&
    equalValues(normalizeViewData(compact).rules, latest.rules) &&
    equalValues(compact.columnAppearances ?? {}, latest.columnAppearances)
  )
    return { status: "saved", source, persisted: latest };
  const patched = patchYamlMap(source, path, hasExtensionChoices(compact) ? compact : null);
  if (patched.status === "read-only") return { status: "read-only", source, reason: patched.reason };
  const withoutLegacy = patchYamlMap(patched.source, ["views", viewIndex, LEGACY_VIEW_COLUMN_APPEARANCE_KEY], null);
  if (withoutLegacy.status === "read-only") return { status: "read-only", source, reason: withoutLegacy.reason };
  const nextRead = readYamlMap(withoutLegacy.source, path);
  return {
    status: "saved",
    source: withoutLegacy.source,
    persisted: normalizeViewData(nextRead.status === "present" ? nextRead.value : undefined),
  };
}

export function findBaseConflicts(
  baseline: Record<string, unknown> | undefined,
  next: BaseVisualData,
  latest: unknown,
): string[] {
  if (!baseline) return [];
  if (latest !== undefined && !isRecord(latest)) return ["malformed basesVisuals block"];
  const previous = normalizeBaseData(baseline) ?? emptyBaseData();
  const current = normalizeBaseData(latest) ?? emptyBaseData();
  const conflicts: string[] = [];
  if (changedBoth(previous.paletteTemplateId, next.paletteTemplateId, current.paletteTemplateId)) {
    conflicts.push("paletteTemplateId");
  }
  collectRecordConflicts("options", previous.options, next.options, current.options, conflicts);
  collectRecordConflicts(
    "propertyStrategies",
    previous.propertyStrategies,
    next.propertyStrategies,
    current.propertyStrategies,
    conflicts,
  );
  collectRecordConflicts(
    "columnAppearances",
    previous.columnAppearances ?? {},
    next.columnAppearances ?? {},
    current.columnAppearances ?? {},
    conflicts,
  );
  collectRuleConflicts("rules", previous.rules, next.rules, current.rules, conflicts);
  return conflicts;
}

export function findViewConflicts(previous: ViewVisualData, next: ViewVisualData, current: ViewVisualData): string[] {
  const conflicts: string[] = [];
  collectRecordConflicts(
    "view.columnAppearances",
    previous.columnAppearances,
    next.columnAppearances,
    current.columnAppearances,
    conflicts,
  );
  collectRuleConflicts("view.rules", previous.rules, next.rules, current.rules, conflicts);
  return conflicts;
}

function rulesById(rules: ConditionalRule[]): Record<string, ConditionalRule> {
  return Object.fromEntries(rules.map((rule) => [rule.id, rule]));
}

function ruleIds(rules: ConditionalRule[]): string[] {
  return rules.map((rule) => rule.id);
}

function collectRuleConflicts(
  label: string,
  previous: ConditionalRule[],
  next: ConditionalRule[],
  current: ConditionalRule[],
  conflicts: string[],
): void {
  collectRecordConflicts(label, rulesById(previous), rulesById(next), rulesById(current), conflicts);
  for (const rules of [previous, next, current]) {
    const seen = new Set<string>();
    for (const rule of rules) {
      if (seen.has(rule.id)) conflicts.push(`${label}.duplicate.${rule.id}`);
      seen.add(rule.id);
    }
  }
  if (changedBoth(ruleIds(previous), ruleIds(next), ruleIds(current)))
    conflicts.push(`${label.replace(/rules$/, "rule")} order`);
}

function collectRecordConflicts(
  label: string,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  current: Record<string, unknown>,
  conflicts: string[],
): void {
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next), ...Object.keys(current)])) {
    collectValueConflicts(`${label}.${key}`, previous[key], next[key], current[key], conflicts);
  }
}

function collectValueConflicts(
  label: string,
  previous: unknown,
  next: unknown,
  current: unknown,
  conflicts: string[],
): void {
  if (!changedBoth(previous, next, current)) return;
  if (isRecord(previous) && isRecord(next) && isRecord(current)) {
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next), ...Object.keys(current)])) {
      collectValueConflicts(`${label}.${key}`, previous[key], next[key], current[key], conflicts);
    }
    return;
  }
  conflicts.push(label);
}

function sameBaseChoices(first: BaseVisualData, second: BaseVisualData): boolean {
  const choices = ({ rawSource: _raw, schemaVersion: _version, knownProperties: _known, ...rest }: BaseVisualData) =>
    rest;
  return equalValues(choices(first), choices(second));
}

function changedBoth(previous: unknown, next: unknown, current: unknown): boolean {
  return !equalValues(previous, next) && !equalValues(previous, current) && !equalValues(next, current);
}

function safeParseRecord(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = parseYaml(source);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
