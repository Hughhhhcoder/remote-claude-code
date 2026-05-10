import { createSignal, createEffect, For, Show, type JSX } from "solid-js";
import type { PeerInfo } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { Button } from "../primitives/Button.tsx";
import { Chip } from "../primitives/Chip.tsx";

/**
 * PeersPane — P5-C responsive migration of PeersModal. Lifts federation
 * frame dispatch wholesale; drops the overlay chrome. Protocol type is
 * `PeerInfo` (verified against packages/protocol/src/index.ts).
 *
 * Frames: send peer.list.request / peer.add / peer.remove. Listening lives
 * in peersStore, so we receive `peers` as a prop.
 */

export interface PeersPaneProps {
  client: RccClient;
  peers: PeerInfo[];
  onClose?: () => void;
}

function fp(id: string): string {
  return id.slice(0, 6);
}

function status(p: PeerInfo): { tone: "success" | "warn" | "danger"; label: string } {
  if (p.connected) return { tone: "success", label: "在线" };
  if (p.error) return { tone: "danger", label: "错误" };
  return { tone: "warn", label: "离线" };
}

export function PeersPane(props: PeersPaneProps): JSX.Element {
  const [nid, setNid] = createSignal("");
  const [nurl, setNurl] = createSignal("");
  const [nlabel, setNlabel] = createSignal("");
  const [ntok, setNtok] = createSignal("");
  const [err, setErr] = createSignal<string | null>(null);
  const [addOpen, setAddOpen] = createSignal(false);

  createEffect(() =>
    props.client.send({ v: 1, t: "peer.list.request" }),
  );

  function reset(): void {
    setNid("");
    setNurl("");
    setNlabel("");
    setNtok("");
    setErr(null);
  }

  function onAdd(): void {
    const id = nid().trim();
    const url = nurl().trim();
    const label = nlabel().trim();
    const token = ntok().trim();
    if (!id || !url || !label || !token) {
      setErr("id / url / label / token 必填");
      return;
    }
    if (!/^(wss?:\/\/)/i.test(url)) {
      setErr("url 必须以 ws:// 或 wss:// 开头");
      return;
    }
    setErr(null);
    props.client.send({ v: 1, t: "peer.add", id, url, token, label });
    reset();
    setAddOpen(false);
  }

  function onRemove(p: PeerInfo): void {
    if (!confirm(`移除 peer "${p.label}"？本地会话不受影响。`)) return;
    props.client.send({ v: 1, t: "peer.remove", id: p.id });
  }

  function onReconnect(): void {
    // peer.reconnect frame TBD; refresh as best-effort.
    props.client.send({ v: 1, t: "peer.list.request" });
  }

  const online = () => props.peers.filter((p) => p.connected).length;

  return (
    <div class="flex flex-col h-full bg-bg-page text-text-primary">
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-border-subtle bg-bg-page">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">已连接 Peers</h2>
          <p class="text-[11px] text-text-muted mt-0.5">共 {props.peers.length} · 在线 {online()}</p>
        </div>
        <Show when={props.onClose}>
          <Button variant="ghost" size="sm" onClick={props.onClose} aria-label="关闭">✕</Button>
        </Show>
      </header>

      <div class="flex-1 overflow-y-auto">
        <h3 class="px-4 md:px-5 pt-4 pb-1 text-[10px] uppercase tracking-widest text-text-muted">本地 Host</h3>
        <div class="px-4 md:px-5 py-3 min-h-[72px] bg-accent-bg/30 border-y border-border-subtle flex items-center gap-3 flex-wrap">
          <span class="w-2 h-2 rounded-full bg-success shrink-0" aria-label="本机在线" />
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-medium">本机 rcc host</div>
            <div class="text-[11px] text-text-muted font-mono truncate">~/.rcc/peers.json · 聚合远程 sessions</div>
          </div>
          <Chip tone="accent" size="xs">当前</Chip>
        </div>

        <h3 class="px-4 md:px-5 pt-4 pb-1 text-[10px] uppercase tracking-widest text-text-muted">Peers</h3>
        <Show
          when={props.peers.length > 0}
          fallback={<div class="px-4 md:px-5 py-8 text-center text-[13px] text-text-muted">暂无 peer · 下方添加</div>}
        >
          <ul class="divide-y divide-border-subtle">
            <For each={props.peers}>
              {(p) => <PeerRow p={p} onRemove={() => onRemove(p)} onReconnect={onReconnect} />}
            </For>
          </ul>
        </Show>

        <section class="px-4 md:px-5 py-3 border-t border-danger/20 bg-danger/5 mt-4">
          <p class="text-[11px] text-danger leading-relaxed">
            <strong>⚠ 安全提示：</strong>peer token 等于远程 host 的超级权限。token
            存 ~/.rcc/peers.json (0600)，ws 传输仅靠外层 TLS 保护。
          </p>
        </section>
      </div>

      <footer class="shrink-0 border-t border-border-subtle bg-bg-surface">
        <Show
          when={addOpen()}
          fallback={
            <div class="px-4 md:px-5 py-2.5 flex items-center justify-between gap-2">
              <span class="text-[11px] text-text-muted truncate">添加新 peer · 填入配对码</span>
              <Button size="sm" onClick={() => setAddOpen(true)}>添加 peer</Button>
            </div>
          }
        >
          <AddForm
            nid={nid()} setNid={setNid}
            nlabel={nlabel()} setNlabel={setNlabel}
            nurl={nurl()} setNurl={setNurl}
            ntok={ntok()} setNtok={setNtok}
            err={err()}
            onCancel={() => { reset(); setAddOpen(false); }}
            onAdd={onAdd}
          />
        </Show>
      </footer>
    </div>
  );
}

