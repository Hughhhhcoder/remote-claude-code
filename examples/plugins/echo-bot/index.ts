// Example plugin that echoes arbitrary payloads back to the caller.
// Copy this directory to ~/.rcc/plugins/echo-bot/ to install.
//
// The Plugin shape mirrors @rcc/host's internal type. We declare it inline
// here so the example stays dependency-free; the host side validates the
// object's `id`, `name`, `version` fields on load.

interface EchoPlugin {
  id: "echo-bot";
  name: string;
  version: string;
  onLoad?: (ctx: { log: (msg: string) => void }) => void;
  handleCall?: (method: string, payload: unknown) => Promise<unknown> | unknown;
}

const plugin: EchoPlugin = {
  id: "echo-bot",
  name: "Echo Bot",
  version: "1.0.0",
  onLoad(ctx) {
    ctx.log("echo-bot loaded");
  },
  async handleCall(method, payload) {
    if (method === "echo") return { echoed: payload, at: Date.now() };
    if (method === "ping") return { pong: true };
    throw new Error(`unknown method: ${method}`);
  },
};

export default plugin;
