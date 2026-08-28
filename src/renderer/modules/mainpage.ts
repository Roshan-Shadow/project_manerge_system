import { DAY, addDays, fmtDate, parseDate, todayMs, todayStr } from '../../shared/date.js';
import { Deliverable, HeatmapColor, Task, TaskStatus } from '../../shared/types.js';
import { el, toast } from '../core/dom.js';
import { store, isElectron } from '../core/store.js';
import { projectTasks, state } from '../core/state.js';

const COLOR_MAP: Record<HeatmapColor, string[]> = {
  green: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  blue: ['#ebedf0', '#9ecae1', '#6baed6', '#3182bd', '#08519c'],
  purple: ['#ebedf0', '#c994c7', '#df65b0', '#ce1256', '#67000d'],
  orange: ['#ebedf0', '#fdbe85', '#fd8d3c', '#e6550d', '#7f2704']
};

interface Achievement {
  id: string;
  icon: string;
  label: string;
  condition: (ctx: AchieveCtx) => boolean;
  /** 累计达成次数（仅连续天数类勋章使用） */
  count?: (ctx: AchieveCtx) => number;
}

interface AchieveCtx {
  total: number;
  streak: number;
  weekFirst: boolean;
  monthFirst: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'weekFirst', icon: '🎯', label: '本周首次提交', condition: (c) => c.weekFirst },
  { id: 'monthFirst', icon: '📅', label: '本月首次提交', condition: (c) => c.monthFirst },
  {
    id: 'streak7', icon: '🔥', label: '连续 7 天',
    condition: (c) => c.streak >= 7,
    count: (c) => c.streak >= 7 ? Math.floor(c.streak / 7) : 0
  },
  {
    id: 'streak30', icon: '⚡', label: '连续 30 天',
    condition: (c) => c.streak >= 30,
    count: (c) => c.streak >= 30 ? Math.floor(c.streak / 30) : 0
  },
  { id: 'total50', icon: '📊', label: '累计 50 次', condition: (c) => c.total >= 50 },
  { id: 'total100', icon: '🏆', label: '累计 100 次', condition: (c) => c.total >= 100 },
  { id: 'total500', icon: '💪', label: '累计 500 次', condition: (c) => c.total >= 500 },
  { id: 'total1000', icon: '🌟', label: '累计 1000 次', condition: (c) => c.total >= 1000 }
];

function getAllDeliverables(): Deliverable[] {
  const all: Deliverable[] = [];
  for (const t of state.data?.tasks || []) {
    for (const d of t.deliverables || []) {
      if (d.time) all.push(d);
    }
  }
  return all;
}

function parseTimeToDay(time: string): string {
  const match = time.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function countByDay(deliverables: Deliverable[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of deliverables) {
    const day = parseTimeToDay(d.time);
    if (day) map.set(day, (map.get(day) || 0) + 1);
  }
  return map;
}

function calcStreak(counts: Map<string, number>): number {
  let streak = 0;
  const today = todayStr();
  let cur = todayMs();
  while (true) {
    const key = fmtDate(cur);
    if (counts.has(key)) {
      streak++;
      cur -= DAY;
    } else {
      break;
    }
  }
  return streak;
}

function buildHeatmap(deliverables: Deliverable[], startDateMs: number, range: number, color: HeatmapColor): HTMLElement {
  const counts = countByDay(deliverables);
  const palette = COLOR_MAP[color] || COLOR_MAP.green;

  const wrap = el('div', { cls: 'heatmap-wrap' });
  const grid = el('div', { cls: 'heatmap-grid' });

  const maxCount = Math.max(1, ...Array.from(counts.values()));

  for (let i = 0; i < range; i++) {
    const dayMs = startDateMs + i * DAY;
    const key = fmtDate(dayMs);
    const count = counts.get(key) || 0;
    const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));

    const cell = el('div', {
      cls: 'heatmap-cell',
      attrs: {
        'data-count': String(count),
        'data-date': key,
        title: `${key}：${count} 次提交`,
        style: `background-color:${palette[level]}`
      }
    });
    grid.appendChild(cell);
  }

  wrap.appendChild(grid);

  const legend = el('div', { cls: 'heatmap-legend' });
  legend.appendChild(el('span', { text: '少', attrs: { style: 'font-size:11px;color:var(--dim)' } }));
  for (let i = 0; i < 5; i++) {
    legend.appendChild(el('div', {
      cls: 'heatmap-cell',
      attrs: { style: `background-color:${palette[i]};width:12px;height:12px` }
    }));
  }
  legend.appendChild(el('span', { text: '多', attrs: { style: 'font-size:11px;color:var(--dim)' } }));
  wrap.appendChild(legend);

  return wrap;
}

