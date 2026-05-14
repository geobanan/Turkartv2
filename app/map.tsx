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

// Hjelpefunksjon: GPX til GeoJSON
function gpxToGeoJSON(xmlString: string) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, "text/xml");
    const trkpts = Array.from(xml.querySelectorAll("trkpt")).map(pt => [parseFloat(pt.getAttribute("lon")!), parseFloat(pt.getAttribute("lat")!)]);
    if (trkpts.length > 0) return { type: "LineString", coordinates: trkpts };
    const wpt = xml.querySelector("wpt");
    if (wpt) return { type: "Point", coordinates: [parseFloat(wpt.getAttribute("lon")!), parseFloat(wpt.getAttribute("lat")!)] };
    return null;
}

// Hjelpefunksjon: Beregn distanse i km for en LineString
function beregnDistanse(coords: any[]) {
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        dist += L.latLng(coords[i][1], coords[i][0]).distanceTo(L.latLng(coords[i + 1][1], coords[i + 1][0]));
    }
    return (dist / 1000).toFixed(1);
}

// 1. POPUP
function RoutePopup({ rute, oppdaterKart }: { rute: any, oppdaterKart: () => void }) {
    const [fane, setFane] = useState<'info' | 'vaer' | 'hoyde'>('info');
    const [kommentarer, setKommentarer] = useState<any[]>([]);
    const [nyKommentar, setNyKommentar] = useState('');
    const [harStemt, setHarStemt] = useState(false);
    const [upvotes, setUpvotes] = useState(Number(rute.upvotes) || 0);
    const [downvotes, setDownvotes] = useState(Number(rute.downvotes) || 0);

    const [vaer, setVaer] = useState<any[]>([]);
    const [hoydeProfil, setHoydeProfil] = useState<number[]>([]);
    const [distanse, setDistanse] = useState<string | null>(null);

    useEffect(() => {
        const stemmeData = localStorage.getItem(`stemt_${rute.id}`);
        if (stemmeData) setHarStemt(true);
        hentKommentarer();
        hentYrVaer();

        if (rute.type === 'LineString' && rute.geojson?.coordinates) {
            setDistanse(beregnDistanse(rute.geojson.coordinates));
        }
    }, [rute.id]);

    useEffect(() => {
        if (fane === 'hoyde' && hoydeProfil.length === 0 && rute.type === 'LineString') {
            hentHoydeProfil();
        }
    }, [fane]);

    async function hentKommentarer() {
        const { data } = await supabase.from('kommentarer').select('*').eq('rute_id', rute.id).order('created_at', { ascending: false });
        if (data) setKommentarer(data);
    }

    // Henter 15 punkter langs ruten fra Kartverket for høydeprofil
    async function hentHoydeProfil() {
        const coords = rute.geojson.coordinates;
        const step = Math.max(1, Math.floor(coords.length / 15));
        const sampled = coords.filter((_: any, i: number) => i % step === 0);

        try {
            const promises = sampled.map((c: any) =>
                fetch(`https://ws.geonorge.no/hoydedata/v1/punkt?nord=${c[1]}&ost=${c[0]}&koordsys=4326`)
                    .then(r => r.json())
                    .then(d => d.punkter[0].z)
            );
            const heights = await Promise.all(promises);
            setHoydeProfil(heights);
        } catch (e) { console.error("Kunne ikke hente høyder"); }
    }

    async function hentYrVaer() {
        try {
            let lat = 62.47, lon = 6.15;
            const coords = rute.geojson.coordinates;
            if (rute.type === 'Point') { lon = coords[0]; lat = coords[1]; }
            else if (rute.type === 'LineString') { lon = coords[0][0]; lat = coords[0][1]; }
            else if (rute.type === 'Polygon') { lon = coords[0][0][0]; lat = coords[0][0][1]; }

            const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`);
            const data = await res.json();

            const dager: any = {};
            data.properties.timeseries.forEach((t: any) => {
                const dateObj = new Date(t.time);
                const dato = dateObj.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric' });
                const time = dateObj.getHours();

                if (!dager[dato]) dager[dato] = { morgen: null, dag: null, kveld: null };

                const info = {
                    temp: Math.round(t.data.instant.details.air_temperature),
                    vind: Math.round(t.data.instant.details.wind_speed),
                    ikon: '☁️'
                };

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
        } catch (error) { }
    }

    async function stem(type: 'up' | 'down') {
        if (harStemt) return;
        type === 'up' ? setUpvotes(p => p + 1) : setDownvotes(p => p + 1);
        setHarStemt(true);
        localStorage.setItem(`stemt_${rute.id}`, 'true');
        await supabase.rpc(type === 'up' ? 'increment_upvote' : 'increment_downvote', { row_id: rute.id });
    }

    async function postKommentar() {
        if (!nyKommentar.trim()) return;
        const { error } = await supabase.from('kommentarer').insert([{ rute_id: rute.id, tekst: nyKommentar }]);
        if (!error) { setNyKommentar(''); hentKommentarer(); }
    }

    // Kopier URL
    const kopierLenke = () => {
        const url = `${window.location.origin}${window.location.pathname}?rute=${rute.id}`;
        navigator.clipboard.writeText(url);
        alert("Lenke til ruten er kopiert! Del i vei.");
    };

    return (
        <div className="w-[320px] flex flex-col font-sans text-gray-800">

            {/* HEADER */}
            <div className="flex justify-between items-start border-b pb-2 mb-2">
                <div className="overflow-hidden">
                    <h3 className="font-bold text-lg leading-tight m-0 truncate pr-2">{rute.navn}</h3>
                    {distanse && <span className="text-[10px] text-gray-500 bg-gray-100 px-1 rounded">📏 {distanse} km</span>}
                </div>
                <div className="flex gap-1 shrink-0">
                    <button onClick={kopierLenke} className="text-blue-500 hover:bg-blue-50 p-1 rounded transition" title="Kopier lenke">🔗</button>
                    <button onClick={async () => { if (confirm("Slette?")) { await supabase.from('toppturer').delete().eq('id', rute.id); oppdaterKart(); } }} className="text-red-500 hover:bg-red-50 p-1 rounded transition" title="Slett rute">🗑️</button>
                </div>
            </div>

            {/* FANER */}
            <div className="flex border-b mb-3">
                <button onClick={() => setFane('info')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'info' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>Info</button>
                <button onClick={() => setFane('vaer')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'vaer' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>🌤️ Vær</button>
                {rute.type === 'LineString' && (
                    <button onClick={() => setFane('hoyde')} className={`flex-1 pb-1 text-xs font-bold transition ${fane === 'hoyde' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>📈 Høyde</button>
                )}
            </div>

            {/* FANE 1: INFO */}
            {fane === 'info' && (
                <>
                    <div className="flex gap-2 mb-3">
                        <button onClick={() => stem('up')} className={`flex-1 bg-gray-50 py-1 rounded border text-sm ${harStemt ? 'opacity-50' : 'hover:bg-gray-100'}`}>👍 {upvotes}</button>
                        <button onClick={() => stem('down')} className={`flex-1 bg-gray-50 py-1 rounded border text-sm ${harStemt ? 'opacity-50' : 'hover:bg-gray-100'}`}>👎 {downvotes}</button>
                    </div>
                    <div className="space-y-2 mb-3 overflow-y-auto max-h-[140px] pr-1 custom-scrollbar">
                        {kommentarer.map(k => (
                            <div key={k.id} className="bg-gray-50 border p-2 rounded text-sm break-words whitespace-pre-wrap">
                                <span className="text-[9px] text-gray-400 block mb-1">{new Date(k.created_at).toLocaleDateString()}</span>
                                {k.tekst}
                            </div>
                        ))}
                        {kommentarer.length === 0 && <p className="text-xs text-gray-400 italic text-center py-2">Ingen kommentarer ennå.</p>}
                    </div>
                    <div className="flex gap-1 mt-auto">
                        <textarea value={nyKommentar} onChange={e => setNyKommentar(e.target.value)} placeholder="Skriv noe..." className="border text-xs p-2 flex-grow rounded h-[34px] resize-none focus:outline-none focus:ring-1 focus:ring-blue-400" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postKommentar(); } }} />
                        <button onClick={postKommentar} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 rounded">Send</button>
                    </div>
                </>
            )}

            {/* FANE 2: DETALJERT VÆR */}
            {fane === 'vaer' && (
                <div className="flex flex-col gap-2 min-h-[200px]">
                    {vaer.length > 0 ? vaer.map(([dato, p]: any, i: number) => (
                        <div key={i} className="border border-gray-100 rounded bg-gray-50 p-2">
                            <div className="text-[10px] font-bold text-blue-800 uppercase mb-1 border-b border-gray-200 pb-1">{dato}</div>
                            <div className="flex justify-between">
                                {[
                                    { navn: 'Morgen', data: p.morgen },
                                    { navn: 'Dag', data: p.dag },
                                    { navn: 'Kveld', data: p.kveld }
                                ].map(tid => (
                                    <div key={tid.navn} className="flex flex-col items-center flex-1">
                                        <span className="text-[9px] text-gray-400">{tid.navn}</span>
                                        <span className="text-xl my-[2px]">{tid.data?.ikon || '-'}</span>
                                        <span className="text-xs font-bold text-gray-700">{tid.data ? `${tid.data.temp}°` : '-'}</span>
                                        <span className="text-[9px] text-gray-500">{tid.data ? `${tid.data.vind}m/s` : ''}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )) : <p className="text-xs text-gray-400 text-center mt-4">Henter værdata fra Yr...</p>}
                </div>
            )}

            {/* FANE 3: HØYDEPROFIL */}
            {fane === 'hoyde' && (
                <div className="min-h-[180px] flex flex-col justify-center">
                    {hoydeProfil.length > 0 ? (() => {
                        const min = Math.min(...hoydeProfil);
                        const max = Math.max(...hoydeProfil);
                        const range = max - min || 1;

                        // Tegner en enkel SVG polygon for profilen
                        const points = hoydeProfil.map((h, i) => `${(i / (hoydeProfil.length - 1)) * 100},${100 - ((h - min) / range) * 100}`).join(' ');

                        return (
                            <>
                                <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-2 px-1">
                                    <span>Lavest: {Math.round(min)} moh</span>
                                    <span>Høyest: {Math.round(max)} moh</span>
                                </div>
                                <div className="w-full h-24 bg-blue-50 border-b-2 border-blue-200 relative overflow-hidden rounded">
                                    <svg className="absolute w-full h-full preserve-3d" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <polygon points={`0,100 ${points} 100,100`} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                    </svg>
                                </div>
                            </>
                        );
                    })() : <p className="text-xs text-gray-400 text-center">Henter høydedata fra Kartverket...</p>}
                </div>
            )}
        </div>
    );
}

// 2. TEGNEVERKTØY (Ren og ryddig)
function GeomanTools({ onSave }: { onSave: (geo: any) => void }) {
    const map = useMap();
    useEffect(() => {
        if (!map.pm) return;
        map.pm.removeControls();
        map.pm.addControls({
            position: 'topleft',
            drawMarker: true, drawPolyline: true, drawPolygon: true, editMode: true, removalMode: true,
            drawRectangle: false, drawCircle: false, drawCircleMarker: false, drawText: false, dragMode: false, cutPolygon: false, rotateMode: false
        });
        map.on('pm:create', (e: any) => { onSave(e.layer.toGeoJSON().geometry); map.removeLayer(e.layer); });
        return () => { map.off('pm:create'); };
    }, [map, onSave]);
    return null;
}

// Hjelpekomponent for å zoome til delt rute ved innlasting
function MapController({ ruter }: { ruter: any[] }) {
    const map = useMap();
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ruteId = params.get('rute');
        if (ruteId && ruter.length > 0) {
            const valgt = ruter.find(r => r.id === ruteId);
            if (valgt && valgt.geojson) {
                const layer = L.geoJSON(valgt.geojson);
                map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 14 });
            }
        }
    }, [ruter, map]);
    return null;
}

