export const TIMEZONE = 'America/Chihuahua';
export function parkDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function parkMinute(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(p.find(x => x.type === 'hour')?.value) * 60 + Number(p.find(x => x.type === 'minute')?.value);
}
export function timeLabel(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
export function addDays(date: string, days: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function dateLabel(date: string) { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')); }
export type Booking = { id: string; kiosk: number; date: string; start: number; end: number; mine: boolean; isDemo?: boolean; property?: number; name?: string };
