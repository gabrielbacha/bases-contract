# @gabrielbacha/bases-contract

The shared contract for Obsidian Bases (`.base`) files. Each rule about the data that editors of a Base share is defined here once, and every editor imports it.

It contains:

- **YAML patching** (`readYamlMap`, `patchYamlMap`, `editYamlSequence`): changes one block and keeps the rest of the file, comments included, byte for byte.
- **Extension blocks** (`writeBaseVisuals`, `writeViewVisuals`, `setDeclaredOptionColor`): three-way merges that keep unknown fields and unreadable rules. They report same-field conflicts, never rewrite a block saved by a newer version, and do not write when nothing changed.
- **Formatting rules** (`normalizeRule`, `evaluateRule`, `ruleColorVariables`): `backgroundOpacity` is an integer from 0 to 100, and a missing value means 100.
- **Pill colours** (`pillColor`): a declared option's colour first, then a `basesVisuals.options` override, then the property's strategy and palette. Every colour is an accent hex.
- **Names, property ids, and row heights** (`noteNameFrom`, `uniqueName`, `canonicalPropertyId`, `readRowHeight`).

The package has one dependency, `yaml`, and runs in Node, Electron, and the browser.

## Where each fact is stored

| Data | Location |
|---|---|
| Column types and declared options (value, label, order, colour) | `basesEditor.propertyTypes` |
| Palette, strategies, colours for values that are not declared, Base-wide rules, column appearance | `basesVisuals` |
| View rules and view column appearance | `views[i].basesVisualsView` |
| Editor view settings (frozen columns, groups, summaries) | `views[i].basesEditorView` |

Short-lived interface state (search text, open panels) is never saved in a `.base` file.

## Development

```bash
pnpm install
pnpm run check
```

To release: raise `version` in `package.json`, then run `pnpm publish --access public`. The `prepublishOnly` script runs the checks and the build first. Each app picks up the new version when its dependency is updated.

