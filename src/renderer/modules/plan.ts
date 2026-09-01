import { uid } from '../../shared/uid.js';
import { Deliverable, Phase, Priority, Task, TaskStatus } from '../../shared/types.js';
import { DAY, fmtDate, fmtDuration, parseDate, todayMs, todayStr } from '../../shared/date.js';
import { store, isElectron } from '../core/store.js';
import { refreshAll, requireRepo } from '../core/app.js';
import { buildForm, clear, confirmDialog, el, openModal, toast } from '../core/dom.js';
import { curProject, isTaskOpen, projectPhases, projectTasks, state } from '../core/state.js';

/* ============ 计划：阶段 → 任务 + 交付物提交模块 ============ */

const TASK_STATUSES: TaskStatus[] = ['待开始', '进行中', '已完成', '已取消'];
const PRIORITIES: Priority[] = ['P0', 'P1', 'P2'];

let searchQ = '';
let statusFilter = '全部';
const sel = new Set<string>();
const phaseSel = new Set<string>();

export function renderPlan(root: HTMLElement): void {
  const prj = curProject();
  const bar = el('div', { cls: 'tool-bar' });
  const search = el('input', {
    attrs: { type: 'search', placeholder: '搜索任务 / 负责人…' },
    title: '按任务名或负责人搜索'
  }) as HTMLInputElement;
  search.value = searchQ;
  search.addEventListener('input', () => {
    searchQ = search.value.trim();
    rerenderList();
  });
  const statusSel = el('select', { attrs: { title: '按状态筛选' } }) as HTMLSelectElement;
  for (const s of ['全部', ...TASK_STATUSES]) statusSel.appendChild(el('option', { text: s, attrs: { value: s } }));
  statusSel.value = statusFilter;
  statusSel.addEventListener('change', () => {
    statusFilter = statusSel.value;
    rerenderList();
  });
  bar.append(search, statusSel, el('span', { cls: 'spacer' }));
  
  // 整体导入按钮
  const importBtn = el('button', { cls: 'btn', text: '整体导入', attrs: { type: 'button' } });
  importBtn.addEventListener('click', () => {
    if (!curProject()) { toast('请先创建项目', 'warn'); return; }
    openImportModal();
  });
  
  // 编辑计划按钮（原任务编辑）
  const taskEditBtn = el('button', { cls: 'btn primary', text: '编辑计划', attrs: { type: 'button' } });
  taskEditBtn.addEventListener('click', () => {
    if (!curProject()) { toast('请先创建项目', 'warn'); return; }
    openTaskEditModal();
  });
  bar.append(importBtn, taskEditBtn);
  
  root.appendChild(bar);

  const batchSlot = el('div');
  root.appendChild(batchSlot);
  const card = el('div', { cls: 'glass panel table-card' });
  const scroll = el('div', { cls: 'table-scroll' });
  card.appendChild(scroll);
  root.appendChild(card);

  function rerenderList(): void {
    renderTable(scroll, batchSlot, prj !== null);
  }
  renderTable(scroll, batchSlot, prj !== null);
}

