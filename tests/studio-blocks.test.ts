import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  encodeOptionKey,
  hasStatusCategories,
  optionCategory,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  studioDefaultTemplate,
  studioLinkTarget,
  studioTemplates,
  type StudioProperty,
  KNOWN_VIEW_KEYS,
  mergeStudioBase,
  mergeStudioView,
  migrateToStudio,
  pillColor,
  readRowHeight,
  readStudioBase,
  readStudioView,
  removeStudioBaseProperties,
  removeStudioViewProperties,
  renameStudioBaseProperty,
  renameStudioViewProperty,
  resolveColumnAppearance,
  storedRowHeight,
  storedRules,
  studioBaseAppearances,
  studioOverrides,
  studioPalette,
  studioPillContext,
  studioRules,
  studioStrategies,
  studioViewAppearances,
  studioWrapColumns,
  updateStudioBase,
  updateStudioView,
  writeStudioBase,
  writeStudioView,
  type StudioBase,
  type StudioView,
} from "../src/index";

/** A Base with every old block and key both apps wrote. */
const LEGACY = `# The Base
filters: file.ext == "md"
basesVisuals:
  schemaVersion: 7
  paletteTemplateId: ember
  futureSetting: kept
  propertyStrategies:
    note.status:
      mode: status
      style: solid
      wrapPills: true
    note.tags:
      mode: smart
  options:
    note.status::Done:
      propertyId: note.status
      value: Done
      override: { kind: preset, name: green-sea }
    note.status::Parked:
      propertyId: note.status
      value: Parked
      override: { kind: disabled }
    note.city::Rome:
      propertyId: note.city
      value: Rome
      override: { kind: custom, hex: "#123456" }
  rules:
    - id: base-rule
      name: Late
      enabled: true
      propertyId: note.status
      operator: equals
      operand: Late
      target: row
      scope: base
      color: { kind: preset, name: pomegranate }
      extra: keep me
    - name: No id
      enabled: true
      propertyId: note.status
      operator: is-empty
      target: cell
      scope: base
    - id: odd
      propertyId: note.status
      operator: matches-regex
      target: cell
  columnAppearances:
    note.status: { tone: muted, bold: false }
    note.city: { tone: default, bold: false }
basesEditor:
  schemaVersion: 1
  tableUi: { pinnedViews: [abc] }
  propertyTypes:
    note.status:
      type: select
      futureType: kept
      options:
        - value: Todo
          color: "#E2F1FF"
        - value: Done
          color: "#8E44AD"
          note: keep
        - Parked
    note.price:
      type: number
      currency: AED
  recordDefaults:
    note.status: Todo
views:
  - type: table
    name: Main
    order: [file.name, note.status]
    basesEditorView:
      schemaVersion: 2
      id: view-1
      renderer: board
      wrapColumns: [note.notes]
      board: { groupBy: note.status }
    basesVisualsView:
      schemaVersion: 1
      futureView: preserve
      rules:
        - id: view-rule
          name: Tint
          enabled: true
          propertyId: note.city
          operator: contains
          operand: R
          target: cell
          scope: view
          color: { kind: custom, hex: "#3498DB" }
      columnAppearances:
        note.status: { tone: default, bold: false }
  - type: table
    name: Other
    basesVisualsColumnAppearance:
      note.city: { tone: faint, bold: true }
  - type: cards # untouched
    name: Cards
`;

const root = (source: string): Record<string, unknown> => parse(source) as Record<string, unknown>;
const view = (source: string, index: number): unknown => (root(source).views as unknown[])[index];
const migrated = (source: string): string => {
  const result = migrateToStudio(source);
  if (result.status === "read-only") throw new Error(result.reason);
  return result.source;
};

