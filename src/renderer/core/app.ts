import { DAY, addDays, fmtDate, parseDate, todayMs, todayStr } from '../../shared/date.js';
import { AppSettings, HeatmapColor, Project, ProjectStatus, REPO_NAMINGS, RepoNaming } from '../../shared/types.js';
import { store, isElectron } from './store.js';
import { curProject, isTaskOpen, projectTasks, completionPct, reload, state } from './state.js';
import { THEMES, applyTheme, getTheme } from './theme.js';
import { clear, el, buildForm, confirmDialog, promptDialog, icon, openModal, toast } from './dom.js';
import { wait } from './dom.js';
import { renderHome } from '../modules/home.js';
import { renderDashboard } from '../modules/dashboard.js';
import { renderGantt } from '../modules/gantt.js';
import { renderPlan } from '../modules/plan.js';
import { renderRequirement } from '../modules/requirement.js';
import { renderBug } from '../modules/bug.js';
import { renderTemplates, loadMonaco } from '../modules/template.js';
import { renderMainPage } from '../modules/mainpage.js';

const TABS = [
  { id: 'mainpage', label: '主页' },
  { id: 'home', label: '项目总览' },
  { id: 'dashboard', label: '仪表盘' },
  { id: 'gantt', label: '甘特图' },
  { id: 'plan', label: '计划' },
  { id: 'requirement', label: '需求' },
  { id: 'bug', label: '缺陷' },
  { id: 'template', label: '模板中心' }
];

let activeTab = 'mainpage';
let switching = false;
const cleanups: Array<() => void> = [];

export function registerCleanup(fn: () => void): void {
  cleanups.push(fn);
}

function runCleanups(): void {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* ignore */
    }
  }
}

async function renderTab(id: string): Promise<void> {
  runCleanups();
  const main = document.getElementById('app-main')!;
  clear(main);
  const pane = el('div', { cls: 'pane pane-enter' });
  main.appendChild(pane);
  switch (id) {
    case 'mainpage':
      await renderMainPage(pane);
      break;
    case 'home':
      renderHome(pane);
      break;
    case 'dashboard':
      await renderDashboard(pane);
      break;
    case 'gantt':
      renderGantt(pane);
      break;
    case 'plan':
      renderPlan(pane);
      break;
    case 'requirement':
      renderRequirement(pane);
      break;
    case 'bug':
      renderBug(pane);
      break;
    case 'template':
      renderTemplates(pane);
      break;
  }
}

export async function switchTab(id: string): Promise<void> {
  if (switching || id === activeTab) return;
  switching = true;
  const main = document.getElementById('app-main')!;
  const old = main.querySelector('.pane');
  if (old) {
    old.classList.add('pane-leave');
    await wait(190);
  }
  activeTab = id;
  renderTabs();
  await renderTab(id);
  switching = false;
}

/** 任意数据变更后调用：重载内存仓库 → 刷新头部(含通知铃铛)/当前列表 */
export async function refreshAll(): Promise<void> {
  await reload();
  
  // 检查项目进度，自动更新项目状态
  await updateProjectStatus();
  
  renderHeader();
  await renderTab(activeTab);
}

/** 检查项目进度，当实际进度达到100%时自动将项目状态设置为"已完成" */
async function updateProjectStatus(): Promise<void> {
  const projects = state.data?.projects || [];
  for (const project of projects) {
    if (project.status === '已完成' || project.status === '已暂停') continue;
    
    const tasks = state.data?.tasks?.filter((t) => t.projectId === project.id) || [];
    if (!tasks.length) continue;
    
    const completion = completionPct(tasks);
    if (completion >= 100) {
      await store.update('project', project.id, { status: '已完成' });
    }
  }
}

function renderTabs(): void {
  const nav = document.getElementById('app-tabs')!;
  clear(nav);
  for (const t of TABS) {
    const b = el('button', {
      cls: `tab-btn${t.id === activeTab ? ' active' : ''}`,
      text: t.label,
      attrs: { type: 'button' }
    });
    b.addEventListener('click', () => void switchTab(t.id));
    nav.appendChild(b);
  }
}

