// Reservable spaces, numbered like the plaques and the official "Reserva de palapas" board.
// The id is stored in the `kiosk` column of the database.
export type Space = {
  id: number;
  kind: 'palapa' | 'cancha' | 'futbol';
  /** Short label ("Palapa 4", "Cancha") and full title ("Cancha multiusos"). */
  name: string;
  title: string;
  plate: string;
  /** Pin anchor and flight target, in pixels of the 1168 × 1347 aerial photo. */
  pin: [number, number];
  target: [number, number];
  /** Visible ground width (aerial px) when the drone reaches the space. */
  approach: number;
  photo: string;
  thumb: string;
  photoSize: [number, number];
  /** Point of the photo kept in view on the landscape stage, as fractions of the photo. */
  focus: [number, number];
  alt: string;
  blurb: string;
  features: string[];
};

export const AERIAL = { src: '/park/aerial.webp', width: 1168, height: 1347 } as const;

const palapa = (n: number, x: number, y: number, size: [number, number], focus: [number, number], alt: string, blurb: string, features: string[]): Space => ({
  id: n, kind: 'palapa', name: `Palapa ${n}`, title: `Palapa ${n}`, plate: String(n), pin: [x, y], target: [x, y], approach: 84,
  photo: `/park/palapa-${n}.webp`, thumb: `/park/palapa-${n}-thumb.webp`, photoSize: size, focus, alt, blurb, features,
});

export const SPACES: Space[] = [
  palapa(1, 459, 1140, [1280, 1600], [0.5, 0.58], 'Palapa 1: palapa redonda de techo negro con mesas de picnic y un asador a un lado.', 'Palapa redonda cerca de los baños.', ['Asador', 'Mesas']),
  palapa(2, 348, 994, [1280, 1600], [0.5, 0.6], 'Palapa 2: pérgola curva con banca corrida, paneles de malla y una fogata al centro.', 'Pérgola curva con fogata, junto al lago.', ['Fogata', 'Banca curva']),
  palapa(3, 151, 521, [1280, 1600], [0.5, 0.56], 'Palapa 3: palapa redonda junto al muro de buganvilias, con mesa de picnic.', 'Rincón tranquilo junto al muro de buganvilias.', ['Mesa']),
  palapa(4, 495, 578, [2400, 1098], [0.55, 0.5], 'Palapa 4: pérgola curva frente al lago con banca corrida, fogata, mesa de picnic y asador.', 'Pérgola con fogata frente al lago.', ['Fogata', 'Asador', 'Mesa', 'Vista al lago']),
  palapa(5, 954, 466, [1280, 1600], [0.5, 0.58], 'Palapa 5: palapa redonda con mesas de picnic y un asador al frente, en un jardín cercado.', 'Jardín cercado junto al estacionamiento.', ['Asador', 'Mesas']),
  palapa(6, 515, 791, [1920, 1080], [0.47, 0.5], 'Palapa 6: palapa en la isla del lago, rodeada de plumeros y barandal negro.', 'En la isla del lago, cruzando el puente.', ['Isla', 'Mesa', 'Vista al lago']),
  {
    id: 7, kind: 'cancha', name: 'Cancha', title: 'Cancha multiusos', plate: '', pin: [740, 396], target: [727, 388], approach: 150,
    photo: '/park/cancha.webp', thumb: '/park/cancha-thumb.webp', photoSize: [1920, 1080], focus: [0.55, 0.5],
    alt: 'Cancha multiusos con canasta de básquetbol, dos redes y luminarias.', blurb: 'Cancha multiusos con canasta y redes.', features: ['Básquetbol', 'Redes', 'Luminarias'],
  },
  {
    id: 8, kind: 'futbol', name: 'Fútbol', title: 'Campo de fútbol', plate: '', pin: [592, 420], target: [613, 407], approach: 190,
    photo: '/park/futbol.webp', thumb: '/park/futbol-thumb.webp', photoSize: [1920, 1080], focus: [0.6, 0.5],
    alt: 'Campo de fútbol de pasto con portería, malla perimetral y cipreses.', blurb: 'Campo de pasto con porterías.', features: ['Pasto natural', 'Porterías'],
  },
];

export const SPACE_IDS = SPACES.map(s => s.id);

export function spaceById(id: number) {
  return SPACES.find(s => s.id === id) ?? SPACES[0];
}

/** "Ocupada" / "Ocupado" agreeing with the space's noun. */
export function busyWord(id: number) {
  return spaceById(id).kind === 'futbol' ? 'Ocupado' : 'Ocupada';
}

/** "de la Palapa 4", "de la cancha", "del campo de fútbol" — for sentences. */
export function ofSpace(id: number) {
  const s = spaceById(id);
  return s.kind === 'palapa' ? `de la ${s.name}` : s.kind === 'cancha' ? 'de la cancha' : 'del campo de fútbol';
}

/** CSS object-position that keeps `focus` centred when the photo covers a box of the given aspect. */
export function objectPosition(space: Space, boxAspect: number): [number, number] {
  const [w, h] = space.photoSize, [fx, fy] = space.focus, aspect = w / h;
  if (aspect < boxAspect) {
    const visible = aspect / boxAspect;
    return [0.5, Math.min(Math.max(fy - visible / 2, 0), 1 - visible) / (1 - visible)];
  }
  const visible = boxAspect / aspect;
  return visible >= 1 ? [0.5, 0.5] : [Math.min(Math.max(fx - visible / 2, 0), 1 - visible) / (1 - visible), 0.5];
}

// Park facts and rules transcribed from the "Mapa informativo" board.
export const PARK_FACTS = [
  { value: '14,000,000', unit: 'litros', label: 'Lago' },
  { value: '775', unit: 'metros', label: 'Banqueta' },
  { value: '670', unit: 'metros', label: 'Caminata' },
];
export const PARK_RULES = [
  'Nadar queda bajo su propio riesgo.',
  'Ningún salvavidas presente.',
  'Pescar queda prohibido fuera de temporada.',
  'Respetar las instalaciones.',
  'La bodega es para guardar herramienta y no está disponible al público.',
  'Prohibido tirar basura.',
  'Los niños deben ser supervisados en todo momento.',
  'Drogas y alcohol prohibidos.',
];
