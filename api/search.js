/* MySchool - /api/search
   Pencarian musik: mengambil METADATA dari API publik Deezer (tanpa API key) dan iTunes Search API (tanpa API key),
   lalu mencocokkan judul/artis, menilai relevansi, mengenali lagu Indonesia, dan memisahkan
   Original / DJ / Remix / Cover.
   - Popularitas memakai field "rank" asli dari Deezer. Jika tidak ada datanya, popularitas dibiarkan kosong (tidak dikarang).
   - Audio TIDAK diambil dari sini (hanya metadata). Pemutaran tetap lewat pemutar audio MySchool yang sudah ada.
   Kompatibel Vercel (Node 18+, fetch bawaan). */

const DZ = 'https://api.deezer.com';
const IT = 'https://itunes.apple.com/search';

/* ---------- util teks ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' dan ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(Boolean);

async function getJSON(url, ms = 6000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'MySchool/1.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    if (j && j.error) throw new Error('api error');
    return j;
  } finally { clearTimeout(t); }
}
const safe = p => p.catch(() => null);
/* judul dasar tanpa keterangan versi: "Cinta (DJ Remix)" / "Cinta - Remastered" -> "Cinta" */
const RE_VER_SUFFIX = /\s+-\s+(?:.*\b(?:remix|rmx|mix|edit|version|versi|remaster(?:ed)?|live|acoustic|akustik|cover|karaoke|instrumental|dj|radio|original|single|bonus|mono|stereo)\b.*)$/i;
const stripVer = s => String(s || '').replace(/(?<=\S)\s*[\(\[][^\)\]]*[\)\]]/g, ' ').replace(RE_VER_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
/* artis utama dari "A & B", "A, B", "A feat. B" */
const firstArtist = a => String(a || '').split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0].trim();

/* ---------- klasifikasi versi lagu ---------- */
const RE_DJ = /\b(dj|nightcore|breakbeat|funkot|jedag jedug|jungle dutch|dugem|full bass|bass boosted|viral tiktok|tiktok)\b/;
const RE_REMIX = /\b(remix|rmx|remixed|bootleg|mashup|edit|mix|slowed|sped up|speed up|reverb|flip|rework|vip mix|club mix|extended mix|version dj)\b/;
const RE_COVER = /\b(cover|covered|tribute|karaoke|made famous|originally performed|in the style of|versi cover|piano version|music box|lullaby version)\b/;
const RE_LIVE = /\b(live|unplugged|konser|concert)\b/;

function classify(title, album, artist) {
  const t = norm(title), al = norm(album || ''), a = norm(artist);
  let kind = 'original';
  if (RE_COVER.test(t) || /\b(karaoke|tribute|cover)\b/.test(a)) kind = 'cover';
  if (RE_REMIX.test(t.replace(/\bradio edit\b/g, '')) || /\b(remix|rmx|remixes)\b/.test(al)) kind = 'remix';
  if (RE_DJ.test(t) || /\bdj\b/.test(a) || /\b(dj|nightcore|funkot)\b/.test(al)) kind = 'dj';
  return { kind, live: RE_LIVE.test(t) };
}
function wantKindOf(q) {
  const qn = norm(q);
  return RE_DJ.test(qn) ? 'dj' : RE_REMIX.test(qn) ? 'remix' : RE_COVER.test(qn) ? 'cover' : '';
}

