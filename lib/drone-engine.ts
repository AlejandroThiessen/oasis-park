// A fake high-speed drone flight between the aerial photo and the ground photos.
//
// The aerial photo is treated as a ground plane seen by a pinhole camera that orbits a
// target point: `lw` (log of the visible ground width) is the altitude and the camera
// pitches toward the horizon as it gets low. Every frame is rendered several times across a
// short shutter interval and averaged, so fast zooms and pans get real motion blur.
// Idle views are plain HTML images; the canvas is only visible while flying.
import { AERIAL, objectPosition, spaceById } from './spaces';

export type Cam = { x: number; y: number; lw: number };
type Photo = { id: number; ls: number; op: number };
type Frame = { cam: Cam; out: Photo | null; inn: Photo | null; flash: number };
type Path = { a: Cam; b: Cam; rise: number; fall: number; split: number; table: Float32Array; length: number };
type Plan = {
  start: number; dest: number | null; from: Photo | null; settle: boolean;
  path: Path; t0: number; T: number; outDur: number; tIn: number; inDur: number; total: number;
  /** Converts the drone's real speed into the HUD reading (each flight peaks near 1000 km/h). */
  speedScale: number;
};
export type FlightHud = { kmh: number; altitude: number; waiting: boolean };
/** `at` is the destination while flying; `from` is the space being left (null from the drone view). */
export type FlightState = { mode: 'aerial' | 'flight' | 'ground'; at: number | null; from: number | null; photoOk: boolean };

const TAN_H = Math.tan(35 * Math.PI / 180); // 70° horizontal field of view
const M_PER_PX = 0.12; // ground metres per aerial-photo pixel
const TILT_MAX = 52 * Math.PI / 180, TILT_HIGH = Math.log(430), TILT_LOW = Math.log(90);
const SHUTTER = 0.05, OUT_DUR = 0.34, IN_DUR = 0.42, IN_LS = Math.log(0.78), EYE_LEVEL = 1.7;
// Keep in sync with .aerial-plane in globals.css (760 / 1347 = 56.422%).
export const HOME: Cam = { x: AERIAL.width / 2, y: 760, lw: Math.log(AERIAL.width) };

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const sine = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
const inOutCubic = (u: number) => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
const inCubic = (u: number) => u * u * u;
const outCubic = (u: number) => 1 - (1 - u) ** 3;
// Leaves the ground with a little initial speed, peaks mid-flight and settles smoothly.
const flightEase = (u: number) => 0.82 * inOutCubic(u) + 0.18 * outCubic(u);
const outExpo = (u: number) => u >= 1 ? 1 : 1 - 2 ** (-9 * u);
const smooth = (u: number) => { const v = clamp01(u); return v * v * (3 - 2 * v); };

export function approachCam(id: number): Cam {
  const s = spaceById(id);
  return { x: s.target[0], y: s.target[1], lw: Math.log(s.approach) };
}
export const tiltAt = (lw: number) => TILT_MAX * smooth((TILT_HIGH - lw) / (TILT_HIGH - TILT_LOW));

function lwAt(p: Path, s: number) {
  if (p.rise <= 1e-9) return p.b.lw + p.fall * sine(1 - s);
  if (p.fall <= 1e-9) return p.a.lw + p.rise * sine(s);
  return s < p.split ? p.a.lw + p.rise * sine(s / p.split) : p.b.lw + p.fall * sine((1 - s) / (1 - p.split));
}

