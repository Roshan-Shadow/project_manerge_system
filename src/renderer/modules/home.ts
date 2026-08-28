import { fmtDate, parseDate, todayMs } from '../../shared/date.js';
import { Project, Task } from '../../shared/types.js';
import { store, isElectron } from '../core/store.js';
import { openCreateProjectModal, refreshAll, switchTab, requireRepo } from '../core/app.js';
import { el, toast } from '../core/dom.js';
import { state, completionPct, isTaskOpen } from '../core/state.js';

/* ============ 主页（HOME-01~03）：全部项目概况卡片墙 + 三种排序 ============ */

type SortKey = 'created' | 'nextDeadline' | 'endDate';

let sortKey: SortKey = 'created';
let sortAsc = true;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'created', label: '按创建时间' },
  { value: 'nextDeadline', label: '按下一任务截止' },
  { value: 'endDate', label: '按最终完成时间' }
];

/** 项目下一个未完成任务截止日期（无则 null，排序时置于末尾） */
function nextDeadlineOf(tasks: Task[]): number | null {
  const ds = tasks.filter(isTaskOpen).map((t) => parseDate(t.endDate));
  return ds.length ? Math.min(...ds) : null;
}

function nextDeadlineTask(tasks: Task[]): Task | null {
  const open = tasks.filter(isTaskOpen);
  if (!open.length) return null;
  return open.reduce((a, b) => (parseDate(a.endDate) <= parseDate(b.endDate) ? a : b));
}

function sortProjects(projects: Project[], tasksByProject: Map<string, Task[]>): Project[] {
  const list = [...projects];
  const key = (p: Project): number => {
    if (sortKey === 'created') return new Date(p.createdAt || 0).getTime() || 0;
    if (sortKey === 'endDate') return parseDate(p.endDate);
    return nextDeadlineOf(tasksByProject.get(p.id) || []) ?? Number.MAX_SAFE_INTEGER;
  };
  list.sort((a, b) => (key(a) - key(b)) * (sortAsc ? 1 : -1));
  // 无下一截止的项目始终排末尾（与方向无关）
  if (sortKey === 'nextDeadline') {
    list.sort((a, b) => {
      const na = nextDeadlineOf(tasksByProject.get(a.id) || []) === null ? 1 : 0;
      const nb = nextDeadlineOf(tasksByProject.get(b.id) || []) === null ? 1 : 0;
      return na - nb;
    });
  }
  return list;
}

export function renderHome(root: HTMLElement): void {
  const projects = state.data?.projects || [];
  const tasksByProject = new Map<string, Task[]>();
  for (const t of state.data?.tasks || []) {
    const arr = tasksByProject.get(t.projectId) || [];
    arr.push(t);
    tasksByProject.set(t.projectId, arr);
  }

  const bar = el('div', { cls: 'tool-bar' });
  const count = el('span', { cls: 'cell-dim', text: `共 ${projects.length} 个项目` });
  const sortSel = el('select', { attrs: { title: '项目排序维度（HOME-02）' }, }) as HTMLSelectElement;
  for (const o of SORT_OPTIONS) sortSel.appendChild(el('option', { text: o.label, attrs: { value: o.value } }));
  sortSel.value = sortKey;
  sortSel.addEventListener('change', () => {
    sortKey = sortSel.value as SortKey;
    redraw();
  });
  const dirBtn = el('button', {
    cls: 'btn sm',
    text: sortAsc ? '↑ 升序' : '↓ 降序',
    attrs: { type: 'button' },
    title: '切换升序 / 降序'
  });
  dirBtn.addEventListener('click', () => {
    sortAsc = !sortAsc;
    redraw();
  });
  bar.append(count, sortSel, dirBtn, el('span', { cls: 'spacer' }));
  const addBtn = el('button', { cls: 'btn primary', text: '＋ 新建项目', attrs: { type: 'button' } });
  addBtn.addEventListener('click', async () => { if (await requireRepo()) openCreateProjectModal(); });
  bar.appendChild(addBtn);
  root.appendChild(bar);

  const grid = el('div', { cls: 'home-grid' });
  root.appendChild(grid);

  function redraw(): void {
    renderGrid();
    // 工具栏排序控件状态同步（不重建工具栏）
    dirBtn.textContent = sortAsc ? '↑ 升序' : '↓ 降序';
    sortSel.value = sortKey;
  }

  function renderGrid(): void {
    grid.innerHTML = '';
    if (!projects.length) {
      const empty = el('div', { cls: 'empty-tip', attrs: { style: 'grid-column:1/-1' } });
      empty.innerHTML = '暂无项目 —— 点击【<b>＋ 新建项目</b>】从模板创建，或右上角【<b>⇪ 导入项目</b>】迁移快照';
      grid.appendChild(empty);
      return;
    }
    const sorted = sortProjects(projects, tasksByProject);
    sorted.forEach((p, i) => {
      grid.appendChild(homeCard(p, tasksByProject.get(p.id) || [], i));
    });
  }
  renderGrid();
}

