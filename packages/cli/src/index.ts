#!/usr/bin/env node
import {
  cmdLogin,
  cmdSessions,
  cmdPrompt,
  cmdChat,
  cmdShare,
  cmdDevices,
  cmdProjects,
  cmdVersion,
} from "./commands.ts";

function printHelp(): void {
  console.log(`rcc — standalone REST client for an RCC host

Usage:
  rcc <command> [options]

Commands:
  login      Save a host URL + device token to ~/.rcc/cli-config.json
  sessions   list | new | show | close | resume
  prompt     Send a prompt to a session
  chat       Print the chat transcript for a session
  share      Create a read-only share link for a session
  devices    list | revoke <id> | rename <id> <name>
  projects   list | add | remove
  version    Show CLI + host version
  help       Show this help

Global options:
  --profile <name>   Select a profile from ~/.rcc/cli-config.json
  --json             Emit raw JSON instead of formatted output
  --help             Show help for a subcommand
`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return cmd ? 0 : 2;
  }
  if (cmd === "--version" || cmd === "-v") {
    return cmdVersion(["--local"]);
  }
  switch (cmd) {
    case "login":
      return cmdLogin(rest);
    case "sessions":
      return cmdSessions(rest);
    case "prompt":
      return cmdPrompt(rest);
    case "chat":
      return cmdChat(rest);
    case "share":
      return cmdShare(rest);
    case "devices":
      return cmdDevices(rest);
    case "projects":
      return cmdProjects(rest);
    case "version":
      return cmdVersion(rest);
    default:
      console.error(`unknown command: ${cmd}`);
      console.error("run `rcc --help`");
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: ${msg}\n`);
    process.exit(1);
  });