/** Climb to a cruise altitude that suits the distance, then descend; move sideways mostly while high. */
export function makePath(a: Cam, b: Cam): Path {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const top = Math.max(a.lw, b.lw, d > 2 ? Math.log(Math.min(Math.max(d * 1.45, 430), AERIAL.width)) : -Infinity);
  const rise = top - a.lw, fall = top - b.lw;
  const p: Path = { a, b, rise, fall, split: rise + fall > 1e-9 ? rise / (rise + fall) : 0.5, table: new Float32Array(97), length: 0 };
  let area = 0, length = 0, prevLw = lwAt(p, 0);
  for (let i = 1; i <= 96; i++) {
    const lw = lwAt(p, i / 96);
    area += (Math.exp(prevLw) + Math.exp(lw)) / 2;
    p.table[i] = area;
    prevLw = lw;
  }
  for (let i = 1; i <= 96; i++) {
    p.table[i] /= area || 1;
    const dl = lwAt(p, i / 96) - lwAt(p, (i - 1) / 96), dm = (p.table[i] - p.table[i - 1]) * d;
    length += Math.hypot(dl, dm / Math.exp(lwAt(p, (i - 0.5) / 96)));
  }
  p.length = length;
  return p;
}

export function camAt(p: Path, s: number): Cam {
  const f = clamp01(s) * 96, i = Math.min(Math.floor(f), 95), m = p.table[i] + (p.table[i + 1] - p.table[i]) * (f - i);
  return { x: p.a.x + (p.b.x - p.a.x) * m, y: p.a.y + (p.b.y - p.a.y) * m, lw: lwAt(p, clamp01(s)) };
}

export function planFlight(from: { cam: Cam; photo: Photo | null }, dest: number | null, start: number): Plan {
  const target = dest == null ? HOME : approachCam(dest);
  const settle = dest != null && from.photo?.id === dest;
  const path = makePath(from.cam, target);
  const T = settle ? 0.4 : Math.min(Math.max(0.4 + 0.17 * path.length, 0.7), 1.3);
  const hasOut = !!from.photo && !settle;
  const t0 = hasOut ? 0.02 : 0;
  const tIn = dest == null ? Infinity : settle ? 0 : Math.max(t0 + 0.6 * T, hasOut ? OUT_DUR + 0.05 : 0);
  const inDur = settle ? 0.4 : IN_DUR;
  const plan: Plan = { start, dest, from: from.photo, settle, path, t0, T, outDur: OUT_DUR, tIn, inDur, total: Math.max(t0 + T, dest == null ? 0 : tIn + inDur), speedScale: 3.6 };
  if (!settle) {
    let peak = 0;
    for (let i = 1; i <= 90; i++) peak = Math.max(peak, speedAt(plan, plan.total * i / 90));
    const target = 960 + 70 * clamp01((path.length - 2.5) / 3.5);
    if (peak > 0) plan.speedScale = target / peak;
  }
  return plan;
}

/** Drone position in metres; the altitude eases down to eye level as a ground photo takes over. */
export function dronePos(f: Frame) {
  const tilt = tiltAt(f.cam.lw), D = Math.exp(f.cam.lw) / (2 * TAN_H), h = D * Math.cos(tilt) * M_PER_PX;
  const ground = Math.max(f.inn?.op ?? 0, f.out?.op ?? 0);
  return [f.cam.x * M_PER_PX, (f.cam.y + D * Math.sin(tilt)) * M_PER_PX, h + (EYE_LEVEL - h) * ground];
}

/** Real speed of the drone (m/s) at time t of a plan. */
export function speedAt(plan: Plan, t: number) {
  const h = 1 / 60, [x0, y0, z0] = dronePos(frameAt(plan, Math.max(t - h, 0))), [x1, y1, z1] = dronePos(frameAt(plan, t));
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) / h;
}

export function frameAt(plan: Plan, t: number): Frame {
  const cam = camAt(plan.path, flightEase(clamp01((t - plan.t0) / plan.T)));
  let out: Photo | null = null, inn: Photo | null = null, flash = 0;
  if (plan.settle && plan.from) {
    const k = outCubic(clamp01(t / plan.inDur));
    inn = { id: plan.from.id, ls: plan.from.ls * (1 - k), op: plan.from.op + (1 - plan.from.op) * k };
  } else {
    if (plan.from && t < plan.outDur) {
      const k = clamp01(t / plan.outDur);
      out = { id: plan.from.id, ls: plan.from.ls - 0.42 * inCubic(k), op: plan.from.op * (1 - k * k) };
    }
    if (plan.dest != null && t >= plan.tIn) {
      const k = clamp01((t - plan.tIn) / plan.inDur);
      inn = { id: plan.dest, ls: IN_LS * (1 - outExpo(k)), op: outCubic(clamp01(k / 0.5)) };
      flash = 0.16 * Math.exp(-(((t - plan.tIn - 0.05) / 0.07) ** 2));
    }
  }
  return { cam, out, inn, flash };
}

