import {
  Document,
  YAMLSeq,
  isMap,
  isAlias,
  visit,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  isNode,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";

import { equalValues as deepEqual } from "./value-equality";

export type YamlPath = readonly (string | number)[];

export type PatchResult =
  | { status: "unchanged"; source: string }
  | { status: "patched"; source: string }
  | { status: "read-only"; source: string; reason: string };

export type ReadResult =
  | { status: "absent" }
  | { status: "present"; value: Record<string, unknown> }
  | { status: "block-invalid"; value: unknown }
  | { status: "document-invalid"; reason: string };

// One action often reads several blocks of the same source; reads share its parsed document.
let lastRead: { source: string; parsed: ReturnType<typeof parse> } | null = null;

/** Parses `source` for reading only: the document is shared, so callers must not change it. */
function parseForRead(source: string): ReturnType<typeof parse> {
  if (lastRead?.source !== source) lastRead = { source, parsed: parse(source) };
  return lastRead.parsed;
}

export function readYamlMap(source: string, path: YamlPath): ReadResult {
  const parsed = parseForRead(source);
  if ("reason" in parsed) return { status: "document-invalid", reason: parsed.reason };
  if (hasDuplicatePath(parsed.document, path)) {
    return { status: "document-invalid", reason: `Duplicate key at ${formatPath(path)}.` };
  }
  const node = parsed.document.getIn([...path], true);
  if (node === undefined) return { status: "absent" };
  if (!isMap(node)) return { status: "block-invalid", value: nodeToJson(node) };
  return { status: "present", value: node.toJSON() as Record<string, unknown> };
}

/**
 * Replaces only the addressed mapping node. Unrelated source stays byte-for-byte
 * identical, while existing YAML nodes retain comments and scalar style.
 */
export function patchYamlMap(source: string, path: YamlPath, desired: Record<string, unknown> | null): PatchResult {
  if (source.trimStart().startsWith("{")) return patchJsonMap(source, path, desired);
  const parsed = parse(source);
  if ("reason" in parsed) return { status: "read-only", source, reason: parsed.reason };
  if (hasDuplicatePath(parsed.document, path)) {
    return { status: "read-only", source, reason: `Duplicate key at ${formatPath(path)}.` };
  }

  const current = parsed.document.getIn([...path], true);
  if (current !== undefined && !isMap(current)) {
    return { status: "read-only", source, reason: `${formatPath(path)} is not a mapping.` };
  }
  if (current === undefined) {
    if (!desired || Object.keys(desired).length === 0) return { status: "unchanged", source };
    return insertMap(source, parsed.document, path, desired);
  }
  if (desired && deepEqual(current.toJSON(), desired)) return { status: "unchanged", source };
  if (!desired || Object.keys(desired).length === 0) {
    return removeMap(source, parsed.document, path, current);
  }
  if (deepEqual(current.toJSON(), desired)) return { status: "unchanged", source };

  const replacement = reconcileNode(parsed.document, current, desired);
  if (!isMap(replacement) || !current.range) {
    return { status: "read-only", source, reason: `Cannot safely patch ${formatPath(path)}.` };
  }
  const commentBefore = replacement.commentBefore;
  delete replacement.commentBefore;
  const serialized = serializeNode(
    replacement,
    indentationAt(source, current.range[0]),
    source.includes("\r\n") ? "\r\n" : "\n",
  );
  if (commentBefore !== undefined) replacement.commentBefore = commentBefore;
  const end = current.range[2];
  const trailingNewline =
    source.slice(current.range[0], end).endsWith("\n") && !serialized.endsWith("\n")
      ? source.includes("\r\n")
        ? "\r\n"
        : "\n"
      : "";
  return {
    status: "patched",
    source: `${source.slice(0, current.range[0])}${serialized}${trailingNewline}${source.slice(end)}`,
  };
}

const inRange = (index: number, length: number): boolean => Number.isInteger(index) && index >= 0 && index < length;

export type SequenceEdit =
  | { kind: "insert"; index: number; value: unknown }
  | { kind: "remove"; index: number }
  | { kind: "move"; from: number; to: number };

/**
 * Inserts, removes or moves one item of the addressed block sequence (such as `views`). Items move
 * as whole source lines, so every other item keeps its exact text, comments included; only an
 * inserted item is serialized. Source outside the sequence stays byte-for-byte identical.
 */
export function editYamlSequence(source: string, path: YamlPath, edit: SequenceEdit): PatchResult {
  if (source.trimStart().startsWith("{"))
    return { status: "read-only", source, reason: "JSON Bases are read-only here." };
  const parsed = parse(source);
  if ("reason" in parsed) return { status: "read-only", source, reason: parsed.reason };
  if (hasDuplicatePath(parsed.document, path)) {
    return { status: "read-only", source, reason: `Duplicate key at ${formatPath(path)}.` };
  }
  const current = parsed.document.getIn([...path], true);
  if (!isSeq(current) || !current.range || current.flow || !current.items.length) {
    return { status: "read-only", source, reason: `${formatPath(path)} is not a block list.` };
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  // Each item's text runs from the start of its "- " line (with the comment lines just above it)
  // to the start of the next item's; the last one ends after its final line.
  const starts = current.items.map((item) => {
    let start = lineStart(source, (item as Node).range![0]);
    for (;;) {
      const previous = lineStart(source, Math.max(0, start - 1));
      if (previous === start || !/^[ \t]*#/.test(source.slice(previous, start))) break;
      start = previous;
    }
    return start;
  });
  const lastEnd = (current.items[current.items.length - 1] as Node).range![2];
  let end = lastEnd;
  while (end < source.length && source[end - 1] !== "\n") end++;
  const tail = source.slice(0, end).endsWith("\n") ? "" : newline;
  const segments = starts.map(
    (start, index) => source.slice(start, starts[index + 1] ?? end) + (index === starts.length - 1 ? tail : ""),
  );
  if (edit.kind === "insert") {
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > segments.length)
      return { status: "read-only", source, reason: "The list position is out of range." };
    const dash = source.slice(lineStart(source, (current.items[0] as Node).range![0])).search(/-/);
    const item = new YAMLSeq();
    item.items = [parsed.document.createNode(edit.value) as Node];
    const text = `${" ".repeat(dash)}${serializeNode(item, dash, newline)}${newline}`;
    segments.splice(edit.index, 0, text);
  } else if (edit.kind === "remove") {
    if (!inRange(edit.index, segments.length))
      return { status: "read-only", source, reason: "The list item is missing." };
    segments.splice(edit.index, 1);
  } else {
    if (!inRange(edit.from, segments.length) || !inRange(edit.to, segments.length))
      return { status: "read-only", source, reason: "The list item is missing." };
    if (edit.from === edit.to) return { status: "unchanged", source };
    const [moved] = segments.splice(edit.from, 1);
    segments.splice(edit.to, 0, moved!);
  }
  // A list that ended the file without a final line break keeps ending without one.
  const joined = segments.join("");
  const body = tail ? joined.slice(0, -tail.length) : joined;
  return { status: "patched", source: `${source.slice(0, starts[0])}${body}${source.slice(end)}` };
}

function patchJsonMap(source: string, path: YamlPath, desired: Record<string, unknown> | null): PatchResult {
  const parsed = parse(source);
  if ("reason" in parsed) return { status: "read-only", source, reason: parsed.reason };
  if (hasDuplicatePath(parsed.document, path)) {
    return { status: "read-only", source, reason: `Duplicate key at ${formatPath(path)}.` };
  }
  const current = parsed.document.getIn([...path], true);
  if (current !== undefined && !isMap(current)) {
    return { status: "read-only", source, reason: `${formatPath(path)} is not a mapping.` };
  }
  if (current && desired && deepEqual(current.toJSON(), desired)) return { status: "unchanged", source };
  if (current?.range && desired) {
    return {
      status: "patched",
      source: `${source.slice(0, current.range[0])}${JSON.stringify(desired)}${source.slice(current.range[1])}`,
    };
  }

  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = parentPath.length ? parsed.document.getIn([...parentPath], true) : parsed.document.contents;
  if (typeof key !== "string" || !isMap(parent)) {
    return { status: "read-only", source, reason: `Cannot safely patch JSON ${formatPath(path)}.` };
  }
  if (current && !desired) return removeJsonPair(source, parent, key);
  if (!current && desired) return insertJsonPair(source, parent, key, desired);
  return { status: "unchanged", source };
}

function removeJsonPair(source: string, parent: YAMLMap, key: string): PatchResult {
  const pair = findPair(parent, key);
  if (!pair || !isScalar(pair.key) || !pair.key.range || !pair.value || typeof pair.value !== "object") {
    return { status: "read-only", source, reason: `Cannot locate JSON key ${key}.` };
  }
  const valueRange = (pair.value as Node).range;
  if (!valueRange) return { status: "read-only", source, reason: `Cannot locate JSON value ${key}.` };
  let start = pair.key.range[0];
  let end = valueRange[1];
  let cursor = start - 1;
  while (cursor >= 0 && /\s/.test(source[cursor] ?? "")) cursor -= 1;
  if (source[cursor] === ",") start = cursor;
  else {
    cursor = end;
    while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === ",") end = cursor + 1;
  }
  return { status: "patched", source: `${source.slice(0, start)}${source.slice(end)}` };
}

function insertJsonPair(source: string, parent: YAMLMap, key: string, desired: Record<string, unknown>): PatchResult {
  if (!parent.range) return { status: "read-only", source, reason: `Cannot locate JSON parent for ${key}.` };
  let closing = parent.range[1] - 1;
  while (closing >= 0 && source[closing] !== "}") closing -= 1;
  if (closing < 0) return { status: "read-only", source, reason: `Cannot locate JSON parent for ${key}.` };
  const hasEntries = parent.items.length > 0;
  const insertion = `${hasEntries ? "," : ""}${JSON.stringify(key)}:${JSON.stringify(desired)}`;
  return { status: "patched", source: `${source.slice(0, closing)}${insertion}${source.slice(closing)}` };
}

function parse(source: string): { document: Document.Parsed } | { reason: string } {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: false,
    strict: false,
    uniqueKeys: true,
  });
  const issues = [...document.errors, ...document.warnings];
  if (issues.length) return { reason: issues.map((issue) => issue.message).join("; ") };
  let unsupported = false;
  visit(document, (_key, node) => {
    if (isAlias(node) || ((isMap(node) || isSeq(node) || isScalar(node)) && (node.anchor || node.tag))) {
      unsupported = true;
      return visit.BREAK;
    }
    return undefined;
  });
  if (unsupported) return { reason: "YAML anchors, aliases, and explicit tags require a preservation-aware adapter." };
  return { document };
}

