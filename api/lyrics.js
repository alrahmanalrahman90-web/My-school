/* MySchool - /api/lyrics
   Proxy tipis ke LRCLIB (https://lrclib.net, gratis, tanpa API key) untuk lirik bertimestamp (format LRC).
   Hanya meneruskan pencarian; pencocokan judul/artis/durasi dilakukan di aplikasi. Tidak ada lirik yang dikarang.
   Mengembalikan null (status 200) bila lirik tidak ditemukan. Kompatibel Vercel (Node 18+). */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const e = String((req.query && req.query.e) || '');
  if (e !== 'get' && e !== 'search') { res.status(400).json({ error: 'e tidak valid' }); return; }
  const p = new URLSearchParams();
  ['track_name', 'artist_name', 'album_name', 'duration', 'q'].forEach(k => {
    const v = req.query && req.query[k];
    if (v) p.set(k, String(v).slice(0, 200));
  });
  if (![...p.keys()].length) { res.status(400).json({ error: 'parameter kosong' }); return; }
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch('https://lrclib.net/api/' + e + '?' + p.toString(), {
      signal: c.signal,
      headers: { 'User-Agent': 'MySchool/1.0', 'Lrclib-Client': 'MySchool', Accept: 'application/json' }
    });
    if (r.status === 404) { res.setHeader('Cache-Control', 'public, s-maxage=3600'); res.status(200).json(null); return; }
    if (!r.ok) throw new Error('http ' + r.status);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'sumber lirik tidak tersedia' });
  } finally { clearTimeout(t); }
};
                                                     
