import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { UiPrefs, type UiPrefs as UiPrefsT, type UiPrefsPartial } from "@rcc/protocol";

function prefsPath(): string {
  return join(homedir(), ".rcc", "ui-prefs.json");
}

const DEFAULTS: UiPrefsT = UiPrefs.parse({});

export class PrefsStore {
  private prefs: UiPrefsT;

  private constructor(prefs: UiPrefsT) {
    this.prefs = prefs;
  }

  static async load(): Promise<PrefsStore> {
    try {
      const raw = await readFile(prefsPath(), "utf8");
      const parsed = UiPrefs.safeParse(JSON.parse(raw));
      if (parsed.success) return new PrefsStore(parsed.data);
      console.warn(`[rcc-host] ui-prefs.json invalid, using defaults:`, parsed.error.message);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn(`[rcc-host] failed to read ui-prefs.json: ${err?.message ?? err}`);
      }
    }
    return new PrefsStore({ ...DEFAULTS });
  }

  get(): UiPrefsT {
    return this.prefs;
  }

  async update(patch: UiPrefsPartial): Promise<UiPrefsT> {
    const next: UiPrefsT = {
      ...this.prefs,
      ...patch,
      customKeys: patch.customKeys ?? this.prefs.customKeys,
    };
    const validated = UiPrefs.parse(next);
    this.prefs = validated;
    const p = prefsPath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(validated, null, 2) + "\n", { mode: 0o600 });
    return validated;
  }
}
