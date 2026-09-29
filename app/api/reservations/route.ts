import { getRawDb } from '@/db';
import { z } from 'zod';
import { parkDate, parkMinute, addDays } from '@/lib/park';
import { SPACE_IDS } from '@/lib/spaces';

const headers = { 'Cache-Control': 'no-store' };
function json(data: unknown, status = 200) { return Response.json(data, { status, headers }); }
function ownerOf(req: Request) { return req.headers.get('cookie')?.match(/(?:^|;\s*)oasis_device=([a-f0-9-]{36})(?:;|$)/)?.[1] ?? ''; }
function validDate(date: unknown): date is string { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date; }
function sameOrigin(req: Request) { const origin = req.headers.get('origin'); return !origin || origin === new URL(req.url).origin; }

export async function GET(req: Request) {
  const url = new URL(req.url), owner = ownerOf(req), mine = url.searchParams.get('mine') === '1';
  const date = url.searchParams.get('date') || parkDate();
  if (!validDate(date)) return json({ error: 'Elige una fecha válida.' }, 400);
  try {
    const db = getRawDb();
    const { results } = await (mine
      ? db.prepare('SELECT * FROM bookings WHERE owner = ? AND date >= ? ORDER BY date, start').bind(owner, parkDate())
      : db.prepare('SELECT * FROM bookings WHERE date = ? ORDER BY start').bind(date)).all();
    return json({ bookings: results.map(r => ({ id: r.id, kiosk: r.kiosk, date: r.date, start: r.start, end: r.end, mine: r.owner === owner, isDemo: String(r.name).startsWith('[PRUEBA] '), ...(r.owner === owner ? { name: r.name, property: r.property } : {}) })) });
  } catch (e) { console.error(e); return json({ error: 'No pudimos consultar las reservas. Intenta de nuevo.' }, 503); }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Solicitud no permitida.' }, 403);
  let data;
  try { data = await req.json(); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
  const parsed = z.object({ kiosk: z.number().int(), date: z.string(), start: z.number().int(), end: z.number().int(), name: z.string(), property: z.number().int() }).safeParse(data);
  if (!parsed.success) return json({ error: 'Revisa los datos de tu reserva.' }, 400);
  const { kiosk, date, start, end, name, property } = parsed.data;
  if (!SPACE_IDS.includes(kiosk) || !validDate(date) || date < parkDate() || date > addDays(parkDate(),90) || !Number.isInteger(start) || !Number.isInteger(end) || start < 480 || end > 1320 || start % 30 || end % 30 || end <= start || end - start > 240 || (date === parkDate() && start <= parkMinute()) || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || !Number.isInteger(property) || property < 1 || property > 200) {
    return json({ error: 'Revisa tus datos. Reserva de 08:00 a 22:00, hasta 4 horas, en una fecha futura (máximo 90 días).' }, 400);
  }
  const owner = ownerOf(req) || crypto.randomUUID(), id = crypto.randomUUID();
  try {
    const db = getRawDb();
    const queries = [db.prepare('INSERT INTO bookings (id, owner, name, property, kiosk, date, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, owner, name.trim(), property, kiosk, date, start, end)];
    for (let minute = start; minute < end; minute += 30) queries.push(db.prepare('INSERT INTO slots (booking, kiosk, date, minute) VALUES (?, ?, ?, ?)').bind(id, kiosk, date, minute));
    await db.batch(queries);
    return Response.json({ id }, { status: 201, headers: { ...headers, 'Set-Cookie': `oasis_device=${owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` } });
  } catch (e) {
    if (String(e).includes('UNIQUE constraint')) return json({ error: 'Alguien reservó este horario. Elige otro espacio u horario.' }, 409);
    console.error(e); return json({ error: 'No pudimos guardar tu reserva. Intenta de nuevo.' }, 503);
  }
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Solicitud no permitida.' }, 403);
  const id = new URL(req.url).searchParams.get('id'), owner = ownerOf(req);
  if (!id || !owner) return json({ error: 'No se encontró tu reserva en este dispositivo.' }, 403);
  try {
    const result = await getRawDb().prepare('DELETE FROM bookings WHERE id = ? AND owner = ?').bind(id, owner).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'No se encontró tu reserva en este dispositivo.' }, 404);
  } catch (e) { console.error(e); return json({ error: 'No pudimos cancelar tu reserva. Intenta de nuevo.' }, 503); }
}
