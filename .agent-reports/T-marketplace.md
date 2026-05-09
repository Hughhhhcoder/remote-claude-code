# T-marketplace — Skills + MCP Marketplace

Manifest-driven catalog for browse + one-click install.

**Protocol** (`packages/protocol/src/index.ts` [marketplace] block):
`market.catalog.request` → `market.catalog { skills, mcps, sources, fetchedAt }`;
`market.install.skill { id, scope }` → `market.skill.installed { ok, installedName?, error? }`;
`market.install.mcp { id, scope, env }` → `market.mcp.installed`.

**Host** (`packages/host/src/marketplace.ts`): `fetchCatalogs(force?)` concurrently
pulls every `https://` entry from `~/.rcc/config.json → marketplace.manifestUrls`
(10s AbortController timeout, 512KB cap), merges with seed, dedupes by id, caches
1h. `installSkillFromCatalog` reuses `skills.writeSkill` (fallback to direct
mkdir+writeFile if frontmatter round-trip mangles). `installMcpFromCatalog`
reuses `mcp.addMcp`; MCP command whitelist `npx|uvx|node|python|python3` so
no arbitrary binaries. 3 handlers wired in `host/index.ts` beside the other
`[config-handlers]` cases.

**Seed** (hard-coded, honest): 3 skills — `rcc/test-writer`, `rcc/commit-message`,
`rcc/todo-sweep` (all inline SKILL.md); 4 real MCPs from
`@modelcontextprotocol/server-*` — filesystem, github (envHint
`GITHUB_PERSONAL_ACCESS_TOKEN`), memory, fetch. Skills fallback works even
without manifest config.

**Web** (`packages/web/src/MarketplaceView.tsx`): full-screen modal, Skills/MCPs
tabs with count chips, name/description/tag search, install → scope radio
(user/project) + env password inputs generated from `envHints`. Source errors
shown collapsed. Entry points: `SkillsTab` button + sidebar footer button in
`App.tsx` + big card at bottom of SkillsTab. `SkillsTab.tsx` placeholder
replaced with live entry. `pnpm -r typecheck` green.