// 3. HOVEDKART
export default function Map() {
    const [ruter, setRuter] = useState<any[]>([]);
    const [visNavn, setVisNavn] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [modalSteg, setModalSteg] = useState(0);
    const [tempGeo, setTempGeo] = useState<any>(null);
    const [tempNavn, setTempNavn] = useState('');

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
            if (geo) { setTempGeo(geo.geometry || geo); setTempNavn(file.name.replace(/\.[^/.]+$/, "")); setModalSteg(1); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleFinalSave = async (verdi: string) => {
        const payload = tempGeo.type === 'Point'
            ? { navn: tempNavn, geom: tempGeo, type: tempGeo.type, ikon: verdi }
            : { navn: tempNavn, geom: tempGeo, type: tempGeo.type, farge: verdi };
        await supabase.from('toppturer').insert([payload]);
        setModalSteg(0); fetchRuter();
    };

    return (
        <div className="h-full w-full relative">
            <div className="absolute top-[300px] left-[10px] z-[1000] flex flex-col gap-2">
                <button onClick={() => setVisNavn(!visNavn)} className="bg-white p-2 rounded shadow text-lg w-[34px] flex justify-center hover:bg-gray-50">{visNavn ? '👁️' : '🕶️'}</button>
                <button onClick={() => fileInputRef.current?.click()} className="bg-white p-2 rounded shadow text-lg w-[34px] flex justify-center hover:bg-gray-50">📤</button>
                <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept=".gpx,.geojson,.json" />
            </div>

            {modalSteg > 0 && (
                <div className="absolute inset-0 bg-black/60 z-[2000] flex items-center justify-center backdrop-blur-sm p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm">
                        {modalSteg === 1 ? (
                            <div className="flex flex-col items-center">
                                <h3 className="font-bold text-xl mb-4">Lagre markering</h3>
                                <input autoFocus value={tempNavn} onChange={e => setTempNavn(e.target.value)} onKeyDown={e => e.key === 'Enter' && setModalSteg(2)} className="w-full border-2 border-blue-50 p-3 rounded-lg mb-6 outline-none focus:border-blue-500 text-center text-lg" />
                                <div className="flex gap-2 w-full">
                                    <button onClick={() => setModalSteg(0)} className="w-1/2 bg-gray-50 p-3 rounded-lg font-medium">Avbryt</button>
                                    <button onClick={() => setModalSteg(2)} disabled={!tempNavn} className="w-1/2 bg-blue-600 text-white p-3 rounded-lg font-medium disabled:opacity-50">Neste</button>
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
                <MapController ruter={ruter} />
                <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Kartverket Topo"><TileLayer url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png" /></LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Satellitt"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /></LayersControl.BaseLayer>
                    <LayersControl.Overlay name="Bratthet"><WMSTileLayer url="https://gis3.nve.no/map/services/Bratthet/MapServer/WmsServer" layers="Bratthet_snoskred" format="image/png" transparent={true} opacity={0.5} /></LayersControl.Overlay>
                </LayersControl>

                {ruter.map(rute => (
                    <GeoJSON key={rute.id} data={{ type: "Feature", properties: rute, geometry: rute.geojson } as any} style={{ color: rute.farge || 'red', weight: 4 }} pointToLayer={(f, latlng) => L.marker(latlng, { icon: L.divIcon({ html: `<div style="font-size: 24px; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.4));">${f.properties.ikon || '📍'}</div>`, className: 'custom-emoji', iconSize: [30, 30], iconAnchor: [15, 30] }) })}>
                        {visNavn && <Tooltip permanent direction="center" className="font-bold bg-white/80 border-none rounded px-2">{rute.navn}</Tooltip>}
                        <Popup><RoutePopup rute={rute} oppdaterKart={fetchRuter} /></Popup>
                    </GeoJSON>
                ))}
                <GeomanTools onSave={geometry => { setTempGeo(geometry); setModalSteg(1); }} />
            </MapContainer>
        </div>
    );
}