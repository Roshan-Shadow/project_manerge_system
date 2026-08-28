import { Bug, BugSeverity, BugStatus, Priority } from '../../shared/types.js';
import { DAY, parseDate, todayMs, todayStr } from '../../shared/date.js';
import { store } from '../core/store.js';
import { refreshAll } from '../core/app.js';
import { buildForm, clear, confirmDialog, el, openModal, toast } from '../core/dom.js';
import { curProject, projectBugs, projectReqs, projectTasks, state } from '../core/state.js';

/* ============ 缺陷：登记 / 处理跟踪 / SLA 超期预警 / 统计 ============ */

const BUG_STATUSES: BugStatus[] = ['新建', '已确认', '处理中', '待验证', '已关闭', '非缺陷', '重复', '延期处理'];
const SEVERITIES: BugSeverity[] = ['致命', '严重', '一般', '轻微'];
const PRIORITIES: Priority[] = ['P0', 'P1', 'P2'];
/** BUG-06 SLA（天）：按严重程度 */
const SLA: Record<BugSeverity, number> = { 致命: 1, 严重: 2, 一般: 4, 轻微: 7 };
const SEV_CHIP: Record<string, string> = { 致命: 'red', 严重: 'orange', 一般: 'gold', 轻微: 'dim' };
const OPEN_SET = ['新建', '已确认', '处理中', '待验证', '延期处理'];

let searchQ = '';
let statusFilter = '全部';
const sel = new Set<string>();

export function renderBug(root: HTMLElement): void {
  const prj = curProject();
  const bar = el('div', { cls: 'tool-bar' });
  const search = el('input', { attrs: { type: 'search', placeholder: '搜索缺陷 / 处理人…' } }) as HTMLInputElement;
  search.value = searchQ;
  search.addEventListener('input', () => {
    searchQ = search.value.trim();
    renderTable();
  });
  const statusSel = el('select', { attrs: { title: '按状态筛选' } }) as HTMLSelectElement;
  for (const s of ['全部', ...BUG_STATUSES]) statusSel.appendChild(el('option', { text: s, attrs: { value: s } }));
  statusSel.value = statusFilter;
  statusSel.addEventListener('change', () => {
    statusFilter = statusSel.value;
    renderTable();
  });
  bar.append(search, statusSel, el('span', { cls: 'spacer' }));
  const add = el('button', { cls: 'btn primary', text: '＋ 登记缺陷', attrs: { type: 'button' } });
  add.addEventListener('click', () => {
    if (!curProject()) { toast('请先创建项目', 'warn'); return; }
    if (!projectTasks().length) { toast('请先在计划中创建任务', 'warn'); return; }
    openBugModal();
  });
  bar.appendChild(add);
  root.appendChild(bar);

  const batchSlot = el('div');
  root.appendChild(batchSlot);
  const card = el('div', { cls: 'glass panel table-card' });
  const scroll = el('div', { cls: 'table-scroll' });
  card.appendChild(scroll);
  root.appendChild(card);

  function renderTable(): void {
    drawTable(scroll, batchSlot, prj !== null);
  }
  renderTable();
}

function isOpenBug(b: Bug): boolean {
  return OPEN_SET.includes(b.status);
}

