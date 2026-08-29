import { DAY, parseDate, todayMs } from '../../shared/date.js';
import { Phase, Project, Task } from '../../shared/types.js';
import { registerCleanup, openCreateProjectModal, requireRepo } from '../core/app.js';
import { prepCanvas, tween } from '../core/anim.js';
import { getTheme, hexA } from '../core/theme.js';
import { el, icon, openModal, toast } from '../core/dom.js';
import { store, isElectron } from '../core/store.js';
import {
  completionPct,
  curProject,
  isTaskOpen,
  projectBugs,
  projectPhases,
  projectReqs,
  projectTasks
} from '../core/state.js';

/* ============ 仪表盘：作战总览驾驶舱 ============ */

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const prj = curProject();
  if (!prj) {
    const hero = el('div', { cls: 'hero glass panel idle-float' });
    hero.append(
      el('h2', { text: '项目管理系统' }),
      el('p', { text: '暂无项目 —— 点击【新建项目】，从内置模板一键生成阶段 / 任务' }),
      el('button', { cls: 'btn primary', text: '＋ 新建项目', attrs: { type: 'button' } })
    );
    (hero.querySelector('button') as HTMLButtonElement).addEventListener('click', async () => { if (await requireRepo()) openCreateProjectModal(); });
    hero.appendChild(el('div', { cls: 'hint', text: '模板中心提供：软件研发迭代 / 产品发布 / 日常运营项目 / 论文撰写' }));
    root.appendChild(hero);
    return;
  }

  const tasks = projectTasks();
  const reqs = projectReqs();
  const bugs = projectBugs();
  const phases = projectPhases();

  const grid = el('div', { cls: 'dash' });
  root.appendChild(grid);

  grid.appendChild(panelOverview(prj, tasks, phases));
  grid.appendChild(await panelRing(tasks, reqs, bugs));
  grid.appendChild(panelMetrics(tasks, bugs, phases));
  // 第二行：折线数据流（左，8 列）与 风险告警日历（右，4 列）并列等高
  grid.appendChild(panelLine(tasks, bugs));
  grid.appendChild(panelCalendar(tasks));
  grid.appendChild(panelPriority(tasks, reqs));
  grid.appendChild(panelHeat(tasks, phases));
}

function makePanel(title: string, spanCls: string, extra = ''): { panel: HTMLElement; body: HTMLElement } {
  const panel = el('div', {
    cls: `glass panel idle-float ${spanCls} ${extra}`,
    attrs: { style: 'position:relative' }
  });
  panel.appendChild(el('div', { cls: 'panel-title', text: title }));
  const body = el('div', { cls: 'panel-body', attrs: { style: 'flex:1;min-height:0;display:flex;flex-direction:column' } });
  panel.appendChild(body);
  return { panel, body };
}