function renderTable(scroll: HTMLElement, batchSlot: HTMLElement, hasProject: boolean): void {
  clear(scroll);
  clear(batchSlot);
  const existing = new Set(projectTasks().map((t) => t.id));
  for (const id of Array.from(sel)) if (!existing.has(id)) sel.delete(id);

  if (!hasProject) {
    scroll.appendChild(el('div', { cls: 'empty-tip', html: '暂无项目 —— 请先点击右上角【<b>新建项目</b>】创建项目' }));
    return;
  }

  const phases = projectPhases();
  const all = projectTasks();
  const filtered = all.filter((t) => {
    if (statusFilter !== '全部' && t.status !== statusFilter) return false;
    if (searchQ && !`${t.title}${t.owner}`.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  if (sel.size || phaseSel.size) {
    const bar = el('div', { cls: 'batch-bar' });
    const totalSelected = sel.size + phaseSel.size;
    const del = el('button', { cls: 'btn sm danger', text: `批量删除（${totalSelected}）`, attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const taskCount = sel.size;
      const phaseCount = phaseSel.size;
      let msg = '';
      if (phaseCount > 0) {
        const phaseTasksCount = filtered.filter(t => phaseSel.has(t.phaseId)).length;
        msg = `确认删除 ${phaseCount} 个阶段和 ${phaseTasksCount} 个任务？删除后不可恢复。`;
      } else {
        msg = `确认删除已选中的 ${taskCount} 个任务？删除后不可恢复。`;
      }
      const ok = await confirmDialog('批量删除', msg);
      if (!ok) return;
      // 删除阶段下的任务
      if (phaseCount > 0) {
        const tasksToDelete = filtered.filter(t => phaseSel.has(t.phaseId)).map(t => t.id);
        if (tasksToDelete.length) await store.remove('task', tasksToDelete);
        await store.remove('phase', Array.from(phaseSel));
        phaseSel.clear();
      }
      // 删除选中的任务
      if (taskCount > 0) {
        await store.remove('task', Array.from(sel));
      }
      sel.clear();
      toast('已删除选中项', 'ok');
      await refreshAll();
    });
    const cancel = el('button', { cls: 'btn sm ghost', text: '取消选择', attrs: { type: 'button' } });
    cancel.addEventListener('click', () => {
      sel.clear();
      phaseSel.clear();
      rerenderPlan();
    });
    bar.append(el('span', { text: `已选择 ${totalSelected} 项` }), del, cancel);
    batchSlot.appendChild(bar);
  }

  const table = el('table', { cls: 'pms-table' }) as HTMLTableElement;
  const thead = el('thead');
  const hr = el('tr');
  const allCb = el('input', { attrs: { type: 'checkbox', title: '全选 / 取消全选' } }) as HTMLInputElement;
  allCb.checked = filtered.length > 0 && filtered.every((t) => sel.has(t.id));
  allCb.addEventListener('change', () => {
    if (allCb.checked) {
      // 全选：选中所有阶段和任务
      for (const t of filtered) sel.add(t.id);
      for (const p of phases) phaseSel.add(p.id);
    } else {
      // 取消全选：清除所有选择
      sel.clear();
      phaseSel.clear();
    }
    rerenderPlan();
  });
  const cbCell = el('th');
  cbCell.appendChild(allCb);
  hr.append(
    cbCell,
    el('th', { text: '任务' }),
    el('th', { text: '负责人' }),
    el('th', { text: '开始' }),
    el('th', { text: '结束' }),
    el('th', { text: '工时(h)' }),
    el('th', { text: '用时', title: '从首次进入「进行中」到「已完成」的时长（进行中实时累计）' }),
    el('th', { text: '提交进度' }),
    el('th', { text: '优先级' }),
    el('th', { text: '状态' }),
    el('th', { text: '交付物 / 提交' }),
    el('th', { text: '操作' })
  );
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');

  const t0 = todayMs();
  const groups: Array<{ phase: Phase | null; tasks: Task[] }> = phases.map((p) => ({
    phase: p,
    tasks: filtered.filter((t) => t.phaseId === p.id)
  }));
  const ungrouped = filtered.filter((t) => !t.phaseId || !phases.some((p) => p.id === t.phaseId));
  if (ungrouped.length) groups.push({ phase: null, tasks: ungrouped });

  let shown = 0;
  for (const g of groups) {
  const grow = el('tr', { cls: 'tr-group' });
  const gc = el('td');
  gc.colSpan = 12;
    const inner = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    
    // 阶段选择框
    if (g.phase) {
      const phaseCb = el('input', { attrs: { type: 'checkbox', title: '选中以批量删除阶段及其下所有任务' } }) as HTMLInputElement;
      phaseCb.checked = phaseSel.has(g.phase.id);
      phaseCb.addEventListener('change', () => {
        if (phaseCb.checked) {
          phaseSel.add(g.phase!.id);
          // 自动勾选该阶段下所有任务
          for (const t of g.tasks) sel.add(t.id);
        } else {
          phaseSel.delete(g.phase!.id);
          // 取消勾选该阶段下所有任务
          for (const t of g.tasks) sel.delete(t.id);
        }
        rerenderPlan();
      });
      phaseCb.classList.add('phase-cb');
      inner.appendChild(phaseCb);
    }
    
    inner.appendChild(el('span', { text: `◆ ${g.phase ? g.phase.name : '未分组'}` }));
    inner.appendChild(el('span', { cls: 'cell-dim', text: `（${g.tasks.length}）` }));
    if (g.phase) {
      const phFolder = el('button', {
        cls: 'btn sm ghost',
        text: '📁',
        attrs: { type: 'button' },
        title: `打开阶段「${g.phase.name}」文件夹`
      });
      phFolder.addEventListener('click', async () => {
        if (!isElectron) {
          toast('文件夹跳转仅桌面版支持', 'warn');
          return;
        }
        if (!(await requireRepo())) return;
        if (!(await store.openFolder('phase', g.phase!.id))) toast('文件夹打开失败（工作目录未设置？）', 'err');
      });
      const phTip = el('button', { cls: 'btn sm ghost', text: '💡', attrs: { type: 'button' }, title: '查看阶段提示' });
      phTip.addEventListener('click', () => showPhaseTipModal(g.phase!));
      const del = el('button', { cls: 'btn sm ghost', text: '删除', attrs: { type: 'button' } });
      del.addEventListener('click', async () => {
        const cnt = projectTasks().filter((t) => t.phaseId === g.phase!.id).length;
        const ok = await confirmDialog(
          '删除阶段',
          cnt ? `阶段「${g.phase!.name}」下有 ${cnt} 个任务，删除后任务将一并删除。确认删除？` : `确认删除阶段「${g.phase!.name}」？`
        );
        if (!ok) return;
        // 删除阶段下的任务
        if (cnt) {
          const tasksToDelete = projectTasks().filter(t => t.phaseId === g.phase!.id).map(t => t.id);
          await store.remove('task', tasksToDelete);
        }
        await store.remove('phase', [g.phase!.id]);
        toast('阶段已删除');
        await refreshAll();
      });
      inner.append(phFolder, phTip, del);
    }
    gc.appendChild(inner);
    grow.appendChild(gc);
    tbody.appendChild(grow);
    for (const t of g.tasks) {
      shown++;
      tbody.appendChild(taskRow(t, t0, g.phase?.id || null, phaseSel, rerenderPlan));
    }
  }
  if (!shown) {
    const r = el('tr');
    const c = el('td');
    c.colSpan = 12;
    c.appendChild(el('div', { cls: 'empty-tip', html: '暂无任务数据 —— 点击【<b>任务编辑</b>】创建第一条任务' }));
    r.appendChild(c);
    tbody.appendChild(r);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);

}

function rerenderPlan(): void {
  const main = document.getElementById('app-main')!;
  const pane = main.querySelector('.pane') as HTMLElement | null;
  if (pane) {
    clear(pane);
    renderPlan(pane);
  }
}

/** PLN-11 任务用时：首次进入「进行中」→「已完成」的时长；进行中实时累计；无起点显示 — */
function taskDurationText(t: Task): string {
  if (!t.startedAt) return '—';
  const start = parseDate(t.startedAt);
  let end: number | null = null;
  if (t.completedAt) end = parseDate(t.completedAt);
  else if (t.status === '进行中') end = todayMs();
  if (end == null) return '—';
  return fmtDuration(end - start);
}

/** 计划范式说明 */
const PLAN_SCHEMA_HELP = `计划范式结构说明：

{
  "phases": [
    {
      "name": "阶段名称（必填）",
      "tip": "阶段提示（可选）：说明该阶段要执行什么任务",
      "tasks": ["任务1", "任务2"],
      "taskDeliverables": {
        "0": [{ "name": "交付物名称", "note": "说明（可选）" }]
      }
    }
  ]
}

字段说明：
- phases: 阶段数组（必填）
  - name: 阶段名称（必填）
  - phases_tip: 阶段提示（可选）
  - tasks: 任务名称数组（必填）
  - task_tip: 任务提示数组（可选，与tasks一一对应）
  - taskDeliverables: 交付物配置（可选）
    - key为任务索引（从0开始）
    - value为该任务的交付物数组

示例：
{
  "phases": [
    {
      "name": "需求分析",
      "phases_tip": "本阶段完成需求调研和分析",
      "tasks": ["用户调研", "需求文档"],
      "task_tip": ["进行用户访谈和调研，输出调研报告", "根据调研结果编写需求文档"],
      "taskDeliverables": {
        "0": [{ "name": "调研报告" }],
        "1": [{ "name": "需求规格书" }]
      }
    },
    {
      "name": "开发",
      "tasks": ["前端开发", "后端开发"]
    }
  ]
}`;

/** 整体导入弹窗 */
function openImportModal(): void {
  const m = openModal('整体导入');
  m.el.classList.add('import-modal');
  
  // 版块0：使用模板
  const templateSection = el('div', { cls: 'import-section' });
  const templateHeader = el('div', { cls: 'import-section-header' });
  templateHeader.appendChild(el('h4', { text: '使用模板' }));
  templateSection.appendChild(templateHeader);
  
  const templateHint = el('div', { cls: 'import-hint', text: '选择模板中心的模板快速创建计划结构' });
  templateSection.appendChild(templateHint);
  
  const templateList = el('div', { cls: 'template-list' });
  const templates = state.data?.templates || [];
  
  if (templates.length === 0) {
    templateList.appendChild(el('div', { cls: 'empty-tip', text: '暂无可用模板，请先在模板中心创建或导入模板' }));
  } else {
    for (const tpl of templates) {
      const tplItem = el('div', { cls: 'template-item' });
      const tplName = el('div', { cls: 'template-name', text: tpl.name });
      const tplInfo = el('div', { cls: 'template-info', text: `${tpl.phases.length} 个阶段 · ${tpl.category}` });
      tplItem.append(tplName, tplInfo);
      tplItem.addEventListener('click', () => {
        // 将模板转换为 JSON 格式并填充到编辑器
        const planData = {
          name: tpl.name,
          phases: tpl.phases.map(p => ({
            name: p.name,
            tasks: p.tasks,
            phases_tip: p.phases_tip || '',
            ...(p.task_tip?.length ? { task_tip: p.task_tip } : {})
          }))
        };
        jsonEditor.value = JSON.stringify(planData, null, 2);
        updateLineNumbers();
        validateJson(jsonEditor.value);
        toast(`已加载模板「${tpl.name}」`, 'ok');
      });
      templateList.appendChild(tplItem);
    }
  }
  templateSection.appendChild(templateList);
  
  // 版块1：选择JSON文件
  const fileSection = el('div', { cls: 'import-section' });
  const fileHeader = el('div', { cls: 'import-section-header' });
  fileHeader.appendChild(el('h4', { text: '选择JSON文件' }));
  fileSection.appendChild(fileHeader);
  
  const fileInput = el('input', { attrs: { type: 'file', accept: '.json', style: 'display:none;' } }) as HTMLInputElement;
  const fileBtn = el('button', { cls: 'btn', text: '选择文件', attrs: { type: 'button' } });
  const fileName = el('span', { cls: 'import-file-name', text: '未选择文件' });
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      fileName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        jsonEditor.value = content;
        validateJson(content);
      };
      reader.readAsText(file);
    }
  });
  fileSection.append(fileBtn, fileName);
  
  // 版块2：制定计划框
  const planSection = el('div', { cls: 'import-section' });
  const planHeader = el('div', { cls: 'import-section-header' });
  planHeader.appendChild(el('h4', { text: '制定计划框' }));
  
  // 范式说明按钮
  const helpBtn = el('button', { cls: 'btn sm ghost', text: '🤖', attrs: { type: 'button' }, title: '查看计划范式说明' });
  helpBtn.addEventListener('click', () => showPlanSchemaHelp());
  planHeader.appendChild(helpBtn);
  planSection.appendChild(planHeader);
  
  const editorWrap = el('div', { cls: 'import-editor-wrap' });
  const lineNumbers = el('div', { cls: 'import-line-numbers' });
  const jsonEditor = el('textarea', {
    cls: 'import-json-editor',
    attrs: { placeholder: '在此粘贴或输入JSON格式的计划...', spellcheck: 'false' }
  }) as HTMLTextAreaElement;
  
  // 行号更新
  const updateLineNumbers = () => {
    const lines = jsonEditor.value.split('\n').length;
    lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
  };
  jsonEditor.addEventListener('input', () => {
    updateLineNumbers();
    validateJson(jsonEditor.value);
  });
  jsonEditor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = jsonEditor.scrollTop;
  });
  
  editorWrap.append(lineNumbers, jsonEditor);
  planSection.appendChild(editorWrap);
  
  m.body.append(templateSection, fileSection, planSection);
  
  // 按钮顺序：格式化、导入、取消
  const closeBtn = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => m.close());
  
  // 底部格式化按钮
  const footFormatBtn = el('button', { cls: 'btn sm ghost', text: '格式化', attrs: { type: 'button' } });
  footFormatBtn.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(jsonEditor.value);
      jsonEditor.value = JSON.stringify(parsed, null, 2);
      updateLineNumbers();
      validateJson(jsonEditor.value);
      toast('格式化成功', 'ok');
    } catch (e) {
      toast('JSON格式错误，无法格式化', 'err');
    }
  });
  
  // 底部导入按钮
  const footImportBtn = el('button', { cls: 'btn primary', text: '导入', attrs: { type: 'button' } });
  footImportBtn.addEventListener('click', async () => {
    const result = validateJson(jsonEditor.value);
    if (!result.valid) {
      toast(result.error || 'JSON格式不正确', 'err');
      return;
    }
    
    try {
      const data = JSON.parse(jsonEditor.value);
      await importPlan(data);
      m.close();
      toast('计划导入成功', 'ok');
      await refreshAll();
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`, 'err');
    }
  });
  
  m.foot.append(footFormatBtn, footImportBtn, closeBtn);
  
  // 初始化行号
  updateLineNumbers();
  
  // 验证JSON
  function validateJson(content: string): { valid: boolean; error?: string } {
    try {
      const data = JSON.parse(content);
      if (!data.phases || !Array.isArray(data.phases)) {
        return { valid: false, error: '缺少phases数组' };
      }
      for (const phase of data.phases) {
        if (!phase.name) {
          return { valid: false, error: '阶段缺少name字段' };
        }
        if (!phase.tasks || !Array.isArray(phase.tasks)) {
          return { valid: false, error: `阶段「${phase.name}」缺少tasks数组` };
        }
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `JSON解析错误：${(e as Error).message}` };
    }
  }
}

/** 显示计划范式说明 */
function showPlanSchemaHelp(): void {
  const m = openModal('计划范式说明');
  m.el.classList.add('tip-modal');
  
  const header = el('div', { cls: 'tip-header' });
  header.appendChild(el('span', { cls: 'tip-title', text: 'JSON格式计划范式' }));
  const copyBtn = el('button', { cls: 'btn sm ghost', text: '📋 复制', attrs: { type: 'button' } });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(PLAN_SCHEMA_HELP);
      toast('已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败', 'err');
    }
  });
  header.appendChild(copyBtn);
  m.body.appendChild(header);
  
  const content = el('div', { cls: 'tip-content' });
  content.appendChild(el('div', { cls: 'tip-text', text: PLAN_SCHEMA_HELP }));
  m.body.appendChild(content);
  
  const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => m.close());
  m.foot.appendChild(closeBtn);
}

/** 导入计划数据 */
async function importPlan(data: { phases: Array<{ name: string; phases_tip?: string; tasks: string[]; task_tip?: string[]; taskDeliverables?: Record<number, Array<{ name: string; note?: string }>> }> }): Promise<void> {
  const prj = curProject();
  if (!prj) return;
  
  // 获取现有阶段的最大order
  const existingPhases = projectPhases();
  let maxOrder = existingPhases.length > 0 ? Math.max(...existingPhases.map(p => p.order)) : 0;
  
  for (const phaseData of data.phases) {
    maxOrder++;
    // 创建阶段
    const phasePayload = {
      projectId: state.projectId,
      name: phaseData.name,
      order: maxOrder,
      tip: phaseData.phases_tip || ''
    };
    const phase = await store.create('phase', phasePayload) as Phase;
    
    // 创建任务
    if (phaseData.tasks && phaseData.tasks.length > 0) {
      const phaseStartTime = todayMs();
      const taskDuration = 7 * DAY; // 每个任务默认7天
      
      for (let i = 0; i < phaseData.tasks.length; i++) {
        const taskTitle = phaseData.tasks[i];
        const taskStart = phaseStartTime + i * taskDuration;
        const taskEnd = taskStart + (taskDuration - DAY);
        
        // 获取交付物
        const deliverables = (phaseData.taskDeliverables?.[i] || []).map(d => ({
          id: uid('dl'),
          name: d.name,
          note: d.note || '',
          time: '',
          accepted: false
        }));
        
        await store.create('task', {
          projectId: state.projectId,
          phaseId: phase.id,
          title: taskTitle,
          owner: '',
          startDate: fmtDate(taskStart),
          endDate: fmtDate(taskEnd),
          hours: 8,
          progress: 0,
          status: '待开始',
          priority: 'P1',
          desc: '',
          tip: phaseData.task_tip?.[i] || '',
          deliverables,
          completedAt: ''
        });
      }
    }
  }
}

/** 显示阶段提示弹窗 */
function showPhaseTipModal(phase: Phase): void {
  const m = openModal(`阶段提示 · ${phase.name}`);
  m.el.classList.add('tip-modal');
  
  // 内容区域带复制按钮
  const header = el('div', { cls: 'tip-header' });
  header.appendChild(el('span', { cls: 'tip-title', text: '阶段提示' }));
  const copyBtn = el('button', { cls: 'btn sm ghost', text: '📋 复制', attrs: { type: 'button' } });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tipText);
      toast('已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败', 'err');
    }
  });
  header.appendChild(copyBtn);
  m.body.appendChild(header);
  
  const content = el('div', { cls: 'tip-content' });
  const tipText = phase.tip || '暂无阶段提示';
  content.appendChild(el('div', { cls: 'tip-text', text: tipText }));
  m.body.appendChild(content);
  
  const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => m.close());
  m.foot.appendChild(closeBtn);
}

/** 显示任务提示弹窗 */
function showTaskTipModal(task: Task): void {
  const m = openModal(`任务提示 · ${task.title}`);
  m.el.classList.add('tip-modal');
  
  // 内容区域带复制按钮
  const header = el('div', { cls: 'tip-header' });
  header.appendChild(el('span', { cls: 'tip-title', text: '任务提示' }));
  const copyBtn = el('button', { cls: 'btn sm ghost', text: '📋 复制', attrs: { type: 'button' } });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tipText);
      toast('已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败', 'err');
    }
  });
  header.appendChild(copyBtn);
  m.body.appendChild(header);
  
  const content = el('div', { cls: 'tip-content' });
  const tipText = task.tip || '暂无任务提示';
  content.appendChild(el('div', { cls: 'tip-text', text: tipText }));
  m.body.appendChild(content);
  
  const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => m.close());
  m.foot.appendChild(closeBtn);
}

function taskRow(t: Task, t0: number, phaseId: string | null, phaseSel: Set<string>, rerenderFn: () => void): HTMLTableRowElement {
  const tr = el('tr') as HTMLTableRowElement;
  const cb = el('input', { attrs: { type: 'checkbox', title: '选中以批量删除' } }) as HTMLInputElement;
  cb.checked = sel.has(t.id);
  cb.classList.add('task-cb');
  cb.addEventListener('change', () => {
    if (cb.checked) {
      sel.add(t.id);
      // 如果该阶段下所有任务都被选中，则自动选中阶段
      if (phaseId) {
        const phaseTasks = projectTasks().filter(t => t.phaseId === phaseId);
        if (phaseTasks.every(t => sel.has(t.id))) {
          phaseSel.add(phaseId);
        }
      }
    } else {
      sel.delete(t.id);
      // 取消选中时，同时取消阶段选择
      if (phaseId) phaseSel.delete(phaseId);
    }
    rerenderFn();
  });
  tr.appendChild(wrap(cb));
  const titleCell = el('td');
  const late = isTaskOpen(t) && parseDate(t.endDate) < t0;
  titleCell.appendChild(
    el('div', { cls: 'cell-title', text: t.title, title: t.desc || t.title })
  );
  if (late) {
    const d = Math.round((t0 - parseDate(t.endDate)) / DAY);
    titleCell.appendChild(el('div', { cls: 'cell-dim alert-text', text: `已延期 ${d} 天` }));
  }
  tr.appendChild(titleCell);
  tr.appendChild(wrapText(t.owner || '未指派'));
  tr.appendChild(wrapText(t.startDate.slice(5)));
  tr.appendChild(wrapText(t.endDate.slice(5)));
  tr.appendChild(wrapText(String(t.hours || '—')));
  tr.appendChild(wrapText(taskDurationText(t)));
  // 提交进度：基于交付物提交情况自动计算
  const calcProgress = (() => {
    const uniqueD = [...new Set(t.deliverables.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
    if (!uniqueD.length) return t.progress;
    const submitted = uniqueD.filter((n) => t.deliverables.some((d) => d.name === n && d.time)).length;
    return Math.round((submitted / uniqueD.length) * 100);
  })();
  const prog = el('td');
  const mp = el('span', { cls: 'mini-progress', attrs: { title: `${calcProgress}%` } });
  mp.appendChild(el('i', { attrs: { style: `width:${calcProgress}%` } }));
  prog.append(mp, el('span', { text: ` ${calcProgress}%`, attrs: { style: 'font-size:11.5px' } }));
  tr.appendChild(prog);
  tr.appendChild(wrap(el('span', { cls: `chip ${t.priority.toLowerCase()}`, text: t.priority })));
  const stCell = el('td');
  const stSel = el('select', { cls: 'inline-sel', title: '一键流转状态（PLN-03）' }) as HTMLSelectElement;
  for (const s of TASK_STATUSES) stSel.appendChild(el('option', { text: s, attrs: { value: s } }));
  stSel.value = t.status;
  stSel.addEventListener('change', () => void updateTaskStatus(t, stSel.value as TaskStatus));
  stCell.appendChild(stSel);
  tr.appendChild(stCell);
  const dCell = el('td');
  const dWrap = el('div', { attrs: { style: 'display:flex;gap:4px;align-items:center;flex-wrap:wrap' } });
  const uniqueDelivNames = [...new Set(t.deliverables.map((d) => d.name).filter(Boolean))];
  const totalDeliv = uniqueDelivNames.length;
  const submittedCnt = uniqueDelivNames.filter((name) =>
    t.deliverables.some((d) => d.name === name && d.time)
  ).length;
  const dChip = el('button', {
    cls: `chip ${totalDeliv ? 'gold' : 'dim'}`,
    text: `交付物 ${submittedCnt}/${totalDeliv}`,
    attrs: { type: 'button', title: '点击查看交付物详情与提交状态' }
  });
  dChip.addEventListener('click', () => {
    const taskId = t.id;
    showDeliverablePopup(t, () => {
      const cur = state.data?.tasks.find((x) => x.id === taskId);
      return cur ? cur.deliverables : t.deliverables;
    }, async (next) => {
      await store.update('task', taskId, { deliverables: next });
      const cur = state.data?.tasks.find((x) => x.id === taskId);
      if (cur) cur.deliverables = next;
      // 刷新 chip 文字
      const u2 = [...new Set(next.map((d) => d.name).filter(Boolean))];
      const s2 = u2.filter((n) => next.some((d) => d.name === n && d.time)).length;
      dChip.textContent = `交付物 ${s2}/${u2.length}`;
    });
  });
  const submitBtn = el('button', {
    cls: 'btn sm ghost',
    text: '提交',
    attrs: { type: 'button' },
    title: 'REPO-08：多选文件提交并保存到该任务的仓库文件夹（阶段/任务 层级）'
  });
  submitBtn.addEventListener('click', async () => {
    if (!isElectron) {
      toast('文件提交仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    // 获取去重后的交付物名称列表
    const dNames = [...new Set(t.deliverables.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
    if (dNames.length) {
      // 有交付物 → 弹出选择框
      const sm = openModal(`提交文件 · ${t.title}`);
      sm.body.appendChild(el('div', { cls: 'cell-dim', attrs: { style: 'margin-bottom:10px' }, text: '选择要提交的交付物（文件将保存到对应交付物文件夹）：' }));
      for (const name of dNames) {
        const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--weak-line);border-radius:8px;margin-bottom:6px;cursor:pointer' } });
        row.appendChild(el('span', { text: name, attrs: { style: 'flex:1' } }));
        const cnt = t.deliverables.filter((d) => d.name === name && d.time).length;
        row.appendChild(el('span', { cls: 'cell-dim', text: cnt ? `已提交 ${cnt} 次` : '未提交' }));
        const openBtn = el('button', { cls: 'btn sm ghost', text: '📂', attrs: { type: 'button', title: '打开该交付物文件夹' } });
        openBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await store.openDeliverableFile(t.id, name);
        });
        row.appendChild(openBtn);
        row.addEventListener('click', async () => {
          sm.close();
          try {
            const r = await store.submitTaskFiles(t.id, name);
            if (r) {
              toast(`已提交 ${r.copied} 个文件至「${name}」文件夹（已登记交付物）`);
              await refreshAll();
            }
          } catch (err) {
            toast(`提交失败：${(err as Error).message}`, 'err');
          }
        });
        sm.body.appendChild(row);
      }
      // 也允许直接提交到任务根目录
      const rootRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:8px;border:1px dashed var(--line);border-radius:8px;cursor:pointer;color:var(--dim)' } });
      rootRow.appendChild(el('span', { text: '📁 直接提交到任务文件夹（不归属交付物）', attrs: { style: 'flex:1' } }));
      rootRow.addEventListener('click', async () => {
        sm.close();
        try {
          const r = await store.submitTaskFiles(t.id);
          if (r) {
            toast(`已提交 ${r.copied} 个文件至任务文件夹`);
            await refreshAll();
          }
        } catch (err) {
          toast(`提交失败：${(err as Error).message}`, 'err');
        }
      });
      sm.body.appendChild(rootRow);
      const closeBtn = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
      closeBtn.addEventListener('click', () => sm.close());
      sm.foot.appendChild(closeBtn);
    } else {
      // 无交付物 → 直接打开文件选择
      try {
        const r = await store.submitTaskFiles(t.id);
        if (r) {
          toast(`已提交 ${r.copied} 个文件至任务文件夹（已登记交付物）`);
          await refreshAll();
        }
      } catch (e) {
        toast(`提交失败：${(e as Error).message}`, 'err');
      }
    }
  });
  dWrap.append(dChip, submitBtn);
  dCell.appendChild(dWrap);
  tr.appendChild(dCell);
  const opCell = el('td');
  const folder = el('button', {
    cls: 'btn sm ghost',
    text: '📁',
    attrs: { type: 'button' },
    title: `打开任务「${t.title}」文件夹`
  });
  folder.addEventListener('click', async () => {
    if (!isElectron) {
      toast('文件夹跳转仅桌面版支持', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    if (!(await store.openFolder('task', t.id))) toast('文件夹打开失败（工作目录未设置？）', 'err');
  });
  const tipBtn = el('button', { cls: 'btn sm ghost', text: '💡', attrs: { type: 'button' }, title: '查看任务提示' });
  tipBtn.addEventListener('click', () => showTaskTipModal(t));
  const edit = el('button', { cls: 'btn sm ghost', text: '编辑', attrs: { type: 'button' } });
  edit.addEventListener('click', () => openTaskModal(t));
  const del = el('button', { cls: 'btn sm ghost', text: '删除', attrs: { type: 'button' } });
  del.addEventListener('click', async () => {
    const ok = await confirmDialog('删除任务', `确认删除任务「${t.title}」？删除后不可恢复。`);
    if (!ok) return;
    await store.remove('task', [t.id]);
    toast('任务已删除');
    await refreshAll();
  });
  opCell.append(folder, tipBtn, edit, del);
  tr.appendChild(opCell);
  return tr;
}

function wrap(n: HTMLElement): HTMLTableCellElement {
  const c = el('td');
  c.appendChild(n);
  return c;
}
function wrapText(s: string): HTMLTableCellElement {
  return wrap(el('span', { text: s }));
}

export async function updateTaskStatus(t: Task, status: TaskStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === '已完成') {
    patch.completedAt = todayStr();
    patch.progress = 100;
    if (!t.startedAt) patch.startedAt = todayStr(); // 当日完成当日开始，保证用时可统计
  } else if (status === '进行中') {
    if (!t.startedAt) patch.startedAt = todayStr(); // PLN-11 用时统计起点
  } else if (t.status === '已完成') {
    patch.completedAt = '';
    if (status === '待开始') {
      patch.progress = 0;
      patch.startedAt = ''; // 回到待开始重置计时
    }
  }
  await store.update('task', t.id, patch);
  toast(`「${t.title}」状态 → ${status}`);
  await refreshAll();
}

/* ---- 任务表单（新增 / 编辑）+ 交付物提交模块 ---- */
export function openTaskModal(t?: Task, phaseId: string = ''): void {
  if (!curProject()) {
    toast('请先创建项目后再添加任务', 'warn');
    return;
  }
  const phases = projectPhases();
  const m = openModal(t ? '编辑任务' : '新增任务');
  const form = buildForm(
    [
      { key: 'title', label: '任务标题', type: 'text', required: true, full: true, placeholder: '如：登录模块开发' },
      {
        key: 'phaseId',
        label: '所属阶段',
        type: 'select',
        options: [{ value: '', label: '未分组' }, ...phases.map((p) => ({ value: p.id, label: p.name }))]
      },
      { key: 'owner', label: '负责人', type: 'select', options: (() => {
        const prj = curProject();
        if (!prj) return [{ value: '', label: '未指派' }];
        const members = [prj.owner, ...(prj.members || [])].filter(Boolean);
        const unique = [...new Set(members)];
        return unique.map((m) => ({
          value: m,
          label: m === prj.owner ? `${m}（负责人）` : m
        }));
      })() },
      { key: 'startDate', label: '开始日期', type: 'date', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', required: true },
      { key: 'hours', label: '预估工时', type: 'number', min: 0.5, step: 0.5 },
      { key: 'priority', label: '优先级', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
      { key: 'status', label: '状态', type: 'select', options: TASK_STATUSES.map((s) => ({ value: s, label: s })) },
      { key: 'progress', label: '进度', type: 'range', min: 0, max: 100, step: 5 },
      { key: 'desc', label: '任务描述', type: 'textarea', full: true, placeholder: '补充说明（可选）' },
      { key: 'tip', label: '任务提示', type: 'textarea', full: true, placeholder: '说明如何用AI完成该项目' }
    ],
    t
      ? { ...t }
      : { phaseId, status: '待开始', priority: 'P1', progress: 0, hours: 8, startDate: todayStr(), endDate: todayStr() },
    (v) => {
      const errs: Record<string, string> = {};
      if (v.startDate && v.endDate && String(v.endDate) < String(v.startDate)) {
        errs.endDate = '结束日期不能早于开始日期';
      }
      return errs;
    }
  );
  m.body.appendChild(form.root);

  // 交付物（提交模块 PLN-05）：编辑态可维护，保存任务时一并生效
  let deliverables: Deliverable[] = t ? t.deliverables.map((d) => ({ ...d })) : [];
  if (t) {
    m.body.appendChild(deliverableSection(t, () => deliverables, (next) => (deliverables = next)));
  }

  const submit = el('button', { cls: 'btn primary', text: t ? '保存' : '创建任务', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    // PLN-11：经表单改状态时维护用时起点（首次进入进行中记录，回到待开始重置）
    let startedAt = t?.startedAt || '';
    if (String(v.status) === '进行中' && !startedAt) startedAt = todayStr();
    if (String(v.status) === '待开始') startedAt = '';
    const payload = {
      projectId: state.projectId,
      phaseId: String(v.phaseId || ''),
      title: String(v.title),
      owner: String(v.owner),
      startDate: String(v.startDate),
      endDate: String(v.endDate),
      hours: Number(v.hours) || 8,
      progress: Number(v.progress) || 0,
      status: String(v.status) as TaskStatus,
      priority: String(v.priority) as Priority,
      desc: String(v.desc || ''),
      tip: String(v.tip || ''),
      deliverables,
      startedAt,
      completedAt: String(v.status) === '已完成' ? (t?.completedAt || todayStr()) : (t?.completedAt || '')
    };
    if (t) {
      await store.update('task', t.id, payload);
      toast('任务已更新');
    } else {
      await store.create('task', payload);
      toast('任务已创建');
    }
    m.close();
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

/* ---- 任务编辑弹窗：集成阶段和任务的增删改功能 ---- */
export function openTaskEditModal(): void {
  const prj = curProject();
  if (!prj) {
    toast('请先创建项目', 'warn');
    return;
  }
  
  const m = openModal('任务编辑');
  m.el.classList.add('task-edit-modal');
  
  // 主容器
  const container = el('div', { cls: 'task-edit-container' });
  
  // 顶部操作栏
  const actionBar = el('div', { cls: 'task-edit-action-bar' });
  
  // 阶段筛选下拉
  const phaseFilterWrap = el('div', { cls: 'task-edit-filter' });
  phaseFilterWrap.appendChild(el('label', { text: '筛选阶段：' }));
  const phaseFilter = el('select', { cls: 'task-edit-select', attrs: { title: '按阶段筛选' } }) as HTMLSelectElement;
  phaseFilter.appendChild(el('option', { text: '全部阶段', attrs: { value: '' } }));
  phaseFilterWrap.appendChild(phaseFilter);
  actionBar.appendChild(phaseFilterWrap);
  
  // 状态筛选下拉
  const statusFilterWrap = el('div', { cls: 'task-edit-filter' });
  statusFilterWrap.appendChild(el('label', { text: '筛选状态：' }));
  const statusFilter = el('select', { cls: 'task-edit-select', attrs: { title: '按状态筛选' } }) as HTMLSelectElement;
  for (const s of ['全部', '待开始', '进行中', '已完成', '已取消']) {
    statusFilter.appendChild(el('option', { text: s, attrs: { value: s === '全部' ? '' : s } }));
  }
  statusFilterWrap.appendChild(statusFilter);
  actionBar.appendChild(statusFilterWrap);
  
  // 新增按钮组
  const addBtnGroup = el('div', { cls: 'task-edit-add-group' });
  const addPhaseBtn = el('button', { cls: 'btn sm primary', text: '＋ 阶段', attrs: { type: 'button' } });
  addPhaseBtn.addEventListener('click', () => openPhaseModal());
  const addTaskBtn = el('button', { cls: 'btn sm primary', text: '＋ 任务', attrs: { type: 'button' } });
  addTaskBtn.addEventListener('click', () => {
    if (!projectPhases().length) { toast('请先创建阶段', 'warn'); return; }
    openTaskModal();
  });
  addBtnGroup.append(addPhaseBtn, addTaskBtn);
  actionBar.appendChild(addBtnGroup);
  
  container.appendChild(actionBar);
  
  // 列表区域
  const listContainer = el('div', { cls: 'task-edit-list-container' });
  container.appendChild(listContainer);
  
  m.body.appendChild(container);
  
  // 渲染列表
  function renderLists(): void {
    clear(listContainer);
    
    const phases = projectPhases();
    const tasks = projectTasks();
    const selectedPhaseId = phaseFilter.value;
    const selectedStatus = statusFilter.value;
    
    // 更新阶段筛选选项
    clear(phaseFilter);
    phaseFilter.appendChild(el('option', { text: '全部阶段', attrs: { value: '' } }));
    for (const p of phases) {
      const opt = el('option', { text: p.name, attrs: { value: p.id } });
      if (p.id === selectedPhaseId) opt.selected = true;
      phaseFilter.appendChild(opt);
    }
    
    // 筛选任务
    const filteredTasks = tasks.filter(t => {
      if (selectedPhaseId && t.phaseId !== selectedPhaseId) return false;
      if (selectedStatus && t.status !== selectedStatus) return false;
      return true;
    });
    
    // 按阶段分组显示
    const groupedTasks = new Map<string, typeof tasks>();
    for (const task of filteredTasks) {
      const phaseId = task.phaseId || '';
      if (!groupedTasks.has(phaseId)) groupedTasks.set(phaseId, []);
      groupedTasks.get(phaseId)!.push(task);
    }
    
    // 渲染阶段和任务
    if (phases.length === 0 && filteredTasks.length === 0) {
      listContainer.appendChild(el('div', { cls: 'task-edit-empty', html: '暂无阶段和任务<br>点击上方按钮添加' }));
      return;
    }
    
    // 渲染有任务的阶段
    for (const phase of phases) {
      const phaseTasks = groupedTasks.get(phase.id) || [];
      if (selectedPhaseId && phase.id !== selectedPhaseId) continue;
      
      const phaseGroup = el('div', { cls: 'task-edit-group' });
      
      // 阶段标题行
      const phaseRow = el('div', { cls: 'task-edit-phase-row' });
      const phaseName = el('span', { cls: 'task-edit-phase-name', text: phase.name });
      const phaseCount = el('span', { cls: 'task-edit-phase-count', text: `${phaseTasks.length}` });
      const phaseActions = el('div', { cls: 'task-edit-phase-actions' });
      
      const editPhaseBtn = el('button', { cls: 'btn sm ghost', text: '编辑', attrs: { type: 'button', title: '编辑阶段名称' } });
      editPhaseBtn.addEventListener('click', () => openPhaseModal(phase));
      const deletePhaseBtn = el('button', { cls: 'btn sm ghost danger', text: '删除', attrs: { type: 'button', title: '删除阶段' } });
      deletePhaseBtn.addEventListener('click', async () => {
        const cnt = projectTasks().filter((t) => t.phaseId === phase.id).length;
        const ok = await confirmDialog(
          '删除阶段',
          cnt ? `阶段「${phase.name}」下有 ${cnt} 个任务，删除后任务将一并删除。确认删除？` : `确认删除阶段「${phase.name}」？`
        );
        if (!ok) return;
        if (cnt) {
          const tasksToDelete = projectTasks().filter(t => t.phaseId === phase.id).map(t => t.id);
          await store.remove('task', tasksToDelete);
        }
        await store.remove('phase', [phase.id]);
        toast('阶段已删除');
        await refreshAll();
        renderLists();
      });
      
      phaseActions.append(editPhaseBtn, deletePhaseBtn);
      phaseRow.append(phaseName, phaseCount, phaseActions);
      phaseGroup.appendChild(phaseRow);
      
      // 渲染该阶段下的任务 - 使用胶囊标签形式
      const taskCapsuleWrap = el('div', { cls: 'task-edit-capsule-wrap' });
      for (const task of phaseTasks) {
        const capsule = el('div', { cls: `task-edit-capsule task-edit-capsule-${task.status === '已完成' ? 'done' : task.status === '进行中' ? 'active' : 'pending'}` });
        capsule.appendChild(el('span', { cls: 'task-edit-capsule-name', text: task.title }));
        capsule.appendChild(el('span', { cls: 'task-edit-capsule-status', text: task.status === '已完成' ? '✓' : task.status === '进行中' ? '●' : '○' }));
        capsule.addEventListener('click', () => openTaskModal(task));
        capsule.title = `点击编辑「${task.title}」`;
        taskCapsuleWrap.appendChild(capsule);
      }
      phaseGroup.appendChild(taskCapsuleWrap);
      
      listContainer.appendChild(phaseGroup);
    }
    
    // 渲染未分组任务
    const ungrouped = groupedTasks.get('') || [];
    if (ungrouped.length && !selectedPhaseId) {
      const phaseGroup = el('div', { cls: 'task-edit-group' });
      const phaseRow = el('div', { cls: 'task-edit-phase-row' });
      phaseRow.appendChild(el('span', { cls: 'task-edit-phase-name', text: '未分组' }));
      phaseRow.appendChild(el('span', { cls: 'task-edit-phase-count', text: `${ungrouped.length}` }));
      phaseGroup.appendChild(phaseRow);
      
      // 未分组任务也使用胶囊标签形式
      const taskCapsuleWrap = el('div', { cls: 'task-edit-capsule-wrap' });
      for (const task of ungrouped) {
        const capsule = el('div', { cls: `task-edit-capsule task-edit-capsule-${task.status === '已完成' ? 'done' : task.status === '进行中' ? 'active' : 'pending'}` });
        capsule.appendChild(el('span', { cls: 'task-edit-capsule-name', text: task.title }));
        capsule.appendChild(el('span', { cls: 'task-edit-capsule-status', text: task.status === '已完成' ? '✓' : task.status === '进行中' ? '●' : '○' }));
        capsule.addEventListener('click', () => openTaskModal(task));
        capsule.title = `点击编辑「${task.title}」`;
        taskCapsuleWrap.appendChild(capsule);
      }
      phaseGroup.appendChild(taskCapsuleWrap);
      
      listContainer.appendChild(phaseGroup);
    }
  }
  
  // 绑定筛选事件
  phaseFilter.addEventListener('change', renderLists);
  statusFilter.addEventListener('change', renderLists);
  
  renderLists();
  
  const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => m.close());
  m.foot.appendChild(closeBtn);
}

function deliverableSection(
  t: Task,
  get: () => Deliverable[],
  set: (next: Deliverable[]) => void
): HTMLElement {
  const box = el('div', { cls: 'dlib' });
  box.appendChild(el('h4', { text: `交付物管理（保存任务时生效）` }));

  // 交付物概览：点击弹出详细列表
  const summary = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' } });
  const uniqueNames = [...new Set(get().map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
  if (!uniqueNames.length) {
    summary.appendChild(el('span', { cls: 'cell-dim', text: '暂无交付物' }));
  }
  for (const name of uniqueNames) {
    const cnt = get().filter((d) => d.name === name).length;
    const accepted = get().filter((d) => d.name === name && d.accepted).length;
    const chip = el('button', {
      cls: `chip ${accepted === cnt && cnt > 0 ? 'ok' : 'gold'}`,
      text: `${name}（${accepted}/${cnt}）`,
      attrs: { type: 'button', title: `点击查看「${name}」交付物详情` }
    });
    chip.addEventListener('click', () => showDeliverablePopup(t, get, set, name));
    summary.appendChild(chip);
  }
  // 点击空白区域也打开弹窗
  if (uniqueNames.length) {
    const moreBtn = el('button', { cls: 'btn sm ghost', text: '📋 查看全部', attrs: { type: 'button' } });
    moreBtn.addEventListener('click', () => showDeliverablePopup(t, get, set));
    summary.appendChild(moreBtn);
  }
  box.appendChild(summary);

  // 包装 set：每次修改后自动刷新概览
  const origSet = set;
  set = (next: Deliverable[]) => {
    origSet(next);
    refreshSummary();
  };

  // 添加新交付物
  const addRow = el('div', { cls: 'dlib-add', attrs: { style: 'margin-top:12px' } });
  const nameIn = el('input', { attrs: { type: 'text', placeholder: '交付物名称，如：设计稿 v1.2' } }) as HTMLInputElement;
  const noteIn = el('input', { attrs: { type: 'text', placeholder: '提交说明（可选）' } }) as HTMLInputElement;
  const addBtn = el('button', { cls: 'btn sm', text: '＋ 添加', attrs: { type: 'button', style: 'flex:0 0 auto' } });
  addBtn.addEventListener('click', () => {
    if (!nameIn.value.trim()) {
      toast('请填写交付物名称', 'warn');
      nameIn.focus();
      return;
    }
    set([
      ...get(),
      {
        id: uid('dl'),
        name: nameIn.value.trim(),
        note: noteIn.value.trim(),
        time: '',
        accepted: false
      }
    ]);
    nameIn.value = '';
    noteIn.value = '';
    // 刷新概览
    refreshSummary();
  });
  addRow.append(nameIn, noteIn, addBtn);
  box.appendChild(addRow);

  function refreshSummary(): void {
    clear(summary);
    const names = [...new Set(get().map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
    if (!names.length) {
      summary.appendChild(el('span', { cls: 'cell-dim', text: '暂无交付物' }));
    }
    for (const name of names) {
      const cnt = get().filter((d) => d.name === name).length;
      const accepted = get().filter((d) => d.name === name && d.accepted).length;
      const chip = el('button', {
        cls: `chip ${accepted === cnt && cnt > 0 ? 'ok' : 'gold'}`,
        text: `${name}（${accepted}/${cnt}）`,
        attrs: { type: 'button', title: `点击查看「${name}」交付物详情` }
      });
      chip.addEventListener('click', () => showDeliverablePopup(t, get, set, name));
      summary.appendChild(chip);
    }
    if (names.length) {
      const moreBtn = el('button', { cls: 'btn sm ghost', text: '📋 查看全部', attrs: { type: 'button' } });
      moreBtn.addEventListener('click', () => showDeliverablePopup(t, get, set));
      summary.appendChild(moreBtn);
    }
  }

  return box;
}

/** 弹出交付物详情弹窗 */
function showDeliverablePopup(
  t: Task,
  get: () => Deliverable[],
  set: (next: Deliverable[]) => void | Promise<void>,
  filterName?: string
): void {
  const title = filterName ? `交付物 · ${filterName}` : `交付物 · ${t.title}`;
  const m = openModal(title);

  function renderPopup(): void {
    clear(m.body);
    clear(m.foot);
    const all = get();
    const uniqueNames = [...new Set(all.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
    const namesToShow = filterName ? [filterName] : uniqueNames;

    if (!namesToShow.length && !all.some((d) => d.name === '__unassigned__')) {
      m.body.appendChild(el('div', { cls: 'empty-tip', text: '暂无交付物（请在编辑任务中添加）' }));
    }

    for (const name of namesToShow) {
      const items = all.filter((d) => d.name === name);
      const submittedItems = items.filter((d) => d.time);
      const pendingItems = items.filter((d) => !d.time);

      const card = el('div', { attrs: { style: 'border:1px solid var(--weak-line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--card)' } });
      const cardHead = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' } });
      const nameSpan = el('span', { attrs: { style: 'font-weight:600;color:var(--gold-hi);cursor:pointer;font-size:13.5px' }, text: name });
      nameSpan.title = '点击编辑名称';
      nameSpan.addEventListener('click', async () => {
        const newName = prompt('修改交付物名称：', name);
        if (newName && newName.trim() && newName.trim() !== name) {
          if (isElectron) await store.renameDeliverableFolder(t.id, name, newName.trim());
          await set(get().map((d) => d.name === name ? { ...d, name: newName.trim() } : d));
          renderPopup();
        }
      });
      cardHead.appendChild(nameSpan);
      const statusText = submittedItems.length ? `${submittedItems.length}/${items.length} 已提交` : `0/${items.length} 未提交`;
      cardHead.appendChild(el('span', { cls: `chip ${submittedItems.length === items.length ? 'ok' : 'dim'}`, text: statusText }));
      const openBtn = el('button', { cls: 'btn sm ghost', text: '📂 打开', attrs: { type: 'button' } });
      openBtn.addEventListener('click', async () => {
        if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
        if (!(await requireRepo())) return;
        await store.openDeliverableFile(t.id, name);
      });
      cardHead.appendChild(openBtn);
      const delAllBtn = el('button', { cls: 'btn sm danger', text: '🗑 删除', attrs: { type: 'button' } });
      delAllBtn.addEventListener('click', async () => {
        if (!await confirmDialog('删除交付物', `确定删除「${name}」及其所有提交记录和对应文件？`)) return;
        if (isElectron) await store.deleteDeliverableFiles(t.id, name, true);
        await set(get().filter((d) => d.name !== name));
        toast(`已删除「${name}」`);
        renderPopup();
      });
      cardHead.appendChild(delAllBtn);
      card.appendChild(cardHead);

      for (const d of submittedItems) {
        const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;margin-bottom:4px;background:var(--row-alt)' } });
        row.appendChild(el('span', { cls: 'chip ok', text: '已提交' }));
        const fileSpan = el('span', { text: d.note || '—', attrs: { style: 'flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;min-width:0' } });
        fileSpan.title = d.note || '—';
        row.appendChild(fileSpan);
        if (d.note && isElectron) {
          const openFileBtn = el('button', { cls: 'btn sm ghost', text: '📄', attrs: { type: 'button', title: `打开文件 ${d.note}` } });
          openFileBtn.addEventListener('click', async (e) => { e.stopPropagation(); if (!(await requireRepo())) return; await store.openDeliverableSpecificFile(t.id, name, d.note!); });
          row.appendChild(openFileBtn);
        }
        row.appendChild(el('span', { text: d.time, attrs: { style: 'color:var(--dim);font-size:11px;flex:0 0 auto' } }));
        row.addEventListener('click', async () => {
          if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
          if (!(await requireRepo())) return;
          if (d.note) await store.openDeliverableSpecificFile(t.id, name, d.note);
          else await store.openDeliverableFile(t.id, name);
        });
        const delBtn = el('button', { cls: 'btn sm danger', text: '×', attrs: { type: 'button', style: 'flex:0 0 auto;padding:2px 6px' } });
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!await confirmDialog('删除确认', '确定删除该提交记录？')) return;
          if (d.note && isElectron) await store.deleteDeliverableFiles(t.id, name, false, d.note);
          await set(get().filter((x) => x.id !== d.id));
          renderPopup();
        });
        row.appendChild(delBtn);
        card.appendChild(row);
      }

      for (const d of pendingItems) {
        const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;margin-bottom:4px;background:var(--row-alt)' } });
        row.appendChild(el('span', { cls: 'chip dim', text: '待提交' }));
        const fileSpan = el('span', { text: d.note || '—', attrs: { style: 'flex:1;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;min-width:0' } });
        fileSpan.title = d.note || '—';
        row.appendChild(fileSpan);
        if (isElectron) {
          const openFolderBtn = el('button', { cls: 'btn sm ghost', text: '📂', attrs: { type: 'button', title: '打开文件夹' } });
          openFolderBtn.addEventListener('click', async (e) => { e.stopPropagation(); if (!(await requireRepo())) return; await store.openDeliverableFile(t.id, name); });
          row.appendChild(openFolderBtn);
        }
        row.appendChild(el('span', { text: '未提交', attrs: { style: 'color:var(--dim);font-size:11px;flex:0 0 auto' } }));
        const delBtn = el('button', { cls: 'btn sm danger', text: '×', attrs: { type: 'button', style: 'flex:0 0 auto;padding:2px 6px' } });
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!await confirmDialog('删除确认', `确定删除交付物「${d.name}」？`)) return;
          await set(get().filter((x) => x.id !== d.id));
          renderPopup();
        });
        row.appendChild(delBtn);
        card.appendChild(row);
      }
      m.body.appendChild(card);
    }

    // 其他交付物
    if (!filterName) {
      const unassigned = all.filter((d) => d.name === '__unassigned__');
      if (unassigned.length) {
        const card = el('div', { attrs: { style: 'border:1px dashed var(--weak-line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--card)' } });
        const cardHead = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' } });
        cardHead.appendChild(el('span', { attrs: { style: 'font-weight:600;color:var(--dim);font-size:13.5px' }, text: `其他交付物（${unassigned.length}）` }));
        card.appendChild(cardHead);
        for (const d of unassigned) {
          const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;margin-bottom:4px;background:var(--row-alt);cursor:pointer' } });
          row.appendChild(el('span', { cls: 'chip ok', text: '已提交' }));
          const fileSpan = el('span', { text: d.note || '—', attrs: { style: 'flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;min-width:0' } });
          fileSpan.title = d.note || '—';
          row.appendChild(fileSpan);
          if (d.note && isElectron) {
            const openFileBtn = el('button', { cls: 'btn sm ghost', text: '📄', attrs: { type: 'button', title: `打开文件 ${d.note}` } });
            openFileBtn.addEventListener('click', async (e) => { e.stopPropagation(); if (!(await requireRepo())) return; await store.openDeliverableSpecificFile(t.id, '__unassigned__', d.note!); });
            row.appendChild(openFileBtn);
          }
          row.appendChild(el('span', { text: d.time, attrs: { style: 'color:var(--dim);font-size:11px;flex:0 0 auto' } }));
          row.addEventListener('click', async () => {
            if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
            if (!(await requireRepo())) return;
            if (d.note) await store.openDeliverableSpecificFile(t.id, '__unassigned__', d.note);
            else await store.openDeliverableFile(t.id, '__unassigned__');
          });
          const delBtn = el('button', { cls: 'btn sm danger', text: '×', attrs: { type: 'button', style: 'flex:0 0 auto;padding:2px 6px' } });
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!await confirmDialog('删除确认', '确定删除该文件记录？')) return;
            await set(get().filter((x) => x.id !== d.id));
            renderPopup();
          });
          row.appendChild(delBtn);
          card.appendChild(row);
        }
        m.body.appendChild(card);
      }
    }

    // 底部按钮
    const freshAll = get();
    const allNames = [...new Set(freshAll.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
    if (!filterName && allNames.length) {
      const batchDelBtn = el('button', { cls: 'btn sm danger', text: '🗑 批量删除所有交付物', attrs: { type: 'button' } });
      batchDelBtn.addEventListener('click', async () => {
        if (!await confirmDialog('批量删除', '确定删除该任务的所有交付物及对应文件？此操作不可恢复！')) return;
        if (isElectron) {
          for (const n of allNames) await store.deleteDeliverableFiles(t.id, n, true);
          await store.deleteDeliverableFiles(t.id, '__unassigned__', true);
        }
        await set([]);
        toast('已删除所有交付物');
        renderPopup();
      });
      m.foot.appendChild(batchDelBtn);
    }
    const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
    closeBtn.addEventListener('click', () => m.close());
    m.foot.appendChild(closeBtn);
  }

  renderPopup();
}

/* ---- 阶段 ---- */
export function openPhaseModal(phase?: Phase): void {
  if (!curProject()) {
    toast('请先创建项目', 'warn');
    return;
  }
  const m = openModal(phase ? '编辑阶段' : '新增阶段');
  const form = buildForm(
    [
      { key: 'name', label: '阶段名称', type: 'text', required: true, placeholder: '如：需求评审' },
      { key: 'tip', label: '阶段提示', type: 'textarea', full: true, placeholder: '说明该阶段要执行什么任务、怎么系统性有机地完成各项任务' }
    ],
    phase ? { ...phase } : {}
  );
  m.body.appendChild(form.root);

  // 交付物管理（编辑阶段时可用）
  let deliverableChanges: Array<{ action: 'add' | 'delete' | 'rename'; taskId: string; name: string; newName?: string; note?: string }> = [];
  const currentDeliverables: Map<string, Deliverable[]> = new Map();

  if (phase) {
    const phaseTasks = projectTasks().filter((t) => t.phaseId === phase.id);
    for (const t of phaseTasks) {
      currentDeliverables.set(t.id, t.deliverables.map((d) => ({ ...d })));
    }

    // 交付物管理容器 - 增加间距
    const dSection = el('div', { cls: 'phase-dlib-section', attrs: { style: 'margin-top:28px;padding-top:20px;' } });
    const header = el('div', { cls: 'phase-dlib-header' });
    header.appendChild(el('h4', { text: '交付物管理' }));
    header.appendChild(el('span', { cls: 'hint', text: '保存阶段时生效' }));
    dSection.appendChild(header);

    // 任务筛选 - 单独一行，增加上下间距
    const filterRow = el('div', { cls: 'phase-dlib-filter', attrs: { style: 'margin-bottom:16px;padding:10px 12px;background:var(--row-alt);border-radius:8px;display:flex;align-items:center;gap:12px;' } });
    filterRow.appendChild(el('span', { attrs: { style: 'font-size:13px;color:var(--txt2);white-space:nowrap;' }, text: '按任务筛选：' }));
    const taskFilter = el('select', { attrs: { title: '按任务筛选交付物', style: 'flex:1;' } }) as HTMLSelectElement;
    taskFilter.appendChild(el('option', { text: '全部任务', attrs: { value: '' } }));
    for (const t of phaseTasks) {
      taskFilter.appendChild(el('option', { text: t.title, attrs: { value: t.id } }));
    }
    filterRow.appendChild(taskFilter);
    
    // 删除全部交付物按钮
    const deleteAllBtn = el('button', { cls: 'btn sm danger', text: '删除全部交付物', attrs: { type: 'button', style: 'white-space:nowrap;' } });
    deleteAllBtn.addEventListener('click', async () => {
      const allDeliverables: string[] = [];
      for (const t of phaseTasks) {
        const deliverables = currentDeliverables.get(t.id) || [];
        const uniqueNames = [...new Set(deliverables.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
        allDeliverables.push(...uniqueNames);
      }
      const uniqueAll = [...new Set(allDeliverables)];
      if (!uniqueAll.length) {
        toast('该阶段暂无交付物', 'warn');
        return;
      }
      const ok = await confirmDialog(
        '删除全部交付物',
        `确定删除该阶段下所有 ${uniqueAll.length} 个交付物及其提交记录？此操作不可恢复！`
      );
      if (!ok) return;
      
      // 清空所有任务的交付物
      for (const t of phaseTasks) {
        deliverableChanges.push({ action: 'delete', taskId: t.id, name: '__all__' });
        currentDeliverables.set(t.id, []);
      }
      toast('已删除全部交付物');
      renderDeliverableList();
    });
    filterRow.appendChild(deleteAllBtn);
    
    dSection.appendChild(filterRow);

    // 交付物列表
    const listWrap = el('div', { cls: 'phase-dlib-list' });
    dSection.appendChild(listWrap);

    function renderDeliverableList(): void {
      clear(listWrap);
      const filterId = taskFilter.value;
      let hasAny = false;

      for (const t of phaseTasks) {
        if (filterId && t.id !== filterId) continue;
        const deliverables = currentDeliverables.get(t.id) || [];
        const uniqueNames = [...new Set(deliverables.map((d) => d.name).filter((n) => n && n !== '__unassigned__'))];
        if (!uniqueNames.length) continue;
        hasAny = true;

        const taskGroup = el('div', { cls: 'phase-dlib-task' });
        const taskName = el('div', { cls: 'phase-dlib-task-name' });
        taskName.appendChild(el('span', { text: t.title }));
        taskName.appendChild(el('span', { cls: 'phase-dlib-task-cnt', text: `${uniqueNames.length} 项` }));
        taskGroup.appendChild(taskName);

        for (const name of uniqueNames) {
          const items = deliverables.filter((d) => d.name === name);
          const row = el('div', { cls: 'phase-dlib-item' });
          const nameSpan = el('span', { cls: 'phase-dlib-item-name', text: name });
          nameSpan.title = '点击编辑名称';
          nameSpan.addEventListener('click', () => {
            const newName = prompt('修改交付物名称：', name);
            if (newName && newName.trim() && newName.trim() !== name) {
              deliverableChanges.push({ action: 'rename', taskId: t.id, name, newName: newName.trim() });
              const updated = (currentDeliverables.get(t.id) || []).map((d) => d.name === name ? { ...d, name: newName.trim() } : d);
              currentDeliverables.set(t.id, updated);
              renderDeliverableList();
            }
          });
          row.appendChild(nameSpan);
          row.appendChild(el('span', { cls: `chip ${items.some((d) => d.accepted) ? 'ok' : 'dim'}`, text: `${items.length} 条` }));
          const delBtn = el('button', { cls: 'btn sm danger', text: '×', attrs: { type: 'button' } });
          delBtn.addEventListener('click', async () => {
            if (!await confirmDialog('删除交付物', `确定删除「${name}」及其所有提交记录？`)) return;
            deliverableChanges.push({ action: 'delete', taskId: t.id, name });
            const updated = (currentDeliverables.get(t.id) || []).filter((d) => d.name !== name);
            currentDeliverables.set(t.id, updated);
            renderDeliverableList();
          });
          row.appendChild(delBtn);
          taskGroup.appendChild(row);
        }
        listWrap.appendChild(taskGroup);
      }

      if (!hasAny) {
        listWrap.appendChild(el('div', { cls: 'phase-dlib-empty', text: '该阶段暂无交付物' }));
      }
    }

    renderDeliverableList();
    taskFilter.addEventListener('change', renderDeliverableList);

    const addForm = el('div', { cls: 'phase-dlib-add-form' });
    const taskSel = el('select', { attrs: { title: '选择任务' } }) as HTMLSelectElement;
    for (const t of phaseTasks) {
      taskSel.appendChild(el('option', { text: t.title, attrs: { value: t.id } }));
    }
    const nameIn = el('input', { attrs: { type: 'text', placeholder: '交付物名称' } }) as HTMLInputElement;
    const noteIn = el('input', { attrs: { type: 'text', placeholder: '备注（可选）' } }) as HTMLInputElement;
    const addBtn = el('button', { cls: 'btn sm primary', text: '＋ 添加', attrs: { type: 'button' } });
    addBtn.addEventListener('click', () => {
      const taskId = taskSel.value;
      const dName = nameIn.value.trim();
      if (!taskId) { toast('请选择任务', 'warn'); return; }
      if (!dName) { toast('请填写交付物名称', 'warn'); nameIn.focus(); return; }
      const newDel: Deliverable = { id: uid('dl'), name: dName, note: noteIn.value.trim(), time: '', accepted: false };
      const existing = currentDeliverables.get(taskId) || [];
      currentDeliverables.set(taskId, [...existing, newDel]);
      deliverableChanges.push({ action: 'add', taskId, name: dName, note: noteIn.value.trim() });
      nameIn.value = '';
      noteIn.value = '';
      renderDeliverableList();
    });
    addForm.append(taskSel, nameIn, noteIn, addBtn);
    dSection.appendChild(addForm);
    m.body.appendChild(dSection);
  }

  const submit = el('button', { cls: 'btn primary', text: phase ? '保存' : '创建阶段', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    if (phase) {
      await store.update('phase', phase.id, { name: String(v.name), tip: String(v.tip || '') });
      // 应用交付物变更到对应任务
      for (const change of deliverableChanges) {
        const task = state.data?.tasks.find((t) => t.id === change.taskId);
        if (!task) continue;
        let newDeliverables: Deliverable[];
        if (change.action === 'add') {
          newDeliverables = [...task.deliverables, { id: uid('dl'), name: change.name, note: change.note || '', time: '', accepted: false }];
        } else if (change.action === 'delete') {
          // 处理删除全部交付物的情况
          if (change.name === '__all__') {
            newDeliverables = [];
          } else {
            newDeliverables = task.deliverables.filter((d) => d.name !== change.name);
          }
        } else if (change.action === 'rename') {
          newDeliverables = task.deliverables.map((d) => d.name === change.name ? { ...d, name: change.newName! } : d);
        } else {
          continue;
        }
        await store.update('task', change.taskId, { deliverables: newDeliverables });
      }
      toast('阶段已更新');
    } else {
      const order = projectPhases().length + 1;
      await store.create('phase', { projectId: state.projectId, name: String(v.name), order, tip: String(v.tip || '') });
      toast('阶段已创建');
    }
    m.close();
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

