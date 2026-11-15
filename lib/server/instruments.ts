import { HttpError } from './validation';
export const INSTRUMENTS: readonly string[] = Object.freeze(['钢琴','清音电吉他','木吉他','萨克斯','小提琴','大提琴','贝斯','竖笛','鼓组','失真电吉他']);
export function validateInstruments(value: unknown): string[] {
 if (!Array.isArray(value) || !value.length || value.length > INSTRUMENTS.length || value.some(v=>typeof v!=='string'||!INSTRUMENTS.includes(v))) throw new HttpError(400,'请选择有效的乐器');
 return [...new Set(value as string[])];
}
export function storedInstruments(value: unknown): string[] {
 try { const parsed=JSON.parse(String(value)); if(Array.isArray(parsed)&&parsed.length&&parsed.every(v=>typeof v==='string'))return parsed; }catch{}
 return ['钢琴'];
}
