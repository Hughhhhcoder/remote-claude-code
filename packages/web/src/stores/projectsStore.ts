import { createSignal } from "solid-js";
import type { ProjectColor, ProjectMeta } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export type ProjectsStore = ReturnType<typeof createProjectsStore>;

export interface AddProjectOpts {
  name: string;
  cwd: string;
  color?: ProjectColor;
}

/**
 * Project domain store. Owns the canonical project list and exposes a
 * helper for the "default" project id used to bucket projectless sessions.
 *
 * Frame dispatch:
 *   hello          → seed from frame.projects (if present)
 *   project.list   → replace
 *
 * Creation goes through a project.add frame; the host echoes back a
 * project.list / project.added which updates the signal.
 */
export function createProjectsStore(client: RccClient) {
  const [projects, setProjects] = createSignal<ProjectMeta[]>([]);

  const unsubFrame = client.on((frame) => {
    if (frame.t === "hello") {
      if (frame.projects) setProjects(frame.projects);
      return;
    }
    if (frame.t === "project.list") {
      setProjects(frame.projects);
      return;
    }
  });

  /**
   * Returns the id of the project marked `isDefault`, or the first project
   * if none is explicitly flagged, or null when the list is empty.
   */
  function defaultProjectId(): string | null {
    const ps = projects();
    if (ps.length === 0) return null;
    return (ps.find((p) => p.isDefault) ?? ps[0]!).id;
  }

  function addProject(opts: AddProjectOpts): void {
    client.send({
      v: 1,
      t: "project.add",
      name: opts.name,
      cwd: opts.cwd,
      color: opts.color,
    });
  }

  return {
    projects,
    defaultProjectId,
    addProject,
    dispose: () => {
      unsubFrame();
    },
  };
}