const VERT = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform sampler2D uAerial;
uniform vec2 uAerialSize;
uniform vec4 uCam0, uCam1;      // x, y, log visible width, tilt — shutter open / close
uniform vec2 uRoll;
uniform float uTanH, uAerialOn;
uniform sampler2D uPhotoA, uPhotoB;
uniform vec4 uGeoA, uGeoB;      // displayed width, height, left, top at rest (device px)
uniform vec3 uAnimA, uAnimB;    // log scale at shutter open, close; opacity
uniform float uTime, uSpeed, uFlash;

const vec3 HAZE = vec3(0.80, 0.85, 0.88);
const vec3 SKY = vec3(0.56, 0.68, 0.80);
const vec3 FIELD = vec3(0.70, 0.62, 0.48);

vec3 aerial(vec2 p, vec4 cam, float roll) {
  vec2 n = vec2(p.x, -p.y) / (0.5 * uRes.x);
  float cr = cos(roll), sr = sin(roll);
  n = vec2(cr * n.x - sr * n.y, sr * n.x + cr * n.y);
  float st = sin(cam.w), ct = cos(cam.w);
  vec3 fwd = vec3(0.0, -st, -ct), up = vec3(0.0, -ct, st);
  vec3 dir = fwd + vec3(n.x * uTanH, 0.0, 0.0) + n.y * uTanH * up;
  float D = exp(cam.z) / (2.0 * uTanH);
  vec3 pos = vec3(cam.xy, 0.0) - fwd * D;
  float elev = dir.z / length(dir);
  if (elev > -0.004) { vec3 s = mix(HAZE, SKY, smoothstep(0.0, 0.35, elev)); return s * s; }
  float t = -pos.z / dir.z;
  vec2 uv = (pos.xy + t * dir.xy) / uAerialSize;
  vec3 c = texture2D(uAerial, clamp(uv, 0.0, 1.0)).rgb;
  vec2 e = min(uv, 1.0 - uv);
  c = mix(FIELD, c, smoothstep(-0.004, 0.012, min(e.x, e.y)));
  float fog = smoothstep(2.6, 11.0, t * length(dir) / D) * 0.9;
  return mix(c * c, HAZE * HAZE, fog);
}

vec4 photo(sampler2D tex, vec4 geo, float ls, vec2 p) {
  vec2 q = p / exp(ls) + 0.5 * uRes;
  vec2 uv = (q - geo.zw) / geo.xy;
  vec2 e = min(uv, 1.0 - uv) * geo.xy;
  float feather = 1.0 + 0.3 * min(geo.x, geo.y) * clamp(-ls * 4.0, 0.0, 1.0);
  float a = clamp(min(e.x, e.y) / feather + 0.5 / feather, 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a);
  vec3 c = texture2D(tex, clamp(uv, 0.0, 1.0), -0.35).rgb;
  return vec4(c * c * a, a);
}

