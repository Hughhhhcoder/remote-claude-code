// Stateless CRDT relay. The host keeps a per-`sid:docId` ring of the last N
// Yjs update byte blobs (base64) so late-joining clients can catch up by
// replaying them. The host never instantiates a Y.Doc — it only forwards
// bytes, which keeps this package yjs-free.
//
// Trade-off: we don't merge updates into a compact state vector, so the
// buffer grows linearly with edits up to the ring cap. 200 is plenty for the
// input-draft use case (one in-flight message between sends), and the buffer
// resets on host restart. If a doc ever outgrows that we'd add a `Y.mergeUpdates`
// path, but that would require pulling yjs into host.

const BUFFER_LIMIT = 200;
export const CRDT_MAX_UPDATE_BYTES = 64 * 1024;

export interface CrdtBufferEntry {
  update: string;
  origin?: string;
}

export class CrdtRelay {
  private readonly buffers = new Map<string, CrdtBufferEntry[]>();

  private key(sid: string, docId: string): string {
    return `${sid}:${docId}`;
  }

  append(sid: string, docId: string, entry: CrdtBufferEntry): void {
    const k = this.key(sid, docId);
    let buf = this.buffers.get(k);
    if (!buf) {
      buf = [];
      this.buffers.set(k, buf);
    }
    buf.push(entry);
    if (buf.length > BUFFER_LIMIT) buf.splice(0, buf.length - BUFFER_LIMIT);
  }

  replay(sid: string, docId: string): CrdtBufferEntry[] {
    return this.buffers.get(this.key(sid, docId))?.slice() ?? [];
  }

  dropSession(sid: string): void {
    for (const k of this.buffers.keys()) {
      if (k.startsWith(`${sid}:`)) this.buffers.delete(k);
    }
  }
}

/**
 * Roughly validate a base64 Yjs update blob before we replicate it. We can't
 * parse the Y payload without the yjs dep, so we just cap the decoded size
 * as a DoS guard.
 */
export function isUpdateTooLarge(update: string): boolean {
  // base64 expands to ~3/4 the byte length; round up.
  const approx = Math.ceil((update.length * 3) / 4);
  return approx > CRDT_MAX_UPDATE_BYTES;
}
