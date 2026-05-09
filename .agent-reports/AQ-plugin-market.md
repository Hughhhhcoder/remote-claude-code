# Batch 15 A — Plugin Marketplace

Extends the Skills + MCPs marketplace to also distribute plugins.

## Protocol
- `MarketPluginSource` union (inline {files} / tarball {url}) + `MarketPluginEntry`.
- `MarketCatalog.plugins[]`; new frames `market.install.plugin` / `market.plugin.installed`.

## Host
- `marketplace.ts`: `SEED_PLUGINS` = echo-bot + timer (inline), `isPluginEntry` validator, `installPluginFromCatalog` writes inline files to `~/.rcc/plugins/<id>/` with per-file zip-slip check (`resolve` + `relative` prefix). Tarball deferred to M9. No auto-load.
- `index.ts`: handler for `market.install.plugin`; `market.catalog` now includes `plugins`.

## Web
- `MarketplaceView.tsx`: third tab "Plugins" + `PluginCard` (amber permission chips) + confirm dialog listing permissions, trust disclaimer, "restart host" notice.

## Safety
- Plugin install requires user confirmation with permissions preview.
- Inline files: max 64 × 256KB; each path `resolve(dir, rel)` must stay inside `dir`.
- `typecheck`: host + protocol green; web's only error is pre-existing `src/i18n/index.ts` (untouched).
