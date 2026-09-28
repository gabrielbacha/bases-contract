# @gabrielbacha/bases-contract

The shared contract for Obsidian Bases (`.base`) files. Each rule about the data that editors of a Base share is defined here once, and every editor imports it.

It contains:

- **YAML patching** (`readYamlMap`, `patchYamlMap`, `editYamlSequence`): changes one block and keeps the rest of the file, comments included, byte for byte.
- **The `basesStudio` block** (`readStudioBase`, `readStudioView`, `writeStudioBase`, `writeStudioView`, `updateStudioBase`, `updateStudioView`, `migrateToStudio`): one block holds everything the apps add to a Base. Writes are field-level three-way merges that keep unknown fields and unreadable rules. They report same-field conflicts, never rewrite a block saved by a newer version, and do not write when nothing changed.
- **Formatting rules** (`normalizeRule`, `evaluateRule`, `ruleColorVariables`, `studioRules`, `storedRules`): `backgroundOpacity` is an integer from 0 to 100, and a missing value means 100.
- **Pill colours** (`pillColor`, `studioPillContext`): an option's own colour first, then the property's pill strategy and the palette.
- **Names, property ids, and row heights** (`noteNameFrom`, `uniqueName`, `canonicalPropertyId`, `readRowHeight`).

The package has one dependency, `yaml`, and runs in Node, Electron, and the browser.

## Where each fact is stored

Obsidian's own keys (`filters`, `formulas`, `properties`, `summaries`, `views` and the native view fields) are never copied. Everything else is in `basesStudio`:

```yaml
basesStudio:                  # the whole Base
  version: 1
  palette: default
  properties:
    note.status:
      type: select
      options:
        - { value: Shortlist, color: green-sea }   # a preset, "#RRGGBB" or none
      pills: { mode: status, style: solid, wrap: true }
      style: { tone: muted, bold: true, align: center }
      default: Shortlist
  rules: [ … ]                # Base rules
  detailLayouts: { … }
  tableUi: { … }
views:
  - type: table
    name: Main
    basesStudio:              # this view only
      id: 3f2c…
      renderer: board
      columns:
        note.notes: { wrap: true, style: { tone: faint } }   # wins over the property's style
      rules: [ … ]            # view rules, after the Base rules
```

Files written before version 2 of this package keep their settings in `basesEditor`, `basesVisuals`, `basesEditorView`, `basesVisualsView`, `basesVisualsColumnAppearance` and `basesVisualsBase`. They are read as if they were `basesStudio`. Opening a file never changes it; the first intentional save moves the whole file into `basesStudio` and removes the old blocks.

Short-lived interface state (search text, open panels) is never saved in a `.base` file.

## Development

```bash
pnpm install
pnpm run check
```

To release: raise `version` in `package.json`, then run `pnpm publish --access public`. The `prepublishOnly` script runs the checks and the build first. Each app picks up the new version when its dependency is updated.

