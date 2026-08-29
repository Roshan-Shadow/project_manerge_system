import {
  Bug,
  EntityName,
  ID,
  Phase,
  Project,
  ProjectArchive,
  PmsTemplate,
  RepoNaming,
  Requirement,
  Task,
  CreateProjectInput
} from './types.js';
import { uid } from './uid.js';
import { clamp, clone } from './util.js';
import { DAY, fmtDate, parseDate } from './date.js';
import { BUILTIN_TEMPLATES } from './builtin.js';

export interface DbShape {
  projects: Project[];
  phases: Phase[];
  tasks: Task[];
  requirements: Requirement[];
  bugs: Bug[];
  templates: PmsTemplate[];
}

/** 内存数组临时仓库（无后端，前端自闭环；主进程与浏览器回退模式共用本纯函数层） */
export function createEmptyDb(): DbShape {
  return {
    projects: [],
    phases: [],
    tasks: [],
      requirements: [],
    bugs: [],
    templates: clone(BUILTIN_TEMPLATES)
  };
}

const KEYOF: Record<EntityName, keyof DbShape> = {
  project: 'projects',
  phase: 'phases',
  task: 'tasks',
  requirement: 'requirements',
  bug: 'bugs',
  template: 'templates'
};

const PREFIX: Record<EntityName, string> = {
  project: 'prj',
  phase: 'ph',
  task: 't',
  requirement: 'req',
  bug: 'bug',
  template: 'tpl'
};

function arr(db: DbShape, e: EntityName): Record<string, unknown>[] {
  return (db as unknown as Record<string, Record<string, unknown>[]>)[KEYOF[e]];
}

export function listRows<T>(db: DbShape, e: EntityName): T[] {
  return clone(arr(db, e)) as unknown as T[];
}

export function createRow<T>(db: DbShape, e: EntityName, data: Record<string, unknown>): T {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { ...data, id: uid(PREFIX[e]) };
  if (e === 'project' && !row.createdAt) row.createdAt = now;
  if (e === 'template' && !row.createdAt) row.createdAt = now;
  if (e === 'task') {
    if (!('deliverables' in row) || !Array.isArray(row.deliverables)) row.deliverables = [];
    if (!('completedAt' in row)) row.completedAt = '';
  }
  if (e === 'requirement') {
    if (!row.createdAt) row.createdAt = '';
    if (!Array.isArray(row.taskIds)) row.taskIds = [];
  }
  if (e === 'bug') {
    if (!row.createdAt) row.createdAt = '';
    if (!('closedAt' in row)) row.closedAt = '';
    if (!('linkReqId' in row)) row.linkReqId = '';
  }
  arr(db, e).push(row);
  return clone(row) as unknown as T;
}

export function updateRow<T>(db: DbShape, e: EntityName, id: ID, patch: Record<string, unknown>): T | null {
  const rows = arr(db, e);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  return clone(row) as unknown as T;
}

export function removeRows(db: DbShape, e: EntityName, ids: ID[]): void {
  const set = new Set(ids);
  const rows = arr(db, e);
  for (const id of ids) {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
  }
  if (e === 'project') {
    db.phases = db.phases.filter((p) => !set.has(p.projectId));
    db.tasks = db.tasks.filter((t) => !set.has(t.projectId));
    db.requirements = db.requirements.filter((r) => !set.has(r.projectId));
    db.bugs = db.bugs.filter((b) => !set.has(b.projectId));
  }
  if (e === 'phase') {
    for (const t of db.tasks) if (set.has(t.phaseId)) t.phaseId = '';
  }
  if (e === 'task') {
    for (const r of db.requirements) {
      if (Array.isArray(r.taskIds)) r.taskIds = r.taskIds.filter((tid) => !set.has(tid));
    }
  }
  if (e === 'requirement') {
    for (const b of db.bugs) if (set.has(b.linkReqId)) b.linkReqId = '';
  }
}

