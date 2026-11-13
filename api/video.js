/* MySchool - /api/video
   Mencari kandidat video YouTube di sisi server (tanpa proxy CORS publik / server Piped yang sering mati).
   Mengembalikan daftar kandidat {id,title,ch,dur,ok}. Pencocokan judul/artis/durasi dan pemilihan video musik asli
   dilakukan di aplikasi (index.html). "ok" = hasil cek oEmbed YouTube: false bila video tidak boleh disematkan / sudah dihapus.
   Tidak ada ID video yang dikarang: semua berasal dari hasil pencarian YouTube. Kompatibel Vercel (Node 18+). */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function tf(url, ms, opt) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...(opt || {}), signal: c.signal }); } finally { clearTimeout(t); }
}
const txt = o => (o ? (o.simpleText || (o.runs || []).map(r => r.text).join('')) : '');
const secs = s => (s ? String(s).split(':').reduce((a, b) => a * 60 + (+b || 0), 0) : 0);

function walk(o, f) {
  if (o && typeof o === 'object') {
    if (o.videoRenderer) f(o.videoRenderer);
    for (const k in o) walk(o[k], f);
  }
}
function collect(data) {
  const L = [], seen = new Set();
  walk(data, v => {
    if (!v.videoId || seen.has(v.videoId)) return;
    seen.add(v.videoId);
    L.push({
      id: v.videoId, title: txt(v.title),
      ch: txt(v.ownerText || v.longBylineText || v.shortBylineText),
      dur: secs(v.lengthText && v.lengthText.simpleText)   /* 0 = live / tanpa durasi */
    });
  });
  return L;
}

/* 1) InnerTube (API internal YouTube) dengan beberapa klien */
const CLIENTS = [
  { clientName: 'WEB', clientVersion: '2.20250101.00.00' },
  { clientName: 'MWEB', clientVersion: '2.20250101.00.00' },
  { clientName: 'TVHTML5', clientVersion: '7.20250101.00.00' }
];
async function viaInnerTube(q, c) {
  const r = await tf('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', 7000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://www.youtube.com', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    body: JSON.stringify({ context: { client: { ...c, hl: 'en', gl: 'ID' } }, query: q, params: 'EgIQAQ==' })
  });
  if (!r.ok) throw new Error('http ' + r.status);
  const L = collect(await r.json());
  if (!L.length) throw new Error('kosong');
  return L;
}
/* 2) cadangan: halaman hasil pencarian (ytInitialData) */
async function viaHtml(q) {
  const r = await tf('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D&hl=en&gl=ID', 8000, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }
  });
  if (!r.ok) throw new Error('http ' + r.status);
  const h = await r.text(), m = h.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (!m) throw new Error('tanpa data');
  const L = collect(JSON.parse(m[1]));
  if (!L.length) throw new Error('kosong');
  return L;
}
/* 3) cadangan: Piped & Invidious (dipanggil dari server, bebas CORS) */
const PIPED = ['https://pipedapi.kavin.rocks', 'https://api.piped.private.coffee', 'https://pipedapi.adminforge.de'];
const INVID = ['https://yewtu.be', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de'];
async function viaMirrors(q) {
  const jobs = [
    ...PIPED.map(h => async () => {
      const r = await tf(h + '/search?filter=videos&q=' + encodeURIComponent(q), 6000, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      const L = (j.items || []).filter(x => /watch\?v=/.test(x.url || '')).map(x => ({ id: x.url.split('v=')[1].split('&')[0], title: String(x.title || ''), ch: String(x.uploaderName || ''), dur: Math.round(x.duration) || 0 }));
      if (!L.length) throw new Error('kosong'); return L;
    }),
    ...INVID.map(h => async () => {
      const r = await tf(h + '/api/v1/search?type=video&q=' + encodeURIComponent(q), 6000, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      const L = (Array.isArray(j) ? j : []).filter(x => x.videoId).map(x => ({ id: x.videoId, title: String(x.title || ''), ch: String(x.author || ''), dur: +x.lengthSeconds || 0 }));
      if (!L.length) throw new Error('kosong'); return L;
    })
  ];
  return await Promise.any(jobs.map(f => f()));
}
const DBG = [];
async function search(q) {
  for (const c of CLIENTS) { try { return await viaInnerTube(q, c); } catch (e) { DBG.push(c.clientName + ': ' + e.message); } }
  try { return await viaHtml(q); } catch (e) { DBG.push('html: ' + e.message); }
  try { return await viaMirrors(q); } catch (e) { DBG.push('mirror: gagal semua'); }
  return [];
}

/* cek apakah video boleh disematkan: 200 = ya; 401/403 = pemilik melarang sematan; 404 = tidak ada/privat */
async function embeddable(id) {
  try {
    const r = await tf('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), 4000, { headers: { 'User-Agent': UA } });
    if (r.status === 200) return true;
    if (r.status === 401 || r.status === 403 || r.status === 404) return false;
  } catch (e) {}
  return undefined; /* tidak diketahui: jangan dibuang */
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String((req.query && req.query.q) || '').trim().slice(0, 160);
  if (!q) { res.status(400).json({ error: 'q kosong' }); return; }
  try {
    /* dua pencarian paralel: dengan kata "official music video" dan tanpa, supaya video resmi tanpa kata itu tetap terjaring */
    const base = q.replace(/\s+official music video\s*$/i, '').trim();
    const [a, b] = await Promise.all([search(q).catch(() => []), base && base !== q ? search(base).catch(() => []) : Promise.resolve([])]);
    const seen = new Set(), L = [];
    [...a, ...b].forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); L.push(x); } });
    if (!L.length) { res.status(502).json({ error: 'YouTube tidak menjawab', debug: DBG.slice(-8) }); return; }
    const top = L.slice(0, 20);
    const ok = await Promise.all(top.map(x => embeddable(x.id)));
    top.forEach((x, i) => { x.ok = ok[i]; });
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    const items = top.filter(x => x.ok !== false);
    res.status(200).json(req.query && req.query.debug ? { q, items, debug: DBG.slice(-8), total: L.length } : { q, items });
  } catch (err) {
    res.status(502).json({ error: 'pencarian video gagal' });
  }
};

module.exports._t = { collect, secs };
  
