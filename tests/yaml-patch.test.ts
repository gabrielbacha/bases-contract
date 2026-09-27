import { describe, expect, it } from "vitest";

import { editYamlSequence, patchYamlMap, readYamlMap } from "../src/yaml-patch";

describe("readYamlMap", () => {
  it("distinguishes absent, malformed blocks, and malformed documents", () => {
    expect(readYamlMap("views: []\n", ["basesVisuals"]).status).toBe("absent");
    expect(readYamlMap("basesVisuals: [future]\n", ["basesVisuals"]).status).toBe("block-invalid");
    expect(readYamlMap("basesVisuals: [\n", ["basesVisuals"]).status).toBe("document-invalid");
  });

  it("rejects duplicate keys", () => {
    expect(readYamlMap("basesVisuals: {}\nbasesVisuals: {}\n", ["basesVisuals"]).status).toBe("document-invalid");
  });
});

describe("patchYamlMap", () => {
  it("keeps unrelated source byte-for-byte and preserves nested comments", () => {
    const source = [
      "# before",
      "filters: []",
      '"basesVisuals": # header',
      "  schemaVersion: 7 # version",
      "  future: { desktop: true } # unknown",
      "  propertyStrategies:",
      "    note.status:",
      "      mode: status # mode",
      "views: [] # after",
      "",
    ].join("\n");
    const result = patchYamlMap(source, ["basesVisuals"], {
      schemaVersion: 8,
      future: { desktop: true },
      propertyStrategies: { "note.status": { mode: "status", style: "solid" } },
    });

    expect(result.status).toBe("patched");
    expect(result.source.startsWith('# before\nfilters: []\n"basesVisuals": # header\n')).toBe(true);
    expect(result.source).toContain("schemaVersion: 8 # version");
    expect(result.source).toContain("future: { desktop: true } # unknown");
    expect(result.source).toContain("mode: status # mode");
    expect(result.source.endsWith("views: [] # after\n")).toBe(true);
  });

  it("preserves CRLF and returns the original source for a no-op", () => {
    const source = "basesVisuals:\r\n  schemaVersion: 7\r\nviews: []\r\n";
    expect(patchYamlMap(source, ["basesVisuals"], { schemaVersion: 7 })).toEqual({ status: "unchanged", source });
  });

  it("patches a view block without rewriting sibling views", () => {
    const source = [
      "views:",
      "  - type: table",
      "    name: First",
      "    basesVisualsView:",
      "      schemaVersion: 1",
      "      future: keep",
      "  - type: table # untouched",
      "    name: Second",
      "",
    ].join("\n");
    const result = patchYamlMap(source, ["views", 0, "basesVisualsView"], {
      schemaVersion: 2,
      future: "keep",
      columnAppearances: { "note.status": { bold: true } },
    });
    expect(result.status).toBe("patched");
    expect(result.source).toContain("schemaVersion: 2");
    expect(result.source).toContain("columnAppearances:");
    expect(result.source.endsWith("  - type: table # untouched\n    name: Second\n")).toBe(true);
    expect(readYamlMap(result.source, ["views", 0, "basesVisualsView"]).status).toBe("present");
  });

  it("treats malformed documents and malformed complete blocks as read-only", () => {
    expect(patchYamlMap("basesVisuals: [\n", ["basesVisuals"], { schemaVersion: 7 }).status).toBe("read-only");
    expect(patchYamlMap("basesVisuals: [future]\n", ["basesVisuals"], { schemaVersion: 7 }).status).toBe("read-only");
  });

  it("inserts and removes an extension block without changing foreign keys", () => {
    const source = "filters: []\nviews: []\n";
    const inserted = patchYamlMap(source, ["basesVisuals"], { schemaVersion: 7, future: true });
    expect(inserted.status).toBe("patched");
    expect(inserted.source).toContain("basesVisuals:\n  schemaVersion: 7\n  future: true\n");
    const removed = patchYamlMap(inserted.source, ["basesVisuals"], null);
    expect(removed).toEqual({ status: "patched", source });
  });

  it("patches JSON extension values without rewriting unrelated JSON text", () => {
    const source = '{ "foreign" : { "spacing": true }, "basesVisuals": {"schemaVersion":7}, "views": [] }';
    const patched = patchYamlMap(source, ["basesVisuals"], {
      schemaVersion: 8,
      future: { desktop: true },
    });
    expect(patched.status).toBe("patched");
    expect(patched.source.startsWith('{ "foreign" : { "spacing": true }, "basesVisuals": ')).toBe(true);
    expect(JSON.parse(patched.source)).toEqual({
      foreign: { spacing: true },
      basesVisuals: { schemaVersion: 8, future: { desktop: true } },
      views: [],
    });
  });
});

