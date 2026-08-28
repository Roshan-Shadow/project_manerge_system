import { PmsTemplate, TplPhase } from '../../shared/types.js';
import { store } from '../core/store.js';
import { openCreateProjectModal, refreshAll, requireRepo } from '../core/app.js';
import { getTheme } from '../core/theme.js';
import { buildForm, clear, confirmDialog, el, openModal, toast } from '../core/dom.js';
import { curProject, state } from '../core/state.js';

/* ============ 模板中心：内置模板 / 另存为模板 / Monaco 结构定制（TPL-01~05） ============ */

export function renderTemplates(root: HTMLElement): void {
  const bar = el('div', { cls: 'tool-bar' });
  const saveBtn = el('button', { cls: 'btn', text: '⇪ 保存当前项目为模板', attrs: { type: 'button' }, title: 'TPL-02：项目结构快照存为可复用模板' });
  saveBtn.addEventListener('click', async () => { if (await requireRepo()) openSaveAsTemplateModal(); });
  const addBtn = el('button', { cls: 'btn primary', text: '＋ 新增空白模板', attrs: { type: 'button' } });
  addBtn.addEventListener('click', async () => { if (await requireRepo()) openNewTemplateModal(); });
  bar.append(saveBtn, el('span', { cls: 'spacer' }), addBtn);
  root.appendChild(bar);

  const grid = el('div', { cls: 'tpl-grid' });
  root.appendChild(grid);

  const tpls = state.data?.templates || [];
  if (!tpls.length) {
    grid.appendChild(el('div', { cls: 'empty-tip', html: '暂无模板 —— 可【<b>新增空白模板</b>】或把当前项目【<b>保存为模板</b>】' }));
  }
  for (const t of tpls) {
    grid.appendChild(tplCard(t));
  }
}

function tplCard(t: PmsTemplate): HTMLElement {
  const card = el('div', { cls: 'tpl-card glass hover-lift' });
  card.appendChild(el('h4', { text: t.name }));
  card.appendChild(
    el('span', { cls: t.builtin ? 'tpl-badge' : 'tpl-badge custom', text: t.builtin ? '系统模板' : '自定义' })
  );
  const taskCount = t.phases.reduce((s, p) => s + p.tasks.length, 0);
  card.appendChild(
    el('div', { cls: 'tpl-meta', text: `分类：${t.category}｜${t.phases.length} 阶段 · ${taskCount} 任务` })
  );
  const preview = el('div', { cls: 'tpl-preview' });
  const lines = t.phases.slice(0, 4).map((p) => `<b>${p.name}</b>：${p.tasks.join(' / ') || '（空）'}`);
  if (t.phases.length > 4) lines.push('…');
  preview.innerHTML = lines.join('<br>') || '（空结构，可编辑定义）';
  card.appendChild(preview);

  const actions = el('div', { cls: 'tpl-actions' });
  const use = el('button', { cls: 'btn sm primary', text: '使用', attrs: { type: 'button' }, title: 'TPL-03：从模板创建项目，里程碑按周期等比映射' });
  use.addEventListener('click', async () => { if (await requireRepo()) openCreateProjectModal(t.id); });
  actions.appendChild(use);
  // 系统模板：可编辑、可复制（编辑作用于本次会话，重命名/删除仅限自定义模板）
  const edit = el('button', { cls: 'btn sm', text: '编辑', attrs: { type: 'button' }, title: 'TPL-04：Monaco JSON 定制模板结构' });
  edit.addEventListener('click', () => openTplDrawer(t));
  const copy = el('button', { cls: 'btn sm ghost', text: '复制', attrs: { type: 'button' }, title: '复制为自定义模板（可重命名/删除）' });
  copy.addEventListener('click', async () => {
    const newTpl = await store.create('template', {
      name: `${t.name} 副本`,
      category: t.category,
      builtin: false,
      phases: t.phases
    }) as PmsTemplate;
    await store.saveTemplateFile(newTpl.id, { name: newTpl.name, category: newTpl.category, phases: newTpl.phases });
    toast(`已复制为自定义模板「${t.name} 副本」`);
    await refreshAll();
  });
  actions.append(edit, copy);
  if (!t.builtin) {
    const rename = el('button', { cls: 'btn sm ghost', text: '重命名', attrs: { type: 'button' } });
    rename.addEventListener('click', () => openRenameModal(t));
    const del = el('button', { cls: 'btn sm danger', text: '删除', attrs: { type: 'button' } });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog('删除模板', `确认删除自定义模板「${t.name}」？`);
      if (!ok) return;
      await store.remove('template', [t.id]);
      await store.deleteTemplateFile(t.id, t.name);
      toast('模板已删除');
      await refreshAll();
    });
    actions.append(rename, del);
  }
  card.appendChild(actions);
  return card;
}

