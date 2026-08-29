export type ID = string;
export type Priority = 'P0' | 'P1' | 'P2';
export type TaskStatus = '待开始' | '进行中' | '已完成' | '已取消';
export type ProjectStatus = '进行中' | '已完成' | '已暂停';
export type ReqType = '功能' | '优化' | '技术';
export type ReqStatus = '草稿' | '已评审' | '已排期' | '开发中' | '已交付' | '已拒绝';
export type BugSeverity = '致命' | '严重' | '一般' | '轻微';
export type BugStatus = '新建' | '已确认' | '处理中' | '待验证' | '已关闭' | '非缺陷' | '重复' | '延期处理';

export interface Deliverable {
  id: ID;
  name: string;
  note: string;
  time: string;
  accepted: boolean;
}

export interface Project {
  id: ID;
  name: string;
  owner: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  members: string[];
  templateSource: string;
  createdAt: string;
}

export interface Phase {
  id: ID;
  projectId: ID;
  name: string;
  order: number;
}

export interface Task {
  id: ID;
  projectId: ID;
  phaseId: ID | '';
  title: string;
  owner: string;
  startDate: string;
  endDate: string;
  hours: number;
  progress: number;
  status: TaskStatus;
  priority: Priority;
  desc: string;
  deliverables: Deliverable[];
  completedAt: string;
  /** 首次进入「进行中」的日期（PLN-11 用时统计起点，YYYY-MM-DD） */
  startedAt?: string;
}

export interface Requirement {
  id: ID;
  projectId: ID;
  title: string;
  desc: string;
  proposer: string;
  type: ReqType;
  priority: Priority;
  status: ReqStatus;
  createdAt: string;
  taskIds: ID[];
}

export interface Bug {
  id: ID;
  projectId: ID;
  title: string;
  desc: string;
  steps: string;
  severity: BugSeverity;
  priority: Priority;
  status: BugStatus;
  handler: string;
  createdAt: string;
  closedAt: string;
  linkReqId: ID | '';
}

export interface TplDeliverable {
  name: string;
  note?: string;
}

export interface TplPhase {
  name: string;
  tasks: string[];
  taskDeliverables?: Record<number, TplDeliverable[]>;
}

export interface PmsTemplate {
  id: ID;
  name: string;
  category: string;
  builtin: boolean;
  phases: TplPhase[];
  createdAt: string;
}

/** 项目仓库目录命名方式（SET-02） */
export type RepoNaming = 'name_id' | 'name' | 'id_name' | 'date_name';

export const REPO_NAMINGS: { value: RepoNaming; label: string; desc: string }[] = [
  { value: 'name_id', label: '项目名_短ID', desc: '如：官网改版_a1b2c3（默认）' },
  { value: 'name', label: '仅项目名', desc: '如：官网改版（重名冲突自动追加短ID）' },
  { value: 'id_name', label: '短ID_项目名', desc: '如：a1b2c3_官网改版' },
  { value: 'date_name', label: '创建日期_项目名', desc: '如：20260822_官网改版' }
];

/** 应用设置（SET-01~05）：持久化于 <工作目录>/setting.json，随工作目录迁移 */
export interface AppSettings {
  workDir: string;
  repoNaming: RepoNaming;
  trashRetentionDays: number;
  /** 热力图配色方案 */
  heatmapColor: HeatmapColor;
  /** 热力图时间范围（天） */
  heatmapRange: number;
  /** 热力图统计开始日期（YYYY-MM-DD），为空则按 heatmapRange 计算 */
  heatmapStartDate: string;
}

export type HeatmapColor = 'green' | 'blue' | 'purple' | 'orange';

/** 系统仓库信息 */
export interface RepoInfo {
  id: string;
  name: string;
  path: string;
}

/** 系统仓库列表（存储于 userData/repos-list.json） */
export interface RepoListData {
  repos: RepoInfo[];
  activeId: string;
}

/** 工作区状态（首启向导依据） */
export interface WorkspaceStatus {
  ready: boolean;
  workDir: string;
  repoNaming: RepoNaming;
  repos: RepoInfo[];
}

/** 设置工作目录结果（adopted=所选目录本是本系统工作目录） */
export interface WorkspaceSetResult {
  settings: AppSettings;
  restored: number;
  adopted: boolean;
}

export type EntityName = 'project' | 'phase' | 'task' | 'requirement' | 'bug' | 'template';

