import { getStatus, getHead, getLogRange, statusEqual, type GitStatus, type GitCommit } from "./git.ts";

const POLL_MS = 5_000;

export interface GitWatcherEvents {
  onStatus: (status: GitStatus | null) => void;
  onCommits: (commits: GitCommit[]) => void;
}

/**
 * Polls `git status` + HEAD for one session's cwd every 5s. Emits:
 *  - `onStatus` whenever the branch/dirty/ahead/behind/head 5-tuple changes.
 *  - `onCommits` the first time a new HEAD is seen (diff = list of new
 *    commits reachable from newHead but not baselineHead).
 *
 * Silent no-op when the cwd is not a git repo — status is emitted once as
 * null so clients can hide the widget and then the watcher idles.
 */
export class GitWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastStatus: GitStatus | null | undefined = undefined;
  private baselineHead: string | null = null;
  private disposed = false;

  constructor(
    private readonly cwd: string,
    private readonly events: GitWatcherEvents,
  ) {}

  async start(): Promise<void> {
    this.baselineHead = await getHead(this.cwd);
    await this.poll();
    // Arm the interval regardless — a non-repo cwd will keep returning null
    // cheaply, and users may `git init` mid-session.
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  /** External poke — e.g. after a /git:commit (not wired today but cheap to
   * keep around for manual refresh frames). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    const status = await getStatus(this.cwd);
    if (this.disposed) return;
    if (this.lastStatus === undefined || !statusEqual(this.lastStatus, status)) {
      this.lastStatus = status;
      this.events.onStatus(status);
    }
    if (status?.head && this.baselineHead && status.head !== this.baselineHead) {
      const commits = await getLogRange(this.cwd, this.baselineHead, status.head);
      if (this.disposed) return;
      if (commits.length > 0) this.events.onCommits(commits);
      this.baselineHead = status.head;
    } else if (status?.head && !this.baselineHead) {
      this.baselineHead = status.head;
    }
  }
}