function renderHeader(): void {
  const h = document.getElementById('app-header')!;
  clear(h);
  const brand = el('div', { cls: 'brand' });
  const titleRow = el('div', { cls: 'brand-title-row' });
  titleRow.appendChild(el('h1', { text: '项目管理系统' }));
  const repoNameEl = el('span', { cls: 'brand-repo' });
  titleRow.appendChild(repoNameEl);
  brand.append(titleRow, el('div', { cls: 'sub', text: 'Project Management System' }));
  h.appendChild(brand);
  // 异步加载当前仓库名称
  if (isElectron) {
    store.getSettings().then((s) => {
      store.listRepos().then((repos) => {
        const active = repos.find((r) => r.path === s.workDir);
        if (active) repoNameEl.textContent = active.name;
      }).catch(() => { /* ignore */ });
    }).catch(() => { /* ignore */ });
  }
  h.appendChild(el('div', { cls: 'hdr-sep' }));

  const projWrap = el('div', { cls: 'hdr-project' });
  const sel = el('select', { attrs: { 'aria-label': '切换项目' } }) as HTMLSelectElement;
  if (!state.data?.projects.length) {
    sel.appendChild(el('option', { text: '暂无项目', attrs: { value: '' } }));
  }
  for (const p of state.data?.projects || []) {
    sel.appendChild(el('option', { text: p.name, attrs: { value: p.id } }));
  }
  sel.value = state.projectId;
  sel.addEventListener('change', async () => {
    state.projectId = sel.value;
    await refreshAll();
  });
  const addBtn = el('button', { cls: 'btn primary', text: '＋ 新建项目', attrs: { type: 'button' } });
  addBtn.addEventListener('click', async () => { if (await requireRepo()) openCreateProjectModal(); });
  const manageRepoBtn = el('button', {
    cls: 'btn',
    text: '🗂 管理仓库',
    attrs: { type: 'button' },
    title: '管理系统仓库（新建 / 切换 / 打开）'
  });
  manageRepoBtn.addEventListener('click', () => openWorkspaceWizard());
  const importBtn = el('button', {
    cls: 'btn',
    text: '⇪ 导入项目',
    attrs: { type: 'button' },
    title: '从 .json 迁移快照导入项目（桌面版）'
  });
  importBtn.addEventListener('click', async () => {
    if (!isElectron) {
      toast('导入/导出与文件仓库仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    try {
      const prj = await store.importProject();
      if (!prj) return;
      state.projectId = prj.id;
      toast(`已导入项目「${prj.name}」（含全部任务/需求/缺陷，仓库已重建）`);
      await refreshAll();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== '__CANCELED__') toast(`导入失败：${msg}`, 'err');
    }
  });
  const editBtn = el('button', {
    cls: 'btn',
    text: '编辑项目',
    attrs: { type: 'button' },
    title: '修改当前项目信息'
  });
  editBtn.disabled = !curProject();
  editBtn.addEventListener('click', () => openEditProjectModal());
  projWrap.append(sel, manageRepoBtn, importBtn, addBtn, editBtn);
  h.appendChild(projWrap);

  const right = el('div', { cls: 'hdr-right' });
  right.append(
    el('span', {
      cls: 'mode-badge',
      text: isElectron ? 'ELECTRON' : 'WEB 预览（内存回退）'
    }),
    settingsBtn(),
    themeWrap(),
    bellWrap()
  );
  h.appendChild(right);
}

/* ---- 设置（SET-01~03）：工作目录 + 仓库命名方式 ---- */
function settingsBtn(): HTMLElement {
  const b = el('button', {
    cls: 'btn',
    html: icon('gear', 17),
    attrs: { type: 'button', title: '设置：工作目录 / 项目仓库命名方式' }
  });
  b.addEventListener('click', () => void openSettingsModal());
  return b;
}