describe("reading", () => {
  it("reads the old blocks as one basesStudio block, without changing the file", () => {
    const base = readStudioBase(root(LEGACY));
    expect(base.palette).toBe("ember");
    expect(base.futureSetting).toBe("kept");
    expect(base.tableUi).toEqual({ pinnedViews: ["abc"] });
    expect(base.properties?.["note.status"]).toEqual({
      type: "select",
      futureType: "kept",
      options: [
        // An old pastel colour is read as the accent it stood for.
        { value: "Todo", color: "#3498DB" },
        // A declared colour was shown before an override, so it stays.
        { value: "Done", color: "#8E44AD", note: "keep" },
        { value: "Parked", color: "none" },
      ],
      pills: { mode: "status", style: "solid", wrap: true },
      style: { tone: "muted" },
      default: "Todo",
    });
    // An override for a value with no declared options keeps its colour.
    expect(base.properties?.["note.city"]).toEqual({ options: [{ value: "Rome", color: "#123456" }] });
    expect(base.properties?.["note.price"]).toEqual({ type: "number", currency: "AED" });
    expect(base.properties?.["note.tags"]).toBeUndefined();
  });

  it("makes old rules exact: their meant opacity, an id, no scope; unknown fields and rules stay", () => {
    const rules = readStudioBase(root(LEGACY)).rules as Record<string, unknown>[];
    expect(rules[0]).toMatchObject({ id: "base-rule", backgroundOpacity: 12, extra: "keep me" });
    expect(rules[0]).not.toHaveProperty("scope");
    expect(rules[1]).toMatchObject({ id: "migrated-rule-1", name: "No id" });
    expect(rules[2]).toEqual({ id: "odd", propertyId: "note.status", operator: "matches-regex", target: "cell" });
    expect(studioRules(readStudioBase(root(LEGACY)), "base").map((rule) => rule.id)).toEqual([
      "base-rule",
      "migrated-rule-1",
    ]);
  });

  it("reads each view's settings, wrap, styles and rules into its basesStudio block", () => {
    const main = readStudioView(view(LEGACY, 0));
    expect(main).toMatchObject({ id: "view-1", renderer: "board", board: { groupBy: "note.status" } });
    expect(main.futureView).toBe("preserve");
    expect(studioWrapColumns(main)).toEqual(["note.notes"]);
    // A default view style is kept: it turns the Base's style off in this view.
    expect(main.columns?.["note.status"]).toEqual({ style: {} });
    expect(studioRules(main, "view")[0]).toMatchObject({ id: "view-rule", scope: "view", backgroundOpacity: 12 });
    expect(readStudioView(view(LEGACY, 1)).columns).toEqual({ "note.city": { style: { tone: "faint", bold: true } } });
  });

  it("resolves the same colours, strategies and styles as the old blocks did", () => {
    const base = readStudioBase(root(LEGACY));
    const main = readStudioView(view(LEGACY, 0));
    expect(studioPalette(base)).toBe("ember");
    expect(studioStrategies(base)).toEqual({ "note.status": { mode: "status", style: "solid", wrapPills: true } });
    const context = studioPillContext(base);
    expect(pillColor(context, "note.status", "Done")).toMatchObject({ kind: "custom", dot: "#8E44AD" });
    expect(pillColor(context, "note.city", "Rome")).toMatchObject({ kind: "custom", dot: "#123456" });
    expect(pillColor(context, "note.status", "Parked").kind).toBe("disabled");
    expect(resolveColumnAppearance("note.status", studioBaseAppearances(base), studioViewAppearances(main))).toEqual({
      appearance: { tone: "default", bold: false },
      scope: "view",
    });
    expect(resolveColumnAppearance("note.status", studioBaseAppearances(base), {}).appearance.tone).toBe("muted");
  });

  it("prefers basesStudio when a file has both forms", () => {
    const both = `basesStudio:\n  version: 1\n  palette: editorial\n${LEGACY}`;
    expect(readStudioBase(root(both))).toEqual({ version: 1, palette: "editorial" });
  });
});

