/**
 * Names the user types are made valid here instead of being refused: record names become names a
 * file can have on every system (and that wiki links can name), and field names become property keys.
 */

/** Separators a file name cannot hold; they become "-". */
const SEPARATORS = /[/\\|]/g;
/** Other characters no file name can hold on some system, or that end a wiki link target; they go. */
// eslint-disable-next-line no-control-regex -- File names must not contain control characters.
const FORBIDDEN_IN_NAME = /[*?"<>[\]#^\u0000-\u001f\u007f]/g;
/** Device names Windows reserves, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 120;
const MAX_KEY_LENGTH = 60;

/**
 * A record name made from what the user typed: ":" becomes " - ", "/", "\\" and "|" become "-",
 * other characters a file name or a wiki link cannot hold go, white space collapses, leading dots
 * (hidden files) and trailing dots or spaces go, and a reserved device name gets "-1". An empty
 * result is "Untitled".
 */
export function noteNameFrom(input: string): string {
  let name = input
    .normalize("NFC")
    .replace(/\.md$/i, "")
    .replace(/\s*:\s*/g, " - ")
    .replace(SEPARATORS, "-")
    .replace(FORBIDDEN_IN_NAME, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[.\s]+$/, "");
  if (RESERVED_NAME.test(name)) name = `${name}-1`;
  return name || "Untitled";
}

/** `name`, or "`name` 2", "`name` 3"…: the first that `taken` does not hold (compared without letter case). */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  for (let copy = 2; ; copy++) {
    const candidate = `${name} ${copy}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * A property key made from a field name: letters without accents, lower case, other characters as
 * "_", starting with a letter ("field_" is put in front otherwise), and not one of `taken` ("_2",
 * "_3"… is added). "Due date" → "due_date", "Été" → "ete", "2nd" → "field_2nd".
 */
export function propertyKeyFrom(label: string, taken: Iterable<string> = [], fallback = "field"): string {
  const used = new Set([...taken].map((key) => key.replace(/^note\./, "").toLowerCase()));
  let key = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, MAX_KEY_LENGTH);
  if (!/^[a-z]/.test(key)) key = key ? `${fallback}_${key}` : fallback;
  if (!used.has(key)) return key;
  for (let copy = 2; ; copy++) if (!used.has(`${key}_${copy}`)) return `${key}_${copy}`;
}

/**
 * A formula name made from what the user typed: like a property key, but with "_" only (formulas
 * are named in expressions as `formula.<name>`). "Total (EUR)" → "total_eur".
 */
export function formulaNameFrom(label: string, taken: Iterable<string> = []): string {
  return propertyKeyFrom(label.replaceAll("-", " "), taken, "formula");
}