function buildSummary(deliverables: Deliverable[], streak: number, tasks: Task[]): HTMLElement {
  const box = el('div', { cls: 'mp-summary' });
  const total = deliverables.length;
  const todayDay = todayStr();
  const todayCount = deliverables.filter((d) => parseTimeToDay(d.time) === todayDay).length;
  const weekAgo = fmtDate(todayMs() - 6 * DAY);
  const weekCount = deliverables.filter((d) => {
    const day = parseTimeToDay(d.time);
    return day && day >= weekAgo;
  }).length;

  const weekDone = tasks.filter((t) => t.status === '已完成' && t.completedAt && t.completedAt >= weekAgo).length;
  const monthStart = fmtDate(todayMs() - 29 * DAY);
  const monthDone = tasks.filter((t) => t.status === '已完成' && t.completedAt && t.completedAt >= monthStart).length;

  const items: Array<{ label: string; value: string }> = [
    { label: '总提交', value: String(total) },
    { label: '本周提交', value: String(weekCount) },
    { label: '今日提交', value: String(todayCount) },
    { label: '连续提交', value: `${streak} 天` },
    { label: '本周完成任务', value: String(weekDone) },
    { label: '本月完成任务', value: String(monthDone) }
  ];

  for (const item of items) {
    const card = el('div', { cls: 'mp-stat-card' });
    card.appendChild(el('div', { cls: 'mp-stat-value', text: item.value }));
    card.appendChild(el('div', { cls: 'mp-stat-label', text: item.label }));
    box.appendChild(card);
  }
  return box;
}

