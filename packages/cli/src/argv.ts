export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]!);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      let key: string;
      let val: string | boolean;
      if (eq >= 0) {
        key = a.slice(2, eq);
        val = a.slice(eq + 1);
      } else {
        key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          val = next;
          i++;
        } else {
          val = true;
        }
      }
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function getString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export function getBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

export function getNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
  const v = flags[key];
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