/** 项目迁移快照（REPO-03/04/05）：仓库 project.json 与导出文件共用此格式 */
export interface ProjectArchive {
  format: 'pms-project-archive';
  version: 1;
  exportedAt: string;
  project: Project;
  phases: Phase[];
  tasks: Task[];
  requirements: Requirement[];
  bugs: Bug[];
  /** 仅仓库内 project.json 携带：目录结构与生成时间 */
  repo?: { dir: string; folders: string[]; generatedAt: string };
}

export interface CreateProjectInput {
  templateId: ID | '';
  name: string;
  owner: string;
  startDate: string;
  endDate: string;
  members: string[];
}

export interface SaveAsTemplateInput {
  projectId: ID;
  name: string;
  category: string;
}

export interface PmsApi {
  list(entity: EntityName): Promise<unknown[]>;
  create(entity: EntityName, data: Record<string, unknown>): Promise<unknown>;
  update(entity: EntityName, id: ID, patch: Record<string, unknown>): Promise<unknown>;
  remove(entity: EntityName, ids: ID[]): Promise<boolean>;
  createProjectFromTemplate(input: CreateProjectInput): Promise<Project>;
  saveProjectAsTemplate(input: SaveAsTemplateInput): Promise<PmsTemplate>;
  /** REPO-06 在资源管理器中打开项目仓库 */
  openRepo(projectId: ID): Promise<boolean>;
  /** REPO-04 导出项目快照，返回文件路径；取消返回 null */
  exportProject(projectId: ID): Promise<string | null>;
  /** REPO-05 从快照文件导入项目；取消返回 null */
  importProject(): Promise<Project | null>;
  /** SET-01 读取设置 */
  getSettings(): Promise<AppSettings>;
  /** SET-01/02 保存设置（写入 <工作目录>/setting.json 并同步仓库命名） */
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** SET-01 选择工作目录（系统目录选择对话框）；取消返回 null */
  pickWorkDir(): Promise<string | null>;
  /** SET-04/05 工作区状态（未就绪时渲染层弹首启向导） */
  workspaceStatus(): Promise<WorkspaceStatus>;
  /** SET-04 设置/切换工作目录：应用 setting.json、创建工作区、按 ID 去重恢复项目 */
  setWorkDir(path: string): Promise<WorkspaceSetResult>;
  /** REPO-08 多选文件提交至任务仓库文件夹，登记交付物；取消返回 null */
  submitTaskFiles(taskId: ID, deliverableName?: string): Promise<{ copied: number; dir: string } | null>;
  /** REPO-09 打开任务/里程碑对应仓库文件夹 */
  openFolder(kind: 'task' | 'phase', id: ID): Promise<boolean>;
  /** 打开项目工作空间目录 */
  openWorkspace(projectId: ID): Promise<boolean>;
  /** 打开交付物文件 */
  openDeliverableFile(taskId: ID, deliverableName: string): Promise<boolean>;
  /** 重命名交付物文件夹 */
  renameDeliverableFolder(taskId: ID, oldName: string, newName: string): Promise<boolean>;
  /** 删除交付物文件/文件夹：deleteAll=true 重命名文件夹，否则重命名单个文件 */
  deleteDeliverableFiles(taskId: ID, deliverableName: string, deleteAll: boolean, fileName?: string): Promise<boolean>;
  /** 打开指定交付物文件 */
  openDeliverableSpecificFile(taskId: ID, deliverableName: string, fileName: string): Promise<boolean>;
  /** 系统仓库列表 */
  listRepos(): Promise<RepoInfo[]>;
  /** 新建系统仓库（弹目录选择对话框，返回新仓库信息；取消返回 null） */
  createRepo(name: string): Promise<RepoInfo | null>;
  /** 在指定路径添加系统仓库（不弹对话框） */
  addRepo(name: string, dirPath: string): Promise<RepoInfo>;
  /** 切换系统仓库 */
  switchRepo(repoId: string): Promise<RepoInfo | null>;
  /** 删除系统仓库（仅从列表移除，不删文件） */
  deleteRepo(repoId: string): Promise<boolean>;
  /** 读取新建仓库默认设置 */
  getRepoDefaults(): Promise<RepoDefaults>;
  /** 保存新建仓库默认设置 */
  saveRepoDefaults(patch: Partial<RepoDefaults>): Promise<RepoDefaults>;
  /** 将模板保存到 template/ 目录的 JSON 文件 */
  saveTemplateFile(id: string, data: Record<string, unknown>): Promise<boolean>;
  /** 从 template/ 目录删除模板文件（按名称） */
  deleteTemplateFile(id: string, name?: string): Promise<boolean>;
}

export type RepoDefaults = Omit<AppSettings, 'workDir'>;
