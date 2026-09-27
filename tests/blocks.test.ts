import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  declaredPropertyTypes,
  encodeOptionKey,
  KNOWN_VIEW_KEYS,
  normalizeBaseData,
  normalizeViewData,
  pillColor,
  readRowHeight,
  readYamlMap,
  resolveColor,
  setDeclaredOptionColor,
  storedRowHeight,
  writeBaseVisuals,
  writeViewVisuals,
  type ConditionalRule,
} from "../src/index";

const pluginRule = {
  id: "5338bf3d-109a-4a04-b46e-0b6108a70c65",
  name: "High Priority Rule",
  enabled: true,
  propertyId: "note.priority",
  operator: "equals",
  operand: "low",
  target: "row",
  scope: "view",
  color: { kind: "preset", name: "default" },
  fontColor: { kind: "custom", hex: "#C9C9C9" },
  overridePillColors: true,
};

const pluginBase = `basesVisuals:
  schemaVersion: 7
  futureSetting: kept
  propertyStrategies:
    note.status:
      mode: distinct
views:
  - type: table
    name: Main
    order: [file.name, note.status]
    basesVisualsView:
      schemaVersion: 1
      futureViewSetting: 3
      rules:
        - ${JSON.stringify(pluginRule)}
        - id: second
          name: Second
          enabled: true
          propertyId: note.status
          operator: contains
          operand: done
          target: cell
          scope: view
          color: { kind: custom, hex: "#3498DB" }
          backgroundOpacity: 30
          extra: keep me
        - id: from-the-future
          operator: matches-regex
          propertyId: note.status
          target: cell
`;

function viewAt(text: string) {
  const read = readYamlMap(text, ["views", 0, "basesVisualsView"]);
  return normalizeViewData(read.status === "present" ? read.value : undefined);
}

describe("view blocks", () => {
  it("reads old rules with their meaning and keeps what it cannot read on a write", () => {
    const baseline = viewAt(pluginBase);
    expect(baseline.rules.map((rule) => rule.backgroundOpacity)).toEqual([3, 30]);
    const toggled = {
      ...baseline,
      rules: baseline.rules.map((rule, index) => (index === 0 ? { ...rule, enabled: false } : rule)),
    };
    const result = writeViewVisuals(pluginBase, 0, baseline, toggled);
    expect(result.status).toBe("saved");
    const block = parse(result.source).views[0].basesVisualsView;
    expect(block.schemaVersion).toBe(3);
    expect(block.futureViewSetting).toBe(3);
    expect(block.rules[0]).toMatchObject({ enabled: false, color: { kind: "preset", name: "default" } });
    expect(block.rules[0].backgroundOpacity).toBe(3);
    expect(block.rules[0].fontColor).toEqual({ kind: "custom", hex: "#C9C9C9" });
    expect(block.rules[1]).toMatchObject({ backgroundOpacity: 30, extra: "keep me" });
    expect(block.rules[2]).toEqual({
      id: "from-the-future",
      operator: "matches-regex",
      propertyId: "note.status",
      target: "cell",
    });
  });

  it("does not rewrite the file when no choice changed, even for an old block", () => {
    const baseline = viewAt(pluginBase);
    const result = writeViewVisuals(pluginBase, 0, baseline, structuredClone(baseline));
    expect(result).toMatchObject({ status: "saved", source: pluginBase });
  });

  it("rebases onto edits made meanwhile and reports same-field conflicts", () => {
    const baseline = viewAt(pluginBase);
    const meanwhile = pluginBase.replace("operand: done", "operand: finished");
    const renamed = { ...baseline, rules: baseline.rules.map((rule) => ({ ...rule, name: `${rule.name}!` })) };
    const merged = writeViewVisuals(meanwhile, 0, baseline, renamed);
    expect(merged.status).toBe("saved");
    const rules = parse(merged.source).views[0].basesVisualsView.rules as ConditionalRule[];
    expect(rules[1]).toMatchObject({ name: "Second!", operand: "finished" });

    const changed = { ...baseline, rules: baseline.rules.map((rule) => ({ ...rule, operand: "other" })) };
    const conflict = writeViewVisuals(meanwhile, 0, baseline, changed);
    expect(conflict.status).toBe("conflict");
    expect(conflict.source).toBe(meanwhile);
  });

  it("never rewrites a block saved by a newer version", () => {
    const newer = pluginBase.replace("      schemaVersion: 1", "      schemaVersion: 9");
    const baseline = viewAt(newer);
    const result = writeViewVisuals(newer, 0, baseline, { ...baseline, rules: [] });
    expect(result.status).toBe("read-only");
    expect(result.source).toBe(newer);
  });
});

