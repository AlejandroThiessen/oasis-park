'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Drone, TreePalm, Volleyball } from 'lucide-react';
import { AERIAL, SPACES, busyWord, objectPosition, spaceById, type Space } from '@/lib/spaces';
import { DroneEngine, type FlightState } from '@/lib/drone-engine';

export type SpaceStatus = 'free' | 'busy' | 'unknown';

/** Lucide-style soccer ball (lucide has no football icon). */
function SoccerBall() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 7.8 16 10.7l-1.53 4.7H9.53L8 10.7Z"/>
    <path d="M12 7.8V2M16 10.7l5.5-1.8M14.47 15.4l3.4 4.7M9.53 15.4l-3.4 4.7M8 10.7 2.5 8.9"/>
  </svg>;
}

/** Number plaque styled after the signs hanging in each palapa. */
export function Plate({ space, palm = false, className = '' }: { space: Space; palm?: boolean; className?: string }) {
  return <span className={`plate plate-${space.kind} ${className}`} aria-hidden="true">
    {space.plate ? <b>{space.plate}</b> : space.kind === 'cancha' ? <Volleyball/> : <SoccerBall/>}
    {palm && <TreePalm className="plate-palm"/>}
  </span>;
}

const at = (x: number, y: number) => ({ left: `${x / AERIAL.width * 100}%`, top: `${y / AERIAL.height * 100}%` });
const step = (id: number, dir: number) => SPACES[(SPACES.findIndex(s => s.id === id) + dir + SPACES.length) % SPACES.length];

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => { const m = window.matchMedia(motionQuery); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };

