import {
  adjustForContrast,
  normalizeHex,
  normalizePresetName,
  resolvePreset,
  resolveRuleColor,
  tintedHex,
} from "./colors";
import { RULE_FILL_SWATCHES } from "./swatches";
import {
  RULE_OPERATORS,
  type ConditionalRule,
  type PaletteTemplateId,
  type RuleColor,
  type RuleOperator,
  type RuleScope,
} from "./types";

export interface RenderedCellValue {
  text: string;
  values: string[];
}

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: "Equals",
  "not-equals": "Does not equal",
  contains: "Contains",
  "not-contains": "Does not contain",
  "is-empty": "Is empty",
  "is-not-empty": "Is not empty",
  "greater-than": "Greater than",
  "greater-or-equal": "Greater than or equal",
  "less-than": "Less than",
  "less-or-equal": "Less than or equal",
};

export function isRuleOperator(value: unknown): value is RuleOperator {
  return typeof value === "string" && RULE_OPERATORS.includes(value as RuleOperator);
}

export function operatorNeedsOperand(operator: RuleOperator): boolean {
  return operator !== "is-empty" && operator !== "is-not-empty";
}

export function evaluateRule(rule: Pick<ConditionalRule, "operator" | "operand">, cell: RenderedCellValue): boolean {
  const values = (cell.values.length ? cell.values : [cell.text]).map(normalizeText);
  const operand = normalizeText(rule.operand ?? "");
  const empty = values.every((value) => value.length === 0);

  switch (rule.operator) {
    case "is-empty":
      return empty;
    case "is-not-empty":
      return !empty;
    case "equals":
      return values.some((value) => value === operand);
    case "not-equals":
      return values.every((value) => value !== operand);
    case "contains":
      return values.some((value) => value.includes(operand));
    case "not-contains":
      return values.every((value) => !value.includes(operand));
    default:
      return evaluateNumeric(rule.operator, cell.text, rule.operand ?? "");
  }
}

export function matchingRule(
  rules: readonly ConditionalRule[],
  propertyId: string,
  cell: RenderedCellValue,
  target: "cell" | "row",
): ConditionalRule | undefined {
  return rules.find(
    (rule) =>
      rule.enabled &&
      ruleHasFormatting(rule) &&
      rule.target === target &&
      rule.propertyId === propertyId &&
      evaluateRule(rule, cell),
  );
}

export function ruleHasFormatting(
  rule: Pick<ConditionalRule, "color" | "fontColor" | "bold" | "strikethrough">,
): boolean {
  return Boolean(rule.color || rule.fontColor || rule.bold || rule.strikethrough);
}

export function ruleColorVariables(
  color?: RuleColor,
  fontColor?: RuleColor,
  paletteId: PaletteTemplateId = "default",
  backgroundOpacity?: number,
): {
  background: string;
  hover: string;
  foregroundLight: string;
  foregroundDark: string;
} {
  const resolved =
    color?.kind === "preset" ? resolvePreset(color.name, paletteId) : color ? resolveRuleColor(color.hex) : null;
  const text = fontColor
    ? fontColor.kind === "preset"
      ? resolvePreset(fontColor.name, paletteId)
      : resolveRuleColor(fontColor.hex)
    : resolved;
  const opacity = effectiveRuleBackgroundOpacity(color, backgroundOpacity);
  const hoverOpacity = color ? Math.min(100, opacity + 6) : 0;
  const accent =
    color?.kind === "preset" && color.name === "default" ? "var(--text-muted)" : (resolved?.dot ?? "transparent");
  const background = opacity === 0 ? "transparent" : `color-mix(in srgb, ${accent} ${opacity}%, transparent)`;
  const hover = hoverOpacity === 0 ? "transparent" : `color-mix(in srgb, ${accent} ${hoverOpacity}%, transparent)`;
  if (!fontColor && color?.kind === "preset" && color.name === "default") {
    return {
      background,
      hover,
      foregroundLight: "var(--text-muted)",
      foregroundDark: "var(--text-muted)",
    };
  }
  if (fontColor?.kind === "preset" && fontColor.name === "default") {
    return {
      background,
      hover,
      foregroundLight: "var(--text-muted)",
      foregroundDark: "var(--text-muted)",
    };
  }
  const automaticForeground =
    !fontColor && resolved && /^#[0-9A-F]{6}$/i.test(resolved.dot)
      ? {
          light: adjustForContrast(resolved.dot, tintedHex(resolved.dot, "#FFFFFF", hoverOpacity / 100)),
          dark: adjustForContrast(resolved.dot, tintedHex(resolved.dot, "#1E1E1E", hoverOpacity / 100)),
        }
      : null;
  return {
    background,
    hover,
    foregroundLight: fontColor
      ? (text?.dot ?? "inherit")
      : (automaticForeground?.light ?? text?.foregroundLight ?? "inherit"),
    foregroundDark: fontColor
      ? (text?.dot ?? "inherit")
      : (automaticForeground?.dark ?? text?.foregroundDark ?? "inherit"),
  };
}

