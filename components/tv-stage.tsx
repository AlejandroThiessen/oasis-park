'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Drone } from 'lucide-react';
import { Plate, type SpaceStatus } from '@/components/drone-stage';
import { AERIAL, SPACES, objectPosition, spaceById } from '@/lib/spaces';
import { DroneEngine, type Cam, type FlightState } from '@/lib/drone-engine';

// The park spans x 52–1052 and y 262–1342 of the aerial photo; the drone view frames as much of it as the
// stage's shape allows. On the wide TV stage that is the photo's full width and y 312–1268: every pin, with
// room for the slow drift.
const PARK = { x: 584, y: 790, w: 1000, h: 1080 };
/** Shape of the stage on the 1920 × 1080 screen (1320 × 1080, in tv.css), until it is measured. */
const STAGE_ASPECT = 1320 / 1080;
/** The screen hangs where the board did, on the restrooms ("Usted está aquí" on the park's map). */
const HERE: [number, number] = [664, 1047];
/** Flights take about twice as long as on the booking page: calmer to watch from across the room. */
const PACE = 2;

/** Drone-view camera for a stage of the given aspect: the whole park, without leaving the photo. */
function homeFor(aspect: number): Cam {
  const w = Math.min(Math.max(PARK.w, PARK.h * aspect), AERIAL.width, AERIAL.height * aspect), h = w / aspect;
  return { x: Math.min(Math.max(PARK.x, w / 2), AERIAL.width - w / 2), y: Math.min(Math.max(PARK.y, h / 2), AERIAL.height - h / 2), lw: Math.log(w) };
}

const matrixOf = (el: Element) => { const t = getComputedStyle(el).transform; return new DOMMatrixReadOnly(t === 'none' ? undefined : t); };

/** Camera that shows what the drifting drone view shows right now, so a flight starts without a jump. */
function driftCam(drift: HTMLElement, home: Cam): Cam {
  const m = matrixOf(drift), k = m.a || 1, w = drift.clientWidth, h = drift.clientHeight;
  const [ox, oy] = getComputedStyle(drift).transformOrigin.split(' ').map(parseFloat);
  // The drift maps a point p of the plane to o + k(p - o) + t; find the point now at the centre.
  const px = ox + (w / 2 - ox - m.e) / k, py = oy + (h / 2 - oy - m.f) / k, perPx = Math.exp(home.lw) / w;
  return { x: home.x + (px - w / 2) * perPx, y: home.y + (py - h / 2) * perPx, lw: home.lw - Math.log(k) };
}

const at = (x: number, y: number) => ({ left: `${x / AERIAL.width * 100}%`, top: `${y / AERIAL.height * 100}%` });
const resting = (view: number | null): FlightState => ({ mode: view == null ? 'aerial' : 'ground', at: view, from: null, photoOk: true });

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => { const m = window.matchMedia(motionQuery); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };

