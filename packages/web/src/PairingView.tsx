import { createSignal, Show, onCleanup } from "solid-js";
import {
  claimPairing,
  defaultDeviceName,
  requestPairingCode,
  saveDevice,
  saveE2EKey,
  saveToken,
} from "./auth.ts";
import { t } from "./i18n/index.ts";

interface Props {
  onPaired: (token: string) => void;
}

type Phase = "intro" | "requesting" | "awaiting-code" | "claiming" | "success" | "error";

export function PairingView(props: Props) {
  const [phase, setPhase] = createSignal<Phase>("intro");
  const [code, setCode] = createSignal<string | null>(null);
  const [claimSecret, setClaimSecret] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number>(0);
  const [now, setNow] = createSignal(Date.now());
  const [entered, setEntered] = createSignal("");
  const [deviceName, setDeviceName] = createSignal(defaultDeviceName());
  const [error, setError] = createSignal<string | null>(null);

  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  const secondsLeft = () => Math.max(0, Math.floor((expiresAt() - now()) / 1000));
  const codeExpired = () => phase() === "awaiting-code" && secondsLeft() <= 0;

  async function startRequest() {
    setError(null);
    setPhase("requesting");
    try {
      const r = await requestPairingCode();
      setCode(r.code);
      setClaimSecret(r.claimSecret);
      setExpiresAt(r.expiresAt);
      setPhase("awaiting-code");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setPhase("error");
    }
  }

  async function confirm() {
    const c = code();
    const s = claimSecret();
    if (!c || !s) return;
    if (entered().replace(/\s/g, "") !== c) {
      setError(t("pair.mismatch"));
      return;
    }
    setPhase("claiming");
    setError(null);
    try {
      const r = await claimPairing({
        code: c,
        claimSecret: s,
        deviceName: deviceName().trim() || "Browser",
      });
      saveToken(r.token);
      saveDevice({ id: r.device.id, name: r.device.name, hostId: r.hostId });
      if (r.e2eKey) saveE2EKey(r.e2eKey);
      setPhase("success");
      setTimeout(() => props.onPaired(r.token), 600);
    } catch (err: any) {
      setError(err.message ?? String(err));
      setPhase("error");
    }
  }

  return (
    <div class="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100 p-6">
      <div class="w-[480px] max-w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        <div class="p-6 border-b border-zinc-900">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 grid place-items-center font-bold text-sm">
              R
            </div>
            <div>
              <div class="font-semibold text-sm">{t("pair.title")}</div>
              <div class="text-xs text-zinc-500">{t("pair.subtitle")}</div>
            </div>
          </div>
        </div>

        <div class="p-6 space-y-5">
          <Show when={phase() === "intro" || phase() === "requesting" || phase() === "error"}>
            <div class="space-y-4">
              <p class="text-sm text-zinc-400 leading-relaxed">
                {t("pair.intro")}
              </p>
              <button
                onClick={startRequest}
                disabled={phase() === "requesting"}
                class="w-full py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {phase() === "requesting" ? t("pair.requesting") : t("pair.requestCode")}
              </button>
              <Show when={error()}>
                <div class="rounded-lg px-3 py-2 border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs">
                  {error()}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={phase() === "awaiting-code" && code()}>
            <div class="space-y-4">
              <div>
                <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
                  {t("pair.hostShownCode")}
                </div>
                <div class="font-mono text-2xl text-zinc-200 tracking-[0.3em] select-all">
                  {code()!.slice(0, 3)} {code()!.slice(3)}
                </div>
                <div
                  class={`text-[11px] mt-1 ${codeExpired() ? "text-rose-400" : "text-zinc-500"}`}
                >
                  {codeExpired()
                    ? t("pair.expired")
                    : `${t("pair.validFor")}: ${Math.floor(secondsLeft() / 60)}:${String(secondsLeft() % 60).padStart(2, "0")}`}
                </div>
              </div>

              <div>
                <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                  {t("pair.reenter")}
                </label>
                <input
                  type="text"
                  inputmode="numeric"
                  maxlength="7"
                  placeholder="482 917"
                  value={entered()}
                  onInput={(e) => setEntered(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-lg font-mono tracking-widest text-zinc-100 outline-none focus:border-orange-500/60"
                />
              </div>

              <div>
                <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
                  {t("pair.deviceName")}
                </label>
                <input
                  type="text"
                  value={deviceName()}
                  onInput={(e) => setDeviceName(e.currentTarget.value)}
                  maxlength={64}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500/60"
                />
              </div>

              <div class="flex gap-2">
                <button
                  onClick={startRequest}
                  class="px-3 py-2 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:border-zinc-700"
                >
                  {t("pair.retry")}
                </button>
                <button
                  onClick={confirm}
                  disabled={codeExpired() || entered().replace(/\s/g, "").length !== 6}
                  class="flex-1 py-2 rounded-lg bg-emerald-500 text-zinc-950 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("pair.finish")}
                </button>
              </div>

              <Show when={error()}>
                <div class="rounded-lg px-3 py-2 border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs">
                  {error()}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={phase() === "claiming"}>
            <div class="text-center py-6 text-sm text-zinc-400">{t("pair.confirming")}</div>
          </Show>

          <Show when={phase() === "success"}>
            <div class="text-center py-6">
              <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500 grid place-items-center text-xl text-white">
                ✓
              </div>
              <div class="text-sm font-semibold mb-1">{t("pair.success")}</div>
              <div class="text-xs text-zinc-500">{t("pair.entering")}</div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
