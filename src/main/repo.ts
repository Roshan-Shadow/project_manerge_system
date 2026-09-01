import { BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';
import {
  DbShape,
  buildArchive,
  buildProjectFromTemplate,
  computeTaskDirs,
  createEmptyDb,
  importArchive,
  numberedPhaseDirName,
  phaseDirName,
  repoDirName,
  repoRelFolders,
  restoreArchive,
  sanitizeFolderName
} from '../shared/storeOps.js';
import { BUILTIN_TEMPLATES } from '../shared/builtin.js';
import { uid } from '../shared/uid.js';
import { Deliverable, Project, ProjectArchive } from '../shared/types.js';
import { getSettings } from './settings.js';

/* ============ 项目仓库（REPO-01~09）：磁盘目录 + project.json 状态档案 + 导入导出 + 文件提交 ============
 * 层级：项目仓库根 → 阶段文件夹（同级）→ 任务文件夹。 */

/** 仓库根目录（SET-01）：<工作目录>/repos；未设置工作目录时返回空串 */
export function repoRoot(): string {
  const wd = getSettings().workDir;
  return wd ? path.join(wd, 'repos') : '';
}

/** 在仓库根中按 project.json 的项目 ID 定位既有目录（用于重命名/切换命名方式后迁移） */
function findExistingDir(root: string, projectId: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    try {
      const raw = fs.readFileSync(path.join(dir, 'project.json'), 'utf-8');
      const meta = JSON.parse(raw) as { project?: { id?: string } };
      if (meta?.project?.id === projectId) return dir;
    } catch {
      /* 非 PMS 仓库目录，跳过 */
    }
  }
  return null;
}

/** 读取目录归属的项目 ID（null = 无法识别） */
function dirOwnerId(dir: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8')) as {
      project?: { id?: string };
    };
    return meta?.project?.id || null;
  } catch {
    return null;
  }
}

/** REPO-01/02/03：确保项目仓库存在——阶段/任务层级目录 + project.json 状态档案；重命名/切命名方式自动迁移目录 */
export function ensureRepo(db: DbShape, projectId: string): string | null {
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const root = repoRoot();
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  const naming = getSettings().repoNaming;
  let dir = path.join(root, repoDirName(p, naming));
  // 「仅项目名」等方案与其他项目/目录冲突时回退到唯一的 项目名_短ID
  if (fs.existsSync(dir) && dirOwnerId(dir) !== p.id && !findExistingDir(root, p.id)) {
    dir = path.join(root, repoDirName(p, 'name_id'));
  }
  const old = findExistingDir(root, p.id);
  if (old && path.resolve(old) !== path.resolve(dir)) {
    try {
      fs.renameSync(old, dir); // 项目重命名/切换命名方式 → 迁移目录（内容文件随目录移动）
    } catch {
      dir = old; // 迁移失败（如被占用）则沿用旧目录，保证可写
    }
  }
  const phases = db.phases.filter((x) => x.projectId === p.id).sort((a, b) => a.order - b.order);
  const tasks = db.tasks.filter((x) => x.projectId === p.id);
  const folders = repoRelFolders(phases, tasks);
  folders.push('00_work_space'); // 工作空间目录
  for (const rel of folders) fs.mkdirSync(path.join(dir, rel), { recursive: true }); // 只增不删，已存文件安全
  const archive = buildArchive(db, p.id);
  if (archive) {
    const file = {
      ...archive,
      repo: { dir: path.basename(dir), folders, generatedAt: new Date().toISOString() }
    } satisfies ProjectArchive;
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(file, null, 2), 'utf-8');
  }
  return dir;
}

/** 数据变更后防抖同步全部项目仓库 */
let syncTimer: NodeJS.Timeout | null = null;
export function scheduleRepoSync(db: DbShape): void {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    for (const p of db.projects) {
      try {
        ensureRepo(db, p.id);
      } catch {
        /* 单项目失败不影响其他 */
      }
    }
  }, 300);
}

