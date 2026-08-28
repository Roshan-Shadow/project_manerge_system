import { initEffects } from './core/effects.js';
import { initTheme } from './core/theme.js';
import { renderApp } from './core/app.js';

initTheme(); // 最早期恢复主题偏好，避免首帧闪烁（PRD §8.3）
initEffects();
renderApp().then(
  () => console.log('[pms-ready] app booted'),
  (err) => console.error('[pms-ready] boot failed', err)
);
