import { resolveColor, normalizeHex, type ResolvedColor } from "./colors";
import { encodeOptionKey } from "./colors";
import { effectivePropertyStrategy } from "./property-strategies";
import type { PaletteTemplateId, PropertyColorStrategy, StoredOption } from "./types";

/**
 * The pastel backgrounds saved as declared option colours before colours became accents, with the
 * accent each one stands for. The migration to `basesStudio` writes the accent.
 */
export const LEGACY_PASTEL_ACCENTS: Readonly<Record<string, string>> = {
  "#E2F1FF": "#3498DB",
  "#E6F6E9": "#16A085",
  "#FFF0CA": "#F1C40F",
  "#FBE5E9": "#C0392B",
  "#F9E2F3": "#D33682",
  "#F0EAFC": "#8E44AD",
};

/** The accent a saved option colour stands for. */
export function optionAccent(hex: string): string | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return LEGACY_PASTEL_ACCENTS[normalized] ?? normalized;
}

/** Everything that decides a pill's colour in one Base. */
export interface PillColorContext {
  paletteTemplateId?: PaletteTemplateId;
  /** Each property's pill strategy (`studioStrategies`). */
  strategies?: Readonly<Record<string, PropertyColorStrategy>>;
  /** Each option's colour, keyed by `encodeOptionKey` (`studioOverrides`). */
  overrides?: Readonly<Record<string, StoredOption>>;
  /** A property's display name, which the smart strategy also reads. */
  displayName?: (propertyId: string) => string | undefined;
}

/**
 * The one colour resolver for a value in a column: the option's own colour first, then the
 * property's strategy and the palette.
 */
export function pillColor(context: PillColorContext, propertyId: string, value: string): ResolvedColor {
  const identity = { propertyId, value };
  const strategy = effectivePropertyStrategy(
    propertyId,
    context.displayName?.(propertyId),
    context.strategies?.[propertyId],
  );
  const override = context.overrides?.[encodeOptionKey(identity)]?.override;
  return resolveColor(identity, override, strategy, context.paletteTemplateId);
}

/** A group heading takes the colour of the value it groups by. */
export const groupColor = pillColor;
