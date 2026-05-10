import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type {
  PermissionsConfig,
  PermissionScope,
  PermissionBucket,
  PermissionDefaultMode,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import {
  authenticateForHighRiskToggle,
  isWebAuthnAvailable,
} from "./webauthn.ts";
import { toast } from "./primitives/Toast.tsx";

interface Props {
  client: RccClient;
  /**
   * [B30-A] Current device — when it has a passkey enrolled, flipping a
   * scope's `defaultMode` to `bypassPermissions` requires a passkey
   * ceremony. Null/undefined means no passkey is available; we fall back
   * to a loud `confirm()`.
   */
  currentDevice?: { id: string; name: string; hasPasskey?: boolean } | null;
}

const SCOPE_META: Record<
  PermissionScope,
  { label: string; desc: string; path: string; accent: string }
> = {
  user: {
    label: "用户",
    desc: "全局，应用到所有会话。",
    path: "~/.claude/settings.json",
    accent: "text-sky-400",
  },
  project: {
    label: "项目",
    desc: "当前 cwd 的团队共享配置（入 git）。",
    path: "<cwd>/.claude/settings.json",
    accent: "text-orange-400",
  },
  local: {
    label: "本地",
    desc: "当前 cwd 的个人覆盖（建议入 .gitignore）。",
    path: "<cwd>/.claude/settings.local.json",
    accent: "text-emerald-400",
  },
};

const BUCKET_META: Record<
  PermissionBucket,
  { label: string; hint: string; borderCls: string; bgCls: string; textCls: string; titleCls: string }
> = {
  allow: {
    label: "✓ Allow",
    hint: "自动放行",
    borderCls: "border-emerald-500/30",
    bgCls: "bg-emerald-500/5",
    textCls: "text-emerald-400",
    titleCls: "text-emerald-400",
  },
  deny: {
    label: "✕ Deny",
    hint: "直接拒绝",
    borderCls: "border-rose-500/30",
    bgCls: "bg-rose-500/5",
    textCls: "text-rose-400",
    titleCls: "text-rose-400",
  },
  ask: {
    label: "? Ask",
    hint: "每次询问",
    borderCls: "border-amber-500/30",
    bgCls: "bg-amber-500/5",
    textCls: "text-amber-400",
    titleCls: "text-amber-400",
  },
};

const DEFAULT_MODES: readonly PermissionDefaultMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
] as const;

const MODE_LABEL: Record<PermissionDefaultMode, string> = {
  default: "Default",
  plan: "Plan (只读)",
  acceptEdits: "Accept Edits",
  bypassPermissions: "Bypass (危险)",
};

const BUCKETS: readonly PermissionBucket[] = ["allow", "deny", "ask"];