function reconcileNode(document: Document, current: Node, desired: unknown): Node {
  if (isMap(current) && isRecord(desired)) return reconcileMap(document, current, desired);
  if (isSeq(current) && Array.isArray(desired)) return reconcileSequence(document, current, desired);
  if (deepEqual(nodeToJson(current), desired)) return current;
  const replacement = document.createNode(desired) as Node;
  copyNodePresentation(current, replacement);
  return replacement;
}

function reconcileMap(document: Document, current: YAMLMap, desired: Record<string, unknown>): YAMLMap {
  const pairs = new Map<string, Pair>();
  for (const pair of current.items) {
    if (isPair(pair) && isScalar(pair.key) && typeof pair.key.value === "string") {
      pairs.set(pair.key.value, pair);
    }
  }
  current.items = Object.entries(desired).map(([key, value]) => {
    const pair = pairs.get(key);
    if (!pair) return document.createPair(key, value);
    if (pair.value && typeof pair.value === "object") {
      pair.value = reconcileNode(document, pair.value as Node, value);
    } else if (!deepEqual(pair.value, value)) {
      pair.value = document.createNode(value);
    }
    return pair;
  });
  return current;
}

function reconcileSequence(document: Document, current: YAMLSeq, desired: unknown[]): YAMLSeq {
  const identified = new Map<string, Node>();
  for (const item of current.items) {
    const json = isNode(item) ? nodeToJson(item) : item;
    if (isRecord(json) && typeof json.id === "string" && isNode(item)) {
      identified.set(json.id, item);
    }
  }
  current.items = desired.map((value, index) => {
    const existing = isRecord(value) && typeof value.id === "string" ? identified.get(value.id) : current.items[index];
    if (isNode(existing)) return reconcileNode(document, existing, value);
    return document.createNode(value);
  });
  return current;
}

