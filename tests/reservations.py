"""Integration checks against a running local instance; removes only its own test bookings."""
import concurrent.futures
import datetime
import http.cookiejar
import json
import os
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

BASE = os.environ.get('OASIS_TEST_URL', 'http://127.0.0.1:5173')
TODAY = datetime.datetime.now(ZoneInfo('America/Chihuahua')).date()
DATE = str(TODAY + datetime.timedelta(days=89))
BODY = dict(kiosk=6, date=DATE, start=480, end=600, name='Prueba automatizada', property=200)
cleanup = []

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(c, method='GET', path='/api/reservations', data=None, origin=BASE):
    req = urllib.request.Request(BASE + path, method=method, headers={'Content-Type':'application/json', 'Origin': origin}, data=json.dumps(data).encode() if data is not None else None)
    try:
        with c.open(req, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as e:
        body=e.read().decode()
        try: return e.code, json.loads(body)
        except json.JSONDecodeError: return e.code, {'error':body[:500]}

def create(c, body):
    status, data = call(c, 'POST', data=body)
    if status == 201:
        cleanup.append((c, data['id']))
    return status, data

try:
    a, b = client(), client()
    assert call(a, path=f'/api/reservations?date={DATE}')[0] == 200
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda c:create(c, BODY), [a,b]))
    assert sorted(x[0] for x in outcomes) == [201,409], outcomes
    winner, loser = (a,b) if outcomes[0][0] == 201 else (b,a)
    booking_id = next(result[1]['id'] for result in outcomes if result[0] == 201)
    visible = call(loser, path=f'/api/reservations?date={DATE}')[1]['bookings']
    booking = next(x for x in visible if x['id'] == booking_id)
    assert not booking['mine'] and 'name' not in booking and 'property' not in booking
    own = call(winner, path='/api/reservations?mine=1')[1]['bookings']
    assert len(own) == 1 and own[0]['mine'] and own[0]['name'] == BODY['name']
    assert call(loser, path='/api/reservations?mine=1')[1]['bookings'] == []
    assert call(loser, 'DELETE', f'/api/reservations?id={booking_id}')[0] == 403
    assert create(loser, {**BODY,'start':570,'end':630})[0] == 409
    assert create(loser, {**BODY,'start':600,'end':660})[0] == 201
    assert create(loser, {**BODY,'kiosk':5})[0] == 201
    assert create(loser, {**BODY,'kiosk':7})[0] == 201, 'Cancha must be bookable'
    assert create(loser, {**BODY,'kiosk':8})[0] == 201, 'Campo de fútbol must be bookable'
    assert call(loser, 'DELETE', f'/api/reservations?id={booking_id}')[0] == 404
    for invalid in [dict(end=750),dict(start=450),dict(end=1350),dict(start=485),dict(end=480),dict(kiosk=0),dict(kiosk=9),dict(property=201),dict(date='2026-02-30'),dict(date=str(TODAY-datetime.timedelta(days=1))),dict(date=str(TODAY+datetime.timedelta(days=91))),dict(name='a')]:
        assert create(a, {**BODY, **invalid})[0] == 400, invalid
    assert call(a,'POST',data=BODY,origin='https://example.invalid')[0] == 403
    deleted = call(winner, 'DELETE', f'/api/reservations?id={booking_id}')
    assert deleted[0] == 200, deleted
    cleanup.remove((winner, booking_id))
    assert create(loser, BODY)[0] == 201, 'Cancellation must release every slot'
    print('PASS: concurrent conflict protection, atomic rollback, shared availability, private resident details, owner-only cancellation, adjacent bookings, separate spaces (palapas, cancha, fútbol), input validation, cross-origin rejection, slot release.')
finally:
    failures=[]
    for c, id in cleanup:
        status, _ = call(c, 'DELETE', f'/api/reservations?id={id}')
        if status != 200: failures.append((id,status))
    if failures: raise RuntimeError(f'Test cleanup failed: {failures}')
    print('Test bookings cleaned up.')
