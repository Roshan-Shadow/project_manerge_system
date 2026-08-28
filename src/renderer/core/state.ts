import { Bug, Phase, Project, PmsTemplate, Requirement, Task } from '../../shared/types.js';
import { store } from './store.js';

export interface DataSet {
  projects: Project[];
  phases: Phase[];
  tasks: Task[];
  requirements: Requirement[];
  bugs: Bug[];
  templates: PmsTemplate[];
}

export const state = { projectId: '' as string, data: null as unknown as DataSet };

export async function reload(): Promise<void> {
  const [projects, phases, tasks, requirements, bugs, templates] = (await Promise.all([
    store.list('project'),
    store.list('phase'),
    store.list('task'),
    store.list('requirement'),
    store.list('bug'),
    store.list('template')
  ])) as [Project[], Phase[], Task[], Requirement[], Bug[], PmsTemplate[]];
  state.data = { projects, phases, tasks, requirements, bugs, templates };
  if (!state.data.projects.some((p) => p.id === state.projectId)) {
    state.projectId = state.data.projects[0]?.id ?? '';
  }
}

export function curProject(): Project | null {
  return state.data?.projects.find((p) => p.id === state.projectId) || null;
}

export function projectPhases(): Phase[] {
  return (state.data?.phases || []).filter((p) => p.projectId === state.projectId).sort((a, b) => a.order - b.order);
}

export function projectTasks(): Task[] {
  return (state.data?.tasks || []).filter((t) => t.projectId === state.projectId);
}

export function projectReqs(): Requirement[] {
  return (state.data?.requirements || []).filter((r) => r.projectId === state.projectId);
}

export function projectBugs(): Bug[] {
  return (state.data?.bugs || []).filter((b) => b.projectId === state.projectId);
}

export function isTaskOpen(t: Task): boolean {
  return t.status === '待开始' || t.status === '进行中';
}

/** 加权完成率：优先工时权重，无工时等权（与 PRD DASH-02 规则一致） */
export function completionPct(tasks: Task[]): number {
  const valid = tasks.filter((t) => t.status !== '已取消');
  if (!valid.length) return 0;
  let totalW = 0;
  let doneW = 0;
  for (const t of valid) {
    const w = t.hours > 0 ? t.hours : 1;
    totalW += w;
    if (t.status === '已完成') doneW += w;
  }
  return Math.round((doneW / totalW) * 100);
}