/* ---- 概况卡：项目信息 + 计划/实际进度双条 + 阶段 chips + 仓库/导出入口 ---- */
function panelOverview(prj: Project, tasks: Task[], phases: Phase[]): HTMLElement {
  const { panel, body } = makePanel('项目概况', 'sp-4 h-300 stagger-1');
  const title = panel.querySelector('.panel-title') as HTMLElement;
  const extra = el('span', { cls: 'title-extra' });
  const repoBtn = el('button', {
    cls: 'btn sm ghost',
    text: '📁 打开仓库',
    attrs: { type: 'button' },
    title: 'REPO：在资源管理器中打开项目仓库（按阶段分文件夹 + project.json 状态档案）'
  });
  repoBtn.addEventListener('click', async () => {
    if (!isElectron) {
      toast('文件仓库仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    const ok = await store.openRepo(prj.id);
    if (!ok) toast('仓库打开失败', 'err');
  });
  const wsBtn = el('button', {
    cls: 'btn sm ghost',
    text: '📂 工作空间',
    attrs: { type: 'button' },
    title: '打开项目工作空间目录（自由存放工作文件，不受阶段/任务层级约束）'
  });
  wsBtn.addEventListener('click', async () => {
    if (!isElectron) {
      toast('工作空间仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    const ok = await store.openWorkspace(prj.id);
    if (!ok) toast('工作空间打开失败', 'err');
  });
  const expBtn = el('button', {
    cls: 'btn sm ghost',
    text: '⇩ 导出快照',
    attrs: { type: 'button' },
    title: '导出为 .json 迁移文件，可在其他机器通过【导入项目】恢复'
  });
  expBtn.addEventListener('click', async () => {
    if (!isElectron) {
      toast('导入/导出仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    try {
      const file = await store.exportProject(prj.id);
      if (file) toast(`已导出迁移文件：${file}`);
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, 'err');
    }
  });
  extra.append(repoBtn, wsBtn, expBtn);
  title.appendChild(extra);
  const completion = completionPct(tasks);
  const start = parseDate(prj.startDate);
  const end = parseDate(prj.endDate);
  const span = Math.max(end - start, DAY);
  const planned = Math.max(0, Math.min(100, Math.round(((todayMs() - start) / span) * 100)));

  const rows = el('div', { cls: 'ov-rows' });
  rows.append(
    ovRow('项目', prj.name),
    ovRow('负责人 / 成员', `${prj.owner || '—'} / ${prj.members.length || 1} 人`),
    ovRow('周期', `${prj.startDate} ~ ${prj.endDate}`)
  );
  const dual = el('div', { cls: 'dual-bar' });
  dual.append(barRow('计划进度', planned, 'plan'), barRow('实际进度', completion, 'real'));
  const chips = el('div', { cls: 'ms-chips' });
  if (!phases.length) {
    chips.appendChild(el('span', { cls: 'ms-chip', text: '暂无阶段' }));
  } else {
    for (const ph of phases) {
      const pt = tasks.filter((t) => t.phaseId === ph.id);
      const done = pt.filter((t) => t.status === '已完成').length;
      chips.appendChild(
        el('span', {
          cls: `ms-chip${pt.length && done === pt.length ? ' done' : ''}`,
          text: `◆ ${ph.name}（${done}/${pt.length}）`,
          title: `阶段「${ph.name}」：已完成 ${done} / ${pt.length} 个任务`
        })
      );
    }
  }
  body.append(rows, dual, chips);
  requestAnimationFrame(() => {
    dual.querySelectorAll<HTMLElement>('.bar-fill').forEach((f) => {
      f.style.transform = `scaleX(${Number(f.dataset.k) / 100})`;
    });
  });
  return panel;
}

function ovRow(k: string, v: string): HTMLElement {
  const r = el('div');
  r.append(el('span', { text: `${k}：`, attrs: { style: 'color:var(--dim)' } }), el('b', { text: v }));
  return r;
}

function barRow(label: string, pct: number, cls: 'plan' | 'real'): HTMLElement {
  const row = el('div', { cls: 'bar-row' });
  row.append(el('span', { cls: 'lab', text: label }));
  const track = el('div', { cls: 'bar-track' });
  const fill = el('div', { cls: `bar-fill ${cls}` });
  fill.dataset.k = String(pct);
  track.appendChild(fill);
  row.append(track, el('span', { cls: 'pct', text: `${pct}%` }));
  return row;
}

/* ---- 环形进度：整体完成度 + 需求交付率 / 缺陷关闭率 ---- */
async function panelRing(tasks: Task[], reqs: { status: string }[], bugs: { status: string }[]): Promise<HTMLElement> {
  const { panel, body } = makePanel('整体完成度', 'sp-4 h-300 stagger-2');
  const wrap = el('div', { cls: 'ring-wrap' });
  const big = el('div', { cls: 'ring-big' });
  const cv = el('canvas') as HTMLCanvasElement;
  big.appendChild(cv);
  const side = el('div', { cls: 'ring-side' });

  const completion = completionPct(tasks);
  const reqDone = reqs.filter((r) => r.status === '已交付').length;
  const bugClosed = bugs.filter((b) => b.status === '已关闭').length;

  side.appendChild(miniRing('需求交付率', reqs.length ? reqDone / reqs.length : 0, `${reqDone}/${reqs.length}`));
  side.appendChild(miniRing('缺陷关闭率', bugs.length ? bugClosed / bugs.length : 0, `${bugClosed}/${bugs.length}`));
  wrap.append(big, side);
  body.appendChild(wrap);

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  const t = tween(700, (k) => drawRing(cv, (completion / 100) * k, '完成度'));
  registerCleanup(() => t.cancel());
  return panel;
}

function miniRing(label: string, ratio: number, frac: string): HTMLElement {
  const box = el('div', { cls: 'ring-mini' });
  const cv = el('canvas') as HTMLCanvasElement;
  const txt = el('div', { cls: 'rm-txt' });
  txt.append(el('b', { text: `${Math.round(ratio * 100)}%` }), el('span', { text: `${label}（${frac}）` }));
  box.append(cv, txt);
  requestAnimationFrame(() => tween(700, (k) => drawRing(cv, ratio * k, '')));
  return box;
}

function drawRing(cv: HTMLCanvasElement, ratio: number, centerLabel: string): void {
  const p = prepCanvas(cv);
  if (!p) return;
  const { ctx, w, h } = p;
  const th = getTheme();
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 9;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 9;
  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.06)' : 'rgba(90,70,45,.12)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (ratio > 0) {
    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, th.accent1);
    grad.addColorStop(1, th.accent2);
    ctx.strokeStyle = grad;
    ctx.shadowColor = hexA(th.accent1, 0.55);
    ctx.shadowBlur = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(ratio, 1));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (centerLabel) {
    ctx.fillStyle = th.dark ? '#ffe9c9' : '#4a2f14';
    ctx.shadowColor = hexA(th.accent1, 0.6);
    ctx.shadowBlur = 12;
    ctx.font = '700 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(ratio * 100)}%`, cx, cy - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = th.dark ? 'rgba(201,191,174,.8)' : 'rgba(107,92,71,.9)';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText(centerLabel, cx, cy + 16);
  }
}

/* ---- 指标卡片：透视图标 + 点击展开明细（320ms 插值） ---- */
function panelMetrics(tasks: Task[], bugs: { status: string; title: string; severity: string }[], phases: Phase[]): HTMLElement {
  const { panel, body } = makePanel('关键指标', 'sp-4 h-300 stagger-3');
  const grid = el('div', { cls: 'metrics-grid' });
  const completion = completionPct(tasks);
  const doing = tasks.filter((t) => t.status === '进行中');
  const openBugs = bugs.filter((b) => !['已关闭', '非缺陷', '重复'].includes(b.status));
  const t0 = todayMs();
  const overdue = tasks.filter((t) => isTaskOpen(t) && parseDate(t.endDate) < t0);

  const cards: Array<{ lab: string; val: string; ic: string; alert?: boolean; rows: Array<[string, string]> }> = [
    {
      lab: '任务完成率',
      val: `${completion}%`,
      ic: 'gauge',
      rows: phases.length
        ? phases.map((p) => {
            const pt = tasks.filter((t) => t.phaseId === p.id);
            return [p.name, `${completionPct(pt)}%`] as [string, string];
          })
        : [['暂无阶段', '—']]
    },
    {
      lab: '进行中任务',
      val: String(doing.length),
      ic: 'list',
      rows: doing.length ? doing.slice(0, 6).map((t) => [t.title, t.owner || '未指派'] as [string, string]) : [['暂无进行中任务', '']]
    },
    {
      lab: '未关闭缺陷',
      val: String(openBugs.length),
      ic: 'bug',
      rows: openBugs.length ? openBugs.slice(0, 6).map((b) => [b.title, b.severity] as [string, string]) : [['暂无未关闭缺陷', '']]
    },
    {
      lab: '延期任务',
      val: String(overdue.length),
      ic: 'alert',
      alert: overdue.length > 0,
      rows: overdue.length
        ? overdue.slice(0, 6).map((t) => {
            const d = Math.round((t0 - parseDate(t.endDate)) / DAY);
            return [t.title, `延期 ${d} 天`] as [string, string];
          })
        : [['无延期任务', '']]
    }
  ];

  for (const c of cards) {
    const card = el('div', { cls: `metric glass hover-lift${c.alert ? ' alert-card' : ''}`, attrs: { title: '点击展开 / 收起明细' } });
    const top = el('div', { cls: 'm-top' });
    const valWrap = el('div');
    valWrap.append(
      el('div', { cls: `m-val${c.alert ? ' alert-text' : ''}`, text: c.val }),
      el('div', { cls: 'm-lab', text: c.lab })
    );
    top.append(el('div', { cls: 'icon-tile', html: icon(c.ic, 22) }), valWrap);
    const detail = el('div', { cls: 'm-detail' });
    for (const [a, b] of c.rows) {
      const row = el('div', { cls: 'md-row' });
      row.append(el('span', { text: a }), el('span', { text: b }));
      detail.appendChild(row);
    }
    card.append(top, el('div', { cls: 'm-lab', text: '▾ 明细' }), detail);
    card.addEventListener('click', () => card.classList.toggle('open'));
    grid.appendChild(card);
  }
  body.appendChild(grid);
  return panel;
}

/* ---- 折线实时数据流：近30天 完成任务 / 新增缺陷 + 巡游光点 ---- */
function panelLine(tasks: Task[], bugs: { createdAt: string }[]): HTMLElement {
  const { panel, body } = makePanel('近 30 天数据流', 'sp-8 h-400 stagger-1');
  const th = getTheme();
  const legend = el('div', { cls: 'chart-legend' });
  legend.innerHTML =
    `<span><i style="background:linear-gradient(90deg,${th.accent2},${th.accent1})"></i>完成任务</span>` +
    `<span><i style="background:linear-gradient(90deg,${th.accent1},${hexA(th.accent1, 0.55)})"></i>新增缺陷</span>`;
  const box = el('div', { cls: 'canvas-box' });
  const cv = el('canvas', { cls: 'chart' }) as HTMLCanvasElement;
  box.appendChild(cv);
  body.append(legend, box);

  const days: string[] = [];
  const done: number[] = [];
  const created: number[] = [];
  const t0 = todayMs();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(t0 - i * DAY);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    days.push(key);
    done.push(tasks.filter((t) => t.completedAt === key).length);
    created.push(bugs.filter((b) => b.createdAt === key).length);
  }
  const series = [
    { data: done, color: th.accent2 },
    { data: created, color: th.accent1 }
  ];

  let cursor = 0;
  let raf = 0;
  let last = 0;
  function loop(ts: number): void {
    raf = requestAnimationFrame(loop);
    if (document.hidden || ts - last < 50) return;
    last = ts;
    cursor = (ts / 12000) % 1; // 12s 匀速巡游一圈
    drawLine(cv, series, days, cursor);
  }
  requestAnimationFrame(() => {
    raf = requestAnimationFrame(loop);
  });
  registerCleanup(() => cancelAnimationFrame(raf));
  return panel;
}

function drawLine(
  cv: HTMLCanvasElement,
  series: Array<{ data: number[]; color: string }>,
  labels: string[],
  cursor: number
): void {
  const p = prepCanvas(cv);
  if (!p) return;
  const { ctx, w, h } = p;
  const th = getTheme();
  const padL = 30;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  ctx.clearRect(0, 0, w, h);
  const maxV = Math.max(1, ...series.flatMap((s) => s.data));
  const n = labels.length;
  const X = (i: number): number => padL + ((w - padL - padR) * i) / (n - 1);
  const Y = (v: number): number => h - padB - ((h - padT - padB) * v) / (maxV * 1.15);

  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.06)' : 'rgba(90,70,45,.1)';
  ctx.fillStyle = th.dark ? 'rgba(142,132,116,.8)' : 'rgba(120,100,80,.9)';
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const v = (maxV * g) / 4;
    const y = Y(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), padL - 5, y + 3);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += 6) {
    ctx.fillText(labels[i].slice(5), X(i), h - 6);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    s.data.forEach((v, i) => (i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v))));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.color;
    for (let i = 0; i < n; i++) {
      if (s.data[i] > 0) {
        ctx.beginPath();
        ctx.arc(X(i), Y(s.data[i]), 2, 0, 6.2832);
        ctx.fill();
      }
    }
  }
  // 巡游光点（沿第一条曲线缓慢流动）
  const fi = cursor * (n - 1);
  const i0 = Math.floor(fi);
  const i1 = Math.min(n - 1, i0 + 1);
  const k = fi - i0;
  const v = series[0].data[i0] + (series[0].data[i1] - series[0].data[i0]) * k;
  const gx = X(fi);
  const gy = Y(v);
  const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 12);
  grad.addColorStop(0, hexA(th.accent2, 0.9));
  grad.addColorStop(1, hexA(th.accent1, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(gx, gy, 12, 0, 6.2832);
  ctx.fill();
}

/* ---- 条形优先级看板：任务 / 需求 P0-P2 ---- */
function panelPriority(tasks: Task[], reqs: { priority: string }[]): HTMLElement {
  const { panel, body } = makePanel('优先级看板', 'sp-5 h-320 stagger-3');
  const board = el('div', { cls: 'prio-board' });
  const maxV = Math.max(
    1,
    ...['P0', 'P1', 'P2'].map((p) => tasks.filter((t) => t.priority === p).length + reqs.filter((r) => r.priority === p).length)
  );
  for (const p of ['P0', 'P1', 'P2'] as const) {
    const tc = tasks.filter((t) => t.priority === p).length;
    const rc = reqs.filter((r) => r.priority === p).length;
    const row = el('div', { cls: 'prio-row' });
    row.appendChild(el('div', { cls: 'prio-head' })).appendChild(el('span', { cls: `chip ${p.toLowerCase()}`, text: p }));
    row.append(hbar('任务', tc, maxV, 'task'), hbar('需求', rc, maxV, 'req'));
    board.appendChild(row);
  }
  body.appendChild(board);
  requestAnimationFrame(() => {
    board.querySelectorAll<HTMLElement>('.hbar-fill').forEach((f) => {
      f.style.transform = `scaleX(${Number(f.dataset.k)})`;
    });
  });
  return panel;
}

function hbar(lab: string, n: number, max: number, cls: 'task' | 'req'): HTMLElement {
  const row = el('div', { cls: 'hbar-row' });
  row.append(el('span', { cls: 'lab', text: lab }));
  const track = el('div', { cls: 'hbar-track' });
  const fill = el('div', { cls: `hbar-fill ${cls}` });
  fill.dataset.k = String(n / max);
  track.appendChild(fill);
  row.append(track, el('span', { cls: 'num', text: String(n) }));
  return row;
}

/* ---- 热力地图：成员 × 阶段 负载（DASH-05），面板可展开（320ms 宽高插值） ---- */
function panelHeat(tasks: Task[], phases: Phase[]): HTMLElement {
  const { panel, body } = makePanel('成员负载热力地图', 'sp-7 h-320 stagger-4');
  const title = panel.querySelector('.panel-title') as HTMLElement;
  const expBtn = el('button', { cls: 'btn sm ghost', text: '⤢ 展开', attrs: { type: 'button' }, title: '展开 / 收起面板' });
  (title as HTMLElement).appendChild(el('span', { cls: 'title-extra' })).appendChild(expBtn);
  panel.classList.add('expanding');
  let expanded = false;
  expBtn.addEventListener('click', () => {
    expanded = !expanded;
    panel.style.height = expanded ? '480px' : '';
    expBtn.textContent = expanded ? '⤡ 收起' : '⤢ 展开';
  });

  const wrap = el('div', { cls: 'heat-wrap' });
  const table = el('table', { cls: 'heat-table' }) as HTMLTableElement;
  const open = tasks.filter(isTaskOpen);
  const members = Array.from(new Set(open.map((t) => t.owner || '未指派')));
  const cols = phases.map((p) => p.name);
  const ungrouped = open.filter((t) => !t.phaseId).length;
  if (ungrouped) cols.push('未分组');

  if (!open.length) {
    wrap.appendChild(el('div', { cls: 'empty-tip', html: '暂无任务数据 —— 请到【<b>计划</b>】中新增任务' }));
    body.appendChild(wrap);
    return panel;
  }
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', { cls: 'rowlab', text: '成员 \\ 阶段' }));
  for (const c of cols) hr.appendChild(el('th', { text: c }));
  hr.appendChild(el('th', { text: '合计' }));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const m of members) {
    const tr = el('tr');
    tr.appendChild(el('td', { cls: 'rowlab', text: m }));
    let total = 0;
    phases.forEach((p, pi) => {
      const n = open.filter((t) => (t.owner || '未指派') === m && t.phaseId === p.id).length;
      total += n;
      tr.appendChild(heatCell(m, cols[pi], n));
    });
    if (ungrouped) {
      const n = open.filter((t) => (t.owner || '未指派') === m && !t.phaseId).length;
      total += n;
      tr.appendChild(heatCell(m, '未分组', n));
    }
    tr.appendChild(el('td', { cls: 'total', text: String(total) }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
  return panel;
}

function heatCell(m: string, phase: string, n: number): HTMLElement {
  const td = el('td', {
    text: n ? String(n) : '',
    title: `${m} · ${phase}：${n} 个未完成任务`
  });
  if (n) {
    // 热度由主题主色 alpha 计算（.heat 使用 --heat 变量），换主题即时变色
    td.classList.add('heat');
    td.style.setProperty('--heat', String(Math.min(n, 6)));
  }
  return td;
}

/* ---- 风险告警日历：延期红 / 临期金，告警动效仅异常日期启用 ---- */
let calCursor: { y: number; m: number } | null = null;

function panelCalendar(tasks: Task[]): HTMLElement {
  const { panel, body } = makePanel('风险告警日历', 'sp-4 h-400 stagger-2');
  body.style.overflow = 'auto'; // 日历 + 点击日期后的明细在面板内滚动
  const now = new Date();
  if (!calCursor) calCursor = { y: now.getFullYear(), m: now.getMonth() };

  const headRow = el('div', { cls: 'cal-head-row' });
  const prev = el('button', { cls: 'btn sm ghost', text: '‹', attrs: { type: 'button' }, title: '上一月' });
  const next = el('button', { cls: 'btn sm ghost', text: '›', attrs: { type: 'button' }, title: '下一月' });
  const todayBtn = el('button', { cls: 'btn sm', text: '今天', attrs: { type: 'button' } });
  const title = el('span', { cls: 'cal-title' });
  headRow.append(prev, title, next, el('span', { attrs: { style: 'flex:1' } }), todayBtn);
  body.appendChild(headRow);

  const grid = el('div', { cls: 'cal-grid' });
  body.append(grid);

  const t0 = todayMs();
  function draw(): void {
    const { y: yCur, m: mCur } = calCursor!;
    title.textContent = `${yCur} 年 ${mCur + 1} 月`;
    grid.innerHTML = '';
    for (const w of ['一', '二', '三', '四', '五', '六', '日']) {
      grid.appendChild(el('div', { cls: 'cal-head-cell', text: w }));
    }
    const first = new Date(yCur, mCur, 1);
    let lead = first.getDay() - 1;
    if (lead < 0) lead = 6;
    const dim = new Date(yCur, mCur + 1, 0).getDate();
    for (let i = 0; i < lead; i++) grid.appendChild(el('div', { cls: 'cal-cell dim' }));
    const todayKey = new Date(t0);
    const tk = `${todayKey.getUTCFullYear()}-${String(todayKey.getUTCMonth() + 1).padStart(2, '0')}-${String(todayKey.getUTCDate()).padStart(2, '0')}`;
    for (let d = 1; d <= dim; d++) {
      const key = `${yCur}-${String(mCur + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dueTasks = tasks.filter((t) => isTaskOpen(t) && t.endDate === key);
      const cell = el('div', { cls: `cal-cell${key === tk ? ' today' : ''}` });
      cell.appendChild(el('span', { cls: 'd', text: String(d) }));
      if (dueTasks.length) {
        const isPast = parseDate(key) < t0;
        const cls = isPast ? 'risk-red' : 'risk-gold';
        cell.classList.add(cls);
        const marks = el('div', { cls: 'marks' });
        for (let i = 0; i < Math.min(dueTasks.length, 4); i++) marks.appendChild(el('span', { cls: 'dot' }));
        cell.appendChild(marks);
        const lines = [
          ...dueTasks.map((t) => {
            const dd = Math.round((t0 - parseDate(t.endDate)) / DAY);
            return `${isPast ? (dd > 3 ? '【高风险】' : '【已延期】') : '【即将到期】'}${t.title}（${t.owner || '未指派'}${isPast ? `，延期 ${dd} 天` : ''}）`;
          }),
        ];
        cell.title = lines.join('\n');
        cell.addEventListener('click', () => {
          const modal = openModal(`${yCur} 年 ${mCur + 1} 月 ${d} 日 · 截止任务`);
          for (const l of lines) modal.body.appendChild(el('div', { cls: 'cd-row', text: l }));
          if (!lines.length) modal.body.appendChild(el('div', { cls: 'empty-tip', text: '当天无截止任务' }));
          const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
          closeBtn.addEventListener('click', () => modal.close());
          modal.foot.appendChild(closeBtn);
        });
      }
      grid.appendChild(cell);
    }
  }
  prev.addEventListener('click', () => {
    calCursor = { y: calCursor!.m === 0 ? calCursor!.y - 1 : calCursor!.y, m: (calCursor!.m + 11) % 12 };
    draw();
  });
  next.addEventListener('click', () => {
    calCursor = { y: calCursor!.m === 11 ? calCursor!.y + 1 : calCursor!.y, m: (calCursor!.m + 1) % 12 };
    draw();
  });
  todayBtn.addEventListener('click', () => {
    calCursor = { y: now.getFullYear(), m: now.getMonth() };
    draw();
  });
  draw();
  if (!tasks.length) {
    body.appendChild(el('div', { cls: 'empty-tip', html: '暂无任务 —— 请到【<b>计划</b>】中创建' }));
  }
  return panel;
}