export function DroneStage({ view, selected, statusOf, describe, onSelect, onHome }: {
  /** Space to show at ground level, or null for the drone view. */
  view: number | null;
  selected: number;
  statusOf: (id: number) => SpaceStatus;
  /** Availability line for the ground caption, e.g. "Disponible · 16:00–18:00". */
  describe: (id: number) => string;
  onSelect: (id: number) => void;
  onHome: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aerialRef = useRef<HTMLImageElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const photos = useRef(new Map<number, HTMLImageElement>());
  const pins = useRef(new Map<number, HTMLButtonElement>());
  const hud = useRef<{ root?: HTMLElement | null; speed?: HTMLElement | null; alt?: HTMLElement | null }>({});
  const engineRef = useRef<DroneEngine | null>(null);
  const viewRef = useRef(view);
  const actions = useRef({ onSelect, onHome });
  const restoreFocus = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [engineOn, setEngineOn] = useState(false);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [aspect, setAspect] = useState(AERIAL.width / 1000);
  const [preload, setPreload] = useState(false);
  const [broken, setBroken] = useState<number[]>([]);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);

  // With the engine flying, show what it reports; otherwise simply follow `view`.
  const trusted = engineOn && !reduced && flight && (flight.mode === 'flight' || flight.at === view);
  const live: FlightState = trusted ? flight : { mode: view == null ? 'aerial' : 'ground', at: view, from: null, photoOk: true };
  const photoFailed = live.mode === 'ground' && (!live.photoOk || (live.at != null && broken.includes(live.at)));
  const shown = live.at == null ? null : spaceById(live.at);
  const wantPhotos = preload || view != null;

  useEffect(() => {
    const canvas = canvasRef.current, aerial = aerialRef.current;
    if (!canvas || !aerial) return;
    let engine: DroneEngine | null = null, stopped = false;
    const start = () => {
      if (stopped) return;
      engine = DroneEngine.create(canvas, aerial, id => photos.current.get(id) ?? null);
      if (!engine) return;
      const e = engine;
      e.onState = setFlight;
      e.onFrame = ({ kmh, altitude, waiting }) => {
        const h = hud.current;
        if (h.speed) h.speed.textContent = String(Math.round(kmh));
        if (h.alt) h.alt.textContent = altitude < 10 ? altitude.toFixed(1) : String(Math.round(altitude));
        h.root?.toggleAttribute('data-waiting', waiting);
      };
      e.setRest(viewRef.current);
      const box = stageRef.current?.getBoundingClientRect();
      if (box) e.resize(box.width, box.height);
      canvas.addEventListener('webglcontextlost', () => setEngineOn(false), { once: true });
      engineRef.current = e;
      setEngineOn(true);
    };
    if (aerial.complete && aerial.naturalWidth) aerial.decode().catch(() => undefined).then(start);
    else aerial.addEventListener('load', start, { once: true });
    return () => {
      stopped = true;
      aerial.removeEventListener('load', start);
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      setAspect(Math.round(width / height * 1000) / 1000);
      engineRef.current?.resize(width, height);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setPreload(true), 2500);
    return () => clearTimeout(id);
  }, []);

  // Fly whenever the requested view changes, covering the stage before the browser paints.
  useLayoutEffect(() => {
    viewRef.current = view;
    const engine = engineRef.current;
    // A pin or button that started the change is about to become inert; move focus once the view settles.
    const focusInside = !!stageRef.current?.contains(document.activeElement);
    if (!engine || !engineOn || reduced) { engine?.setRest(view); restoreFocus.current ||= focusInside; return; }
    if (engine.flyTo(view)) restoreFocus.current ||= focusInside;
  }, [view, engineOn, reduced]);

  // Once landed, let the crisp HTML view paint, then fade the flight canvas away.
  useEffect(() => {
    const engine = engineRef.current;
    if (live.mode === 'flight') return;
    let active = true;
    const img = live.mode === 'ground' && live.at != null ? photos.current.get(live.at) : aerialRef.current;
    if (engine) Promise.resolve(img?.decode()).catch(() => undefined).then(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (active) engine.reveal(); })));
    if (restoreFocus.current) {
      restoreFocus.current = false;
      (live.mode === 'ground' ? backRef.current : pins.current.get(selected))?.focus({ preventScroll: true });
    }
    return () => { active = false; };
  }, [live.mode, live.at, selected]);

  // Escape climbs back and arrows fly to the neighbours. Listening on the document also covers
  // Safari, which does not focus a tapped button, while leaving keys to any other focused control.
  useEffect(() => { actions.current = { onSelect, onHome }; });
  const groundId = live.mode === 'ground' ? live.at : null;
  useEffect(() => {
    if (live.mode === 'aerial') return;
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (active && active !== document.body && !stageRef.current?.contains(active))) return;
      if (e.key === 'Escape') { e.preventDefault(); actions.current.onHome(); }
      else if (groundId != null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); actions.current.onSelect(step(groundId, e.key === 'ArrowLeft' ? -1 : 1).id); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [live.mode, groundId]);

  const prepare = (id: number) => { setPreload(true); engineRef.current?.prepare(id); };
  // While taking off, the fading ground controls keep describing the space being left.
  const captioned = live.mode === 'flight' ? (live.from == null ? null : spaceById(live.from)) : shown;
  const prev = captioned ? step(captioned.id, -1) : null, next = captioned ? step(captioned.id, 1) : null;
  const status = captioned ? statusOf(captioned.id) : 'unknown';

  return <div ref={stageRef} className="drone-stage" data-mode={live.mode} data-engine={engineOn && !reduced ? 'webgl' : 'css'}
    onPointerEnter={() => setPreload(true)}>
    <div className="aerial-layer" inert={live.mode !== 'aerial'} aria-hidden={live.mode !== 'aerial'}>
      <div className="aerial-plane">
        <img ref={aerialRef} className="aerial-img" src={AERIAL.src} width={AERIAL.width} height={AERIAL.height} fetchPriority="high" draggable={false}
          alt="Vista de dron de Oasis Park: el lago con la Palapa 6 en la isla, cinco palapas alrededor, la cancha y el campo de fútbol al norte."/>
        <span className="landmark" style={at(664, 1047)}>Baños</span>
        {SPACES.map(s => {
          const st = statusOf(s.id);
          return <button key={s.id} type="button" ref={el => { if (el) pins.current.set(s.id, el); else pins.current.delete(s.id); }}
            className={`plate-pin ${st} ${selected === s.id ? 'selected' : ''}`} style={at(...s.pin)}
            onClick={() => onSelect(s.id)} onPointerEnter={() => prepare(s.id)} onFocus={() => prepare(s.id)} aria-pressed={selected === s.id}
            aria-label={`${s.title}${st === 'busy' ? `, ${busyWord(s.id).toLowerCase()}` : st === 'free' ? ', disponible' : ''}. Volar hasta aquí`}>
            <Plate space={s}/>{s.kind !== 'palapa' && <span className="pin-label">{s.name}</span>}
          </button>;
        })}
      </div>
      <div className="aerial-badge"><Drone size={16}/><span>Vista de dron<small>Toca un número para volar</small></span></div>
    </div>

    <div className="ground-layer">
      {SPACES.map(s => {
        const [ox, oy] = objectPosition(s, aspect), visible = live.mode === 'ground' && live.at === s.id;
        return <img key={s.id} ref={el => { if (el) photos.current.set(s.id, el); else photos.current.delete(s.id); }}
          className={`ground-photo ${visible ? 'shown' : ''}`} src={wantPhotos || s.id === live.at ? s.photo : undefined} alt={visible ? s.alt : ''} aria-hidden={!visible}
          width={s.photoSize[0]} height={s.photoSize[1]} decoding="async" draggable={false} style={{ objectPosition: `${ox * 100}% ${oy * 100}%` }}
          onError={() => setBroken(b => b.includes(s.id) ? b : [...b, s.id])}/>;
      })}
    </div>

    <canvas ref={canvasRef} className="flight-canvas" aria-hidden="true"/>

    <div className="drone-hud" ref={el => { hud.current.root = el; }} aria-hidden="true">
      <span className="hud-rec"><i/>En vuelo</span>
      <span className="hud-readout">
        <span>VEL <b ref={el => { hud.current.speed = el; }}>0</b> km/h</span>
        <span>ALT <b ref={el => { hud.current.alt = el; }}>100</b> m</span>
      </span>
      <span className="hud-reticle"/>
      <span className="hud-dest">{shown ? `Destino · ${shown.title}` : 'Regresando a la vista de dron'}</span>
      <span className="hud-wait">Cargando foto…</span>
    </div>

    <div className="ground-ui" inert={live.mode !== 'ground'} aria-hidden={live.mode !== 'ground'}
      onPointerDown={e => { swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; }}
      onPointerUp={e => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || !shown) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) onSelect(step(shown.id, dx < 0 ? 1 : -1).id);
      }}>
      <button ref={backRef} type="button" className="back-to-drone" onClick={onHome}><Drone size={18}/>Vista de dron</button>
      {prev && <button type="button" className="stage-arrow prev" onClick={() => onSelect(prev.id)} onPointerEnter={() => prepare(prev.id)} aria-label={`Volar a ${prev.title}`}><ChevronLeft size={24}/></button>}
      {next && <button type="button" className="stage-arrow next" onClick={() => onSelect(next.id)} onPointerEnter={() => prepare(next.id)} aria-label={`Volar a ${next.title}`}><ChevronRight size={24}/></button>}
      {captioned && <div className="ground-caption">
        <Plate space={captioned} palm className="caption-plate"/>
        <div className="caption-text">
          <h2>{captioned.title}</h2>
          <p>{captioned.blurb}</p>
          <ul className="feature-list" aria-label="Qué encontrarás">{captioned.features.map(f => <li key={f}>{f}</li>)}</ul>
        </div>
      </div>}
      {captioned && <span className={`ground-status ${status}`}>{describe(captioned.id)}</span>}
      {photoFailed && <p className="photo-failed" role="status">No pudimos cargar la foto. Puedes volver a la vista de dron.</p>}
    </div>
    <p className="sr-only" aria-live="polite">{live.mode === 'ground' && shown ? `${shown.title}. ${shown.blurb}` : ''}</p>
  </div>;
}