function openSaveAsTemplateModal(): void {
  const prj = curProject();
  if (!prj) {
    toast('请先创建并选择一个项目', 'warn');
    return;
  }
  const m = openModal('保存当前项目为模板');
  const form = buildForm(
    [
      { key: 'name', label: '模板名称', type: 'text', required: true, full: true },
      { key: 'category', label: '分类', type: 'text', required: true, placeholder: '如：研发' }
    ],
    { name: `${prj.name} 模板`, category: '自定义' }
  );
  m.body.appendChild(
    el('div', {
      cls: 'f-hint',
      attrs: { style: 'margin-bottom:10px' },
      text: `将对项目「${prj.name}」做结构快照：阶段与任务清单、里程碑按周期比例（offsetRatio）记录，不含具体数据。`
    })
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: '保存为模板', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const tpl = await store.saveProjectAsTemplate({
      projectId: prj.id,
      name: String(v.name),
      category: String(v.category)
    });
    await store.saveTemplateFile(tpl.id, { name: tpl.name, category: tpl.category, phases: tpl.phases });
    m.close();
    toast(`模板「${tpl.name}」已保存（${tpl.phases.length} 阶段）`);
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

function openNewTemplateModal(): void {
  const m = openModal('新增空白模板');
  const form = buildForm(
    [
      { key: 'name', label: '模板名称', type: 'text', required: true, full: true, placeholder: '如：市场活动项目' },
      { key: 'category', label: '分类', type: 'text', required: true, placeholder: '如：运营' }
    ],
    { category: '自定义' }
  );
  m.body.appendChild(el('div', { cls: 'f-hint', attrs: { style: 'margin-bottom:10px' }, text: '创建后可在模板编辑器中定义阶段 / 任务占位 / 里程碑比例。' }));
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: '创建模板', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const tpl = await store.create('template', {
      name: String(v.name),
      category: String(v.category),
      builtin: false,
      phases: []
    }) as PmsTemplate;
    await store.saveTemplateFile(tpl.id, { name: tpl.name, category: tpl.category, phases: [] });
    m.close();
    toast('模板已创建，点击【编辑】定义结构');
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

function openRenameModal(t: PmsTemplate): void {
  const m = openModal('重命名模板');
  const form = buildForm(
    [
      { key: 'name', label: '模板名称', type: 'text', required: true, full: true },
      { key: 'category', label: '分类', type: 'text', required: true }
    ],
    { name: t.name, category: t.category }
  );
  m.body.appendChild(form.root);
  const submit = el('button', { cls: 'btn primary', text: '保存', attrs: { type: 'button' } });
  const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
  submit.addEventListener('click', async () => {
    if (!form.check()) return;
    const v = form.values();
    const oldName = t.name;
    const updated = await store.update('template', t.id, { name: String(v.name), category: String(v.category) }) as PmsTemplate;
    // 删除旧名称文件，保存新名称文件
    if (oldName !== updated.name) {
      await store.deleteTemplateFile(t.id, oldName);
    }
    await store.saveTemplateFile(t.id, { name: updated.name, category: updated.category, phases: updated.phases });
    m.close();
    toast('模板已更新');
    await refreshAll();
  });
  cancel.addEventListener('click', () => m.close());
  m.foot.append(cancel, submit);
}

/* ---- Monaco 结构编辑抽屉（系统/自定义模板均可编辑；加载失败自动降级 textarea） ---- */
interface EditorLike {
  getValue(): string;
  setValue?(v: string): void;
  dispose?(): void;
}

export function openTplDrawer(t: PmsTemplate): void {
  const root = document.getElementById('drawer-root')!;
  clear(root);
  const drawer = el('div', { cls: 'drawer glass' });
  const head = el('div', { cls: 'drawer-head' });
  head.append(
    el('h3', { text: `编辑模板 · ${t.name}` }),
    el('span', { cls: t.builtin ? 'tpl-badge' : 'tpl-badge custom', text: t.builtin ? '系统模板' : '自定义' })
  );
  const x = el('button', { cls: 'btn sm ghost x', text: '✕', attrs: { type: 'button' }, title: '关闭' });
  head.appendChild(x);
  drawer.appendChild(head);

  const mount = el('div', { cls: 'editor' });
  const err = el('div', { cls: 'drawer-err' });
  drawer.append(mount, err);

  const foot = el('div', { cls: 'drawer-foot' });
  let editor: EditorLike | null = null;

  const value = JSON.stringify({ phases: t.phases }, null, 2);
  void loadMonaco().then((monaco) => {
    if (monaco) {
      // Monaco 明暗配色随主题联动（PRD §8.3）
      monaco.editor.defineTheme('pms-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0d0f18',
          'editorLineNumber.foreground': '#8e8474',
          'editor.lineHighlightBackground': '#1a1420'
        }
      });
      monaco.editor.defineTheme('pms-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#fbf7ef',
          'editorLineNumber.foreground': '#a0907a',
          'editor.lineHighlightBackground': '#f3ecdf'
        }
      });
      const th = getTheme();
      const ed = monaco.editor.create(mount, {
        value,
        language: 'json',
        theme: th.monacoTheme,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        scrollBeyondLastLine: false,
        fontFamily: 'Consolas, "Courier New", monospace'
      });
      editor = ed as unknown as EditorLike;
    } else {
      const ta = el('textarea', { cls: 'fallback', text: value }) as HTMLTextAreaElement;
      mount.appendChild(ta);
      editor = ta as unknown as EditorLike;
      err.textContent = '（Monaco 编辑器未能加载，已降级为纯文本编辑）';
    }
  });

  const fmtBtn = el('button', { cls: 'btn ghost', text: '格式化', attrs: { type: 'button' } });
  fmtBtn.addEventListener('click', () => {
    if (!editor) return;
    try {
      const obj = JSON.parse(editor.getValue());
      if (editor.setValue) editor.setValue(JSON.stringify(obj, null, 2));
      err.textContent = '';
    } catch {
      err.textContent = 'JSON 解析失败，无法格式化';
    }
  });
  const saveBtn = el('button', { cls: 'btn primary', text: '保存结构', attrs: { type: 'button' } });
  saveBtn.addEventListener('click', async () => {
    if (!editor) return;
    const problems = validateTplJson(editor.getValue());
    if (problems.length) {
      err.textContent = problems.join('\n');
      return;
    }
    err.textContent = '';
    const obj = JSON.parse(editor.getValue()) as { phases: TplPhase[] };
    await store.update('template', t.id, { phases: obj.phases });
    await store.saveTemplateFile(t.id, { name: t.name, category: t.category, phases: obj.phases });
    toast(`模板「${t.name}」结构已保存`);
    close();
    await refreshAll();
  });
  const closeBtn = el('button', { cls: 'btn', text: '关闭', attrs: { type: 'button' } });
  closeBtn.addEventListener('click', () => close());
  foot.append(fmtBtn, saveBtn, closeBtn);
  drawer.appendChild(foot);

  function close(): void {
    drawer.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      try {
        (editor as unknown as { dispose?: () => void })?.dispose?.();
      } catch {
        /* ignore */
      }
      drawer.remove();
    }, 400);
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  x.addEventListener('click', close);
  root.appendChild(drawer);
  // 强制回流后加 show（避免后台 rAF 节流导致抽屉停留在屏外）
  void drawer.offsetWidth;
  drawer.classList.add('show');
}