interface AddFormProps {
  nid: string; setNid: (v: string) => void;
  nlabel: string; setNlabel: (v: string) => void;
  nurl: string; setNurl: (v: string) => void;
  ntok: string; setNtok: (v: string) => void;
  err: string | null;
  onCancel: () => void;
  onAdd: () => void;
}

function AddForm(p: AddFormProps): JSX.Element {
  const cls = "bg-bg-page border border-border-subtle rounded-md px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-accent";
  return (
    <div class="px-4 md:px-5 py-3 space-y-2">
      <div class="text-[10px] uppercase tracking-widest text-text-muted">新增 peer</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input value={p.nid} onInput={(e) => p.setNid(e.currentTarget.value)} placeholder="id (home / work)" class={cls} />
        <input value={p.nlabel} onInput={(e) => p.setNlabel(e.currentTarget.value)} placeholder="label (家里 / 公司)" class={cls} />
      </div>
      <input value={p.nurl} onInput={(e) => p.setNurl(e.currentTarget.value)} placeholder="wss://host.example.com/ws" class={`${cls} w-full font-mono`} />
      <input value={p.ntok} onInput={(e) => p.setNtok(e.currentTarget.value)} placeholder="device token" type="password" class={`${cls} w-full font-mono`} />
      <Show when={p.err}><div class="text-[11px] text-danger">{p.err}</div></Show>
      <div class="flex items-center justify-end gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={p.onCancel}>取消</Button>
        <Button size="sm" onClick={p.onAdd}>添加</Button>
      </div>
    </div>
  );
}

interface RowProps {
  p: PeerInfo;
  onRemove: () => void;
  onReconnect: () => void;
}

function PeerRow(rp: RowProps): JSX.Element {
  const s = status(rp.p);
  const dot = s.tone === "success" ? "bg-success" : s.tone === "danger" ? "bg-danger" : "bg-warn";
  const copyFp = (): void => { navigator.clipboard?.writeText(rp.p.id).catch(() => {}); };
  return (
    <li class="px-4 md:px-5 py-3 min-h-[80px] md:min-h-[72px] flex items-start gap-3">
      <span class={`w-2 h-2 rounded-full mt-2 shrink-0 ${dot}`} aria-label={s.label} />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[13px] font-medium truncate">{rp.p.label}</span>
          <Chip tone={s.tone} size="xs">{s.label}</Chip>
          <Show when={rp.p.sessionCount !== undefined && rp.p.connected}>
            <span class="text-[11px] text-text-muted">
              {rp.p.sessionCount} session{rp.p.sessionCount === 1 ? "" : "s"}
            </span>
          </Show>
        </div>
        <div class="text-[11px] text-text-muted font-mono truncate mt-0.5">{rp.p.url}</div>
        <div class="mt-1.5 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={copyFp}
            class="inline-flex items-center gap-1 rounded-sm bg-bg-surfaceStrong border border-border-subtle px-1.5 h-5 text-[10px] font-mono text-text-secondary hover:border-border-strong"
            title="复制 peer id">
            🔑 {fp(rp.p.id)}
          </button>
          <Show when={rp.p.error}>
            <span class="text-[11px] text-danger truncate max-w-[60vw]">{rp.p.error}</span>
          </Show>
        </div>
      </div>
      <div class="flex flex-col md:flex-row items-end md:items-center gap-1.5 shrink-0">
        <Show when={!rp.p.connected}>
          <Button variant="secondary" size="sm" onClick={rp.onReconnect}>重连</Button>
        </Show>
        <Button
          variant="ghost"
          size="sm"
          onClick={rp.onRemove}
          class="text-danger hover:bg-danger/5"
        >
          断开
        </Button>
      </div>
    </li>
  );
}

export default PeersPane;
