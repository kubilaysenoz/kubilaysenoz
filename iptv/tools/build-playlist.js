#!/usr/bin/env node
/*
 * NOMADS INDUSTRY IPTV - kanal listesi üretici
 *
 *   node iptv/tools/build-playlist.js --countries tr --out iptv/playlists/turkiye.m3u
 *   node iptv/tools/build-playlist.js --out iptv/playlists/dunya.m3u
 *   node iptv/tools/build-playlist.js --countries tr --validate --out temiz.m3u
 *
 * Ne yapar: iptv-org açık kataloğundaki (herkese açık, çoğu yayıncının kendi
 * sitesinde sunduğu) yayınları indirir, kanal veritabanıyla zenginleştirir
 * (logo, kategori, ülke) ve tek bir M3U dosyası üretir.
 *
 * Ne yapmaz: ücretli/şifreli kanalların korsan bağlantılarını toplamaz.
 * Kaynağın kendi engel listesindeki (blocklist) ve yetişkin içerikli kanallar
 * varsayılan olarak dışarıda bırakılır.
 *
 * Seçenekler:
 *   --countries tr,de,fr   Yalnızca bu ülkeler (varsayılan: hepsi)
 *   --categories news,kids Yalnızca bu kategoriler
 *   --group country|category   Grup başlığı neye göre (varsayılan country)
 *   --validate             Her yayını dene, cevap vermeyeni listeden çıkar
 *   --concurrency 40       Doğrulamada eşzamanlı istek sayısı
 *   --timeout 8000         Doğrulama zaman aşımı (ms)
 *   --include-nsfw         Yetişkin içerikli kanalları da ekle (varsayılan: hayır)
 *   --include-blocked      Kaynağın engel listesindekileri de ekle (varsayılan: hayır)
 *   --cache <dizin>        İndirilenleri burada sakla (varsayılan: sistem tmp)
 *   --out <dosya>          Çıktı dosyası (varsayılan: stdout)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const RAW = 'https://raw.githubusercontent.com/iptv-org';
const COUNTRY_CODES = ('ad ae af ag ai al am ao ar at au aw az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ' +
  'ca cd cf cg ch ci cl cm cn co cr cu cv cw cy cz de dj dk dm do dz ec ee eg er es et fi fj fo fr ga gb gd ge gf gh ' +
  'gi gl gm gn gp gq gr gt gu gw gy hk hn hr ht hu id ie il in iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky ' +
  'kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mk ml mm mn mo mp mq mr mt mu mv mw mx my mz na nc ne ng ni nl ' +
  'no np nz om pa pe pf pg ph pk pl pr ps pt py qa re ro rs ru rw sa sb sc sd se sg si sk sl sm sn so sr ss sv sx sy ' +
  'sz td tg th tj tl tm tn to tr tt tw tz ua ug us uy uz va ve vg vi vn vu ws xk ye za zm zw').split(' ');

/* ---------------- argümanlar ---------------- */
const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}
function flag(name) { return argv.indexOf('--' + name) >= 0; }

const OPT = {
  countries: (opt('countries', '') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  categories: (opt('categories', '') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  group: opt('group', 'country'),
  validate: flag('validate'),
  concurrency: parseInt(opt('concurrency', '40'), 10),
  timeout: parseInt(opt('timeout', '8000'), 10),
  includeNsfw: flag('include-nsfw'),
  includeBlocked: flag('include-blocked'),
  cache: opt('cache', path.join(os.tmpdir(), 'nomads-iptv-cache')),
  out: opt('out', '')
};

fs.mkdirSync(OPT.cache, { recursive: true });
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

/* ---------------- indirme ---------------- */
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('çok fazla yönlendirme'));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: 60000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('zaman aşımı')));
    req.on('error', reject);
  });
}

async function cached(name, url) {
  const f = path.join(OPT.cache, name);
  if (fs.existsSync(f) && (Date.now() - fs.statSync(f).mtimeMs) < 6 * 3600e3) {
    return fs.readFileSync(f, 'utf8');
  }
  const body = await get(url);
  fs.writeFileSync(f, body);
  return body;
}

/* ---------------- CSV ---------------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.length > 1).map(r => {
    const o = {};
    head.forEach((h, k) => { o[h] = r[k] != null ? r[k] : ''; });
    return o;
  });
}

/* ---------------- M3U ---------------- */
function parseM3U(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let pending = null;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice(8);
      let comma = -1, inQ = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '"') inQ = !inQ;
        else if (rest[i] === ',' && !inQ) { comma = i; break; }
      }
      const attrs = {};
      const attrPart = comma >= 0 ? rest.slice(0, comma) : rest;
      for (const m of attrPart.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
      pending = { name: (comma >= 0 ? rest.slice(comma + 1) : '').trim(), tvgId: attrs['tvg-id'] || '' };
    } else if (!line.startsWith('#') && pending) {
      pending.url = line.trim();
      out.push(pending);
      pending = null;
    }
  }
  return out;
}

const esc = s => String(s == null ? '' : s).replace(/"/g, "'").replace(/[\r\n]/g, ' ');

/* ---------------- doğrulama ---------------- */
function probe(url) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    let u;
    try { u = new URL(url); } catch { return finish(false); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return finish(false);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      timeout: OPT.timeout,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (SmartTV; Linux) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    }, res => {
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      res.destroy();
      finish(ok);
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
      if (++done % 200 === 0) log(`  doğrulanan: ${done}/${items.length}`);
    }
  }));
  return out;
}