function drawTable(scroll: HTMLElement, batchSlot: HTMLElement, hasProject: boolean): void {
  clear(scroll);
  clear(batchSlot);
  const existing = new Set(projectBugs().map((b) => b.id));
  for (const id of Array.from(sel)) if (!existing.has(id)) sel.delete(id);

  if (!hasProject) {
    scroll.appendChild(el('div', { cls: 'empty-tip', html: '暂无项目 —— 请先点击右上角【<b>新建项目</b>】创建项目' }));
    return;
  }

  const filtered = projectBugs().filter((b) => {
    if (statusFilter !== '全部' && b.status !== statusFilter) return false;
    if (searchQ && !`${b.title}${b.handler}`.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  if (sel.size) {
    const bar = el('div', { cls: 'batch-bar' });
    const del = el('button', { cls: 'btn sm danger', text: `批量删除（${sel.size}）`, attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('批量删除缺陷', `确认删除已选中的 ${sel.size} 条缺陷？删除后不可恢复。`);
      if (!ok) return;
      await store.remove('bug', Array.from(sel));
      sel.clear();
      toast('已删除缺陷');
      await refreshAll();
    });
    const cancel = el('button', { cls: 'btn sm ghost', text: '取消选择', attrs: { type: 'button' } });
    cancel.addEventListener('click', () => {
      sel.clear();
      redraw();
    });
    bar.append(el('span', { text: `已选择 ${sel.size} 项` }), del, cancel);
    batchSlot.appendChild(bar);
  }

  const table = el('table', { cls: 'pms-table' }) as HTMLTableElement;
  const thead = el('thead');
  const hr = el('tr');
  const allCb = el('input', { attrs: { type: 'checkbox', title: '全选 / 取消全选' } }) as HTMLInputElement;
  allCb.checked = filtered.length > 0 && filtered.every((b) => sel.has(b.id));
  allCb.addEventListener('change', () => {
    for (const b of filtered) {
      if (allCb.checked) sel.add(b.id);
      else sel.delete(b.id);
    }
    redraw();
  });
  const cbCell = el('th');
  cbCell.appendChild(allCb);
  hr.append(cbCell, el('th', { text: '缺陷标题' }), el('th', { text: '严重程度' }), el('th', { text: '优先级' }), el('th', { text: '处理人' }), el('th', { text: '状态' }), el('th', { text: 'SLA' }), el('th', { text: '创建' }), el('th', { text: '操作' }));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');

  if (!filtered.length) {
    const r = el('tr');
    const c = el('td');
    c.colSpan = 9;
    c.appendChild(el('div', { cls: 'empty-tip', html: '暂无缺陷数据 —— 点击【<b>＋ 登记缺陷</b>】登记第一条缺陷' }));
    r.appendChild(c);
    tbody.appendChild(r);
  }

  const t0 = todayMs();
  const reqs = projectReqs();
  for (const bug of filtered) {
    const tr = el('tr') as HTMLTableRowElement;
    const slaDays = SLA[bug.severity];
    const ageDays = bug.createdAt ? Math.round((t0 - parseDate(bug.createdAt)) / DAY) : 0;
    const overDays = ageDays - slaDays;
    const overdue = isOpenBug(bug) && overDays > 0;
    if (overdue) tr.setAttribute('style', 'background:rgba(255,82,82,.05)');

    const cb = el('input', { attrs: { type: 'checkbox', title: '选中以批量删除' } }) as HTMLInputElement;
    cb.checked = sel.has(bug.id);
    cb.addEventListener('change', () => {
      if (cb.checked) sel.add(bug.id);
      else sel.delete(bug.id);
      redraw();
    });
    const cbTd = el('td');
    cbTd.appendChild(cb);
    tr.appendChild(cbTd);
    const titleTd = el('td');
    const linkedReq = reqs.find((r) => r.id === bug.linkReqId);
    titleTd.appendChild(el('div', { cls: 'cell-title', text: bug.title, title: `${bug.desc || ''}${bug.steps ? '\n复现：' + bug.steps : ''}` }));
    if (linkedReq) titleTd.appendChild(el('div', { cls: 'cell-dim', text: `关联需求：${linkedReq.title}` }));
    tr.appendChild(titleTd);
    tr.appendChild(td(el('span', { cls: `chip ${SEV_CHIP[bug.severity]}`, text: bug.severity })));
    tr.appendChild(td(el('span', { cls: `chip ${bug.priority.toLowerCase()}`, text: bug.priority })));
    tr.appendChild(tdText(bug.handler || '未指派'));
    const stTd = el('td');
    const stSel = el('select', { cls: 'inline-sel', title: '状态流转（BUG-02）' }) as HTMLSelectElement;
    for (const s of BUG_STATUSES) stSel.appendChild(el('option', { text: s, attrs: { value: s } }));
    stSel.value = bug.status;
    stSel.addEventListener('change', async () => {
      const patch: Record<string, unknown> = { status: stSel.value };
      if (stSel.value === '已关闭') patch.closedAt = todayStr();
      await store.update('bug', bug.id, patch);
      toast(`「${bug.title}」状态 → ${stSel.value}`);
      await refreshAll();
    });
    stTd.appendChild(stSel);
    tr.appendChild(stTd);
    const slaTd = el('td');
    if (overdue) {
      slaTd.appendChild(el('span', { cls: 'chip red alert-pulse', text: `超期 ${overDays} 天`, title: `SLA ${slaDays} 天（按严重程度）` }));
    } else if (isOpenBug(bug)) {
      slaTd.appendChild(el('span', { cls: 'cell-dim', text: `剩 ${Math.max(slaDays - ageDays, 0)} 天` }));
    } else {
      slaTd.appendChild(el('span', { cls: 'cell-dim', text: bug.closedAt ? `已关闭` : '—' }));
    }
    tr.appendChild(slaTd);
    tr.appendChild(tdText(bug.createdAt ? bug.createdAt.slice(5) : '—'));
    const opTd = el('td');
    const edit = el('button', { cls: 'btn sm ghost', text: '编辑', attrs: { type: 'button' } });
    edit.addEventListener('click', () => openBugModal(bug));
    const del = el('button', { cls: 'btn sm ghost', text: '删除', attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('删除缺陷', `确认删除缺陷「${bug.title}」？删除后不可恢复。`);
      if (!ok) return;
      await store.remove('bug', [bug.id]);
      toast('缺陷已删除');
      await refreshAll();
    });
    opTd.append(edit, del);
    tr.appendChild(opTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);

  function redraw(): void {
    drawTable(scroll, batchSlot, hasProject);
  }
}

function td(n: HTMLElement): HTMLTableCellElement {
  const c = el('td');
  c.appendChild(n);
  return c;
}
function tdText(s: string): HTMLTableCellElement {
  return td(el('span', { text: s }));
}

function openBugModal(bug?: Bug): void {
  if (!curProject()) {
    toast('请先创建项目', 'warn');
    return;
  }
  const reqs = projectReqs();
  const m = openModal(bug ? '编辑缺陷' : '登记缺陷');
  const form = buildForm(
    [
      { key: 'title', label: '缺陷标题', type: 'text', required: true, full: true, placeholder: '如：登录页验证码不刷新' },
      { key: 'severity', label: '严重程度', type: 'select', options: SEVERITIES.map((s) => ({ value: s, label: s })), hint: 'SLA：致命1天 / 严重2天 / 一般4天 / 轻微7天' },
      { key: 'priority', label: '优先级', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
      { key: 'status', label: '状态', type: 'select', options: BUG_STATUSES.map((s) => ({ value: s, label: s })) },
      { key: 'handler', label: '处理人', type: 'text', required: true, placeholder: '如：王五' },
      { key: 'createdAt', label: '发现日期', type: 'date', required: true },
      {
        key: 'linkReqId',
        label: '关联需求（可选）',
        type: 'select',
        options: [{ value: '', label: '不关联' }, ...reqs.map((r) => ({ value: r.id, label: r.title }))]
      },
      { key: 'steps', label: '复现步骤', type: 'textarea', full: true, placeholder: '1. … 2. … 3. …（可选）' },
      { key: 'desc', label: '补充说明', type: 'textarea', full: true, placeholder: '环境 / 截图说明等（可选）' }
    ],
    bug ? { ...bug } : { severity: '一般', priority: 'P1', status: '新建', createdAt: todayStr() }
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: bug ? '保存' : '登记缺陷', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const payload = {
      projectId: state.projectId,
      title: String(v.title),
      desc: String(v.desc || ''),
      steps: String(v.steps || ''),
      severity: String(v.severity) as BugSeverity,
      priority: String(v.priority) as Priority,
      status: String(v.status) as BugStatus,
      handler: String(v.handler),
      createdAt: String(v.createdAt),
      closedAt: String(v.status) === '已关闭' ? (bug?.closedAt || todayStr()) : (bug?.closedAt || ''),
      linkReqId: String(v.linkReqId || '')
    };
    if (bug) {
      await store.update('bug', bug.id, payload);
      toast('缺陷已更新');
    } else {
      await store.create('bug', payload);
      toast('缺陷已登记');
    }
    m.close();
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}