function homeCard(p: Project, tasks: Task[], idx: number): HTMLElement {
  const card = el('div', { cls: `home-card glass hover-lift idle-float stagger-${(idx % 4) + 1}`, title: '点击进入该项目' });
  const top = el('div', { cls: 'home-top' });
  top.appendChild(el('h4', { text: p.name }));
  const stChip: Record<string, string> = { 进行中: 'orange', 已完成: 'ok', 已暂停: 'dim' };
  top.appendChild(el('span', { cls: `chip ${stChip[p.status] || 'dim'}`, text: p.status }));
  if (state.projectId === p.id) top.appendChild(el('span', { cls: 'home-cur', text: '● 当前' }));
  card.appendChild(top);

  const t0 = todayMs();
  const done = tasks.filter((t) => t.status === '已完成').length;
  const overdue = tasks.filter((t) => isTaskOpen(t) && parseDate(t.endDate) < t0).length;
  const pct = completionPct(tasks);
  const nd = nextDeadlineTask(tasks);

  const rows = el('div', { cls: 'home-rows' });
  rows.appendChild(kv('负责人 / 成员', `${p.owner || '—'} / ${p.members.length || 1} 人`));
  rows.appendChild(kv('周期', `${p.startDate} ~ ${p.endDate}`));
  const progRow = el('div', { cls: 'hprog-row' });
  const mp = el('span', { cls: 'mini-progress', attrs: { style: 'width:120px' } });
  mp.appendChild(el('i', { attrs: { style: `width:${pct}%` } }));
  progRow.append(el('span', { text: '完成率', attrs: { style: 'color:var(--dim)' } }), mp, el('b', { text: `${pct}%` }));
  rows.appendChild(progRow);
  rows.appendChild(kv('任务', `已完成 ${done} / ${tasks.length}`));
  const odRow = kv('延期任务', overdue ? `${overdue} 个` : '无');
  if (overdue) odRow.querySelector('b')?.setAttribute('style', 'color:var(--err)');
  rows.appendChild(odRow);
  rows.appendChild(
    kv('下一截止', nd ? `${nd.title}（${fmtDate(parseDate(nd.endDate))}）` : '无未完成任务')
  );
  card.appendChild(rows);

  const actions = el('div', { cls: 'home-actions' });
  const enter = el('button', { cls: 'btn sm primary', text: '进入项目 →', attrs: { type: 'button' } });
  enter.addEventListener('click', (e) => {
    e.stopPropagation();
    void enterProject(p.id);
  });
  const repo = el('button', { cls: 'btn sm ghost', text: '📁 仓库', attrs: { type: 'button' }, title: '打开项目仓库（桌面版）' });
  repo.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isElectron) {
      toast('文件仓库仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    if (!(await store.openRepo(p.id))) toast('仓库打开失败', 'err');
  });
  const exp = el('button', { cls: 'btn sm ghost', text: '⇩ 快照', attrs: { type: 'button' }, title: '导出迁移快照（桌面版）' });
  exp.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isElectron) {
      toast('导入/导出仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    try {
      const file = await store.exportProject(p.id);
      if (file) toast(`已导出迁移文件：${file}`);
    } catch (err) {
      toast(`导出失败：${(err as Error).message}`, 'err');
    }
  });
  actions.append(enter, repo, exp);
  card.appendChild(actions);
  card.addEventListener('click', () => void enterProject(p.id));
  return card;
}

function kv(k: string, v: string): HTMLElement {
  const r = el('div');
  r.append(el('span', { text: `${k}：`, attrs: { style: 'color:var(--dim)' } }), el('b', { text: v }));
  return r;
}

async function enterProject(projectId: string): Promise<void> {
  state.projectId = projectId;
  await refreshAll(); // 更新头部项目选择 + 各视图
  await switchTab('dashboard');
}