float streaks(vec2 p) {
  vec2 c = p / (0.5 * uRes.y);
  float r = length(c), f = (atan(c.y, c.x) / 6.2831853 + 0.5) * 120.0;
  float h = fract(sin(floor(f) * 91.345) * 47453.21);
  float lane = step(0.8, h) * (1.0 - smoothstep(0.0, 0.2, abs(fract(f) - 0.5)));
  float ph = fract(r * 0.7 - uTime * (1.6 + 2.4 * h) + h * 9.0);
  return lane * smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.3, 0.55, ph)) * smoothstep(0.3, 1.05, r);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5 * uRes;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float s = (float(i) + jitter) / 12.0;
    vec3 c = vec3(0.0);
    if (uAerialOn > 0.5) c = aerial(p, mix(uCam0, uCam1, s), mix(uRoll.x, uRoll.y, s));
    if (uAnimA.z > 0.001) { vec4 a = photo(uPhotoA, uGeoA, mix(uAnimA.x, uAnimA.y, s), p) * uAnimA.z; c = c * (1.0 - a.a) + a.rgb; }
    if (uAnimB.z > 0.001) { vec4 b = photo(uPhotoB, uGeoB, mix(uAnimB.x, uAnimB.y, s), p) * uAnimB.z; c = c * (1.0 - b.a) + b.rgb; }
    acc += c;
  }
  vec3 col = sqrt(acc / 12.0);
  float r = length(p) / (0.5 * length(uRes));
  col += vec3(0.9, 0.95, 1.0) * streaks(p) * uSpeed * 0.42;
  col *= 1.0 - uSpeed * 0.5 * smoothstep(0.45, 1.05, r);
  gl_FragColor = vec4(mix(col, vec3(1.0), uFlash), 1.0);
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

export class DroneEngine {
  onFrame?: (hud: FlightHud) => void;
  onState?: (state: FlightState) => void;
  private gl: GL;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private aerialTex: WebGLTexture;
  private photos = new Map<number, { tex: WebGLTexture; w: number; h: number; used: number }>();
  private pending = new Set<number>();
  private plan: Plan | null = null;
  private rest: { cam: Cam; photo: Photo | null } = { cam: HOME, photo: null };
  private raf = 0;
  private cssW = 1;
  private cssH = 1;
  private waitingSince = 0;
  private lost = false;

