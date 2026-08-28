import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/channels.js';
import {
  AppSettings,
  CreateProjectInput,
  EntityName,
  ID,
  PmsApi,
  RepoInfo,
  SaveAsTemplateInput
} from '../shared/types.js';

const api: PmsApi = {
  list: (entity: EntityName) => ipcRenderer.invoke(IPC.LIST, entity),
  create: (entity: EntityName, data: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.CREATE, entity, data),
  update: (entity: EntityName, id: ID, patch: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.UPDATE, entity, id, patch),
  remove: (entity: EntityName, ids: ID[]) => ipcRenderer.invoke(IPC.REMOVE, entity, ids),
  createProjectFromTemplate: (input: CreateProjectInput) =>
    ipcRenderer.invoke(IPC.CREATE_PROJECT, input),
  saveProjectAsTemplate: (input: SaveAsTemplateInput) =>
    ipcRenderer.invoke(IPC.SAVE_AS_TEMPLATE, input),
  openRepo: (projectId: ID) => ipcRenderer.invoke(IPC.REPO_OPEN, projectId),
  exportProject: (projectId: ID) => ipcRenderer.invoke(IPC.EXPORT_PROJECT, projectId),
  importProject: () => ipcRenderer.invoke(IPC.IMPORT_PROJECT),
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  pickWorkDir: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_DIR),
  workspaceStatus: () => ipcRenderer.invoke(IPC.WORKSPACE_STATUS),
  setWorkDir: (p: string) => ipcRenderer.invoke(IPC.WORKSPACE_SET_DIR, p),
  submitTaskFiles: (taskId: ID, deliverableName?: string) => ipcRenderer.invoke(IPC.TASK_SUBMIT_FILES, taskId, deliverableName),
  openFolder: (kind: 'task' | 'phase', id: ID) => ipcRenderer.invoke(IPC.OPEN_FOLDER, kind, id),
  openWorkspace: (projectId: ID) => ipcRenderer.invoke(IPC.OPEN_WORKSPACE, projectId),
  openDeliverableFile: (taskId: ID, deliverableName: string) => ipcRenderer.invoke(IPC.OPEN_DELIVERABLE, taskId, deliverableName),
  renameDeliverableFolder: (taskId: ID, oldName: string, newName: string) => ipcRenderer.invoke(IPC.RENAME_DELIVERABLE, taskId, oldName, newName),
  deleteDeliverableFiles: (taskId: ID, deliverableName: string, deleteAll: boolean, fileName?: string) => ipcRenderer.invoke(IPC.DELETE_DELIVERABLE_FILES, taskId, deliverableName, deleteAll, fileName),
  openDeliverableSpecificFile: (taskId: ID, deliverableName: string, fileName: string) => ipcRenderer.invoke(IPC.OPEN_DELIVERABLE_FILE, taskId, deliverableName, fileName),
  listRepos: () => ipcRenderer.invoke(IPC.REPO_LIST),
  createRepo: (name: string) => ipcRenderer.invoke(IPC.REPO_CREATE, name),
  addRepo: (name: string, dirPath: string) => ipcRenderer.invoke(IPC.REPO_ADD, name, dirPath),
  switchRepo: (repoId: string) => ipcRenderer.invoke(IPC.REPO_SWITCH, repoId),
  deleteRepo: (repoId: string) => ipcRenderer.invoke(IPC.REPO_DELETE, repoId),
  getRepoDefaults: () => ipcRenderer.invoke(IPC.REPO_DEFAULTS_GET),
  saveRepoDefaults: (patch) => ipcRenderer.invoke(IPC.REPO_DEFAULTS_SET, patch),
  saveTemplateFile: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke(IPC.TEMPLATE_SAVE_FILE, id, data),
  deleteTemplateFile: (id: string, name?: string) => ipcRenderer.invoke(IPC.TEMPLATE_DELETE_FILE, id, name)
};

contextBridge.exposeInMainWorld('pmsApi', api);
