import { PmsTemplate } from './types.js';

/** TPL-01 系统内置模板（配置项，非列表业务数据；系统模板只读，可复制/使用） */
export const BUILTIN_TEMPLATES: PmsTemplate[] = [
  {
    id: 'tpl_builtin_rd',
    name: '软件研发迭代',
    category: '研发',
    builtin: true,
    createdAt: '',
    phases: [
      { name: '需求评审', tasks: ['需求澄清与评审', '技术方案设计'], tip: '本阶段核心任务是明确项目需求并制定技术方案。通过需求评审会议确保所有利益相关者对需求达成共识，然后由技术团队设计可行的技术实现方案。', taskDeliverables: { 0: [{ name: '需求文档', note: '需求规格说明书/PRD' }], 1: [{ name: '技术方案', note: '技术设计文档/架构图' }] } },
      { name: '开发', tasks: ['前端开发', '后端开发', '前后端联调'], tip: '本阶段按照技术方案进行编码实现。前端和后端并行开发，完成后进行联调确保接口对接正常。建议采用敏捷开发模式，每日同步进度。', taskDeliverables: { 0: [{ name: '前端代码', note: '前端源码及构建产物' }], 1: [{ name: '后端代码', note: '后端源码及API文档' }], 2: [{ name: '联调报告', note: '联调测试记录及截图' }] } },
      { name: '测试', tasks: ['测试用例编写', '功能测试', '回归测试'], tip: '本阶段进行全面的质量保障工作。首先编写测试用例覆盖所有功能点，然后执行功能测试和回归测试，确保产品质量符合预期。', taskDeliverables: { 0: [{ name: '测试用例', note: '测试用例文档' }], 1: [{ name: '测试报告', note: '功能测试报告及Bug清单' }], 2: [{ name: '回归报告', note: '回归测试通过报告' }] } },
      { name: '发布', tasks: ['发布准备', '上线与验收'], tip: '本阶段完成产品的最终发布。包括发布前的准备工作（环境配置、数据迁移等）和上线后的验收确认。', taskDeliverables: { 0: [{ name: '发布清单', note: '发布前检查清单' }], 1: [{ name: '验收报告', note: '上线验收报告' }] } }
    ]
  },
  {
    id: 'tpl_builtin_release',
    name: '产品发布',
    category: '发布',
    builtin: true,
    createdAt: '',
    phases: [
      { name: '启动', tasks: ['发布目标对齐', '物料与文案准备'], tip: '本阶段明确发布目标和范围，准备发布所需的各类物料和文案内容。确保团队对发布目标达成一致。', taskDeliverables: { 0: [{ name: '发布目标文档', note: '发布目标与范围说明' }], 1: [{ name: '物料清单', note: '文案/图片/视频素材' }] } },
      { name: '执行', tasks: ['灰度发布', '渠道投放', '数据监控'], tip: '本阶段执行发布计划。先进行灰度发布验证，然后全量投放，同时实时监控数据表现。', taskDeliverables: { 0: [{ name: '灰度报告', note: '灰度阶段数据与反馈' }], 1: [{ name: '投放记录', note: '各渠道投放截图与数据' }], 2: [{ name: '监控报告', note: '实时数据监控截图' }] } },
      { name: '收尾', tasks: ['复盘总结', '问题清单跟进'], tip: '本阶段进行发布复盘，总结经验教训，并跟进遗留问题。', taskDeliverables: { 0: [{ name: '复盘文档', note: '发布复盘报告' }], 1: [{ name: '问题清单', note: '遗留问题跟进表' }] } }
    ]
  },
  {
    id: 'tpl_builtin_ops',
    name: '日常运营项目',
    category: '运营',
    builtin: true,
    createdAt: '',
    phases: [
      { name: '策划', tasks: ['活动策划', '资源确认'], tip: '本阶段进行运营活动的整体策划，包括活动方案设计和所需资源的确认。', taskDeliverables: { 0: [{ name: '策划方案', note: '活动策划方案文档' }], 1: [{ name: '资源清单', note: '所需资源与预算清单' }] } },
      { name: '执行', tasks: ['活动上线', '投放与触达'], tip: '本阶段执行运营活动，包括活动上线和各渠道的投放触达。', taskDeliverables: { 0: [{ name: '上线记录', note: '活动上线截图与数据' }], 1: [{ name: '触达报告', note: '各渠道触达数据' }] } },
      { name: '复盘', tasks: ['数据回收', '效果复盘'], tip: '本阶段回收活动数据，分析活动效果，形成复盘报告。', taskDeliverables: { 0: [{ name: '数据报告', note: '活动数据汇总表' }], 1: [{ name: '复盘文档', note: '活动效果复盘报告' }] } }
    ]
  },
  {
    id: 'tpl_builtin_thesis',
    name: '论文撰写',
    category: '学术',
    builtin: true,
    createdAt: '',
    phases: [
      { name: '选题与开题', tasks: ['选题调研与文献综述', '开题报告撰写', '开题答辩准备'], tip: '本阶段完成论文选题和开题工作。通过文献调研确定研究方向，撰写开题报告，并准备开题答辩。', taskDeliverables: { 0: [{ name: '文献综述', note: '文献调研报告与综述文档' }], 1: [{ name: '开题报告', note: '开题报告文档' }], 2: [{ name: '答辩PPT', note: '开题答辩演示文稿' }] } },
      { name: '研究与实验', tasks: ['研究方案设计', '实验与数据采集', '结果整理与分析'], tip: '本阶段开展核心研究工作。设计详细的研究方案，进行实验和数据采集，最后整理分析实验结果。', taskDeliverables: { 0: [{ name: '研究方案', note: '详细研究方案与方法论' }], 1: [{ name: '实验数据', note: '原始数据与实验记录' }], 2: [{ name: '分析报告', note: '数据分析结果与图表' }] } },
      { name: '论文撰写', tasks: ['论文框架搭建', '初稿撰写', '图表与参考文献整理'], tip: '本阶段进行论文的正式撰写。先搭建论文框架，然后撰写初稿，最后整理图表和参考文献。', taskDeliverables: { 0: [{ name: '论文大纲', note: '论文结构框架' }], 1: [{ name: '论文初稿', note: '论文初稿全文' }], 2: [{ name: '参考文献', note: '参考文献列表与图表文件' }] } },
      { name: '修改与定稿', tasks: ['导师审阅与修改', '查重与格式规范', '定稿提交'], tip: '本阶段完成论文的修改和完善。根据导师意见修改，进行查重和格式规范，最终定稿提交。', taskDeliverables: { 0: [{ name: '修改意见', note: '导师审阅反馈与修改记录' }], 1: [{ name: '查重报告', note: '查重报告与格式检查' }], 2: [{ name: '定稿文件', note: '最终提交版本' }] } }
    ]
  }
];
