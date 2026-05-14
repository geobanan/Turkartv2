'use client';
import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, Popup, LayersControl, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const KATEGORIER = ['Topptur vinter', 'Topptur sommer', 'Leirplass', 'Sykkelrute', 'Klatrefelt', 'Løpetur', 'Annet'];

function gpxToGeoJSON(xmlString: string) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, "text/xml");
    const trkpts = Array.from(xml.querySelectorAll("trkpt")).map(pt => [parseFloat(pt.getAttribute("lon")!), parseFloat(pt.getAttribute("lat")!)]);
    if (trkpts.length > 0) return { type: "LineString", coordinates: trkpts };
    const wpt = xml.querySelector("wpt");
    if (wpt) return { type: "Point", coordinates: [parseFloat(wpt.getAttribute("lon")!), parseFloat(wpt.getAttribute("lat")!)] };
    return null;
}

function beregnDistanse(coords: any[]) {
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        dist += L.latLng(coords[i][1], coords[i][0]).distanceTo(L.latLng(coords[i + 1][1], coords[i + 1][0]));
    }
    return (dist / 1000).toFixed(1);
}

function RoutePopup({ rute, oppdaterKart, onStartEdit }: { rute: any, oppdaterKart: () => void, onStartEdit: (rute: any) => void }) {
    const [fane, setFane] = useState<'info' | 'vaer' | 'hoyde'>('info');
    const [kommentarer, setKommentarer] = useState<any[]>([]);
    const [nyKommentar, setNyKommentar] = useState('');
    const [brukernavn, setBrukernavn] = useState('');

    const [aktivStemme, setAktivStemme] = useState<'up' | 'down' | null>(null);
    const [upvotes, setUpvotes] = useState(Number(rute.upvotes) || 0);
    const [downvotes, setDownvotes] = useState(Number(rute.downvotes) || 0);

    const [vaer, setVaer] = useState<any[]>([]);
    const [hoydeProfil, setHoydeProfil] = useState<number[]>([]);
    const [distanse, setDistanse] = useState<string | null>(null);
    const [pos, setPos] = useState({ lat: 62.47, lon: 6.15 });
    const [lasterVaer, setLasterVaer] = useState(false);
    const [lasterHoyde, setLasterHoyde] = useState(false);

    const parsedGeojson = typeof rute.geojson === 'string' ? JSON.parse(rute.geojson) : rute.geojson;
    const geom = parsedGeojson?.geometry || parsedGeojson;
    const geomType = geom?.type;
    const harKoordinater = geom?.coordinates && geom.coordinates.length > 0;

    useEffect(() => {
        const lagretStemme = localStorage.getItem(`stemme_${rute.id}`) as 'up' | 'down' | null;
        if (lagretStemme) setAktivStemme(lagretStemme);

        const lagretNavn = localStorage.getItem('bruker_navn');
        if (lagretNavn) setBrukernavn(lagretNavn);

        hentKommentarer();
        hentYrVaer();

        if (geomType === 'LineString' && harKoordinater) {
            setDistanse(beregnDistanse(geom.coordinates));
        }
    }, [rute.id]);

    useEffect(() => {
        if (fane === 'hoyde' && hoydeProfil.length === 0 && geomType === 'LineString') {
            hentHoydeProfil();
        }
    }, [fane]);

    async function hentKommentarer() {
        const { data } = await supabase.from('kommentarer').select('*').eq('rute_id', rute.id).order('created_at', { ascending: false });
        if (data) setKommentarer(data);
    }

    async function hentHoydeProfil() {
        if (!harKoordinater || geomType !== 'LineString') return;
        setLasterHoyde(true);
        const coords = geom.coordinates;
        const step = Math.max(1, Math.floor(coords.length / 15));
        const sampled = coords.filter((_: any, i: number) => i % step === 0);

        try {
            const promises = sampled.map((c: any) => {
                return fetch(`https://ws.geonorge.no/hoydedata/v1/punkt?nord=${c[1]}&ost=${c[0]}&koordsys=4326`)
                    .then(r => r.json())
                    .then(d => d.punkter?.[0]?.z || 0);
            });
            const heights = await Promise.all(promises);
            setHoydeProfil(heights.filter(h => h > 0));
        } catch (e) { console.error(e); } finally { setLasterHoyde(false); }
    }

    async function hentYrVaer() {
        if (!harKoordinater) return;
        setLasterVaer(true);
        try {
            let lat = 62.47, lon = 6.15;
            const coords = geom.coordinates;

            if (geomType === 'Point') { lon = coords[0]; lat = coords[1]; }
            else if (geomType === 'LineString') { lon = coords[0][0]; lat = coords[0][1]; }
            else if (geomType === 'Polygon') { lon = coords[0][0][0]; lat = coords[0][0][1]; }

            setPos({ lat, lon });

            const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, {
                headers: { 'User-Agent': 'ToppturApplikasjon/1.0 ole.markus.moen@gmail.com' }
            });
            const data = await res.json();
            const dager: any = {};
            data.properties.timeseries.forEach((t: any) => {
                const dateObj = new Date(t.time);
                const dato = dateObj.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric' });
                const time = dateObj.getHours();
                if (!dager[dato]) dager[dato] = { morgen: null, dag: null, kveld: null };
                const info = { temp: Math.round(t.data.instant.details.air_temperature), vind: Math.round(t.data.instant.details.wind_speed), ikon: '☁️' };
                const symbol = t.data.next_6_hours?.summary?.symbol_code || t.data.next_1_hours?.summary?.symbol_code;
                if (symbol?.includes('clearsky')) info.ikon = '☀️';
                else if (symbol?.includes('fair') || symbol?.includes('partlycloudy')) info.ikon = '⛅';
                else if (symbol?.includes('rain')) info.ikon = '🌧️';
                else if (symbol?.includes('snow')) info.ikon = '❄️';

                if (time >= 6 && time < 12 && !dager[dato].morgen) dager[dato].morgen = info;
                if (time >= 12 && time < 18 && !dager[dato].dag) dager[dato].dag = info;
                if (time >= 18 && time < 24 && !dager[dato].kveld) dager[dato].kveld = info;
            });
            setVaer(Object.entries(dager).slice(0, 3));
        } catch (error) { console.error(error); } finally { setLasterVaer(false); }
    }

    async function stem(type: 'up' | 'down') {
        let rpcCall = '';
        if (aktivStemme === type) {
            type === 'up' ? setUpvotes(p => p - 1) : setDownvotes(p => p - 1);
            rpcCall = type === 'up' ? 'decrement_upvote' : 'decrement_downvote';
            setAktivStemme(null);
            localStorage.removeItem(`stemme_${rute.id}`);
        } else {
            if (aktivStemme) {
                aktivStemme === 'up' ? setUpvotes(p => p - 1) : setDownvotes(p => p - 1);
                await supabase.rpc(aktivStemme === 'up' ? 'decrement_upvote' : 'decrement_downvote', { row_id: rute.id });
            }
            type === 'up' ? setUpvotes(p => p + 1) : setDownvotes(p => p + 1);
            rpcCall = type === 'up' ? 'increment_upvote' : 'increment_downvote';
            setAktivStemme(type);
            localStorage.setItem(`stemme_${rute.id}`, type);
        }
        await supabase.rpc(rpcCall, { row_id: rute.id });
    }

    async function postKommentar() {
        if (!nyKommentar.trim()) return;
        const lagreNavn = brukernavn.trim() || 'Anonym';
        const { error } = await supabase.from('kommentarer').insert([{ rute_id: rute.id, tekst: nyKommentar, bruker_navn: lagreNavn }]);
        if (error) alert(error.message);
        else { setNyKommentar(''); hentKommentarer(); }
    }

    return (
        <div className="w-full flex flex-col font-sans text-gray-800">
            <div className="flex justify-between items-start border-b pb-2 mb-2">
                <div className="overflow-hidden">
                    <h3 className="font-bold text-lg leading-tight m-0 truncate pr-2">{rute.navn}</h3>
                    <div className="flex flex-wrap gap-x-2 gap-y-[2px] items-center mt-[2px]">
                        {distanse && <span className="text-[10px] text-gray-500 bg-gray-100 px-1 rounded">📏 {distanse} km</span>}
                        {rute.kategori && <span className="text-[10px] bg-blue-50 text-blue-700 font-semibold px-1 rounded">{rute.kategori}</span>}
                        {rute.oppretter && <span className="text-[10px] text-gray-400 italic">av {rute.oppretter}</span>}
                    </div>
                </div>
                <div className="flex gap-1 shrink-0 items-center">
                    <button onClick={() => onStartEdit(rute)} className="text-amber-600 hover:bg-amber-50 p-1 rounded transition" title="Rediger data">✏️</button>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?rute=${rute.id}`); alert("Lenke kopiert!"); }} className="text-blue-500 hover:bg-blue-50 p-1 rounded transition" title="Kopier lenke">🔗</button>
                    <button onClick={async () => { if (confirm("Slette permanent?")) { await supabase.from('toppturer').delete().eq('id', rute.id); oppdaterKart(); } }} className="text-red-500 hover:bg-red-50 p-1 rounded transition" title="Slett rute">🗑️</button>
                </div>
            </div>

            <div className="flex border-b mb-3">
                <button onClick={() => setFane('info')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'info' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>Info</button>
                <button onClick={() => setFane('vaer')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'vaer' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>🌤️ Vær</button>
                {geomType === 'LineString' && (
                    <button onClick={() => setFane('hoyde')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'hoyde' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>📈 Høyde</button>
                )}
            </div>

            {fane === 'info' && (
                <>
                    <div className="flex gap-2 mb-3">
                        <button onClick={() => stem('up')} className={`flex-1 py-1 rounded border text-sm transition ${aktivStemme === 'up' ? 'bg-blue-500 text-white border-blue-600 shadow-sm' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}`}>👍 {upvotes}</button>
                        <button onClick={() => stem('down')} className={`flex-1 py-1 rounded border text-sm transition ${aktivStemme === 'down' ? 'bg-red-500 text-white border-red-600 shadow-sm' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}`}>👎 {downvotes}</button>
                    </div>
                    <div className="space-y-2 mb-3 overflow-y-auto max-h-[140px] pr-1">
                        {kommentarer.map(k => (
                            <div key={k.id} className="bg-gray-50 border p-2 rounded text-sm break-words whitespace-pre-wrap">
                                <div className="flex justify-between text-[9px] text-gray-400 mb-1 border-b border-gray-100 pb-[2px]">
                                    <span className="font-bold text-gray-600">{k.bruker_navn || 'Anonym'}</span>
                                    <span>{new Date(k.created_at).toLocaleDateString()}</span>
                                </div>
                                <p className="text-gray-700 leading-snug">{k.tekst}</p>
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-col mt-auto border-t pt-2 gap-1 bg-white">
                        <input type="text" placeholder="Ditt navn (lagres automatisk)" value={brukernavn} onChange={e => { setBrukernavn(e.target.value); localStorage.setItem('bruker_navn', e.target.value); }} className="text-xs px-2 py-1.5 text-gray-700 bg-gray-50 border border-gray-200 rounded outline-none focus:border-blue-400 focus:bg-white transition" />
                        <div className="flex gap-1">
                            <textarea value={nyKommentar} onChange={e => setNyKommentar(e.target.value)} placeholder="Skriv en kommentar..." className="border border-gray-200 text-xs p-2 flex-grow rounded h-[34px] resize-none focus:outline-none focus:border-blue-400 bg-gray-50 focus:bg-white transition" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postKommentar(); } }} />
                            <button onClick={postKommentar} className="bg-blue-600 hover:bg-blue-700 transition text-white text-xs px-3 rounded font-medium shadow-sm">Send</button>
                        </div>
                    </div>
                </>
            )}

            {fane === 'vaer' && (
                <div className="flex flex-col gap-2 min-h-[210px] justify-center items-center w-full">
                    {lasterVaer ? (
                        <p className="text-xs text-gray-400 text-center">Henter værdata fra Yr...</p>
                    ) : vaer.length > 0 ? (
                        <div className="w-full space-y-2">
                            {vaer.map(([dato, p]: any, i: number) => (
                                <div key={i} className="border rounded bg-gray-50 p-2 mx-auto w-[98%] shadow-sm">
                                    <div className="text-[10px] font-bold text-blue-800 uppercase mb-1 border-b pb-1 text-center">{dato}</div>
                                    <div className="flex justify-between">
                                        {[
                                            { n: 'Morgen', d: p.morgen },
                                            { n: 'Dag', d: p.dag },
                                            { n: 'Kveld', d: p.kveld }
                                        ].map(tid => (
                                            <div key={tid.n} className="flex flex-col items-center flex-1">
                                                <span className="text-[9px] text-gray-400">{tid.n}</span>
                                                <span className="text-xl my-[1px]">{tid.d?.ikon || '-'}</span>
                                                <span className="text-xs font-bold text-gray-700">{tid.d ? `${tid.d.temp}°` : '-'}</span>
                                                <span className="text-[9px] text-gray-500">{tid.d ? `${tid.d.vind}m/s` : ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-red-400 text-center">Kunne ikke laste vær.</p>
                    )}
                    <a href={`https://www.yr.no/nb/værvarsel/daglig-tabell/${pos.lat},${pos.lon}`} target="_blank" className="mt-auto text-center block text-xs bg-blue-50 text-blue-600 p-2 w-[98%] rounded font-medium hover:bg-blue-100 transition">Yr.no detaljer ↗</a>
                </div>
            )}

            {fane === 'hoyde' && (
                <div className="min-h-[180px] flex flex-col justify-center items-center w-full">
                    {lasterHoyde ? (
                        <p className="text-xs text-gray-400 text-center">Henter høydeprofil...</p>
                    ) : hoydeProfil.length > 0 ? (() => {
                        const min = Math.min(...hoydeProfil); const max = Math.max(...hoydeProfil); const range = max - min || 1;
                        const points = hoydeProfil.map((h, i) => `${(i / (hoydeProfil.length - 1)) * 100},${100 - ((h - min) / range) * 100}`).join(' ');
                        return (
                            <div className="w-[98%]">
                                <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-2 px-1">
                                    <span>Lavest: {Math.round(min)} moh</span> <span>Høyest: {Math.round(max)} moh</span>
                                </div>
                                <div className="w-full h-24 bg-blue-50 border-b-2 border-blue-200 relative rounded shadow-inner">
                                    <svg className="absolute w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <polygon points={`0,100 ${points} 100,100`} fill="rgba(59, 130, 246, 0.25)" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                    </svg>
                                </div>
                                <div className="flex justify-between text-[9px] text-gray-400 font-bold px-1 mt-1">
                                    <span>0 km</span>
                                    <span>{distanse ? `${distanse} km` : ''}</span>
                                </div>
                            </div>
                        );
                    })() : <p className="text-xs text-gray-400 text-center">Ingen høydedata tilgjengelig.</p>}
                </div>
            )}
        </div>
    );
}

