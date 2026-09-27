import { encodeOptionKey, normalizeHex, normalizePresetName } from "./colors";
import {
  PILL_STYLES,
  PROPERTY_STRATEGY_MODES,
  type ColorOverride,
  type PillStyle,
  type PropertyColorStrategy,
  type StoredOption,
} from "./types";

/** Saved pill colour choices, keyed by `encodeOptionKey`. Entries that cannot be read are left out. */
export function normalizeStoredOptions(value: unknown): Record<string, StoredOption> {
  const options: Record<string, StoredOption> = {};
  const raw = isRecord(value) ? value : {};
  for (const candidate of Object.values(raw)) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.propertyId !== "string") continue;
    if (typeof candidate.value !== "string") continue;
    const propertyId = candidate.propertyId.trim();
    const optionValue = candidate.value.trim();
    if (!propertyId || !optionValue) continue;
    const option: StoredOption = { propertyId, value: optionValue };
    const override = normalizeOverride(candidate.override);
    if (override) option.override = override;
    options[encodeOptionKey(option)] = option;
  }
  return options;
}

export function normalizeOverride(value: unknown): ColorOverride | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "disabled") return { kind: "disabled" };
  if (value.kind === "preset") {
    const name = normalizePresetName(value.name);
    if (name) return { kind: "preset", name };
  }
  if (value.kind === "custom" && typeof value.hex === "string") {
    const hex = normalizeHex(value.hex);
    if (hex) return { kind: "custom", hex };
  }
  return undefined;
}

export function normalizePropertyStrategies(value: unknown): Record<string, PropertyColorStrategy> {
  if (!isRecord(value)) return {};
  const strategies: Record<string, PropertyColorStrategy> = {};
  for (const [rawPropertyId, candidate] of Object.entries(value)) {
    const propertyId = rawPropertyId.trim();
    const strategy = normalizePropertyStrategy(candidate);
    if (propertyId && strategy && (strategy.mode !== "smart" || strategy.style || strategy.wrapPills)) {
      strategies[propertyId] = strategy;
    }
  }
  return strategies;
}

export function normalizePropertyStrategy(value: unknown): PropertyColorStrategy | undefined {
  if (!isRecord(value) || !PROPERTY_STRATEGY_MODES.includes(value.mode as never)) return undefined;
  const style =
    PILL_STYLES.includes(value.style as PillStyle) && value.style !== "soft" ? (value.style as PillStyle) : undefined;
  const wrapPills = value.wrapPills === true;
  if (value.mode === "single") {
    const preset = normalizePresetName(value.preset);
    return {
      mode: "single",
      preset: preset && preset !== "default" ? preset : "peter-river",
      ...(style ? { style } : {}),
      ...(wrapPills ? { wrapPills: true } : {}),
    };
  }
  return {
    mode: value.mode as PropertyColorStrategy["mode"],
    ...(style ? { style } : {}),
    ...(wrapPills ? { wrapPills: true } : {}),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
