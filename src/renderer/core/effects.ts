/** 背景粒子光点：缓慢上浮 + sin 摆动，约 30fps 节流，页面隐藏时暂停；配色随主题联动 */
import { getTheme } from './theme.js';

interface P {
  x: number;
  y: number;
  r: number;
  s: number;
  ph: number;
  a: number;
  warm: boolean;
}

function spawn(): P {
  return {
    x: Math.random(),
    y: Math.random(),
    r: 0.6 + Math.random() * 1.8,
    s: 0.008 + Math.random() * 0.02,
    ph: Math.random() * Math.PI * 2,
    a: 0.12 + Math.random() * 0.38,
    warm: Math.random() > 0.35
  };
}

export function initEffects(): void {
  const cvMaybe = document.getElementById('fx-particles');
  if (!(cvMaybe instanceof HTMLCanvasElement)) return;
  const ctxMaybe = cvMaybe.getContext('2d');
  if (!ctxMaybe) return;
  const cv: HTMLCanvasElement = cvMaybe;
  const ctx: CanvasRenderingContext2D = ctxMaybe;
  const dpr = window.devicePixelRatio || 1;
  const parts: P[] = Array.from({ length: 64 }, spawn);
  let last = 0;

  function resize(): void {
    cv.width = Math.round(window.innerWidth * dpr);
    cv.height = Math.round(window.innerHeight * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  function draw(ts: number): void {
    requestAnimationFrame(draw);
    if (document.hidden) return;
    if (ts - last < 33) return; // ~30fps，非关键元素降低动画强度
    last = ts;
    const w = cv.width / dpr;
    const h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = ts / 1000;
    const th = getTheme();
    for (const p of parts) {
      p.y -= p.s * 0.05;
      if (p.y < -0.02) Object.assign(p, spawn(), { y: 1.02 });
      const x = (p.x + Math.sin(t * 0.5 + p.ph) * 0.012) * w;
      const y = p.y * h;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, 6.2832);
      ctx.fillStyle = (p.warm ? th.particle.warm : th.particle.cool) + p.a + ')';
      ctx.shadowColor = p.warm ? th.particle.warmShadow : th.particle.coolShadow;
      ctx.shadowBlur = 6;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  requestAnimationFrame(draw);
}