describe("the Base-wide block", () => {
  it("keeps unknown fields and migrates only on an intentional edit", () => {
    const current = normalizeBaseData(parse(pluginBase).basesVisuals)!;
    expect(writeBaseVisuals(pluginBase, structuredClone(current))).toMatchObject({
      status: "saved",
      source: pluginBase,
    });
    const edited = {
      ...current,
      propertyStrategies: { ...current.propertyStrategies, "note.priority": { mode: "priority" as const } },
    };
    const result = writeBaseVisuals(pluginBase, edited);
    expect(result.status).toBe("saved");
    const block = parse(result.source).basesVisuals;
    expect(block).toMatchObject({ schemaVersion: 8, futureSetting: "kept" });
    expect(block.propertyStrategies["note.priority"]).toEqual({ mode: "priority" });
  });
});

describe("pill colours", () => {
  const base = parse(readFileSync(new URL("./fixtures/sample.base", import.meta.url), "utf8"));
  const declared = Object.fromEntries(
    Object.entries(declaredPropertyTypes(base)).map(([id, type]) => [id, type.options]),
  );

  it("takes a declared option colour first, then an override, then the strategy", () => {
    const context = {
      declared: { ...declared, "note.status": [{ value: "Shortlist", color: "#16A085" }] },
      overrides: {
        [encodeOptionKey({ propertyId: "note.status", value: "Rejected" })]: {
          propertyId: "note.status",
          value: "Rejected",
          override: { kind: "custom" as const, hex: "#C0392B" },
        },
      },
      strategies: { "note.status": { mode: "distinct" as const } },
    };
    expect(pillColor(context, "note.status", "Shortlist").dot).toBe("#16A085");
    expect(pillColor(context, "note.status", "Rejected").dot).toBe("#C0392B");
    const automatic = pillColor(context, "note.status", "Parked");
    const strategy = resolveColor({ propertyId: "note.status", value: "Parked" }, undefined, { mode: "distinct" });
    expect(automatic.dot).toBe(strategy.dot);
  });

  it("reads declared options from the Base", () => {
    expect(declared["note.direction"]).toEqual([{ value: "North", label: "North" }, { value: "South", color: "#8E44AD" }]);
    expect(pillColor({ declared }, "note.direction", "South").dot).toBe("#8E44AD");
  });

  it("reads old pastel option colours as their accents", () => {
    const context = { declared: { "note.kind": [{ value: "A", color: "#e2f1ff" }] } };
    expect(pillColor(context, "note.kind", "A").dot).toBe("#3498DB");
  });

  it("sets one declared option colour and keeps the rest of the block", () => {
    const text = `basesEditor:
  schemaVersion: 1
  propertyTypes:
    note.kind:
      type: select
      note: keep
      options:
        - value: A
          label: Alpha
        - B
`;
    const result = setDeclaredOptionColor(text, "note.kind", "B", "#16a085");
    expect(result.status).toBe("patched");
    const kind = parse(result.source).basesEditor.propertyTypes["note.kind"];
    expect(kind.note).toBe("keep");
    expect(kind.options).toEqual([
      { value: "A", label: "Alpha" },
      { value: "B", color: "#16A085" },
    ]);
    expect(setDeclaredOptionColor(result.source, "note.kind", "B", "#16A085").status).toBe("unchanged");
    expect(setDeclaredOptionColor(text, "note.kind", "C", "#16A085").status).toBe("read-only");
  });
});

describe("shared keys and row heights", () => {
  it("knows the keys old plugin releases wrote into views", () => {
    for (const key of ["basesVisualsBase", "basesVisualsColumnAppearance", "basesVisualsDateFormats"])
      expect(KNOWN_VIEW_KEYS.has(key)).toBe(true);
  });

  it("stores the default row height as absent", () => {
    expect(readRowHeight(undefined)).toBe("short");
    expect(readRowHeight("short")).toBe("short");
    expect(readRowHeight("tall")).toBe("tall");
    expect(storedRowHeight("short")).toBeUndefined();
    expect(storedRowHeight("extra")).toBe("extra");
  });
});