  private constructor(private canvas: HTMLCanvasElement, gl: GL, private getImage: (id: number) => HTMLImageElement | null, aerial: HTMLImageElement) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uAerial', 'uAerialSize', 'uCam0', 'uCam1', 'uRoll', 'uTanH', 'uAerialOn', 'uPhotoA', 'uPhotoB', 'uGeoA', 'uGeoB', 'uAnimA', 'uAnimB', 'uTime', 'uSpeed', 'uFlash']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uAerial, 0);
    gl.uniform1i(this.u.uPhotoA, 1);
    gl.uniform1i(this.u.uPhotoB, 2);
    gl.uniform2f(this.u.uAerialSize, AERIAL.width, AERIAL.height);
    gl.uniform1f(this.u.uTanH, TAN_H);
    this.aerialTex = this.upload(aerial);
    canvas.addEventListener('webglcontextlost', this.handleLost);
  }

  /** Returns null when WebGL (or the shader) is unavailable; callers fall back to CSS transitions. */
  static create(canvas: HTMLCanvasElement, aerial: HTMLImageElement, getImage: (id: number) => HTMLImageElement | null) {
    try {
      const opts: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
      const gl = (canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts)) as GL | null;
      return gl ? new DroneEngine(canvas, gl, getImage, aerial) : null;
    } catch (e) {
      console.warn('Drone flight unavailable, using simple transitions.', e);
      return null;
    }
  }

  get alive() { return !this.lost; }
  get flying() { return !!this.plan; }

  resize(cssW: number, cssH: number) {
    this.cssW = Math.max(cssW, 1);
    this.cssH = Math.max(cssH, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.4e6 / (this.cssW * this.cssH)));
    const w = Math.round(this.cssW * dpr), h = Math.round(this.cssH * dpr);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    // Resizing clears the canvas; outside a flight the HTML view underneath is already correct.
    if (this.plan) this.render(performance.now() / 1000 - this.plan.start);
    else this.canvas.style.opacity = '0';
  }

  /** Where the stage is resting when no flight is running. */
  setRest(dest: number | null) {
    this.rest = dest == null ? { cam: HOME, photo: null } : { cam: approachCam(dest), photo: { id: dest, ls: 0, op: 1 } };
  }

  /** Photo textures are uploaded before a flight so the upload never lands mid-motion. */
  prepare(id: number) {
    if (this.photos.has(id) || this.pending.has(id) || this.lost) return;
    const img = this.getImage(id);
    if (!img) return;
    this.pending.add(id);
    const ready = img.complete && img.naturalWidth ? Promise.resolve() : new Promise<void>((ok, fail) => { img.addEventListener('load', () => ok(), { once: true }); img.addEventListener('error', () => fail(new Error('photo')), { once: true }); });
    ready.then(() => img.decode().catch(() => undefined)).then(() => {
      this.pending.delete(id);
      if (this.lost || this.photos.has(id)) return;
      this.photos.set(id, { tex: this.upload(img), w: img.naturalWidth, h: img.naturalHeight, used: performance.now() });
      if (this.photos.size > 4) {
        const keep = new Set([this.plan?.dest, this.plan?.from?.id, this.rest.photo?.id]);
        const old = [...this.photos].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used)[0];
        if (old) { this.gl.deleteTexture(old[1].tex); this.photos.delete(old[0]); }
      }
    }, () => this.pending.delete(id));
  }

  /** Starts (or re-routes) a flight; returns false when already there. */
  flyTo(dest: number | null) {
    if (this.lost) return false;
    const now = performance.now() / 1000;
    let from = this.rest;
    if (this.plan) {
      if (this.plan.dest === dest) return false;
      const f = frameAt(this.plan, now - this.plan.start);
      const photo = [f.inn, f.out].filter((p): p is Photo => !!p && p.op > 0.01).sort((a, b) => b.op - a.op)[0] ?? null;
      from = { cam: f.cam, photo };
    } else if (dest === (this.rest.photo?.id ?? null)) return false;
    if (dest != null) this.prepare(dest);
    if (from.photo) this.prepare(from.photo.id);
    this.plan = planFlight(from, dest, now);
    this.waitingSince = 0;
    this.render(0);
    this.canvas.style.transition = 'none';
    this.canvas.style.opacity = '1';
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.onState?.({ mode: 'flight', at: dest, from: from.photo?.id ?? null, photoOk: true });
    return true;
  }

  /** Fades the canvas away once the crisp HTML view underneath has painted. */
  reveal() {
    if (this.plan) return;
    this.canvas.style.transition = 'opacity .2s ease-out';
    this.canvas.style.opacity = '0';
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    const gl = this.gl;
    for (const p of this.photos.values()) gl.deleteTexture(p.tex);
    gl.deleteTexture(this.aerialTex);
    gl.deleteProgram(this.prog);
    this.photos.clear();
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.raf);
    const dest = this.plan?.dest ?? null;
    this.plan = null;
    this.canvas.style.opacity = '0';
    this.onState?.({ mode: dest == null ? 'aerial' : 'ground', at: dest, from: null, photoOk: false });
  };

  private tick = () => {
    const plan = this.plan;
    if (!plan) return;
    let t = performance.now() / 1000 - plan.start;
    const photoReady = plan.dest == null || plan.settle || this.photos.has(plan.dest);
    const waiting = !photoReady && t >= plan.tIn;
    if (waiting) {
      // Hover at the target until the photo is ready, keeping its entrance just ahead.
      this.waitingSince ||= t;
      plan.tIn = t + 0.001;
      plan.total = Math.max(plan.t0 + plan.T, plan.tIn + plan.inDur);
      if (t - this.waitingSince > 8) return this.finish(plan, false);
    }
    t = Math.min(t, plan.total);
    this.render(t, waiting);
    if (t >= plan.total) return this.finish(plan, true);
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(plan: Plan, photoOk: boolean) {
    this.plan = null;
    this.setRest(plan.dest);
    this.onFrame?.({ kmh: 0, altitude: plan.dest == null ? dronePos({ cam: HOME, out: null, inn: null, flash: 0 })[2] : EYE_LEVEL, waiting: false });
    this.onState?.({ mode: plan.dest == null ? 'aerial' : 'ground', at: plan.dest, from: null, photoOk });
  }

  private render(t: number, waiting = false) {
    const plan = this.plan!, gl = this.gl, u = this.u;
    const f1 = frameAt(plan, t), f0 = frameAt(plan, Math.max(t - SHUTTER, 0));
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.uniform2f(u.uRes, W, H);

    const zoomRate = Math.abs(f1.cam.lw - f0.cam.lw) / SHUTTER + Math.abs((f1.inn?.ls ?? 0) - (f0.inn?.ls ?? 0)) / SHUTTER + Math.abs((f1.out?.ls ?? 0) - (f0.out?.ls ?? 0)) / SHUTTER;
    const panRate = Math.hypot(f1.cam.x - f0.cam.x, f1.cam.y - f0.cam.y) / SHUTTER / Math.exp(f1.cam.lw);
    const speed = clamp01((zoomRate + panRate) / 6);
    // Bank into sideways motion and add a little buffeting at speed.
    const roll = (f: Frame, df: Frame, dt: number) => Math.max(-0.07, Math.min(0.07, -((f.cam.x - df.cam.x) / Math.max(dt, 1e-3)) / Math.exp(f.cam.lw) * 0.035));
    const shake = (c: Cam, k: number) => {
      const w = Math.exp(c.lw) * 0.0022 * speed;
      return [c.x + w * Math.sin(k * 37.1) * Math.cos(k * 23.3), c.y + w * Math.sin(k * 29.7 + 1.3)];
    };
    const fPrev = frameAt(plan, Math.max(t - SHUTTER * 2, 0));
    const [x0, y0] = shake(f0.cam, t - SHUTTER), [x1, y1] = shake(f1.cam, t);
    gl.uniform4f(u.uCam0, x0, y0, f0.cam.lw, tiltAt(f0.cam.lw));
    gl.uniform4f(u.uCam1, x1, y1, f1.cam.lw, tiltAt(f1.cam.lw));
    gl.uniform2f(u.uRoll, roll(f0, fPrev, SHUTTER), roll(f1, f0, SHUTTER));

    const bind = (unit: number, tex: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    bind(0, this.aerialTex);
    const layer = (slot: 'A' | 'B', unit: number, p1: Photo | null, p0: Photo | null) => {
      const tex = p1 && this.photos.get(p1.id);
      if (!p1 || !tex) { gl.uniform3f(u[`uAnim${slot}`], 0, 0, 0); return false; }
      tex.used = performance.now();
      bind(unit, tex.tex);
      const [ox, oy] = objectPosition(spaceById(p1.id), W / H), sc = Math.max(W / tex.w, H / tex.h), dw = tex.w * sc, dh = tex.h * sc;
      gl.uniform4f(u[`uGeo${slot}`], dw, dh, (W - dw) * ox, (H - dh) * oy);
      gl.uniform3f(u[`uAnim${slot}`], p0 && p0.id === p1.id ? p0.ls : p1.ls, p1.ls, p1.op);
      return p1.op >= 0.999 && p1.ls >= -0.001 && (!p0 || p0.ls >= -0.001);
    };
    layer('A', 1, f1.out, f0.out);
    const covered = layer('B', 2, f1.inn, f0.inn);
    gl.uniform1f(u.uAerialOn, covered ? 0 : 1);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uSpeed, speed);
    gl.uniform1f(u.uFlash, f1.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.onFrame?.({ kmh: t >= plan.total ? 0 : speedAt(plan, t) * plan.speedScale, altitude: dronePos(f1)[2], waiting });
  }

  private upload(img: HTMLImageElement) {
    const gl = this.gl, tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (webgl2) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, webgl2 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  }
}
