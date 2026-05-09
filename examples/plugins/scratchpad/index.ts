// scratchpad — pure UI plugin. Entry file is required by manifest.json but
// does nothing at runtime beyond registering the plugin so the iframe UI
// shows up in the config tab. All state lives client-side in localStorage.

const plugin = {
  id: "scratchpad",
  name: "Scratchpad",
  version: "1.0.0",
  onLoad(ctx: { log: (m: string) => void }) {
    ctx.log("scratchpad loaded (pure UI plugin)");
  },
};

export default plugin;