/** TPL-03 从模板创建项目：阶段按周期等分，任务在阶段窗口内均分排期，里程碑按 offsetRatio 映射日期 */
export function buildProjectFromTemplate(
  db: DbShape,
  tpl: PmsTemplate | null,
  input: CreateProjectInput
): Project {
  const id = uid('prj');
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const project: Project = {
    id,
    name: input.name,
    owner: input.owner || '',
    startDate: input.startDate,
    endDate: input.endDate,
    status: '进行中',
    members: input.members && input.members.length ? input.members : input.owner ? [input.owner] : [],
    templateSource: tpl ? tpl.name : '空白项目',
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  if (!tpl) return clone(project);

  const span = Math.max(end - start, DAY);
  const n = tpl.phases.length;
  let cursor = start;
  tpl.phases.forEach((ph, i) => {
    const phase: Phase = { id: uid('ph'), projectId: id, name: ph.name, order: i + 1 };
    db.phases.push(phase);
    const isLast = i === n - 1;
    const phaseEnd = isLast ? end : Math.min(end, start + Math.round((span * (i + 1)) / n) - DAY);
    const phStart = Math.min(cursor, phaseEnd);
    const phaseDays = Math.max(Math.round((phaseEnd - phStart) / DAY) + 1, 1);
    const m = Math.max(ph.tasks.length, 1);
    const dur = Math.max(1, Math.floor(phaseDays / m));
    ph.tasks.forEach((title, j) => {
      const s = phStart + Math.min(j * dur, phaseDays - 1) * DAY;
      const e2 = Math.max(Math.min(s + (dur - 1) * DAY, phaseEnd), s);
      const tplDeliverables = ph.taskDeliverables?.[j] || [];
      db.tasks.push({
        id: uid('t'),
        projectId: id,
        phaseId: phase.id,
        title,
        owner: '',
        startDate: fmtDate(s),
        endDate: fmtDate(e2),
        hours: 8,
        progress: 0,
        status: '待开始',
        priority: 'P1',
        desc: '',
        deliverables: tplDeliverables.map((d) => ({
          id: uid('dl'),
          name: d.name,
          note: d.note || '',
          time: '',
          accepted: false
        })),
        completedAt: ''
      });
    });
    cursor = phaseEnd + DAY;
  });
  return clone(project);
}

/** TPL-02 项目另存为模板：结构快照 + 里程碑 offsetRatio 反算 */
export function snapshotProjectAsTemplate(
  db: DbShape,
  projectId: ID,
  name: string,
  category: string
): PmsTemplate | null {
  const prj = db.projects.find((p) => p.id === projectId);
  if (!prj) return null;
  const start = parseDate(prj.startDate);
  const span = Math.max(parseDate(prj.endDate) - start, DAY);
  const phases = db.phases
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => a.order - b.order)
    .map((ph) => {
      const phaseTasks = db.tasks.filter((t) => t.phaseId === ph.id);
      const taskDeliverables: Record<number, { name: string; note?: string }[]> = {};
      phaseTasks.forEach((t, idx) => {
        if (t.deliverables.length) {
          const unique = [...new Map(t.deliverables.map((d) => [d.name, d])).values()];
          taskDeliverables[idx] = unique.map((d) => ({ name: d.name, note: d.note || undefined }));
        }
      });
      return {
        name: ph.name,
        tasks: phaseTasks.map((t) => t.title),
        ...(Object.keys(taskDeliverables).length ? { taskDeliverables } : {})
      };
    });
  const ungrouped = db.tasks.filter((t) => t.projectId === projectId && !t.phaseId);
  if (ungrouped.length) phases.push({ name: '未分组', tasks: ungrouped.map((t) => t.title) });
  const tpl: PmsTemplate = {
    id: uid('tpl'),
    name,
    category: category || '自定义',
    builtin: false,
    phases,
    createdAt: new Date().toISOString()
  };
  db.templates.push(tpl);
  return clone(tpl);
}

/* ============ 项目仓库与导入导出（REPO-01~05）纯函数 ============ */

/** 目录名清洗：去除 Windows 非法字符，限长 */
export function sanitizeFolderName(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 40);
  return s || '未命名';
}

/** 仓库根下的项目目录名（SET-02 命名方式；name 方式的重名冲突回退由主进程 ensureRepo 处理） */
export function repoDirName(p: Project, naming: RepoNaming = 'name_id'): string {
  const name = sanitizeFolderName(p.name);
  const sid = p.id.slice(-6);
  switch (naming) {
    case 'name':
      return name;
    case 'id_name':
      return `${sid}_${name}`;
    case 'date_name': {
      const d = p.createdAt ? new Date(p.createdAt) : new Date();
      const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
      return `${ymd}_${name}`;
    }
    case 'name_id':
    default:
      return `${name}_${sid}`;
  }
}

/** REPO-02 阶段文件夹名 */
export function phaseDirName(ph: Phase): string {
  return sanitizeFolderName(ph.name);
}

/** 带序号的阶段文件夹名（如 01_选题与开题） */
export function numberedPhaseDirName(ph: Phase, index: number): string {
  const num = String(index + 1).padStart(2, '0');
  return `${num}_${sanitizeFolderName(ph.name)}`;
}

/** 任务相对仓库根的目录段（含阶段序号前缀）：[阶段, 01_任务] 或未分组时 [01_任务] */
function taskRelParts(task: Task, phases: Phase[], allTasks: Task[]): string[] {
  const sorted = phases.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((p) => p.id === task.phaseId);
  const ph = idx >= 0 ? sorted[idx] : undefined;
  const tf = sanitizeFolderName(task.title) || '任务';
  if (ph) {
    const siblings = allTasks.filter((t) => t.phaseId === ph.id).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const taskIdx = siblings.findIndex((t) => t.id === task.id);
    const num = String(taskIdx + 1).padStart(2, '0');
    return [numberedPhaseDirName(ph, idx), `${num}_${tf}`];
  }
  return [tf];
}