describe("migration", () => {
  it("moves every old block into basesStudio and reads the same afterwards", () => {
    const next = migrated(LEGACY);
    expect(next).not.toMatch(/basesEditor|basesVisuals(?!DateFormats)/);
    expect(next.startsWith("# The Base\nfilters: file.ext == \"md\"\n")).toBe(true);
    expect(next).toContain("  - type: cards # untouched\n    name: Cards\n");
    const after = root(next);
    expect(after.basesStudio).toEqual({ version: 1, ...readStudioBase(root(LEGACY)) });
    for (const index of [0, 1, 2]) expect(readStudioView(view(next, index))).toEqual(readStudioView(view(LEGACY, index)));
    expect(migrateToStudio(next)).toEqual({ status: "unchanged", source: next });
  });

  it("keeps foreign keys, and refuses old blocks saved by a newer version", () => {
    const fixture = readFileSync(new URL("./fixtures/compatibility.base", import.meta.url), "utf8");
    expect(migrateToStudio(fixture)).toMatchObject({ status: "read-only", reason: expect.stringContaining("basesEditor") });
    const current = fixture.replace("schemaVersion: 42", "schemaVersion: 1");
    const next = migrated(current);
    const base = readStudioBase(root(next));
    expect(base.future).toEqual({ owner: "future-client" });
    expect(base.properties?.["note.status"]).toMatchObject({
      futureType: { enabled: true },
      options: [{ value: "blocked/awaiting::日本語", label: "Blocked", futureOption: "keep" }],
    });
    const main = view(next, 0) as Record<string, unknown>;
    expect(main.basesVisualsDateFormats).toEqual({ "note.checked": "YYYY-MM-DD" });
    expect(main.basesStudio).toEqual({ futureView: "preserve", columns: { "note.status": { style: { bold: true } } } });
    // Obsidian's own `properties` are never touched.
    expect(root(next).properties).toEqual(root(current).properties);
  });

  it("migrates a JSON Base", () => {
    const json = JSON.stringify({ basesEditor: { schemaVersion: 1, propertyTypes: { "note.a": { type: "number" } } }, views: [] }, null, 2);
    const next = migrated(json);
    expect(JSON.parse(next)).toEqual({ views: [], basesStudio: { version: 1, properties: { "note.a": { type: "number" } } } });
  });

  it("migrates the sample Base", () => {
    const sample = readFileSync(new URL("./fixtures/sample.base", import.meta.url), "utf8");
    const next = migrated(sample);
    expect(root(next).basesStudio).toMatchObject({
      properties: {
        "note.status": { pills: { mode: "distinct" } },
        "note.direction": { type: "select", options: [{ value: "North", label: "North" }, { value: "South", color: "#8E44AD" }] },
      },
    });
    expect(readStudioView(view(next, 0))).toEqual({ frozenColumnCount: 1 });
  });
});