function copyNodePresentation(current: Node, replacement: Node): void {
  if (current.comment !== undefined) replacement.comment = current.comment;
  if (current.commentBefore !== undefined) replacement.commentBefore = current.commentBefore;
  if (current.spaceBefore !== undefined) replacement.spaceBefore = current.spaceBefore;
  if (isScalar(current) && isScalar(replacement) && current.type !== undefined) {
    replacement.type = current.type;
  }
}

function insertMap(
  source: string,
  document: Document.Parsed,
  path: YamlPath,
  desired: Record<string, unknown>,
): PatchResult {
  if (path.length === 0) return { status: "read-only", source, reason: "Cannot insert the document root." };
  const key = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length ? document.getIn([...parentPath], true) : document.contents;
  if (typeof key !== "string" || !isMap(parent) || parent.flow || !parent.range) {
    return { status: "read-only", source, reason: `Cannot safely insert ${formatPath(path)}.` };
  }
  const indentation = childIndentation(source, parent);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const wrapper = new Document({ [key]: desired }).toString().trimEnd();
  const serialized = wrapper
    .split("\n")
    .map((line) => `${" ".repeat(indentation)}${line}`)
    .join(newline);
  const position = insertionPosition(source, parent.range[2]);
  const prefix = position > 0 && !source.slice(0, position).endsWith("\n") ? newline : "";
  return {
    status: "patched",
    source: `${source.slice(0, position)}${prefix}${serialized}${newline}${source.slice(position)}`,
  };
}