/* ---------- deteksi lagu Indonesia (heuristik, bukan data resmi) ---------- */
const ID_GENRE = /(indonesia|dangdut|minang|campursari|keroncong|koplo|jawa|sunda|batak|melayu|nusantara|pop daerah|religi|gambus|indo)/i;
/* kata kuat = khas bahasa Indonesia; kata lemah (partikel) tidak dihitung sendirian */
const ID_WORDS = new Set(('aku kamu kau dia kita kami mereka tak tidak bukan belum sudah masih akan ' +
  'mutiara permata cinta rindu sayang hati rasa jiwa sendiri sepi pergi pulang datang kembali kenangan mimpi malam pagi hujan senja ' +
  'bintang bulan matahari langit lagu kasih mantan pacar cantik tampan sahabat teman ibu bapak ayah anak rumah ' +
  'jangan ingin harus pernah selalu tetap hanya cuma saja yuk semoga ' +
  'terima percaya setia janji bahagia sedih luka mata senyum peluk goyang joget pantun kampung negeri merah putih ' +
  'perempuan lelaki wanita kakak adik abang kapan dimana kenapa mengapa bagaimana siapa').split(' '));
const ID_WEAK = new Set('yang dan di ke dari untuk dengan'.split(' '));
const EN_WORDS = new Set(('the you your my me we us it is are was be to of in on at for with and or but not no yes all just like love baby girl boy ' +
  'night day heart man woman world time life dont im ill cant wont feel want need know got get go come back down up away home ' +
  'out over under again never ever one two this that when where what why how can will would should could').split(' '));

function idByWords(title) {
  const w = toks(title);
  if (!w.length) return false;
  const strong = w.filter(x => ID_WORDS.has(x)).length;
  const weak = w.filter(x => ID_WEAK.has(x)).length;
  const en = w.filter(x => EN_WORDS.has(x)).length;
  if (en >= strong + weak && en > 0) return false; /* judul dominan kata Inggris -> bukan lagu Indonesia */
  return (strong >= 2) || (strong >= 1 && weak >= 1) || (strong >= 1 && w.length <= 2);
}

/* ---------- pencocokan teks ---------- */
function tokMatch(q, w) {
  if (q === w) return 1;
  if (q.length >= 3 && (w.startsWith(q) || q.startsWith(w) && w.length >= 3)) return 0.85;
  if (q.length >= 4 && w.includes(q)) return 0.6;
  if (q.length >= 5 && w.length >= 5 && Math.abs(q.length - w.length) <= 1 && lev(q, w) <= 1) return 0.75; /* salah ketik 1 huruf */
  return 0;
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const c = [i];
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[n];
}
/* seberapa baik rangkaian token query cocok dengan teks (0..1) */
function coverage(qt, text) {
  const wt = toks(text); if (!qt.length || !wt.length) return 0;
  let s = 0;
  for (const q of qt) { let b = 0; for (const w of wt) b = Math.max(b, tokMatch(q, w)); s += b; }
  return s / qt.length;
}
function fieldScore(q, qt, text) {
  const t = norm(text); if (!t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q + ' ') || t.startsWith(q)) return 0.88;
  const c = coverage(qt, text);
  return c * 0.8;
}

/* ---------- popularitas: HANYA dari rank Deezer asli ---------- */
const popOf = rank => (rank > 0 ? Math.min(1, Math.log10(rank + 1) / Math.log10(1000001)) : null);

/* ---------- normalisasi sumber ---------- */
/* kunci duplikat = artis utama + judul dasar + jenis versi (original/remix/dj/cover) + live.
   Versi remix TIDAK lagi digabung/menimpa lagu original. */
function finish(it, rawTitle) {
  const cl = classify(it.title, it.album, it.artist);
  it.kind = cl.kind; it.live = cl.live;
  it.base = stripVer(rawTitle || it.title) || it.title;
  it.key = norm(firstArtist(it.artist)) + '|' + norm(it.base) + '|' + it.kind + '|' + (it.live ? 'l' : '');
  return it;
}
function fromDeezer(x) {
  if (!x || !x.id || !x.title || !x.artist || !x.artist.name) return null;
  return finish({
    dz: String(x.id), title: String(x.title).trim(), artist: String(x.artist.name), album: x.album ? x.album.title || '' : '',
    cover: x.album ? (x.album.cover_big || x.album.cover_medium || '') : '', dur: Math.round(x.duration) || 0,
    rank: x.rank > 0 ? x.rank : 0, genre: '', itunes: false, src: 'deezer'
  }, x.title_short || x.title);
}
function fromItunes(x) {
  if (!x || x.kind !== 'song' || !x.trackName || !x.artistName) return null;
  return finish({
    dz: '', title: String(x.trackName).trim(), artist: String(x.artistName), album: x.collectionName || '',
    cover: (x.artworkUrl100 || '').replace('100x100bb', '600x600bb'), dur: Math.round((x.trackTimeMillis || 0) / 1000),
    rank: 0, genre: x.primaryGenreName || '', itunes: true, src: 'itunes'
  }, x.trackName);
}

