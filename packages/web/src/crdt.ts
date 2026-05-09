import * as Y from "yjs";
import type { RccClient } from "./client.ts";

export interface SharedText {
  ytext: Y.Text;
  getValue(): string;
  setValue(s: string): void;
  observe(cb: (value: string) => void): () => void;
  destroy(): void;
}

export function createSharedText(
  client: RccClient,
  sid: string,
  docId: string,
): SharedText {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("v");
  const origin = crypto.randomUUID();

  ydoc.on("update", (update: Uint8Array, trOrigin: unknown) => {
    if (trOrigin === "remote") return;
    client.send({
      v: 1,
      t: "crdt.update",
      sid,
      docId,
      update: b64(update),
      origin,
    });
  });

  const off = client.on((f) => {
    if (f.t === "crdt.update" && f.sid === sid && f.docId === docId) {
      if (f.origin === origin) return;
      Y.applyUpdate(ydoc, unb64(f.update), "remote");
    } else if (f.t === "crdt.sync" && f.sid === sid && f.docId === docId) {
      Y.applyUpdate(ydoc, unb64(f.state), "remote");
    }
  });

  client.send({ v: 1, t: "crdt.sync.request", sid, docId });

  return {
    ytext,
    getValue: () => ytext.toString(),
    setValue: (s: string) => {
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        if (s.length > 0) ytext.insert(0, s);
      });
    },
    observe(cb) {
      const handler = () => cb(ytext.toString());
      ytext.observe(handler);
      return () => ytext.unobserve(handler);
    },
    destroy: () => {
      off();
      ydoc.destroy();
    },
  };
}

function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
