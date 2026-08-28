/** 补间动画工具：数值插值（图表数据过渡），CSS 过渡统一走 var(--ease) */
export const EASE_TWEEN = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function easeOut(k: number): number {
  return 1 - Math.pow(1 - k, 3);
}

export interface TweenCtrl {
  cancel(): void;
}

export function tween(dur: number, fn: (k: number) => void, ease = easeOut): TweenCtrl {
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    fn(ease(k));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    cancel: () => cancelAnimationFrame(raf)
  };
}

/** 高分屏 Canvas 尺寸对齐，返回 2D 上下文与逻辑宽高 */
export function prepCanvas(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  const w = Math.max(rect.width, 10);
  const h = Math.max(rect.height, 10);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