/* ---- 新建仓库默认设置 ---- */
async function openRepoDefaultsModal(): Promise<void> {
  const m = openModal('新建仓库默认设置');
  let defaults = { repoNaming: 'name' as RepoNaming, trashRetentionDays: 30, heatmapColor: 'green' as HeatmapColor, heatmapRange: 365, heatmapStartDate: '' };
  if (isElectron) {
    try { defaults = await store.getRepoDefaults(); } catch { /* ignore */ }
  }

  const desc = el('div', { cls: 'f-hint', attrs: { style: 'margin-bottom:14px' }, text: '以下设置将作为新建系统仓库的初始默认值。每个仓库创建后可独立修改。' });

  // 仓库命名方式
  const namingItem = el('div', { cls: 'f-item full' });
  namingItem.appendChild(el('label', { text: '项目仓库命名方式' }));
  const namingSel = el('select') as HTMLSelectElement;
  for (const n of REPO_NAMINGS) namingSel.appendChild(el('option', { text: `${n.label}（${n.desc}）`, attrs: { value: n.value } }));
  namingSel.value = defaults.repoNaming;
  namingItem.append(namingSel);

  // trash 保留天数
  const trashItem = el('div', { cls: 'f-item full' });
  trashItem.appendChild(el('label', { text: 'trash 文件夹保留天数' }));
  const trashInput = el('input', { attrs: { type: 'number', min: '0', max: '365', step: '1', placeholder: '30' } }) as HTMLInputElement;
  trashInput.value = String(defaults.trashRetentionDays);
  trashItem.append(trashInput, el('div', { cls: 'f-hint', text: '删除项目后文件夹移入 trash 目录，超过此天数将被自动清理。设为 0 则不自动清理。' }));

  // 热力图配色
  const heatColorRow = el('div', { cls: 'heat-setting-row' });
  heatColorRow.appendChild(el('span', { cls: 'heat-setting-label', text: '热力图配色' }));
  const heatColorSel = el('select') as HTMLSelectElement;
  const heatColors: Array<{ value: string; label: string }> = [
    { value: 'green', label: '绿色（GitHub 风格）' },
    { value: 'blue', label: '蓝色' },
    { value: 'purple', label: '紫色' },
    { value: 'orange', label: '橙色' }
  ];
  for (const c of heatColors) heatColorSel.appendChild(el('option', { text: c.label, attrs: { value: c.value } }));
  heatColorSel.value = defaults.heatmapColor;
  heatColorRow.appendChild(heatColorSel);

  // 时间范围
  const heatRangeRow = el('div', { cls: 'heat-setting-row' });
  heatRangeRow.appendChild(el('span', { cls: 'heat-setting-label', text: '时间范围' }));
  const heatRangeSel = el('select') as HTMLSelectElement;
  const heatRanges: Array<{ value: number; label: string }> = [
    { value: 365, label: '最近 1 年' },
    { value: 180, label: '最近半年' },
    { value: 90, label: '最近 3 个月' },
    { value: 30, label: '最近 1 个月' }
  ];
  for (const r of heatRanges) heatRangeSel.appendChild(el('option', { text: r.label, attrs: { value: String(r.value) } }));
  heatRangeSel.value = String(defaults.heatmapRange);
  heatRangeRow.appendChild(heatRangeSel);

  // 开始日期
  const heatDateRow = el('div', { cls: 'heat-setting-row' });
  heatDateRow.appendChild(el('span', { cls: 'heat-setting-label', text: '开始日期' }));
  const heatDateInput = el('input', { attrs: { type: 'date', placeholder: '留空则按时间范围' } }) as HTMLInputElement;
  heatDateInput.value = defaults.heatmapStartDate;
  heatDateRow.appendChild(heatDateInput);

  const box = el('div', { cls: 'form-grid' });
  box.append(desc, namingItem, trashItem, heatColorRow, heatRangeRow, heatDateRow);
  m.body.appendChild(box);

  const save = el('button', { cls: 'btn primary', text: '保存默认值', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  save.addEventListener('click', async () => {
    if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
    try {
      await store.saveRepoDefaults({
        repoNaming: namingSel.value as RepoNaming,
        trashRetentionDays: parseInt(trashInput.value, 10) || 30,
        heatmapColor: heatColorSel.value as HeatmapColor,
        heatmapRange: parseInt(heatRangeSel.value, 10) || 365,
        heatmapStartDate: heatDateInput.value || ''
      });
      m.close();
      toast('新建仓库默认设置已保存');
    } catch (e) {
      toast(`保存失败：${(e as Error).message}`, 'err');
    }
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, save);
}

async function openSettingsModal(): Promise<void> {
  const m = openModal('设置');
  let cur: AppSettings = { workDir: '', repoNaming: 'name', trashRetentionDays: 30, heatmapColor: 'green', heatmapRange: 365, heatmapStartDate: '' };
  let repos: Array<{ id: string; name: string; path: string }> = [];
  if (isElectron) {
    try {
      cur = await store.getSettings();
      repos = await store.listRepos();
    } catch {
      toast('读取设置失败', 'err');
    }
  }

  // 系统仓库
  const repoItem = el('div', { cls: 'f-item full' });
  repoItem.appendChild(el('label', { text: '系统仓库（存放缓存 / 临时文件 / 插件 / 项目仓库）' }));
  // 当前仓库显示
  const repoCurrent = el('div', { cls: 'repo-current' });
  const activeRepo = repos.find((r) => r.path === cur.workDir);
  repoCurrent.appendChild(el('div', { cls: 'repo-current-label', text: '当前仓库' }));
  repoCurrent.appendChild(el('div', { cls: 'repo-current-name', text: activeRepo?.name || '未设置' }));
  repoCurrent.appendChild(el('div', { cls: 'repo-current-path', text: cur.workDir || '—' }));
  // 操作按钮行
  const repoBtnRow = el('div', { cls: 'repo-btn-row' });
  const switchBtn = el('button', { cls: 'btn', text: '切换系统仓库', attrs: { type: 'button' } });
  switchBtn.addEventListener('click', async () => {
    if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
    const list = await store.listRepos();
    if (list.length === 0) { toast('暂无系统仓库，请先新建', 'warn'); return; }
    const sm = openModal('切换系统仓库');
    const sList = el('div', { cls: 'wizard-repo-list' });
    for (const repo of list) {
      const item = el('div', { cls: 'wizard-repo-item' + (repo.path === cur.workDir ? ' active' : '') });
      item.appendChild(el('div', { cls: 'wizard-repo-name', text: repo.name }));
      item.appendChild(el('div', { cls: 'wizard-repo-path', text: repo.path }));
      item.addEventListener('click', async () => {
        try {
          await store.switchRepo(repo.id);
          sm.close();
          m.close();
          toast(`已切换到「${repo.name}」`);
          await refreshAll();
        } catch (e) {
          toast(`切换失败：${(e as Error).message}`, 'err');
        }
      });
      sList.appendChild(item);
    }
    sm.body.appendChild(sList);
    const sClose = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
    sClose.addEventListener('click', () => sm.close());
    sm.foot.appendChild(sClose);
  });
  const createBtn = el('button', { cls: 'btn', text: '新建系统仓库', attrs: { type: 'button' } });
  createBtn.addEventListener('click', async () => {
    if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
    const name = await promptDialog('新建系统仓库', '请输入系统仓库名称：');
    if (!name) return;
    try {
      const repo = await store.createRepo(name);
      if (!repo) return;
      m.close();
      toast(`系统仓库「${repo.name}」已创建`);
      await refreshAll();
    } catch (e) {
      toast(`创建失败：${(e as Error).message}`, 'err');
    }
  });
  const openRepoBtn = el('button', { cls: 'btn', text: '打开系统仓库', attrs: { type: 'button' } });
  openRepoBtn.addEventListener('click', async () => {
    if (!isElectron) { toast('仅桌面版支持', 'warn'); return; }
    const dir = await store.pickWorkDir();
    if (!dir) return;
    const name = dir.split(/[\\/]/).pop() || '未命名仓库';
    try {
      const repo = await store.addRepo(name, dir);
      m.close();
      toast(`系统仓库「${repo.name}」已打开`);
      await refreshAll();
    } catch (e) {
      toast(`打开失败：${(e as Error).message}`, 'err');
    }
  });
  const defaultsBtn = el('button', { cls: 'btn', text: '设置新建默认值', attrs: { type: 'button' } });
  defaultsBtn.addEventListener('click', () => { openRepoDefaultsModal(); });
  repoBtnRow.append(switchBtn, createBtn, openRepoBtn, defaultsBtn);
  repoItem.append(repoCurrent, repoBtnRow, el('div', { cls: 'f-hint', text: '系统仓库是应用的数据根目录，包含设置、缓存、临时文件、插件与项目仓库。可创建多个系统仓库对不同项目分类管理。' }));

  // 仓库命名方式
  const namingItem = el('div', { cls: 'f-item full' });
  namingItem.appendChild(el('label', { text: '项目仓库命名方式（默认）' }));
  const namingSel = el('select') as HTMLSelectElement;
  if (!isElectron) namingSel.setAttribute('disabled', 'disabled');
  for (const n of REPO_NAMINGS) namingSel.appendChild(el('option', { text: `${n.label}（${n.desc}）`, attrs: { value: n.value } }));
  namingSel.value = cur.repoNaming;
  namingItem.append(namingSel, el('div', { cls: 'f-hint', text: '保存后既有仓库目录将按新命名方式自动迁移（目录内容随迁，project.json 归属不变）。' }));

  // trash 保留天数
  const trashItem = el('div', { cls: 'f-item full' });
  trashItem.appendChild(el('label', { text: 'trash 文件夹保留天数' }));
  const trashInput = el('input', { attrs: { type: 'number', min: '1', max: '365', step: '1', placeholder: '30' } }) as HTMLInputElement;
  trashInput.value = String(cur.trashRetentionDays || 30);
  trashInput.disabled = !isElectron;
  trashItem.append(trashInput, el('div', { cls: 'f-hint', text: '删除项目后文件夹移入 trash 目录，超过此天数将被自动清理。设为 0 则不自动清理。' }));

  // 热力图样式
  const heatItem = el('div', { cls: 'f-item full' });
  heatItem.appendChild(el('label', { text: '热力图样式（主页）' }));

  // 配色方案
  const heatColorRow = el('div', { cls: 'heat-setting-row' });
  heatColorRow.appendChild(el('span', { cls: 'heat-setting-label', text: '配色方案' }));
  const heatColorSel = el('select') as HTMLSelectElement;
  const heatColors: Array<{ value: string; label: string; preview: string }> = [
    { value: 'green', label: '绿色（GitHub 风格）', preview: '#40c463' },
    { value: 'blue', label: '蓝色', preview: '#3182bd' },
    { value: 'purple', label: '紫色', preview: '#df65b0' },
    { value: 'orange', label: '橙色', preview: '#e6550d' }
  ];
  for (const c of heatColors) {
    const opt = el('option', { text: `${c.label}`, attrs: { value: c.value } });
    heatColorSel.appendChild(opt);
  }
  heatColorSel.value = cur.heatmapColor || 'green';
  const colorPreview = el('span', { cls: 'heat-color-preview' });
  const updateColorPreview = () => {
    const c = heatColors.find((x) => x.value === heatColorSel.value);
    colorPreview.style.background = c ? c.preview : '#40c463';
  };
  updateColorPreview();
  heatColorSel.addEventListener('change', updateColorPreview);
  heatColorRow.append(heatColorSel, colorPreview);

  // 时间范围
  const heatRangeRow = el('div', { cls: 'heat-setting-row' });
  heatRangeRow.appendChild(el('span', { cls: 'heat-setting-label', text: '时间范围' }));
  const heatRangeSel = el('select') as HTMLSelectElement;
  const heatRanges: Array<{ value: number; label: string }> = [
    { value: 365, label: '最近 1 年' },
    { value: 180, label: '最近半年' },
    { value: 90, label: '最近 3 个月' },
    { value: 30, label: '最近 1 个月' }
  ];
  for (const r of heatRanges) heatRangeSel.appendChild(el('option', { text: r.label, attrs: { value: String(r.value) } }));
  heatRangeSel.value = String(cur.heatmapRange || 365);
  heatRangeRow.appendChild(heatRangeSel);

  // 开始日期
  const heatDateRow = el('div', { cls: 'heat-setting-row' });
  heatDateRow.appendChild(el('span', { cls: 'heat-setting-label', text: '开始日期' }));
  const heatDateInput = el('input', { attrs: { type: 'date', placeholder: '留空则按时间范围' } }) as HTMLInputElement;
  heatDateInput.value = cur.heatmapStartDate || '';
  heatDateInput.title = '指定统计起点，留空则从今天往前推算时间范围';
  heatDateRow.appendChild(heatDateInput);

  heatItem.append(heatColorRow, heatRangeRow, heatDateRow, el('div', { cls: 'f-hint', text: '配色方案选择颜色；时间范围控制热力图显示天数；开始日期指定统计起点（留空则按时间范围从今天往前推算）。' }));

  const box = el('div', { cls: 'form-grid' });
  box.append(repoItem, namingItem, trashItem, heatItem);
  m.body.appendChild(box);

  const save = el('button', { cls: 'btn primary', text: '保存设置', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  save.addEventListener('click', async () => {
    if (!isElectron) {
      toast('设置仅桌面版支持（浏览器预览为内存模式）', 'warn');
      return;
    }
    if (!(await requireRepo())) return;
    try {
      const s = await store.saveSettings({
        workDir: cur.workDir,
        repoNaming: namingSel.value as RepoNaming,
        trashRetentionDays: parseInt(trashInput.value, 10) || 30,
        heatmapColor: heatColorSel.value as HeatmapColor,
        heatmapRange: parseInt(heatRangeSel.value, 10) || 365,
        heatmapStartDate: heatDateInput.value || ''
      });
      m.close();
      toast('设置已保存');
      if (activeTab === 'mainpage') await renderTab('mainpage');
    } catch (e) {
      toast(`保存失败：${(e as Error).message}`, 'err');
    }
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, save);
}

/* ---- 主题更换（PRD §8.3）：下拉选择，即时生效并持久化 ---- */
function themeWrap(): HTMLElement {
  const wrap = el('div', { cls: 'pop-wrap' });
  const cur = getTheme();
  const btn = el('button', {
    cls: 'btn',
    html: icon('palette', 16) + `<span style="margin-left:6px">${cur.label}</span>`,
    attrs: { type: 'button', title: '切换主题（四套驾驶舱配色）' }
  });
  const panel = el('div', { cls: 'pop-panel glass theme-panel' });
  const list = el('div', { cls: 'theme-list' });
  for (const t of THEMES) {
    const item = el('div', { cls: `theme-item${t.id === cur.id ? ' active' : ''}`, title: `切换到「${t.label}」` });
    const sw = el('span', { cls: 'sw' });
    for (const c of t.swatch) sw.appendChild(el('i', { attrs: { style: `background:${c}` } }));
    const txt = el('span');
    txt.append(el('div', { cls: 't-name', text: t.label }), el('div', { cls: 't-desc', text: t.desc }));
    item.append(sw, txt);
    if (t.id === cur.id) item.appendChild(el('span', { cls: 't-check', text: '✓' }));
    item.addEventListener('click', () => {
      applyTheme(t.id);
      panel.classList.remove('open');
      toast(`主题已切换：${t.label}`);
    });
    list.appendChild(item);
  }
  const foot = el('div', { cls: 'theme-foot' });
  const closeBtn = el('button', { cls: 'btn sm ghost', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  foot.appendChild(closeBtn);
  panel.append(list, foot);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target as Node)) panel.classList.remove('open');
  });
  wrap.append(btn, panel);
  return wrap;
}

/* ---- 站内提醒（ALM-01~03）：延期判定 + 到期前 3 天 + 高风险升级 ---- */
export interface AlertMsg {
  id: string;
  type: '高风险' | '已延期' | '即将到期';
  content: string;
  date: string;
}

export function computeAlerts(): AlertMsg[] {
  const msgs: AlertMsg[] = [];
  const t0 = todayMs();
  for (const t of projectTasks()) {
    if (!isTaskOpen(t)) continue;
    const end = parseDate(t.endDate);
    if (end < t0) {
      const d = Math.round((t0 - end) / DAY);
      msgs.push({
        id: `od:${t.id}`,
        type: d > 3 ? '高风险' : '已延期',
        content: `【${t.title}】已延期 ${d} 天（负责人：${t.owner || '未指派'}）`,
        date: t.endDate
      });
    } else if (end - t0 <= 3 * DAY) {
      const d = Math.round((end - t0) / DAY);
      msgs.push({
        id: `du:${t.id}`,
        type: '即将到期',
        content: `【${t.title}】${d === 0 ? '今日' : `${d} 天后`}到期（${t.endDate}）`,
        date: t.endDate
      });
    }
  }
  const rank = { 高风险: 0, 已延期: 1, 即将到期: 2 };
  msgs.sort((a, b) => rank[a.type] - rank[b.type]);
  return msgs;
}

const readSet = new Set<string>();

function bellWrap(): HTMLElement {
  const wrap = el('div', { cls: 'pop-wrap' });
  const msgs = computeAlerts();
  const unread = msgs.filter((m) => !readSet.has(m.id));
  const btn = el('button', {
    cls: 'btn',
    html: icon('bell', 18),
    attrs: { type: 'button', title: '任务提醒（延期 / 即将到期）' }
  });
  if (unread.length) {
    const badge = el('span', { cls: 'pop-badge', text: String(unread.length) });
    btn.appendChild(badge);
  }
  function syncBadge(): void {
    const remain = msgs.filter((m) => !readSet.has(m.id)).length;
    const old = btn.querySelector('.pop-badge');
    if (old) old.remove();
    if (remain) btn.appendChild(el('span', { cls: 'pop-badge', text: String(remain) }));
  }
  const panel = el('div', { cls: 'pop-panel glass' });
  const list = el('div', { cls: 'bell-list' });
  if (!msgs.length) {
    list.appendChild(el('div', { cls: 'bell-empty', text: '当前项目暂无延期 / 临期任务' }));
  } else {
    const color = { 高风险: 'var(--err)', 已延期: 'var(--neon-soft)', 即将到期: 'var(--warn)' };
    for (const m of msgs) {
      const item = el('div', { cls: `bell-item${readSet.has(m.id) ? '' : ' unread'}`, title: '点击标记已读' });
      item.append(
        el('span', { cls: 't-dot', attrs: { style: `background:${color[m.type]};box-shadow:0 0 6px ${color[m.type]}` } }),
        el('span', { text: `[${m.type}] ${m.content}` }),
        el('span', { cls: 'b-date', text: m.date })
      );
      item.addEventListener('click', () => {
        readSet.add(m.id);
        item.classList.remove('unread');
        syncBadge();
      });
      list.appendChild(item);
    }
  }
  const foot = el('div', { cls: 'bell-foot' });
  const allRead = el('button', { cls: 'btn sm', text: '全部已读', attrs: { type: 'button' } });
  allRead.addEventListener('click', () => {
    for (const m of msgs) readSet.add(m.id);
    list.querySelectorAll('.bell-item').forEach((n) => n.classList.remove('unread'));
    syncBadge();
  });
  const closeBtn = el('button', { cls: 'btn sm ghost', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  foot.append(allRead, closeBtn);  panel.append(list, foot);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target as Node)) panel.classList.remove('open');
  });
  wrap.append(btn, panel);
  return wrap;
}

/* ---- 新建项目（TPL-03 从模板创建，里程碑按周期等比映射） ---- */
export function openCreateProjectModal(templateId = ''): void {
  const tpls = state.data?.templates || [];
  const m = openModal('新建项目');
  const init = {
    templateId,
    startDate: todayStr(),
    endDate: fmtDate(addDays(todayMs(), 30))
  };
  const form = buildForm(
    [
      {
        key: 'templateId',
        label: '项目模板',
        type: 'select',
        full: true,
        options: [
          { value: '', label: '空白项目（不生成阶段与任务）' },
          ...tpls.map((t) => ({
            value: t.id,
            label: `${t.name}（${t.phases.length} 阶段）`
          }))
        ]
      },
      { key: 'name', label: '项目名称', type: 'text', required: true, placeholder: '如：官网改版 v2.0' },
      { key: 'owner', label: '负责人', type: 'text', required: true, placeholder: '如：张三' },
      { key: 'startDate', label: '开始日期', type: 'date', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', required: true },
      { key: 'members', label: '成员（逗号分隔）', type: 'text', full: true, placeholder: '张三,李四,王五' }
    ],
    init,
    (v) => {
      const errs: Record<string, string> = {};
      if (v.startDate && v.endDate && String(v.endDate) < String(v.startDate)) {
        errs.endDate = '结束日期不能早于开始日期';
      }
      return errs;
    }
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: '创建项目', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const members = String(v.members || '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const prj = await store.createProjectFromTemplate({
      templateId: String(v.templateId || ''),
      name: String(v.name),
      owner: String(v.owner),
      startDate: String(v.startDate),
      endDate: String(v.endDate),
      members
    });
    state.projectId = prj.id;
    m.close();
    toast(
      `项目「${prj.name}」已创建` +
        (prj.templateSource && prj.templateSource !== '空白项目' ? `（模板：${prj.templateSource}）` : '')
    );
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

function openEditProjectModal(): void {
  const prj = curProject();
  if (!prj) {
    toast('请先创建项目', 'warn');
    return;
  }
  const m = openModal('编辑项目');
  const form = buildForm(
    [
      { key: 'name', label: '项目名称', type: 'text', required: true },
      { key: 'owner', label: '负责人', type: 'text', required: true },
      { key: 'startDate', label: '开始日期', type: 'date', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', required: true },
      {
        key: 'status',
        label: '项目状态',
        type: 'select',
        options: (['进行中', '已完成', '已暂停'] as ProjectStatus[]).map((s) => ({ value: s, label: s }))
      },
      { key: 'members', label: '成员（逗号分隔）', type: 'text', full: true }
    ],
    { ...prj, members: prj.members.join(',') },
    (v) => {
      const errs: Record<string, string> = {};
      if (v.startDate && v.endDate && String(v.endDate) < String(v.startDate)) {
        errs.endDate = '结束日期不能早于开始日期';
      }
      return errs;
    }
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: '保存', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  const delBtn = el('button', { cls: 'btn danger', text: '🗑 删除项目', attrs: { type: 'button' }, title: '删除此项目及其全部阶段/任务/需求/缺陷，不可恢复' });
  delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog(
      '删除项目',
      `确认删除项目「${prj.name}」及其全部阶段、任务、需求、缺陷？此操作不可恢复。`
    );
    if (!ok) return;
    await store.remove('project', [prj.id]);
    state.projectId = '';
    m.close();
    toast(`项目「${prj.name}」已删除`);
    await refreshAll();
  });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    await store.update('project', prj.id, {
      name: String(v.name),
      owner: String(v.owner),
      startDate: String(v.startDate),
      endDate: String(v.endDate),
      status: String(v.status),
      members: String(v.members || '')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
    } as unknown as Partial<Project>);
    m.close();
    toast('项目信息已更新');
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(delBtn, cancel, submit);
}

/* ---- 首次启动向导：3:7 分栏 —— 左侧系统仓库列表 + 右侧操作区 ---- */
async function openWorkspaceWizard(): Promise<void> {
  const m = openModal('系统仓库管理');
  m.el.classList.add('wizard-modal');
  const box = el('div', { cls: 'wizard-box' });

  // 左栏 30%：系统仓库列表
  const left = el('div', { cls: 'wizard-left' });
  left.appendChild(el('div', { cls: 'wizard-left-title', text: '已有的系统仓库' }));
  const repoListEl = el('div', { cls: 'wizard-repo-list' });
  left.appendChild(repoListEl);

  // 右栏 70%
  const right = el('div', { cls: 'wizard-right' });
  // 上 30%：图标 + 名称
  const branding = el('div', { cls: 'wizard-branding' });
  branding.appendChild(el('div', { cls: 'wizard-icon', text: '🚀' }));
  branding.appendChild(el('div', { cls: 'wizard-app-name', text: '项目管理系统' }));
  branding.appendChild(el('div', { cls: 'wizard-app-sub', text: 'Project Management System' }));
  branding.appendChild(el('div', { cls: 'wizard-app-desc', text: '选择或创建一个系统仓库开始使用' }));
  right.appendChild(branding);
  // 下 70%：两个操作按钮
  const actions = el('div', { cls: 'wizard-actions' });

  // 新建系统仓库
  const createBtn = el('button', { cls: 'btn wizard-action-btn', attrs: { type: 'button' } });
  createBtn.appendChild(el('span', { cls: 'wizard-action-icon', text: '📁' }));
  const createInfo = el('div', { cls: 'wizard-action-info' });
  createInfo.appendChild(el('div', { cls: 'wizard-action-title', text: '新建系统仓库' }));
  createInfo.appendChild(el('div', { cls: 'wizard-action-desc', text: '在指定文件夹下创建一个新的系统仓库' }));
  createBtn.append(createInfo, el('span', { cls: 'wizard-action-arrow', text: '›' }));
  createBtn.addEventListener('click', async () => {
    const name = await promptDialog('新建系统仓库', '请输入系统仓库名称：');
    if (!name) return;
    try {
      const repo = await store.createRepo(name);
      if (!repo) return;
      toast(`系统仓库「${repo.name}」已创建`);
      m.close();
      await refreshAll();
    } catch (e) {
      toast(`创建失败：${(e as Error).message}`, 'err');
    }
  });

  // 打开系统仓库：选择目录 → 直接用文件夹名作为名称
  const openBtn = el('button', { cls: 'btn wizard-action-btn', attrs: { type: 'button' } });
  openBtn.appendChild(el('span', { cls: 'wizard-action-icon', text: '📂' }));
  const openInfo = el('div', { cls: 'wizard-action-info' });
  openInfo.appendChild(el('div', { cls: 'wizard-action-title', text: '打开系统仓库' }));
  openInfo.appendChild(el('div', { cls: 'wizard-action-desc', text: '将一个已有的本地文件夹作为系统仓库打开' }));
  openBtn.append(openInfo, el('span', { cls: 'wizard-action-arrow', text: '›' }));
  openBtn.addEventListener('click', async () => {
    const dir = await store.pickWorkDir();
    if (!dir) return;
    const name = dir.split(/[\\/]/).pop() || '未命名仓库';
    try {
      const repo = await store.addRepo(name, dir);
      toast(`系统仓库「${repo.name}」已打开`);
      m.close();
      await refreshAll();
    } catch (e) {
      toast(`打开失败：${(e as Error).message}`, 'err');
    }
  });

  actions.append(createBtn, openBtn);
  right.appendChild(actions);
  box.append(left, right);
  m.body.appendChild(box);

  // 加载仓库列表
  const repos = isElectron ? await store.listRepos() : [];
  if (repos.length === 0) {
    repoListEl.appendChild(el('div', { cls: 'wizard-repo-empty', text: '暂无系统仓库\n请点击右侧新建或打开' }));
  } else {
    for (const repo of repos) {
      const item = el('div', { cls: 'wizard-repo-item' });
      item.appendChild(el('div', { cls: 'wizard-repo-name', text: repo.name }));
      item.appendChild(el('div', { cls: 'wizard-repo-path', text: repo.path }));
      item.addEventListener('click', async () => {
        try {
          await store.switchRepo(repo.id);
          toast(`已切换到「${repo.name}」`);
          m.close();
          await refreshAll();
        } catch (e) {
          toast(`切换失败：${(e as Error).message}`, 'err');
        }
      });
      repoListEl.appendChild(item);
    }
  }

  // 底部：暂不设置（仅首次启动时显示）
  const ws = isElectron ? await store.workspaceStatus() : { ready: true };
  if (!ws.ready) {
    const later = el('button', { cls: 'btn ghost', text: '暂不设置', attrs: { type: 'button' } });
    later.addEventListener('click', () => {
      m.close();
      toast('未设置系统仓库：部分功能暂不可用，可稍后通过 ⚙ 设置', 'warn');
    });
    m.foot.appendChild(later);
  }
}

/* ---- 仓库前置检查 ---- */
export async function requireRepo(): Promise<boolean> {
  if (!isElectron) return true;
  try {
    const ws = await store.workspaceStatus();
    if (ws.ready) return true;
  } catch { /* 忽略 */ }
  toast('请先创建或打开系统仓库', 'warn');
  await openWorkspaceWizard();
  return false;
}

/* ---- 启动 ---- */
export async function renderApp(): Promise<void> {
  await reload();
  renderHeader();
  renderTabs();
  await renderTab('mainpage');
  // SET-04 首次启动：工作目录未就绪时弹向导（浏览器预览跳过）
  if (isElectron) {
    try {
      const ws = await store.workspaceStatus();
      if (!ws.ready) await openWorkspaceWizard();
    } catch {
      /* 状态查询失败不阻塞启动 */
    }
  }
  // 主题切换：CSS 变量即时生效；重绘头部（当前主题名）与当前视图（Canvas 图表取色）
  window.addEventListener('pms-theme-change', () => {
    renderHeader();
    void renderTab(activeTab);
  });
  // Monaco 加载探针：冒烟/诊断用（桌面版内置 assets，浏览器预览走 http）
  if (isElectron) {
    void loadMonaco().then((m) => console.log(`[pms-monaco] ${m ? 'ok' : 'fallback'}`));
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (activeTab === 'dashboard' || activeTab === 'gantt') void renderTab(activeTab);
    }, 250);
  });
}