/** REPO-06 打开仓库 */
export function repoOpen(db: DbShape, projectId: string): boolean {
  try {
    const dir = ensureRepo(db, projectId);
    if (!dir) return false;
    void shell.openPath(dir);
    return true;
  } catch {
    return false;
  }
}

/** 打开项目工作空间目录（00_work_space/，项目仓库根下的自由工作区） */
export function workspaceOpen(db: DbShape, projectId: string): boolean {
  try {
    const dir = ensureRepo(db, projectId);
    if (!dir) return false;
    const wsDir = path.join(dir, '00_work_space');
    fs.mkdirSync(wsDir, { recursive: true });
    void shell.openPath(wsDir);
    return true;
  } catch {
    return false;
  }
}

/** 获取项目工作空间目录绝对路径（不存在则创建） */
function workSpaceDir(db: DbShape, projectId: string): string | null {
  const base = ensureRepo(db, projectId);
  if (!base) return null;
  const wsDir = path.join(base, '00_work_space');
  fs.mkdirSync(wsDir, { recursive: true });
  return wsDir;
}

/** REPO-09 任务对应的仓库绝对目录（确保存在；返回 null 表示任务不存在/工作区未就绪） */
export function taskAbsDir(db: DbShape, taskId: string): string | null {
  const t = db.tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const base = ensureRepo(db, t.projectId);
  if (!base) return null;
  const phases = db.phases.filter((ph) => ph.projectId === t.projectId);
  const rel = computeTaskDirs(db.tasks.filter((x) => x.projectId === t.projectId), phases).get(t.id);
  if (!rel) return null;
  const abs = path.join(base, ...rel.split('/'));
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/** REPO-09 阶段对应的仓库绝对目录 */
export function phaseAbsDir(db: DbShape, phaseId: string): string | null {
  const ph = db.phases.find((x) => x.id === phaseId);
  if (!ph) return null;
  const base = ensureRepo(db, ph.projectId);
  if (!base) return null;
  // 查找阶段序号
  const phases = db.phases.filter((p) => p.projectId === ph.projectId).sort((a, b) => a.order - b.order);
  const idx = phases.findIndex((p) => p.id === ph.id);
  const num = String(idx + 1).padStart(2, '0');
  const abs = path.join(base, `${num}_${sanitizeFolderName(ph.name)}`);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * 删除任务后，重编号受影响阶段内的剩余任务文件夹。
 * 必须在 removeRows 之前调用（此时 DB 中仍包含被删任务）。
 * 被删任务的文件夹由调用方（store handler）负责删除。
 * @param deletedTaskIds 本次删除的任务 ID 集合
 */
export function renumberTaskFolders(
  db: DbShape,
  projectId: string,
  deletedTaskIds: string[]
): void {
  const base = ensureRepo(db, projectId);
  if (!base) return;

  const deletedSet = new Set(deletedTaskIds);
  const allTasks = db.tasks.filter((t) => t.projectId === projectId);
  const phases = db.phases.filter((p) => p.projectId === projectId).sort((a, b) => a.order - b.order);

  for (const ph of phases) {
    const phaseTasks = allTasks.filter((t) => t.phaseId === ph.id).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    if (phaseTasks.length === 0) continue;

    const phaseIdx = phases.findIndex((p) => p.id === ph.id);
    const phaseDirName = numberedPhaseDirName(ph, phaseIdx);
    const phaseDir = path.join(base, phaseDirName);
    if (!fs.existsSync(phaseDir)) continue;

    // 剩余任务（排除被删的）
    const remainingTasks = phaseTasks.filter((t) => !deletedSet.has(t.id));

    // 收集需要重命名的旧/新路径对
    const renames: [string, string][] = [];

    for (let newIdx = 0; newIdx < remainingTasks.length; newIdx++) {
      const t = remainingTasks[newIdx];
      const tf = sanitizeFolderName(t.title) || '任务';
      const oldIdx = phaseTasks.findIndex((x) => x.id === t.id);
      const oldDirName = `${String(oldIdx + 1).padStart(2, '0')}_${tf}`;
      const newDirName = `${String(newIdx + 1).padStart(2, '0')}_${tf}`;
      const oldDir = path.join(phaseDir, oldDirName);
      const newDir = path.join(phaseDir, newDirName);
      if (oldDirName !== newDirName && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        renames.push([oldDir, newDir]);
      }
    }

    // 按旧编号升序执行重命名，避免冲突（如 03→02 须在 02→01 之后）
    for (const [oldDir, newDir] of renames) {
      try { fs.renameSync(oldDir, newDir); } catch { /* skip */ }
    }
  }
}

/**
 * 删除阶段后，重编号剩余阶段文件夹。
 * 必须在 removeRows 之前调用（此时 DB 中仍包含被删阶段）。
 * 被删阶段的文件夹由调用方（store handler）负责删除。
 * @param deletedPhaseIds 本次删除的阶段 ID 集合
 */
export function renumberPhaseFolders(
  db: DbShape,
  projectId: string,
  deletedPhaseIds: string[]
): void {
  const base = ensureRepo(db, projectId);
  if (!base) return;

  const deletedSet = new Set(deletedPhaseIds);

  // 全量排序（含即将删除的阶段）
  const allPhases = db.phases
    .filter((p) => p.projectId === projectId)
    .sort((a, b) => a.order - b.order);
  // 剩余阶段
  const remainingPhases = allPhases.filter((p) => !deletedSet.has(p.id));

  // 收集需要重命名的旧/新路径对
  const renames: [string, string][] = [];

  for (let newIdx = 0; newIdx < remainingPhases.length; newIdx++) {
    const ph = remainingPhases[newIdx];
    const oldIdx = allPhases.findIndex((p) => p.id === ph.id);
    const oldDirName = numberedPhaseDirName(ph, oldIdx);
    const newDirName = numberedPhaseDirName(ph, newIdx);
    const oldDir = path.join(base, oldDirName);
    const newDir = path.join(base, newDirName);
    if (oldDirName !== newDirName && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      renames.push([oldDir, newDir]);
    }
  }

  // 按旧编号升序执行重命名，避免冲突（如 03→02 须在 02→01 之后）
  for (const [oldDir, newDir] of renames) {
    try { fs.renameSync(oldDir, newDir); } catch { /* skip */ }
  }
}

/** 重名冲突时追加日期序号：name.ext → name_20260823_1.ext */
function uniqueTarget(dir: string, file: string): string {
  let target = path.join(dir, file);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 1; i < 999; i++) {
    target = path.join(dir, `${stem}_${dateStr}_${i}${ext}`);
    if (!fs.existsSync(target)) return target;
  }
  return path.join(dir, `${stem}_${Date.now()}${ext}`);
}

/** REPO-08 提交文件：多选 → 复制到任务文件夹（可按交付物名称建子目录）→ 登记交付物 */
export async function submitTaskFiles(
  win: BrowserWindow | null,
  db: DbShape,
  taskId: string,
  deliverableName?: string
): Promise<{ copied: number; dir: string; names: string[] } | null> {
  const t = db.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error('任务不存在');
  const defaultPath = workSpaceDir(db, t.projectId) || undefined;
  const titleSuffix = deliverableName ? `「${deliverableName}」` : '';
  const res = await dialog.showOpenDialog(win!, {
    title: `提交文件到任务「${t.title}」${titleSuffix}的仓库文件夹`,
    defaultPath,
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const taskDir = taskAbsDir(db, taskId);
  if (!taskDir) throw new Error('工作目录未设置或仓库不可用');
  // 如果指定了交付物名称，检查该名称已有多少提交记录
  const existingSubmitted = deliverableName
    ? t.deliverables.filter((d) => d.name === deliverableName && d.time)
    : [];
  const needSubfolder = deliverableName && (existingSubmitted.length + res.filePaths.length > 1);
  const targetDir = needSubfolder
    ? path.join(taskDir, sanitizeFolderName(deliverableName))
    : taskDir;
  fs.mkdirSync(targetDir, { recursive: true });
  // 如果需要子目录且第1个文件还在任务根目录，先移过去
  if (needSubfolder && existingSubmitted.length > 0) {
    for (const d of existingSubmitted) {
      if (d.note) {
        const oldPath = path.join(taskDir, d.note);
        const newPath = path.join(targetDir, d.note);
        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
          fs.renameSync(oldPath, newPath);
        }
      }
    }
  }
  const names: string[] = [];
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  for (const src of res.filePaths) {
    const target = uniqueTarget(targetDir, path.basename(src));
    fs.copyFileSync(src, target);
    names.push(path.basename(target));
    // 如果指定了交付物名称，登记到该交付物下
    if (deliverableName) {
      const existing = t.deliverables.find((d) => d.name === deliverableName && !d.time);
      if (existing) {
        existing.note = path.basename(target);
        existing.time = now;
      } else {
        const d: Deliverable = {
          id: uid('dl'),
          name: deliverableName,
          note: path.basename(target),
          time: now,
          accepted: false
        };
        t.deliverables = [...(t.deliverables || []), d];
      }
    } else {
      // 直接提交到任务文件夹，不归属任何交付物
      const d: Deliverable = {
        id: uid('dl'),
        name: '__unassigned__',
        note: path.basename(target),
        time: now,
        accepted: false
      };
      t.deliverables = [...(t.deliverables || []), d];
    }
  }
  // 自动将任务状态设为"进行中"（如果当前是"待开始"）
  if (t.status === '待开始') {
    t.status = '进行中';
    if (!t.startedAt) t.startedAt = new Date().toISOString().slice(0, 10);
  }
  return { copied: names.length, dir: targetDir, names };
}

/** 打开交付物文件：定位到任务文件夹下对应交付物子目录中的文件 */
export function openDeliverableFile(db: DbShape, taskId: string, deliverableName: string): boolean {
  try {
    const taskDir = taskAbsDir(db, taskId);
    if (!taskDir) return false;
    const dDir = path.join(taskDir, sanitizeFolderName(deliverableName));
    if (fs.existsSync(dDir)) {
      void shell.openPath(dDir);
      return true;
    }
    // 如果子目录不存在，尝试打开任务文件夹
    void shell.openPath(taskDir);
    return true;
  } catch {
    return false;
  }
}

/** 打开指定交付物文件（通过 note 中存储的文件名定位） */
export function openDeliverableSpecificFile(db: DbShape, taskId: string, deliverableName: string, fileName: string): boolean {
  try {
    const taskDir = taskAbsDir(db, taskId);
    if (!taskDir) return false;
    // 尝试在子目录中查找
    const dDir = path.join(taskDir, sanitizeFolderName(deliverableName));
    if (fs.existsSync(dDir)) {
      const filePath = path.join(dDir, fileName);
      if (fs.existsSync(filePath)) {
        void shell.openPath(filePath);
        return true;
      }
      // 子目录中找不到，列出目录内容尝试匹配
      const files = fs.readdirSync(dDir);
      const match = files.find((f) => f.includes(fileName) || fileName.includes(f));
      if (match) {
        void shell.openPath(path.join(dDir, match));
        return true;
      }
    }
    // 尝试在任务根目录查找
    const rootFile = path.join(taskDir, fileName);
    if (fs.existsSync(rootFile)) {
      void shell.openPath(rootFile);
      return true;
    }
    // 都找不到，打开任务文件夹
    void shell.openPath(taskDir);
    return true;
  } catch {
    return false;
  }
}

/** 重命名交付物文件夹：旧名称 → 新名称 */
export function renameDeliverableFolder(db: DbShape, taskId: string, oldName: string, newName: string): boolean {
  try {
    const taskDir = taskAbsDir(db, taskId);
    if (!taskDir) return false;
    const oldDir = path.join(taskDir, sanitizeFolderName(oldName));
    const newDir = path.join(taskDir, sanitizeFolderName(newName));
    if (fs.existsSync(oldDir) && oldDir !== newDir) {
      if (fs.existsSync(newDir)) {
        // 目标已存在，追加日期后缀
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const suffixDir = path.join(taskDir, `${sanitizeFolderName(newName)}_${dateStr}_已存在`);
        fs.renameSync(oldDir, suffixDir);
      } else {
        fs.renameSync(oldDir, newDir);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 删除交付物文件/文件夹：deleteAll=true 重命名整个文件夹，否则重命名单个文件 */
export function deleteDeliverableFiles(db: DbShape, taskId: string, deliverableName: string, deleteAll: boolean, fileName?: string): boolean {
  try {
    const taskDir = taskAbsDir(db, taskId);
    if (!taskDir) return false;
    const dDir = path.join(taskDir, sanitizeFolderName(deliverableName));
    if (!fs.existsSync(dDir)) return true;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (deleteAll) {
      // 重命名整个交付物文件夹
      const renamed = path.join(taskDir, `${sanitizeFolderName(deliverableName)}_已删除_${dateStr}`);
      if (!fs.existsSync(renamed)) {
        fs.renameSync(dDir, renamed);
      } else {
        for (let i = 1; i < 999; i++) {
          const alt = path.join(taskDir, `${sanitizeFolderName(deliverableName)}_已删除_${dateStr}_${i}`);
          if (!fs.existsSync(alt)) { fs.renameSync(dDir, alt); break; }
        }
      }
    } else if (fileName) {
      // 重命名单个指定文件
      const oldPath = path.join(dDir, fileName);
      if (fs.existsSync(oldPath) && fs.statSync(oldPath).isFile()) {
        const ext = path.extname(fileName);
        const stem = path.basename(fileName, ext);
        const renamed = path.join(dDir, `${stem}_已删除_${dateStr}${ext}`);
        if (!fs.existsSync(renamed)) fs.renameSync(oldPath, renamed);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** REPO-04 导出项目：另存对话框 → .json 配置文件 或 .zip 压缩包（含项目数据） */
export async function repoExport(
  win: BrowserWindow | null,
  db: DbShape,
  projectId: string,
  exportWithZip: boolean = false
): Promise<string | null> {
  const archive = buildArchive(db, projectId);
  if (!archive) throw new Error('项目不存在');
  
  if (exportWithZip) {
    // 导出为 .zip 压缩包（含项目配置 + 仓库数据）
    const res = await dialog.showSaveDialog(win!, {
      title: '导出项目（含数据）',
      defaultPath: `${archive.project.name}-项目数据.zip`,
      filters: [{ name: 'PMS 项目压缩包', extensions: ['zip'] }]
    });
    if (res.canceled || !res.filePath) return null;
    
    // 确保仓库存在
    let repoDir: string | null = null;
    try {
      repoDir = ensureRepo(db, projectId);
    } catch {
      /* 仓库创建失败不阻塞导出 */
    }
    
    // 动态导入 archiver（ESM 模块 v8 使用 ZipArchive 类）
    const { ZipArchive } = await eval('import("archiver")') as any;
    
    return new Promise<string | null>((resolve, reject) => {
      const output = fs.createWriteStream(res.filePath);
      const zip = new ZipArchive({ zlib: { level: 9 } });
      let done = false;
      
      const finish = () => {
        if (!done) {
          done = true;
          output.end(() => resolve(res.filePath));
        }
      };
      
      const onError = (err: Error) => {
        if (!done) {
          done = true;
          try { output.destroy(); } catch {}
          reject(err);
        }
      };
      
      output.on('error', onError);
      zip.on('error', onError);
      zip.on('warning', (warn: any) => {
        if (warn.code === 'ENOENT') return; // 忽略目录不存在警告
        onError(warn);
      });
      
      // 等待输出流关闭（所有数据写入完成）
      output.on('close', finish);
      
      zip.pipe(output);
      
      if (repoDir && fs.existsSync(repoDir)) {
        zip.directory(repoDir, false);
      }
      
      zip.finalize();
    });
  } else {
    // 导出为 .json 配置文件
    const res = await dialog.showSaveDialog(win!, {
      title: '导出项目配置',
      defaultPath: `${archive.project.name}-配置.json`,
      filters: [{ name: 'PMS 项目配置', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return null;
    
    fs.writeFileSync(res.filePath, JSON.stringify(archive, null, 2), 'utf-8');
    try {
      ensureRepo(db, projectId);
    } catch {
      /* 导出为主，仓库刷新失败可忽略 */
    }
    return res.filePath;
  }
}

/** 验证项目归档结构是否有效 */
function validateArchiveStructure(archive: any): { valid: boolean; error?: string } {
  if (!archive || typeof archive !== 'object') {
    return { valid: false, error: '文件内容不是有效的 JSON 对象' };
  }
  
  if (archive.format !== 'pms-project-archive') {
    return { valid: false, error: '非项目配置文件，导入失败！' };
  }
  
  if (!archive.project || typeof archive.project !== 'object') {
    return { valid: false, error: '缺少 project 字段' };
  }
  
  const project = archive.project;
  if (!project.id || !project.name || !project.startDate || !project.endDate) {
    return { valid: false, error: 'project 字段缺少必要属性（id/name/startDate/endDate）' };
  }
  
  if (archive.phases && !Array.isArray(archive.phases)) {
    return { valid: false, error: 'phases 字段不是数组' };
  }
  
  if (archive.tasks && !Array.isArray(archive.tasks)) {
    return { valid: false, error: 'tasks 字段不是数组' };
  }
  
  if (archive.requirements && !Array.isArray(archive.requirements)) {
    return { valid: false, error: 'requirements 字段不是数组' };
  }
  
  if (archive.bugs && !Array.isArray(archive.bugs)) {
    return { valid: false, error: 'bugs 字段不是数组' };
  }
  
  return { valid: true };
}

/** REPO-05 导入项目：打开对话框 → 校验 → 重建项目与子数据 + 仓库 */
export async function repoImport(win: BrowserWindow | null, db: DbShape): Promise<Project> {
  const res = await dialog.showOpenDialog(win!, {
    title: '导入项目',
    filters: [
      { name: 'PMS 项目文件', extensions: ['json'] },
      { name: 'JSON 配置文件', extensions: ['json'] }
    ],
    properties: ['openFile']
  });
  
  if (res.canceled || !res.filePaths.length) throw new Error('__CANCELED__');
  
  const filePath = res.filePaths[0];
  
  // 处理 JSON 文件
  let archive: ProjectArchive;
  try {
    archive = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProjectArchive;
  } catch {
    throw new Error('文件读取或解析失败，请确认是有效的 JSON 文件');
  }
  
  const validation = validateArchiveStructure(archive);
  if (!validation.valid) {
    throw new Error(validation.error || '非项目配置文件，导入失败！');
  }
  
  const project = importArchive(db, archive);
  try {
    ensureRepo(db, project.id);
  } catch {
    /* 数据已导入，仓库失败不阻塞 */
  }
  return project;
}

/** 导入项目配置文件（JSON） */
export async function repoImportFromJson(win: BrowserWindow | null, db: DbShape): Promise<Project> {
  const res = await dialog.showOpenDialog(win!, {
    title: '导入项目配置文件',
    filters: [
      { name: 'PMS 项目配置', extensions: ['json'] }
    ],
    properties: ['openFile']
  });
  
  if (res.canceled || !res.filePaths.length) throw new Error('__CANCELED__');
  
  const filePath = res.filePaths[0];
  
  let archive: ProjectArchive;
  try {
    archive = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProjectArchive;
  } catch {
    throw new Error('文件读取或解析失败，请确认是有效的 JSON 文件');
  }
  
  const validation = validateArchiveStructure(archive);
  if (!validation.valid) {
    throw new Error(validation.error || '非项目配置文件，导入失败！');
  }
  
  const project = importArchive(db, archive);
  try {
    ensureRepo(db, project.id);
  } catch {
    /* 数据已导入，仓库失败不阻塞 */
  }
  return project;
}

/** 导入项目数据（ZIP） */
export async function repoImportFromZip(win: BrowserWindow | null, db: DbShape): Promise<Project> {
  const res = await dialog.showOpenDialog(win!, {
    title: '导入项目数据',
    filters: [
      { name: 'PMS 项目数据', extensions: ['zip'] }
    ],
    properties: ['openFile']
  });
  
  if (res.canceled || !res.filePaths.length) throw new Error('__CANCELED__');
  
  const zipPath = res.filePaths[0];
  
  // 创建临时目录用于解压
  const tmpDir = path.join(require('os').tmpdir(), `pms-import-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  
  try {
    // 解压ZIP文件到临时目录
    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tmpDir }))
      .promise();
    
    // 读取project.json
    const pjPath = path.join(tmpDir, 'project.json');
    if (!fs.existsSync(pjPath)) {
      throw new Error('ZIP文件中缺少project.json文件');
    }
    
    const archive: ProjectArchive = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
    
    // 验证结构
    const validation = validateArchiveStructure(archive);
    if (!validation.valid) {
      throw new Error(validation.error || '非项目配置文件，导入失败！');
    }
    
    // 导入项目
    const project = importArchive(db, archive);
    
    // 复制仓库文件到项目目录
    const repoDir = ensureRepo(db, project.id);
    if (repoDir) {
      // 复制解压的文件到项目仓库目录（跳过project.json）
      copyDirSync(tmpDir, repoDir, ['project.json']);
    }
    
    return project;
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 清理失败不阻塞导入
    }
  }
}

/** 递归复制目录，可跳过指定文件 */
function copyDirSync(src: string, dest: string, skipFiles: string[] = []): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath, skipFiles);
    } else {
      if (!skipFiles.includes(entry.name)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

/** PMS_SMOKE 自检：模板建项目 → 建仓库（阶段/任务层级）→ 回读 project.json → 恢复去重 → 提交目录定位 */
export function repoSelfTest(): string {
  const db = createEmptyDb();
  const tpl = db.templates[0] || BUILTIN_TEMPLATES[0];
  const prj = buildProjectFromTemplate(db, tpl, {
    templateId: tpl.id,
    name: 'SMOKEREPO__自检项目',
    owner: 'smoke',
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    members: []
  });
  const dir = ensureRepo(db, prj.id);
  if (!dir) throw new Error('ensureRepo 返回空');
  const back = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8')) as ProjectArchive;
  const top = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const firstPhase = top[0];
  const sub = firstPhase ? fs.readdirSync(path.join(dir, firstPhase)) : [];
  const restoredOnce = restoreArchive(db, back);
  const restoredAgain = restoreArchive(db, back);
  const taskDir = taskAbsDir(db, db.tasks[0].id);
  const taskDirOk = taskDir ? taskDir.startsWith(dir) : false;
  fs.rmSync(dir, { recursive: true, force: true });
  return `top=[${top.join('|')}] ${firstPhase || ''}/sub=[${sub.join('|')}] restore=${restoredOnce}/${restoredAgain} taskDir=${taskDirOk}`;
}

/** 将项目文件夹移动到 trash 目录（重命名加 _已删除_日期） */
export function moveToTrash(workDir: string, projectDirName: string): boolean {
  try {
    const src = path.join(workDir, 'repos', projectDirName);
    if (!fs.existsSync(src)) return false;
    const trashDir = path.join(workDir, 'trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let dest = path.join(trashDir, `${projectDirName}_已删除_${dateStr}`);
    if (fs.existsSync(dest)) {
      for (let i = 1; i < 999; i++) {
        dest = path.join(trashDir, `${projectDirName}_已删除_${dateStr}_${i}`);
        if (!fs.existsSync(dest)) break;
      }
    }
    try {
      fs.renameSync(src, dest);
    } catch {
      // rename 跨分区失败时，复制后删除源
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    }
    // 双重保险：确保源目录已删除
    if (fs.existsSync(src)) {
      fs.rmSync(src, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

/** 清理超过保留天数的 trash 内容 */
export function cleanupTrash(workDir: string, retentionDays: number): number {
  const trashDir = path.join(workDir, 'trash');
  if (!fs.existsSync(trashDir) || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    const entries = fs.readdirSync(trashDir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(trashDir, e.name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed++;
      }
    }
  } catch { /* ignore */ }
  return removed;
}
