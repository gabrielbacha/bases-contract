import { normalizeHex } from "./colors";
import { isRecord } from "./normalize";
import { patchYamlMap, readYamlMap, type PatchResult } from "./yaml-patch";

/** The Base-wide block with column types, declared options and record defaults. */
export const EDITOR_KEY = "basesEditor";
/** The per-view block with table settings that Obsidian has no key for. */
export const EDITOR_VIEW_KEY = "basesEditorView";
export const EDITOR_SCHEMA_VERSION = 1;
export const EDITOR_VIEW_SCHEMA_VERSION = 2;

/** A declared option of a select or multi-select column. Its `color` is an accent hex. */
export interface DeclaredOption {
  value: string;
  label?: string;
  color?: string;
}

export interface DeclaredPropertyType {
  type: string;
  options: DeclaredOption[];
}

/** Whether a `basesEditor` block was saved by a newer contract; it is read but never rewritten. */
export function isNewerEditorSchema(value: unknown): boolean {
  return isRecord(value) && typeof value.schemaVersion === "number" && value.schemaVersion > EDITOR_SCHEMA_VERSION;
}

export function isNewerEditorViewSchema(value: unknown): boolean {
  return isRecord(value) && typeof value.schemaVersion === "number" && value.schemaVersion > EDITOR_VIEW_SCHEMA_VERSION;
}

/** One declared option, from its saved form (a plain string in early files, or a mapping). */
export function readDeclaredOption(value: unknown): DeclaredOption | null {
  if (typeof value === "string") return value ? { value } : null;
  if (!isRecord(value) || typeof value.value !== "string" || !value.value) return null;
  const color = typeof value.color === "string" ? normalizeHex(value.color) : null;
  return {
    value: value.value,
    ...(typeof value.label === "string" && value.label ? { label: value.label } : {}),
    ...(color ? { color } : {}),
  };
}

/** The declared column types of a parsed Base, by property id (for example `note.status`). */
export function declaredPropertyTypes(base: unknown): Record<string, DeclaredPropertyType> {
  const editor = isRecord(base) ? base[EDITOR_KEY] : undefined;
  const types = isRecord(editor) && isRecord(editor.propertyTypes) ? editor.propertyTypes : {};
  const result: Record<string, DeclaredPropertyType> = {};
  for (const [propertyId, annotation] of Object.entries(types)) {
    if (!isRecord(annotation) || typeof annotation.type !== "string") continue;
    const options = Array.isArray(annotation.options)
      ? annotation.options.flatMap((option) => {
          const declared = readDeclaredOption(option);
          return declared ? [declared] : [];
        })
      : [];
    result[propertyId] = { type: annotation.type, options };
  }
  return result;
}

/** Whether a declared type shows its values as pills. */
export function isOptionType(type: string | undefined): boolean {
  return type === "select" || type === "multiSelect";
}

/**
 * Sets (or with `null`, removes) the colour of one declared option. Every other field of the
 * block, the column and the option is kept. Returns `unchanged` when the colour is already set.
 */
export function setDeclaredOptionColor(
  source: string,
  propertyId: string,
  value: string,
  color: string | null,
): PatchResult {
  const read = readYamlMap(source, [EDITOR_KEY]);
  if (read.status !== "present") {
    const reason = read.status === "document-invalid" ? read.reason : "The Base declares no option types.";
    return { status: "read-only", source, reason };
  }
  if (isNewerEditorSchema(read.value)) return { status: "read-only", source, reason: "basesEditor is newer." };
  const types = isRecord(read.value.propertyTypes) ? read.value.propertyTypes : {};
  const annotation = types[propertyId];
  if (!isRecord(annotation) || !Array.isArray(annotation.options))
    return { status: "read-only", source, reason: `${propertyId} declares no options.` };
  const hex = color === null ? null : normalizeHex(color);
  if (color !== null && !hex) return { status: "read-only", source, reason: "The colour is not a hex colour." };
  let found = false;
  const options = annotation.options.map((option) => {
    if (readDeclaredOption(option)?.value !== value) return option;
    found = true;
    const next: Record<string, unknown> = isRecord(option) ? { ...option } : { value };
    if (hex) next.color = hex;
    else delete next.color;
    return next;
  });
  if (!found) return { status: "read-only", source, reason: `${value} is not a declared option.` };
  return patchYamlMap(source, [EDITOR_KEY], {
    ...read.value,
    propertyTypes: { ...types, [propertyId]: { ...annotation, options } },
  });
}
