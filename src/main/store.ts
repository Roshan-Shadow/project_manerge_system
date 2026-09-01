import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '../shared/channels.js';
import {
  DbShape,
  createEmptyDb,
  listRows,
  createRow,
  updateRow,
  removeRows,
  buildProjectFromTemplate,
  snapshotProjectAsTemplate,
  repoDirName
} from '../shared/storeOps.js';
import { AppSettings, CreateProjectInput, EntityName, SaveAsTemplateInput } from '../shared/types.js';
import {
  phaseAbsDir,
  repoExport,
  repoImport,
  repoImportFromJson,
  repoImportFromZip,
  repoOpen,
  renumberPhaseFolders,
  renumberTaskFolders,
  scheduleRepoSync,
  submitTaskFiles,
  taskAbsDir,
  workspaceOpen,
  openDeliverableFile,
  openDeliverableSpecificFile,
  renameDeliverableFolder,
  deleteDeliverableFiles,
  moveToTrash,
  cleanupTrash
} from './repo.js';
import { ensureWorkspace, getSettings, getWorkspaceBoot, initWorkspace, saveSettings, setWorkDir, readRepoList, addRepo, addRepoAtPath, applyFreshSettings, switchRepo, removeRepo, getRepoDefaults, saveRepoDefaults } from './settings.js';

const db: DbShape = createEmptyDb();
let getWin: () => BrowserWindow | null = () => null;

