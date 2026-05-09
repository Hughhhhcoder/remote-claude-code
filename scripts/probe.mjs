import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:7777/ws");
let sid = null;

ws.on("open", () => {
  console.log(">>> connected");
});

ws.on("message", (raw) => {
  const f = JSON.parse(raw.toString("utf8"));
  if (f.t === "hello") {
    console.log("<<< hello, sessions:", f.sessions.map((s) => `${s.id} @ ${s.cwd}`));
    sid = f.sessions[0].id;
    ws.send(JSON.stringify({ v: 1, t: "session.attach", sid, since: -1 }));
    setTimeout(() => {
      console.log(">>> sending 'echo hello from rcc'");
      ws.send(JSON.stringify({ v: 1, t: "pty.in", sid, data: "echo hello from rcc\n" }));
    }, 300);
    setTimeout(() => {
      console.log("--- done, closing");
      ws.close();
      process.exit(0);
    }, 1500);
  } else if (f.t === "pty.out") {
    process.stdout.write(`[out seq=${f.seq}] ${JSON.stringify(f.data)}\n`);
  } else {
    console.log("<<<", f.t, Object.keys(f).filter(k => k !== "t").join(","));
  }
});

ws.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
