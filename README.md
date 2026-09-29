# Oasis Park

Spanish, phone-friendly reservations for local network testing: the six palapas, the cancha multiusos and the campo de fútbol. A drone view of the park that flies to real photos of each space, shared availability, and create/cancel flows.

## Open on your phone

Connect to the same Wi-Fi as this computer and open **http://192.168.1.34:5173**.
Keep the computer awake and the server running. Its local IP may change after reconnecting to Wi-Fi. Reservations are saved on this computer, shared across devices, and survive server restarts.

## Restart the local server

From this directory:

```sh
npm run start:lan
```

On this computer you can also use http://localhost:5173. Use the same address and browser consistently: the device ownership cookie is specific to the hostname. The local server binds to all interfaces; no cloud deployment has been made.

## Share a public link

To let people outside your Wi-Fi open the app, keep the local server running and, in a second terminal, run:

```sh
cloudflared tunnel --url http://127.0.0.1:5173
```

It prints a `https://….trycloudflare.com` address. The link works only while this computer is awake and both the server and the tunnel keep running, and the address changes every time the tunnel starts. Anyone with the link can view and book, just like on the Wi-Fi.

## Test rules

- Opening hours: 08:00–22:00, America/Chihuahua time.
- Book in 30-minute increments, up to four hours, up to 90 days ahead.
- Property numbers 1–200 are test identifiers, not verified membership.
- Names and property numbers are visible only to the browser that created the booking.
- Each browser can see and cancel its own reservations. Clearing cookies loses that ability.
- Availability refreshes every 12 seconds; the database atomically rejects overlapping bookings even if two devices submit simultaneously.
- Eight reservable spaces, numbered like the park's plaques and its “Reserva de palapas” board: Palapas 1–6, Cancha multiusos (id 7) and Campo de fútbol (id 8). The id is stored in the `kiosk` column.

## Development

Node.js 22.13+ required. Dependencies are locked in package-lock.json.

```sh
npm ci
npm run dev -- --hostname 0.0.0.0
```

The production preview is served with `npm run start:lan`. To rebuild after editing:

```sh
npm run build
```

Stop and restart the local server after rebuilding.

## Data

Local SQLite/D1 files live under `.wrangler/state`. Preserve and back up that directory while the server is stopped. Do not delete it if you want to keep reservations.

Schema is in `db/schema.ts`; migration is `drizzle/0000_legal_liz_osborn.sql`. The initial migration has already been applied in this checkout. For a fresh checkout only, run `npm run build`, then:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_legal_liz_osborn.sql
```

Do not reapply the initial migration to an existing database. Future schema changes need new migrations.

## Before a resident rollout

Confirm community rules and add verified resident accounts/property access and administrator management. This prototype deliberately uses browser ownership for the local test; it does not authenticate residents.

## Demo reservations

15 sample bookings were added across September 27–October 2, 2026, covering all six palapas and different morning, afternoon, and evening times. Public daily agendas label these `Prueba`; names and property numbers remain private. Existing reservations were preserved.

The local seed manifest and owner cookie are in ignored `.sites-runtime/demo-reservations.*`. Keep those files to identify or remove only these test bookings later. `python3 scripts/seed-demo-reservations.py` resumes this same batch without duplicating completed entries; it does not generate another batch.

## Park map and numbering

Numbers follow the plaque photographed in each palapa (`IMG_5302`–`IMG_5309`) and the official “Mapa informativo” board (`IMG_5305`/`IMG_5306`):

| Space | Where | Photo |
| --- | --- | --- |
| Palapa 1 | South lawn, near the restrooms | `IMG_5304` |
| Palapa 2 | Curved pergola with fire pit, southwest lake shore | `IMG_5303` |
| Palapa 3 | Northwest corner, by the bougainvillea wall | `IMG_5302` |
| Palapa 4 | Curved pergola with fire pit, north lake peninsula | `IMG_5309` |
| Palapa 5 | Fenced lawn across the street, by the parking | `IMG_5299` |
| Palapa 6 | Island in the lake | `IMG_7849` |
| Cancha multiusos | North end, hoop and nets | `IMG_5295` |
| Campo de fútbol | North end, grass field | `IMG_5298` |

The earlier map had three of these swapped (island = 3, northwest = 5, northeast = 6). On 2026-09-28 the existing bookings were renumbered (3→6, 5→3, 6→5) so each stays on the same physical structure; the database from before that change is in `.wrangler/backups/`.

Pin and flight-target coordinates (pixels of the 1168 × 1347 aerial photo), captions and amenities are in `lib/spaces.ts`. Amenities list only what is visible in the photos. Park facts and the eight rules in “Mapa informativo” are transcribed from the board. Handwritten names and phone numbers on the board are deliberately not used.

## Drone view

The park tab opens on the aerial photo. Choosing a space from the map, the tiles, the board or the arrows flies a fake high-speed drone to its ground photo (peaking near 1000 km/h on the HUD). Choosing another space flies there directly, and “Vista de dron” (or Escape) climbs back. Arrow keys and horizontal swipes move between spaces.

`lib/drone-engine.ts` renders flights in WebGL: the aerial photo is a ground plane that the camera pitches over as it descends, frames are motion-blurred across a short shutter, and the ground photo zooms in to take over. Idle views are ordinary HTML images, so the canvas only runs during a flight. Without WebGL, or with reduced motion enabled, views crossfade instead.

## Photos

`public/park/` holds WebP copies generated from the original photos in the project root by `python3 scripts/build-park-photos.py` (needs Pillow). The originals are not modified, and they are not in the Git repository: they contain GPS location metadata, and the board photos show neighbours' names and phone numbers. The WebP copies carry no metadata. Portrait photos are cropped to 4:5 around each structure; `*-thumb.webp` files are square thumbnails. `public/park/aerial.webp` is made from `public/oasis-park-aerial.png`, an unchanged copy of the supplied clean aerial PNG.

The plaque and board lettering uses Montserrat (`public/fonts/`, SIL Open Font License, included).
