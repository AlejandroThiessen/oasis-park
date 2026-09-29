'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Compass, House, Info, Leaf, MapPin, RefreshCw, TreePalm } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { DroneStage, Plate, type SpaceStatus } from '@/components/drone-stage';
import { addDays, dateLabel, parkDate, parkMinute, timeLabel, type Booking } from '@/lib/park';
import { PARK_FACTS, PARK_RULES, SPACES, busyWord, ofSpace, spaceById } from '@/lib/spaces';

const hours = Array.from({length:28},(_,i)=>480+i*30);

// Park clock shared by every render; ticks every 30 seconds while the page is open.
let clockNow = 0;
function subscribeClock(onChange: () => void) {
  clockNow = Date.now(); onChange();
  const id = setInterval(() => { clockNow = Date.now(); onChange(); }, 30000);
  return () => clearInterval(id);
}

export default function Home() {
  const clock = useSyncExternalStore(subscribeClock, () => clockNow, () => 0);
  const today = clock ? parkDate(new Date(clock)) : '';
  const minute = clock ? parkMinute(new Date(clock)) : 0;
  // Until someone picks a date or time, default to the next half hour (or tomorrow afternoon late at night).
  const lateNight = minute >= 1290;
  const [dateChoice,setDateChoice] = useState('');
  const [startChoice,setStartChoice] = useState<number|null>(null);
  const [durationChoice,setDurationChoice] = useState(120);
  const date = dateChoice || (today ? (lateNight ? addDays(today,1) : today) : '');
  const start = startChoice ?? (lateNight ? 960 : Math.max(480,Math.ceil((minute+1)/30)*30));
  const duration = Math.min(durationChoice,1320-start);
  const end = start + duration;
  const [kiosk,setKiosk] = useState(1);
  const [stageView,setStageView] = useState<number|null>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const flyTimer = useRef(0);
  const [snapshot,setSnapshot] = useState<{date:string;bookings:Booking[];error:string}|null>(null);
  const [mine,setMine] = useState<Booking[]>([]);
  const [name,setName] = useState('');
  const [property,setProperty] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [tick,setTick] = useState(0);
  const [tab,setTab] = useState('park');
  const [success,setSuccess] = useState<{kiosk:number;date:string;start:number;end:number}|null>(null);
  const [cancel,setCancel] = useState<Booking|null>(null);
  useEffect(()=>{
    if(!date) return;
    const controller=new AbortController();
    async function load() {
      try {
        const responses=await Promise.all([fetch(`/api/reservations?date=${date}`,{signal:controller.signal}),fetch('/api/reservations?mine=1',{signal:controller.signal})]);
        if(responses.some(r=>!r.ok)) throw new Error('No pudimos consultar la disponibilidad.');
        const [all,own]=await Promise.all(responses.map(r=>r.json() as Promise<{bookings:Booking[]}>));
        if(!controller.signal.aborted){setSnapshot({date,bookings:all.bookings,error:''});setMine(own.bookings);}
      } catch(e) { if(!controller.signal.aborted) setSnapshot(s=>({date,bookings:s?.date===date?s.bookings:[],error:e instanceof Error?e.message:'Error de conexión.'})); }
    }
    load(); const id=setInterval(load,12000);
    return ()=>{controller.abort();clearInterval(id);};
  },[date,tick]);
  useEffect(()=>()=>window.clearTimeout(flyTimer.current),[]);
  const current = snapshot?.date===date ? snapshot : null;
  const loading = !current;
  const loadError = current?.error ?? '';
  const bookings = current?.bookings ?? [];
  const space = spaceById(kiosk);
  const unavailable=(k:number)=>bookings.some(b=>b.kiosk===k&&b.start<end&&b.end>start);
  const statusOf=(k:number):SpaceStatus=>loading||loadError?'unknown':unavailable(k)?'busy':'free';
  const available=SPACES.filter(s=>!unavailable(s.id)).length;
  const expired=date===today&&start<=minute;
  const validTime=end<=1320&&!expired;
  const range=`${timeLabel(start)}–${timeLabel(end)}`;
  const describe=(k:number)=>loading?'Consultando disponibilidad…':loadError?'Sin conexión':!validTime?'Elige un horario futuro':unavailable(k)?`${busyWord(k)} · ${range}`:`Disponible · ${range}`;
  function changeDate(d:string){setDateChoice(d);setError('');}
  function changeStart(s:number){setStartChoice(s);setError('');}
  // Flying starts from the map; choices further down the page first bring the map into view.
  function selectSpace(k:number,fromBelow=false) {
    setKiosk(k);setError('');window.clearTimeout(flyTimer.current);
    const box=stageBox.current?.getBoundingClientRect();
    const visible=box?Math.max(0,Math.min(box.bottom,window.innerHeight)-Math.max(box.top,0))/box.height:1;
    if(fromBelow&&box&&visible<0.7) {
      const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      stageBox.current?.scrollIntoView({block:'center',behavior:reduce?'instant':'smooth'});
      flyTimer.current=window.setTimeout(()=>setStageView(k),reduce?0:450);
    } else setStageView(k);
  }
  function goHome(){window.clearTimeout(flyTimer.current);setStageView(null);}
  async function reserve(e:React.FormEvent) {
    e.preventDefault();setBusy(true);setError('');
    try {
      const r=await fetch('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kiosk,date,start,end,name,property:Number(property)})});
      const result=await r.json() as {error?:string};if(!r.ok)throw new Error(result.error);
      setSuccess({kiosk,date,start,end});setTick(t=>t+1);
    } catch(e) {setError(e instanceof Error?e.message:'No hay conexión. Intenta de nuevo.');setTick(t=>t+1);}
    finally {setBusy(false);}
  }
  async function cancelBooking() {
    if(!cancel)return;setBusy(true);setError('');
    try {
      const r=await fetch(`/api/reservations?id=${encodeURIComponent(cancel.id)}`,{method:'DELETE'});
      if(!r.ok)throw new Error((await r.json() as {error:string}).error);
      setCancel(null);setTick(t=>t+1);
    } catch(e){setError(e instanceof Error?e.message:'No hay conexión. Intenta de nuevo.');}
    finally{setBusy(false);}
  }
  return <div className="app-shell">
    <header className="site-header"><Link href="/" className="brand" aria-label="Oasis Park, inicio"><span className="brand-icon"><TreePalm size={25}/></span><span>oasis<span className="brand-park">park</span></span></Link><span className="community-label">NUESTRO PARQUE, TU ESPACIO</span><span className="test-badge"><span/>Prueba local</span></header>
    <main>
      <Tabs value={tab} onValueChange={v=>{setTab(v);setError('');}}>
        <div className="page-heading"><div><div className="eyebrow"><Leaf size={14}/> UN RESPIRO CERCA DE CASA</div><h1>Nos vemos en el parque.</h1><p>Elige tu palapa y reserva un momento para compartir.</p></div><TabsList className="main-tabs"><TabsTrigger value="park"><Compass/>El parque</TabsTrigger><TabsTrigger value="mine"><CalendarDays/>Mis reservas{mine.length>0&&<span className="count">{mine.length}</span>}</TabsTrigger></TabsList></div>
        <TabsContent value="park">
          <div className="workspace">
            <section className="park-section" aria-label="Mapa y disponibilidad">
              <div className="day-toolbar"><div className="date-field"><CalendarDays size={19}/><label className="sr-only" htmlFor="visit-date">Fecha de visita</label><input id="visit-date" type="date" min={today} max={today?addDays(today,90):undefined} value={date} onChange={e=>{if(e.target.value)changeDate(e.target.value);}} required/></div><div className="day-shortcuts"><button className={date===today?'active':''} onClick={()=>changeDate(today)}>Hoy</button><button className={date===addDays(today||'2026-01-01',1)?'active':''} onClick={()=>changeDate(addDays(today,1))}>Mañana</button></div><div className="day-arrows"><button aria-label="Día anterior" disabled={!date||date<=today} onClick={()=>changeDate(addDays(date,-1))}><ChevronLeft size={18}/></button><button aria-label="Día siguiente" disabled={!date||date>=addDays(today,90)} onClick={()=>changeDate(addDays(date,1))}><ChevronRight size={18}/></button></div></div>
              <div ref={stageBox} className="stage-frame"><DroneStage view={stageView} selected={kiosk} statusOf={statusOf} describe={describe} onSelect={k=>selectSpace(k)} onHome={goHome}/></div>
              <div className="map-footer"><div className="legend"><span><i className="swatch free"/>Disponible</span><span><i className="swatch busy"/>Ocupada</span><span><i className="swatch chosen"/>Tu selección</span></div><span className="map-hours"><Clock3 size={14}/>Disponibilidad: {range}</span></div>
              <div className="space-list-heading"><h2>Un lugar para cada plan</h2><span aria-live="polite">{loading?'Consultando…':loadError?'Sin conexión':validTime?`${available} de ${SPACES.length} disponibles`:'Elige un horario futuro'}</span></div>
              <div className="space-grid">{SPACES.map(s=>{const st=statusOf(s.id);return <button key={s.id} type="button" onClick={()=>selectSpace(s.id,true)} className={`space-tile ${kiosk===s.id?'active':''}`} aria-pressed={kiosk===s.id}>
                <span className="tile-photo"><img src={s.thumb} alt="" width={240} height={240} loading="lazy" decoding="async"/><Plate space={s}/></span>
                <span className="tile-text"><strong>{s.name}</strong><span className={`tile-status ${st}`}>{st==='unknown'?(loading?'Consultando':'Sin conexión'):st==='busy'?busyWord(s.id):'Disponible'}</span></span>
                {kiosk===s.id&&<Check size={14} className="tile-check"/>}
              </button>;})}</div>
              <section className="board" aria-labelledby="board-title">
                <div className="board-head"><div><h2 id="board-title">Reserva de palapas</h2><p>{date ? dateLabel(date) : 'Elige una fecha'} · Hora de Chihuahua</p></div><span className="board-count" title="Reservas del día">{loading || loadError ? '—' : bookings.length}</span></div>
                <p className="board-note">Favor de respetar las citas ajenas. Los horarios que no aparecen siguen disponibles.</p>
                {loading ? <p className="agenda-empty" role="status">Consultando reservas…</p> : loadError ? <p className="agenda-empty" role="status">No pudimos cargar las reservas. Intenta de nuevo.</p> : <div className="board-grid">{SPACES.map(s => { const list = bookings.filter(b => b.kiosk === s.id); return <div key={s.id} className={`board-cell ${kiosk === s.id ? 'selected' : ''}`}>
                  <button type="button" className="board-cell-title" onClick={() => selectSpace(s.id, true)}>{s.kind === 'palapa' ? s.name : s.title}</button>
                  <ul>
                    {list.map(b => <li key={b.id}><button type="button" className="board-row" onClick={() => { selectSpace(b.kiosk, true); setStartChoice(b.start); setDurationChoice(b.end - b.start); }} aria-label={`Ver ${s.title}, ${timeLabel(b.start)} a ${timeLabel(b.end)}${b.isDemo ? ', reserva de prueba' : ''}`}>
                      <span className="board-time">{timeLabel(b.start)}<i>a</i>{timeLabel(b.end)}</span>
                      <span className="board-tags"><span className={`board-status ${b.mine ? 'mine' : ''}`}>{b.date === today && b.end <= minute ? 'Finalizada' : b.mine ? 'Tu reserva' : 'Reservado'}</span>{b.isDemo && <span className="demo-label">Prueba</span>}</span>
                    </button></li>)}
                    {list.length === 0 && <li className="board-free">Libre todo el día</li>}
                    {list.length < 2 && <li className="board-blank" aria-hidden="true"/>}
                  </ul>
                </div>; })}</div>}
                <p className="agenda-privacy">Los nombres y números de propiedad solo aparecen al titular en Mis reservas.</p>
              </section>
              <section className="park-info" aria-labelledby="info-title">
                <div className="info-head"><span className="eyebrow"><TreePalm size={14}/> DEL TABLERO DEL PARQUE</span><h2 id="info-title">Mapa informativo</h2></div>
                <dl className="park-facts">{PARK_FACTS.map(f => <div key={f.label}><dt>{f.label}</dt><dd><strong>{f.value}</strong> {f.unit}</dd></div>)}</dl>
                <h3>Reglamento</h3>
                <ol className="park-rules">{PARK_RULES.map(r => <li key={r}>{r}</li>)}</ol>
              </section>
            </section>
            <aside className="booking-panel"><div className="panel-heading"><span className="eyebrow">TU PRÓXIMA VISITA</span><button type="button" className="panel-photo" onClick={()=>selectSpace(kiosk,true)} aria-label={`Ver ${space.title} en el mapa`}><img src={space.thumb} alt="" width={240} height={240}/><Plate space={space}/></button><h2>{space.title}</h2><p>{space.blurb}</p></div>
              <form onSubmit={reserve}>
                <div className="selected-date"><CalendarDays size={17}/><span>{date?dateLabel(date):'Elige tu fecha'}</span></div>
                <div className="time-fields"><div><label htmlFor="start-time">Hora de llegada</label><Select value={String(start)} onValueChange={v=>{if(v)changeStart(Number(v));}}><SelectTrigger id="start-time" className="form-select"><SelectValue/></SelectTrigger><SelectContent>{hours.map(h=><SelectItem key={h} value={String(h)} disabled={date===today&&h<=minute}>{timeLabel(h)}</SelectItem>)}</SelectContent></Select></div><div><label htmlFor="duration">Duración</label><Select value={String(duration)} onValueChange={v=>{if(v){setDurationChoice(Number(v));setError('');}}}><SelectTrigger id="duration" className="form-select"><SelectValue/></SelectTrigger><SelectContent>{[30,60,90,120,150,180,210,240].map(d=><SelectItem key={d} value={String(d)} disabled={start+d>1320}>{d/60} {d===60?'hora':'horas'}</SelectItem>)}</SelectContent></Select></div></div>
                <div className="time-note"><Clock3 size={14}/> Tu visita termina a las {timeLabel(end)}</div>
                <div className={`availability-note ${unavailable(kiosk)||!validTime?'unavailable':''}`} aria-live="polite">{loading?<><RefreshCw size={17} className="spin"/>Consultando disponibilidad…</>:loadError?<><Info size={17}/>Sin disponibilidad confirmada</>:!validTime?<><Info size={17}/>Elige un horario futuro</>:unavailable(kiosk)?<><Info size={17}/>{busyWord(kiosk)} en este horario</>:<><Check size={17}/>Disponible en este horario</>}</div>
                <div className="form-divider"/>
                <label htmlFor="resident">Tu nombre</label><input id="resident" placeholder="Nombre y apellido" autoComplete="name" minLength={2} maxLength={80} required value={name} onChange={e=>setName(e.target.value)}/>
                <label htmlFor="property" className="property-label">Número de propiedad <span>1–200 · prueba</span></label><div className="property-input"><House size={17}/><input id="property" placeholder="Ej. 24" inputMode="numeric" type="number" min={1} max={200} step={1} required value={property} onChange={e=>setProperty(e.target.value)}/></div>
                {(error||loadError)&&<div className="error-message" role="alert">{error||loadError}{loadError&&<button type="button" onClick={()=>setTick(t=>t+1)}>Volver a intentar</button>}</div>}
                <button className="reserve-button" disabled={busy||loading||!!loadError||unavailable(kiosk)||!validTime||!date} type="submit">{busy?'Guardando…':'Confirmar reserva'}{!busy&&<ArrowRight size={19}/>}</button>
                <p className="booking-footnote">Reserva sin costo para residentes.</p>
              </form>
              <div className="rules-note"><Info size={17}/><p><strong>Reglas de esta prueba</strong>Abierto de 08:00 a 22:00. Hasta 4 horas por reserva, en intervalos de 30 minutos.</p></div>
            </aside>
          </div>
          <div className="park-bottom"><span><Leaf size={17}/> Cuidemos el lugar que compartimos.</span><a href="https://maps.app.goo.gl/nuWk4kXwqqQtpyw96" target="_blank" rel="noreferrer">Ver ubicación real<MapPin size={15}/></a></div>
        </TabsContent>
        <TabsContent value="mine"><section className="my-bookings"><div className="my-heading"><div><h2>Tus próximos momentos</h2><p>Reservas creadas en este navegador. Usa la misma dirección para volver a verlas.</p></div><button className="text-button" onClick={()=>setTick(t=>t+1)}><RefreshCw size={16}/>Actualizar</button></div>{(error||loadError)&&<p role="alert" className="error-message">{error||loadError}</p>}{loading?<p className="empty-state">Consultando tus reservas…</p>:!mine.length?<div className="empty-state"><CalendarDays size={40}/><h3>El parque te espera.</h3><p>Aún no tienes reservas en este navegador.</p><button className="reserve-button" onClick={()=>setTab('park')}>Elegir una palapa<ArrowRight size={18}/></button></div>:<div className="reservation-list">{mine.map(b=><article className="reservation-card" key={b.id}><span className="reservation-photo"><img src={spaceById(b.kiosk).thumb} alt="" width={240} height={240} loading="lazy"/><Plate space={spaceById(b.kiosk)}/></span><div><span className="eyebrow">RESERVA CONFIRMADA</span><h3>{spaceById(b.kiosk).title}</h3><p>{dateLabel(b.date)} · {timeLabel(b.start)}–{timeLabel(b.end)}</p><small>{b.name} · Propiedad {b.property}</small></div><button disabled={busy} className="cancel-button" onClick={()=>{setCancel(b);setError('');}}>Cancelar reserva</button></article>)}</div>}</section></TabsContent>
      </Tabs>
    </main>
    <footer className="site-footer"><span>OASIS PARK <span>· Un parque, muchos buenos momentos.</span></span><span>Versión de prueba · Acceso de residentes sin verificar</span></footer>
    <Dialog open={!!success} onOpenChange={o=>{if(!o)setSuccess(null);}}><DialogContent className="success-dialog">{success&&<img className="success-photo" src={spaceById(success.kiosk).photo} alt="" style={{objectPosition:`${spaceById(success.kiosk).focus[0]*100}% ${spaceById(success.kiosk).focus[1]*100}%`}}/>}<div className="success-check"><Check size={32}/></div><DialogTitle>¡Nos vemos en el parque!</DialogTitle><DialogDescription>Tu reserva quedó confirmada y el horario ya está apartado.</DialogDescription>{success&&<div className="confirmation-summary"><strong>{spaceById(success.kiosk).title}</strong><span>{dateLabel(success.date)}</span><span>{timeLabel(success.start)}–{timeLabel(success.end)}</span></div>}<p className="confirmation-help">Puedes consultar o cancelar esta reserva desde este mismo navegador.</p><button className="reserve-button" onClick={()=>{setSuccess(null);setTab('mine');}}>Ver mi reserva<ArrowRight size={18}/></button></DialogContent></Dialog>
    <AlertDialog open={!!cancel} onOpenChange={o=>{if(!o&&!busy)setCancel(null);}}><AlertDialogContent><AlertDialogTitle>¿Cancelar tu reserva?</AlertDialogTitle><AlertDialogDescription>El horario {cancel?ofSpace(cancel.kiosk):'de este espacio'} quedará disponible para tus vecinos.</AlertDialogDescription>{error&&<p role="alert" className="error-message">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Conservar reserva</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();cancelBooking();}}>{busy?'Cancelando…':'Sí, cancelar'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
