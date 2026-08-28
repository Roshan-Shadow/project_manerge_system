export const DAY = 86400000;

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' → UTC 毫秒（避免时区偏移） */
export function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function todayMs(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(ms: number, n: number): number {
  return ms + n * DAY;
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY);
}

/** 毫秒时长 → 人类可读（分钟/小时/天） */
export function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1 分钟';
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时 ${mins % 60} 分`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}