/**
 * REPO-02 计算项目全部任务的仓库相对目录（阶段/任务 层级）。
 * 同一父级下同名任务自动追加短 ID 去重；返回 taskId → 相对路径（用 '/' 分隔）映射。
 */
export function computeTaskDirs(tasks: Task[], phases: Phase[]): Map<ID, string> {
  const map = new Map<ID, string>();
  const used = new Map<string, Set<string>>();
  for (const t of tasks) {
    const parts = taskRelParts(t, phases, tasks);
    const parent = parts.length > 1 ? parts[0] : '';
    let name = parts[parts.length - 1];
    const set = used.get(parent) || new Set<string>();
    if (set.has(name)) name = `${name}_${t.id.slice(-4)}`;
    set.add(name);
    used.set(parent, set);
    map.set(t.id, parent ? `${parent}/${name}` : name);
  }
  return map;
}

/** REPO-02 仓库应存在的全部相对目录：阶段文件夹（同级）+ 任务子文件夹 */
export function repoRelFolders(phases: Phase[], tasks: Task[]): string[] {
  const sorted = phases.slice().sort((a, b) => a.order - b.order);
  const rels: string[] = sorted.map((p, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `${num}_${sanitizeFolderName(p.name)}`;
  });
  for (const rel of computeTaskDirs(tasks, phases).values()) rels.push(rel);
  return rels;
}

/** REPO-10 按 ID 去重恢复快照：已存在同 ID 项目时跳过（不创建副本/不重复导入），保留原 ID 与全部关联 */
export function restoreArchive(db: DbShape, a: ProjectArchive): 'restored' | 'exists' {
  if (!a || !a.project || db.projects.some((p) => p.id === a.project.id)) return 'exists';
  db.projects.push(clone(a.project));
  for (const ph of a.phases) db.phases.push(clone(ph));
  for (const t of a.tasks) {
    db.tasks.push({ ...clone(t), deliverables: clone(t.deliverables || []) });
  }
  for (const r of a.requirements) db.requirements.push(clone(r));
  for (const b of a.bugs) db.bugs.push(clone(b));
  return 'restored';
}

/** REPO-03/04 构建项目完整快照（仓库 project.json 与导出文件共用） */
export function buildArchive(db: DbShape, projectId: ID): ProjectArchive | null {
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    format: 'pms-project-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: clone(project),
    phases: clone(db.phases.filter((p) => p.projectId === projectId).sort((a, b) => a.order - b.order)),
    tasks: clone(db.tasks.filter((t) => t.projectId === projectId)),
    requirements: clone(db.requirements.filter((r) => r.projectId === projectId)),
    bugs: clone(db.bugs.filter((b) => b.projectId === projectId))
  };
}

/** REPO-05 导入快照：全部实体换新 ID，关联关系（阶段↔任务、需求↔任务、缺陷↔需求）保持 */
export function importArchive(db: DbShape, archive: ProjectArchive): Project {
  const phaseMap = new Map<ID, ID>();
  const taskMap = new Map<ID, ID>();
  const reqMap = new Map<ID, ID>();
  const name = db.projects.some((p) => p.name === archive.project.name)
    ? `${archive.project.name}（导入）`
    : archive.project.name;
  const project: Project = { ...clone(archive.project), id: uid('prj'), name };
  db.projects.push(project);
  for (const ph of archive.phases) {
    const nid = uid('ph');
    phaseMap.set(ph.id, nid);
    db.phases.push({ ...clone(ph), id: nid, projectId: project.id });
  }
  for (const t of archive.tasks) {
    const nid = uid('t');
    taskMap.set(t.id, nid);
    db.tasks.push({
      ...clone(t),
      id: nid,
      projectId: project.id,
      phaseId: t.phaseId ? phaseMap.get(t.phaseId) || '' : '',
      deliverables: clone(t.deliverables || [])
    });
  }
  for (const r of archive.requirements) {
    const nid = uid('req');
    reqMap.set(r.id, nid);
    db.requirements.push({
      ...clone(r),
      id: nid,
      projectId: project.id,
      taskIds: (r.taskIds || []).map((tid) => taskMap.get(tid)).filter((x): x is ID => !!x)
    });
  }
  for (const b of archive.bugs) {
    db.bugs.push({
      ...clone(b),
      id: uid('bug'),
      projectId: project.id,
      linkReqId: b.linkReqId ? reqMap.get(b.linkReqId) || '' : ''
    });
  }
  return clone(project);
}
