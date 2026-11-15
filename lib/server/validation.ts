export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function requiredText(value: unknown, label: string, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, `${label}不能为空，且最多 ${max} 个字符`);
  }
  return value.trim();
}
export function gameId(value: unknown): string {
  const result = requiredText(value, '游戏 ID', 40);
  if (/\s/.test(result)) throw new HttpError(400, '游戏 ID 不能包含空格');
  return result;
}
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label}须为 ${min} 至 ${max} 的整数`);
  return value;
}
export function coordinates(body: Record<string, unknown>) {
  return {x: integer(body.x, 'X 坐标', -30000000, 30000000), y: integer(body.y, 'Y 坐标', -30000000, 30000000), z: integer(body.z, 'Z 坐标', -30000000, 30000000)};
}
export function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0,4) < '1900' || value.slice(0,4) > '2200') throw new HttpError(400, '请选择有效日期');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new HttpError(400, '请选择有效日期');
  return value;
}
export function priceValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000000000) throw new HttpError(400, '价格须为大于 0 且不超过 1 万亿的数字');
  return value;
}

export function optionalText(value: unknown, label: string, max = 100): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式不正确`);
  if (!value.trim()) return '';
  return requiredText(value, label, max);
}