function removeMap(source: string, document: Document.Parsed, path: YamlPath, current: YAMLMap): PatchResult {
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length ? document.getIn([...parentPath], true) : document.contents;
  const key = path[path.length - 1];
  if (typeof key !== "string" || !isMap(parent) || parent.flow) {
    return { status: "read-only", source, reason: `Cannot safely remove ${formatPath(path)}.` };
  }
  const pair = findPair(parent, key);
  if (!pair || !isScalar(pair.key) || !pair.key.range || !current.range) {
    return { status: "read-only", source, reason: `Cannot locate ${formatPath(path)}.` };
  }
  const start = lineStart(source, pair.key.range[0]);
  const end = current.range[2];
  return { status: "patched", source: `${source.slice(0, start)}${source.slice(end)}` };
}

function serializeNode(node: Node, indentation: number, newline: string): string {
  const document = new Document();
  document.contents = node;
  const lines = document.toString().trimEnd().split("\n");
  return lines.map((line, index) => (index === 0 || !line ? line : `${" ".repeat(indentation)}${line}`)).join(newline);
}

function hasDuplicatePath(document: Document.Parsed, path: YamlPath): boolean {
  let node: unknown = document.contents;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!isSeq(node) || !node.items[segment]) return false;
      node = node.items[segment];
      continue;
    }
    if (!isMap(node)) return false;
    const matches = node.items.filter((pair) => keyValue(pair) === segment);
    if (matches.length > 1) return true;
    node = matches[0]?.value;
  }
  return false;
}

function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((pair) => keyValue(pair) === key);
}

function keyValue(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : undefined;
}

function nodeToJson(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node ? (node as { toJSON(): unknown }).toJSON() : node;
}

function indentationAt(source: string, offset: number): number {
  return offset - lineStart(source, offset);
}

function childIndentation(source: string, map: YAMLMap): number {
  const first = map.items.find((pair) => isScalar(pair.key) && pair.key.range);
  if (first && isScalar(first.key) && first.key.range) return indentationAt(source, first.key.range[0]);
  return map.range ? indentationAt(source, map.range[0]) + 2 : 0;
}

function insertionPosition(source: string, rangeEnd: number): number {
  return source[rangeEnd - 1] === "\n" ? rangeEnd : lineEnd(source, rangeEnd);
}

function lineStart(source: string, offset: number): number {
  const previous = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return previous < 0 ? 0 : previous + 1;
}

function lineEnd(source: string, offset: number): number {
  const next = source.indexOf("\n", offset);
  return next < 0 ? source.length : next + 1;
}

function formatPath(path: YamlPath): string {
  return path.map(String).join(".") || "$";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
