import { createSignal, Show, onCleanup, For } from "solid-js";
import {
  claimPairing,
  defaultDeviceName,
  requestPairingCode,
  saveDevice,
  saveE2EKey,
  saveToken,
} from "./auth.ts";
import { t } from "./i18n/index.ts";
import { Button } from "./primitives/Button.tsx";
import { TextInput } from "./primitives/TextInput.tsx";

interface Props {
  onPaired: (token: string) => void;
}

type Phase = "intro" | "requesting" | "awaiting-code" | "claiming" | "success" | "error";

/**
 * PairingView — device-pairing onboarding (Claude.ai palette).
 *
 * Behavior (preserved verbatim from prior impl):
 *   - `requestPairingCode()` → host displays 6-digit code.
 *   - User re-enters the same 6 digits here; `claimPairing()` returns a token.
 *   - Persist token+device+E2E key, then `props.onPaired(token)` after 600ms.
 *
 * The 6-digit input renders as 6 boxes for presentation; source of truth is
 * still a single `entered` signal (the 6-char string).
 */
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
  const digits = () => entered().replace(/\D/g, "").slice(0, 6);

  let boxRefs: HTMLInputElement[] = [];

  function setDigit(i: number, d: string) {
    const clean = d.replace(/\D/g, "").slice(-1);
    const arr = digits().padEnd(6, " ").split("");
    arr[i] = clean || " ";
    setEntered(arr.join("").replace(/\s/g, ""));
    if (clean && i < 5) boxRefs[i + 1]?.focus();
  }

  function onBoxKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === "Backspace") {
      const cur = digits();
      if (!cur[i] && i > 0) {
        e.preventDefault();
        boxRefs[i - 1]?.focus();
        const arr = cur.padEnd(6, " ").split("");
        arr[i - 1] = " ";
        setEntered(arr.join("").replace(/\s/g, ""));
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault(); boxRefs[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      e.preventDefault(); boxRefs[i + 1]?.focus();
    } else if (e.key === "Enter" && digits().length === 6) {
      void confirm();
    }
  }

  function onBoxPaste(e: ClipboardEvent) {
    const txt = e.clipboardData?.getData("text") ?? "";
    const cleaned = txt.replace(/\D/g, "").slice(0, 6);
    if (!cleaned) return;
    e.preventDefault();
    setEntered(cleaned);
    const target = Math.min(cleaned.length, 5);
    boxRefs[target]?.focus();
  }

  async function startRequest() {
    setError(null);
    setEntered("");
    setPhase("requesting");
    try {
      const r = await requestPairingCode();
      setCode(r.code);
      setClaimSecret(r.claimSecret);
      setExpiresAt(r.expiresAt);
      setPhase("awaiting-code");
      queueMicrotask(() => boxRefs[0]?.focus());
    } catch (err: any) {
      setError(err.message ?? String(err));
      setPhase("error");
    }
  }

  async function confirm() {
    const c = code();
    const s = claimSecret();
    if (!c || !s) return;
    if (digits() !== c) {
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

  const canSubmit = () => digits().length === 6 && !codeExpired() && phase() === "awaiting-code";

  return (
    <div class="min-h-screen grid place-items-center bg-bg-page text-text-primary p-4 sm:p-6 motion-safe:animate-[fade-in_150ms_ease-out]">
      <div
        class="w-full max-w-[420px] sm:max-w-md rounded-lg bg-bg-surface border border-border-subtle p-6 sm:p-8 shadow-[0_10px_40px_-10px_rgba(61,57,41,0.12)]"
      >
        <div class="flex flex-col items-center text-center mb-6 sm:mb-8">
          <div class="w-10 h-10 bg-accent rotate-45 rounded-sm mb-4" aria-hidden="true" />
          <div class="font-serif text-[24px] leading-tight text-text-primary">rcc</div>
          <div class="mt-1 text-[13px] font-sans text-text-secondary">{t("pair.subtitle")}</div>
        </div>

        <Show when={phase() === "intro" || phase() === "requesting" || phase() === "error"}>
          <div class="space-y-5">
            <p class="font-serif text-[15px] leading-relaxed text-text-primary">
              {t("pair.intro")}
            </p>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              loading={phase() === "requesting"}
              onClick={startRequest}
            >
              {phase() === "requesting" ? t("pair.requesting") : t("pair.requestCode")}
            </Button>
            <Show when={error()}>
              <div
                role="alert"
                class="rounded-md px-3 py-2 border border-danger/30 bg-danger/5 text-danger text-sm font-sans"
              >
                {error()}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={phase() === "awaiting-code" && code()}>
          <div class="space-y-5">
            <div>
              <div class="text-[11px] uppercase tracking-widest text-text-muted mb-2 font-sans">
                {t("pair.hostShownCode")}
              </div>
              <div class="font-mono text-[22px] text-text-primary tracking-[0.3em] select-all">
                {code()!.slice(0, 3)} {code()!.slice(3)}
              </div>
              <div
                class={`mt-1 text-[11px] font-sans ${codeExpired() ? "text-danger" : "text-text-muted"}`}
              >
                {codeExpired()
                  ? t("pair.expired")
                  : `${t("pair.validFor")}: ${Math.floor(secondsLeft() / 60)}:${String(secondsLeft() % 60).padStart(2, "0")}`}
              </div>
            </div>

            <div>
              <div class="text-[11px] uppercase tracking-widest text-text-muted mb-2 font-sans">
                {t("pair.reenter")}
              </div>
              <div class="flex gap-2 sm:gap-2.5 justify-between" onPaste={onBoxPaste}>
                <For each={[0, 1, 2, 3, 4, 5]}>
                  {(i) => (
                    <input
                      ref={(el) => (boxRefs[i] = el)}
                      type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1"
                      autocomplete={i === 0 ? "one-time-code" : "off"}
                      aria-label={`${t("pair.reenter")} ${i + 1}/6`}
                      value={digits()[i] ?? ""}
                      onInput={(e) => setDigit(i, e.currentTarget.value)}
                      onKeyDown={(e) => onBoxKeyDown(i, e)}
                      onFocus={(e) => e.currentTarget.select()}
                      class="w-12 h-14 sm:w-14 sm:h-16 rounded-md bg-bg-page border border-border-subtle text-center font-mono text-[28px] text-text-primary outline-none transition duration-fast ease-rcc focus:border-accent focus:ring-2 focus:ring-accent/30"
                    />
                  )}
                </For>
              </div>
            </div>

            <TextInput
              label={t("pair.deviceName")}
              value={deviceName()}
              onInput={setDeviceName}
              maxlength={64}
            />

            <div class="flex gap-2 pt-1">
              <Button variant="secondary" size="lg" onClick={startRequest}>
                {t("pair.retry")}
              </Button>
              <Button
                variant="primary" size="lg" class="flex-1"
                onClick={confirm} disabled={!canSubmit()} aria-disabled={!canSubmit()}
              >
                {t("pair.finish")}
              </Button>
            </div>

            <Show when={error()}>
              <div
                role="alert"
                class="rounded-md px-3 py-2 border border-danger/30 bg-danger/5 text-danger text-sm font-sans"
              >
                {error()}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={phase() === "claiming"}>
          <div class="text-center py-6 font-serif text-[15px] text-text-secondary">
            {t("pair.confirming")}
          </div>
        </Show>

        <Show when={phase() === "success"}>
          <div class="text-center py-6">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-accent grid place-items-center text-xl text-white motion-safe:animate-[fade-in_150ms_ease-out]">
              ✓
            </div>
            <div class="font-serif text-[17px] text-text-primary mb-1">{t("pair.success")}</div>
            <div class="text-[13px] font-sans text-text-muted">{t("pair.entering")}</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
