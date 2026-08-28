export interface ElOpts {
  cls?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  title?: string;
  data?: Record<string, string>;
  on?: Record<string, (ev: Event) => void>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOpts = {}): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (opts.cls) n.className = opts.cls;
  if (opts.text != null) n.textContent = opts.text;
  if (opts.html) n.innerHTML = opts.html; // 仅用于内部受信 SVG 片段
  if (opts.title) n.title = opts.title;
  for (const [k, v] of Object.entries(opts.attrs || {})) n.setAttribute(k, v);
  for (const [k, v] of Object.entries(opts.data || {})) n.dataset[k] = v;
  for (const [k, fn] of Object.entries(opts.on || {})) n.addEventListener(k, fn);
  return n;
}

export function clear(n: HTMLElement): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* 简约线性图标（stroke = currentColor，配合透视/发光使用） */
const ICONS: Record<string, string> = {
  gauge:
    '<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 13 16 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  bug: '<circle cx="12" cy="13" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8V5M7 9 4.5 6.5M17 9l2.5-2.5M7 14H4M20 14h-3M8 18l-2 2.5M16 18l2 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
  alert:
    '<path d="M12 4 21 19H3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1" fill="currentColor"/>',
  flame:
    '<path d="M12 3c1 3.5 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.4 2.2-4.6C10 9.6 12 8 12 3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 20a2.6 2.6 0 0 0 2.6-2.6c0-1.6-1.4-2.4-2.6-4-1.2 1.6-2.6 2.4-2.6 4A2.6 2.6 0 0 0 12 20Z" fill="currentColor" opacity=".55"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  diamond: '<path d="M12 3l7 9-7 9-7-9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  doc: '<path d="M7 3h7l4 4v14H7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 12h5M10 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  palette: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9.5" cy="14.5" r="1.3" fill="currentColor"/><path d="M13.2 13.6l4 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  gear: '<path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  chart: '<path d="M4 20V4M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/><path d="M7 15l4-5 3 3 5-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  heat: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16" stroke="currentColor" stroke-width="1" opacity=".6"/>'
};