function parseRule(rule: string): { tool: string; pattern: string } {
  const m = rule.match(/^([^(]+)\((.*)\)$/s);
  if (!m) return { tool: rule, pattern: "" };
  return { tool: m[1]!.trim(), pattern: m[2] ?? "" };
}

export function PermissionsTab(props: Props) {
  const [configs, setConfigs] = createSignal<PermissionsConfig[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "perm.list") {
      setConfigs(frame.configs);
      setLoaded(true);
    } else if (frame.t === "error" && frame.code?.startsWith("perm_")) {
      setError(frame.message);
    }
  });
  onCleanup(unsub);

  onMount(() => {
    props.client.send({ v: 1, t: "perm.list.request" });
  });

  const byScope = createMemo(() => {
    const map: Partial<Record<PermissionScope, PermissionsConfig>> = {};
    for (const c of configs()) map[c.scope] = c;
    return map;
  });

  function addRule(scope: PermissionScope, bucket: PermissionBucket, rule: string) {
    setError(null);
    props.client.send({ v: 1, t: "perm.add", scope, bucket, rule });
  }
  function removeRule(scope: PermissionScope, bucket: PermissionBucket, rule: string) {
    props.client.send({ v: 1, t: "perm.remove", scope, bucket, rule });
  }
  async function setDefaultMode(scope: PermissionScope, mode: PermissionDefaultMode | null) {
    // [B30-A] Gate bypassPermissions — this flips the scope default so
    // new sessions inherit an unsandboxed Claude. Require passkey when
    // available; otherwise force a loud confirm.
    if (mode === "bypassPermissions") {
      const me = props.currentDevice;
      if (me?.hasPasskey && isWebAuthnAvailable()) {
        try {
          await authenticateForHighRiskToggle(me.id, "bypass-permissions");
        } catch (err) {
          toast(
            `Passkey 验证失败 · 未切换到 Bypass · ${(err as Error).message}`,
            { tone: "danger" },
          );
          return;
        }
      } else if (!confirm(
        "启用 Bypass Permissions 会让 Claude 自动执行所有操作(包括 rm、git push --force)。\n\n此操作不可逆,是否继续?",
      )) {
        return;
      }
    }
    props.client.send({ v: 1, t: "perm.set-default", scope, mode });
  }
  function addDir(scope: PermissionScope, path: string) {
    setError(null);
    props.client.send({ v: 1, t: "perm.add-dir", scope, path });
  }
  function removeDir(scope: PermissionScope, path: string) {
    props.client.send({ v: 1, t: "perm.remove-dir", scope, path });
  }

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold mb-2">权限策略</h1>
          <p class="text-sm text-zinc-400 max-w-2xl">
            Allow/Deny/Ask 规则控制 Claude 哪些操作直接执行、哪些拒绝、哪些要审批。三个 scope 叠加生效：
            <code class="mono text-[11px] px-1 py-0.5 rounded bg-zinc-900 text-zinc-300">local</code> &gt;
            <code class="mono text-[11px] px-1 py-0.5 rounded bg-zinc-900 text-zinc-300">project</code> &gt;
            <code class="mono text-[11px] px-1 py-0.5 rounded bg-zinc-900 text-zinc-300">user</code>。
          </p>
        </div>
        <button
          onClick={() => props.client.send({ v: 1, t: "perm.list.request" })}
          class="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 text-xs"
        >
          ⟳ 刷新
        </button>
      </div>

      <Show when={error()}>
        <div class="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-2 text-xs flex items-center justify-between">
          <span class="font-mono truncate">{error()}</span>
          <button class="text-rose-200 hover:text-white ml-3" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      </Show>

      <Show
        when={loaded()}
        fallback={<div class="text-sm text-zinc-500">加载中…</div>}
      >
        <div class="space-y-8">
          <For each={["user", "project", "local"] as PermissionScope[]}>
            {(scope) => (
              <ScopeSection
                scope={scope}
                config={byScope()[scope]}
                onAddRule={addRule}
                onRemoveRule={removeRule}
                onSetDefault={setDefaultMode}
                onAddDir={addDir}
                onRemoveDir={removeDir}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

interface ScopeProps {
  scope: PermissionScope;
  config: PermissionsConfig | undefined;
  onAddRule: (scope: PermissionScope, bucket: PermissionBucket, rule: string) => void;
  onRemoveRule: (scope: PermissionScope, bucket: PermissionBucket, rule: string) => void;
  onSetDefault: (scope: PermissionScope, mode: PermissionDefaultMode | null) => void;
  onAddDir: (scope: PermissionScope, path: string) => void;
  onRemoveDir: (scope: PermissionScope, path: string) => void;
}

function ScopeSection(props: ScopeProps) {
  const meta = () => SCOPE_META[props.scope];
  const cfg = (): PermissionsConfig =>
    props.config ?? {
      scope: props.scope,
      allow: [],
      deny: [],
      ask: [],
      additionalDirectories: [],
    };
  const totalRules = createMemo(() => {
    const c = cfg();
    return c.allow.length + c.deny.length + c.ask.length;
  });

  return (
    <section class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <div class="px-5 py-3 border-b border-zinc-800 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class={`text-sm font-semibold ${meta().accent}`}>{meta().label}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
              {totalRules()} 条规则
            </span>
          </div>
          <div class="text-xs text-zinc-500 mt-0.5">{meta().desc}</div>
          <div class="text-[10px] mono text-zinc-600 mt-0.5">{meta().path}</div>
        </div>
      </div>

      <div class="p-5 space-y-5">
        <Show when={props.scope !== "local"}>
          <DefaultModeRow
            scope={props.scope}
            current={cfg().defaultMode}
            onSet={props.onSetDefault}
          />
        </Show>

        <DirsRow
          scope={props.scope}
          dirs={cfg().additionalDirectories}
          onAdd={props.onAddDir}
          onRemove={props.onRemoveDir}
        />

        <div class="grid grid-cols-3 gap-3">
          <For each={BUCKETS}>
            {(bucket) => (
              <BucketPanel
                scope={props.scope}
                bucket={bucket}
                rules={cfg()[bucket]}
                onAdd={props.onAddRule}
                onRemove={props.onRemoveRule}
              />
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function DefaultModeRow(props: {
  scope: PermissionScope;
  current: PermissionDefaultMode | undefined;
  onSet: (scope: PermissionScope, mode: PermissionDefaultMode | null) => void;
}) {
  return (
    <div>
      <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
        默认模式 (defaultMode)
      </div>
      <div class="grid grid-cols-5 gap-2">
        <button
          onClick={() => props.onSet(props.scope, null)}
          class={`p-2.5 rounded-lg border text-left text-xs transition ${
            props.current === undefined
              ? "border-zinc-500/60 bg-zinc-800/40 text-zinc-100"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
          }`}
        >
          <div class="font-medium mb-0.5">未设置</div>
          <div class="text-[10px] text-zinc-500">继承默认</div>
        </button>
        <For each={DEFAULT_MODES}>
          {(mode) => (
            <button
              onClick={() => props.onSet(props.scope, mode)}
              class={`p-2.5 rounded-lg border text-left text-xs transition ${
                props.current === mode
                  ? mode === "bypassPermissions"
                    ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
                    : "border-orange-500/50 bg-orange-500/5 text-orange-200"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <div class="font-medium mb-0.5">{MODE_LABEL[mode]}</div>
              <div class="text-[10px] text-zinc-500">
                {mode === "default" && "按规则"}
                {mode === "plan" && "只读 + 展示"}
                {mode === "acceptEdits" && "文件编辑放行"}
                {mode === "bypassPermissions" && "绕过全部"}
              </div>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function DirsRow(props: {
  scope: PermissionScope;
  dirs: string[];
  onAdd: (scope: PermissionScope, path: string) => void;
  onRemove: (scope: PermissionScope, path: string) => void;
}) {
  const [input, setInput] = createSignal("");

  function submit() {
    const v = input().trim();
    if (!v) return;
    props.onAdd(props.scope, v);
    setInput("");
  }

  return (
    <div>
      <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
        额外允许目录 (additionalDirectories)
      </div>
      <div class="space-y-1.5 mb-2">
        <Show
          when={props.dirs.length > 0}
          fallback={<div class="text-xs text-zinc-600">无</div>}
        >
          <For each={props.dirs}>
            {(d) => (
              <div class="flex items-center gap-2 px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-[11px]">
                <span class="mono text-zinc-300 truncate flex-1">{d}</span>
                <button
                  onClick={() => props.onRemove(props.scope, d)}
                  class="text-zinc-500 hover:text-rose-400 px-1"
                  title="移除"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="flex items-center gap-2">
        <input
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="/abs/path 或 ~/projects/foo"
          class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs mono text-zinc-100 outline-none focus:border-zinc-700"
        />
        <button
          onClick={submit}
          class="px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-xs"
        >
          + 添加
        </button>
      </div>
    </div>
  );
}

const PLACEHOLDER_BY_BUCKET: Record<PermissionBucket, string> = {
  allow: "Bash(npm install:*)",
  deny: "Bash(rm -rf *)",
  ask: "WebFetch(domain:example.com)",
};

function BucketPanel(props: {
  scope: PermissionScope;
  bucket: PermissionBucket;
  rules: string[];
  onAdd: (scope: PermissionScope, bucket: PermissionBucket, rule: string) => void;
  onRemove: (scope: PermissionScope, bucket: PermissionBucket, rule: string) => void;
}) {
  const [input, setInput] = createSignal("");
  const meta = () => BUCKET_META[props.bucket];

  function submit() {
    const v = input().trim();
    if (!v) return;
    props.onAdd(props.scope, props.bucket, v);
    setInput("");
  }

  return (
    <div class={`rounded-xl border ${meta().borderCls} ${meta().bgCls} p-3 flex flex-col`}>
      <div class="flex items-center justify-between mb-2">
        <div class={`text-xs font-medium ${meta().titleCls}`}>{meta().label}</div>
        <div class="text-[10px] text-zinc-500">{meta().hint} · {props.rules.length}</div>
      </div>
      <div class="space-y-1 mb-2 flex-1 min-h-[1rem]">
        <Show
          when={props.rules.length > 0}
          fallback={<div class="text-[11px] text-zinc-600 px-2.5 py-1.5">无规则</div>}
        >
          <For each={props.rules}>
            {(rule) => {
              const parsed = parseRule(rule);
              return (
                <div class="flex items-center gap-2 px-2.5 py-1.5 rounded bg-zinc-950 text-[11px] group">
                  <span class={meta().textCls}>{parsed.tool}</span>
                  <Show when={parsed.pattern}>
                    <span class="text-zinc-500 mono truncate flex-1">{parsed.pattern}</span>
                  </Show>
                  <button
                    onClick={() => props.onRemove(props.scope, props.bucket, rule)}
                    class="ml-auto text-zinc-600 hover:text-rose-400 px-1 opacity-0 group-hover:opacity-100"
                    title="移除"
                  >
                    ✕
                  </button>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
      <div class="flex items-center gap-1 pt-1 border-t border-zinc-800/60">
        <input
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={PLACEHOLDER_BY_BUCKET[props.bucket]}
          class="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] mono text-zinc-100 outline-none focus:border-zinc-700"
        />
        <button
          onClick={submit}
          class={`px-2 py-1 rounded border border-zinc-800 text-[11px] hover:bg-zinc-800 ${meta().textCls}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
