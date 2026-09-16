import { canonicalJson, type Project } from "@blocky/language-schema";
import { parseProject } from "./index";
type Snapshot = {
  project: Project;
  dirty: boolean;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
};
export class ProjectController {
  private state: Snapshot;
  private saved: string;
  private past: Project[] = [];
  private future: Project[] = [];
  private group?: string;
  private listeners = new Set<() => void>();
  constructor(project: Project) {
    const p = parseProject(project);
    this.saved = canonicalJson(p);
    this.state = {
      project: p,
      dirty: false,
      revision: 0,
      canUndo: false,
      canRedo: false,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(project: Project) {
    this.state = {
      project,
      dirty: canonicalJson(project) !== this.saved,
      revision: this.state.revision + 1,
      canUndo: !!this.past.length,
      canRedo: !!this.future.length,
    };
    this.listeners.forEach((l) => l());
  }
  edit(edit: (project: Project) => void, group?: string) {
    const next = structuredClone(this.state.project);
    edit(next);
    const parsed = parseProject(next);
    if (canonicalJson(parsed) === canonicalJson(this.state.project)) return;
    if (!group || group !== this.group) this.past.push(this.state.project);
    this.past = this.past.slice(-100);
    this.future = [];
    this.group = group;
    this.publish(parsed);
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.project);
    this.group = undefined;
    this.publish(previous);
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.project);
    this.group = undefined;
    this.publish(next);
  }
  markSaved(project: Project) {
    this.saved = canonicalJson(project);
    this.publish(this.state.project);
  }
  replace(project: Project) {
    const p = parseProject(project);
    this.past = [];
    this.future = [];
    this.group = undefined;
    this.saved = canonicalJson(p);
    this.publish(p);
  }
}
