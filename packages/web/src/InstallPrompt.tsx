import { createSignal, onCleanup, onMount, Show } from "solid-js";

/**
 * Captures the `beforeinstallprompt` event so we can show a custom "📲 安装"
 * button in the top bar. On iOS Safari (which never fires that event) we
 * instead show a small hint explaining Share → Add to Home Screen.
 *
 * The button is hidden once installed (either detected via `appinstalled`
 * event or via `matchMedia('(display-mode: standalone)')`).
 */

// Chrome's BeforeInstallPromptEvent isn't in lib.dom; declare the shape we use.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "rcc.installHint.dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari exposes navigator.standalone; everyone else uses display-mode.
  const navAny = navigator as Navigator & { standalone?: boolean };
  if (navAny.standalone) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent || "";
  // iPad on iOS 13+ reports Mac; also check touch points.
  const isIpad =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || isIpad;
}

function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = navigator.userAgent || "";
  // Exclude in-app browsers (FB/IG/Line/etc) where A2HS doesn't work reliably.
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua)) return false;
  return /Safari/.test(ua);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = createSignal<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = createSignal<boolean>(isStandalone());
  const [iosHintOpen, setIosHintOpen] = createSignal<boolean>(false);
  const [iosDismissed, setIosDismissed] = createSignal<boolean>(
    typeof localStorage !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1",
  );

  const onBeforeInstall = (e: Event) => {
    e.preventDefault();
    setDeferred(e as BeforeInstallPromptEvent);
  };
  const onInstalled = () => {
    setInstalled(true);
    setDeferred(null);
  };

  onMount(() => {
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
  });
  onCleanup(() => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
  });

  const onClick = async () => {
    const ev = deferred();
    if (ev) {
      try {
        await ev.prompt();
        await ev.userChoice;
      } catch {
        // user dismissed or browser rejected — no-op
      } finally {
        setDeferred(null);
      }
      return;
    }
    if (isIosSafari()) setIosHintOpen((v) => !v);
  };

  const dismissIosHint = () => {
    setIosHintOpen(false);
    setIosDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  // Show conditions:
  //   - beforeinstallprompt fired → always show (Chrome/Edge/Android)
  //   - iOS Safari, not yet installed, not permanently dismissed → show hint trigger
  //   - Otherwise hidden (already installed, unsupported browser, etc.)
  const showButton = () =>
    !installed() && (deferred() !== null || (isIosSafari() && !iosDismissed()));

  return (
    <Show when={showButton()}>
      <div class="relative">
        <button
          type="button"
          onClick={onClick}
          class="text-xs px-2.5 py-1 rounded-md border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-orange-500/50 text-zinc-300 hover:text-orange-300 transition flex items-center gap-1.5"
          title={deferred() ? "安装 RCC 到主屏" : "在 iOS Safari 手动添加到主屏"}
        >
          <span>📲</span>
          <span class="hidden sm:inline">安装</span>
        </button>
        <Show when={iosHintOpen()}>
          <div
            class="absolute right-0 top-full mt-2 w-72 z-50 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl p-3 text-[11px] text-zinc-300 leading-relaxed"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="font-medium text-zinc-100 mb-1 flex items-center justify-between">
              <span>在 iPhone / iPad 安装</span>
              <button
                class="text-zinc-500 hover:text-zinc-200"
                onClick={dismissIosHint}
                title="不再显示"
              >
                ✕
              </button>
            </div>
            <ol class="list-decimal pl-4 space-y-0.5 text-zinc-400">
              <li>在 Safari 中点击底部 <span class="text-zinc-200">分享 ⬆</span> 按钮</li>
              <li>滚动找到 <span class="text-zinc-200">"添加到主屏幕"</span></li>
              <li>点击 <span class="text-zinc-200">"添加"</span> 完成</li>
            </ol>
            <div class="mt-2 text-zinc-600">iOS Safari 不支持原生安装弹窗，只能手动添加。</div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
