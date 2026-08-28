import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppSettings, HeatmapColor, PmsTemplate, ProjectArchive, RepoInfo, RepoListData } from '../shared/types.js';
import { restoreArchive, DbShape } from '../shared/storeOps.js';
import { clone } from '../shared/util.js';
import { BUILTIN_TEMPLATES } from '../shared/builtin.js';

/* ============ 工作区设置（SET-01~05） ============
 * 设置保存于 <工作目录>/setting.json（随工作目录迁移）；
 * 用户数据目录仅存指针 workspace-pointer.json（记录上次工作目录）；
 * 首次启动无指针 → ready=false → 渲染层弹首启向导（SET-04）。 */

/** 用户数据目录中的工作目录指针 */
function pointerFile(): string {
  return path.join(app.getPath('userData'), 'workspace-pointer.json');
}

/** 工作目录中的设置文件（用户指定名：setting.json） */
function settingFile(workDir: string): string {
  return path.join(workDir, 'setting.json');
}

function readPointer(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(pointerFile(), 'utf-8')) as { workDir?: string };
    if (raw && typeof raw.workDir === 'string' && raw.workDir.trim()) return raw.workDir.trim();
  } catch {
    /* 无指针 */
  }
  return '';
}

function writePointer(workDir: string): void {
  fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
  fs.writeFileSync(pointerFile(), JSON.stringify({ workDir }, null, 2), 'utf-8');
}

/* ============ 系统仓库列表（repos-list.json） ============ */

function reposListFile(): string {
  return path.join(app.getPath('userData'), 'repos-list.json');
}

export function readRepoList(): RepoListData {
  try {
    const raw = JSON.parse(fs.readFileSync(reposListFile(), 'utf-8')) as RepoListData;
    if (raw && Array.isArray(raw.repos)) return raw;
  } catch { /* 无列表 */ }
  return { repos: [], activeId: '' };
}

function writeRepoList(data: RepoListData): void {
  fs.mkdirSync(path.dirname(reposListFile()), { recursive: true });
  fs.writeFileSync(reposListFile(), JSON.stringify(data, null, 2), 'utf-8');
}

export function addRepo(name: string, dirPath: string): RepoInfo {
  const list = readRepoList();
  const existing = list.repos.find((r) => r.path === dirPath);
  if (existing) {
    list.activeId = existing.id;
    writeRepoList(list);
    return existing;
  }
  const repo: RepoInfo = { id: crypto.randomUUID(), name, path: dirPath };
  list.repos.push(repo);
  list.activeId = repo.id;
  writeRepoList(list);
  return repo;
}

/** 在指定路径创建全新的系统仓库（使用用户设定的默认设置） */
export function addRepoAtPath(db: DbShape, name: string, dirPath: string): RepoInfo {
  fs.mkdirSync(dirPath, { recursive: true });
  const defaults = getRepoDefaults();
  const s: AppSettings = { workDir: dirPath, ...defaults };
  cache = s;
  ensureWorkspace(s);
  fs.writeFileSync(settingFile(dirPath), JSON.stringify(s, null, 2), 'utf-8');
  writePointer(dirPath);
  // 重置模板为系统内置，再加载当前仓库的自定义模板
  db.templates = clone(BUILTIN_TEMPLATES);
  loadCustomTemplates(db, dirPath);
  const restored = restoreProjectsFromWorkspace(db, dirPath);
  bootSummary = { ready: true, workDir: dirPath, restored, adopted: false };
  return addRepo(name, dirPath);
}

export function switchRepo(repoId: string): RepoInfo | null {
  const list = readRepoList();
  const repo = list.repos.find((r) => r.id === repoId);
  if (!repo) return null;
  list.activeId = repoId;
  writeRepoList(list);
  return repo;
}

