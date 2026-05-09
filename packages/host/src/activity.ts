import type { ActivityItem, Frame } from "@rcc/protocol";

const MAX_ITEMS = 200;
const MAX_ITEM_BYTES = 4096;

export type ActivityBroadcast = (frame: Frame) => void;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function cap(item: ActivityItem): ActivityItem {
  const raw = Buffer.byteLength(JSON.stringify(item), "utf8");
  if (raw <= MAX_ITEM_BYTES) return item;
  switch (item.kind) {
    case "approval":
      return { ...item, summary: truncate(item.summary, 512) };
    case "commits":
      return {
        ...item,
        subjects: item.subjects.slice(0, 10).map((s) => truncate(s, 160)),
      };
    case "crash":
      return { ...item, message: truncate(item.message, 1024) };
    case "update":
      return item.notes ? { ...item, notes: truncate(item.notes, 1024) } : item;
    case "session_exit":
      return { ...item, title: truncate(item.title, 512) };
  }
}

export class ActivityFeed {
  private items: ActivityItem[] = [];

  constructor(private readonly broadcast: ActivityBroadcast) {}

  append(item: ActivityItem): void {
    const capped = cap(item);
    this.items.push(capped);
    if (this.items.length > MAX_ITEMS) {
      this.items.splice(0, this.items.length - MAX_ITEMS);
    }
    try {
      this.broadcast({ v: 1, t: "activity.append", item: capped });
    } catch {
      // ignore — broadcast failures during shutdown
    }
  }

  /** Mutate the matching approval item in place and broadcast the update as
   * an append (clients overwrite by id). Returns true if a pending approval
   * with this id was found. */
  resolveApproval(id: string): boolean {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind === "approval" && it.id === id && it.status === "pending") {
        const updated: ActivityItem = { ...it, status: "resolved" };
        this.items[i] = updated;
        try {
          this.broadcast({ v: 1, t: "activity.append", item: updated });
        } catch {
          // ignore
        }
        return true;
      }
    }
    return false;
  }

  list(): ActivityItem[] {
    return [...this.items];
  }
}
