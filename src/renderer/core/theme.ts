/** 多主题体系（PRD §8.3）：四套主题，CSS 自定义属性换色 + Canvas/粒子/Monaco 联动 */
export interface ThemeDef {
  id: string;
  label: string;
  desc: string;
  dark: boolean;
  swatch: [string, string];
  /** Canvas 图表主强调色（对应 --neon）与高光色（对应 --gold-hi） */
  accent1: string;
  accent2: string;
  /** 粒子光点配色（前缀字符串，绘制时拼接透明度） */
  particle: { warm: string; cool: string; warmShadow: string; coolShadow: string };
  monacoTheme: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'ember',
    label: '熔金战情',
    desc: '橙红 × 暖金（默认）',
    dark: true,
    swatch: ['#ff5a2d', '#ffd479'],
    accent1: '#ff5a2d',
    accent2: '#ffd479',
    particle: {
      warm: 'rgba(255,190,110,',
      cool: 'rgba(255,110,60,',
      warmShadow: 'rgba(255,180,90,.8)',
      coolShadow: 'rgba(255,90,40,.8)'
    },
    monacoTheme: 'pms-dark'
  },
  {
    id: 'azure',
    label: '深海蓝讯',
    desc: '冰蓝 × 青辉',
    dark: true,
    swatch: ['#3d8bff', '#b7dcff'],
    accent1: '#3d8bff',
    accent2: '#b7dcff',
    particle: {
      warm: 'rgba(150,205,255,',
      cool: 'rgba(80,140,255,',
      warmShadow: 'rgba(140,195,255,.8)',
      coolShadow: 'rgba(70,130,255,.8)'
    },
    monacoTheme: 'pms-dark'
  },
  {
    id: 'verdant',
    label: '翡翠方舟',
    desc: '翠绿 × 薄荷',
    dark: true,
    swatch: ['#2bd489', '#c2f5d8'],
    accent1: '#2bd489',
    accent2: '#c2f5d8',
    particle: {
      warm: 'rgba(160,240,200,',
      cool: 'rgba(60,210,140,',
      warmShadow: 'rgba(150,230,190,.8)',
      coolShadow: 'rgba(50,200,130,.8)'
    },
    monacoTheme: 'pms-dark'
  },
  {
    id: 'dawn',
    label: '曙光白域',
    desc: '米白基底 × 暖橙点缀',
    dark: false,
    swatch: ['#e0521f', '#a2660f'],
    accent1: '#e0521f',
    accent2: '#a2660f',
    particle: {
      warm: 'rgba(200,120,50,',
      cool: 'rgba(224,82,31,',
      warmShadow: 'rgba(210,130,60,.7)',
      coolShadow: 'rgba(224,82,31,.6)'
    },
    monacoTheme: 'pms-light'
  }
];

const STORAGE_KEY = 'pms-theme';
let cur: ThemeDef = THEMES[0];

export function getTheme(): ThemeDef {
  return cur;
}

export function applyTheme(id: string, persist = true): void {
  const t = THEMES.find((x) => x.id === id);
  if (!t || t.id === cur.id) {
    // 启动恢复时也需保证 body 标记与广播一致
    if (t && document.body.dataset.theme !== t.id) {
      document.body.dataset.theme = t.id;
    }
    return;
  }
  cur = t;
  document.body.dataset.theme = t.id;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, t.id);
    } catch {
      /* localStorage 不可用时静默降级为会话内主题 */
    }
  }
  window.dispatchEvent(new CustomEvent('pms-theme-change', { detail: t.id }));
}

/** 启动最早期调用：恢复偏好，避免首帧主题闪烁 */
export function initTheme(): void {
  let saved = 'ember';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'ember';
  } catch {
    /* ignore */
  }
  const t = THEMES.find((x) => x.id === saved) || THEMES[0];
  cur = t;
  document.body.dataset.theme = t.id;
}

/** '#rrggbb' + 透明度 → rgba() 字符串（Canvas 渐变用） */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
