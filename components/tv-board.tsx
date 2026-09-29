'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { encode } from 'uqr';
import { Maximize, TreePalm, WifiOff } from 'lucide-react';
import { Plate, type SpaceStatus } from '@/components/drone-stage';
import { TvStage } from '@/components/tv-stage';
import { addDays, dateLabel, parkDate, parkMinute, timeLabel, type Booking } from '@/lib/park';
import { AERIAL, SPACES, busyWord, spaceById, type Space } from '@/lib/spaces';

const OPEN = 480, CLOSE = 1320;
/** The tour: the drone view, then every space in plaque order. */
const TOUR: (number | null)[] = [null, ...SPACES.map(s => s.id)];
/** How long each stop stays on screen after landing. */
const HOLD = { aerial: 16000, space: 9000 };
const REFRESH = 15000;
/** Past this age the reservations on screen carry a warning. */
const STALE = 2 * 60000;
const MAX_SLOTS = 4;

// Park clock shared by every render; ticks at the start of each minute.
let clockNow = 0;
function subscribeClock(onChange: () => void) {
  let id = 0;
  const tick = () => { clockNow = Date.now(); onChange(); id = window.setTimeout(tick, 60000 - clockNow % 60000 + 50); };
  tick();
  return () => clearTimeout(id);
}

/** Link the QR code opens: `?link=` when given, else this page's own address (never a loopback one). */
function bookingLink() {
  try {
    const url = new URL(new URLSearchParams(location.search).get('link') || location.origin);
    return /^(localhost|127\.|\[::1\]$)/.test(url.hostname) ? '' : url.href;
  } catch { return ''; }
}
const subscribeNothing = () => () => {};

type Slot = { id: string; start: number; end: number; demo: boolean };
type Day = { slots: Slot[]; busy: boolean; until: number | null };

/** A space's bookings and, when `now` is given, whether it is taken at that minute and until when. */
function dayOf(bookings: Booking[], id: number, now: number | null): Day {
  const slots = bookings.filter(b => b.kiosk === id).sort((a, b) => a.start - b.start).map(b => ({ id: b.id, start: b.start, end: b.end, demo: !!b.isDemo }));
  const current = now == null ? undefined : slots.find(s => s.start <= now && now < s.end);
  if (!current) return { slots, busy: false, until: now == null ? null : slots.find(s => s.start > now)?.start ?? null };
  // Back-to-back bookings keep it taken.
  let until = current.end;
  for (const s of slots) if (s.start === until) until = s.end;
  return { slots, busy: true, until };
}

/** Upcoming bookings first; earlier ones of the day fill any room left. */
function pick(slots: Slot[], minute: number | null) {
  const later = minute == null ? slots : slots.filter(s => s.end > minute);
  const room = MAX_SLOTS - later.length;
  const past = room > 0 ? slots.slice(0, slots.length - later.length).slice(-room) : [];
  return { shown: [...past, ...later.slice(0, MAX_SLOTS)], more: Math.max(later.length - MAX_SLOTS, 0) };
}

/** A host name that may wrap only after its dots (and hyphens), never mid-word. */
function Host({ name }: { name: string }) {
  return name.split('.').map((part, i) => <Fragment key={i}>{i > 0 && <>.<wbr/></>}{part}</Fragment>);
}

/** The board's backdrop: the scene on screen, heavily blurred, fading to the next stop as the drone flies there. */
function Ambient({ scene }: { scene: number | null }) {
  return <div className="tv-ambient" aria-hidden="true">
    <img src={AERIAL.src} alt="" decoding="async" className={scene == null ? 'shown' : ''}/>
    {SPACES.map(s => <img key={s.id} src={s.photo} alt="" decoding="async" className={scene === s.id ? 'shown' : ''}/>)}
  </div>;
}

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 0 });
    return { size: data.length, d: data.flatMap((row, y) => row.map((on, x) => on ? `M${x} ${y}h1v1h-1z` : '')).join('') };
  }, [text]);
  return <svg className="tv-qr-code" viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges" aria-hidden="true"><path d={path.d}/></svg>;
}