/* ---------- relevansi: judul & artis dipisah ---------- */
const MIN_STRICT = 55, MIN_APPROX = 22;
function relevance(i, ctx) {
  const { qn, qt, artistIntent } = ctx;
  const tb = norm(i.base), an = norm(firstArtist(i.artist)), anFull = norm(i.artist);
  const aEx = an === qn;                                        /* nama artis == query */
  const aHas = !aEx && (' ' + anFull + ' ').includes(' ' + qn + ' '); /* artis kolaborasi memuat nama */
  const tEx = tb === qn;                                        /* judul == query (exact match) */
  /* query gabungan "artis judul": token artis + sisa token = judul */
  let comboEx = false, comboPart = 0;
  const at = toks(an);
  if (qt.length >= 2 && at.length && at.length < qt.length) {
    const rest = [...qt]; let ok = true;
    for (const w of at) { const k = rest.indexOf(w); if (k < 0) { ok = false; break; } rest.splice(k, 1); }
    if (ok && rest.length) { comboEx = rest.join(' ') === tb; comboPart = comboEx ? 1 : coverage(rest, i.base); }
  }
  let base = 0, why = '';
  if (comboEx) { base = 106; why = 'artis+judul'; }
  else if (aEx) { base = 100; why = 'artis'; }
  else if (tEx) { base = 100; why = 'judul'; }
  else if (aHas) { base = 80; why = 'artis'; }
  else if (comboPart >= 0.85) { base = 78; why = 'artis+judul'; }
  else if (tb.startsWith(qn + ' ')) { base = 74; why = 'judul'; }
  else {
    const c = coverage(qt, i.base);
    base = c >= 0.99 ? 70 : c >= 0.85 ? 58 : c * 55; why = 'judul';
    const ac = coverage(qt, i.artist) * 60;
    if (ac > base) { base = ac; why = 'artis'; }
  }
  /* pencarian nama artis: lagu artis lain dibuang (kecuali judulnya persis sama dengan query) */
  if (artistIntent && !aEx && !aHas && !tEx && !comboEx && comboPart < 0.85) base = 0;
  return { base, why, aEx, tEx };
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  const q = String((req.query && req.query.q) || '').trim().slice(0, 100);
  const preferId = String((req.query && req.query.id) || '1') !== '0';
  if (!q) { res.status(400).json({ error: 'q kosong' }); return; }
  if (!toks(q).length) { res.status(200).json({ q, items: [], artist: null }); return; }
  const wantKind = wantKindOf(q);
  /* kata penanda versi ("dj", "remix", "cover") bukan bagian judul/artis: dibuang dari pencocokan, hanya mengatur prioritas versi */
  const qtc = toks(q).filter(w => !/^(dj|remix|rmx|cover|karaoke|nightcore|mix|bootleg|mashup)$/.test(w));
  const qt = wantKind && qtc.length ? qtc : toks(q), qn = qt.join(' ');
  const qs = qt.join(' ');

  /* 1) kandidat: pencarian artis, judul, dan gabungan dipisah (sintaks lanjutan Deezer + attribute iTunes) */
  const e = encodeURIComponent, dq = s => e(String(s).replace(/"/g, ' '));
  const jobs = [
    safe(getJSON(`${DZ}/search/artist?q=${e(qs)}&limit=5`)),                       /* 0 artis */
    safe(getJSON(`${DZ}/search/track?q=track:"${dq(qs)}"&limit=100`)),            /* 1 judul */
    safe(getJSON(`${DZ}/search/track?q=artist:"${dq(qs)}"&limit=50`)),            /* 2 artis */
    safe(getJSON(`${DZ}/search/track?q=${e(qs)}&limit=100`)),                     /* 3 bebas (cadangan, "artis judul") */
    safe(getJSON(`${IT}?term=${e(qs)}&country=ID&media=music&entity=song&attribute=songTerm&limit=200&lang=id_id`)),   /* 4 judul */
    safe(getJSON(`${IT}?term=${e(qs)}&country=ID&media=music&entity=song&attribute=artistTerm&limit=200&lang=id_id`)), /* 5 artis */
    safe(getJSON(`${IT}?term=${e(qs)}&country=ID&media=music&entity=song&limit=200&lang=id_id`))                       /* 6 bebas */
  ];
  if (qt.length >= 2) {
    jobs.push(safe(getJSON(`${DZ}/search/track?q=artist:"${dq(qt[0])}" track:"${dq(qt.slice(1).join(' '))}"&limit=30`)));
    jobs.push(safe(getJSON(`${DZ}/search/track?q=track:"${dq(qt.slice(0, -1).join(' '))}" artist:"${dq(qt[qt.length - 1])}"&limit=30`)));
  }
  const r = await Promise.all(jobs);
  const [dArt, dTrk, dArtTrk, dFree, iSong, iArt, iFree] = r;
  if (r.every(x => !x)) { res.status(502).json({ error: 'sumber tidak tersedia' }); return; }

  /* 2) kenali artis yang dicari (hanya bila namanya benar-benar cocok) */
  let artist = null, best = 0;
  for (const a of ((dArt && dArt.data) || [])) {
    const an = norm(a.name); let s = 0;
    if (an === qn) s = 1; else if (an.startsWith(qn + ' ') || qn.startsWith(an + ' ')) s = 0.8; else if (coverage(qt, a.name) >= 0.99 && toks(a.name).length <= qt.length + 1) s = 0.7;
    s = s * (1 + Math.min(0.3, Math.log10((a.nb_fan || 0) + 10) / 20));
    if (s > best) { best = s; artist = a; }
  }
  if (artist && best < 0.7) artist = null;
  const topTracks = artist ? await safe(getJSON(`${DZ}/artist/${artist.id}/top?limit=50`)) : null;

  /* 3) gabungkan & hilangkan duplikat */
  const map = new Map();
  const add = (it, from) => {
    if (!it) return;
    const old = map.get(it.key);
    if (!old) { it.from = [from]; map.set(it.key, it); return; }
    old.from.push(from);
    if (it.dz && (!old.dz || it.rank > old.rank)) { old.dz = it.dz; old.dur = it.dur || old.dur; old.rank = it.rank || old.rank; if (it.cover) old.cover = it.cover; }
    if (!old.genre && it.genre) old.genre = it.genre;
    if (it.itunes) old.itunes = true;
    if (!old.cover && it.cover) old.cover = it.cover;
    if (!old.rank && it.rank) old.rank = it.rank;
    if (!old.dur && it.dur) old.dur = it.dur;
  };
  ((topTracks && topTracks.data) || []).forEach(x => add(fromDeezer(x), 'top'));
  [[dTrk, 'dz'], [dArtTrk, 'dza'], [dFree, 'dzf'], ...r.slice(7).map(x => [x, 'dzc'])].forEach(([j, f]) => ((j && j.data) || []).forEach(x => add(fromDeezer(x), f)));
  [iSong, iArt, iFree].forEach(j => ((j && j.results) || []).forEach(x => add(fromItunes(x), 'it')));
  const list = [...map.values()];

  /* 4) tandai artis Indonesia: genre iTunes -> sebarkan ke semua lagu artis yang sama */
  const idArtists = new Set();
  list.forEach(i => { if (ID_GENRE.test(i.genre) && !/world|international/i.test(i.genre.replace(/indonesia/i, ''))) idArtists.add(norm(firstArtist(i.artist))); });
  list.forEach(i => {
    const byGenre = ID_GENRE.test(i.genre);
    const byArtist = idArtists.has(norm(firstArtist(i.artist)));
    const byWords = idByWords(i.base);
    i.isId = byGenre || byArtist || (byWords && !/^(korea|jpop|k-pop)/i.test(i.genre));
    i.idWhy = byGenre ? 'genre' : byArtist ? 'artis' : byWords ? 'judul' : '';
  });

  /* 5) relevansi -> niat pencarian -> skor */
  const artistIntent = !!artist && norm(artist.name) === qn;
  const ctx = { qn, qt, artistIntent };
  list.forEach(i => { const rv = relevance(i, ctx); i.base0 = rv.base; i.why = rv.why; i.exactT = rv.tEx; i.exactA = rv.aEx; });
  /* pencarian artis: versi DJ/remix/cover dari kolaborator/artis lain tidak ikut, kecuali memang diminta */
  list.forEach(i => { if (artistIntent && !i.exactA && !i.exactT && i.kind !== 'original' && i.kind !== wantKind) i.base0 = 0; });

  const idShare = (() => { const top = list.filter(i => i.base0 >= 70).slice(0, 15); return top.length ? top.filter(i => i.isId).length / top.length : 0; })();
  const idIntent = preferId && (idShare >= 0.5 || (artistIntent && list.some(i => i.exactA && i.isId)) || qt.some(w => ID_WORDS.has(w)));

  const anyId = list.some(i => i.base0 >= 80 && i.isId);
  list.forEach(i => {
    let s = i.base0;
    const pop = popOf(i.rank); i.pop = pop;
    if (pop !== null) s += pop * 8;                         /* popularitas hanya penentu urutan; dipakai bila datanya ada */
    if (artistIntent && i.from.includes('top')) s += 3;
    if (i.itunes && i.dz) s += 2;
    if (preferId) s += i.isId ? 25 : (anyId || idIntent ? -25 : 0); /* mode Indonesia: lagu Indonesia di atas lagu luar */
    if (i.live) s -= 6;
    if (i.kind !== 'original' && wantKind !== i.kind) s -= 30;  /* original dulu, lalu remix/DJ/cover */
    if (wantKind && i.kind === wantKind) s += 10;
    i.score = Math.round(s * 10) / 10;
  });

  const hasExact = list.some(i => i.base0 >= 100);
  const strict = list.filter(i => i.base0 >= (hasExact ? 80 : MIN_STRICT));
  const approx = strict.length === 0;
  const pool = approx ? list.filter(i => i.base0 >= MIN_APPROX) : strict;
  const out = pool.sort((a, b) => b.score - a.score).slice(0, approx ? 20 : 80).map(i => ({
    title: i.title, artist: i.artist, album: i.album, cover: i.cover, dur: i.dur, dz: i.dz,
    kind: i.kind, live: i.live, id: !!i.isId, idWhy: i.idWhy,
    pop: i.pop === null ? null : Math.round(i.pop * 100) / 100, score: i.score, match: i.why,
    exact: !!i.exactA
  }));
  const suggest = approx ? [...new Set(((dArt && dArt.data) || []).map(a => a.name).filter(Boolean))].slice(0, 4) : [];

  res.status(200).json({
    q, artist: artist ? { name: artist.name, fans: artist.nb_fan || 0, pic: artist.picture_medium || '' } : null,
    idIntent, artistIntent, approx, suggest, items: out, src: 'Deezer, iTunes'
  });
};

/* untuk pengujian lokal */
module.exports._t = { norm, classify, coverage, popOf, idByWords, stripVer, firstArtist };