export function registerIpcHandlers(winGetter: () => BrowserWindow | null): void {
  getWin = winGetter;
  initWorkspace(db); // SET-05 启动即应用工作目录 setting.json 并按 ID 去重恢复项目
  ipcMain.handle(IPC.LIST, (_e, entity: EntityName) => listRows(db, entity));
  ipcMain.handle(IPC.CREATE, (_e, entity: EntityName, data: Record<string, unknown>) => {
    const row = createRow(db, entity, data);
    scheduleRepoSync(db);
    return row;
  });
  ipcMain.handle(
    IPC.UPDATE,
    (_e, entity: EntityName, id: string, patch: Record<string, unknown>) => {
      const row = updateRow(db, entity, id, patch);
      scheduleRepoSync(db);
      return row;
    }
  );
  ipcMain.handle(IPC.REMOVE, (_e, entity: EntityName, ids: string[]) => {
    // 项目删除时先移到 trash
    if (entity === 'project') {
      const s = getSettings();
      for (const id of ids) {
        const prj = db.projects.find((p) => p.id === id);
        if (prj) {
          const dirName = repoDirName(prj, s.repoNaming);
          if (dirName) moveToTrash(s.workDir, dirName);
        }
      }
      cleanupTrash(s.workDir, s.trashRetentionDays);
    }
    // 阶段删除：先显式删除子任务（确保 renumberTaskFolders 处理剩余任务重编号），再重编号阶段文件夹，最后删阶段文件夹
    if (entity === 'phase') {
      const affectedProjectIds = new Set<string>();
      for (const id of ids) {
        const ph = db.phases.find((p) => p.id === id);
        if (ph) affectedProjectIds.add(ph.projectId);
      }
      // 1. 显式删除子任务（确保 renumberTaskFolders 处理剩余任务重编号）
      const childTaskIds = db.tasks
        .filter((t) => ids.includes(t.phaseId))
        .map((t) => t.id);
      if (childTaskIds.length) {
        for (const pid of affectedProjectIds) {
          renumberTaskFolders(db, pid, childTaskIds);
        }
        for (const tid of childTaskIds) {
          const dir = taskAbsDir(db, tid);
          if (dir && fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
        removeRows(db, 'task', childTaskIds);
      }
      // 2. 预计算被删阶段文件夹路径（此时 ensureRepo 不会产生副作用，旧文件夹都还在）
      const phaseDirsToDelete: string[] = [];
      for (const id of ids) {
        const dir = phaseAbsDir(db, id);
        if (dir) phaseDirsToDelete.push(dir);
      }
      // 3. 重编号剩余阶段文件夹
      for (const pid of affectedProjectIds) {
        renumberPhaseFolders(db, pid, ids);
      }
      // 4. 用预计算路径删除被删阶段文件夹（避免 phaseAbsDir 内部 ensureRepo 重建旧文件夹）
      for (const dir of phaseDirsToDelete) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      // 5. 从 DB 删除阶段，并重编号剩余阶段的 order（确保 ensureRepo 生成正确文件夹名）
      removeRows(db, 'phase', ids);
      for (const pid of affectedProjectIds) {
        const remaining = db.phases
          .filter((p) => p.projectId === pid)
          .sort((a, b) => a.order - b.order);
        remaining.forEach((p, i) => { p.order = i + 1; });
      }
    }
    // 任务删除：先重编号剩余任务文件夹，再删被删任务文件夹
    if (entity === 'task') {
      const affectedPhaseIds = new Set<string>();
      for (const id of ids) {
        const t = db.tasks.find((x) => x.id === id);
        if (t && t.phaseId) affectedPhaseIds.add(t.phaseId);
      }
      const affectedProjectIds = new Set<string>();
      for (const id of ids) {
        const t = db.tasks.find((x) => x.id === id);
        if (t) affectedProjectIds.add(t.projectId);
      }
      // 预计算被删任务文件夹路径（此时 ensureRepo 不会产生副作用，旧文件夹都还在）
      const taskDirsToDelete: string[] = [];
      for (const id of ids) {
        const dir = taskAbsDir(db, id);
        if (dir) taskDirsToDelete.push(dir);
      }
      // 在 removeRows 之前重编号（DB 仍含被删任务，可计算旧序号）
      for (const pid of affectedProjectIds) {
        renumberTaskFolders(db, pid, ids);
      }
      // 用预计算路径删除被删任务文件夹（避免 taskAbsDir 内部 ensureRepo 重建旧文件夹）
      for (const dir of taskDirsToDelete) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    if (entity !== 'phase') removeRows(db, entity, ids);
    scheduleRepoSync(db);
    return true;
  });
  ipcMain.handle(IPC.CREATE_PROJECT, (_e, input: CreateProjectInput) => {
    const tpl = input.templateId ? db.templates.find((t) => t.id === input.templateId) || null : null;
    const prj = buildProjectFromTemplate(db, tpl, input);
    scheduleRepoSync(db);
    return prj;
  });
  ipcMain.handle(IPC.SAVE_AS_TEMPLATE, (_e, input: SaveAsTemplateInput) =>
    snapshotProjectAsTemplate(db, input.projectId, input.name, input.category)
  );
  ipcMain.handle(IPC.REPO_OPEN, (_e, projectId: string) => repoOpen(db, projectId));
  ipcMain.handle(IPC.EXPORT_PROJECT, (_e, projectId: string, exportWithZip: boolean) => repoExport(getWin(), db, projectId, exportWithZip));
  ipcMain.handle(IPC.IMPORT_PROJECT, () => repoImport(getWin(), db));
  ipcMain.handle(IPC.IMPORT_FROM_JSON, () => repoImportFromJson(getWin(), db));
  ipcMain.handle(IPC.IMPORT_FROM_ZIP, () => repoImportFromZip(getWin(), db));
  // SET-01~03 设置：读取 / 保存（建工作目录 + 同步仓库命名）/ 选择目录
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    const s = getSettings();
    ensureWorkspace(s);
    return s;
  });
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => {
    const s = saveSettings(patch);
    scheduleRepoSync(db); // 既有仓库按新根目录/命名方式同步
    return s;
  });
  ipcMain.handle(IPC.SETTINGS_PICK_DIR, async () => {
    const res = await dialog.showOpenDialog(getWin()!, {
      title: '选择工作目录（存放缓存 / 临时文件 / 插件 / 项目仓库 repos）',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });
  // SET-04/05 工作区：状态查询（未就绪→首启向导）与设置目录（应用 setting.json + 按 ID 去重恢复项目）
  ipcMain.handle(IPC.WORKSPACE_STATUS, () => {
    const boot = getWorkspaceBoot();
    return { ready: boot.ready, workDir: boot.workDir, repoNaming: getSettings().repoNaming, repos: boot.repos };
  });
  ipcMain.handle(IPC.WORKSPACE_SET_DIR, (_e, dir: string) => {
    if (typeof dir !== 'string' || !dir.trim() || !fs.existsSync(dir.trim())) {
      throw new Error('目录不存在');
    }
    const r = setWorkDir(db, dir.trim());
    scheduleRepoSync(db); // 恢复的项目立即生成/对齐仓库
    return r;
  });
  // REPO-08 任务文件提交（多选复制到任务文件夹并登记交付物）
  ipcMain.handle(IPC.TASK_SUBMIT_FILES, (_e, taskId: string, deliverableName?: string) =>
    submitTaskFiles(getWin(), db, taskId, deliverableName)
  );
  // REPO-09 打开任务/阶段对应文件夹
  ipcMain.handle(IPC.OPEN_FOLDER, (_e, kind: 'task' | 'phase', id: string) => {
    try {
      const dir = kind === 'task' ? taskAbsDir(db, id) : phaseAbsDir(db, id);
      if (!dir) return false;
      void shell.openPath(dir);
      return true;
    } catch {
      return false;
    }
  });
  // 打开项目工作空间目录
  ipcMain.handle(IPC.OPEN_WORKSPACE, (_e, projectId: string) => workspaceOpen(db, projectId));
  // 打开交付物文件
  ipcMain.handle(IPC.OPEN_DELIVERABLE, (_e, taskId: string, deliverableName: string) =>
    openDeliverableFile(db, taskId, deliverableName)
  );
  // 重命名交付物文件夹
  ipcMain.handle(IPC.RENAME_DELIVERABLE, (_e, taskId: string, oldName: string, newName: string) =>
    renameDeliverableFolder(db, taskId, oldName, newName)
  );
  // 删除交付物文件/文件夹
  ipcMain.handle(IPC.DELETE_DELIVERABLE_FILES, (_e, taskId: string, deliverableName: string, deleteAll: boolean, fileName?: string) =>
    deleteDeliverableFiles(db, taskId, deliverableName, deleteAll, fileName)
  );
  // 打开指定交付物文件
  ipcMain.handle(IPC.OPEN_DELIVERABLE_FILE, (_e, taskId: string, deliverableName: string, fileName: string) =>
    openDeliverableSpecificFile(db, taskId, deliverableName, fileName)
  );
  // 系统仓库管理
  ipcMain.handle(IPC.REPO_LIST, () => readRepoList().repos);
  ipcMain.handle(IPC.REPO_CREATE, async (_e, name: string) => {
    const res = await dialog.showOpenDialog(getWin()!, {
      title: '选择系统仓库目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    const repo = addRepoAtPath(db, name, dir);
    scheduleRepoSync(db);
    return repo;
  });
  ipcMain.handle(IPC.REPO_ADD, (_e, name: string, dirPath: string) => {
    const repo = addRepoAtPath(db, name, dirPath);
    scheduleRepoSync(db);
    return repo;
  });
  ipcMain.handle(IPC.REPO_SWITCH, (_e, repoId: string) => {
    const repo = switchRepo(repoId);
    if (!repo) throw new Error('仓库不存在');
    applyFreshSettings(db, repo.path);
    scheduleRepoSync(db);
    return repo;
  });
  ipcMain.handle(IPC.REPO_DELETE, (_e, repoId: string) => removeRepo(repoId));
  ipcMain.handle(IPC.REPO_DEFAULTS_GET, () => getRepoDefaults());
  ipcMain.handle(IPC.REPO_DEFAULTS_SET, (_e, patch) => saveRepoDefaults(patch));
  // 模板文件持久化到 template/ 目录（以模板名称为文件名）
  ipcMain.handle(IPC.TEMPLATE_SAVE_FILE, (_e, _id: string, data: Record<string, unknown>) => {
    const s = getSettings();
    if (!s.workDir) return false;
    const tplDir = path.join(s.workDir, 'template');
    fs.mkdirSync(tplDir, { recursive: true });
    const name = String(data.fileName || data.name || '未命名模板').replace(/[\\/:*?"<>|]/g, '_');
    fs.writeFileSync(path.join(tplDir, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
    return true;
  });
  ipcMain.handle(IPC.TEMPLATE_DELETE_FILE, (_e, _id: string, name?: string) => {
    const s = getSettings();
    if (!s.workDir) return false;
    if (!name) return false;
    const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_');
    const f = path.join(s.workDir, 'template', `${safeName}.json`);
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      return true;
    }
    return false;
  });
  ipcMain.handle(IPC.TEMPLATE_OPEN_FOLDER, () => {
    const s = getSettings();
    if (!s.workDir) return false;
    const tplDir = path.join(s.workDir, 'template');
    fs.mkdirSync(tplDir, { recursive: true });
    void shell.openPath(tplDir);
    return true;
  });
}
