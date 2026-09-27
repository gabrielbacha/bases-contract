/**
 * The data both apps save in a `.base` file. Every colour here is an accent hex: how strongly it is
 * applied comes from the pill style or from a rule's `backgroundOpacity`, never from the hex.
 */

export const PALETTE_NAMES = [
  "green-sea",
  "peter-river",
  "wisteria",
  "midnight-blue",
  "raspberry",
  "sun-flower",
  "carrot",
  "pomegranate",
  "chestnut",
] as const;

/** Preset IDs retained only so colors saved by older versions still render. */
export const PRESET_NAMES = PALETTE_NAMES;
export const LEGACY_PRESET_NAMES = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

export const AUTO_PRESET_NAMES = PALETTE_NAMES;

/** Built-in palette templates. The default is the original Bases Visuals palette. */
export const PALETTE_TEMPLATE_IDS = [
  "default",
  "sunset-spectrum",
  "desert-coast",
  "editorial",
  "ocean-depth",
  "ember",
  "citrus-grove",
  "electric-bloom",
] as const;
export type PaletteTemplateId = (typeof PALETTE_TEMPLATE_IDS)[number];

export const TEMPLATE_SLOT_NAMES = [
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
  "slot-5",
  "slot-6",
  "slot-7",
  "slot-8",
  "slot-9",
  "slot-10",
] as const;
export type TemplateSlotName = (typeof TEMPLATE_SLOT_NAMES)[number];

export type PaletteName = (typeof PALETTE_NAMES)[number];
export type PalettePresetName = PaletteName | TemplateSlotName;
export type PresetName = PalettePresetName | "default";

export const PROPERTY_STRATEGY_MODES = ["smart", "distinct", "status", "priority", "single", "neutral", "off"] as const;
export type PropertyStrategyMode = (typeof PROPERTY_STRATEGY_MODES)[number];
export const PILL_STYLES = ["soft", "solid", "outline"] as const;
export type PillStyle = (typeof PILL_STYLES)[number];
export interface PropertyColorStrategy {
  mode: PropertyStrategyMode;
  preset?: PalettePresetName;
  style?: PillStyle;
  /** Allow pills in this list property to flow onto additional lines. */
  wrapPills?: boolean;
}

export type ColorOverride =
  | { kind: "preset"; name: PresetName }
  | { kind: "custom"; hex: string }
  | { kind: "disabled" };

export interface OptionIdentity {
  propertyId: string;
  value: string;
}

export interface StoredOption extends OptionIdentity {
  override?: ColorOverride;
}

export const RULE_OPERATORS = [
  "equals",
  "not-equals",
  "contains",
  "not-contains",
  "is-empty",
  "is-not-empty",
  "greater-than",
  "greater-or-equal",
  "less-than",
  "less-or-equal",
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type RuleTarget = "cell" | "row";
export type RuleScope = "view" | "base";
export type RuleColor = { kind: "preset"; name: PresetName } | { kind: "custom"; hex: string };

export interface ConditionalRule {
  id: string;
  name: string;
  enabled: boolean;
  propertyId: string;
  operator: RuleOperator;
  operand?: string;
  target: RuleTarget;
  /** Where the rule is saved: the Base-wide `basesVisuals` block, or the view's `basesVisualsView`. */
  scope?: RuleScope;
  /** Optional background accent. Omission leaves the native background untouched. */
  color?: RuleColor;
  /** How much of `color` fills the background, from 0 to 100. Omission means 100. */
  backgroundOpacity?: number;
  /** Optional explicit text accent. Omission keeps accessible automatic contrast. */
  fontColor?: RuleColor;
  /** Optional text emphasis applied after the color treatment. */
  bold?: boolean;
  strikethrough?: boolean;
  /** Force the conditional background onto pills inside the matched target. */
  overridePillColors?: boolean;
}