/** The park screen's drone view: the whole park with live status pins, flying down to each space in turn. */
export function TvStage({ view, upcoming, statusOf, legend, caption, onSettled }: {
  /** Space shown at ground level, or null for the drone view. */
  view: number | null;
  /** Next stop of the tour; its photo is prepared ahead of the flight. */
  upcoming: number | null;
  statusOf: (id: number) => SpaceStatus;
  /** Explain the pin colours on the drone view. */
  legend: boolean;
  caption: (id: number) => ReactNode;
  /** Called once the requested view has landed and is on screen. */
  onSettled: (view: number | null) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aerialRef = useRef<HTMLImageElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const photos = useRef(new Map<number, HTMLImageElement>());
  const engineRef = useRef<DroneEngine | null>(null);
  const viewRef = useRef(view);
  const settled = useRef(onSettled);
  const [engineOn, setEngineOn] = useState(false);
  const [flight, setFlight] = useState<FlightState | null>(null);
  const [aspect, setAspect] = useState(STAGE_ASPECT);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);

  // With the engine on, it reports what is on screen: the resting view stays until the next flight takes off.
  const flying = engineOn && !reduced;
  const live = flying && flight ? flight : resting(view);
  const { mode, at: liveAt } = live;
  const home = homeFor(aspect), width = Math.exp(home.lw);

  useEffect(() => {
    const canvas = canvasRef.current, aerial = aerialRef.current, stage = stageRef.current;
    if (!canvas || !aerial || !stage) return;
    let engine: DroneEngine | null = null, stopped = false;
    const start = () => {
      if (stopped) return;
      const box = stage.getBoundingClientRect();
      engine = DroneEngine.create(canvas, aerial, id => photos.current.get(id) ?? null, { home: homeFor(box.height ? box.width / box.height : STAGE_ASPECT), pace: PACE });
      if (!engine) return;
      engine.onState = setFlight;
      engine.setRest(viewRef.current);
      setFlight(resting(viewRef.current));
      engine.resize(box.width, box.height);
      canvas.addEventListener('webglcontextlost', () => setEngineOn(false), { once: true });
      engineRef.current = engine;
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
      setAspect(Math.round(width / height * 1e4) / 1e4);
      engineRef.current?.resize(width, height);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // Fly whenever the tour moves on, starting from exactly what is on screen and covering the stage before it paints.
  // Re-running for the same destination is harmless: the engine ignores it.
  useLayoutEffect(() => {
    viewRef.current = view;
    const engine = engineRef.current;
    // Without flights, views simply cross-fade; keep the engine in step for when flying resumes.
    if (!engine || !flying) { engine?.setRest(view); return; }
    const photo = mode === 'ground' && liveAt != null ? photos.current.get(liveAt) : null;
    if (mode === 'aerial' && driftRef.current) engine.setRest(null, { cam: driftCam(driftRef.current, homeFor(aspect)) });
    else if (photo && liveAt != null) engine.setRest(liveAt, { ls: Math.log(matrixOf(photo).a || 1) });
    engine.flyTo(view);
  }, [view, flying, mode, liveAt, aspect]);

  // Upload the next stop's photo while this one rests, never during a flight.
  useEffect(() => { if (engineOn && mode !== 'flight' && upcoming != null) engineRef.current?.prepare(upcoming); }, [upcoming, engineOn, mode]);

  // Once landed, let the crisp HTML view paint, then fade the flight canvas away and report back.
  useEffect(() => { settled.current = onSettled; });
  useEffect(() => {
    if (mode === 'flight') return;
    let active = true;
    const img = mode === 'ground' && liveAt != null ? photos.current.get(liveAt) : aerialRef.current;
    Promise.resolve(img?.decode()).catch(() => undefined).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!active) return;
      engineRef.current?.reveal();
      if (viewRef.current === liveAt) settled.current(liveAt);
    })));
    return () => { active = false; };
  }, [mode, liveAt]);

  // While taking off, the fading caption keeps describing the space being left.
  const captioned = mode === 'flight' ? live.from : liveAt;
  const planeStyle = { width: `${AERIAL.width / width * 100}%`, left: `${(0.5 - home.x / width) * 100}%`, top: `${(0.5 - home.y * aspect / width) * 100}%` };

  return <div ref={stageRef} className="tv-stage" data-mode={mode} data-engine={flying ? 'webgl' : 'css'}>
    <div className="tv-aerial" aria-hidden={mode !== 'aerial'}>
      <div ref={driftRef} className="tv-drift">
        <div className="tv-plane" style={planeStyle}>
          <img ref={aerialRef} src={AERIAL.src} width={AERIAL.width} height={AERIAL.height} fetchPriority="high" draggable={false}
            alt="Vista de dron de Oasis Park: el lago con la Palapa 6 en la isla, cinco palapas alrededor, la cancha y el campo de fútbol al norte."/>
          <span className="tv-here" style={at(...HERE)}><i/>Estás aquí</span>
          {SPACES.map(s => <span key={s.id} className={`tv-pin ${statusOf(s.id)}`} style={at(...s.pin)}>
            <Plate space={s}/>{s.kind !== 'palapa' && <span className="tv-pin-name">{s.name}</span>}
          </span>)}
        </div>
      </div>
    </div>

    <div className="tv-ground">
      {SPACES.map(s => {
        const [ox, oy] = objectPosition(s, aspect), shown = mode === 'ground' && liveAt === s.id;
        return <img key={s.id} ref={el => { if (el) photos.current.set(s.id, el); else photos.current.delete(s.id); }}
          className={`tv-photo ${shown ? 'shown' : ''}`} src={s.photo} alt={shown ? s.alt : ''} aria-hidden={!shown}
          width={s.photoSize[0]} height={s.photoSize[1]} decoding="async" fetchPriority="low" draggable={false}
          style={{ objectPosition: `${ox * 100}% ${oy * 100}%` }}/>;
      })}
    </div>

    <canvas ref={canvasRef} className="flight-canvas" aria-hidden="true"/>

    <p className="tv-badge"><Drone/>{mode === 'flight' && liveAt != null ? `Volando a ${spaceById(liveAt).title}` : 'Vista de dron'}</p>
    {legend && <p className="tv-legend" aria-hidden="true"><span><i className="free"/>Libre</span><span><i className="busy"/>Ocupada</span></p>}
    <div className="tv-ground-ui" aria-hidden={mode !== 'ground'}>{captioned != null && caption(captioned)}</div>
  </div>;
}