export function TvBoard() {
  const clock = useSyncExternalStore(subscribeClock, () => clockNow, () => 0);
  const today = clock ? parkDate(new Date(clock)) : '';
  const minute = clock ? parkMinute(new Date(clock)) : 0;
  // Before opening the board shows the day ahead; after closing, tomorrow.
  const phase = minute < OPEN ? 'before' : minute < CLOSE ? 'open' : 'after';
  const date = today && (phase === 'after' ? addDays(today, 1) : today);
  const now = phase === 'open' ? minute : null;
  const pastBefore = phase === 'after' ? null : minute;
  const link = useSyncExternalStore(subscribeNothing, bookingLink, () => '');

  const [data, setData] = useState<{ date: string; bookings: Booking[]; at: number } | null>(null);
  useEffect(() => {
    if (!date) return;
    // One request at a time, each given up after 10 seconds, so a screen left on for weeks never piles them up.
    let request: AbortController | null = null, stopped = false;
    async function load() {
      if (request) return;
      const attempt = request = new AbortController(), timer = setTimeout(() => attempt.abort(), 10000);
      try {
        const r = await fetch(`/api/reservations?date=${date}`, { signal: attempt.signal });
        if (!r.ok) return;
        const { bookings } = await r.json() as { bookings: Booking[] };
        // A public screen keeps only what every visitor may see, even if this browser made some of the bookings.
        if (!stopped) setData({ date, at: Date.now(), bookings: bookings.map(({ id, kiosk, date, start, end, isDemo }) => ({ id, kiosk, date, start, end, isDemo, mine: false })) });
      } catch { /* keep what is on screen; the header warns once it is stale */ }
      finally { clearTimeout(timer); request = null; }
    }
    load();
    const id = setInterval(load, REFRESH);
    return () => { stopped = true; request?.abort(); clearInterval(id); };
  }, [date]);
  const current = data?.date === date ? data : null;
  const stale = !!current && clock - current.at > STALE;
  const days = useMemo(() => new Map(SPACES.map(s => [s.id, dayOf(current?.bookings ?? [], s.id, now)])), [current, now]);
  const dayAt = (id: number) => days.get(id)!;
  const statusOf = (id: number): SpaceStatus => !current || now == null ? 'unknown' : dayAt(id).busy ? 'busy' : 'free';

  // The tour holds each stop once it has landed; the longer fallback keeps it moving should a flight never report back.
  const [step, setStep] = useState(0);
  const [landed, setLanded] = useState(-1);
  useEffect(() => {
    const hold = TOUR[step] == null ? HOLD.aerial : HOLD.space;
    const id = setTimeout(() => { setLanded(-1); setStep(s => (s + 1) % TOUR.length); }, landed === step ? hold : hold + 15000);
    return () => clearTimeout(id);
  }, [step, landed]);
  const onSettled = useCallback((view: number | null) => setLanded(TOUR.indexOf(view)), []);
  const view = TOUR[step];

  // Mouse movement reveals the pointer and a full-screen button for a few seconds; F toggles full screen.
  const [pointer, setPointer] = useState(false);
  useEffect(() => {
    let id = 0;
    const move = () => { setPointer(true); clearTimeout(id); id = window.setTimeout(() => setPointer(false), 3000); };
    const key = (e: KeyboardEvent) => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('keydown', key); clearTimeout(id); };
  }, []);

  // Keep the screen awake where the browser allows it (secure pages only).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then(l => { lock = l; }, () => undefined); };
    request();
    document.addEventListener('visibilitychange', request);
    return () => { document.removeEventListener('visibilitychange', request); lock?.release().catch(() => undefined); };
  }, []);

  // Reload once a night, after 04:00, to pick up updates and start fresh; only while the server answers.
  const openedOn = useRef('');
  useEffect(() => {
    if (!today) return;
    openedOn.current ||= today;
    if (today === openedOn.current || minute < 240) return;
    fetch(location.href, { cache: 'no-store' }).then(r => { if (r.ok) location.reload(); }, () => undefined);
  }, [today, minute]);

  // Right now: taken or free, and until when. Outside opening hours only a day without bookings needs a line.
  const statusLine = (s: Space, day: Day) => {
    if (!current) return <p className="tv-status unknown"><b>Consultando…</b></p>;
    if (now == null) return day.slots.length ? null : <p className="tv-status free"><b>Sin reservas</b></p>;
    return <p className={`tv-status ${day.busy ? 'busy' : 'free'}`}>
      <b>{day.busy ? busyWord(s.id) : 'Libre'}</b>
      <span>{day.until != null ? `hasta las ${timeLabel(day.until)}` : day.slots.length ? 'el resto del día' : 'todo el día'}</span>
    </p>;
  };
  const slotList = (day: Day) => {
    const { shown, more } = pick(day.slots, pastBefore);
    if (!current || !shown.length) return null;
    return <ul className="tv-slots">
      {shown.map(slot => {
        const state = pastBefore != null && slot.end <= pastBefore ? 'past' : now != null && slot.start <= now ? 'now' : '';
        return <li key={slot.id} className={state}>{timeLabel(slot.start)}–{timeLabel(slot.end)}{slot.demo && <i aria-label="reserva de prueba">*</i>}</li>;
      })}
      {more > 0 && <li className="more">+{more} más</li>}
    </ul>;
  };
  const caption = (id: number) => {
    const s = spaceById(id), day = dayAt(id), slots = slotList(day);
    return <div className="tv-caption">
      <h2><Plate space={s} palm className="tv-caption-plate"/>{s.title}</h2>
      <p>{s.blurb}</p>
      {statusLine(s, day)}
      {slots && <div className="tv-caption-day"><span>{phase === 'after' ? 'Mañana' : 'Hoy'}</span>{slots}</div>}
    </div>;
  };
  const demo = !!current?.bookings.some(b => b.isDemo);

  return <div className="tv-screen" data-pointer={pointer || undefined}>
    <TvStage view={view} upcoming={TOUR[(step + 1) % TOUR.length]} statusOf={statusOf} legend={now != null && !!current} caption={caption} onSettled={onSettled}/>

    <section className="tv-panel" aria-labelledby="tv-title">
      <Ambient scene={view}/>
      <header className="tv-head">
        <div>
          <p className="tv-brand"><TreePalm/>oasis<span>park</span></p>
          <h1 id="tv-title">Reserva de palapas</h1>
          {stale && current ? <p className="tv-offline" role="status"><WifiOff/>Sin conexión desde las {timeLabel(parkMinute(new Date(current.at)))}</p>
            : <p className="tv-date">{date && `${phase === 'after' ? 'Mañana' : 'Hoy'} · ${dateLabel(date)}`}</p>}
        </div>
        <time className="tv-clock" dateTime={clock ? new Date(clock).toISOString() : undefined}>{clock ? timeLabel(minute) : ''}</time>
      </header>
      {phase !== 'open' && date && <p className="tv-closed" role="status">Cerrado · Abre {phase === 'after' ? 'mañana' : 'hoy'} a las 08:00</p>}
      <ul className="tv-list">
        {SPACES.map(s => {
          const day = dayAt(s.id), status = statusOf(s.id);
          return <li key={s.id} className={`tv-row ${status} ${view === s.id ? 'shown' : ''}`}>
            <Plate space={s}/>
            <div className="tv-row-main">
              <div className="tv-row-top"><h2>{s.kind === 'palapa' ? s.name : s.title}</h2>{statusLine(s, day)}</div>
              {slotList(day)}
            </div>
          </li>;
        })}
      </ul>
      <footer className="tv-foot">
        {link && <QrCode text={link}/>}
        <div>
          {link && <p className="tv-book"><b>Reserva desde tu celular</b><Host name={new URL(link).host}/></p>}
          <p className="tv-notes"><span>Abierto de 08:00 a 22:00</span> · <span>Sin nombres, por privacidad</span></p>
          {demo && <p className="tv-notes">* Reserva de prueba</p>}
        </div>
      </footer>
    </section>
    <button type="button" className="tv-fullscreen" onClick={toggleFullscreen} tabIndex={pointer ? 0 : -1}><Maximize/>Pantalla completa</button>
  </div>;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  else document.documentElement.requestFullscreen().catch(() => undefined);
}