function GeomanTools({ onSave }: { onSave: (geo: any) => void }) {
    const map = useMap();
    useEffect(() => {
        if (!map.pm) return;
        map.pm.removeControls();
        map.pm.addControls({
            position: 'topleft', drawMarker: true, drawPolyline: true, drawPolygon: true, editMode: false, removalMode: false,
            drawRectangle: false, drawCircle: false, drawCircleMarker: false, drawText: false, dragMode: false, cutPolygon: false, rotateMode: false
        });
        map.on('pm:create', (e: any) => { map.pm.disableDraw(); onSave(e.layer.toGeoJSON().geometry); map.removeLayer(e.layer); });
        return () => { map.off('pm:create'); };
    }, [map, onSave]);
    return null;
}

function MapViewHandler({ ruter }: { ruter: any[] }) {
    const map = useMap();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ruteId = params.get('rute');
        if (ruteId && ruter.length > 0) {
            const valgt = ruter.find(r => r.id === ruteId);
            if (valgt?.geojson) {
                const geom = typeof valgt.geojson === 'string' ? JSON.parse(valgt.geojson) : valgt.geojson;
                const geometryToUse = geom.geometry || geom;
                if (geometryToUse && geometryToUse.coordinates) {
                    map.fitBounds(L.geoJSON(geometryToUse).getBounds(), { padding: [50, 50], maxZoom: 14 });
                    return;
                }
            }
        }

        const savedView = localStorage.getItem('kart_visning');
        if (savedView) {
            const { lat, lng, zoom } = JSON.parse(savedView);
            map.setView([lat, lng], zoom);
        }
    }, [ruter, map]);

    useEffect(() => {
        const lagrePosisjon = () => {
            const center = map.getCenter();
            const zoom = map.getZoom();
            localStorage.setItem('kart_visning', JSON.stringify({ lat: center.lat, lng: center.lng, zoom }));
        };
        map.on('moveend', lagrePosisjon);
        map.on('zoomend', lagrePosisjon);
        return () => {
            map.off('moveend', lagrePosisjon);
            map.off('zoomend', lagrePosisjon);
        };
    }, [map]);

    return null;
}

