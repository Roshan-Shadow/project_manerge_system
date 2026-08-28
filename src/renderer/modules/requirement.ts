import { Priority, ReqStatus, ReqType, Requirement, Task } from '../../shared/types.js';
import { todayStr } from '../../shared/date.js';
import { store } from '../core/store.js';
import { refreshAll } from '../core/app.js';
import { buildForm, clear, confirmDialog, el, openModal, toast } from '../core/dom.js';
import { curProject, projectReqs, projectTasks, state } from '../core/state.js';

/* ============ 需求：需求池 / 状态流转 / 优先级 / 拆解关联任务 ============ */

const REQ_STATUSES: ReqStatus[] = ['草稿', '已评审', '已排期', '开发中', '已交付', '已拒绝'];
const REQ_TYPES: ReqType[] = ['功能', '优化', '技术'];
const PRIORITIES: Priority[] = ['P0', 'P1', 'P2'];
const ST_CHIP: Record<string, string> = {
  草稿: 'dim',
  已评审: 'info',
  已排期: 'gold',
  开发中: 'orange',
  已交付: 'ok',
  已拒绝: 'dim'
};

let searchQ = '';
let statusFilter = '全部';
const sel = new Set<string>();

export function renderRequirement(root: HTMLElement): void {
  const prj = curProject();
  const bar = el('div', { cls: 'tool-bar' });
  const search = el('input', { attrs: { type: 'search', placeholder: '搜索需求 / 提出人…' } }) as HTMLInputElement;
  search.value = searchQ;
  search.addEventListener('input', () => {
    searchQ = search.value.trim();
    renderTable();
  });
  const statusSel = el('select', { attrs: { title: '按状态筛选' } }) as HTMLSelectElement;
  for (const s of ['全部', ...REQ_STATUSES]) statusSel.appendChild(el('option', { text: s, attrs: { value: s } }));
  statusSel.value = statusFilter;
  statusSel.addEventListener('change', () => {
    statusFilter = statusSel.value;
    renderTable();
  });
  bar.append(search, statusSel, el('span', { cls: 'spacer' }));
  const add = el('button', { cls: 'btn primary', text: '＋ 新增需求', attrs: { type: 'button' } });
  add.addEventListener('click', () => {
    if (!curProject()) { toast('请先创建项目', 'warn'); return; }
    if (!projectTasks().length) { toast('请先在计划中创建任务', 'warn'); return; }
    openReqModal();
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

function drawTable(scroll: HTMLElement, batchSlot: HTMLElement, hasProject: boolean): void {
  clear(scroll);
  clear(batchSlot);
  const existing = new Set(projectReqs().map((r) => r.id));
  for (const id of Array.from(sel)) if (!existing.has(id)) sel.delete(id);

  if (!hasProject) {
    scroll.appendChild(el('div', { cls: 'empty-tip', html: '暂无项目 —— 请先点击右上角【<b>新建项目</b>】创建项目' }));
    return;
  }

  const tasks = projectTasks();
  const filtered = projectReqs().filter((r) => {
    if (statusFilter !== '全部' && r.status !== statusFilter) return false;
    if (searchQ && !`${r.title}${r.proposer}`.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  if (sel.size) {
    const bar = el('div', { cls: 'batch-bar' });
    const del = el('button', { cls: 'btn sm danger', text: `批量删除（${sel.size}）`, attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('批量删除需求', `确认删除已选中的 ${sel.size} 条需求？删除后不可恢复。`);
      if (!ok) return;
      await store.remove('requirement', Array.from(sel));
      sel.clear();
      toast('已删除需求');
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
  allCb.checked = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  allCb.addEventListener('change', () => {
    for (const r of filtered) {
      if (allCb.checked) sel.add(r.id);
      else sel.delete(r.id);
    }
    redraw();
  });
  const cbCell = el('th');
  cbCell.appendChild(allCb);
  hr.append(cbCell, el('th', { text: '需求标题' }), el('th', { text: '所属项目' }), el('th', { text: '类型' }), el('th', { text: '优先级' }), el('th', { text: '提出人' }), el('th', { text: '状态' }), el('th', { text: '关联任务' }), el('th', { text: '创建日期' }), el('th', { text: '操作' }));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');

  if (!filtered.length) {
    const r = el('tr');
    const c = el('td');
    c.colSpan = 10;
    c.appendChild(el('div', { cls: 'empty-tip', html: '暂无需求数据 —— 点击【<b>＋ 新增需求</b>】创建第一条需求' }));
    r.appendChild(c);
    tbody.appendChild(r);
  }

  for (const req of filtered) {
    const tr = el('tr') as HTMLTableRowElement;
    const cb = el('input', { attrs: { type: 'checkbox', title: '选中以批量删除' } }) as HTMLInputElement;
    cb.checked = sel.has(req.id);
    cb.addEventListener('change', () => {
      if (cb.checked) sel.add(req.id);
      else sel.delete(req.id);
      redraw();
    });
    const cbTd = el('td');
    cbTd.appendChild(cb);
    tr.appendChild(cbTd);
    tr.appendChild(td(el('div', { cls: 'cell-title', text: req.title, title: req.desc || req.title })));
    // 所属项目
    const projName = (state.data?.projects || []).find((p) => p.id === req.projectId)?.name || '—';
    const projBtn = el('button', {
      cls: 'btn sm ghost',
      text: projName.length > 10 ? projName.slice(0, 10) + '…' : projName,
      attrs: { type: 'button', style: 'max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left', title: '点击查看完整项目名称' }
    });
    projBtn.addEventListener('click', () => {
      const pm = openModal('所属项目');
      pm.body.appendChild(el('div', { attrs: { style: 'padding:12px;font-size:14px' }, text: projName }));
      const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
      closeBtn.addEventListener('click', () => pm.close());
      pm.foot.appendChild(closeBtn);
    });
    tr.appendChild(td(projBtn));
    tr.appendChild(tdText(req.type));
    tr.appendChild(td(el('span', { cls: `chip ${req.priority.toLowerCase()}`, text: req.priority })));
    tr.appendChild(tdText(req.proposer || '—'));
    const stTd = el('td');
    const stSel = el('select', { cls: 'inline-sel', title: '状态流转（REQ-02）' }) as HTMLSelectElement;
    for (const s of REQ_STATUSES) stSel.appendChild(el('option', { text: s, attrs: { value: s } }));
    stSel.value = req.status;
    stSel.addEventListener('change', async () => {
      await store.update('requirement', req.id, { status: stSel.value });
      toast(`「${req.title}」状态 → ${stSel.value}`);
      await refreshAll();
    });
    stTd.appendChild(stSel);
    tr.appendChild(stTd);
    const linkTd = el('td');
    const linked = tasks.filter((t) => (req.taskIds || []).includes(t.id));
    if (linked.length) {
      const names = linked.map((t) => t.title).join('、');
      const truncated = names.length > 20 ? names.slice(0, 20) + '…' : names;
      const linkBtn = el('button', {
        cls: 'btn sm ghost',
        text: truncated,
        attrs: { type: 'button', style: 'max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left', title: `点击查看全部关联任务（共 ${linked.length} 个）` }
      });
      linkBtn.addEventListener('click', () => showLinkedTasks(req, tasks));
      linkTd.appendChild(linkBtn);
    } else {
      linkTd.appendChild(el('span', { cls: 'cell-dim', text: '无' }));
    }
    tr.appendChild(linkTd);
    tr.appendChild(tdText(req.createdAt ? req.createdAt.slice(5) : '—'));
    const opTd = el('td');
    const edit = el('button', { cls: 'btn sm ghost', text: '编辑', attrs: { type: 'button' } });
    edit.addEventListener('click', () => openReqModal(req));
    const del = el('button', { cls: 'btn sm ghost', text: '删除', attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('删除需求', `确认删除需求「${req.title}」？删除后不可恢复。`);
      if (!ok) return;
      await store.remove('requirement', [req.id]);
      toast('需求已删除');
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

function showLinkedTasks(req: Requirement, tasks: Task[]): void {
  const m = openModal(`关联任务 · ${req.title}`);
  const linked = tasks.filter((t) => (req.taskIds || []).includes(t.id));
  if (!linked.length) {
    m.body.appendChild(el('div', { cls: 'empty-tip', text: '尚未关联任务 —— 编辑需求时可勾选关联任务（REQ-04 需求拆解）' }));
  } else {
    for (const t of linked) {
      const row = el('div', { cls: 'md-row', attrs: { style: 'display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px dashed var(--row-line)' } });
      row.append(el('span', { text: t.title }), el('span', { text: `${t.status} · ${t.progress}%`, attrs: { style: 'color:var(--dim)' } }));
      m.body.appendChild(row);
    }
  }
  const close = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  close.addEventListener('click', () => m.close());
  m.foot.appendChild(close);
}

function openReqModal(req?: Requirement): void {
  if (!curProject()) {
    toast('请先创建项目', 'warn');
    return;
  }
  const tasks = projectTasks();
  const m = openModal(req ? '编辑需求' : '新增需求');
  const form = buildForm(
    [
      { key: 'title', label: '需求标题', type: 'text', required: true, full: true, placeholder: '如：支持手机号快捷登录' },
      { key: 'type', label: '类型', type: 'select', options: REQ_TYPES.map((t) => ({ value: t, label: t })) },
      { key: 'priority', label: '优先级', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
      { key: 'status', label: '状态', type: 'select', options: REQ_STATUSES.map((s) => ({ value: s, label: s })) },
      { key: 'proposer', label: '提出人', type: 'text', required: true, placeholder: '如：产品经理' },
      { key: 'createdAt', label: '提出日期', type: 'date', required: true },
      {
        key: 'taskIds',
        label: '关联任务（需求拆解，REQ-04）',
        type: 'multiselect',
        full: true,
        options: tasks.map((t) => ({ value: t.id, label: `${t.title}（${t.status}）` })),
        hint: '勾选后可在需求详情查看关联任务进度'
      },
      { key: 'desc', label: '需求描述', type: 'textarea', full: true, placeholder: '背景 / 目标 / 验收要点（可选）' }
    ],
    req ? { ...req } : { type: '功能', priority: 'P1', status: '草稿', createdAt: todayStr() }
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: req ? '保存' : '创建需求', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const payload = {
      projectId: state.projectId,
      title: String(v.title),
      desc: String(v.desc || ''),
      proposer: String(v.proposer),
      type: String(v.type) as ReqType,
      priority: String(v.priority) as Priority,
      status: String(v.status) as ReqStatus,
      createdAt: String(v.createdAt),
      taskIds: (v.taskIds as string[]) || []
    };
    if (req) {
      await store.update('requirement', req.id, payload);
      toast('需求已更新');
    } else {
      await store.create('requirement', payload);
      toast('需求已创建');
    }
    m.close();
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}