function buildTaskPanel(title: string, tasks: Task[], maxItems: number): HTMLElement {
  const wrap = el('div', { cls: 'mp-task-panel' });
  wrap.appendChild(el('div', { cls: 'mp-task-title', text: title }));
  const list = el('div', { cls: 'mp-task-list' });
  const shown = tasks.slice(0, maxItems);
  if (!shown.length) {
    list.appendChild(el('div', { cls: 'mp-task-empty', text: '暂无' }));
  }
  for (const t of shown) {
    const row = el('div', { cls: 'mp-task-row' });
    const statusColors: Record<TaskStatus, string> = {
      '待开始': '#8b8b8b', '进行中': '#e6a817', '已完成': '#40c463', '已取消': '#666'
    };
    row.appendChild(el('span', {
      attrs: { style: `width:8px;height:8px;border-radius:50%;background:${statusColors[t.status] || '#8b8b8b'};flex:0 0 auto` }
    }));
    const nameSpan = el('span', { text: t.title, attrs: { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px' } });
    nameSpan.title = t.title;
    row.appendChild(nameSpan);
    if (t.endDate) {
      row.appendChild(el('span', { text: t.endDate, attrs: { style: 'font-size:11px;color:var(--dim);flex:0 0 auto' } }));
    }
    list.appendChild(row);
  }
  if (tasks.length > maxItems) {
    list.appendChild(el('div', { cls: 'mp-task-more', text: `还有 ${tasks.length - maxItems} 项…` }));
  }
  wrap.appendChild(list);
  return wrap;
}

function buildAchievements(ctx: AchieveCtx): HTMLElement {
  const wrap = el('div', { cls: 'mp-achievements' });
  wrap.appendChild(el('div', { cls: 'mp-task-title', text: '🏆 成就墙' }));
  const grid = el('div', { cls: 'mp-ach-grid' });
  for (const ach of ACHIEVEMENTS) {
    const unlocked = ach.condition(ctx);
    const cnt = ach.count ? ach.count(ctx) : 0;
    const card = el('div', {
      cls: `mp-ach-card ${unlocked ? 'unlocked' : 'locked'}`,
      attrs: { title: unlocked ? `已解锁：${ach.label}${cnt > 0 ? `（×${cnt}）` : ''}` : `未解锁：${ach.label}` }
    });
    card.appendChild(el('span', { cls: 'mp-ach-icon', text: ach.icon }));
    card.appendChild(el('span', { cls: 'mp-ach-label', text: ach.label }));
    if (unlocked && cnt > 0) {
      card.appendChild(el('span', { cls: 'mp-ach-badge', text: `×${cnt}` }));
    }
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  return wrap;
}

function getAllTasks(): Task[] {
  return state.data?.tasks || [];
}

export async function renderMainPage(root: HTMLElement): Promise<void> {
  const allDeliverables = getAllDeliverables();
  const counts = countByDay(allDeliverables);
  const streak = calcStreak(counts);

  let settings = { heatmapColor: 'green' as HeatmapColor, heatmapRange: 365, heatmapStartDate: '' };
  if (isElectron) {
    try { settings = await store.getSettings(); } catch { /* use defaults */ }
  }

  const container = el('div', { cls: 'mp-container' });
  const allTasks = getAllTasks();

  // 热力图（先渲染）
  const heatPanel = el('div', { cls: 'glass panel mp-heatmap-panel' });
  heatPanel.appendChild(el('div', { cls: 'panel-title', text: '📈 提交热力图' }));
  const heatBody = el('div', { cls: 'panel-body', attrs: { style: 'padding:16px' } });
  // 如果设置了开始日期，从该日期起算 range 天；否则从今天往前推 range 天
  let heatStartDateMs: number;
  if (settings.heatmapStartDate) {
    heatStartDateMs = parseDate(settings.heatmapStartDate);
  } else {
    heatStartDateMs = todayMs() - (settings.heatmapRange - 1) * DAY;
  }
  heatBody.appendChild(buildHeatmap(allDeliverables, heatStartDateMs, settings.heatmapRange, settings.heatmapColor));
  heatPanel.appendChild(heatBody);
  container.appendChild(heatPanel);

  // 统计摘要（后渲染）
  container.appendChild(buildSummary(allDeliverables, streak, allTasks));

  // 任务面板
  const today = todayStr();
  const weekLater = fmtDate(todayMs() + 7 * DAY);
  const weekAgo = fmtDate(todayMs() - 7 * DAY);

  const tasksPanel = el('div', { cls: 'mp-tasks-grid' });

  const nearingDeadline = allTasks
    .filter((t) => t.status !== '已完成' && t.status !== '已取消' && t.endDate && t.endDate <= weekLater && t.endDate >= today)
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
  tasksPanel.appendChild(buildTaskPanel('⏰ 即将截止', nearingDeadline, 5));

  const inProgress = allTasks.filter((t) => t.status === '进行中');
  tasksPanel.appendChild(buildTaskPanel('🔄 进行中', inProgress, 5));

  const completed = allTasks
    .filter((t) => t.status === '已完成' && t.completedAt && t.completedAt >= weekAgo)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  tasksPanel.appendChild(buildTaskPanel('✅ 近期完成', completed, 5));

  container.appendChild(tasksPanel);

  // 成就墙
  const todayDay = todayStr();
  const thisWeekStart = fmtDate(todayMs() - (new Date().getDay()) * DAY);
  const thisMonthStart = todayDay.slice(0, 7) + '-01';
  const weekFirst = allDeliverables.some((d) => { const day = parseTimeToDay(d.time); return day && day >= thisWeekStart; });
  const monthFirst = allDeliverables.some((d) => { const day = parseTimeToDay(d.time); return day && day >= thisMonthStart; });
  container.appendChild(buildAchievements({ total: allDeliverables.length, streak, weekFirst, monthFirst }));

  root.appendChild(container);
}