export function icon(name: string, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name] || ICONS.list}</svg>`;
}

/* ---- Toast ---- */
export function toast(msg: string, type: 'ok' | 'warn' | 'err' = 'ok'): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const t = el('div', { cls: `toast ${type}`, text: msg });
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600);
  }, 2600);
}

/* ---- 模态 ---- */
export interface ModalCtrl {
  close(): void;
  body: HTMLElement;
  foot: HTMLElement;
  el: HTMLElement;
}

export function openModal(title: string): ModalCtrl {
  const root = document.getElementById('modal-root')!;
  const overlay = el('div', { cls: 'modal-overlay' });
  const modal = el('div', { cls: 'modal glass' });
  const head = el('div', { cls: 'modal-head' });
  head.appendChild(el('h3', { text: title }));
  const x = el('button', { cls: 'btn sm ghost x', text: '✕', attrs: { type: 'button' }, title: '关闭' });
  head.appendChild(x);
  const body = el('div', { cls: 'modal-body' });
  const foot = el('div', { cls: 'modal-foot' });
  modal.append(head, body, foot);
  overlay.appendChild(modal);
  root.appendChild(overlay);
  // 强制回流后加 show，确保过渡动画播放且不受后台标签页 rAF 节流影响
  void overlay.offsetWidth;
  overlay.classList.add('show');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 260);
  }
  document.addEventListener('keydown', onKey);
  x.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  return { close, body, foot, el: modal };
}

export function confirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const m = openModal(title);
    m.body.appendChild(el('p', { cls: 'confirm-msg', text: message }));
    const ok = el('button', { cls: 'btn danger', text: '确认', attrs: { type: 'button' } });
    const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
    ok.addEventListener('click', () => {
      m.close();
      resolve(true);
    });
    cancel.addEventListener('click', () => {
      m.close();
      resolve(false);
    });
    m.foot.append(cancel, ok);
  });
}

/** 带文本输入的弹窗，返回输入值；取消返回 null */
export function promptDialog(title: string, label: string, defaultVal?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const m = openModal(title);
    const lbl = el('label', { text: label, attrs: { style: 'display:block;margin-bottom:8px;font-size:13px;color:var(--txt2)' } });
    const input = el('input', { attrs: { type: 'text', placeholder: '请输入…', style: 'width:100%' } }) as HTMLInputElement;
    if (defaultVal) input.value = defaultVal;
    m.body.append(lbl, input);
    setTimeout(() => input.focus(), 100);
    const ok = el('button', { cls: 'btn primary', text: '确定', attrs: { type: 'button' } });
    const cancel = el('button', { cls: 'btn ghost', text: '取消', attrs: { type: 'button' } });
    ok.addEventListener('click', () => {
      const v = input.value.trim();
      m.close();
      resolve(v || null);
    });
    cancel.addEventListener('click', () => {
      m.close();
      resolve(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { ok.click(); }
    });
    m.foot.append(cancel, ok);
  });
}

/* ---- 表单构建器（必填校验 + 联动校验） ---- */
export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'range' | 'multiselect';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  full?: boolean;
  hint?: string;
}

export interface FormCtrl {
  root: HTMLFormElement;
  values(): Record<string, unknown>;
  check(): boolean;
  setErr(key: string, msg: string): void;
}

export function buildForm(
  fields: FieldDef[],
  initial: Record<string, unknown>,
  extraValidate?: (v: Record<string, unknown>) => Record<string, string>
): FormCtrl {
  const form = el('form', { cls: 'form-grid', attrs: { novalidate: 'novalidate' } });
  const inputs: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLDivElement> = {};
  const multiState: Record<string, Set<string>> = {};
  const errEls: Record<string, HTMLElement> = {};
  const itemEls: Record<string, HTMLElement> = {};

  for (const f of fields) {
    const item = el('div', { cls: `f-item${f.full ? ' full' : ''}` });
    const lab = el('label', { text: f.label });
    if (f.required) lab.appendChild(el('span', { cls: 'req', text: '*' }));
    item.appendChild(lab);
    let input: HTMLElement;
    if (f.type === 'select') {
      const s = el('select');
      for (const o of f.options || []) s.appendChild(el('option', { text: o.label, attrs: { value: o.value } }));
      s.value = initial[f.key] != null ? String(initial[f.key]) : (f.options?.[0]?.value ?? '');
      input = s;
    } else if (f.type === 'textarea') {
      const ta = el('textarea', { text: String(initial[f.key] ?? '') });
      if (f.placeholder) ta.placeholder = f.placeholder;
      input = ta;
    } else if (f.type === 'multiselect') {
      const box = el('div', { cls: 'ms-box' });
      const set = new Set<string>((initial[f.key] as string[]) || []);
      multiState[f.key] = set;
      for (const o of f.options || []) {
        const lb = el('label', { cls: 'ms-item' });
        const cb = el('input', { attrs: { type: 'checkbox', value: o.value } }) as HTMLInputElement;
        cb.checked = set.has(o.value);
        cb.addEventListener('change', () => {
          if (cb.checked) set.add(o.value);
          else set.delete(o.value);
        });
        lb.append(cb, el('span', { text: o.label }));
        box.appendChild(lb);
      }
      input = box;
    } else {
      const inp = el('input', { attrs: { type: f.type } }) as HTMLInputElement;
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.min != null && f.type !== 'date') inp.min = String(f.min);
      if (f.max != null && f.type !== 'date') inp.max = String(f.max);
      if (f.step != null) inp.step = String(f.step);
      const v = initial[f.key];
      inp.value = v == null || v === '' ? (f.type === 'number' || f.type === 'range' ? String(f.min ?? 0) : '') : String(v);
      input = inp;
      if (f.type === 'range') {
        const row = el('div', { cls: 'range-row' });
        const out = el('output', { text: `${inp.value}%` });
        inp.addEventListener('input', () => (out.textContent = `${inp.value}%`));
        row.append(inp, out);
        item.appendChild(row);
        item.appendChild(el('div'));
        inputs[f.key] = inp;
        errEls[f.key] = el('div', { cls: 'f-err' });
        itemEls[f.key] = item;
        item.replaceChild(errEls[f.key], item.lastChild as ChildNode);
        if (f.hint) item.appendChild(el('div', { cls: 'f-hint', text: f.hint }));
        form.appendChild(item);
        inp.addEventListener('input', () => item.classList.remove('err'));
        continue;
      }
    }
    inputs[f.key] = input as HTMLInputElement;
    const err = el('div', { cls: 'f-err' });
    errEls[f.key] = err;
    itemEls[f.key] = item;
    item.append(input, err);
    if (f.hint) item.appendChild(el('div', { cls: 'f-hint', text: f.hint }));
    form.appendChild(item);
    input.addEventListener('input', () => item.classList.remove('err'));
    input.addEventListener('change', () => item.classList.remove('err'));
  }

  function values(): Record<string, unknown> {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === 'multiselect') {
        v[f.key] = Array.from(multiState[f.key] || []);
      } else if (f.type === 'number') {
        const n = parseFloat((inputs[f.key] as HTMLInputElement).value);
        v[f.key] = isNaN(n) ? 0 : n;
      } else if (f.type === 'range') {
        v[f.key] = parseInt((inputs[f.key] as HTMLInputElement).value, 10) || 0;
      } else {
        v[f.key] = String((inputs[f.key] as HTMLInputElement).value ?? '').trim();
      }
    }
    return v;
  }

  function setErr(key: string, msg: string): void {
    itemEls[key]?.classList.add('err');
    if (errEls[key]) errEls[key].textContent = msg;
  }

  function check(): boolean {
    let ok = true;
    const vals = values();
    for (const f of fields) {
      if (f.required) {
        const val = vals[f.key];
        if (val === '' || (Array.isArray(val) && val.length === 0)) {
          setErr(f.key, '必填项，请填写后再提交');
          ok = false;
        }
      }
    }
    if (ok && extraValidate) {
      const errs = extraValidate(vals);
      if (errs && Object.keys(errs).length) {
        for (const [k, m] of Object.entries(errs)) setErr(k, m);
        ok = false;
      }
    }
    return ok;
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  return { root: form, values, check, setErr };
}