describe("writing", () => {
  it("does not change the file, or migrate it, when nothing changed", () => {
    const base = readStudioBase(root(LEGACY));
    expect(writeStudioBase(LEGACY, base, structuredClone(base))).toMatchObject({ status: "saved", source: LEGACY });
    expect(updateStudioView(LEGACY, 0, () => undefined)).toMatchObject({ status: "saved", source: LEGACY });
  });

  it("migrates the whole file on the first intentional edit", () => {
    const result = updateStudioBase(LEGACY, (block) => {
      block.properties!["note.status"]!.options!.push({ value: "Late", color: "carrot" });
    });
    expect(result.status).toBe("saved");
    const next = result.source;
    expect(next).not.toContain("basesEditor");
    expect(next).not.toContain("basesVisualsView");
    const options = readStudioBase(root(next)).properties?.["note.status"]?.options?.map((option) => option.value);
    expect(options).toEqual(["Todo", "Done", "Parked", "Late"]);
    expect(readStudioView(view(next, 1)).columns?.["note.city"]?.style).toEqual({ tone: "faint", bold: true });
  });

  it("merges edits to different fields made meanwhile, and reports edits to the same field", () => {
    const start = migrated(LEGACY);
    const baseline = readStudioBase(root(start));
    const theirs = updateStudioBase(start, (block) => {
      block.properties!["note.price"]!.currency = "EUR";
      block.properties!["note.status"]!.options![0]!.color = "wisteria";
    }).source;
    const mine = structuredClone(baseline);
    mine.properties!["note.status"]!.style = { tone: "faint" };
    mine.properties!["note.status"]!.options![1]!.label = "Finished";
    const merged = writeStudioBase(theirs, baseline, mine);
    expect(merged.status).toBe("saved");
    const status = readStudioBase(root(merged.source)).properties?.["note.status"];
    expect(status?.style).toEqual({ tone: "faint" });
    expect(status?.options?.[0]).toEqual({ value: "Todo", color: "wisteria" });
    expect(status?.options?.[1]).toMatchObject({ value: "Done", label: "Finished" });
    expect(readStudioBase(root(merged.source)).properties?.["note.price"]?.currency).toBe("EUR");

    const clash = structuredClone(baseline);
    clash.properties!["note.price"]!.currency = "USD";
    expect(writeStudioBase(theirs, baseline, clash)).toMatchObject({
      status: "conflict",
      paths: ["properties.note.price.currency"],
    });
  });

  it("merges rules by id and reports rules both sides moved differently", () => {
    const start = migrated(LEGACY);
    const baseline = readStudioBase(root(start));
    const rules = baseline.rules as Record<string, unknown>[];
    const theirs = updateStudioBase(start, (block) => {
      block.rules = [rules[1], rules[0], rules[2]];
    }).source;
    const renamed = structuredClone(baseline);
    (renamed.rules![0] as Record<string, unknown>).name = "Very late";
    const merged = writeStudioBase(theirs, baseline, renamed);
    expect((readStudioBase(root(merged.source)).rules as { id: string; name?: string }[]).map((rule) => rule.id)).toEqual([
      "migrated-rule-1",
      "base-rule",
      "odd",
    ]);
    expect((readStudioBase(root(merged.source)).rules![1] as { name: string }).name).toBe("Very late");
    const moved = structuredClone(baseline);
    moved.rules = [rules[2], rules[0], rules[1]];
    expect(writeStudioBase(theirs, baseline, moved)).toMatchObject({ status: "conflict", paths: ["rules order"] });
  });

  it("keeps unknown and unreadable rules when rules are saved, without duplicates", () => {
    const base = readStudioBase(root(migrated(LEGACY)));
    const readable = studioRules(base, "base");
    readable[1]!.name = "Renamed";
    const stored = storedRules(base.rules, readable) as Record<string, unknown>[];
    expect(stored.map((rule) => rule.id)).toEqual(["base-rule", "migrated-rule-1", "odd"]);
    expect(stored[0]).toMatchObject({ extra: "keep me" });
    expect(stored[1]).toMatchObject({ name: "Renamed" });
    expect(stored.some((rule) => "scope" in rule)).toBe(false);
  });

  it("writes a view's block and removes it when it is empty", () => {
    const start = migrated(LEGACY);
    const wrap = updateStudioView(start, 2, (block) => {
      block.columns = { "note.a": { wrap: true } };
    });
    expect(view(wrap.source, 2)).toMatchObject({ basesStudio: { columns: { "note.a": { wrap: true } } } });
    const cleared = updateStudioView(wrap.source, 2, (block) => {
      block.columns!["note.a"]!.wrap = false;
    });
    expect(cleared.source).toBe(start);
  });

  it("never rewrites a block saved by a newer version", () => {
    const newer = "basesStudio:\n  version: 2\n  palette: ember\nviews: []\n";
    expect(updateStudioBase(newer, (block) => void (block.palette = "default")).status).toBe("read-only");
  });

  it("renames and removes a property in every place", () => {
    const base: StudioBase = readStudioBase(root(LEGACY));
    renameStudioBaseProperty(base, "note.status", "note.state");
    expect(Object.keys(base.properties ?? {})).toContain("note.state");
    expect((base.rules as { propertyId: string }[]).every((rule) => rule.propertyId === "note.state")).toBe(true);
    const main: StudioView = readStudioView(view(LEGACY, 0));
    renameStudioViewProperty(main, "note.city", "note.town");
    expect((main.rules as { propertyId: string }[])[0]?.propertyId).toBe("note.town");
    removeStudioBaseProperties(base, ["note.state"]);
    removeStudioViewProperties(main, ["note.notes"]);
    expect(base.properties?.["note.state"]).toBeUndefined();
    expect(studioWrapColumns(main)).toEqual([]);
  });
});

