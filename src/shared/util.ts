export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