export default function Map() {
    const [ruter, setRuter] = useState<any[]>([]);
    const [visNavn, setVisNavn] = useState(true);
    const [ikonStorrelse, setIkonStorrelse] = useState(24);
    const [visSlider, setVisSlider] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [synligeKategorier, setSynligeKategorier] = useState<string[]>(KATEGORIER);
    const [visFilterPanel, setVisFilterPanel] = useState(false);

    const [modalSteg, setModalSteg] = useState(0);
    const [tempGeo, setTempGeo] = useState<any>(null);
    const [tempNavn, setTempNavn] = useState('');
    const [tempOppretter, setTempOppretter] = useState('');
    const [tempKategori, setTempKategori] = useState('Annet');
    const [editingId, setEditingId] = useState<string | null>(null);

    const farger = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#000000', '#6b7280', '#06b6d4'];
    const ikoner = ['📍', '⛰️', '🧗', '🚴', '📸', '🏕️', '🅿️', '💧', '⚠️', '🛖'];

    async function fetchRuter() {
        const { data } = await supabase.from('ruter_kart').select('*');
        if (data) setRuter(data);
    }

    useEffect(() => { fetchRuter(); }, []);

    const handleFileImport = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target?.result as string;
            const geo = file.name.endsWith('.gpx') ? gpxToGeoJSON(content) : JSON.parse(content);
            if (geo) {
                setTempGeo(geo.geometry || geo);
                setTempNavn(file.name.replace(/\.[^/.]+$/, ""));
                setTempOppretter('');
                setTempKategori('Annet');
                setEditingId(null);
                setModalSteg(1);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleStartEdit = (rute: any) => {
        const parsed = typeof rute.geojson === 'string' ? JSON.parse(rute.geojson) : rute.geojson;
        setTempGeo(parsed.geometry || parsed);
        setTempNavn(rute.navn);
        setTempOppretter(rute.oppretter || '');
        setTempKategori(rute.kategori || 'Annet');
        setEditingId(rute.id);
        setModalSteg(1);
    };

    const handleFinalSave = async (verdi: string) => {
        if (editingId) {
            const payload = tempGeo.type === 'Point'
                ? { navn: tempNavn, oppretter: tempOppretter || null, kategori: tempKategori, ikon: verdi }
                : { navn: tempNavn, oppretter: tempOppretter || null, kategori: tempKategori, farge: verdi };
            await supabase.from('toppturer').update(payload).eq('id', editingId);
            setEditingId(null);
        } else {
            const payload = tempGeo.type === 'Point'
                ? { navn: tempNavn, geom: tempGeo, type: tempGeo.type, ikon: verdi, oppretter: tempOppretter || null, kategori: tempKategori }
                : { navn: tempNavn, geom: tempGeo, type: tempGeo.type, farge: verdi, oppretter: tempOppretter || null, kategori: tempKategori };
            await supabase.from('toppturer').insert([payload]);
        }
        setModalSteg(0); fetchRuter();
    };

    return (
        <div className="h-full w-full relative">

            <div className="absolute top-[200px] left-[10px] z-[1000] flex flex-col gap-2 items-start">
                <button
                    onClick={() => setVisFilterPanel(!visFilterPanel)}
                    className={`w-[34px] h-[34px] rounded shadow flex justify-center items-center transition border ${visFilterPanel ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 shadow-sm'}`}
                    title="Kategorifilter"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                </button>

                <button onClick={() => setVisNavn(!visNavn)} className={`w-[34px] h-[34px] rounded shadow font-bold text-sm flex justify-center items-center transition border ${visNavn ? 'bg-white text-gray-800 border-gray-300 shadow-md' : 'bg-gray-200 text-gray-400 border-gray-300'}`} title={visNavn ? "Skjul navn" : "Vis navn"}>Aa</button>
                <button onClick={() => fileInputRef.current?.click()} className="bg-white p-2 w-[34px] h-[34px] rounded shadow text-lg flex justify-center items-center hover:bg-gray-50 border" title="Importer GPX/GeoJSON">📤</button>
                <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".gpx,.geojson,.json" />

                <div className="relative">
                    <button
                        onClick={() => setVisSlider(!visSlider)}
                        className={`w-[34px] h-[34px] rounded font-bold text-lg flex justify-center items-center transition border ${visSlider ? 'bg-gray-200 text-gray-600 border-gray-400 shadow-inner' : 'bg-white text-gray-800 border-gray-300 shadow-md hover:bg-gray-50'}`}
                        title="Endre ikonstørrelse"
                    >
                        ↕️
                    </button>
                    {visSlider && (
                        <div className="absolute top-0 left-[42px] bg-white p-2.5 rounded-xl shadow-xl border flex flex-col gap-1 min-w-[110px] animate-in fade-in slide-in-from-left-3 duration-150 z-50">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider text-center">Ikonstørrelse</span>
                            <div className="flex items-center gap-2 mt-1">
                                <input type="range" min="16" max="48" value={ikonStorrelse} onChange={(e) => setIkonStorrelse(parseInt(e.target.value))} className="w-24 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                                <span className="text-[10px] font-bold text-gray-600 min-w-[24px] text-center">{ikonStorrelse}px</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {visFilterPanel && (
                <div className="absolute top-[200px] left-[52px] z-[1000] bg-white p-4 rounded-xl shadow-2xl border border-gray-200 w-56 animate-in fade-in slide-in-from-left-3 duration-150">
                    <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-2 pb-1 border-b">Filtrer kartlag</h4>
                    <div className="flex gap-1.5 mb-3">
                        <button onClick={() => setSynligeKategorier(KATEGORIER)} className="text-[9px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold flex-1 transition">Velg alle</button>
                        <button onClick={() => setSynligeKategorier([])} className="text-[9px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold flex-1 transition">Fjern alle</button>
                    </div>
                    <div className="flex flex-col gap-2">
                        {KATEGORIER.map(kat => {
                            const aktiv = synligeKategorier.includes(kat);
                            return (
                                <label key={kat} className="flex items-center gap-3 cursor-pointer select-none text-sm font-medium text-gray-700 hover:text-gray-900">
                                    <input type="checkbox" checked={aktiv} onChange={() => setSynligeKategorier(prev => prev.includes(kat) ? prev.filter(k => k !== kat) : [...prev, kat])} className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer" />
                                    <span className={aktiv ? "text-gray-900 font-semibold" : "text-gray-400"}>{kat}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {modalSteg > 0 && (
                <div className="absolute inset-0 bg-black/60 z-[2000] flex items-center justify-center backdrop-blur-sm p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm">
                        {modalSteg === 1 ? (
                            <div className="flex flex-col items-center">
                                <h3 className="font-bold text-xl mb-4">{editingId ? 'Rediger markering' : 'Lagre markering'}</h3>
                                <input autoFocus value={tempNavn} onChange={e => setTempNavn(e.target.value)} placeholder="Skriv navn på geometri..." className="w-full border-2 border-gray-100 p-3 rounded-lg mb-3 outline-none focus:border-blue-500 text-center text-base font-semibold" />
                                <input value={tempOppretter} onChange={e => setTempOppretter(e.target.value)} placeholder="Ditt navn (valgfritt)..." className="w-full border-2 border-gray-100 p-2 rounded-lg mb-3 outline-none focus:border-blue-400 text-center text-sm italic" />
                                <select value={tempKategori} onChange={e => setTempKategori(e.target.value)} className="w-full border-2 border-gray-100 p-2.5 rounded-lg mb-6 outline-none focus:border-blue-500 text-sm font-medium text-gray-700 bg-gray-50 cursor-pointer">
                                    {KATEGORIER.map(k => <option key={k} value={k}>{k}</option>)}
                                </select>
                                <div className="flex gap-2 w-full">
                                    <button onClick={() => setModalSteg(0)} className="w-1/2 bg-gray-50 p-3 rounded-lg font-medium text-gray-600">Avbryt</button>
                                    <button onClick={() => setModalSteg(2)} disabled={!tempNavn} className="w-1/2 bg-blue-600 text-white p-3 rounded-lg font-medium shadow disabled:opacity-50">Neste</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                <h3 className="font-bold text-lg mb-6">{tempGeo.type === 'Point' ? 'Velg ikon' : 'Velg farge'}</h3>
                                <div className={tempGeo.type === 'Point' ? "grid grid-cols-5 gap-4 mb-8" : "flex flex-wrap justify-center gap-4 mb-8"}>
                                    {tempGeo.type === 'Point' ? ikoner.map(i => <button key={i} onClick={() => handleFinalSave(i)} className="text-3xl hover:scale-125 transition">{i}</button>) : farger.map(f => <button key={f} onClick={() => handleFinalSave(f)} className="w-11 h-11 rounded-full border shadow-sm" style={{ backgroundColor: f }} />)}
                                </div>
                                <button onClick={() => setModalSteg(1)} className="w-full text-gray-400 text-sm">Tilbake</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <MapContainer center={[62.47, 6.15]} zoom={10} className="h-screen w-full z-0">
                <MapViewHandler ruter={ruter} />
                <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Norgeskart (Farge)"><TileLayer url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png" /></LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Norgeskart (Gråtone)"><TileLayer url="https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png" /></LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Satellitt"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /></LayersControl.BaseLayer>
                    <LayersControl.Overlay name="Bratthet (NVE)">
                        <WMSTileLayer url="https://wms.geonorge.no/skwms1/wms.bratthet" layers="bratthet_snoskred" format="image/png" transparent={true} opacity={0.4} version="1.3.0" crs={L.CRS.EPSG3857} />
                    </LayersControl.Overlay>
                </LayersControl>

                {ruter
                    .filter(rute => synligeKategorier.includes(rute.kategori || 'Annet'))
                    .map(rute => {
                        if (!rute.geojson) return null;
                        let pureGeom;
                        try {
                            const parsed = typeof rute.geojson === 'string' ? JSON.parse(rute.geojson) : rute.geojson;
                            pureGeom = parsed?.type === 'Feature' ? parsed.geometry : parsed;
                            if (!pureGeom || !pureGeom.coordinates) return null;
                        } catch (e) { return null; }

                        return (
                            <GeoJSON
                                key={`${rute.id}-${rute.farge}-${ikonStorrelse}`}
                                data={{ type: "Feature", properties: rute, geometry: pureGeom } as any}
                                style={{ color: rute.farge || '#ef4444', weight: 4, opacity: 0.8 }}
                                pointToLayer={(f, latlng) => L.marker(latlng, { icon: L.divIcon({ html: `<div style="font-size: ${ikonStorrelse}px; line-height: 1; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5));">${f.properties.ikon || '📍'}</div>`, className: 'custom-emoji', iconSize: [ikonStorrelse, ikonStorrelse], iconAnchor: [ikonStorrelse / 2, ikonStorrelse / 2] }) })}
                            >
                                {visNavn && (
                                    <Tooltip permanent direction="top" offset={[0, -10]} className="!bg-white/80 !border-transparent !shadow-md !rounded-full !px-3 !py-1 font-sans !text-xs font-bold !text-gray-800 backdrop-blur-sm">
                                        {rute.navn}
                                    </Tooltip>
                                )}
                                <Popup minWidth={320} maxWidth={320} keepInView={true}>
                                    <RoutePopup rute={rute} oppdaterKart={fetchRuter} onStartEdit={handleStartEdit} />
                                </Popup>
                            </GeoJSON>
                        );
                    })}
                <GeomanTools onSave={geometry => { setTempGeo(geometry); setEditingId(null); setModalSteg(1); }} />
            </MapContainer>
        </div>
    );
}