function validateTplJson(src: string): string[] {
  const problems: string[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(src);
  } catch (e) {
    return [`JSON 语法错误：${(e as Error).message}`];
  }
  const o = obj as { phases?: unknown };
  if (!o || typeof o !== 'object') return ['根节点必须是对象 {phases}'];
  if (!Array.isArray(o.phases)) problems.push('phases 必须是数组');
  else {
    o.phases.forEach((p: unknown, i: number) => {
      const pp = p as { name?: unknown; tasks?: unknown };
      if (!pp || typeof pp.name !== 'string' || !pp.name.trim()) problems.push(`phases[${i}].name 必须为非空字符串`);
      if (!Array.isArray(pp.tasks)) problems.push(`phases[${i}].tasks 必须是字符串数组`);
      else pp.tasks.forEach((tsk: unknown, j: number) => {
        if (typeof tsk !== 'string' || !tsk.trim()) problems.push(`phases[${i}].tasks[${j}] 必须为非空字符串`);
      });
    });
  }
  return problems;
}

/* Monaco AMD loader 封装（单例） */
type MonacoNs = { editor: { create(el: HTMLElement, opts: Record<string, unknown>): unknown; defineTheme(name: string, t: unknown): void } };
let monacoNs: MonacoNs | null = null;
let loading: Promise<MonacoNs | null> | null = null;

export function loadMonaco(): Promise<MonacoNs | null> {
  if (monacoNs) return Promise.resolve(monacoNs);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const w = window as unknown as {
      require?: ((deps: string[], cb: () => void, eb?: () => void) => void) & { config(o: unknown): void };
      MonacoEnvironment?: unknown;
    };
    const boot = (): void => {
      try {
        const req = w.require;
        if (!req) return resolve(null);
        // Monaco 资源内置 assets（dev/打包/http 同路径）；打包后 file://（asar）下 worker 经 blob 代理启动
        const base = new URL('assets/monaco/vs/', window.location.href).href;
        if (!w.MonacoEnvironment) {
          w.MonacoEnvironment = {
            getWorkerUrl: () =>
              URL.createObjectURL(
                new Blob(
                  [
                    `self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`
                  ],
                  { type: 'text/javascript' }
                )
              )
          };
        }
        req.config({ paths: { vs: 'assets/monaco/vs' } });
        req(
          ['vs/editor/editor.main'],
          () => {
            monacoNs = (window as unknown as { monaco: MonacoNs }).monaco || null;
            resolve(monacoNs);
          },
          () => resolve(null)
        );
      } catch {
        resolve(null);
      }
    };
    if (w.require) boot();
    else {
      const s = document.createElement('script');
      s.src = 'assets/monaco/vs/loader.js';
      s.onload = boot;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    }
  });
  return loading;
}
