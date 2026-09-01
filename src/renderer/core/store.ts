import {
  AppSettings,
  CreateProjectInput,
  EntityName,
  ID,
  PmsApi,
  Project,
  PmsTemplate,
  RepoInfo,
  SaveAsTemplateInput,
  WorkspaceSetResult,
  WorkspaceStatus
} from '../../shared/types.js';
import {
  DbShape,
  createEmptyDb,
  listRows,
  createRow,
  updateRow,
  removeRows,
  buildProjectFromTemplate,
  snapshotProjectAsTemplate
} from '../../shared/storeOps.js';

/** 浏览器预览回退：与主进程同一套 storeOps 纯函数驱动的页内内存仓库 */
class LocalStore implements PmsApi {
  private db: DbShape = createEmptyDb();

  async list(entity: EntityName): Promise<unknown[]> {
    return listRows(this.db, entity);
  }
  async create(entity: EntityName, data: Record<string, unknown>): Promise<unknown> {
    return createRow(this.db, entity, data);
  }
  async update(entity: EntityName, id: ID, patch: Record<string, unknown>): Promise<unknown> {
    return updateRow(this.db, entity, id, patch);
  }
  async remove(entity: EntityName, ids: ID[]): Promise<boolean> {
    removeRows(this.db, entity, ids);
    return true;
  }
  async createProjectFromTemplate(input: CreateProjectInput): Promise<Project> {
    const tpl = input.templateId ? this.db.templates.find((t) => t.id === input.templateId) || null : null;
    return buildProjectFromTemplate(this.db, tpl, input);
  }
  async saveProjectAsTemplate(input: SaveAsTemplateInput): Promise<PmsTemplate> {
    const tpl = snapshotProjectAsTemplate(this.db, input.projectId, input.name, input.category);
    if (!tpl) throw new Error('项目不存在');
    return tpl;
  }
  // REPO-07 浏览器预览无文件系统，仓库/导入导出/设置返回空值（UI 层按 isElectron 提示）
  async openRepo(): Promise<boolean> {
    return false;
  }
  async exportProject(): Promise<string | null> {
    return null;
  }
  async importProject(): Promise<Project | null> {
    return null;
  }
  async getSettings(): Promise<AppSettings> {
    return { workDir: '', repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' };
  }
  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return { workDir: '', repoNaming: patch.repoNaming || 'name', trashRetentionDays: patch.trashRetentionDays || 30, heatmapColor: patch.heatmapColor || 'green', heatmapRange: patch.heatmapRange || 365, heatmapStartDate: patch.heatmapStartDate || '' };
  }
  async pickWorkDir(): Promise<string | null> {
    return null;
  }
  async workspaceStatus(): Promise<WorkspaceStatus> {
    return { ready: true, workDir: '', repoNaming: 'name', repos: [] };
  }
  async setWorkDir(): Promise<WorkspaceSetResult> {
    return { settings: { workDir: '', repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' }, restored: 0, adopted: false };
  }
  async submitTaskFiles(): Promise<{ copied: number; dir: string } | null> {
    return null;
  }
  async openFolder(): Promise<boolean> {
    return false;
  }
  async openWorkspace(): Promise<boolean> {
    return false;
  }
  async openDeliverableFile(): Promise<boolean> {
    return false;
  }
  async renameDeliverableFolder(): Promise<boolean> {
    return false;
  }
  async deleteDeliverableFiles(): Promise<boolean> {
    return false;
  }
  async openDeliverableSpecificFile(): Promise<boolean> {
    return false;
  }
  async listRepos(): Promise<RepoInfo[]> {
    return [];
  }
  async createRepo(): Promise<RepoInfo | null> {
    return null;
  }
  async addRepo(): Promise<RepoInfo> {
    return { id: '', name: '', path: '' };
  }
  async switchRepo(): Promise<RepoInfo | null> {
    return null;
  }
  async deleteRepo(): Promise<boolean> {
    return false;
  }
  async getRepoDefaults() {
    return { repoNaming: 'name' as const, trashRetentionDays: 30, heatmapColor: 'green' as const, heatmapRange: 365, heatmapStartDate: '' };
  }
  async saveRepoDefaults(patch: any) {
    return { repoNaming: patch.repoNaming || 'name', trashRetentionDays: patch.trashRetentionDays || 30, heatmapColor: patch.heatmapColor || 'green', heatmapRange: patch.heatmapRange || 365, heatmapStartDate: patch.heatmapStartDate || '' };
  }
  async saveTemplateFile(): Promise<boolean> {
    return false;
  }
  async deleteTemplateFile(_id: string, _name?: string): Promise<boolean> {
    return false;
  }
  async openTemplateFolder(): Promise<boolean> {
    return false;
  }
  async importFromJson(): Promise<Project> {
    throw new Error('浏览器预览不支持导入');
  }
  async importFromZip(): Promise<Project> {
    throw new Error('浏览器预览不支持导入');
  }
}

const bridge = (window as unknown as { pmsApi?: PmsApi }).pmsApi;
export const isElectron = !!bridge;
export const store: PmsApi = bridge ?? new LocalStore();