describe("keys and row heights", () => {
  it("knows basesStudio and the keys old releases wrote into views", () => {
    expect(KNOWN_VIEW_KEYS.has("basesStudio")).toBe(true);
    expect(KNOWN_VIEW_KEYS.has("basesVisualsColumnAppearance")).toBe(true);
  });

  it("stores the default row height as absent", () => {
    expect(storedRowHeight("short")).toBeUndefined();
    expect(readRowHeight(undefined)).toBe("short");
  });

  it("keys option colours by encodeOptionKey", () => {
    const overrides = studioOverrides(readStudioBase(root(LEGACY)));
    expect(overrides[encodeOptionKey({ propertyId: "note.city", value: "Rome" })]?.override).toEqual({
      kind: "custom",
      hex: "#123456",
    });
  });
});

describe("merging in memory", () => {
  it("rebases unsaved choices onto a block changed meanwhile", () => {
    const previous: StudioBase = { properties: { "note.a": { pills: { mode: "status" } } } };
    const next: StudioBase = { properties: { "note.a": { pills: { mode: "status", style: "solid" } } } };
    const current: StudioBase = { palette: "ember", properties: { "note.a": { pills: { mode: "status" } } } };
    expect(mergeStudioBase(previous, next, current)).toEqual({
      block: { version: 1, palette: "ember", properties: { "note.a": { pills: { mode: "status", style: "solid" } } } },
      conflicts: [],
    });
    const view = mergeStudioView({ rules: [] }, { columns: { "note.a": { wrap: true } } }, { renderer: "board" });
    expect(view.block).toEqual({ renderer: "board", columns: { "note.a": { wrap: true } } });
  });
});

describe("link targets and status categories", () => {
  it("reads a link target as a safe vault path to a Base", () => {
    expect(studioLinkTarget({ linkTarget: "Projects/Projects.base" })).toBe("Projects/Projects.base");
    expect(studioLinkTarget({ linkTarget: " /Projects\\Active.BASE " })).toBe("Projects/Active.BASE");
    for (const linkTarget of ["Projects/notes.md", "../Other/Projects.base", "a/./b.base", "C:/Vault/P.base", 3, ""])
      expect(studioLinkTarget({ linkTarget } as StudioProperty)).toBeUndefined();
    expect(studioLinkTarget({})).toBeUndefined();
  });

  it("reads known option categories only", () => {
    expect(optionCategory({ category: "done" })).toBe("done");
    expect(optionCategory({ category: "closed" })).toBeUndefined();
    expect(optionCategory({})).toBeUndefined();
    expect(hasStatusCategories({ options: [{ value: "Open" }, { value: "Done", category: "done" }] })).toBe(true);
    expect(hasStatusCategories({ options: ["Open", { value: "Done" }] } as StudioProperty)).toBe(false);
    expect(STATUS_CATEGORIES.map((category) => STATUS_CATEGORY_LABELS[category])).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
  });
});

describe("record templates", () => {
  it("reads templates leniently and finds a view's default", () => {
    const templates = studioTemplates({
      templates: [
        { id: "bug", name: " Bug report ", properties: { status: "Open" }, body: "## Steps\n" },
        { id: "bug", name: "Duplicate id" },
        { id: "idea", name: "Idea" },
        { id: "", name: "No id" },
        { id: "x", name: "  " },
        "not a template",
      ],
    });
    expect(templates).toEqual([
      { id: "bug", name: "Bug report", properties: { status: "Open" }, body: "## Steps\n" },
      { id: "idea", name: "Idea", properties: {}, body: "" },
    ]);
    expect(studioTemplates({})).toEqual([]);
    expect(studioDefaultTemplate({ defaultTemplate: "idea" }, templates)?.name).toBe("Idea");
    expect(studioDefaultTemplate({ defaultTemplate: "gone" }, templates)).toBeUndefined();
    expect(studioDefaultTemplate({}, templates)).toBeUndefined();
  });
});