/** How much of a rule's background colour shows, from 0 to 100. Without a stored value, all of it. */
export function effectiveRuleBackgroundOpacity(color?: RuleColor, stored?: number): number {
  if (!color) return 0;
  return normalizeRuleOpacity(stored) ?? 100;
}

/** The tint a newly chosen background colour starts with in an editor: a light wash of the accent. */
export function defaultRuleBackgroundOpacity(color: RuleColor): number {
  return color.kind === "preset" && color.name === "default" ? 3 : 12;
}

/** These pale fills were saved without an opacity and shown at full strength before the contract. */
const LEGACY_FULL_STRENGTH_FILLS = new Set(RULE_FILL_SWATCHES.map((swatch) => swatch.hex));

/**
 * The opacity an old block (written before the opacity contract) meant when it had none: the
 * Bases Visuals default tint, except for the pale rule fills, which showed at full strength.
 */
function legacyRuleOpacity(color: RuleColor): number {
  if (color.kind === "custom" && LEGACY_FULL_STRENGTH_FILLS.has(color.hex)) return 100;
  return defaultRuleBackgroundOpacity(color);
}

export interface NormalizeRuleOptions {
  /** Where the rule was read from. */
  scope: RuleScope;
  /** The rule comes from a block older than the opacity contract; a missing opacity is filled in. */
  legacy?: boolean;
}

/**
 * The one reader of a saved formatting rule, for both apps. Returns null for a rule this contract
 * cannot understand; writers keep such rules unchanged (see `compactViewData`).
 */
export function normalizeRule(value: unknown, index: number, options: NormalizeRuleOptions): ConditionalRule | null {
  if (!isRecord(value)) return null;
  if (typeof value.propertyId !== "string" || !value.propertyId.trim()) return null;
  if (!isRuleOperator(value.operator)) return null;
  if (value.target !== "cell" && value.target !== "row") return null;
  const color = normalizeRuleColor(value.color);
  if (value.color !== undefined && !color) return null;
  const fontColor = normalizeRuleColor(value.fontColor);
  const storedOpacity = normalizeRuleOpacity(value.backgroundOpacity);
  const backgroundOpacity = color
    ? (storedOpacity ?? (options.legacy ? legacyRuleOpacity(color) : undefined))
    : undefined;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `migrated-rule-${index}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Formatting rule",
    enabled: value.enabled !== false,
    propertyId: value.propertyId.trim(),
    operator: value.operator,
    ...(typeof value.operand === "string" ? { operand: value.operand } : {}),
    target: value.target,
    scope: options.scope,
    ...(color ? { color } : {}),
    ...(backgroundOpacity !== undefined ? { backgroundOpacity } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(value.bold === true ? { bold: true } : {}),
    ...(value.strikethrough === true ? { strikethrough: true } : {}),
    ...(color && value.overridePillColors === true ? { overridePillColors: true } : {}),
  };
}

export function normalizeRuleOpacity(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : undefined;
}

export function normalizeRuleColor(value: unknown): RuleColor | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "preset") {
    const name = normalizePresetName(candidate.name);
    if (name) return { kind: "preset", name };
  }
  if (candidate.kind === "custom" && typeof candidate.hex === "string") {
    const hex = normalizeHex(candidate.hex);
    return hex ? { kind: "custom", hex } : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function evaluateNumeric(operator: RuleOperator, actualText: string, operandText: string): boolean {
  const actual = strictNumber(actualText);
  const operand = strictNumber(operandText);
  if (actual === null || operand === null) return false;
  switch (operator) {
    case "greater-than":
      return actual > operand;
    case "greater-or-equal":
      return actual >= operand;
    case "less-than":
      return actual < operand;
    case "less-or-equal":
      return actual <= operand;
    default:
      return false;
  }
}

function strictNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}
