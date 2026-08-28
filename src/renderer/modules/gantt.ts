import { Phase, Task } from '../../shared/types.js';
import { DAY, fmtDate, parseDate, todayMs } from '../../shared/date.js';
import { store } from '../core/store.js';
import { refreshAll } from '../core/app.js';
import { clear, el, toast } from '../core/dom.js';
import { curProject, isTaskOpen, projectPhases, projectTasks } from '../core/state.js';
import { openTaskModal, openPhaseModal } from './plan.js';

/* ============ 甘特图：天/周/月视图 · 拖拽调期 · 今日线（GNT P0） ============ */

type Gran = 'day' | 'week' | 'month';
let gran: Gran = 'day';
let ownerFilter = '全部';
let statusFilter = '全部';
let gScroll = 0;
const collapsed = new Set<string>();

const PX: Record<Gran, number> = { day: 34, week: 12, month: 5 };

export function renderGantt(root: HTMLElement): void {
  const prj = curProject();
  const bar = el('div', { cls: 'tool-bar' });

  const segWrap = el('div', { cls: 'g-legend', attrs: { style: 'gap:4px' } });
  for (const g of ['day', 'week', 'month'] as Gran[]) {
    const b = el('button', {
      cls: `btn sm seg${g === gran ? ' active' : ''}`,
      text: g === 'day' ? '日' : g === 'week' ? '周' : '月',
      attrs: { type: 'button', title: `${g} 视图` }
    });
    b.addEventListener('click', () => {
      gran = g;
      // 工具栏不随 redraw 重建，需同步更新分段按钮高亮
      segWrap.querySelectorAll('.seg').forEach((n) => n.classList.remove('active'));
      b.classList.add('active');
      redraw();
    });
    segWrap.appendChild(b);
  }
  const ownerSel = el('select', { attrs: { title: '按负责人筛选' } }) as HTMLSelectElement;
  const statusSel = el('select', { attrs: { title: '按状态筛选' } }) as HTMLSelectElement;

  bar.append(segWrap, ownerSel, statusSel, el('span', { cls: 'spacer' }));
  const legend = el('div', { cls: 'g-legend' });
  legend.innerHTML =
    '<span><i class="lg-dot" style="background:linear-gradient(90deg,var(--neon),var(--gold))"></i>任务（内填充=进度）</span>' +
    '<span><i class="lg-dot" style="background:var(--gold);width:2px"></i>今日线</span>' +
    '<span class="cell-dim">拖拽任务条可调整排期 · 点击打开编辑</span>';
  bar.appendChild(legend);
  const addBtn = el('button', { cls: 'btn primary', text: '＋ 新增任务', attrs: { type: 'button' } });
  addBtn.addEventListener('click', () => {
    if (!curProject()) { toast('请先创建项目', 'warn'); return; }
    if (!projectPhases().length) { toast('请先创建阶段', 'warn'); return; }
    openTaskModal();
  });
  bar.appendChild(addBtn);
  root.appendChild(bar);

  const wrap = el('div', { cls: 'glass panel gantt-wrap' });
  root.appendChild(wrap);

  function redraw(): void {
    renderGantt();
  }
  renderGantt();

  function renderGantt(): void {
    clear(wrap);
    const tasksAll = projectTasks();
    const owners = Array.from(new Set(tasksAll.map((t) => t.owner || '未指派')));
    for (const s of ownerSel.options) s.remove();
    ownerSel.appendChild(el('option', { text: '全部负责人', attrs: { value: '全部' } }));
    for (const o of owners) ownerSel.appendChild(el('option', { text: o, attrs: { value: o } }));
    // 筛选人已不存在（如切换项目 / 数据变更）时同步回退，避免下拉显示“全部”但过滤仍为旧值
    if (!owners.includes(ownerFilter) && ownerFilter !== '全部') ownerFilter = '全部';
    ownerSel.value = ownerFilter;
    ownerSel.onchange = () => {
      ownerFilter = ownerSel.value;
      redraw();
    };
    for (const s of statusSel.options) s.remove();
    statusSel.appendChild(el('option', { text: '全部状态', attrs: { value: '全部' } }));
    for (const s of ['待开始', '进行中', '已完成', '已取消']) {
      statusSel.appendChild(el('option', { text: s, attrs: { value: s } }));
    }
    statusSel.value = statusFilter;
    statusSel.onchange = () => {
      statusFilter = statusSel.value;
      redraw();
    };

    if (!prj) {
      wrap.appendChild(el('div', { cls: 'g-empty', html: '暂无项目 —— 请先点击右上角【<b>新建项目</b>】创建项目' }));
      return;
    }
    const tasks = tasksAll.filter((t) => {
      if (ownerFilter !== '全部' && (t.owner || '未指派') !== ownerFilter) return false;
      if (statusFilter !== '全部' && t.status !== statusFilter) return false;
      return true;
    });
    if (!tasks.length) {
      wrap.appendChild(
        el('div', { cls: 'g-empty', html: '暂无任务 —— 请到【<b>计划</b>】中添加，或从模板创建项目自动生成' })
      );
      return;
    }

    // 时间范围：数据边界与今日的并集，前后留白
    const t0 = todayMs();
    let from = t0;
    let to = t0;
    for (const t of tasks) {
      from = Math.min(from, parseDate(t.startDate));
      to = Math.max(to, parseDate(t.endDate));
    }
    from -= 3 * DAY;
    to += 3 * DAY;
    const days = Math.round((to - from) / DAY) + 1;
    const px = PX[gran];
    const width = days * px;

    /* 左侧列表 */
    const side = el('div', { cls: 'g-side' });
    /* 右侧滚动区 */
    const main = el('div', { cls: 'g-main' });
    const inner = el('div', { cls: 'g-inner', attrs: { style: `width:${width + 20}px` } });
    main.appendChild(inner);
    main.addEventListener('scroll', () => {
      gScroll = main.scrollLeft;
    });

    /* 表头 */
    const head = el('div', { cls: 'g-head' });
    const periodRow = el('div', { cls: 'g-head-period' });
    const dayRow = el('div', { cls: 'g-head-day' });
    let i0 = 0;
    while (i0 < days) {
      const d = new Date(from + i0 * DAY);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const dd = d.getUTCDate();
      let pEnd: number;
      let label: string;
      if (gran === 'month') {
        pEnd = i0 + (new Date(Date.UTC(y, m + 1, 1)).getTime() - (from + i0 * DAY)) / DAY;
        label = `${y}-${String(m + 1).padStart(2, '0')}`;
      } else if (gran === 'week') {
        const dow = (d.getUTCDay() + 6) % 7; // 周一为0
        pEnd = i0 + (7 - dow);
        label = `${m + 1}月 第${Math.ceil(dd / 7)}周`;
      } else {
        pEnd = i0 + (new Date(Date.UTC(y, m + 1, 1)).getTime() - (from + i0 * DAY)) / DAY;
        label = `${y}年${m + 1}月`;
      }
      const span = Math.max(1, Math.round(pEnd));
      periodRow.appendChild(el('span', { text: label, attrs: { style: `width:${span * px}px` } }));
      i0 += span;
    }
    for (let i = 0; i < days; i++) {
      const d = new Date(from + i * DAY);
      const dow = d.getUTCDay();
      const showNum = gran === 'day' ? true : gran === 'week' ? dow === 1 : d.getUTCDate() === 1;
      dayRow.appendChild(
        el('span', {
          text: showNum ? String(d.getUTCDate()) : '',
          cls: dow === 0 || dow === 6 ? 'wknd' : '',
          attrs: { style: `width:${px}px` }
        })
      );
    }
    head.append(periodRow, dayRow);
    inner.appendChild(head);

    /* 泳道 */
    const lane = el('div', { cls: 'g-lane', attrs: { style: `width:${width}px` } });
    inner.appendChild(lane);
    const grid = el('div', { cls: 'g-grid-bg', attrs: { style: `width:${width}px;background-size:${px}px 100%` } });
    lane.appendChild(grid);

    let rowIdx = 0;
    const rowH = 38;
    const t0v = t0;

    function sideRow(cls: string, nodes: HTMLElement[]): void {
      const r = el('div', { cls: `g-row ${cls}` });
      r.append(...nodes);
      side.appendChild(r);
    }

    const phases = projectPhases();
    const groups: Array<{ phase: Phase | null; tasks: Task[] }> = phases
      .filter((p) => tasks.some((t) => t.phaseId === p.id))
      .map((p) => ({ phase: p, tasks: tasks.filter((t) => t.phaseId === p.id) }));
    const ungrouped = tasks.filter((t) => !t.phaseId || !phases.some((p) => p.id === t.phaseId));
    if (ungrouped.length) groups.push({ phase: null, tasks: ungrouped });

    for (const g of groups) {
      const pid = g.phase?.id || '_ung';
      const isCollapsed = collapsed.has(pid);
      const caret = el('span', { cls: 'g-caret', text: isCollapsed ? '▸' : '▾', title: '展开 / 折叠' });
      const nameNodes: HTMLElement[] = [caret, el('span', { cls: 'g-name', text: `◆ ${g.phase ? g.phase.name : '未分组'}` }), el('span', { cls: 'g-cnt', text: `${g.tasks.length}` })];
      if (g.phase) {
        const edit = el('button', { cls: 'btn sm ghost', text: '编辑', attrs: { type: 'button' } });
        edit.addEventListener('click', () => openPhaseModal(g.phase!));
        nameNodes.push(edit);
      }
      sideRow('group', nameNodes);
      (caret as HTMLElement).addEventListener('click', () => {
        if (collapsed.has(pid)) collapsed.delete(pid);
        else collapsed.add(pid);
        redraw();
      });
      rowIdx++;
      if (isCollapsed) continue;
      for (const t of g.tasks) {
        const left = ((parseDate(t.startDate) - from) / DAY) * px;
        const w = Math.max(((parseDate(t.endDate) - parseDate(t.startDate)) / DAY + 1) * px, 8);
        const barEl = el('div', {
          cls: `g-bar${t.status === '已完成' ? ' done' : ''}${t.status === '已取消' ? ' cancel' : ''}${isTaskOpen(t) && parseDate(t.endDate) < t0v ? ' late' : ''}`,
          attrs: { style: `left:${left}px;width:${w}px;top:${rowIdx * rowH + 7}px` },
          title: `${t.title}｜${t.owner || '未指派'}｜${t.startDate} ~ ${t.endDate}｜${t.status} ${t.progress}%`
        }) as HTMLDivElement;
        const fill = el('div', { cls: 'fill', attrs: { style: `width:${t.progress}%` } });
        const lbl = el('div', { cls: 'lbl', text: t.title });
        barEl.append(fill, lbl, el('div', { cls: 'g-edge l' }), el('div', { cls: 'g-edge r' }));
        lane.appendChild(barEl);
        bindDrag(barEl, t, left, w, px);
        const r = el('div', { cls: 'g-row' });
        r.append(
          el('span', { cls: 'g-caret', attrs: { style: 'visibility:hidden' }, text: '' }),
          el('span', { cls: 'g-name', text: t.title, title: t.title })
        );
        side.appendChild(r);
        rowIdx++;
      }
    }
    lane.style.height = `${rowIdx * rowH}px`;
    side.style.height = `${rowIdx * rowH}px`;

    // 今日线
    const todayLeft = ((t0v - from) / DAY) * px + px / 2;
    const today = el('div', { cls: 'g-today', attrs: { style: `left:${todayLeft}px` } });
    lane.appendChild(today);

    wrap.append(side, main);
    requestAnimationFrame(() => {
      main.scrollLeft = gScroll;
    });
  }

  /* 拖拽：移动整条 / 左右边缘调期；位移预览用 transform，抬起后提交 */
  function bindDrag(barEl: HTMLDivElement, t: Task, origLeft: number, origW: number, px: number): void {
    let mode: 'move' | 'l' | 'r' = 'move';
    let startX = 0;
    let moved = false;
    barEl.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('g-edge')) {
        mode = (e.target as HTMLElement).classList.contains('l') ? 'l' : 'r';
      } else {
        mode = 'move';
      }
      startX = e.clientX;
      moved = false;
      barEl.setPointerCapture(e.pointerId);
      barEl.classList.add('dragging');
      e.preventDefault();
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        if (mode === 'move') barEl.style.transform = `translateX(${dx}px)`;
        else if (mode === 'r') barEl.style.width = `${Math.max(origW + dx, 8)}px`;
        else barEl.style.width = `${Math.max(origW - dx, 8)}px`;
      };
      const onUp = async (ev: PointerEvent): Promise<void> => {
        barEl.removeEventListener('pointermove', onMove);
        barEl.removeEventListener('pointerup', onUp);
        barEl.removeEventListener('pointercancel', onUp);
        barEl.classList.remove('dragging');
        const dx = ev.clientX - startX;
        if (!moved) {
          barEl.style.transform = '';
          barEl.style.width = `${origW}px`;
          openTaskModal(t);
          return;
        }
        const days = Math.round(dx / px);
        const s = parseDate(t.startDate);
        const e2 = parseDate(t.endDate);
        const patch: Record<string, unknown> = {};
        if (mode === 'move' && days !== 0) {
          patch.startDate = fmtDate(s + days * DAY);
          patch.endDate = fmtDate(e2 + days * DAY);
        } else if (mode === 'r' && days !== 0) {
          patch.endDate = fmtDate(Math.max(e2 + days * DAY, s));
        } else if (mode === 'l' && days !== 0) {
          patch.startDate = fmtDate(Math.min(s + days * DAY, e2));
        }
        barEl.style.transform = '';
        barEl.style.width = `${origW}px`;
        if (Object.keys(patch).length) {
          await store.update('task', t.id, patch);
          toast(`「${t.title}」排期已更新`);
          await refreshAll();
        }
      };
      barEl.addEventListener('pointermove', onMove);
      barEl.addEventListener('pointerup', onUp);
      barEl.addEventListener('pointercancel', onUp);
    });
  }
}