export function removeRepo(repoId: string): boolean {
  const list = readRepoList();
  const idx = list.repos.findIndex((r) => r.id === repoId);
  if (idx < 0) return false;
  list.repos.splice(idx, 1);
  if (list.activeId === repoId) list.activeId = list.repos[0]?.id || '';
  writeRepoList(list);
  return true;
}

export function getActiveRepo(): RepoInfo | null {
  const list = readRepoList();
  return list.repos.find((r) => r.id === list.activeId) || null;
}

/* ============ 新建仓库默认设置 ============ */

type RepoDefaults = Omit<AppSettings, 'workDir'>;

function repoDefaultsFile(): string {
  return path.join(app.getPath('userData'), 'repo-defaults.json');
}

export function getRepoDefaults(): RepoDefaults {
  try {
    const raw = JSON.parse(fs.readFileSync(repoDefaultsFile(), 'utf-8')) as Partial<RepoDefaults>;
    return {
      repoNaming: raw?.repoNaming || 'name',
      trashRetentionDays: typeof raw?.trashRetentionDays === 'number' ? raw.trashRetentionDays : 30,
      heatmapColor: (raw?.heatmapColor as HeatmapColor) || 'green',
      heatmapRange: typeof raw?.heatmapRange === 'number' ? raw.heatmapRange : 365,
      heatmapStartDate: typeof raw?.heatmapStartDate === 'string' ? raw.heatmapStartDate : ''
    };
  } catch {
    return { repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' };
  }
}

export function saveRepoDefaults(patch: Partial<RepoDefaults>): RepoDefaults {
  const cur = getRepoDefaults();
  const next: RepoDefaults = {
    repoNaming: patch.repoNaming || cur.repoNaming,
    trashRetentionDays: typeof patch.trashRetentionDays === 'number' ? patch.trashRetentionDays : cur.trashRetentionDays,
    heatmapColor: (patch.heatmapColor as HeatmapColor) || cur.heatmapColor,
    heatmapRange: typeof patch.heatmapRange === 'number' ? patch.heatmapRange : cur.heatmapRange,
    heatmapStartDate: typeof patch.heatmapStartDate === 'string' ? patch.heatmapStartDate : cur.heatmapStartDate
  };
  fs.mkdirSync(path.dirname(repoDefaultsFile()), { recursive: true });
  fs.writeFileSync(repoDefaultsFile(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

/** 对指定目录应用默认设置（使用用户设定的新建默认值） */
export function applyFreshSettings(db: DbShape, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const defaults = getRepoDefaults();
  const s: AppSettings = { workDir: dir, ...defaults };
  cache = s;
  ensureWorkspace(s);
  fs.writeFileSync(settingFile(dir), JSON.stringify(s, null, 2), 'utf-8');
  writePointer(dir);
  // 重置模板为系统内置，再加载当前仓库的自定义模板
  db.templates = clone(BUILTIN_TEMPLATES);
  loadCustomTemplates(db, dir);
  const restored = restoreProjectsFromWorkspace(db, dir);
  bootSummary = { ready: true, workDir: dir, restored, adopted: false };
}

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  return cache || { workDir: '', repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' };
}

/** SET-01 确保工作目录结构：repos（默认项目仓库根）/ cache / temp / plugins */
export function ensureWorkspace(s: AppSettings): string[] {
  if (!s.workDir) return [];
  const dirs = [
    s.workDir,
    path.join(s.workDir, 'repos'),
    path.join(s.workDir, 'cache'),
    path.join(s.workDir, 'temp'),
    path.join(s.workDir, 'plugins'),
    path.join(s.workDir, 'trash'),
    path.join(s.workDir, 'template')
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  return dirs;
}

/** 扫描 <工作目录>/repos 下各项目目录，按 ID 去重恢复项目；无 project.json 的目录自动创建项目条目 */
function restoreProjectsFromWorkspace(db: DbShape, workDir: string): number {
  const reposRoot = path.join(workDir, 'repos');
  let restored = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(reposRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pjPath = path.join(reposRoot, e.name, 'project.json');
    try {
      const raw = JSON.parse(fs.readFileSync(pjPath, 'utf-8')) as ProjectArchive;
      if (raw && raw.format === 'pms-project-archive' && restoreArchive(db, raw) === 'restored') {
        restored += 1;
        continue;
      }
    } catch { /* 无 project.json → 自动导入 */ }
    // 目录无有效 project.json → 从目录名创建项目条目
    const dirPath = path.join(reposRoot, e.name);
    const dirName = e.name;
    // 检查是否已存在同名项目（避免重复导入）
    const existing = db.projects.find((p) => p.name === dirName);
    if (existing) continue;
    const now = new Date().toISOString();
    db.projects.push({
      id: `prj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: dirName,
      status: '进行中' as any,
      startDate: '',
      endDate: '',
      description: `从系统仓库目录「${dirName}」自动导入`,
      createdAt: now
    } as any);
    restored += 1;
  }
  return restored;
}

/** 扫描 <工作目录>/template 下的 .json 模板文件，加载到 db.templates；名称冲突时追加 Customer 后缀 */
function loadCustomTemplates(db: DbShape, workDir: string): number {
  const tplDir = path.join(workDir, 'template');
  let loaded = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tplDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  // 收集系统模板名称用于冲突检测
  const existingNames = new Set(db.templates.map((t) => t.name));
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(tplDir, e.name), 'utf-8'));
      if (!raw || !Array.isArray(raw.phases)) continue;
      // 构建模板对象
      const tpl: PmsTemplate = {
        id: `tpl_custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: raw.name || e.name.replace(/\.json$/, ''),
        category: raw.category || '自定义',
        builtin: false,
        phases: raw.phases,
        createdAt: new Date().toISOString()
      };
      // 名称冲突处理：追加 Customer 后缀
      if (existingNames.has(tpl.name)) {
        tpl.name = `${tpl.name}_Customer`;
      }
      existingNames.add(tpl.name);
      db.templates.push(tpl);
      loaded += 1;
    } catch {
      /* 非法 JSON 或格式不对，跳过 */
    }
  }
  return loaded;
}

/**
 * 应用指定工作目录（SET-04/05 核心）：
 * - 目录已有 setting.json（或 repos 快照）→ 视为本系统工作目录：应用其中设置；
 * - 否则创建全新工作区并写入默认 setting.json；
 * - 建目录结构、更新指针、按 ID 去重恢复项目。
 */
export function applyWorkDir(
  db: DbShape,
  dir: string
): { workDir: string; restored: number; adopted: boolean } {
  const sf = settingFile(dir);
  const adopted = fs.existsSync(sf) || fs.existsSync(path.join(dir, 'repos'));
  let s: AppSettings = { workDir: dir, repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' };
  if (fs.existsSync(sf)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sf, 'utf-8')) as Partial<AppSettings>;
      if (raw && (raw.repoNaming === 'name_id' || raw.repoNaming === 'name' || raw.repoNaming === 'id_name' || raw.repoNaming === 'date_name')) {
        s = { workDir: dir, repoNaming: raw.repoNaming, trashRetentionDays: typeof raw.trashRetentionDays === 'number' ? raw.trashRetentionDays : 30, heatmapColor: (raw.heatmapColor as any) || 'green', heatmapRange: typeof raw.heatmapRange === 'number' ? raw.heatmapRange : 365, heatmapStartDate: typeof raw.heatmapStartDate === 'string' ? raw.heatmapStartDate : '' };
      }
    } catch {
      /* setting.json 损坏 → 使用默认并重写 */
    }
  }
  cache = s;
  ensureWorkspace(s);
  fs.writeFileSync(sf, JSON.stringify(s, null, 2), 'utf-8');
  writePointer(dir);
  const restored = restoreProjectsFromWorkspace(db, dir);
  return { workDir: dir, restored, adopted };
}

let bootSummary: { ready: boolean; workDir: string; restored: number; adopted: boolean } = {
  ready: false,
  workDir: '',
  restored: 0,
  adopted: false
};

/** 应用启动时调用（main.ts whenReady）：repos-list → 应用工作目录 → 恢复项目；无指针则等待首启向导 */
export function initWorkspace(db: DbShape): void {
  // 优先使用 repos-list.json 中的 activeId
  const repoList = readRepoList();
  let dir = '';
  if (repoList.activeId) {
    const active = repoList.repos.find((r) => r.id === repoList.activeId);
    if (active && fs.existsSync(active.path)) dir = active.path;
  }
  // 兼容旧版：workspace-pointer.json
  if (!dir) dir = readPointer();
  // 兼容旧版：userData/settings.json
  if (!dir) {
    try {
      const old = JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8')
      ) as { workDir?: string };
      if (old && typeof old.workDir === 'string' && old.workDir.trim()) dir = old.workDir.trim();
    } catch { /* 无旧设置 */ }
  }
  if (!dir || !fs.existsSync(dir)) {
    cache = { workDir: '', ...getRepoDefaults() };
    bootSummary = { ready: false, workDir: '', restored: 0, adopted: false };
    return;
  }
  // 始终应用全新默认设置（含自动扫描导入项目）
  applyFreshSettings(db, dir);
}

export function getWorkspaceBoot(): { ready: boolean; workDir: string; restored: number; repos: RepoInfo[] } {
  const list = readRepoList();
  return { ready: bootSummary.ready, workDir: bootSummary.workDir, restored: bootSummary.restored, repos: list.repos };
}

/** 向导/切换工作目录 */
export function setWorkDir(db: DbShape, dir: string, _repoName?: string): { settings: AppSettings; restored: number; adopted: boolean } {
  applyFreshSettings(db, dir);
  return { settings: getSettings(), restored: bootSummary.restored, adopted: false };
}

/** SET-01/02 保存设置（写入工作目录 setting.json，保持指针） */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = getSettings();
  const workDir = typeof patch.workDir === 'string' && patch.workDir.trim() ? patch.workDir.trim() : cur.workDir;
  if (!workDir) throw new Error('尚未设置工作目录');
  const next: AppSettings = {
    workDir,
    repoNaming: patch.repoNaming || cur.repoNaming,
    trashRetentionDays: typeof patch.trashRetentionDays === 'number' ? patch.trashRetentionDays : cur.trashRetentionDays,
    heatmapColor: (patch.heatmapColor as any) || cur.heatmapColor || 'green',
    heatmapRange: typeof patch.heatmapRange === 'number' ? patch.heatmapRange : cur.heatmapRange || 365,
    heatmapStartDate: typeof patch.heatmapStartDate === 'string' ? patch.heatmapStartDate : cur.heatmapStartDate || ''
  };
  cache = next;
  ensureWorkspace(next);
  fs.writeFileSync(settingFile(workDir), JSON.stringify(next, null, 2), 'utf-8');
  writePointer(workDir);
  return next;
}

/** PMS_SMOKE 自检：目录结构 + 命名切换/还原 + setting.json 持久化 */
export function settingsSelfTest(): string {
  const s0 = getSettings();
  if (!s0.workDir) return 'skip（工作目录未设置，首启向导待完成）';
  ensureWorkspace(s0);
  const subs = fs.readdirSync(s0.workDir).join('|');
  saveSettings({ repoNaming: 'id_name' });
  const changed = getSettings().repoNaming === 'id_name';
  saveSettings({ repoNaming: s0.repoNaming });
  const restored = getSettings().repoNaming === s0.repoNaming;
  const persisted = fs.existsSync(settingFile(s0.workDir)) && !!readPointer();
  return `workDir=${s0.workDir} subs=[${subs}] settingJson=${persisted} namingSwitch=${changed && restored}`;
}
