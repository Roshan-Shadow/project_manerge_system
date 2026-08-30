# Project Management System (PMS)

轻量级桌面项目管理系统（Electron + Vanilla TypeScript），采用 in-memory 数据模型 + 文件系统持久化，无后端数据库。

## Language

**Template（模板）**：
预定义的项目结构蓝图，包含阶段（Phase）与任务（Task）的层级关系，用于快速创建新项目。分为系统内置模板（`builtin: true`）和用户自定义模板（`builtin: false`）。
_Avoid_: 模版

**Template Center（模板中心）**：
应用的第八个 Tab 页，提供模板的浏览、创建、编辑、复制、删除和使用功能。自定义模板以 JSON 文件形式持久化于 `<workDir>/template/` 目录。

**Plan（计划）**：
应用的第五个 Tab 页，展示当前项目的阶段分组与任务表格，支持阶段和任务的 CRUD、状态流转、交付物管理。

**Phase（阶段）**：
项目的一级时间分段，如"需求评审"、"开发"、"测试"。每个阶段下可包含多个任务。阶段在仓库中对应一个带序号的文件夹（如 `01_需求评审/`）。

**Task（任务）**：
项目的最小工作单元，归属于某个阶段（或未分组）。包含标题、负责人、起止日期、工时、优先级、状态、进度、交付物等字段。任务在仓库中对应一个子文件夹。

**Deliverable（交付物）**：
任务的产出物记录，嵌套在 Task 内部（`task.deliverables: Deliverable[]`）。每个交付物有名称、备注、提交时间、验收状态。提交时文件被复制到任务仓库文件夹。
_Avoid_: 交付件

**Repo（仓库）**：
文件系统中的项目工作目录，包含阶段/任务层级的文件夹结构和 `project.json` 快照。多仓库通过 `repos-list.json` 管理。

**Built-in Template（系统模板）**：
随应用预置的 4 个模板（软件研发迭代、产品发布、日常运营项目、论文撰写），仅在本次会话内可编辑，重启后恢复原状。不可重命名/删除。

**Custom Template（自定义模板）**：
用户创建或从项目另存为的模板，以 JSON 文件持久化于 `<workDir>/template/<name>.json`。支持重命名、删除、编辑结构。模板对象携带 `fileName` 字段记录磁盘上的原始文件名，解决名称冲突时的文件定位问题。

**Bulk Import（整体导入）**：
计划模块的新功能，允许用户通过JSON文件或文本编辑器批量导入项目计划。支持阶段和任务的批量创建，自动设置默认工期。导入前会验证JSON结构是否符合规范。

**Import Schema（导入范式）**：
整体导入功能使用的JSON数据结构规范，包含 `phases` 数组，每个阶段有 `name`、`tip`（可选）、`tasks` 数组和 `taskDeliverables`（可选）字段。