it.each([
  "basesEditor:\n  schemaVersion: 1\n  schemaVersion: 2\n",
  "basesEditor:\n  future:\n    enabled: true\n    enabled: false\n",
])("refuses duplicate keys anywhere within the target block", (source) => {
  expect(readYamlMap(source, ["basesEditor"]).status).toBe("document-invalid");
  expect(patchYamlMap(source, ["basesEditor"], { schemaVersion: 1 })).toMatchObject({ status: "read-only", source });
});

it("does not remove an existing empty mapping on a no-op save", () => {
  const source = "basesVisuals: {}\nviews: []\n";
  expect(patchYamlMap(source, ["basesVisuals"], {})).toEqual({ status: "unchanged", source });
});

it("treats mapping key order as irrelevant to no-op detection", () => {
  const source = "basesVisuals:\n  schemaVersion: 7\n  future: yes\n";
  expect(patchYamlMap(source, ["basesVisuals"], { future: "yes", schemaVersion: 7 })).toEqual({
    status: "unchanged",
    source,
  });
});

it("refuses to delete a map embedded in a flow-style parent", () => {
  const source = "views: [{name: Main, basesVisualsView: {schemaVersion: 2}}]\n";
  expect(patchYamlMap(source, ["views", 0, "basesVisualsView"], null)).toMatchObject({ status: "read-only", source });
});

it.each([
  "basesVisuals:\n  future: *missing\n",
  "defaults: &settings {value: 1}\nbasesVisuals:\n  future: *settings\n",
  "basesVisuals:\n  future: !custom value\n",
])("preserves unsupported aliases and tags without throwing or rewriting them", (source) => {
  expect(readYamlMap(source, ["basesVisuals"]).status).toBe("document-invalid");
  expect(patchYamlMap(source, ["basesVisuals"], { schemaVersion: 7 })).toMatchObject({ status: "read-only", source });
});

it("inserts a stable-ID record without reusing or changing a surviving node", () => {
  const source = "basesVisuals:\n  rules:\n    - id: a\n      bold: false # original rule\n";
  const desired = {
    rules: [
      { id: "new", bold: true },
      { id: "a", bold: false },
    ],
  };
  const result = patchYamlMap(source, ["basesVisuals"], desired);
  expect(result.status).toBe("patched");
  expect(readYamlMap(result.source, ["basesVisuals"])).toEqual({ status: "present", value: desired });
  expect(result.source).toContain("bold: false # original rule");
  expect(result.source.match(/# original rule/g)).toHaveLength(1);
});

describe("editYamlSequence", () => {
  const source = [
    'filters: file.ext == "md" # keep',
    "views:",
    "  # First view",
    "  - type: table",
    "    name: One # one",
    "    order: [file.name, note.price]",
    "  - type: table",
    "    name: Two",
    "  - type: table",
    "    name: Three",
    "summaries: {}",
    "",
  ].join("\n");
  it("removes, moves and inserts views, keeping comments and the rest of the file", () => {
    const removed = editYamlSequence(source, ["views"], { kind: "remove", index: 1 });
    expect(removed.status).toBe("patched");
    expect(removed.source).toContain("name: One # one");
    expect(removed.source).not.toContain("Two");
    expect(removed.source.startsWith('filters: file.ext == "md" # keep\nviews:\n')).toBe(true);
    expect(removed.source.endsWith("summaries: {}\n")).toBe(true);
    const moved = editYamlSequence(source, ["views"], { kind: "move", from: 2, to: 0 });
    const names = (text: string) => [...text.matchAll(/name: (\w+)/g)].map((match) => match[1]);
    expect(names(moved.source)).toEqual(["Three", "One", "Two"]);
    expect(moved.source).toContain("# First view");
    const inserted = editYamlSequence(source, ["views"], {
      kind: "insert",
      index: 3,
      value: { type: "table", name: "Four", order: ["file.name"] },
    });
    expect(names(inserted.source)).toEqual(["One", "Two", "Three", "Four"]);
    expect(inserted.source).toContain("summaries: {}\n");
    // Other items keep their exact text, flow lists and comments included.
    for (const result of [removed, moved, inserted]) {
      expect(result.source).toContain("    name: One # one\n    order: [file.name, note.price]\n");
    }
    expect(inserted.source).toContain("  - type: table\n    name: Four\n    order:\n      - file.name\n");
    // Without a final line break, moving the last item keeps the file ending as it was.
    const bare = "views:\n  - name: A\n  - name: B";
    expect(editYamlSequence(bare, ["views"], { kind: "move", from: 1, to: 0 }).source).toBe(
      "views:\n  - name: B\n  - name: A",
    );
  });
  it("refuses flow lists, missing items and out-of-range positions", () => {
    expect(editYamlSequence("views: [a, b]\n", ["views"], { kind: "remove", index: 0 }).status).toBe("read-only");
    expect(editYamlSequence(source, ["views"], { kind: "remove", index: 9 }).status).toBe("read-only");
    expect(editYamlSequence(source, ["views"], { kind: "insert", index: 9, value: {} }).status).toBe("read-only");
  });
});