describe("writing the Base-wide block (ported from Bases Visuals)", () => {
  const empty = { schemaVersion: 8, options: {}, knownProperties: {}, rules: [], propertyStrategies: {} };

  it("replaces only the extension block and removes legacy per-view copies", () => {
    const source = [
      "# human comment",
      "filters:",
      "  and:",
      '    - file.ext == "md"',
      "views:",
      "  - type: table",
      "    name: Main",
      "    basesVisualsBase:",
      "      schemaVersion: 6",
      "      options: {}",
      "    order:",
      "      - file.name",
      "",
    ].join("\n");
    const next = writeBaseVisuals(source, {
      ...empty,
      propertyStrategies: { "note.status": { mode: "status" } },
    }).source;
    expect(next).toContain('# human comment\nfilters:\n  and:\n    - file.ext == "md"\n');
    expect(next).toContain("basesVisuals:\n  schemaVersion: 8\n  propertyStrategies:");
    expect(next).not.toContain("basesVisualsBase");
    expect(next).toContain("    order:\n      - file.name\n");
  });

  it("keeps unknown top-level and nested fields", () => {
    const identity = { propertyId: "note.status", value: "Done" };
    const optionKey = encodeOptionKey(identity);
    const source = JSON.stringify({
      basesVisuals: {
        schemaVersion: 8,
        futureTopLevel: { desktopOnly: true },
        options: {
          [optionKey]: { ...identity, override: { kind: "preset", name: "green-sea" }, futureOptionField: "keep me" },
          futureMalformedOption: { future: true },
        },
        rules: [
          {
            id: "shared-rule",
            name: "Shared",
            enabled: true,
            propertyId: "note.status",
            operator: "equals",
            operand: "Done",
            target: "cell",
            scope: "base",
            futureRuleField: { renderer: "detail" },
          },
        ],
        propertyStrategies: { "note.status": { mode: "status", style: "soft", futureStrategyField: 42 } },
      },
      views: [],
    });
    const next = writeBaseVisuals(source, {
      ...empty,
      options: { [optionKey]: { ...identity, override: { kind: "preset", name: "peter-river" } } },
      rules: [
        {
          id: "shared-rule",
          name: "Shared",
          enabled: true,
          propertyId: "note.status",
          operator: "equals",
          operand: "Done",
          target: "cell",
          scope: "base",
        },
      ],
      propertyStrategies: { "note.status": { mode: "status", style: "solid" } },
    }).source;
    const persisted = (JSON.parse(next) as { basesVisuals: Record<string, any> }).basesVisuals;
    expect(persisted.futureTopLevel).toEqual({ desktopOnly: true });
    expect(persisted.options[optionKey].futureOptionField).toBe("keep me");
    expect(persisted.options[optionKey].override).toEqual({ kind: "preset", name: "peter-river" });
    expect(persisted.options.futureMalformedOption).toEqual({ future: true });
    expect(persisted.rules[0].futureRuleField).toEqual({ renderer: "detail" });
    expect(persisted.propertyStrategies["note.status"]).toMatchObject({ style: "solid", futureStrategyField: 42 });
  });

  it("keeps option and strategy variants it cannot read", () => {
    const block = {
      schemaVersion: 8,
      options: {
        future: {
          propertyId: "note.status",
          value: "Done",
          override: { kind: "gradient", from: "#000000", to: "#FFFFFF" },
        },
      },
      propertyStrategies: { "note.status": { mode: "gradient", direction: 45 } },
      paletteTemplateId: "ember",
    };
    const source = JSON.stringify({ basesVisuals: block, views: [] });
    const persisted = (
      JSON.parse(writeBaseVisuals(source, { ...empty, rawSource: block }).source) as {
        basesVisuals: Record<string, unknown>;
      }
    ).basesVisuals;
    expect(persisted.options).toEqual(block.options);
    expect(persisted.propertyStrategies).toEqual(block.propertyStrategies);
  });

  it("merges concurrent edits to different fields of the same strategy", () => {
    const baseline = { schemaVersion: 8, propertyStrategies: { "note.status": { mode: "status", style: "soft" } } };
    const source = JSON.stringify({
      basesVisuals: { ...baseline, propertyStrategies: { "note.status": { mode: "status", style: "solid" } } },
      views: [],
    });
    const next = writeBaseVisuals(source, {
      ...empty,
      propertyStrategies: { "note.status": { mode: "priority", style: "soft" } },
      rawSource: baseline,
    }).source;
    expect(
      (JSON.parse(next) as { basesVisuals: { propertyStrategies: Record<string, unknown> } }).basesVisuals
        .propertyStrategies["note.status"],
    ).toEqual({ mode: "priority", style: "solid" });
  });

  it("does not rewrite a block saved by a newer version", () => {
    const source = JSON.stringify({ basesVisuals: { schemaVersion: 99, futureTopLevel: true }, views: [] });
    const result = writeBaseVisuals(source, { ...empty, propertyStrategies: { "note.status": { mode: "status" } } });
    expect(result.status).toBe("read-only");
    expect(result.source).toBe(source);
  });

  it("rebases onto a different strategy changed by another editor", () => {
    const baseline = {
      schemaVersion: 8,
      propertyStrategies: { "note.status": { mode: "status" }, "note.priority": { mode: "priority" } },
    };
    const source = JSON.stringify({
      basesVisuals: {
        ...baseline,
        propertyStrategies: { ...baseline.propertyStrategies, "note.status": { mode: "status", style: "solid" } },
      },
      views: [],
    });
    const next = writeBaseVisuals(source, {
      ...empty,
      propertyStrategies: {
        "note.status": { mode: "status" },
        "note.priority": { mode: "priority", style: "outline" },
      },
      rawSource: baseline,
    }).source;
    expect(
      (JSON.parse(next) as { basesVisuals: { propertyStrategies: Record<string, unknown> } }).basesVisuals
        .propertyStrategies,
    ).toEqual({
      "note.status": { mode: "status", style: "solid" },
      "note.priority": { mode: "priority", style: "outline" },
    });
  });

  it("leaves a malformed block untouched", () => {
    const source = JSON.stringify({ basesVisuals: ["future", "shape"], views: [] });
    const result = writeBaseVisuals(source, { ...empty, propertyStrategies: { "note.status": { mode: "status" } } });
    expect(result).toMatchObject({ status: "read-only", source });
  });
});
