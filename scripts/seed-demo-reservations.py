"""Add exactly 15 local demo reservations; safe to resume without duplicating entries."""
import datetime
import http.cookiejar
import json
from pathlib import Path
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

BASE = 'http://127.0.0.1:5173'
state_path = Path('.sites-runtime/demo-reservations.json')
cookie_path = Path('.sites-runtime/demo-reservations.cookies')
state_path.parent.mkdir(exist_ok=True)
jar = http.cookiejar.MozillaCookieJar(str(cookie_path))
if cookie_path.exists(): jar.load(ignore_discard=True, ignore_expires=True)
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None, headers={'Content-Type':'application/json','Origin':BASE})
    with client.open(req, timeout=20) as response: return json.load(response)

if state_path.exists():
    state = json.loads(state_path.read_text())
else:
    now = datetime.datetime.now(ZoneInfo('America/Chihuahua'))
    first_day = now.date() + datetime.timedelta(days=1 if now.hour*60+now.minute >= 870 else 0)
    slots = [(0,1,870,990),(0,2,900,1140),(0,4,1080,1200),(1,3,540,600),(1,5,780,900),(1,6,1020,1230),(2,1,480,570),(2,2,660,780),(2,4,990,1170),(3,3,600,840),(3,5,1050,1260),(4,6,510,630),(4,1,900,1080),(5,2,720,960),(5,4,1110,1320)]
    families = ['Robles','Luna','Soto','Ríos','Vega','Mora','Solís','León','Lara','Cano','Gil','Paz','Reyes','Cruz','Rosas']
    state = {'entries':[dict(date=str(first_day+datetime.timedelta(days=day)),kiosk=kiosk,start=start,end=end,name=f'[PRUEBA] Familia {families[i]}',property=10+i*9) for i,(day,kiosk,start,end) in enumerate(slots)]}
    state_path.write_text(json.dumps(state,indent=2)+'\n')
    state_path.chmod(0o600)

for entry in state['entries']:
    if entry.get('id'): continue
    # Recover a completed request if a previous invocation stopped before saving its id.
    own = request('/api/reservations?mine=1')['bookings']
    match = next((b for b in own if all(b.get(k)==entry[k] for k in ('date','kiosk','start','end','name','property'))),None)
    if match:
        entry['id'] = match['id']
    else:
        existing = request('/api/reservations?date='+entry['date'])['bookings']
        # Preserve the time variety, choosing a different palapa if a real booking occupies it.
        candidates = [entry['kiosk']] + [k for k in range(1,7) if k!=entry['kiosk']]
        chosen = next((k for k in candidates if not any(b['kiosk']==k and b['start']<entry['end'] and b['end']>entry['start'] for b in existing)),None)
        if chosen is None: raise RuntimeError('No free palapa for a planned demo interval; no existing bookings were changed.')
        entry['kiosk'] = chosen
        result = request('/api/reservations',entry)
        jar.save(ignore_discard=True,ignore_expires=True)
        cookie_path.chmod(0o600)
        entry['id'] = result['id']
    state_path.write_text(json.dumps(state,indent=2)+'\n')

for day in sorted({e['date'] for e in state['entries']}):
    reservations = request('/api/reservations?date='+day)['bookings']
    expected = {e['id'] for e in state['entries'] if e['date']==day}
    assert expected.issubset({b['id'] for b in reservations}), 'Missing persisted demo booking'
    print(f'{day}: {len(expected)} test reservations')
print('15 test reservations saved. Existing reservations preserved.')