/* ---------------- ana akış ---------------- */
(async () => {
  log('kanal veritabanı indiriliyor...');
  const [channelsCsv, logosCsv, countriesCsv, blockCsv] = await Promise.all([
    cached('channels.csv', `${RAW}/database/master/data/channels.csv`),
    cached('logos.csv', `${RAW}/database/master/data/logos.csv`),
    cached('countries.csv', `${RAW}/database/master/data/countries.csv`),
    cached('blocklist.csv', `${RAW}/database/master/data/blocklist.csv`)
  ]);

  const channels = new Map();
  for (const c of parseCsv(channelsCsv)) channels.set(c.id, c);

  const logos = new Map();
  for (const l of parseCsv(logosCsv)) if (l.url && !logos.has(l.channel)) logos.set(l.channel, l.url);

  const countryName = new Map();
  for (const c of parseCsv(countriesCsv)) countryName.set(c.code, c.name);

  const blocked = new Set();
  for (const b of parseCsv(blockCsv)) blocked.add(b.channel);
  log(`  ${channels.size} kanal, ${logos.size} logo, ${blocked.size} engelli kayıt`);

  const wanted = OPT.countries.length ? OPT.countries : COUNTRY_CODES;
  log(`yayın listeleri indiriliyor (${wanted.length} ülke)...`);

  const files = await pool(wanted, 16, async cc => {
    try { return { cc, text: await cached(`streams-${cc}.m3u`, `${RAW}/iptv/master/streams/${cc}.m3u`) }; }
    catch { return null; }
  });

  const seen = new Set();
  let entries = [];
  let skippedNsfw = 0, skippedBlocked = 0, skippedCategory = 0;

  for (const f of files) {
    if (!f) continue;
    for (const s of parseM3U(f.text)) {
      if (!s.url || seen.has(s.url)) continue;

      /* tvg-id "Kanal.ulke@FEED" biçiminde; kanal kimliği @ öncesi kısım */
      const chId = s.tvgId ? s.tvgId.split('@')[0] : '';
      const meta = chId ? channels.get(chId) : null;

      if (chId && blocked.has(chId) && !OPT.includeBlocked) { skippedBlocked++; continue; }
      if (meta && String(meta.is_nsfw).toUpperCase() === 'TRUE' && !OPT.includeNsfw) { skippedNsfw++; continue; }

      const cats = meta && meta.categories
        ? meta.categories.split(';').map(x => x.trim().toLowerCase()).filter(Boolean) : [];
      if (OPT.categories.length && !cats.some(c => OPT.categories.includes(c))) { skippedCategory++; continue; }

      seen.add(s.url);

      const cc = (meta && meta.country ? meta.country : f.cc).toUpperCase();
      const group = OPT.group === 'category'
        ? (cats[0] ? cats[0][0].toUpperCase() + cats[0].slice(1) : 'Genel')
        : (countryName.get(cc) || cc);

      entries.push({
        name: (meta && meta.name) || s.name.replace(/\s*\(\d+p\)\s*/g, '').replace(/\s*\[[^\]]*\]\s*/g, '').trim() || s.name,
        raw: s.name,
        tvgId: s.tvgId,
        logo: (chId && logos.get(chId)) || '',
        group,
        cc,
        url: s.url
      });
    }
  }

  log(`  ${entries.length} benzersiz yayın  (atlanan: ${skippedBlocked} engelli, ${skippedNsfw} yetişkin` +
      (skippedCategory ? `, ${skippedCategory} kategori dışı` : '') + ')');

  if (OPT.validate) {
    log(`yayınlar deneniyor (eşzamanlı ${OPT.concurrency}, zaman aşımı ${OPT.timeout} ms)...`);
    const alive = await pool(entries, OPT.concurrency, e => probe(e.url));
    const before = entries.length;
    entries = entries.filter((_, i) => alive[i]);
    log(`  ${entries.length}/${before} yayın cevap verdi`);
  }

  entries.sort((a, b) =>
    a.group.localeCompare(b.group, 'tr') || a.name.localeCompare(b.name, 'tr'));

  let m3u = '#EXTM3U\n';
  m3u += `# NOMADS INDUSTRY IPTV - üretilmiş kanal listesi\n`;
  m3u += `# kaynak: iptv-org açık kataloğu (github.com/iptv-org/iptv)\n`;
  m3u += `# kanal sayısı: ${entries.length}${OPT.validate ? ' (doğrulanmış)' : ''}\n`;
  entries.forEach((e, i) => {
    m3u += `#EXTINF:-1 tvg-id="${esc(e.tvgId)}" tvg-chno="${i + 1}"` +
           (e.logo ? ` tvg-logo="${esc(e.logo)}"` : '') +
           ` group-title="${esc(e.group)}",${esc(e.name)}\n${e.url}\n`;
  });

  if (OPT.out) {
    fs.mkdirSync(path.dirname(OPT.out), { recursive: true });
    fs.writeFileSync(OPT.out, m3u);
    log(`yazıldı: ${OPT.out}  (${entries.length} kanal, ${(m3u.length / 1024).toFixed(0)} KB)`);
  } else {
    process.stdout.write(m3u);
  }
})().catch(e => { log('HATA: ' + e.message); process.exit(1); });
