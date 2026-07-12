const express = require('express');
const path = require('path');
const sql = require('mssql');
const cors = require('cors');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');

const APP_ROOT = process.pkg
  ? path.dirname(process.execPath)
  : (process.versions && process.versions.electron)
    ? path.dirname(process.execPath)
    : __dirname;
require('dotenv').config({ path: path.join(APP_ROOT, '.env') });

const packageJson = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3007;

app.use(cors());
app.use(express.json());
app.get('/favicon.ico', (_req, res) => res.status(204).end());

function semverKarsilastir(a, b) {
    const pa = String(a || '0.0.0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0.0.0').split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const av = pa[i] || 0;
        const bv = pb[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

function yedekKlasorYolu() {
    if (process.platform === 'win32') {
        return 'C:\\komurbackup';
    }
    return path.join(os.homedir(), 'KOMUR-backups');
}

function yedekDosyaAdi() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `yedek-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

function yedekDosyaGuvenliMi(dosyaAdi) {
    const ad = String(dosyaAdi || '').trim();
    if (!ad || ad.includes('..') || /[\\/]/.test(ad)) return false;
    return /^yedek-\d{8}-\d{6}\.json$/i.test(ad);
}

// --- Bellek içi işlem günlüğü (/api/sistem-loglari ile okunur; restart sonrası boşalır) ---
const MAX_SISTEM_LOG = 800;
const sistemLoglari = [];
function sistemLogYaz(seviye, mesaj, ek = null) {
    const satir = {
        zaman: new Date().toISOString(),
        zamanTr: new Date().toLocaleString('tr-TR', { hour12: false }),
        seviye: String(seviye || 'bilgi'),
        mesaj: String(mesaj || ''),
        ek: ek == null || ek === '' ? null : (typeof ek === 'string' ? ek : JSON.stringify(ek))
    };
    sistemLoglari.unshift(satir);
    while (sistemLoglari.length > MAX_SISTEM_LOG) sistemLoglari.pop();
    const prefix = `[${satir.zamanTr}]`;
    if (seviye === 'hata') console.error(prefix, satir.mesaj, ek || '');
    else if (seviye === 'uyari') console.warn(prefix, satir.mesaj, ek || '');
    else console.log(prefix, satir.mesaj, ek || '');
}

app.use((req, res, next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
    const yol = (req.originalUrl || req.url || '').split('?')[0];
    const t0 = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - t0;
        let sev = 'bilgi';
        if (res.statusCode >= 500) sev = 'hata';
        else if (res.statusCode >= 400) sev = 'uyari';
        sistemLogYaz(sev, `${req.method} ${yol} → HTTP ${res.statusCode} (${ms} ms)`);
    });
    next();
});

// --- Ana sayfa piyasa: TCMB döviz (today.xml) + altın tamamlayıcı (Truncgil); static’ten önce ---
const TCMB_CEYREK_HAS_GRAM_KATSAYI = 1.6035;
const REESKONT_XML_URLS = [
    'https://www.tcmb.gov.tr/kurlar/reeskont.xml',
    'https://www.tcmb.gov.tr/kurlar/Reeskont.xml'
];

function httpsTcmbMetin(url, timeoutMs = 16000) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; komur-satis/1.0)' } },
            (res) => {
                let d = '';
                res.setEncoding('utf8');
                res.on('data', (c) => {
                    d += c;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(d);
                });
            }
        );
        const t = setTimeout(() => {
            req.destroy();
            reject(new Error('timeout'));
        }, timeoutMs);
        req.on('error', (e) => {
            clearTimeout(t);
            reject(e);
        });
        req.on('close', () => clearTimeout(t));
    });
}

function tcmbXmlKokEtik(xml, etik) {
    if (!xml) return '';
    const m = xml.match(new RegExp(`<${etik}>([^<]*)</${etik}>`, 'i'));
    return m ? m[1].trim() : '';
}

function tcmbXmlTarihGun(xml) {
    if (!xml) return '';
    const m = xml.match(/<Tarih_Date\b[^>]*\bTarih="([^"]+)"/i);
    if (m) return m[1].trim();
    const m2 = xml.match(/<Tarih_Date\b[^>]*\bDate="([^"]+)"/i);
    if (m2) return m2[1].trim();
    return tcmbXmlKokEtik(xml, 'Tarih_Date') || tcmbXmlKokEtik(xml, 'Date') || '';
}

function tcmbEtikIci(blok, etik) {
    if (!blok) return '';
    const m = blok.match(new RegExp(`<${etik}>([^<]*)</${etik}>`, 'i'));
    return m ? m[1].trim() : '';
}

function tcmbKurBloku(xml, kodUpper) {
    const upper = kodUpper.toUpperCase();
    const curRegex = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/gi;
    let m;
    while ((m = curRegex.exec(xml)) !== null) {
        const attrs = m[1];
        const inner = m[2];
        const am = attrs.match(/\bKod="([^"]+)"/i);
        const km = am || inner.match(/<Kod>([^<]+)<\/Kod>/i);
        if (!km) continue;
        if (String(km[1]).trim().toUpperCase() !== upper) continue;
        return inner;
    }
    return null;
}

function tcmbSayiKur(val) {
    if (val == null) return null;
    const t = String(val).trim();
    if (!t || t === '') return null;
    const sonVirg = t.lastIndexOf(',');
    const sonNok = t.lastIndexOf('.');
    let s = t;
    if (sonVirg > sonNok) {
        s = t.replace(/\./g, '').replace(',', '.');
    } else if (sonNok > sonVirg) {
        s = t.replace(/,/g, '');
    } else {
        s = t.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function tcmbBirimKur(cblock) {
    if (!cblock) return null;
    return {
        forexAlis: tcmbEtikIci(cblock, 'ForexBuying'),
        forexSatis: tcmbEtikIci(cblock, 'ForexSelling'),
        banknotAlis: tcmbEtikIci(cblock, 'BanknoteBuying'),
        banknotSatis: tcmbEtikIci(cblock, 'BanknoteSelling')
    };
}

function tcmbReferansAlis(k) {
    if (!k) return null;
    const a = tcmbSayiKur(k.forexAlis);
    const b = tcmbSayiKur(k.banknotAlis);
    return a != null ? a : b;
}

function tcmbReferansSatis(k) {
    if (!k) return null;
    const a = tcmbSayiKur(k.forexSatis);
    const b = tcmbSayiKur(k.banknotSatis);
    return a != null ? a : b;
}

function istanbulTakvimGunu(ref = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(ref);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return new Date(get('year'), get('month') - 1, get('day'));
}

/** Türkiye duvar saati: YYYY-MM-DD HH:mm:ss (UTC kayması yok) */
function istanbulSimdiSqlStr(ref = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(ref);
    const get = (t) => parts.find((p) => p.type === t)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function normalizeIslemTarihiStr(tarih) {
    if (!tarih || tarih === '' || tarih === 'undefined') {
        return istanbulSimdiSqlStr();
    }
    return String(tarih).trim().replace('T', ' ').replace(/Z$/i, '').replace(/\.\d{3}$/, '').trim();
}

function tcmbArsivUrlFromDate(t) {
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    const folder = `${y}${m}`;
    const file = `${d}${m}${y}.xml`;
    return `https://www.tcmb.gov.tr/kurlar/${folder}/${file}`;
}

function tcmbFormatKur(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function tcmbDegisimMeta(eskiSatis, yeniSatis) {
    if (eskiSatis == null || yeniSatis == null) return { yuzde: null, yon: 'sabit' };
    if (eskiSatis === 0) return { yuzde: null, yon: 'sabit' };
    const yuzde = ((yeniSatis - eskiSatis) / eskiSatis) * 100;
    const eps = 0.0005;
    let yon = 'sabit';
    if (yuzde > eps) yon = 'yukari';
    else if (yuzde < -eps) yon = 'asagi';
    return { yuzde: Math.round(yuzde * 100) / 100, yon };
}

function tcmbDegisimMetaGram(eski, yeni) {
    if (eski == null || yeni == null) return { yuzde: null, yon: 'sabit' };
    return tcmbDegisimMeta(eski, yeni);
}

async function tcmbGunlukDovizXmldenGunluk() {
    const xml = await httpsTcmbMetin('https://www.tcmb.gov.tr/kurlar/today.xml');
    const tarihHam = tcmbXmlTarihGun(xml);
    const usd = tcmbBirimKur(tcmbKurBloku(xml, 'USD'));
    const eur = tcmbBirimKur(tcmbKurBloku(xml, 'EUR'));
    return { tarih: tarihHam, usd, eur };
}

async function tcmbGunlukOncekiIsGunuDoviz() {
    const base = istanbulTakvimGunu(new Date());
    for (let i = 1; i <= 14; i += 1) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const url = tcmbArsivUrlFromDate(d);
        try {
            const xml = await httpsTcmbMetin(url, 12000);
            const tarihHam = tcmbXmlTarihGun(xml);
            const usd = tcmbBirimKur(tcmbKurBloku(xml, 'USD'));
            const eur = tcmbBirimKur(tcmbKurBloku(xml, 'EUR'));
            if (usd && tcmbReferansSatis(usd) != null) {
                return { tarih: tarihHam, usd, eur };
            }
        } catch (_) {
            /* bir sonraki güne dene */
        }
    }
    return null;
}

async function tcmbReeskontSimdiki() {
    let xml = '';
    for (const u of REESKONT_XML_URLS) {
        try {
            const got = await httpsTcmbMetin(u, 14000);
            if (got && /<Currency\b/i.test(got)) {
                xml = got;
                break;
            }
        } catch (_) {
            xml = '';
        }
    }
    if (!xml || !/<Currency\b/i.test(xml)) return { gram: null, gramKodu: null, saat: '', gecerlilik: '' };
    const curRegex = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/gi;
    let secim = null;
    let m;
    while ((m = curRegex.exec(xml)) !== null) {
        const attrs = m[1];
        const inner = m[2];
        const am = attrs.match(/\bKod="([^"]+)"/i);
        const km = am || inner.match(/<Kod>([^<]+)<\/Kod>/i);
        if (!km) continue;
        const kod = String(km[1]).trim().toUpperCase();
        const al =
            tcmbSayiKur(tcmbEtikIci(inner, 'ForexBuying')) ||
            tcmbSayiKur(tcmbEtikIci(inner, 'BanknoteBuying')) ||
            tcmbSayiKur(tcmbEtikIci(inner, 'ForexSelling'));
        if (al == null) continue;
        if (kod === 'XAU') {
            secim = { gram: al, gramKodu: kod };
            break;
        }
        if (!secim && (kod === 'XAG' || kod.includes('HAS'))) {
            secim = { gram: al, gramKodu: kod };
        }
    }
    const saat = tcmbXmlKokEtik(xml, 'Saat') || tcmbXmlKokEtik(xml, 'Time') || '';
    const gecerlilik = tcmbXmlTarihGun(xml) || tcmbXmlKokEtik(xml, 'Tarih_Date') || '';
    return {
        gram: secim ? secim.gram : null,
        gramKodu: secim ? secim.gramKodu : null,
        saat,
        gecerlilik
    };
}

function truncgilDegisimiMeta(obj) {
    if (!obj || typeof obj !== 'object') return { yuzde: null, yon: 'sabit' };
    const d = obj.Değişim != null ? obj.Değişim : obj['Değişim'];
    if (d == null || String(d).trim() === '') return { yuzde: null, yon: 'sabit' };
    const t = String(d)
        .replace(/%/g, '')
        .replace(/\s/g, '')
        .replace(',', '.');
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return { yuzde: null, yon: 'sabit' };
    let yon = 'sabit';
    if (n > 0.0005) yon = 'yukari';
    else if (n < -0.0005) yon = 'asagi';
    return { yuzde: Math.round(n * 100) / 100, yon };
}

async function truncgilAltinYardim() {
    const bos = {
        gram: null,
        ceyrek: null,
        gramDegisim: { yuzde: null, yon: 'sabit' },
        ceyrekDegisim: { yuzde: null, yon: 'sabit' },
        kaynak: null
    };
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 14000);
        const r = await fetch('https://finans.truncgil.com/today.json', {
            signal: ctrl.signal,
            headers: {
                Accept: 'application/json',
                'User-Agent': `komur-satis-otomasyonu/${packageJson.version || '1.0'}`
            }
        });
        clearTimeout(tid);
        if (!r.ok) return bos;
        const js = await r.json();
        const pickSat = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            const s = obj.Satış != null ? obj.Satış : obj['Satış'];
            if (s == null) return null;
            const temiz = String(s).replace(/[^\d.,]/g, '').trim();
            return tcmbSayiKur(temiz);
        };
        const g = js['gram-altin'];
        const c = js['ceyrek-altin'];
        return {
            gram: pickSat(g),
            ceyrek: pickSat(c),
            gramDegisim: truncgilDegisimiMeta(g),
            ceyrekDegisim: truncgilDegisimiMeta(c),
            kaynak: null
        };
    } catch {
        return bos;
    }
}

async function tcmbPiyasaApiYaniti(_req, res) {
    try {
        const dovBugun = await tcmbGunlukDovizXmldenGunluk();
        const dovOnce = await tcmbGunlukOncekiIsGunuDoviz();
        const usdSatisBug = tcmbReferansSatis(dovBugun.usd);
        const usdSatisOnc = dovOnce ? tcmbReferansSatis(dovOnce.usd) : null;
        const eurSatisBug = tcmbReferansSatis(dovBugun.eur);
        const eurSatisOnc = dovOnce ? tcmbReferansSatis(dovOnce.eur) : null;

        const rr = await tcmbReeskontSimdiki();
        const tg = await truncgilAltinYardim();

        let gram = rr.gram != null ? rr.gram : tg.gram;
        let gramKodu = rr.gramKodu || (tg.gram != null ? 'gram-altın' : null);
        let ceyrek = tg.ceyrek;
        if (ceyrek == null && gram != null) {
            ceyrek = Math.round(gram * TCMB_CEYREK_HAS_GRAM_KATSAYI * 100) / 100;
        }

        const gramDegisim = tg.gram != null ? tg.gramDegisim : { yuzde: null, yon: 'sabit' };
        const ceyrekDegisim = tg.ceyrek != null ? tg.ceyrekDegisim : gramDegisim;

        res.json({
            ok: true,
            kaynak: 'TCMB + tamamlayıcı',
            tarihGunluk: dovBugun.tarih,
            tarihKarsilastirmaDoviz: dovOnce?.tarih ?? null,
            usd: {
                alis: tcmbFormatKur(tcmbReferansAlis(dovBugun.usd)),
                satis: tcmbFormatKur(usdSatisBug),
                degisim: tcmbDegisimMeta(usdSatisOnc, usdSatisBug)
            },
            eur: {
                alis: tcmbFormatKur(tcmbReferansAlis(dovBugun.eur)),
                satis: tcmbFormatKur(eurSatisBug),
                degisim: tcmbDegisimMeta(eurSatisOnc, eurSatisBug)
            },
            gramHasAltin: gram,
            gramKodu,
            gramDegisim,
            ceyrekAltinYaklasik: ceyrek,
            ceyrekKatsayiHasGram: TCMB_CEYREK_HAS_GRAM_KATSAYI,
            ceyrekDegisim,
            reeskontSaat: rr.saat || null,
            reeskontGecerlilik: rr.gecerlilik || null,
            reeskontYok: gram == null && ceyrek == null,
            reeskontOncekiEtiket: null,
            altinKaynak: null
        });
    } catch (e) {
        sistemLogYaz('uyari', '/api/tcmb-piyasa', e.message || String(e));
        res.status(502).json({ ok: false, kaynak: 'TCMB', hata: e.message || String(e) });
    }
}

app.get('/api/tcmb-piyasa', tcmbPiyasaApiYaniti);
app.get('/api/piyasa-ozet', tcmbPiyasaApiYaniti);

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const MOBIL_DIR = path.join(PUBLIC_DIR, 'mobil');

function mobilSayfasiGonder(_req, res) {
    const indexPath = path.join(MOBIL_DIR, 'index.html');
    if (!fsSync.existsSync(indexPath)) {
        return res.status(404).type('text/html; charset=utf-8').send(
            '<h1>Mobil uygulama bulunamadı</h1><p><code>public/mobil</code> klasörü yok.</p>'
        );
    }
    return res.sendFile(indexPath);
}

app.get(/^\/mobil\/?$/i, mobilSayfasiGonder);
app.get('/mobil/index.html', mobilSayfasiGonder);
if (fsSync.existsSync(MOBIL_DIR)) {
    app.use('/mobil', express.static(MOBIL_DIR, { redirect: false, index: 'index.html' }));
}
app.use(express.static(PUBLIC_DIR, { redirect: false }));

// --- Müşteri cari notları tablosu (ilk API çağrısında oluşturulur) ---
let musteriNotlariTablosuHazir = false;
async function ensureMusteriNotlariTablosu() {
    if (musteriNotlariTablosuHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MusteriNotlari]') AND type in (N'U'))
BEGIN
    CREATE TABLE [komur].[dbo].[MusteriNotlari] (
        [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [MusteriKimlik] INT NOT NULL,
        [NotMetni] NVARCHAR(MAX) NOT NULL,
        [OlusturanKullaniciAdi] NVARCHAR(120) NULL,
        [OlusturanAdSoyad] NVARCHAR(200) NULL,
        [UyariAcik] BIT NOT NULL CONSTRAINT DF_MusteriNotlari_Uyari DEFAULT (1),
        [OlusturmaZamani] DATETIME2(3) NOT NULL CONSTRAINT DF_MusteriNotlari_Zaman DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_MusteriNotlari_Musteri ON [komur].[dbo].[MusteriNotlari]([MusteriKimlik]);
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MusteriNotlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MusteriNotlari]') AND name = N'UyariAcik')
BEGIN
    ALTER TABLE [komur].[dbo].[MusteriNotlari] ADD [UyariAcik] BIT NOT NULL CONSTRAINT DF_MusteriNotlari_UyariEk DEFAULT (1);
END
    `);
    musteriNotlariTablosuHazir = true;
}

// --- Stok eşik kolonları (kalıcı) ---
let stokEsikKolonlariHazir = false;
async function ensureStokEsikKolonlari() {
    if (stokEsikKolonlariHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'EsikAlt')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [EsikAlt] DECIMAL(18,2) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'EsikUst')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [EsikUst] DECIMAL(18,2) NULL;
END
    `);
    stokEsikKolonlariHazir = true;
}

let stokDonusumKolonlariHazir = false;
async function ensureStokDonusumKolonlari() {
    if (stokDonusumKolonlariHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'AdetBasinaKg')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [AdetBasinaKg] DECIMAL(18,4) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'AlimBirimi')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [AlimBirimi] NVARCHAR(20) NULL;
END
    `);
    stokDonusumKolonlariHazir = true;
}

function parseCuvalKgFromBirim(birimTuru) {
    const m = String(birimTuru || '').match(/(\d+(?:[.,]\d+)?)\s*KG/i);
    return m ? parseFloat(String(m[1]).replace(',', '.')) : 0;
}

/** Toptancı giriş biriminden stok (satış) birimine çeviri */
function girisMiktarToStokMiktar(girisMiktar, girisBirimi, satisBirimi, adetBasinaKg) {
    const miktar = parseFloat(girisMiktar) || 0;
    if (miktar <= 0) return 0;
    const g = String(girisBirimi || '').trim();
    const s = String(satisBirimi || 'Ton').trim();
    if (!g || g === s) return miktar;

    const adetKg = parseFloat(adetBasinaKg) || 0;
    const cuvalKg = adetKg > 0 ? adetKg : parseCuvalKgFromBirim(s);

    if (g === 'Ton') {
        const kg = miktar * 1000;
        if (s === 'Adet' && adetKg > 0) return kg / adetKg;
        if (/çuval/i.test(s) && cuvalKg > 0) return kg / cuvalKg;
        if (s === 'Ton') return miktar;
    }
    if (g === 'Kg') {
        if (s === 'Adet' && adetKg > 0) return miktar / adetKg;
        if (/çuval/i.test(s) && cuvalKg > 0) return miktar / cuvalKg;
        if (s === 'Ton') return miktar / 1000;
    }
    return miktar;
}

const MUSTERI_AKTIF_BASLANGIC = '2025-01-01';

async function musteriAktifPasifSayilari() {
    const result = await sql.query(`
        WITH SonHareket AS (
            SELECT Kisi, MAX(CAST(TARİH AS DATE)) AS SonTarih
            FROM [komur].[dbo].[MusteriHareket] WITH (NOLOCK)
            GROUP BY Kisi
        )
        SELECT
            SUM(CASE WHEN SonTarih >= '${MUSTERI_AKTIF_BASLANGIC}' THEN 1 ELSE 0 END) AS aktifMusteri,
            SUM(CASE WHEN SonTarih < '${MUSTERI_AKTIF_BASLANGIC}' THEN 1 ELSE 0 END) AS pasifMusteri
        FROM SonHareket
    `);
    const row = result.recordset[0] || {};
    return {
        aktifMusteri: Number(row.aktifMusteri) || 0,
        pasifMusteri: Number(row.pasifMusteri) || 0
    };
}

let malAlimDovizKolonlariHazir = false;
async function ensureMalAlimDovizKolonlari() {
    if (malAlimDovizKolonlariHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND name = N'ParaBirimi')
BEGIN
    ALTER TABLE [komur].[dbo].[MalAlimlari] ADD [ParaBirimi] NVARCHAR(3) NOT NULL CONSTRAINT DF_MalAlimlari_ParaBirimi DEFAULT N'TRY';
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND name = N'IslemKuru')
BEGIN
    ALTER TABLE [komur].[dbo].[MalAlimlari] ADD [IslemKuru] DECIMAL(18,4) NOT NULL CONSTRAINT DF_MalAlimlari_IslemKuru DEFAULT 1;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND name = N'DovizTutar')
BEGIN
    ALTER TABLE [komur].[dbo].[MalAlimlari] ADD [DovizTutar] DECIMAL(18,2) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND name = N'GirisBirimi')
BEGIN
    ALTER TABLE [komur].[dbo].[MalAlimlari] ADD [GirisBirimi] NVARCHAR(20) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[MalAlimlari]') AND name = N'GirisMiktar')
BEGIN
    ALTER TABLE [komur].[dbo].[MalAlimlari] ADD [GirisMiktar] DECIMAL(18,2) NULL;
END
    `);
    malAlimDovizKolonlariHazir = true;
}

let tedarikciOdemeDovizKolonlariHazir = false;
async function ensureTedarikciOdemeDovizKolonlari() {
    if (tedarikciOdemeDovizKolonlariHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND name = N'ParaBirimi')
BEGIN
    ALTER TABLE [komur].[dbo].[TedarikciOdemeleri] ADD [ParaBirimi] NVARCHAR(3) NOT NULL CONSTRAINT DF_TedarikciOdemeleri_ParaBirimi DEFAULT N'TRY';
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND name = N'IslemKuru')
BEGIN
    ALTER TABLE [komur].[dbo].[TedarikciOdemeleri] ADD [IslemKuru] DECIMAL(18,4) NOT NULL CONSTRAINT DF_TedarikciOdemeleri_IslemKuru DEFAULT 1;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[TedarikciOdemeleri]') AND name = N'DovizTutar')
BEGIN
    ALTER TABLE [komur].[dbo].[TedarikciOdemeleri] ADD [DovizTutar] DECIMAL(18,2) NULL;
END
    `);
    tedarikciOdemeDovizKolonlariHazir = true;
}

let tcmbUsdSatisOnbellek = { deger: null, zaman: 0 };
async function tcmbUsdSatisSayi() {
    const simdi = Date.now();
    if (tcmbUsdSatisOnbellek.deger != null && simdi - tcmbUsdSatisOnbellek.zaman < 5 * 60 * 1000) {
        return tcmbUsdSatisOnbellek.deger;
    }
    try {
        const dov = await tcmbGunlukDovizXmldenGunluk();
        const kur = tcmbReferansSatis(dov.usd);
        if (kur != null && Number.isFinite(kur)) {
            tcmbUsdSatisOnbellek = { deger: kur, zaman: simdi };
            return kur;
        }
    } catch (_e) { /* TCMB erişilemezse null */ }
    return null;
}

// --- MSSQL Bağlantı Ayarları ---
const config = {
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '189189',
    // Ortam değişkeni yoksa eski kurulum davranışı için SERVER kullan.
    server: process.env.MSSQL_SERVER || process.env.DB_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE || process.env.DB_NAME || 'komur',
    port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : undefined,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        instanceName: process.env.MSSQL_INSTANCE || undefined
    }
};

// Bağlantıyı başlat
sql.connect(config).then(pool => {
    if (pool.connected) {
        console.log('MSSQL Veritabanına başarıyla bağlanıldı!');
        sistemLogYaz('bilgi', 'MSSQL veritabanı bağlantısı kuruldu');
    }
}).catch(err => {
    console.error('Veritabanı bağlantı hatası:', err);
    sistemLogYaz('hata', 'MSSQL bağlantısı kurulamadı', err.message || String(err));
});




// =========================================================
// 🔐 KULLANICI GİRİŞ (LOGIN) SİSTEMİ
// =========================================================
app.post('/api/giris', async (req, res) => {
    const { kullaniciAdi, sifre } = req.body;

    try {
        const pool = await sql.connect(config);

        // Şema/kolon adı farklılıklarında kırılmaması için tüm satırı alıp JS'te eşle.
        const result = await pool.request()
            .input('kadi', sql.NVarChar, kullaniciAdi)
            .input('sifre', sql.NVarChar, sifre)
            .query('SELECT TOP 1 * FROM [komur].[dbo].[Kullanicilar] WHERE KullaniciAdi = @kadi AND Sifre = @sifre');

        // Eğer eşleşme varsa (Kayıt bulunduysa)
        if (result.recordset.length > 0) {
            const row = result.recordset[0] || {};
            const adSoyad =
                row.AdSoyad ??
                row.ADSOYAD ??
                row.adSoyad ??
                row.Ad_Soyad ??
                row.KullaniciAdi ??
                kullaniciAdi;
            const yetki =
                row.Yetki ??
                row.YETKI ??
                row.yetki ??
                'Personel';

            res.status(200).json({ 
                mesaj: 'Giriş başarılı',
                adSoyad,
                yetki,
                kullaniciAdi: kullaniciAdi // 🚀 İŞTE EKSİK OLAN ALTIN VURUŞ BURADA!
            });
            console.log(`🔑 SİSTEME GİRİŞ YAPILDI: ${adSoyad} (${yetki})`);
        } else {
            // Eşleşme yoksa kapıdan çevir
            res.status(401).json({ hata: 'Kullanıcı adı veya şifre hatalı!' });
        }
    } catch (err) {
        console.error("Giriş API Hatası:", err);
        sistemLogYaz('hata', '/api/giris hatası', err.message || String(err));
        res.status(500).json({ hata: 'Sunucu hatası oluştu.', detay: err.message || String(err) });
    }
});
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html')); // Eğer login.html public klasöründeyse
    // Eğer index.html ile aynı yerdeyse: res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/api/surum', async (req, res) => {
    try {
        res.json({
            success: true,
            appName: packageJson?.name || 'komur-satis-otomasyonu',
            version: packageJson?.version || '0.0.0',
            description: packageJson?.description || '',
            node: process.version,
            env: process.env.NODE_ENV || 'production',
            generatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Sürüm bilgisi alınamadı.' });
    }
});

app.get('/api/guncelleme-kontrol', async (req, res) => {
    try {
        const currentVersion = String(packageJson?.version || '0.0.0');
        const manifestUrl = String(process.env.UPDATE_MANIFEST_URL || '').trim();
        if (!manifestUrl) {
            return res.json({
                success: true,
                configured: false,
                currentVersion,
                updateAvailable: false,
                message: 'UPDATE_MANIFEST_URL tanımlı değil.'
            });
        }

        const fr = await fetch(manifestUrl, { method: 'GET' });
        if (!fr.ok) {
            return res.status(502).json({
                success: false,
                configured: true,
                currentVersion,
                message: `Manifest alınamadı (${fr.status}).`
            });
        }
        const m = await fr.json().catch(() => null);
        const remoteVersion = String(m?.version || '').trim();
        const updateUrl = String(m?.url || '').trim();
        const notes = String(m?.notes || '').trim();
        if (!remoteVersion) {
            return res.status(502).json({
                success: false,
                configured: true,
                currentVersion,
                message: 'Manifest içinde version alanı yok.'
            });
        }
        const cmp = semverKarsilastir(remoteVersion, currentVersion);
        res.json({
            success: true,
            configured: true,
            currentVersion,
            remoteVersion,
            updateAvailable: cmp > 0,
            updateUrl: updateUrl || null,
            notes: notes || null,
            manifestUrl,
            checkedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Güncelleme kontrolü başarısız.' });
    }
});

app.get('/api/yedekler', async (req, res) => {
    try {
        const dir = yedekKlasorYolu();
        await fs.mkdir(dir, { recursive: true });
        const files = await fs.readdir(dir, { withFileTypes: true });
        const list = [];
        for (const f of files) {
            if (!f.isFile() || !f.name.toLowerCase().endsWith('.json')) continue;
            const full = path.join(dir, f.name);
            const st = await fs.stat(full);
            list.push({
                dosyaAdi: f.name,
                boyut: Number(st.size || 0),
                tarih: st.mtime?.toISOString?.() || null
            });
        }
        list.sort((a, b) => String(b.tarih || '').localeCompare(String(a.tarih || '')));
        res.json({ success: true, backups: list });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Yedek listesi alınamadı.' });
    }
});

app.post('/api/tek-tik-guncelle', async (req, res) => {
    try {
        const child = spawn('cmd.exe', ['/c', 'schtasks /run /tn "Komur-Otomatik-Guncelleme"'], {
            cwd: __dirname,
            detached: true,
            windowsHide: true,
            stdio: 'ignore'
        });
        child.unref();
        res.json({
            success: true,
            message: 'Güncelleme görevi tetiklendi. Uygulama kısa süre içinde yeniden başlatılacak.'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Tek tık güncelleme başlatılamadı.' });
    }
});

app.post('/api/yedek-al', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const tabloRs = await pool.request().query(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE='BASE TABLE' AND TABLE_SCHEMA='dbo'
            ORDER BY TABLE_NAME
        `);
        const tabloAdlari = (tabloRs.recordset || []).map((r) => String(r.TABLE_NAME || '').trim()).filter(Boolean);

        const payload = {
            version: 1,
            app: 'KOMUR',
            createdAt: new Date().toISOString(),
            tableCount: tabloAdlari.length,
            tables: {}
        };

        for (const ad of tabloAdlari) {
            const rs = await pool.request().query(`SELECT * FROM dbo.[${ad}]`);
            payload.tables[ad] = rs.recordset || [];
        }

        const dir = yedekKlasorYolu();
        await fs.mkdir(dir, { recursive: true });
        const dosyaAdi = yedekDosyaAdi();
        const full = path.join(dir, dosyaAdi);
        await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
        res.json({
            success: true,
            message: 'Yedek oluşturuldu. Bu bilgisayara indiriliyor…',
            dosyaAdi,
            indirUrl: `/api/yedek-indir/${encodeURIComponent(dosyaAdi)}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Yedek alınamadı.' });
    }
});

app.get('/api/yedek-indir/:dosyaAdi', async (req, res) => {
    try {
        const dosyaAdi = decodeURIComponent(String(req.params.dosyaAdi || '').trim());
        if (!yedekDosyaGuvenliMi(dosyaAdi)) {
            return res.status(400).json({ success: false, message: 'Geçersiz yedek dosyası.' });
        }
        const full = path.join(yedekKlasorYolu(), dosyaAdi);
        if (!fsSync.existsSync(full)) {
            return res.status(404).json({ success: false, message: 'Yedek bulunamadı.' });
        }
        res.download(full, dosyaAdi);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Yedek indirilemedi.' });
    }
});

// =========================================================
// 👥 YENİ KULLANICI (PERSONEL/ADMİN) EKLEME API
// =========================================================
app.post('/api/kullanici', async (req, res) => {
    const { adSoyad, kullaniciAdi, sifre, yetki } = req.body;

    try {
        const pool = await sql.connect(config);
        
        // 1. Önce bu kullanıcı adı daha önce alınmış mı diye bakalım
        const check = await pool.request()
            .input('kadi', sql.NVarChar, kullaniciAdi)
            .query('SELECT COUNT(*) as sayi FROM [komur].[dbo].[Kullanicilar] WHERE KullaniciAdi = @kadi');
            
        if (check.recordset[0].sayi > 0) {
            return res.status(400).json({ hata: 'Bu kullanıcı adı zaten kullanılıyor, başka bir ad seçin!' });
        }

        // 2. Müsaitse yeni personeli veritabanına kaydet
        await pool.request()
            .input('adSoyad', sql.NVarChar, adSoyad)
            .input('kadi', sql.NVarChar, kullaniciAdi)
            .input('sifre', sql.NVarChar, sifre)
            .input('yetki', sql.NVarChar, yetki)
            .query('INSERT INTO [komur].[dbo].[Kullanicilar] (AdSoyad, KullaniciAdi, Sifre, Yetki) VALUES (@adSoyad, @kadi, @sifre, @yetki)');

        res.status(201).json({ mesaj: 'Yeni personel sisteme başarıyla eklendi.' });
        console.log(`👥 YENİ KAYIT: ${adSoyad} (${yetki}) sisteme eklendi.`);
        
    } catch (err) {
        console.error("Kullanıcı Ekleme Hatası:", err);
        res.status(500).json({ hata: 'Sunucu hatası oluştu.' });
    }
});

// --- KULLANICI LİSTESİNİ ÇEKME (SADECE ADMİN İÇİN) ---
app.get('/api/kullanicilar', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query('SELECT ID, AdSoyad, KullaniciAdi, Yetki FROM [komur].[dbo].[Kullanicilar]');
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// --- KULLANICI SİLME ---
app.delete('/api/kullanici/:id', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM [komur].[dbo].[Kullanicilar] WHERE ID = @id');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// --- ŞİFRE DEĞİŞTİRME ---
app.put('/api/sifre-degistir', async (req, res) => {
    const { kullaniciAdi, eskiSifre, yeniSifre } = req.body;
    try {
        const pool = await sql.connect(config);
        
        // Asıl Güvenlik Kontrolü
        const check = await pool.request()
            .input('kadi', sql.NVarChar, kullaniciAdi)
            .input('eskiSifre', sql.NVarChar, eskiSifre)
            .query('SELECT ID FROM [komur].[dbo].[Kullanicilar] WHERE KullaniciAdi = @kadi AND Sifre = @eskiSifre');

        if(check.recordset.length === 0) {
            return res.status(400).json({ hata: "Mevcut şifrenizi yanlış girdiniz!" });
        }

        // Doğruysa yeni şifreyi yaz
        await pool.request()
            .input('kadi', sql.NVarChar, kullaniciAdi)
            .input('yeniSifre', sql.NVarChar, yeniSifre)
            .query('UPDATE [komur].[dbo].[Kullanicilar] SET Sifre = @yeniSifre WHERE KullaniciAdi = @kadi');

        console.log(`✅ Kullanıcı [${kullaniciAdi}] şifresini başarıyla değiştirdi.`);
        res.json({ success: true });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ hata: err.message }); 
    }
});

// --- MÜŞTERİ LİSTELEME (JOIN'Lİ) ---
// Kimlik ve MusteriHareket tablolarını birleştirerek borç/alacak bilgisini çekiyoruz
app.get('/api/musteriler', async (req, res) => {
    try {
        const query = `
            SELECT 
                K.Kimlik, 
                -- Adı null ise boşluk getir, yanına soyadı falan ekleme
                ISNULL(K.Adı, '') AS Adı, 
                -- Soyadını sorgudan tamamen çıkardık veya istersen her zaman boş gelsin:
                '' AS Soyadı, 
                ISNULL(K.CEPTEL, '-') AS CEPTEL,
                ISNULL(K.Ilce, '') AS Ilce,
                ISNULL(K.Mahalle, '') AS Mahalle,
                
                -- 🚨 İŞTE EKSİK OLAN HAYATİ SATIRLAR BURASI 🚨
                ISNULL(K.Unvan, '') AS Unvan,
                ISNULL(K.Adres, '') AS Adres,
                
                ISNULL(SUM(MH.BORÇ), 0) AS ToplamBorc,
                ISNULL(SUM(MH.ÖDEME), 0) AS ToplamOdeme,
                (ISNULL(SUM(MH.BORÇ), 0) - ISNULL(SUM(MH.ÖDEME), 0)) AS Bakiye,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM [komur].[dbo].[MusteriHareket] MH2 WITH (NOLOCK)
                        WHERE MH2.Kisi = K.Kimlik AND CAST(MH2.TARİH AS DATE) >= '${MUSTERI_AKTIF_BASLANGIC}'
                    ) THEN N'Aktif'
                    WHEN EXISTS (
                        SELECT 1 FROM [komur].[dbo].[MusteriHareket] MH3 WITH (NOLOCK)
                        WHERE MH3.Kisi = K.Kimlik
                    ) THEN N'Pasif'
                    ELSE N'Yeni'
                END AS MusteriDurum

            -- 🚨 PRO DOKUNUŞ 1: Timeout hatalarını bitiren WITH (NOLOCK) eklentileri 🚨
            FROM [komur].[dbo].[Kimlik] K WITH (NOLOCK)
            LEFT JOIN [komur].[dbo].[MusteriHareket] MH WITH (NOLOCK) ON K.Kimlik = MH.Kisi
            
            -- 🚨 GROUP BY KISMINA DA EKLENMEK ZORUNDA 🚨
            GROUP BY K.Kimlik, K.Adı, K.CEPTEL, K.Unvan, K.Adres, K.Ilce, K.Mahalle
            ORDER BY K.Adı ASC
        `;
        const result = await sql.query(query);
        
        // 🚨 PRO DOKUNUŞ 2: Frontend'in ".forEach is not a function" diye çökmemesi için
        // veri boş gelse bile her zaman bir dizi (array) dönmesini garanti altına alıyoruz.
        res.status(200).json(result.recordset || []);
        
    } catch (err) {
        // 🚨 PRO DOKUNUŞ 3: Hatayı terminalde (siyah ekranda) kabak gibi gösterecek log
        console.error("❌ SQL MÜŞTERİ ÇEKME HATASI:", err.message);
        
        // Frontend'e hatanın ne olduğunu düzenli bir JSON formatında iletiyoruz
        res.status(500).json({ 
            success: false, 
            hata: "Veritabanından müşteri listesi çekilirken bir hata oluştu: " + err.message 
        });
    }
});
// --- MÜŞTERİ EKSTRESİ (DETAYLI HAREKETLER) ---
// --- MÜŞTERİ EKSTRESİ (DETAYLI HAREKETLER VE KALAN TESLİMAT EKLENDİ) ---
// --- MÜŞTERİ EKSTRESİ (DETAYLI HAREKETLER VE KALAN TESLİMAT EKLENDİ) ---
app.get('/api/musteri-ekstre/:id', async (req, res) => {
    const musteriId = req.params.id;
    try {
        const query = `
            SELECT 
                MH.Kimlik, 
                MH.TARİH, 
                MH.AÇIKLAMA, 
                MH.ADET, 
                MH.BORÇ, 
                MH.ÖDEME, 
                MH.KALANTORBA,
                MH.notlar, 
                MH.TeslimDurumu, 
                MH.KalanTeslimat, 
                MH.birimtür, 
                MH.IslemiYapan,
                MH.MakbuzNo, 
                MH.ISLEM_BAKIYESI, -- Mühürlü bakiye yerinde duruyor ✅
                K.Unvan,           -- Kimlik tablosundan Ünvan geldi ✅
                K.Adı,             -- Kimlik tablosundan Ad geldi ✅
                K.Soyadı           -- Kimlik tablosundan Soyad geldi ✅
            FROM [komur].[dbo].[MusteriHareket] AS MH
            LEFT JOIN [komur].[dbo].[Kimlik] AS K ON MH.Kisi = K.Kimlik
            WHERE MH.Kisi = @id
            ORDER BY MH.TARİH DESC, MH.Kimlik DESC
        `;

        const pool = await sql.connect(config); 
        const request = pool.request();
        request.input('id', sql.Int, parseInt(musteriId));
        
        const result = await request.query(query);
        
        // Patron, veriler artık tek bir paket halinde frontend'e (script.js) gidiyor.
        res.json(result.recordset);
        
    } catch (err) {
        console.error("❌ EKSTRE HATASI:", err.message);
        res.status(500).json({ hata: err.message });
    }
});

// --- RAKAMLARI SQL İÇİN KUSURSUZ TEMİZLEYEN FONKSİYON ---
function sayiyiTemizle(deger) {
    if (!deger) return 0;
    let metin = String(deger);
    // Eğer "1.500,50" gibi hem nokta hem virgül varsa (binlik ayraçlı), noktaları tamamen sil
    if (metin.includes('.') && metin.includes(',')) {
        metin = metin.replace(/\./g, ''); 
    }
    // Kalan virgülü noktaya (İngilizce ondalık format) çevir ve harfleri/boşlukları sil
    metin = metin.replace(',', '.').replace(/[^\d.-]/g, '');
    return parseFloat(metin) || 0;
}

// --- RAKAMLARI KUSURSUZ SAYIYA ÇEVİREN YARDIMCI FONKSİYON ---
function guvenliSayiYap(deger) {
    if (deger === undefined || deger === null || deger === '') return 0;
    
    // Zaten düzgün bir sayıysa ve NaN değilse doğrudan ver
    if (typeof deger === 'number') return isNaN(deger) ? 0 : deger;
    
    // Metinse: Önce binlik ayırıcı noktaları sil, sonra virgülü noktaya (ondalık) çevir
    let temizMetin = String(deger).replace(/\./g, '').replace(',', '.');
    let sonuc = parseFloat(temizMetin);
    
    // Eğer tüm bunlara rağmen sayıya çevrilemediyse (NaN olduysa) çökmek yerine 0 gönder
    return isNaN(sonuc) ? 0 : sonuc;
}

// --- StokListesi.UrunAdi ↔ MusteriHareket (AÇIKLAMA + birimtür) tutarlı eşleşmesi ---
function parseStokUrunAdi(orjinalUrunAdi) {
    if (!orjinalUrunAdi) return { temizAd: '', birimTuru: 'Ton' };
    const s = String(orjinalUrunAdi).trim();
    let temizAd = s;
    let birimTuru = 'Ton';
    if (s.includes(' (')) {
        const parcalar = s.split(' (');
        temizAd = parcalar[0].trim();
        birimTuru = (parcalar[1] || '').replace(/\)/g, '').trim() || 'Ton';
    } else if (s.toLowerCase().includes('çuval')) {
        birimTuru = 'Çuval';
    } else if (s.toLowerCase().includes('adet')) {
        birimTuru = 'Adet';
    }
    return { temizAd, birimTuru };
}

function stokMetniEsit(a, b) {
    return String(a || '').trim().toLocaleLowerCase('tr-TR')
        === String(b || '').trim().toLocaleLowerCase('tr-TR');
}

/**
 * Aynı ürün adının Ton / Çuval / Adet gibi farklı stok satırlarını karıştırmamak için hem temel ad hem birim eşlemesi.
 * Eski hareketlerde birimtür boşsa: yalnızca aynı adda tek stok kalemi varsa güvenli seçilir.
 */
function stokKalemBulKayitListesinden(stokKayitlari, arananTemizAd, islemBirimRaw) {
    const adHedef = String(arananTemizAd || '').trim();
    if (!adHedef || !Array.isArray(stokKayitlari)) return null;

    const adEslesenler = stokKayitlari
        .map(row => ({ row, parsed: parseStokUrunAdi(row.UrunAdi) }))
        .filter(x => stokMetniEsit(x.parsed.temizAd, adHedef));

    const birimRaw = String(islemBirimRaw || '').trim();
    if (birimRaw) {
        const tam = adEslesenler.filter(x => stokMetniEsit(x.parsed.birimTuru, birimRaw));
        if (tam.length === 1) return { ID: tam[0].row.ID, UrunAdi: tam[0].row.UrunAdi };
        if (tam.length > 1) {
            console.warn(`⚠️ Stok belirsiz: "${adHedef}" + birim "${birimRaw}" için ${tam.length} satır (ID'ler: ${tam.map(t => t.row.ID).join(', ')}).`);
            return null;
        }
        return null;
    }
    if (adEslesenler.length === 1) return { ID: adEslesenler[0].row.ID, UrunAdi: adEslesenler[0].row.UrunAdi };
    if (adEslesenler.length > 1) {
        console.warn(`⚠️ "${adHedef}" için birden fazla stok satırı var; hareket satırında birimtür yok — stok güncellenmedi.`);
    }
    return null;
}

// --- YENİ SATIŞ YAPMA API'Sİ (KESİN ÇÖZÜM) ---
// --- YENİ SATIŞ YAPMA API'Sİ (TÜRKÇE MSSQL MONEY HATASI İÇİN KESİN ÇÖZÜM) ---
// --- YENİ SATIŞ YAPMA API'Sİ (AÇIKLAMAYA TON EKLEME) ---
// --- YENİ SATIŞ YAPMA API'Sİ (TON VE NOT BİLGİSİ EKLENDİ) ---
// --- 1. YENİ SATIŞ YAPMA API'Sİ (notlar SÜTUNU DAHİL) ---
// --- 1. YENİ SATIŞ YAPMA API'Sİ (SAAT VE NVarChar ZIRHI EKLENDİ) ---
app.post('/api/satis', async (req, res) => {
    const { 
        musteri_id, komur_id, miktar_ton, toplam_tutar, notlar, teslim_durumu, 
        tarih, satis_odeme_turu, taksit_sayisi, vade_tarihi, islemiYapan 
    } = req.body;

    const durum = teslim_durumu || 'Teslim Edildi';
    let kalan_teslimat = (durum === 'Bekliyor') ? parseFloat(miktar_ton) : 0;

    // --- SAAT KORUMASI ---
    // Ön yüzden gelen tarihi hiç bozmadan (metin olarak) alıyoruz.
    const islemTarihiStr = normalizeIslemTarihiStr(tarih);

    try {
        const pool = await sql.connect(config);
        const request = pool.request();

        request.input('musteri_id', sql.Int, parseInt(musteri_id));
        request.input('komur_id', sql.Int, parseInt(komur_id));
        request.input('miktar', sql.Decimal(18, 2), parseFloat(miktar_ton));
        request.input('tutar', sql.Decimal(18, 2), parseFloat(toplam_tutar));
        request.input('notlar', sql.NVarChar, notlar || '');
        request.input('durum', sql.NVarChar, durum);
        request.input('kalan', sql.Decimal(18, 2), kalan_teslimat);
        
        // BÜYÜK DEĞİŞİKLİK: sql.DateTime yerine sql.NVarChar kullanıyoruz! Artık saat şaşmaz!
        request.input('tarih', sql.NVarChar, islemTarihiStr); 
        request.input('islemiYapan', sql.NVarChar, islemiYapan || 'Sistem');

        const urunRes = await request.query(`SELECT UrunAdi FROM [komur].[dbo].[StokListesi] WHERE ID = @komur_id`);
        if (urunRes.recordset.length === 0) return res.status(404).json({ hata: "Ürün bulunamadı!" });

        const orjinalUrunAdi = urunRes.recordset[0].UrunAdi;
        const { temizAd: temizUrunAdi, birimTuru } = parseStokUrunAdi(orjinalUrunAdi);

        request.input('aciklama', sql.NVarChar, temizUrunAdi);
        request.input('birimTur', sql.NVarChar, birimTuru);

        const satisQuery = `
            INSERT INTO [komur].[dbo].[MusteriHareket] 
            (Kisi, YIL, AÇIKLAMA, ADET, BİRİM, BORÇ, ÖDEME, TARİH, notlar, TeslimDurumu, KalanTeslimat, birimtür, IslemiYapan) 
            VALUES 
            (@musteri_id, YEAR(@tarih), @aciklama, @miktar, 0, @tutar, 0, @tarih, @notlar, @durum, @kalan, @birimTur, @islemiYapan)
        `;
        await request.query(satisQuery);

        const stokGuncelleQuery = `
            UPDATE [komur].[dbo].[StokListesi] 
            SET BaslangicStogu = ISNULL(BaslangicStogu, 0) - @miktar 
            WHERE ID = @komur_id
        `;
        await request.query(stokGuncelleQuery);

        if (satis_odeme_turu === 'Taksitli') {
            const taksitAdet = parseInt(taksit_sayisi) || 1;
            if (taksitAdet < 1 || taksitAdet > 12) {
                return res.status(400).json({ hata: 'Taksit sayısı 1 ile 12 arasında olmalıdır.' });
            }
            const birimTaksit = parseFloat(toplam_tutar) / taksitAdet;
            
            // Taksit tarihi için sadece yıl-ay-gün kısmını kullan
            const vadeTarihObj = new Date(islemTarihiStr.split(' ')[0]);

            for (let i = 1; i <= taksitAdet; i++) {
                vadeTarihObj.setMonth(vadeTarihObj.getMonth() + 1); 

                const tReq = pool.request();
                tReq.input('kisi', sql.Int, parseInt(musteri_id));
                tReq.input('miktar', sql.Decimal(18,2), birimTaksit);
                tReq.input('aciklama', sql.NVarChar, `${i}/${taksitAdet}`); 
                tReq.input('vade', sql.Date, vadeTarihObj);
                tReq.input('islemTarihi', sql.NVarChar, islemTarihiStr); // Zırhlı saat

                await tReq.query(`
                    INSERT INTO [komur].[dbo].[TAKSIT] (TARIH, MIKTAR, AÇIKLAMA, kişi, ODEMETARİHİ, DURUM)
                    VALUES (@islemTarihi, @miktar, @aciklama, @kisi, @vade, '0')
                `);
            }
        } else if (satis_odeme_turu === 'Vadeli') {
            const vReq = pool.request();
            vReq.input('kisi', sql.Int, parseInt(musteri_id));
            vReq.input('miktar', sql.Decimal(18,2), parseFloat(toplam_tutar));
            vReq.input('vade', sql.Date, new Date(vade_tarihi));
            vReq.input('islemTarihi', sql.NVarChar, islemTarihiStr); // Zırhlı saat

            await vReq.query(`
                INSERT INTO [komur].[dbo].[TAKSIT] (TARIH, MIKTAR, AÇIKLAMA, kişi, ODEMETARİHİ, DURUM)
                VALUES (@islemTarihi, @miktar, 'Vadeli Satış', @kisi, @vade, '0')
            `);
        }

        console.log(`✅ Satış Kaydedildi: Müşteri: ${musteri_id}, Yapan: ${islemiYapan || 'Sistem'}`);
        res.status(201).json({ mesaj: 'Satış kaydedildi!', toplam_tutar: toplam_tutar });

    } catch (err) {
        console.error("❌ Satış hatası detayı:", err);
        if (!res.headersSent) res.status(500).json({ hata: "Kayıt hatası: " + err.message });
    }
});

// --- 2. TAHSİLAT (ÖDEME ALMA) API'Sİ (NVarChar KORUMALI) ---
app.post('/api/tahsilat', async (req, res) => {
    const { kisiId, odeme, aciklama, notlar, tarih, islemiYapan, apartmanUygula } = req.body;
    
    const islemTarihiStr = normalizeIslemTarihiStr(tarih);

    let temizOdeme = String(odeme).replace(',', '.').replace(/[^\d.-]/g, '');
    const guvenliOdeme = parseFloat(temizOdeme) || 0;
    const tamAciklama = aciklama || 'ÖDEME';

    try {
        const pool = await sql.connect(config);
        const request = pool.request();

        request.input('kisiId', sql.Int, parseInt(kisiId));
        request.input('tutar', sql.Decimal(18, 2), guvenliOdeme);
        request.input('aciklama', sql.NVarChar, tamAciklama);
        request.input('notlar', sql.NVarChar, notlar || '');
        request.input('tarih', sql.NVarChar, islemTarihiStr); // DateTime YERİNE NVarChar!
        request.input('islemiYapan', sql.NVarChar, islemiYapan || 'Sistem');

        const query = `
            INSERT INTO [komur].[dbo].[MusteriHareket] 
            (Kisi, ÖDEME, BORÇ, AÇIKLAMA, ADET, BİRİM, TARİH, YIL, notlar, IslemiYapan) 
            OUTPUT INSERTED.Kimlik
            VALUES 
            (@kisiId, @tutar, 0, @aciklama, 0, 0, @tarih, YEAR(@tarih), @notlar, @islemiYapan) 
        `;
        
        const insRes = await request.query(query);
        const yeniHareketId = insRes.recordset?.[0]?.Kimlik || null;
        console.log(`✅ Tahsilat Kaydedildi: Müşteri ID: ${kisiId}, Yapan: ${islemiYapan || 'Sistem'}`);

        let apartmanOdeme = null;
        if (apartmanUygula !== false) {
            try {
                apartmanOdeme = await apartmanOdemeKgIsle(pool, parseInt(kisiId, 10), guvenliOdeme, islemiYapan, req.body.odemeTuru || aciklama);
                if (yeniHareketId && apartmanOdeme && apartmanOdeme.islenen > 0) {
                    const kurTxt = apartmanOdeme.kur
                        ? `Anlık USD: ${Number(apartmanOdeme.kur).toLocaleString('tr-TR', { minimumFractionDigits: 4 })} · Ö.USD: ${Number(apartmanOdeme.odenenUsd || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} · ${apartmanOdeme.kgDusen} kg · ${apartmanOdeme.tonFiyat || '—'} USD/ton`
                        : `Apartman: ${apartmanOdeme.kgDusen} kg`;
                    await pool.request()
                        .input('id', sql.Int, yeniHareketId)
                        .input('not', sql.NVarChar, kurTxt)
                        .query(`UPDATE [komur].[dbo].[MusteriHareket] SET birimtür = 'APT', notlar = CASE WHEN notlar IS NULL OR notlar = '' THEN @not ELSE notlar + N' | ' + @not END WHERE Kimlik = @id`);
                }
            } catch (aptErr) {
                console.warn('Apartman kg ödeme işlemi:', aptErr.message);
            }
        }

        res.status(201).json({
            mesaj: 'Ödeme başarıyla kaydedildi.',
            tutar: guvenliOdeme,
            apartmanKg: apartmanOdeme
        });

    } catch (err) {
        console.error("❌ Tahsilat Kayıt Hatası:", err);
        res.status(500).json({ hata: "Ödeme kaydedilemedi: " + err.message });
    }
});
// --- ANA SAYFA: KÖMÜR STOKLARINI LİSTELEME API'Sİ ---
// --- ANA SAYFA: DİNAMİK KÖMÜR STOK HESAPLAMA API'Sİ ---

// --- ANA SAYFA: KÖMÜR STOKLARINI LİSTELEME API'Sİ ---

// --- ANA SAYFA: MANUEL STOK VE OTOMATİK DÜŞÜM API'Sİ ---
// --- ANA SAYFA: MANUEL STOK VE OTOMATİK DÜŞÜM API'Sİ ---
app.get('/api/komur', async (req, res) => {
    try {
        await ensureStokEsikKolonlari();
        await ensureStokDonusumKolonlari();
        const query = `
            SELECT 
                S.ID as id,
                S.UrunAdi as cins,
                S.SatisFiyati as ton_fiyati,
                ISNULL(S.BaslangicStogu, 0) AS mevcut_stok_ton,
                S.EsikAlt as esik_alt,
                S.EsikUst as esik_ust,
                S.AdetBasinaKg as adet_basina_kg,
                S.AlimBirimi as alim_birimi
            FROM [komur].[dbo].[StokListesi] S
            WHERE S.TakipEdilsinMi = 1
        `;
        const result = await sql.query(query);
        const zengin = (result.recordset || []).map((row) => {
            const p = parseStokUrunAdi(row.cins);
            return {
                ...row,
                temel_ad: p.temizAd,
                birim_turu: p.birimTuru,
                Birim: p.birimTuru,
                AdetBasinaKg: row.adet_basina_kg,
                AlimBirimi: row.alim_birimi
            };
        });
        res.json(zengin);
    } catch (err) {
        console.error("Stok hesaplama hatası:", err);
        res.json([]); 
    }
});

// YENİ KÖMÜR / STOK EKLEME API'si
app.post('/api/komur', async (req, res) => {
    const { UrunAdi, TonFiyati, MevcutStok, EsikAlt, EsikUst, AdetBasinaKg, AlimBirimi } = req.body;

    try {
        await ensureStokEsikKolonlari();
        await ensureStokDonusumKolonlari();
        const query = `
            INSERT INTO [komur].[dbo].[StokListesi] 
            (UrunAdi, SatisFiyati, BaslangicStogu, EsikAlt, EsikUst, AdetBasinaKg, AlimBirimi, TakipEdilsinMi) 
            VALUES (@urunAdi, @fiyat, @miktar, @esikAlt, @esikUst, @adetKg, @alimBirimi, 1)
        `;

        const request = new sql.Request();
        request.input('urunAdi', sql.NVarChar, UrunAdi);
        request.input('fiyat', sql.Decimal(18,2), TonFiyati);
        request.input('miktar', sql.Decimal(18,2), MevcutStok);
        request.input('esikAlt', sql.Decimal(18,2), EsikAlt);
        request.input('esikUst', sql.Decimal(18,2), EsikUst);
        request.input('adetKg', sql.Decimal(18, 4), AdetBasinaKg > 0 ? AdetBasinaKg : null);
        request.input('alimBirimi', sql.NVarChar, AlimBirimi || null);

        await request.query(query);
        res.status(201).json({ mesaj: 'Ürün başarıyla eklendi.' });
        
    } catch (err) {
        console.error("Stok Ekleme Hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});
// --- ANA SAYFA: ÖZET BİLGİLERİ (Kişi Sayısı ve Bugünkü Satış) ---
// ANA SAYFA ÖZET BİLGİLERİ (Müşteri Sayısı ve Günlük Satışlar)
app.get('/api/ozet', async (req, res) => {
    try {
        // 1. Toplam Müşteri Sayısını Çekiyoruz (Tablo adı Kimlik olarak güncellendi!)
        const musteriRes = await sql.query('SELECT COUNT(*) as toplam FROM [komur].[dbo].[Kimlik]');
        const { aktifMusteri, pasifMusteri } = await musteriAktifPasifSayilari();
        
        // 2. Bugünkü Satışları Un ve Kömür olarak gruplayıp topluyoruz
        const satisQuery = `
            SELECT 
                ISNULL(SUM(CASE WHEN UPPER(AÇIKLAMA) LIKE '%UN%' THEN ADET ELSE 0 END), 0) as UnSatis,
                ISNULL(SUM(CASE WHEN UPPER(AÇIKLAMA) NOT LIKE '%UN%' THEN ADET ELSE 0 END), 0) as KomurSatis
            FROM [komur].[dbo].[MusteriHareket]
            WHERE CAST(TARİH as DATE) = CAST(GETDATE() as DATE) 
              AND BORÇ > 0 
        `;
        const satisRes = await sql.query(satisQuery);

        res.json({
            toplamMusteri: musteriRes.recordset[0].toplam,
            aktifMusteri,
            pasifMusteri,
            bugunUn: satisRes.recordset[0].UnSatis,
            bugunKomur: satisRes.recordset[0].KomurSatis
        });
    } catch (err) {
        console.error("Özet yükleme hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});

// Mobil ana sayfa özeti (PWA — /api/ozet + sevk + stok)
app.get('/api/mobil-ozet', async (req, res) => {
    try {
        const musteriRes = await sql.query('SELECT COUNT(*) as toplam FROM [komur].[dbo].[Kimlik]');
        const { aktifMusteri, pasifMusteri } = await musteriAktifPasifSayilari();
        const satisQuery = `
            SELECT 
                ISNULL(SUM(CASE WHEN UPPER(AÇIKLAMA) LIKE '%UN%' THEN ADET ELSE 0 END), 0) as UnSatis,
                ISNULL(SUM(CASE WHEN UPPER(AÇIKLAMA) NOT LIKE '%UN%' THEN ADET ELSE 0 END), 0) as KomurSatis
            FROM [komur].[dbo].[MusteriHareket]
            WHERE CAST(TARİH as DATE) = CAST(GETDATE() as DATE) 
              AND BORÇ > 0 
        `;
        const satisRes = await sql.query(satisQuery);
        const sevkRes = await sql.query(`
            SELECT COUNT(*) as adet
            FROM [komur].[dbo].[MusteriHareket] MH
            WHERE MH.TeslimDurumu = N'Bekliyor'
              AND (MH.KalanTeslimat > 0 OR MH.KalanTeslimat IS NULL)
        `);
        await ensureStokEsikKolonlari();
        const stokRes = await sql.query(`
            SELECT 
                COUNT(*) as kalem,
                ISNULL(SUM(ISNULL(S.BaslangicStogu, 0)), 0) as toplam
            FROM [komur].[dbo].[StokListesi] S
            WHERE S.TakipEdilsinMi = 1
        `);

        res.json({
            toplamMusteri: musteriRes.recordset[0].toplam,
            aktifMusteri,
            pasifMusteri,
            bugunUn: satisRes.recordset[0].UnSatis,
            bugunKomur: satisRes.recordset[0].KomurSatis,
            bekleyenSevk: sevkRes.recordset[0].adet,
            toplamStok: stokRes.recordset[0].toplam,
            stokKalem: stokRes.recordset[0].kalem
        });
    } catch (err) {
        console.error('Mobil özet yükleme hatası:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- YENİ SATIŞ YAPMA (Cariye Borç, Stoktan Düşüm) API'Sİ ---

// --- YENİ MÜŞTERİ EKLEME API'Sİ (Kimlik Tablosuna Kayıt) ---
app.post('/api/musteri', async (req, res) => {
    const { ad_soyad, telefon, unvan, adres, ilce, mahalle } = req.body;

    try {
        const request = new sql.Request();
        const p_unvan = unvan ? String(unvan).trim() : '';
        const p_telefon = telefon ? String(telefon).trim().replace(/\D/g, '') : '';
        const p_ad = ad_soyad ? String(ad_soyad).trim() : (p_unvan || '');

        if (!p_unvan) {
            return res.status(400).json({ success: false, hata: 'Ünvan zorunlu.' });
        }

        // Mükerrer: sadece Ünvan + Dükkan içi tanıma (Adı) BERABER aynıysa
        // Telefon ile eşleştirme yapılmaz.
        request.input('checkUnvan', sql.NVarChar, p_unvan);
        request.input('checkAd', sql.NVarChar, p_ad);
        const checkResult = await request.query(`
            SELECT TOP 1 Kimlik, Unvan, CEPTEL, Adı
            FROM [komur].[dbo].[Kimlik]
            WHERE
                LTRIM(RTRIM(ISNULL(Unvan,''))) = @checkUnvan
                AND LTRIM(RTRIM(ISNULL(Adı,''))) = @checkAd
                AND @checkUnvan <> ''
                AND @checkAd <> ''
        `);

        if (checkResult.recordset.length > 0) {
            const m = checkResult.recordset[0];
            return res.status(200).json({
                success: true,
                mevcut: true,
                yeniId: m.Kimlik,
                mesaj: `Bu müşteri zaten kayıtlı (Ünvan + dükkan içi aynı: ${m.Unvan || m.Adı}). Mevcut kayıt seçildi.`,
                musteri: { Kimlik: m.Kimlik, Unvan: m.Unvan, Adı: m.Adı, CEPTEL: m.CEPTEL }
            });
        }

        request.input('ad', sql.NVarChar, p_ad);
        request.input('soyad', sql.NVarChar, '');
        request.input('telefon', sql.NVarChar, p_telefon || '-');
        request.input('unvan', sql.NVarChar, p_unvan);
        request.input('adres', sql.NVarChar, adres ? String(adres).trim() : '');
        request.input('ilce', sql.NVarChar, ilce ? String(ilce).trim() : '');
        request.input('mahalle', sql.NVarChar, mahalle ? String(mahalle).trim() : '');

        const insertRes = await request.query(`
            INSERT INTO [komur].[dbo].[Kimlik] (Adı, Soyadı, CEPTEL, Unvan, Adres, Ilce, Mahalle)
            VALUES (@ad, @soyad, @telefon, @unvan, @adres, @ilce, @mahalle);
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS yeniId;
        `);
        const yeniId = insertRes.recordset && insertRes.recordset[0] ? insertRes.recordset[0].yeniId : null;

        res.status(201).json({ success: true, mevcut: false, mesaj: 'Müşteri başarıyla eklendi!', yeniId });

    } catch (err) {
        console.error("Müşteri Kayıt Hatası:", err);
        res.status(500).json({ success: false, hata: 'Veritabanı hatası: ' + err.message });
    }
});
// STOK GÜNCELLEME API
app.put('/api/komur/:id', async (req, res) => {
    const id = req.params.id;
    const { UrunAdi, TonFiyati, MevcutStok, EsikAlt, EsikUst, AdetBasinaKg, AlimBirimi } = req.body;

    try {
        await ensureStokEsikKolonlari();
        await ensureStokDonusumKolonlari();
        const query = `
            UPDATE [komur].[dbo].[StokListesi]
            SET UrunAdi = @urunAdi, 
                SatisFiyati = @fiyat, 
                BaslangicStogu = @miktar,
                EsikAlt = @esikAlt,
                EsikUst = @esikUst,
                AdetBasinaKg = @adetKg,
                AlimBirimi = @alimBirimi
            WHERE ID = @id
        `;
        const request = new sql.Request();
        request.input('id', sql.Int, id);
        request.input('urunAdi', sql.NVarChar, UrunAdi);
        request.input('fiyat', sql.Decimal(18,2), TonFiyati);
        request.input('miktar', sql.Decimal(18,2), MevcutStok);
        request.input('esikAlt', sql.Decimal(18,2), EsikAlt);
        request.input('esikUst', sql.Decimal(18,2), EsikUst);
        request.input('adetKg', sql.Decimal(18, 4), AdetBasinaKg > 0 ? AdetBasinaKg : null);
        request.input('alimBirimi', sql.NVarChar, AlimBirimi || null);

        await request.query(query);
        res.status(200).json({ mesaj: 'Ürün başarıyla güncellendi.' });
    } catch (err) {
        console.error("Güncelleme Hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});

// Toplu KG / alım birimi güncelleme (adet ve çuval ürünler)
app.put('/api/komur-donusum-toplu', async (req, res) => {
    const { kayitlar } = req.body;
    if (!Array.isArray(kayitlar) || kayitlar.length === 0) {
        return res.status(400).json({ hata: 'Kayıt listesi boş.' });
    }
    try {
        await ensureStokDonusumKolonlari();
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            for (const k of kayitlar) {
                const id = parseInt(k.id, 10);
                if (!id) continue;
                const adetKg = parseFloat(k.adetBasinaKg);
                const alimBirimi = k.alimBirimi || 'Ton';
                await transaction.request()
                    .input('id', sql.Int, id)
                    .input('adetKg', sql.Decimal(18, 4), adetKg > 0 ? adetKg : null)
                    .input('alimBirimi', sql.NVarChar, alimBirimi)
                    .query(`UPDATE [komur].[dbo].[StokListesi] SET AdetBasinaKg = @adetKg, AlimBirimi = @alimBirimi WHERE ID = @id AND TakipEdilsinMi = 1`);
            }
            await transaction.commit();
            res.json({ success: true, guncellenen: kayitlar.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Toplu dönüşüm hatası:', err);
        res.status(500).json({ hata: err.message });
    }
});

// STOK SİLME API (Yumuşak Silme / Soft Delete)
app.delete('/api/komur/:id', async (req, res) => {
    const id = req.params.id;

    try {
        // Eski satışların patlamaması için tamamen silmek yerine TakipEdilsinMi = 0 yapıyoruz
        const query = `UPDATE [komur].[dbo].[StokListesi] SET TakipEdilsinMi = 0 WHERE ID = @id`;
        
        const request = new sql.Request();
        request.input('id', sql.Int, id);
        
        await request.query(query);
        res.status(200).json({ mesaj: 'Ürün listeden gizlendi.' });
    } catch (err) {
        console.error("Silme Hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});

// =========================================================
// 💰 TAKSİT ÖDEME MOTORU (ESKİ SİSTEM - ŞELALE & BÖLÜNME)
// =========================================================
app.put('/api/taksit-ode/:id', async (req, res) => {
    console.log("📥 HAVUZA GELEN PAKET:", req.body); 

    const taksitId = req.params.id; 
    const { islemiYapan, odemeTuru, odenenTutar, musteriId, tarih } = req.body;
    const islemTarihiStr = normalizeIslemTarihiStr(tarih);

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin(); 

        try {
            let havuzMiktari = parseFloat(parseFloat(odenenTutar).toFixed(2));
            const toplamTahsilat = havuzMiktari;

            // 🚨 HAFIZA KUTUSU: Hangi taksitlere para değdiğini tutacağız
            let islemGorenTaksitler = []; 

            const taksitlerRes = await transaction.request()
                .input('mid', sql.Int, musteriId)
                .query(`
                    SELECT * FROM [komur].[dbo].[TAKSIT] 
                    WHERE kişi = @mid AND DURUM = '0' 
                    ORDER BY TARIH ASC, Kimlik ASC
                `);

            const taksitler = taksitlerRes.recordset;

            // --- HAVUZ DAĞITIM MOTORU ---
                    // --- HAVUZ DAĞITIM MOTORU ---
            for (let t of taksitler) {
                if (havuzMiktari <= 0) break;

                let tMiktar = parseFloat(t.MIKTAR);
                let tOdenen = parseFloat(t.ODEMELER || 0);
                let tKalanBorc = parseFloat((tMiktar - tOdenen).toFixed(2));

                let tIsim = (t.AÇIKLAMA || '').replace('Taksit Ödemesi', '').trim() || 'Taksit';

                if (havuzMiktari >= tKalanBorc) {
                    // 1. DURUM: Taksit TAMAMEN kapandıysa
                    if (!islemGorenTaksitler.includes(tIsim)) {
                        islemGorenTaksitler.push(tIsim); // Sadece adını yaz (Örn: "2/3")
                    }

                    await transaction.request()
                        .input('tid', sql.Int, t.Kimlik)
                        .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                        .query(`UPDATE [komur].[dbo].[TAKSIT] SET DURUM = '1', ODEMELER = MIKTAR, IslemiYapan = @yapan WHERE Kimlik = @tid`);
                    
                    havuzMiktari = parseFloat((havuzMiktari - tKalanBorc).toFixed(2));
                } else {
                    // 2. DURUM: Taksit KISMİ ödendi (Havuzdaki para bitti)
                    let guncelKalan = parseFloat((tKalanBorc - havuzMiktari).toFixed(2));
                    
                    // Kısmi ödeneni özel bir etiketle hafızaya al
                    islemGorenTaksitler.push(`${tIsim} Kısmi/Kalan:${guncelKalan}₺`);

                    await transaction.request()
                        .input('tid', sql.Int, t.Kimlik)
                        .input('yeniOdeme', sql.Decimal(18,2), parseFloat((tOdenen + havuzMiktari).toFixed(2)))
                        .query(`UPDATE [komur].[dbo].[TAKSIT] SET ODEMELER = @yeniOdeme WHERE Kimlik = @tid`);
                    
                    havuzMiktari = 0;
                }
            }

            // 🎯 AKILLI AÇIKLAMA ÜRETİCİSİ
            let taksitDetayMetni = islemGorenTaksitler.length > 0 ? islemGorenTaksitler.join(", ") : "Taksit";
            
            // Eğer adam 1500 TL verip 3 taksiti birden kapattıysa: "Taksit Tahsilatı - Nakit (1/6, 2/6, 3/6)" yazacak.
            let finalAciklama = `Taksit Tahsilatı - ${odemeTuru || 'Nakit'} (${taksitDetayMetni})`;
            
            // SQL'de karakter sınırına takılmamak için 120 karaktere tıraşlıyoruz
            finalAciklama = finalAciklama.substring(0, 120);

            // --- MAKBUZ NUMARATÖRÜ ---
            const numAyarRes = await transaction.request().query("SELECT Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = 'MakbuzOtomatikYazdir'");
            const numaratorAcik = (numAyarRes.recordset.length === 0 || numAyarRes.recordset[0].Deger !== 'false');

            let formatliMakbuzNo = null;
            if (numaratorAcik) {
                const maxRes = await transaction.request().query("SELECT MAX(CAST(MakbuzNo AS INT)) as MaxNo FROM [komur].[dbo].[MusteriHareket] WHERE ISNUMERIC(MakbuzNo) = 1");
                let yeniMakbuzNo = (maxRes.recordset[0].MaxNo || 0) + 1;
                formatliMakbuzNo = String(yeniMakbuzNo).padStart(6, '0');
            }

            // --- EKSTREYE YAZ ---
            await transaction.request()
                .input('kisi', sql.Int, musteriId)
                .input('tutar', sql.Decimal(18,2), toplamTahsilat)
                .input('aciklama', sql.NVarChar, finalAciklama)
                .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                .input('mNo', sql.NVarChar, formatliMakbuzNo)
                .input('tar', sql.NVarChar, islemTarihiStr)
                .query(`
                    DECLARE @EskiBakiye DECIMAL(18,2);
                    SELECT @EskiBakiye = ISNULL(SUM(BORÇ) - SUM(ÖDEME), 0) FROM [komur].[dbo].[MusteriHareket] WHERE Kisi = @kisi;
                    INSERT INTO [komur].[dbo].[MusteriHareket] (Kisi, YIL, AÇIKLAMA, ADET, BİRİM, BORÇ, ÖDEME, TARİH, IslemiYapan, MakbuzNo, ISLEM_BAKIYESI)
                    VALUES (@kisi, YEAR(@tar), @aciklama, 0, 0, 0, @tutar, @tar, @yapan, @mNo, @EskiBakiye - @tutar);
                `);

            await transaction.commit();
            
            // 🚨 Frontende de aynı detaylı açıklamayı gönderiyoruz ki makbuza o basılsın
            res.json({ success: true, makbuzNo: formatliMakbuzNo, finansalOzet: finalAciklama });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("❌ Havuz Ödeme Hatası:", err);
        res.status(500).json({ hata: "Veritabanı hatası: " + err.message });
    }
});


// GÜNLÜK ÖZET VE HAREKETLER (Tarihe göre)
// --- GÜNLÜK ÖZET VE HAREKETLER (Tarihe göre) ---
app.get('/api/gunluk-hareketler', async (req, res) => {
    const { baslangic, bitis } = req.query;
    
    if (!baslangic || !bitis) {
        return res.status(400).json({ hata: "Başlangıç veya bitiş tarihi eksik." });
    }

    try {
        const pool = await sql.connect(config);
        const query = `
        SELECT 
            MH.TARİH,
            MH.Kimlik,
            K.Adı,
            K.Soyadı,
            ISNULL(K.Unvan, '') AS Unvan,
            MH.AÇIKLAMA,
            MH.ADET,
            MH.birimtür,
            MH.BORÇ,
            MH.ÖDEME,
            MH.notlar,
            MH.IslemiYapan
        FROM [komur].[dbo].[MusteriHareket] MH
        LEFT JOIN [komur].[dbo].[Kimlik] K ON MH.Kisi = K.Kimlik
        WHERE CAST(MH.TARİH as DATE) BETWEEN @bas AND @bit
        ORDER BY MH.TARİH DESC, MH.Kimlik DESC
        `;
        
        const request = new sql.Request(pool);
        request.input('bas', sql.Date, baslangic);
        request.input('bit', sql.Date, bitis);
            
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Özet çekme hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});
// ŞOFÖR EKRANINA BEKLEYENLERİ GETİR (Kalan Miktar ile birlikte)
// ŞOFÖR EKRANINA BEKLEYENLERİ GETİR (Kalan Miktar ile birlikte)
app.get('/api/bekleyen-teslimatlarduzenle', async (req, res) => {
    try {
        const query = `
            SELECT 
                K.Kimlik AS MusteriID,
                MH.Kimlik AS HareketID,
                K.Adı, 
                K.Soyadı, 
                K.CEPTEL, 
                
                -- ★★★★★ BU ALANLARI EKLEDİK ★★★★★
                ISNULL(K.Unvan, '') AS Unvan,
                ISNULL(K.Ilce, '') AS Ilce,
                ISNULL(K.Mahalle, '') AS Mahalle,
                ISNULL(K.Adres, '') AS Adres,
                -- ★★★★★★★★★★★★★★★★★★★★★★★★★★
                
                MH.AÇIKLAMA, 
                MH.notlar,
                MH.ADET, 
                ISNULL(MH.KalanTeslimat, MH.ADET) as KalanTeslimat
            FROM [komur].[dbo].[MusteriHareket] MH
            INNER JOIN [komur].[dbo].[Kimlik] K ON MH.Kisi = K.Kimlik
            WHERE 
                MH.TeslimDurumu = 'Bekliyor' 
                AND (MH.KalanTeslimat > 0 OR MH.KalanTeslimat IS NULL)
            ORDER BY MH.TARİH ASC
        `;
        const result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Bekleyen teslimatlar hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});


app.get('/api/bekleyen-teslimatlar', async (req, res) => {
    try {
        try {
            const cleanPool = await sql.connect(config);
            await apartmanYetimBorcSatirlariTemizle(cleanPool);
        } catch (_) { /* temizlik başarısızsa listeyi yine de göster */ }
        const query = `
            SELECT 
                MH.Kimlik,              -- 🚨 ESKİ SİSTEM İÇİN (Yıkım buraya bakıyor, ASLA DOKUNULMADI)
                MH.Kimlik AS HareketID, -- Yeni sistemler için yedek
                K.Kimlik AS MusteriID,  -- 🚨 HIZLI ADRES DÜZENLEME İÇİN EKLENDİ
                
                K.Adı, 
                K.Soyadı, 
                K.CEPTEL, 
                
                -- 🚨 ADRES DÜZENLEME VE TABLO GÖRÜNÜMÜ İÇİN EKLENENLER
                ISNULL(K.Unvan, '') AS Unvan,
                ISNULL(K.Ilce, '') AS Ilce,
                ISNULL(K.Mahalle, '') AS Mahalle,
                ISNULL(K.Adres, '') AS Adres,
                
                MH.AÇIKLAMA, 
                MH.notlar,
                MH.ADET, -- AKILLI MODAL İÇİN TOPLAM MİKTARI BURADAN GÖNDERİYORUZ
                ISNULL(MH.KalanTeslimat, MH.ADET) as KalanTeslimat,
                0 AS IsApartmanBlok
            FROM [komur].[dbo].[MusteriHareket] MH
            INNER JOIN [komur].[dbo].[Kimlik] K ON MH.Kisi = K.Kimlik
            WHERE 
                MH.TeslimDurumu = 'Bekliyor' 
                AND (MH.KalanTeslimat > 0 OR MH.KalanTeslimat IS NULL)
                AND MH.notlar NOT LIKE N'%Apartman anlaşması%'   -- apartmanlar blok bazında ayrı listelenir
            ORDER BY MH.TARİH ASC
        `;
        const result = await sql.query(query);

        // 🏢 Apartman teslimatları: kişi kişi değil, BLOK bazında (tüm daireler dahil)
        const blokQuery = `
            SELECT
                AP.Id AS ApartmanId,
                AP.Ad AS ApartmanAd,
                ISNULL(AP.Mahalle, '') AS ApartmanMahalle,
                ISNULL(AP.Ilce, '') AS ApartmanIlce,
                ISNULL(NULLIF(LTRIM(RTRIM(D.Blok)), ''), '(Bloksuz)') AS ApartmanBlok,
                COUNT(*) AS DaireSayisi,
                SUM(D.AnlasilanMiktar) AS ToplamAnlasilan,
                SUM(ISNULL(D.TeslimEdilen, 0)) AS ToplamTeslim,
                MAX(S.UrunAdi) AS UrunAdi
            FROM [komur].[dbo].[ApartmanDaireler] D
            INNER JOIN [komur].[dbo].[Apartmanlar] AP ON AP.Id = D.ApartmanId
            LEFT JOIN [komur].[dbo].[StokListesi] S ON S.ID = D.UrunID
            WHERE D.UrunID IS NOT NULL AND D.AnlasilanMiktar > 0
            GROUP BY AP.Id, AP.Ad, AP.Mahalle, AP.Ilce, ISNULL(NULLIF(LTRIM(RTRIM(D.Blok)), ''), '(Bloksuz)')
            HAVING SUM(D.AnlasilanMiktar) > SUM(ISNULL(D.TeslimEdilen, 0)) + 0.01
            ORDER BY AP.Ad, ApartmanBlok
        `;
        const blokRes = await sql.query(blokQuery);
        const blokSatirlari = (blokRes.recordset || []).map((b) => ({
            IsApartmanBlok: 1,
            ApartmanId: b.ApartmanId,
            ApartmanAd: b.ApartmanAd,
            ApartmanBlok: b.ApartmanBlok,
            ApartmanMahalle: b.ApartmanMahalle,
            ApartmanIlce: b.ApartmanIlce,
            DaireSayisi: b.DaireSayisi,
            ToplamAnlasilan: b.ToplamAnlasilan,
            ToplamTeslim: b.ToplamTeslim,
            UrunAdi: b.UrunAdi
        }));

        res.json([...blokSatirlari, ...result.recordset]);
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});
// PARÇALI YIKIMI (TESLİMATI) KAYDET VE MATEMATİĞİ YAP
app.put('/api/teslimat-guncelle/:id', async (req, res) => {
    const islemId = req.params.id;
    const { teslim_edilen } = req.body; // Şoförün ekranda girdiği miktar

    try {
        const request = new sql.Request();
        request.input('id', sql.Int, parseInt(islemId));
        request.input('teslim', sql.Float, parseFloat(teslim_edilen));
        
        // HARİKA SQL MATEMATİĞİ: 
        // 1. KalanTeslimat'tan şoförün yazdığı rakamı çıkar
        // 2. Eğer o rakam 0'a ulaştıysa (veya altındaysa) durumu otomatik 'Teslim Edildi' yap, listeden düşsün.
        const updateQuery = `
            UPDATE [komur].[dbo].[MusteriHareket] 
            SET 
                KalanTeslimat = ROUND(KalanTeslimat - @teslim, 2),
                TeslimDurumu = CASE WHEN ROUND(KalanTeslimat - @teslim, 2) <= 0 THEN 'Teslim Edildi' ELSE 'Bekliyor' END
            WHERE Kimlik = @id
        `;
        await request.query(updateQuery);
        
        res.json({ mesaj: 'Teslimat başarıyla düşüldü.' });
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

// --- İŞLEM VE TESLİMAT GÜNCELLEME (DÜZENLEME) ---
// --- İŞLEM VE TESLİMAT GÜNCELLEME (DÜZENLEME) ---
// 1. İŞLEM GÜNCELLE VE GEÇMİŞE KAYDET
// 1. İŞLEM GÜNCELLE VE GEÇMİŞE KAYDET (TEK ATIŞLIK AKILLI SİSTEM)
// 1. İŞLEM GÜNCELLE VE GEÇMİŞE KAYDET (HATA YAKALAYICI VERSİYON)

 // =========================================================
// 1. TESLİMAT GEÇMİŞİNİ GETİRME
// =========================================================
app.get('/api/teslimat-gecmisi/:hareketId', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const request = pool.request();
        request.input('hid', sql.Int, req.params.hareketId);
        
        const query = `SELECT * FROM [komur].[dbo].[TeslimatGecmisi] WHERE HareketID = @hid ORDER BY Tarih DESC`;
        const result = await request.query(query);
        res.json(result.recordset || []);
    } catch (err) {
        res.status(500).json({ success: false, hata: err.message });
    }
});


app.delete('/api/islem/:kimlik', async (req, res) => {
    const islemKimlik = req.params.kimlik;

    if (!islemKimlik || islemKimlik === 'undefined' || isNaN(parseInt(islemKimlik))) {
        return res.status(400).json({ hata: "Geçersiz işlem numarası." });
    }

    try {
        const pool = await sql.connect(config);
        
        // 🚨 KORUMA KALKANI: İşlemlerin yarım kalmasını önlemek için Transaction başlatıyoruz
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Silinecek işlemin verilerini alıyoruz (birimtür EKLENDİ!)
            const islemRes = await transaction.request()
                .input('kimlikId', sql.Int, parseInt(islemKimlik))
                .query(`SELECT Kisi, ADET, AÇIKLAMA, BORÇ, ÖDEME, birimtür FROM [komur].[dbo].[MusteriHareket] WHERE Kimlik = @kimlikId`);

            if (islemRes.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ hata: "İşlem bulunamadı." });
            }

            const islem = islemRes.recordset[0];
            const islemBirim = islem.birimtür || ''; // İşlemin birimi (Ton, Adet, Çuval)
            let iadeEdilecekTutar = parseFloat(islem.ÖDEME) || 0;

            // =======================================================
            // --- 🌊 HAVUZ SİSTEMİ: TAKSİT GERİ ALMA MANTIĞI ---
            // =======================================================
            try {
                if (iadeEdilecekTutar > 0 && islem.AÇIKLAMA && islem.AÇIKLAMA.toLowerCase().includes("taksit")) {
                    console.log(`🔄 Havuzdan Geri Çekilecek Tutar: ${iadeEdilecekTutar} TL`);

                    // Müşterinin içinde para olan taksitlerini SONDAN BAŞA doğru (Tersten FIFO) çekiyoruz
                    const odenenTaksitler = await transaction.request()
                        .input('kisi', sql.Int, islem.Kisi)
                        .query(`SELECT Kimlik, MIKTAR, ODEMELER FROM [komur].[dbo].[TAKSIT] 
                                WHERE kişi = @kisi AND ODEMELER > 0 
                                ORDER BY TARIH DESC, Kimlik DESC`);

                    for (let t of odenenTaksitler.recordset) {
                        if (iadeEdilecekTutar <= 0) break; // Çekilecek para bittiyse dur

                        let taksitOdenenKisim = parseFloat(t.ODEMELER) || 0;

                        if (iadeEdilecekTutar >= taksitOdenenKisim) {
                            // Taksitin içindeki parayı komple geri al
                            await transaction.request()
                                .input('tid', sql.Int, t.Kimlik)
                                .query(`UPDATE [komur].[dbo].[TAKSIT] SET DURUM = '0', ODEMELER = 0, IslemiYapan = NULL WHERE Kimlik = @tid`);
                            
                            iadeEdilecekTutar = parseFloat((iadeEdilecekTutar - taksitOdenenKisim).toFixed(2));
                        } else {
                            // Taksitin içinden sadece sildiğimiz kadarını geri al
                            let kalanOdeme = parseFloat((taksitOdenenKisim - iadeEdilecekTutar).toFixed(2));
                            await transaction.request()
                                .input('tid', sql.Int, t.Kimlik)
                                .input('kalanOdeme', sql.Decimal(18,2), kalanOdeme)
                                .query(`UPDATE [komur].[dbo].[TAKSIT] SET DURUM = '0', ODEMELER = @kalanOdeme WHERE Kimlik = @tid`);
                            
                            iadeEdilecekTutar = 0;
                        }
                    }
                    console.log(`✅ Taksit havuzu başarıyla tersten boşaltıldı.`);
                }
            } catch (taksitHata) {
                console.error("⚠️ Taksit geri açılırken hata oluştu:", taksitHata.message);
            }

            // =======================================================
            // --- 📦 ÇİFT KİLİTLİ (İSİM + BİRİM) STOK DENGELEME MANTIĞI ---
            // =======================================================
            try {
                if (islem.ADET > 0 && islem.AÇIKLAMA) {
                    
                    let arananAciklama = islem.AÇIKLAMA;
                    if (arananAciklama.includes('İADE:')) {
                        arananAciklama = String(arananAciklama.split('İADE:')[1] || '').trim();
                    }

                    console.log(`📦 Stok aranıyor... İsim: ${arananAciklama}, Birim: ${islemBirim || '(kayıtta yok)'}`);

                    const tumStok = await transaction.request().query(`
                        SELECT ID, UrunAdi FROM [komur].[dbo].[StokListesi] WHERE TakipEdilsinMi = 1
                    `);
                    const stokEslesme = stokKalemBulKayitListesinden(tumStok.recordset || [], arananAciklama, islemBirim);

                    if (stokEslesme) {
                        const urunId = stokEslesme.ID;
                        const gercekUrunAdi = stokEslesme.UrunAdi;
                        
                        // Satış siliniyorsa -> Stok Artar
                        if (islem.BORÇ > 0) {
                            await transaction.request()
                                .input('miktar', sql.Decimal(18,2), islem.ADET)
                                .input('uId', sql.Int, urunId)
                                .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu, 0) + @miktar WHERE ID = @uId`);
                            console.log(`📦 Satış Silindi, Stok Artırıldı (+${islem.ADET}): ${gercekUrunAdi}`);
                        } 
                        // İade siliniyorsa -> Stok Azalır
                        else if (islem.ÖDEME > 0 && islem.AÇIKLAMA.includes('İADE:')) {
                            await transaction.request()
                                .input('miktar', sql.Decimal(18,2), islem.ADET)
                                .input('uId', sql.Int, urunId)
                                .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu, 0) - @miktar WHERE ID = @uId`);
                            console.log(`📦 İade İptal Edildi, Stok Azaltıldı (-${islem.ADET}): ${gercekUrunAdi}`);
                        }
                    } else {
                        console.log(`⚠️ UYARI: '${arananAciklama}' + birim '${islemBirim || '—'}' için stok satırı eşleşmedi (ad+birim veya tekilleşme).`);
                    }
                }
            } catch (stokHata) {
                console.error("⚠️ Stok güncellenirken hata oluştu:", stokHata.message);
            }

            // =======================================================
            // --- 3. İŞLEMİ KASADAN SİL ---
            // =======================================================
            await transaction.request()
                .input('kimlikId', sql.Int, parseInt(islemKimlik))
                .query(`DELETE FROM [komur].[dbo].[MusteriHareket] WHERE Kimlik = @kimlikId`);

            // Her şey sorunsuzsa onayla
            await transaction.commit();

            // Apartmana özgü ödeme silindiyse kg borcunu geri yükle
            try {
                const aptOdemeMi = (parseFloat(islem.ÖDEME) || 0) > 0 && String(islem.birimtür || '').toUpperCase() === 'APT';
                if (aptOdemeMi) {
                    const geri = await apartmanOdemeKgGeriAl(pool, islem.Kisi, islem.ÖDEME, 'Ödeme silindi');
                    console.log(`↩️ Apartman ödemesi geri alındı: ${geri.geriAlinan} TL / +${geri.kgEklenen} kg`);
                }
            } catch (aptGeriHata) {
                console.error('⚠️ Apartman ödeme geri alma hatası:', aptGeriHata.message);
            }

            res.status(200).json({ mesaj: "İşlem başarıyla silindi ve havuz dengelendi." });

        } catch (innerErr) {
            // Ana akışta bir hata olursa veritabanındaki her şeyi başladığı noktaya geri sar
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("🔥 ANA SİLME HATASI:", err);
        res.status(500).json({ hata: err.message });
    }
});
// =========================================================
// 2. İŞLEM GÜNCELLE VE GEÇMİŞE YAZ (AKILLI SİSTEM)
// =========================================================
app.put('/api/islem-guncelle/:id', async (req, res) => {
    const { id } = req.params;
    const { teslim_edilen_miktar, notlar, durum } = req.body;

    try {
        const pool = await sql.connect(config);
        const request = pool.request();
        
        request.input('id', sql.Int, parseInt(id));
        request.input('yaz', sql.Decimal(18, 2), parseFloat(teslim_edilen_miktar) || 0);
        request.input('not', sql.NVarChar, notlar || '');
        request.input('durum', sql.NVarChar, durum || 'Bekliyor');

        const query = `
            DECLARE @kalan DECIMAL(18,2);
            DECLARE @toplamAdet DECIMAL(18,2);

            SELECT 
                @toplamAdet = ISNULL(ADET, 0),
                @kalan = CASE 
                    WHEN KalanTeslimat IS NULL THEN ISNULL(ADET, 0)
                    WHEN KalanTeslimat < 0 THEN 0
                    ELSE KalanTeslimat 
                END
            FROM [komur].[dbo].[MusteriHareket] WHERE Kimlik = @id;

            IF (@yaz > @kalan) BEGIN THROW 51000, 'HATA_KOTA', 1; END

            IF (@yaz > 0)
            BEGIN
                INSERT INTO [komur].[dbo].[TeslimatGecmisi] (HareketID, YikilanMiktar, Aciklama, Tarih) 
                VALUES (@id, @yaz, @not, GETDATE());

                UPDATE [komur].[dbo].[MusteriHareket] 
                SET KalanTeslimat = @kalan - @yaz, TeslimDurumu = CASE WHEN (@kalan - @yaz) <= 0 THEN 'Teslim Edildi' ELSE @durum END, notlar = @not
                WHERE Kimlik = @id;
            END
            ELSE
            BEGIN
                UPDATE [komur].[dbo].[MusteriHareket] 
                SET TeslimDurumu = @durum, notlar = @not,
                    KalanTeslimat = CASE 
                        WHEN @durum = 'Teslim Edildi' THEN 0 
                        WHEN @durum = 'Bekliyor' AND @kalan = 0 THEN @toplamAdet
                        ELSE @kalan 
                    END
                WHERE Kimlik = @id;
            END
        `;
        await request.query(query);
        res.json({ success: true });
    } catch (err) {
        if (err.message.includes('HATA_KOTA')) return res.status(400).json({ success: false, hata: "Girdiğiniz miktar, kotayı aşıyor!" });
        res.status(500).json({ success: false, hata: err.message });
    }
});


// =========================================================
// 3. GEÇMİŞTEN SİLME VE İADE (ÇÖP TENEKESİ)
// =========================================================
app.delete('/api/teslimat-gecmisi/:id', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const request = pool.request();
        request.input('gecmisId', sql.Int, parseInt(req.params.id));

        const bulRes = await request.query(`SELECT HareketID, YikilanMiktar FROM [komur].[dbo].[TeslimatGecmisi] WHERE ID = @gecmisId`);
        if (bulRes.recordset.length === 0) return res.status(404).json({ success: false, hata: 'Kayıt bulunamadı!' });

        const hareketId = bulRes.recordset[0].HareketID;
        const iadeMiktar = bulRes.recordset[0].YikilanMiktar;

        await request.query(`DELETE FROM [komur].[dbo].[TeslimatGecmisi] WHERE ID = @gecmisId`);

        const iadeReq = pool.request();
        iadeReq.input('iadeMiktar', sql.Decimal(18,2), iadeMiktar);
        iadeReq.input('hareketId', sql.Int, hareketId);
        await iadeReq.query(`
            UPDATE [komur].[dbo].[MusteriHareket]
            SET KalanTeslimat = CASE WHEN KalanTeslimat IS NULL THEN ADET + @iadeMiktar ELSE KalanTeslimat + @iadeMiktar END,
                TeslimDurumu = 'Bekliyor'
            WHERE Kimlik = @hareketId
        `);

        res.json({ success: true, mesaj: 'İade edildi.' });
    } catch (err) {
        res.status(500).json({ success: false, hata: err.message });
    }
});

app.get('/api/musteri-taksitler/:id', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT 
                    Kimlik, 
                    MIKTAR, 
                    ODEMELER,   -- 🚨 HAYATİ EKLEME: Havuzdaki kısmi ödeme miktarını arayüze taşır!
                    AÇIKLAMA, 
                    DURUM, 
                    TARIH, 
                    IslemiYapan 
                FROM [komur].[dbo].[TAKSIT] 
                WHERE kişi = @id 
                ORDER BY DURUM ASC, TARIH ASC, Kimlik ASC -- 🚨 SIRALAMA ZIRHI: Önce bekleyenler, sonra tarih, sonra 1/2 - 2/2 sırası
            `); 
        
        res.json(result.recordset);
    } catch (err) {
        console.error("❌ TAKSİT ÇEKME HATASI:", err.message);
        res.status(500).json({ hata: "Veritabanı hatası: " + err.message });
    }
});

app.post('/api/borc-taksitlendir', async (req, res) => {
    const { musteri_id, toplam_tutar, taksit_sayisi, baslangic_tarihi, islemiYapan } = req.body;
    const adet = parseInt(taksit_sayisi, 10);
    if (!adet || adet < 1 || adet > 12) {
        return res.status(400).json({ hata: 'Taksit sayısı 1 ile 12 arasında olmalıdır.' });
    }
    
    try {
        const pool = await sql.connect(config);

        // Ödenmemiş ve kısmi ödemesi olmayan taksitleri sil (tam ödenenler ve havuzda parası olanlar kalır)
        await pool.request()
            .input('kisi', sql.Int, musteri_id)
            .query(`DELETE FROM [komur].[dbo].[TAKSIT] 
                WHERE kişi = @kisi AND DURUM = '0' AND ISNULL(ODEMELER, 0) = 0`);

        // 🎯 KURUŞ HASSASİYETİ (0.01 Hatasını Öldüren Kısım)
        // Toplam tutarı kuruşa çevirip bölüyoruz, sonra tekrar liraya çeviriyoruz
        const toplamKurus = Math.round(parseFloat(toplam_tutar) * 100);
        const birimTaksitKurus = Math.floor(toplamKurus / adet);
        let sonTaksitKurus = toplamKurus - (birimTaksitKurus * (adet - 1));

        let vadeTarihi = new Date(baslangic_tarihi);

        for (let i = 1; i <= adet; i++) {
            // Son taksitte kuruş farkı kalmasın diye dengeleme yapıyoruz
            const guncelMiktar = (i === adet ? sonTaksitKurus : birimTaksitKurus) / 100;

            const request = pool.request();
            request.input('kisi', sql.Int, musteri_id);
            request.input('miktar', sql.Decimal(18, 2), guncelMiktar);
            request.input('aciklama', adet == 1 ? "Vadeli Borç" : `${i}/${adet}`);
            request.input('vade', sql.DateTime, new Date(vadeTarihi));
            request.input('yapan', sql.NVarChar, islemiYapan || 'Sistem');

            await request.query(`
                INSERT INTO [komur].[dbo].[TAKSIT] (TARIH, MIKTAR, AÇIKLAMA, kişi, DURUM, IslemiYapan)
                VALUES (@vade, @miktar, @aciklama, @kisi, '0', @yapan)
            `);
            
            vadeTarihi.setMonth(vadeTarihi.getMonth() + 1);
        }

        console.log(`✅ Yapılandırma Yenilendi: Müşteri: ${musteri_id}, Tutar: ${toplam_tutar}`);
        res.json({ success: true });
        
    } catch (err) {
        console.error("❌ Taksitlendirme Hatası:", err.message);
        res.status(500).json({ hata: "Sistem hatası: " + err.message });
    }
});

// Manuel taksit planı: tutar ve vade her satır için ayrı girilir
app.post('/api/borc-taksitlendir-manuel', async (req, res) => {
    const { musteri_id, taksitler, islemiYapan } = req.body;
    if (!Array.isArray(taksitler) || taksitler.length < 1 || taksitler.length > 12) {
        return res.status(400).json({ hata: '1 ile 12 arasında taksit satırı gönderin.' });
    }

    const satirlar = [];
    for (let i = 0; i < taksitler.length; i++) {
        const miktar = parseFloat(taksitler[i].miktar);
        const tarih = taksitler[i].tarih;
        if (!tarih || !Number.isFinite(miktar) || miktar <= 0) {
            return res.status(400).json({ hata: `${i + 1}. taksit için geçerli tutar ve tarih girin.` });
        }
        satirlar.push({ miktar, tarih, sira: i + 1, toplam: taksitler.length });
    }

    try {
        const pool = await sql.connect(config);
        await pool.request()
            .input('kisi', sql.Int, musteri_id)
            .query(`DELETE FROM [komur].[dbo].[TAKSIT] 
                WHERE kişi = @kisi AND DURUM = '0' AND ISNULL(ODEMELER, 0) = 0`);

        for (const s of satirlar) {
            const aciklama = satirlar.length === 1 ? 'Vadeli Borç' : `${s.sira}/${s.toplam}`;
            await pool.request()
                .input('kisi', sql.Int, musteri_id)
                .input('miktar', sql.Decimal(18, 2), s.miktar)
                .input('aciklama', sql.NVarChar, aciklama)
                .input('vade', sql.DateTime, new Date(s.tarih))
                .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                .query(`
                    INSERT INTO [komur].[dbo].[TAKSIT] (TARIH, MIKTAR, AÇIKLAMA, kişi, DURUM, IslemiYapan)
                    VALUES (@vade, @miktar, @aciklama, @kisi, '0', @yapan)
                `);
        }

        console.log(`✅ Manuel taksit planı: Müşteri ${musteri_id}, ${satirlar.length} satır`);
        res.json({ success: true, adet: satirlar.length });
    } catch (err) {
        console.error('❌ Manuel taksitlendirme hatası:', err.message);
        res.status(500).json({ hata: 'Sistem hatası: ' + err.message });
    }
});

app.delete('/api/taksit-plani-tumunu-sil/:kisiId', async (req, res) => {
    const musteriId = req.params.kisiId;
    try {
        const pool = await sql.connect(config);
        const silinen = await pool.request()
            .input('id', sql.Int, musteriId)
            .query(`DELETE FROM [komur].[dbo].[TAKSIT] 
                WHERE kişi = @id AND DURUM = '0' AND ISNULL(ODEMELER, 0) = 0`);
        const adet = silinen.rowsAffected?.[0] ?? 0;
        res.json({ success: true, mesaj: 'Ödenmemiş taksitler temizlendi.', silinen: adet });
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});
app.get('/api/rapor-vadesi-gelenler', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const query = `
            SELECT 
                T.Kimlik, T.MIKTAR, T.AÇIKLAMA, 
                T.TARIH as ODEMETARİHİ, -- Veritabanından TARIH oku, ön tarafa ODEMETARİHİ gibi gönder
                K.Adı, K.CEPTEL, K.Kimlik as MusteriID,
                DATEDIFF(day, T.TARIH, GETDATE()) as GecikmeGunu,
                -- Müşterinin güncel bakiyesini anlık hesapla
                (SELECT ISNULL(SUM(BORÇ), 0) - ISNULL(SUM(ÖDEME), 0) 
                 FROM [komur].[dbo].[MusteriHareket] 
                 WHERE Kisi = K.Kimlik) as GuncelBakiye
            FROM [komur].[dbo].[TAKSIT] T
            INNER JOIN [komur].[dbo].[Kimlik] K ON T.kişi = K.Kimlik
            WHERE T.DURUM = '0' 
              AND CAST(T.TARIH AS DATE) <= CAST(GETDATE() AS DATE)
              -- FİLTRE: Sadece borcu devam edenleri getir
              AND (SELECT ISNULL(SUM(BORÇ), 0) - ISNULL(SUM(ÖDEME), 0) 
                   FROM [komur].[dbo].[MusteriHareket] 
                   WHERE Kisi = K.Kimlik) > 0
            ORDER BY T.TARIH DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Rapor hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});

// PUT yerine POST yapıyoruz, kafa karışıklığı bitiyor
// PUT yerine POST yaparak frontend ile eşliyoruz
app.post('/api/musteri-guncelle/:id', async (req, res) => {
    // 🚨 Gelen pakette ilce ve mahalle de olmalı
    // 🚨 BAKALIM NODE.JS PAKETİ GÖRÜYOR MU?
    console.log("🔥 NODE.JS'E GELEN PAKET:", req.body);
    const { ad, telefon, unvan, adres, ilce, mahalle } = req.body; 
    const { id } = req.params;

    try {
        const pool = await sql.connect(config);
        
        const query = `
            IF EXISTS (SELECT 1 FROM [komur].[dbo].[Kimlik] WHERE [Kimlik] = @id)
            BEGIN
                UPDATE [komur].[dbo].[Kimlik] 
                SET [Adı] = @ad, [CEPTEL] = @tel, [Unvan] = @unvan, 
                    [Adres] = @adres, [Ilce] = @ilce, [Mahalle] = @mahalle 
                WHERE [Kimlik] = @id
            END
            ELSE
            BEGIN
                INSERT INTO [komur].[dbo].[Kimlik] ([Kimlik], [Adı], [CEPTEL], [Unvan], [Adres], [Ilce], [Mahalle])
                VALUES (@id, @ad, @tel, @unvan, @adres, @ilce, @mahalle)
            END
        `;

        await pool.request()
            .input('id', sql.Int, id)
            .input('ad', sql.NVarChar, ad ? ad : '')
            .input('tel', sql.NVarChar, telefon ? telefon : '')
            .input('unvan', sql.NVarChar, unvan ? unvan : '')
            .input('adres', sql.NVarChar, adres ? adres : '')
            .input('ilce', sql.NVarChar, ilce ? ilce : '')         // 🚨 SQL'E GİDİYOR MU?
            .input('mahalle', sql.NVarChar, mahalle ? mahalle : '') // 🚨 SQL'E GİDİYOR MU?
            .query(query);

        res.json({ success: true, mesaj: "İşlem Başarılı" });
    } catch (err) {
        console.error("❌ SQL Hatası:", err.message);
        res.status(500).json({ hata: err.message });
    }
});

// =========================================================
// 🚚 SADECE SEVKİYAT İÇİN "HIZLI ADRES GÜNCELLEME" KÖPRÜSÜ
// =========================================================
app.post('/api/hizli-adres-guncelle/:id', async (req, res) => {
    console.log("🔥 HIZLI ADRES GÜNCELLEMEYE GELEN PAKET:", req.body);
    const { ad, telefon, unvan, adres, ilce, mahalle } = req.body; 
    const { id } = req.params;

    try {
        const pool = await sql.connect(config);
        
        // 🚨 SADECE GÜNCELLEME (UPDATE) YAPAR! (INSERT YOK)
        const query = `
            UPDATE [komur].[dbo].[Kimlik] 
            SET [Adı] = @ad, [CEPTEL] = @tel, [Unvan] = @unvan, 
                [Adres] = @adres, [Ilce] = @ilce, [Mahalle] = @mahalle 
            WHERE [Kimlik] = @id
        `;

        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('ad', sql.NVarChar, ad ? ad : '')
            .input('tel', sql.NVarChar, telefon ? telefon : '')
            .input('unvan', sql.NVarChar, unvan ? unvan : '')
            .input('adres', sql.NVarChar, adres ? adres : '')
            .input('ilce', sql.NVarChar, ilce ? ilce : '') 
            .input('mahalle', sql.NVarChar, mahalle ? mahalle : '') 
            .query(query);

        // Eğer müşteri ID'si veritabanında cidden yoksa:
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, hata: "Müşteri bulunamadı! Liste güncel olmayabilir." });
        }

        res.json({ success: true, mesaj: "İşlem Başarılı" });
    } catch (err) {
        console.error("❌ SQL Hatası:", err.message);
        res.status(500).json({ hata: err.message });
    }
});


app.get('/api/rapor-borclular', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const query = `
            SELECT 
                K.Kimlik, K.Adı, K.CEPTEL,
                ISNULL(SUM(MH.BORÇ), 0) as ToplamBorc,
                ISNULL(SUM(MH.ÖDEME), 0) as ToplamOdeme,
                (ISNULL(SUM(MH.BORÇ), 0) - ISNULL(SUM(MH.ÖDEME), 0)) as Bakiye
            FROM [komur].[dbo].[Kimlik] K
            LEFT JOIN [komur].[dbo].[MusteriHareket] MH ON K.Kimlik = MH.Kisi
            GROUP BY K.Kimlik, K.Adı, K.CEPTEL
            HAVING (ISNULL(SUM(MH.BORÇ), 0) - ISNULL(SUM(MH.ÖDEME), 0)) > 0
            ORDER BY (ISNULL(SUM(MH.BORÇ), 0) - ISNULL(SUM(MH.ÖDEME), 0)) DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

// --- ÜRÜN İADE ALMA API'Sİ (GARANTİLİ VERSİYON) ---
// =========================================================
// 🔄 ÜRÜN İADE ALMA API (SAAT VE SARI BADGE UYUMLU)
// =========================================================
// --- ÜRÜN İADE ALMA API'Sİ (SAAT, PERSONEL VE SARI ETİKET UYUMLU) ---
// --- ÜRÜN İADE ALMA API'Sİ (SAAT VE SARI ETİKET KORUMALI) ---
// --- ÜRÜN İADE ALMA API'Sİ (MAKBUZ NUMARATÖRLÜ VE ZIRHLI SAATLİ) ---
app.post('/api/iade', async (req, res) => {
    // 1. Gelen verileri alıyoruz
    const { musteri_id, komur_id, miktar, tutar, notlar, tarih, islemiYapan } = req.body;

    const islemTarihiStr = normalizeIslemTarihiStr(tarih);

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin(); 

        try {
            // --- ADIM 1: ÜRÜN BİLGİSİNİ ÇEK ---
            const urunRes = await transaction.request()
                .input('kid', sql.Int, parseInt(komur_id))
                .query("SELECT UrunAdi FROM [komur].[dbo].[StokListesi] WHERE ID = @kid");
            
            if (urunRes.recordset.length === 0) throw new Error("Ürün bulunamadı!");
            const orjinalUrunAdi = urunRes.recordset[0].UrunAdi;
            const { temizAd: temizUrunTemel, birimTuru } = parseStokUrunAdi(orjinalUrunAdi);

            const aciklama = "İADE: " + temizUrunTemel;

            // --- ADIM 2: TEK ŞALTER KONTROLÜ (Otomatik Yazdırma Şalteri) ---
            const numAyarRes = await transaction.request()
                .query("SELECT Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = 'MakbuzOtomatikYazdir'");
            
            // Şalter yoksa veya 'false' değilse AÇIK kabul et
            const numaratorAcik = (numAyarRes.recordset.length === 0 || numAyarRes.recordset[0].Deger !== 'false');

            let formatliMakbuzNo = null;

            // Sadece şalter açıksa numara üret
            if (numaratorAcik) {
                const ayarRes = await transaction.request()
                    .query("SELECT Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = 'MakbuzBaslangicNo'");
                
                let baslangicNo = ayarRes.recordset.length > 0 ? parseInt(ayarRes.recordset[0].Deger) : 1;
                
                const maxRes = await transaction.request()
                    .query(`
                        SELECT MAX(CAST(MakbuzNo AS INT)) as MaxNo 
                        FROM [komur].[dbo].[MusteriHareket] 
                        WHERE MakbuzNo IS NOT NULL AND ISNUMERIC(MakbuzNo) = 1
                    `);
                
                let dbEnYuksekNo = maxRes.recordset[0].MaxNo || 0;
                let yeniMakbuzNo = Math.max(baslangicNo, dbEnYuksekNo + 1);
                formatliMakbuzNo = String(yeniMakbuzNo).padStart(6, '0');
            }

            // --- ADIM 3: MÜŞTERİ HAREKETİ KAYDI (SAAT VE MAKBUZLU) ---
            await transaction.request()
                .input('kisi', sql.Int, parseInt(musteri_id)) 
                .input('aciklama', sql.NVarChar, aciklama)
                .input('m', sql.Decimal(18, 2), parseFloat(miktar))
                .input('t', sql.Decimal(18, 2), parseFloat(tutar))
                .input('not', sql.NVarChar, notlar || '')
                .input('tar', sql.NVarChar, islemTarihiStr) // Zırhlı saat metni
                .input('mNo', sql.NVarChar, formatliMakbuzNo) // Null veya numara gider
                .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                .input('birim', sql.NVarChar, birimTuru || 'Ton')
                .query(`
                    INSERT INTO [komur].[dbo].[MusteriHareket] 
                    (Kisi, AÇIKLAMA, ADET, BORÇ, ÖDEME, TARİH, YIL, notlar, TeslimDurumu, MakbuzNo, IslemiYapan, birimtür) 
                    VALUES 
                    (@kisi, @aciklama, @m, 0, @t, @tar, YEAR(@tar), @not, 'İade', @mNo, @yapan, @birim)
                `);

            // --- ADIM 4: STOK GÜNCELLEME (İADE OLDUĞU İÇİN STOK ARTAR) ---
            await transaction.request()
                .input('sid', sql.Int, parseInt(komur_id))
                .input('sm', sql.Decimal(18, 2), parseFloat(miktar))
                .query("UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu, 0) + @sm WHERE ID = @sid");

            await transaction.commit();
            console.log(`✅ İade Kaydedildi: Müşteri ID: ${musteri_id}, Fiş: ${formatliMakbuzNo || 'Yok'}, Saat: ${islemTarihiStr}`);
            res.json({ success: true, makbuzNo: formatliMakbuzNo });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("❌ İADE HATASI:", err.message);
        res.status(500).json({ hata: "Veritabanı hatası: " + err.message });
    }
});
// ==========================================================
// TEKİL TAKSİT SİLME ENDPOINT'İ (UYUMLU VERSİYON)
// ==========================================================
app.delete('/api/taksit-sil/:id', async (req, res) => {
    try {
        const taksitId = req.params.id;
        console.log(`🗑️ Silinmek istenen taksit ID: ${taksitId}`);

        // BURASI ÖNEMLİ: Kendi diğer API'lerinde 'sql.Request()' veya 'pool.request()'
        // hangisini kullanıyorsan onu yaz. Genelde 'sql' modülü direkt çağrılır:
        const request = new sql.Request(); // Veya kendi sistemine göre 'pool.request()'
        
        request.input('id', sql.Int, taksitId);
        
        // DİKKAT: 'Taksitler' tablosu ve 'Kimlik' sütunu senin SQL'dekiyle aynı olmalı!
        const result = await request.query(`DELETE FROM [komur].[dbo].[TAKSIT] WHERE Kimlik = @id`); 

        if (result.rowsAffected[0] > 0) {
            console.log("✅ Taksit başarıyla silindi!");
            res.json({ success: true, mesaj: "Taksit başarıyla silindi." });
        } else {
            res.status(404).json({ success: false, hata: "Silinecek taksit bulunamadı." });
        }

    } catch (error) {
        console.error("🔥 TAKSİT SİLME MOTORU ÇÖKTÜ:", error.message);
        res.status(500).json({ success: false, hata: "SQL Hatası: " + error.message });
    }
});

// ==========================================================
// GİDERLER VE MAZOT TAKİBİ ENDPOINT'LERİ (DÜZELTİLMİŞ BAĞLANTI)
// ==========================================================

// 1. Tüm Giderleri Getir
app.get('/api/giderler', async (req, res) => {
    try {
        const request = new sql.Request(); // Senin sistemin anahtarı bu!
        const result = await request.query(`SELECT * FROM Giderler ORDER BY Tarih DESC, ID DESC`);
        
        // Eğer tablo boşsa hata vermesin diye boş dizi [] döndürüyoruz
        res.json(result.recordset || []); 
    } catch (error) {
        console.error("Giderleri çekme hatası:", error);
        res.status(500).json({ hata: "Giderler yüklenemedi: " + error.message });
    }
});

// 2. Yeni Gider Veya Mazot Hareketi Ekle
app.post('/api/gider', async (req, res) => {
    try {
        const { Tarih, Kategori, IslemTipi, Tutar, Miktar, FirmaKisi, Aciklama } = req.body;
        
        const request = new sql.Request();
        request.input('tarih', sql.Date, Tarih);
        request.input('kategori', sql.NVarChar, Kategori);
        request.input('islemtipi', sql.NVarChar, IslemTipi);
        request.input('tutar', sql.Decimal(18,2), Tutar || 0);
        request.input('miktar', sql.Decimal(18,2), Miktar || 0);
        request.input('firmakisi', sql.NVarChar, FirmaKisi || '');
        request.input('aciklama', sql.NVarChar, Aciklama || '');
        
        await request.query(`
            INSERT INTO Giderler (Tarih, Kategori, IslemTipi, Tutar, Miktar, FirmaKisi, Aciklama) 
            VALUES (@tarih, @kategori, @islemtipi, @tutar, @miktar, @firmakisi, @aciklama)
        `);
            
        res.json({ success: true, mesaj: "İşlem başarıyla kaydedildi." });
    } catch (error) {
        console.error("Gider ekleme hatası:", error);
        res.status(500).json({ hata: "Kayıt yapılamadı: " + error.message });
    }
});

// 3. Gider/Mazot Kaydı Sil
app.delete('/api/gider/:id', async (req, res) => {
    try {
        const request = new sql.Request();
        request.input('id', sql.Int, req.params.id);
        await request.query(`DELETE FROM Giderler WHERE ID = @id`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ hata: "Silinemedi." });
    }
});
// 4. Benzersiz Firma/Kişi Listesini Getir (Akıllı Kutu İçin)
app.get('/api/gider-firmalar', async (req, res) => {
    try {
        const request = new sql.Request();
        // Sadece boş olmayan ve tekrar etmeyen firma isimlerini harf sırasına göre getirir
        const result = await request.query(`
            SELECT DISTINCT FirmaKisi 
            FROM Giderler 
            WHERE FirmaKisi IS NOT NULL AND FirmaKisi != '' 
            ORDER BY FirmaKisi
        `);
        res.json(result.recordset || []);
    } catch (error) {
        console.error("Firma listesi çekme hatası:", error);
        res.status(500).json({ hata: "Firma listesi yüklenemedi: " + error.message });
    }
});
// 5. Günlük Giderleri Getir (Kasa Özeti İçin)
app.get('/api/gunluk-giderler', async (req, res) => {
    try {
        const { baslangic, bitis } = req.query;
        const request = new sql.Request();
        request.input('bas', sql.Date, baslangic);
        request.input('bit', sql.Date, bitis);
        
        const result = await request.query(`
            SELECT * FROM Giderler 
            WHERE Tarih >= @bas AND Tarih <= @bit 
            ORDER BY Tarih DESC, ID DESC
        `);
        res.json(result.recordset || []);
    } catch (error) {
        console.error("Günlük gider çekme hatası:", error);
        res.status(500).json({ hata: "Giderler yüklenemedi: " + error.message });
    }
});
// =========================================================
// 🚚 TOPTANCI MAL ALIM İŞLEMLERİ (ÖN YÜZ / FRONTEND)
// =========================================================
// =========================================================
// 🚚 TOPTANCI MAL ALIM İŞLEMLERİ (YENİ VE TAM SİSTEM)
// =========================================================

// --- 1. YENİ MAL ALIMI KAYDETME (Tarih eklendi) ---
// --- 1. YENİ MAL ALIMI KAYDETME API'SI ---
app.post('/api/mal-alimi', async (req, res) => {
    const { tarih, tedarikciId, tedarikciFirma, urunId, miktar, birimFiyat, odeme, aciklama, islemiYapan, paraBirimi, islemKuru, girisMiktar, girisBirimi, toplamBorc } = req.body;
    await ensureMalAlimDovizKolonlari();

    const pb = (paraBirimi === 'USD') ? 'USD' : 'TRY';
    const kur = pb === 'USD' ? (parseFloat(islemKuru) || 0) : 1;
    if (pb === 'USD' && kur <= 0) {
        return res.status(400).json({ hata: 'USD borç için geçerli bir kur girin.' });
    }

    let stokMiktar = parseFloat(miktar) || 0;
    let birimFiyatHesap = parseFloat(birimFiyat) || 0;
    const toplamBorcSayi = parseFloat(toplamBorc);

    try {
        const pool = await sql.connect(config);
        await ensureStokDonusumKolonlari();
        const urunRes = await pool.request()
            .input('u', sql.Int, urunId)
            .query(`SELECT UrunAdi, AdetBasinaKg FROM [komur].[dbo].[StokListesi] WHERE ID = @u`);
        if (!urunRes.recordset.length) {
            return res.status(400).json({ hata: 'Ürün bulunamadı.' });
        }
        const urunAdi = urunRes.recordset[0].UrunAdi;
        const adetKg = urunRes.recordset[0].AdetBasinaKg;
        const { birimTuru: satisBirimi } = parseStokUrunAdi(urunAdi);

        const gMiktar = girisMiktar != null ? parseFloat(girisMiktar) : stokMiktar;
        const gBirim = girisBirimi || satisBirimi;
        if (girisMiktar != null || girisBirimi) {
            stokMiktar = girisMiktarToStokMiktar(gMiktar, gBirim, satisBirimi, adetKg);
        }
        if (stokMiktar <= 0) {
            return res.status(400).json({ hata: 'Geçerli bir miktar girin.' });
        }

        if (toplamBorcSayi > 0) {
            birimFiyatHesap = toplamBorcSayi / stokMiktar;
        } else if (birimFiyatHesap <= 0) {
            return res.status(400).json({ hata: 'Toplam borç veya birim fiyat girin.' });
        }

        const dovizTutar = pb === 'USD' ? (toplamBorcSayi > 0 ? toplamBorcSayi : stokMiktar * birimFiyatHesap) : null;
        const toplamTutar = pb === 'USD'
            ? (toplamBorcSayi > 0 ? toplamBorcSayi * kur : stokMiktar * birimFiyatHesap * kur)
            : (toplamBorcSayi > 0 ? toplamBorcSayi : stokMiktar * birimFiyatHesap);
        const birimMaliyetTl = pb === 'USD' ? birimFiyatHesap * kur : birimFiyatHesap;
        const kayitGirisBirimi = gBirim;
        const kayitGirisMiktar = gMiktar;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await transaction.request()
                .input('tarih', sql.NVarChar, tarih || new Date().toISOString().split('T')[0])
                .input('tId', sql.Int, tedarikciId)
                .input('tFirma', sql.NVarChar, tedarikciFirma)
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), stokMiktar)
                .input('b', sql.Decimal(18,2), birimFiyatHesap)
                .input('top', sql.Decimal(18,2), toplamTutar)
                .input('o', sql.NVarChar, odeme)
                .input('a', sql.NVarChar, aciklama)
                .input('y', sql.NVarChar, islemiYapan)
                .input('pb', sql.NVarChar, pb)
                .input('kur', sql.Decimal(18, 4), kur)
                .input('dt', sql.Decimal(18, 2), dovizTutar)
                .input('gb', sql.NVarChar, kayitGirisBirimi)
                .input('gm', sql.Decimal(18, 2), kayitGirisMiktar)
                .query(`INSERT INTO [komur].[dbo].[MalAlimlari] 
                       (Tarih, TedarikciID, TedarikciFirma, UrunID, Miktar, BirimMaliyet, ToplamTutar, OdemeDurumu, Aciklama, IslemiYapan, ParaBirimi, IslemKuru, DovizTutar, GirisBirimi, GirisMiktar) 
                        VALUES (@tarih, @tId, @tFirma, @u, @m, @b, @top, @o, @a, @y, @pb, @kur, @dt, @gb, @gm)`);

            await transaction.request()
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), stokMiktar)
                .input('b', sql.Decimal(18,2), birimMaliyetTl)
                .query(`
                    UPDATE [komur].[dbo].[StokListesi] 
                    SET 
                        AlisFiyati = CASE 
                            WHEN (BaslangicStogu + @m) > 0 
                            THEN ((BaslangicStogu * AlisFiyati) + (@m * @b)) / (BaslangicStogu + @m)
                            ELSE @b 
                        END,
                        BaslangicStogu = BaslangicStogu + @m 
                    WHERE ID = @u
                `);

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { 
        console.error("❌ MAL ALIMI SQL HATASI:", err.message);
        res.status(500).json({ hata: err.message }); 
    }
});

// --- 2. ALIMLARI LİSTELEME API (Düzenleme için UrunID eklendi) ---
app.get('/api/mal-alimlari', async (req, res) => {
    try {
        await ensureMalAlimDovizKolonlari();
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT 
                M.ID, M.Tarih, M.TedarikciID, M.TedarikciFirma, M.UrunID, S.UrunAdi, 
                M.Miktar, M.BirimMaliyet, M.ToplamTutar, M.OdemeDurumu, M.Aciklama, M.IslemiYapan,
                ISNULL(M.ParaBirimi, N'TRY') AS ParaBirimi, ISNULL(M.IslemKuru, 1) AS IslemKuru, M.DovizTutar,
                ISNULL(S.AlimBirimi, N'Ton') AS AlimBirimi, S.AdetBasinaKg,
                M.GirisBirimi, M.GirisMiktar
            FROM [komur].[dbo].[MalAlimlari] M
            LEFT JOIN [komur].[dbo].[StokListesi] S ON M.UrunID = S.ID
            ORDER BY M.Tarih DESC
        `);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// --- 3. DÜZENLEME (GÜNCELLEME) API (YEPYENİ EKLENDİ) ---
app.put('/api/mal-alimi/:id', async (req, res) => {
    const { tarih, tedarikci, tedarikciFirma, urunId, miktar, birimFiyat, odeme, aciklama, islemiYapan, paraBirimi, islemKuru, girisMiktar, girisBirimi, toplamBorc } = req.body;
    const alimId = req.params.id;
    const tedarikciAd = tedarikciFirma || tedarikci;
    await ensureMalAlimDovizKolonlari();

    const pb = (paraBirimi === 'USD') ? 'USD' : 'TRY';
    const kur = pb === 'USD' ? (parseFloat(islemKuru) || 0) : 1;
    if (pb === 'USD' && kur <= 0) {
        return res.status(400).json({ hata: 'USD borç için geçerli bir kur girin.' });
    }

    let stokMiktar = parseFloat(miktar) || 0;
    let birimFiyatHesap = parseFloat(birimFiyat) || 0;
    const toplamBorcSayi = parseFloat(toplamBorc);

    try {
        const pool = await sql.connect(config);
        await ensureStokDonusumKolonlari();
        const urunRes = await pool.request()
            .input('u', sql.Int, urunId)
            .query(`SELECT UrunAdi, AdetBasinaKg FROM [komur].[dbo].[StokListesi] WHERE ID = @u`);
        if (!urunRes.recordset.length) {
            return res.status(400).json({ hata: 'Ürün bulunamadı.' });
        }
        const urunAdi = urunRes.recordset[0].UrunAdi;
        const adetKg = urunRes.recordset[0].AdetBasinaKg;
        const { birimTuru: satisBirimi } = parseStokUrunAdi(urunAdi);

        const gMiktar = girisMiktar != null ? parseFloat(girisMiktar) : stokMiktar;
        const gBirim = girisBirimi || satisBirimi;
        if (girisMiktar != null || girisBirimi) {
            stokMiktar = girisMiktarToStokMiktar(gMiktar, gBirim, satisBirimi, adetKg);
        }
        if (stokMiktar <= 0) {
            return res.status(400).json({ hata: 'Geçerli bir miktar girin.' });
        }
        if (toplamBorcSayi > 0) {
            birimFiyatHesap = toplamBorcSayi / stokMiktar;
        } else if (birimFiyatHesap <= 0) {
            return res.status(400).json({ hata: 'Toplam borç veya birim fiyat girin.' });
        }

        const dovizTutar = pb === 'USD' ? (toplamBorcSayi > 0 ? toplamBorcSayi : stokMiktar * birimFiyatHesap) : null;
        const toplamTutar = pb === 'USD'
            ? (toplamBorcSayi > 0 ? toplamBorcSayi * kur : stokMiktar * birimFiyatHesap * kur)
            : (toplamBorcSayi > 0 ? toplamBorcSayi : stokMiktar * birimFiyatHesap);
        const birimMaliyetTl = pb === 'USD' ? birimFiyatHesap * kur : birimFiyatHesap;
        const kayitGirisBirimi = gBirim;
        const kayitGirisMiktar = gMiktar;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const eskiKayit = await transaction.request()
                .input('id', sql.Int, alimId)
                .query(`SELECT UrunID, Miktar FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);
                
            const eskiMiktar = eskiKayit.recordset[0].Miktar;
            const miktarFarki = stokMiktar - eskiMiktar;

            // 2. Faturayı (MalAlimlari) Güncelle
            await transaction.request()
                .input('id', sql.Int, alimId)
                .input('tarih', sql.NVarChar, tarih)
                .input('t', sql.NVarChar, tedarikciAd)
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), stokMiktar)
                .input('b', sql.Decimal(18,2), birimFiyatHesap)
                .input('top', sql.Decimal(18,2), toplamTutar)
                .input('o', sql.NVarChar, odeme)
                .input('a', sql.NVarChar, aciklama)
                .input('pb', sql.NVarChar, pb)
                .input('kur', sql.Decimal(18, 4), kur)
                .input('dt', sql.Decimal(18, 2), dovizTutar)
                .input('gb', sql.NVarChar, kayitGirisBirimi)
                .input('gm', sql.Decimal(18, 2), kayitGirisMiktar)
                .query(`
                    UPDATE [komur].[dbo].[MalAlimlari] SET 
                        Tarih=@tarih, TedarikciFirma=@t, UrunID=@u, Miktar=@m, 
                        BirimMaliyet=@b, ToplamTutar=@top, OdemeDurumu=@o, Aciklama=@a,
                        ParaBirimi=@pb, IslemKuru=@kur, DovizTutar=@dt,
                        GirisBirimi=@gb, GirisMiktar=@gm
                    WHERE ID=@id
                `);

            // 3. Stok Miktarını ve Fiyatını Fark Kadar Düzelt
            await transaction.request()
                .input('u', sql.Int, urunId)
                .input('fark', sql.Decimal(18,2), miktarFarki)
                .input('b', sql.Decimal(18,2), birimMaliyetTl)
                .query(`
                    UPDATE [komur].[dbo].[StokListesi] SET 
                        BaslangicStogu = BaslangicStogu + @fark, 
                        AlisFiyati = @b 
                    WHERE ID = @u
                `);

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { 
        console.error("DÜZENLEME HATASI:", err);
        res.status(500).json({ hata: err.message }); 
    }
});

// --- 4. ALIM SİLME VE STOKTAN DÜŞME API ---
app.delete('/api/mal-alimi/:id', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const alim = await transaction.request()
                .input('id', sql.Int, req.params.id)
                .query(`SELECT UrunID, Miktar FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);

            if (alim.recordset.length > 0) {
                const uId = alim.recordset[0].UrunID;
                const miktar = alim.recordset[0].Miktar;

                await transaction.request()
                    .input('id', sql.Int, req.params.id)
                    .query(`DELETE FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);

                await transaction.request()
                    .input('u', sql.Int, uId)
                    .input('m', sql.Decimal(18,2), miktar)
                    .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = BaslangicStogu - @m WHERE ID = @u`);
            }

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { 
        console.error("ALIM SİLME HATASI:", err);
        res.status(500).json({ hata: err.message }); 
    }
});

// --- TOPTANCI LİSTESİ VE BAKİYE ÇEKME ---
app.get('/api/tedarikciler', async (req, res) => {
    try {
        await ensureMalAlimDovizKolonlari();
        await ensureTedarikciOdemeDovizKolonlari();
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT T.*, 
            (SELECT ISNULL(SUM(ToplamTutar),0) FROM MalAlimlari WHERE TedarikciID = T.ID) - 
            (SELECT ISNULL(SUM(OdenenTutar),0) FROM TedarikciOdemeleri WHERE TedarikciID = T.ID) as Bakiye,
            (SELECT ISNULL(SUM(DovizTutar),0) FROM MalAlimlari WHERE TedarikciID = T.ID AND ParaBirimi = N'USD') -
            (SELECT ISNULL(SUM(DovizTutar),0) FROM TedarikciOdemeleri WHERE TedarikciID = T.ID AND ParaBirimi = N'USD') as ToplamDovizBorc
            FROM Tedarikciler T
        `);
        const guncelKur = await tcmbUsdSatisSayi();
        const kayitlar = result.recordset.map((t) => {
            const dovizBorc = parseFloat(t.ToplamDovizBorc) || 0;
            const bakiye = parseFloat(t.Bakiye) || 0;
            return {
                ...t,
                GuncelUsdKuru: guncelKur,
                GuncelTlKarsiligi: (guncelKur != null && dovizBorc > 0)
                    ? Math.round(dovizBorc * guncelKur * 100) / 100
                    : (bakiye > 0 ? bakiye : null)
            };
        });
        res.json(kayitlar);
    } catch (err) {
        console.error('TEDARIKCI LISTESI HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- YENİ TOPTANCI EKLEME ---
app.post('/api/tedarikci', async (req, res) => {
    const { firmaAdi, yetkili, tel, aciklama } = req.body;
    try {
        const pool = await sql.connect(config);
        await pool.request()
            .input('f', sql.NVarChar, firmaAdi)
            .input('y', sql.NVarChar, yetkili)
            .input('t', sql.NVarChar, tel)
            .input('a', sql.NVarChar, aciklama)
            .query(`INSERT INTO Tedarikciler (FirmaAdi, YetkiliKisi, Telefon, Aciklama) VALUES (@f, @y, @t, @a)`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// --- TOPTANCI HESAP HAREKETLERİ (EKSTRE) API'Sİ ---
// --- TOPTANCI HESAP HAREKETLERİ (EKSTRE) API'Sİ (GÜNCELLENDİ) ---
app.get('/api/tedarikci-hareketleri/:id', async (req, res) => {
    try {
        await ensureMalAlimDovizKolonlari();
        await ensureTedarikciOdemeDovizKolonlari();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT ID, Tur, Tarih, Islem, Miktar, BirimFiyat, Borc, Odeme, Aciklama, ParaBirimi, IslemKuru, DovizTutar,
                    UrunID, OdemeDurumu, AlimBirimi, AdetBasinaKg, UrunAdi, GirisBirimi, GirisMiktar FROM (
                    -- ALIMLAR (Miktar ve Birim Fiyat var)
                    SELECT 
                        M.ID,
                        'ALIM' as Tur,
                        M.Tarih, 
                        'Alım: ' + ISNULL(S.UrunAdi, 'Ürün') as Islem, 
                        M.Miktar as Miktar, 
                        M.BirimMaliyet as BirimFiyat, 
                        M.ToplamTutar as Borc, 
                        0 as Odeme, 
                        M.Aciklama,
                        ISNULL(M.ParaBirimi, N'TRY') as ParaBirimi,
                        ISNULL(M.IslemKuru, 1) as IslemKuru,
                        M.DovizTutar,
                        M.UrunID,
                        M.OdemeDurumu,
                        ISNULL(S.AlimBirimi, N'Ton') as AlimBirimi,
                        S.AdetBasinaKg,
                        S.UrunAdi,
                        M.GirisBirimi,
                        M.GirisMiktar
                    FROM [komur].[dbo].[MalAlimlari] M
                    LEFT JOIN [komur].[dbo].[StokListesi] S ON M.UrunID = S.ID
                    WHERE M.TedarikciID = @id

                    UNION ALL

                    -- ÖDEMELER (Miktar ve Birim Fiyat boştur, 0 yazarız)
                    SELECT 
                        ID,
                        'ODEME' as Tur,
                        Tarih, 
                        'Ödeme (' + OdemeTuru + ')' as Islem, 
                        NULL as Miktar, 
                        NULL as BirimFiyat, 
                        0 as Borc, 
                        OdenenTutar as Odeme, 
                        Aciklama,
                        ISNULL(ParaBirimi, N'TRY') as ParaBirimi,
                        ISNULL(IslemKuru, 1) as IslemKuru,
                        DovizTutar,
                        NULL as UrunID,
                        NULL as OdemeDurumu,
                        NULL as AlimBirimi,
                        NULL as AdetBasinaKg,
                        NULL as UrunAdi,
                        NULL as GirisBirimi,
                        NULL as GirisMiktar
                    FROM [komur].[dbo].[TedarikciOdemeleri]
                    WHERE TedarikciID = @id
                ) AS Hareketler
                ORDER BY Tarih ASC
            `);
        const guncelKur = await tcmbUsdSatisSayi();
        res.json({ hareketler: result.recordset, guncelUsdKuru: guncelKur });
    } catch (err) { res.status(500).json({ hata: err.message }); }
});// --- ÜRÜNE ÖZEL MAL ALIM GEÇMİŞİ API'Sİ ---
app.get('/api/urun-alimlari/:id', async (req, res) => {
    try {
        await ensureMalAlimDovizKolonlari();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT TOP 50
                    M.ID, M.Tarih, 
                    ISNULL(M.TedarikciFirma, N'Bilinmeyen Toptancı') as Firma, 
                    M.Miktar, 
                    M.BirimMaliyet as Fiyat,
                    M.ToplamTutar,
                    ISNULL(M.ParaBirimi, N'TRY') as ParaBirimi,
                    ISNULL(M.IslemKuru, 1) as IslemKuru,
                    M.DovizTutar,
                    M.GirisBirimi,
                    M.GirisMiktar,
                    ISNULL(S.AlimBirimi, N'Ton') as AlimBirimi,
                    S.AdetBasinaKg,
                    S.UrunAdi
                FROM [komur].[dbo].[MalAlimlari] M
                LEFT JOIN [komur].[dbo].[StokListesi] S ON M.UrunID = S.ID
                WHERE M.UrunID = @id 
                ORDER BY M.Tarih DESC
            `);
        const guncelKur = await tcmbUsdSatisSayi();
        res.json({ alimlar: result.recordset, guncelUsdKuru: guncelKur });
    } catch (err) { 
        console.error("Geçmiş Çekme Hatası:", err);
        res.status(500).json({ hata: err.message }); 
    }
});
// --- KÖMÜR ÇUVALLAMA / STOK TRANSFER API'Sİ ---
app.post('/api/stok-paketleme', async (req, res) => {
    const { kaynakUrunId, eksilenMiktar, hedefUrunId, artanMiktar } = req.body;

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Kaynak (Dökme) üründen stoğu düş
            await transaction.request()
                .input('id', sql.Int, kaynakUrunId)
                .input('m', sql.Decimal(18,2), eksilenMiktar)
                .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = BaslangicStogu - @m WHERE ID = @id`);

            // 2. Hedef (Çuvallı) ürüne stoğu ekle
            await transaction.request()
                .input('id', sql.Int, hedefUrunId)
                .input('m', sql.Decimal(18,2), artanMiktar)
                .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = BaslangicStogu + @m WHERE ID = @id`);

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { 
        console.error("PAKETLEME HATASI:", err);
        res.status(500).json({ hata: err.message }); 
    }
});

// --- TOPTANCI ÖDEME KAYDETME API'Sİ ---
// --- TOPTANCI ÖDEME KAYDETME API'Sİ ---
app.post('/api/tedarikci-odeme', async (req, res) => {
    const { tedarikciId, tarih, tutar, tur, aciklama, paraBirimi, islemKuru } = req.body;
    await ensureTedarikciOdemeDovizKolonlari();
    
    const islemTarihi = tarih || new Date().toISOString().split('T')[0];
    const pb = (paraBirimi === 'USD') ? 'USD' : 'TRY';
    const kur = pb === 'USD' ? (parseFloat(islemKuru) || 0) : 1;
    const tutarSayi = parseFloat(tutar) || 0;
    if (tutarSayi <= 0) return res.status(400).json({ hata: 'Geçerli bir tutar girin.' });
    if (pb === 'USD' && kur <= 0) return res.status(400).json({ hata: 'USD ödeme için geçerli bir kur girin.' });

    const dovizTutar = pb === 'USD' ? tutarSayi : null;
    const odenenTl = pb === 'USD' ? Math.round(tutarSayi * kur * 100) / 100 : tutarSayi;

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await transaction.request()
                .input('tId', sql.Int, tedarikciId)
                .input('tar', sql.NVarChar, islemTarihi)
                .input('tut', sql.Decimal(18,2), odenenTl)
                .input('tur', sql.NVarChar, tur)
                .input('aci', sql.NVarChar, aciklama)
                .input('pb', sql.NVarChar, pb)
                .input('kur', sql.Decimal(18, 4), kur)
                .input('dt', sql.Decimal(18, 2), dovizTutar)
                .query(`INSERT INTO [komur].[dbo].[TedarikciOdemeleri] (TedarikciID, Tarih, OdenenTutar, OdemeTuru, Aciklama, ParaBirimi, IslemKuru, DovizTutar) 
                        VALUES (@tId, @tar, @tut, @tur, @aci, @pb, @kur, @dt)`);
            
            // ... (Aşağıdaki kodlar aynı kalacak) ...

            // 2. Eğer ödeme NAKİT ise kasadan düş (Opsiyonel: Kasa sistemin varsa buraya ekleriz)

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// =========================================================
// ⚙️ TANIMLAMALAR VE AYARLAR API'Sİ
// =========================================================
app.get('/api/ayarlar', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query("SELECT Anahtar, Deger FROM [komur].[dbo].[Ayarlar]");
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

app.post('/api/ayar-guncelle', async (req, res) => {
    const { anahtar, deger } = req.body;
    try {
        const pool = await sql.connect(config);
        // Varsa güncelle, yoksa yeni ayar olarak ekle
        const check = await pool.request().input('anahtar', sql.NVarChar, anahtar).query("SELECT * FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = @anahtar");
        if (check.recordset.length > 0) {
            await pool.request().input('anahtar', sql.NVarChar, anahtar).input('deger', sql.NVarChar, String(deger)).query("UPDATE [komur].[dbo].[Ayarlar] SET Deger = @deger WHERE Anahtar = @anahtar");
        } else {
            await pool.request().input('anahtar', sql.NVarChar, anahtar).input('deger', sql.NVarChar, String(deger)).query("INSERT INTO [komur].[dbo].[Ayarlar] (Anahtar, Deger) VALUES (@anahtar, @deger)");
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

// =========================================================
// 🖨️ AKILLI NUMARATÖRLÜ MAKBUZLU ÖDEME API'Sİ
// =========================================================
app.post('/api/musteri-odeme-makbuzlu', async (req, res) => {
    const { musteriId, tutar, odemeTuru, aciklama, tarih, islemiYapan, islemBakiyesi, apartmanUygula } = req.body;

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin(); 

        try {
            // --- 1. TEK ŞALTER KONTROLÜ (Otomatik Yazdırma Şalterine Bakar) ---
            const ayarRes = await transaction.request()
                .query("SELECT Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = 'MakbuzOtomatikYazdir'");
            
            // Eğer ayar 'false' ise (yani Kapalıysa) numara üretmeyi DURDURUR
            const makbuzSistemiAcik = (ayarRes.recordset.length === 0 || ayarRes.recordset[0].Deger !== 'false');

            let formatliMakbuzNo = null;

            if (makbuzSistemiAcik) {
                // Şalter açıksa numara üretme mantığı çalışır
                const basNoRes = await transaction.request()
                    .query("SELECT Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = 'MakbuzBaslangicNo'");
                
                let baslangicNo = (basNoRes.recordset.length > 0) ? parseInt(basNoRes.recordset[0].Deger) : 1;

                const maxRes = await transaction.request().query(`
                    SELECT MAX(CAST(MakbuzNo AS INT)) as MaxNo 
                    FROM [komur].[dbo].[MusteriHareket] 
                    WHERE MakbuzNo IS NOT NULL AND ISNUMERIC(MakbuzNo) = 1
                `);
                
                let dbEnYuksekNo = maxRes.recordset[0].MaxNo || 0;
                let yeniMakbuzNo = Math.max(baslangicNo, dbEnYuksekNo + 1);
                formatliMakbuzNo = String(yeniMakbuzNo).padStart(6, '0');
            }

            // 2. Kaydı Yap (Şalter kapalıysa formatliMakbuzNo NULL gider)
            const insMakbuz = await transaction.request()
                .input('mId', sql.Int, musteriId)
                .input('tut', sql.Decimal(18, 2), tutar)
                .input('tur', sql.NVarChar, odemeTuru)
                .input('aci', sql.NVarChar, aciklama)
                .input('tar', sql.NVarChar, tarih)
                .input('mNo', sql.NVarChar, formatliMakbuzNo)
                .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                .input('bak', sql.Decimal(18, 2), islemBakiyesi || 0) 
                .query(`INSERT INTO [komur].[dbo].[MusteriHareket] 
                        (Kisi, ÖDEME, AÇIKLAMA, TARİH, YIL, MakbuzNo, IslemiYapan, ISLEM_BAKIYESI) 
                        OUTPUT INSERTED.Kimlik
                        VALUES (@mId, @tut, @aci, @tar, YEAR(GETDATE()), @mNo, @yapan, @bak)`);
            const yeniHareketId = insMakbuz.recordset?.[0]?.Kimlik || null;

            await transaction.commit();
            let apartmanOdeme = null;
            if (apartmanUygula !== false) {
                try {
                    apartmanOdeme = await apartmanOdemeKgIsle(pool, musteriId, tutar, islemiYapan, odemeTuru);
                    if (yeniHareketId && apartmanOdeme && apartmanOdeme.islenen > 0) {
                        const kurTxt = apartmanOdeme.kur
                            ? `Anlık USD: ${Number(apartmanOdeme.kur).toLocaleString('tr-TR', { minimumFractionDigits: 4 })} · Ö.USD: ${Number(apartmanOdeme.odenenUsd || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} · ${apartmanOdeme.kgDusen} kg · ${apartmanOdeme.tonFiyat || '—'} USD/ton`
                            : `Apartman: ${apartmanOdeme.kgDusen} kg`;
                        await pool.request()
                            .input('id', sql.Int, yeniHareketId)
                            .input('not', sql.NVarChar, kurTxt)
                            .query(`UPDATE [komur].[dbo].[MusteriHareket] SET birimtür = 'APT', notlar = CASE WHEN notlar IS NULL OR notlar = '' THEN @not ELSE notlar + N' | ' + @not END WHERE Kimlik = @id`);
                    }
                } catch (aptErr) {
                    console.warn('Apartman kg ödeme (makbuzlu):', aptErr.message);
                }
            }
            res.json({ success: true, makbuzNo: formatliMakbuzNo, apartmanKg: apartmanOdeme });

        } catch (err) {
            await transaction.rollback(); 
            throw err;
        }
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

// =========================================================
// 🗑️ TEDARİKÇİ HAREKETİ SİLME API'Sİ
// =========================================================
// =========================================================
// 🗑️ TEDARİKÇİ HAREKETİ SİLME & STOK DÜŞME MOTORU
// =========================================================
// =========================================================
// 🗑️ TEDARİKÇİ HAREKETİ SİLME & STOK DÜŞME MOTORU
// =========================================================
app.delete('/api/tedarikci-hareket/:id', async (req, res) => {
    const islemId = req.params.id;
    const islemTuru = req.query.tur; // 'ALIM' veya 'ODEME'

    if (!islemId || islemId === 'undefined' || !islemTuru) {
        return res.status(400).json({ hata: "Geçersiz işlem bilgileri." });
    }

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            if (islemTuru === 'ALIM') {
                // --- ALIM İPTALİ (Stoktan düşürülür) ---
                const alimRes = await transaction.request()
                    .input('id', sql.Int, parseInt(islemId))
                    .query(`SELECT UrunID, Miktar FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);

                if (alimRes.recordset.length > 0) {
                    const { UrunID, Miktar } = alimRes.recordset[0];
                    
                    await transaction.request().input('id', sql.Int, parseInt(islemId))
                        .query(`DELETE FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);

                    if (UrunID && Miktar > 0) {
    await transaction.request()
        .input('u', sql.Int, UrunID)
        .input('m', sql.Decimal(18,2), Miktar)
        .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = BaslangicStogu - @m WHERE ID = @u`);
}
                }
            } else if (islemTuru === 'ODEME') {
                // --- ÖDEME İPTALİ (Sadece kayıt silinir, stokla işi yok) ---
                await transaction.request()
                    .input('id', sql.Int, parseInt(islemId))
                    .query(`DELETE FROM [komur].[dbo].[TedarikciOdemeleri] WHERE ID = @id`);
            }

            await transaction.commit();
            res.json({ success: true, mesaj: "İşlem silindi." });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("🔥 Silme Hatası:", err);
        res.status(500).json({ hata: err.message });
    }
});

app.get('/api/musteri-detay/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await sql.connect(config);
        const request = pool.request();

        // 1. Müşteri kartı (tam tablo adı — diğer API'ler ile aynı)
        const musteriSonuc = await request
            .input('id', sql.Int, id)
            .query('SELECT Kimlik, Adı, Unvan, CEPTEL FROM [komur].[dbo].[Kimlik] WHERE Kimlik = @id');

        if (musteriSonuc.recordset.length === 0) {
            return res.status(404).json({ hata: "Müşteri bulunamadı" });
        }

        const musteri = musteriSonuc.recordset[0];

        // 2. Müşteri hareketleri
        const hareketSonuc = await request
            .input('kisiId', sql.Int, id)
            .query(`
                SELECT 
                    Kimlik as ID, 
                    TARİH, 
                    AÇIKLAMA, 
                    ADET, 
                    BİRİM, 
                    BORÇ, 
                    ÖDEME, 
                    ISLEM_BAKIYESI 
                FROM [komur].[dbo].[MusteriHareket] 
                WHERE Kisi = @kisiId 
                ORDER BY TARİH DESC
            `);

        const hareketler = hareketSonuc.recordset || [];

        // 3. Toplamları Hesapla (Sütun isimlerini BORÇ ve ÖDEME olarak güncelledik)
        const toplamBorc = hareketler.reduce((sum, h) => sum + (Number(h.BORÇ) || 0), 0);
        const toplamOdeme = hareketler.reduce((sum, h) => sum + (Number(h.ÖDEME) || 0), 0);

        res.json({
            ...musteri,
            ToplamBorc: toplamBorc,
            ToplamOdenen: toplamOdeme,
            Bakiye: (toplamBorc - toplamOdeme),
            hareketler: hareketler
        });

    } catch (err) {
        console.error("SQL HATASI:", err.message);
        res.status(500).json({ hata: "Veritabanı Hatası: " + err.message });
    }
});

app.get('/api/sistem-loglari', (req, res) => {
    try {
        res.json({ kayitlar: sistemLoglari, toplam: sistemLoglari.length });
    } catch (e) {
        res.status(500).json({ hata: String(e.message || e) });
    }
});

// --- Müşteri cari notları ---
app.get('/api/musteri-notlar/:musteriId', async (req, res) => {
    const musteriId = parseInt(req.params.musteriId, 10);
    if (!Number.isFinite(musteriId)) {
        return res.status(400).json({ hata: 'Geçersiz müşteri' });
    }
    try {
        await ensureMusteriNotlariTablosu();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('mid', sql.Int, musteriId)
            .query(`
                SELECT Id, MusteriKimlik, NotMetni, OlusturanKullaniciAdi, OlusturanAdSoyad, UyariAcik, OlusturmaZamani
                FROM [komur].[dbo].[MusteriNotlari]
                WHERE MusteriKimlik = @mid
                ORDER BY OlusturmaZamani DESC
            `);
        res.json({ notlar: result.recordset || [] });
    } catch (err) {
        console.error('musteri-notlar GET:', err);
        res.status(500).json({ hata: err.message || 'Notlar okunamadı' });
    }
});

app.post('/api/musteri-notlar/:musteriId', async (req, res) => {
    const musteriId = parseInt(req.params.musteriId, 10);
    const metin = String(req.body?.metin || '').trim();
    const kullaniciAdi = String(req.body?.kullaniciAdi || '').trim() || null;
    const adSoyad = String(req.body?.adSoyad || '').trim() || null;
    const uyariAcikBody = req.body?.uyariAcik;
    const uyariAcik = uyariAcikBody === false || uyariAcikBody === 0 || uyariAcikBody === '0' ? 0 : 1;
    if (!Number.isFinite(musteriId)) {
        return res.status(400).json({ hata: 'Geçersiz müşteri' });
    }
    if (!metin) {
        return res.status(400).json({ hata: 'Not metni boş olamaz' });
    }
    if (metin.length > 8000) {
        return res.status(400).json({ hata: 'Not çok uzun (en fazla 8000 karakter)' });
    }
    try {
        await ensureMusteriNotlariTablosu();
        const pool = await sql.connect(config);
        await pool.request()
            .input('mid', sql.Int, musteriId)
            .input('metin', sql.NVarChar(sql.MAX), metin)
            .input('kadi', sql.NVarChar(120), kullaniciAdi)
            .input('adsoyad', sql.NVarChar(200), adSoyad)
            .input('uyari', sql.Bit, uyariAcik)
            .query(`
                INSERT INTO [komur].[dbo].[MusteriNotlari] (MusteriKimlik, NotMetni, OlusturanKullaniciAdi, OlusturanAdSoyad, UyariAcik)
                VALUES (@mid, @metin, @kadi, @adsoyad, @uyari)
            `);
        res.status(201).json({ mesaj: 'Not kaydedildi' });
    } catch (err) {
        console.error('musteri-notlar POST:', err);
        res.status(500).json({ hata: err.message || 'Not kaydedilemedi' });
    }
});

app.patch('/api/musteri-not/:notId', async (req, res) => {
    const notId = parseInt(req.params.notId, 10);
    const uyariAcikRaw = req.body?.uyariAcik;
    if (!Number.isFinite(notId)) {
        return res.status(400).json({ hata: 'Geçersiz not' });
    }
    if (uyariAcikRaw === undefined || uyariAcikRaw === null) {
        return res.status(400).json({ hata: 'uyariAcik gerekli' });
    }
    const uyariAcik =
        uyariAcikRaw === true || uyariAcikRaw === 1 || uyariAcikRaw === '1' ? 1 : 0;
    try {
        await ensureMusteriNotlariTablosu();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, notId)
            .input('u', sql.Bit, uyariAcik)
            .query('UPDATE [komur].[dbo].[MusteriNotlari] SET UyariAcik = @u WHERE Id = @id');
        const n = result.rowsAffected && result.rowsAffected[0] ? result.rowsAffected[0] : 0;
        if (!n) {
            return res.status(404).json({ hata: 'Not bulunamadı' });
        }
        res.json({ mesaj: 'Güncellendi' });
    } catch (err) {
        console.error('musteri-not PATCH:', err);
        res.status(500).json({ hata: err.message || 'Güncellenemedi' });
    }
});

app.delete('/api/musteri-not/:notId', async (req, res) => {
    const notId = parseInt(req.params.notId, 10);
    if (!Number.isFinite(notId)) {
        return res.status(400).json({ hata: 'Geçersiz not' });
    }
    try {
        await ensureMusteriNotlariTablosu();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, notId)
            .query('DELETE FROM [komur].[dbo].[MusteriNotlari] WHERE Id = @id');
        const n = result.rowsAffected && result.rowsAffected[0] ? result.rowsAffected[0] : 0;
        if (!n) {
            return res.status(404).json({ hata: 'Not bulunamadı' });
        }
        res.json({ mesaj: 'Silindi' });
    } catch (err) {
        console.error('musteri-not DELETE:', err);
        res.status(500).json({ hata: err.message || 'Not silinemedi' });
    }
});

// =========================================================
// 🏢 APARTMAN (TOPLU SATIŞ) MODÜLÜ
// =========================================================
let apartmanTablolariHazir = false;
async function ensureApartmanTablolari() {
    if (apartmanTablolariHazir) return;
    const pool = await sql.connect(config);
    await pool.request().query(`
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[Apartmanlar]') AND type in (N'U'))
BEGIN
    CREATE TABLE [komur].[dbo].[Apartmanlar] (
        [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [Ad] NVARCHAR(200) NOT NULL,
        [Il] NVARCHAR(100) NULL,
        [Ilce] NVARCHAR(100) NULL,
        [Mahalle] NVARCHAR(150) NULL,
        [Adres] NVARCHAR(400) NULL,
        [SorumluAd] NVARCHAR(200) NULL,
        [SorumluTel] NVARCHAR(30) NULL,
        [Aciklama] NVARCHAR(MAX) NULL,
        [OlusturmaZamani] DATETIME2(3) NOT NULL CONSTRAINT DF_Apartmanlar_Zaman DEFAULT (SYSUTCDATETIME())
    );
END
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
BEGIN
    CREATE TABLE [komur].[dbo].[ApartmanDaireler] (
        [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [ApartmanId] INT NOT NULL,
        [Blok] NVARCHAR(50) NULL,
        [DaireNo] NVARCHAR(50) NULL,
        [Sira] INT NULL,
        [MusteriKimlik] INT NULL,
        [UrunID] INT NULL,
        [AnlasilanMiktar] DECIMAL(18,2) NOT NULL CONSTRAINT DF_ApartmanDaireler_Anlasilan DEFAULT (0),
        [Birim] NVARCHAR(20) NULL,
        [BirimFiyat] DECIMAL(18,6) NULL,
        [TeslimEdilen] DECIMAL(18,2) NOT NULL CONSTRAINT DF_ApartmanDaireler_Teslim DEFAULT (0),
        [Aciklama] NVARCHAR(400) NULL,
        [OlusturmaZamani] DATETIME2(3) NOT NULL CONSTRAINT DF_ApartmanDaireler_Zaman DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_ApartmanDaireler_Apartman ON [komur].[dbo].[ApartmanDaireler]([ApartmanId]);
END
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND type in (N'U'))
BEGIN
    CREATE TABLE [komur].[dbo].[ApartmanTeslimatlar] (
        [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [DaireId] INT NOT NULL,
        [Miktar] DECIMAL(18,2) NOT NULL,
        [Tarih] NVARCHAR(30) NULL,
        [MusteriHareketId] INT NULL,
        [MakbuzNo] NVARCHAR(20) NULL,
        [IslemiYapan] NVARCHAR(120) NULL,
        [OlusturmaZamani] DATETIME2(3) NOT NULL CONSTRAINT DF_ApartmanTeslimatlar_Zaman DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_ApartmanTeslimatlar_Daire ON [komur].[dbo].[ApartmanTeslimatlar]([DaireId]);
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND name = N'MakbuzNo')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanTeslimatlar] ADD [MakbuzNo] NVARCHAR(20) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND name = N'TeslimatGrup')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanTeslimatlar] ADD [TeslimatGrup] NVARCHAR(40) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanTeslimatlar]') AND name = N'Blok')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanTeslimatlar] ADD [Blok] NVARCHAR(50) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'AnlasmaMakbuzNo')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [AnlasmaMakbuzNo] NVARCHAR(20) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'DaireTipi')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [DaireTipi] NVARCHAR(20) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'ParaBirimi')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [ParaBirimi] NVARCHAR(5) NOT NULL CONSTRAINT DF_AptDaire_Para DEFAULT ('TRY');
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'TonFiyat')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [TonFiyat] DECIMAL(18,4) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'KalanBorcKg')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [KalanBorcKg] DECIMAL(18,2) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'AnlasmaKuru')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [AnlasmaKuru] DECIMAL(18,4) NULL;
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'OdenenTl')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [OdenenTl] DECIMAL(18,2) NOT NULL CONSTRAINT DF_AptDaire_Odenen DEFAULT (0);
END
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]') AND name = N'AnlasmaTarihi')
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ADD [AnlasmaTarihi] DATETIME2 NULL;
END
-- BirimFiyat DECIMAL(18,2) idi: 0.295 USD/kg → 0.30 yuvarlanıyordu (295$/ton borç şişiyordu)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[komur].[dbo].[ApartmanDaireler]')
      AND name = N'BirimFiyat' AND scale < 4
)
BEGIN
    ALTER TABLE [komur].[dbo].[ApartmanDaireler] ALTER COLUMN [BirimFiyat] DECIMAL(18,6) NULL;
END
    `);
    apartmanTablolariHazir = true;
}

async function tcmbUsdSatisKuruGetir() {
    try {
        const gunluk = await tcmbGunlukDovizXmldenGunluk();
        const kur = tcmbReferansSatis(gunluk.usd);
        if (kur != null && kur > 0) return kur;
    } catch (_) { /* devam */ }
    try {
        const onceki = await tcmbGunlukOncekiIsGunuDoviz();
        if (onceki) {
            const kur = tcmbReferansSatis(onceki.usd);
            if (kur != null && kur > 0) return kur;
        }
    } catch (_) { /* devam */ }
    return null;
}

function apartmanKgFiyatFromTon(tonFiyat) {
    const t = parseFloat(tonFiyat);
    if (!t || t <= 0) return 0;
    return t / 1000;
}

/** Kg birim fiyat: TonFiyat varsa ondan hesapla (BirimFiyat eski 2 hane yüzünden yuvarlanmış olabilir). */
function apartmanDaireKgFiyat(d) {
    if (!d) return 0;
    const tonFiyat = parseFloat(d.TonFiyat) || 0;
    if (tonFiyat > 0) return apartmanKgFiyatFromTon(tonFiyat);
    return parseFloat(d.BirimFiyat) || 0;
}

function apartmanBorcTlHesapla(kalanKg, kgFiyat, paraBirimi, usdKur) {
    const kg = parseFloat(kalanKg) || 0;
    const f = parseFloat(kgFiyat) || 0;
    if (kg <= 0 || f <= 0) return 0;
    const pb = String(paraBirimi || 'TRY').toUpperCase();
    if (pb === 'USD') {
        const kur = parseFloat(usdKur) || 0;
        if (kur <= 0) return 0;
        return Math.round(kg * f * kur * 100) / 100;
    }
    return Math.round(kg * f * 100) / 100;
}

function sqlYilFromTarihStr(tarihStr) {
    const m = String(tarihStr || '').match(/^(\d{4})/);
    return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

function sqlTarihDateObj(tarihStr) {
    const s = String(tarihStr || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return new Date();
}

/** Satış akışıyla aynı: yeni makbuz numarası üret */
async function yeniMakbuzNoAl(exec) {
    const maxRes = await exec.request().query(`
        SELECT MAX(CAST(MakbuzNo AS INT)) AS MaxNo
        FROM [komur].[dbo].[MusteriHareket]
        WHERE MakbuzNo IS NOT NULL AND ISNUMERIC(MakbuzNo) = 1
    `);
    const yeniNo = ((maxRes.recordset[0] && maxRes.recordset[0].MaxNo) || 0) + 1;
    return String(yeniNo).padStart(6, '0');
}

/**
 * Yetim apartman anlaşma satırlarını temizler: hiçbir dairenin AnlasmaMakbuzNo'su
 * ile eşleşmeyen "Apartman anlaşması" hareketleri silinir (eski/mükerrer kayıtlar).
 */
async function apartmanYetimBorcSatirlariTemizle(pool) {
    try {
        await pool.request().query(`
            DELETE FROM [komur].[dbo].[MusteriHareket]
            WHERE notlar LIKE N'%Apartman anlaşması%'
              AND (
                    MakbuzNo IS NULL
                    OR MakbuzNo NOT IN (
                        SELECT AnlasmaMakbuzNo FROM [komur].[dbo].[ApartmanDaireler]
                        WHERE AnlasmaMakbuzNo IS NOT NULL
                    )
              )
        `);
    } catch (e) {
        console.warn('Yetim apartman borç satırı temizleme:', e.message);
    }
}

/** Günlük listede 'bugüne kaymış' anlaşma tarihlerini bir kez onarır (AnlasmaTarihi boş olanlar). */
async function apartmanAnlasmaTarihleriniOnar(pool) {
    try {
        const rows = await pool.request().query(`
            SELECT Id FROM [komur].[dbo].[ApartmanDaireler]
            WHERE AnlasmaMakbuzNo IS NOT NULL
              AND AnlasmaTarihi IS NULL
              AND MusteriKimlik IS NOT NULL
              AND AnlasilanMiktar > 0
        `);
        const liste = rows.recordset || [];
        if (!liste.length) return;
        console.log(`Apartman anlaşma tarihi onarımı: ${liste.length} daire`);
        for (const row of liste) {
            try {
                await daireAnlasmaBorcEsitle(pool, row.Id, 'Sistem');
            } catch (e) {
                console.warn(`Apartman tarih onarım daire ${row.Id}:`, e.message);
            }
        }
    } catch (e) {
        console.warn('Apartman anlaşma tarihi onarımı:', e.message);
    }
}

/**
 * Apartman daire anlaşması → müşteri carisine borç yazar/günceller/siler.
 * Miktar her zaman kg; borç = KalanBorcKg × kg fiyat (USD ise güncel kur ile TL).
 * ÖNEMLİ: Mevcut borç satırı güncellenirken TARİH değiştirilmez (günlük listede "bugüne kayma" olmaz).
 */
async function daireAnlasmaBorcEsitle(pool, daireId, islemiYapan, usdKurHarici) {
    await ensureStokDonusumKolonlari();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const dRes = await tx.request().input('id', sql.Int, daireId).query(`
            SELECT D.*, A.Ad AS ApartmanAd
            FROM [komur].[dbo].[ApartmanDaireler] D
            INNER JOIN [komur].[dbo].[Apartmanlar] A ON D.ApartmanId = A.Id
            WHERE D.Id = @id
        `);
        if (!dRes.recordset.length) {
            await tx.commit();
            return { ok: false, mesaj: 'Daire yok' };
        }
        const d = dRes.recordset[0];

        const urunRes = await tx.request().input('uid', sql.Int, d.UrunID)
            .query(`SELECT UrunAdi, AdetBasinaKg FROM [komur].[dbo].[StokListesi] WHERE ID = @uid`);
        const urunRow = urunRes.recordset.length ? urunRes.recordset[0] : null;
        const urunAdiHam = urunRow ? urunRow.UrunAdi : 'Kömür';

        let anlasilanKg = parseFloat(d.AnlasilanMiktar) || 0;
        let kalanKg = d.KalanBorcKg != null ? parseFloat(d.KalanBorcKg) : anlasilanKg;
        const tonFiyat = parseFloat(d.TonFiyat) || 0;
        let kgFiyat = apartmanDaireKgFiyat(d);

        const birimHam = String(d.Birim || '').toLowerCase();
        if (birimHam === 'adet' && !d.TonFiyat) {
            const adetKg = parseFloat(urunRow?.AdetBasinaKg) || 25;
            if (adetKg > 0) {
                anlasilanKg = Math.round(anlasilanKg * adetKg * 100) / 100;
                if (d.KalanBorcKg == null) kalanKg = anlasilanKg;
                else kalanKg = Math.round(kalanKg * adetKg * 100) / 100;
                if (kgFiyat > 0) kgFiyat = Math.round((kgFiyat / adetKg) * 1000000) / 1000000;
            }
        }

        if (!Number.isFinite(kalanKg) || kalanKg < 0) kalanKg = 0;
        if (kalanKg > anlasilanKg) kalanKg = anlasilanKg;

        const paraBirimi = String(d.ParaBirimi || 'TRY').toUpperCase();
        const { temizAd } = parseStokUrunAdi(urunAdiHam);

        let usdKur = usdKurHarici;
        if (paraBirimi === 'USD') {
            // Öncelik GÜNLÜK kur: USD borç her gün güncel kurla TL'ye çevrilir.
            // AnlasmaKuru yalnızca TCMB'ye ulaşılamazsa yedek olarak kullanılır.
            usdKur = parseFloat(usdKur) || await tcmbUsdSatisKuruGetir() || parseFloat(d.AnlasmaKuru);
        }

        const odenenTl = parseFloat(d.OdenenTl) || 0;
        const kalanTutar = apartmanBorcTlHesapla(kalanKg, kgFiyat, paraBirimi, usdKur);
        // Borç satırı = kalan (güncel kur) + şimdiye kadar ödenen TL.
        // ÖDEME satırları bu tutarı düşürür → net bakiye = kalan borç. Çift sayım olmaz.
        const tutar = Math.round((kalanTutar + odenenTl) * 100) / 100;
        const borcGerekli = d.MusteriKimlik && d.UrunID && anlasilanKg > 0 && kgFiyat > 0 && (kalanKg > 0 || odenenTl > 0);

        if (!borcGerekli) {
            if (d.AnlasmaMakbuzNo) {
                await tx.request().input('mNo', sql.NVarChar, d.AnlasmaMakbuzNo)
                    .query(`DELETE FROM [komur].[dbo].[MusteriHareket] WHERE MakbuzNo = @mNo`);
            }
            await tx.request().input('id', sql.Int, daireId)
                .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET AnlasmaMakbuzNo = NULL, AnlasmaTarihi = NULL WHERE Id = @id`);
            await tx.commit();
            return { ok: true, borc: 0, makbuzNo: null, kalanKg };
        }

        const daireEtiket = `${d.Blok ? d.Blok + ' Blok ' : ''}D:${d.DaireNo || ''}${d.DaireTipi ? ' (' + d.DaireTipi + ')' : ''}`.trim();
        const fiyatEtiket = paraBirimi === 'USD'
            ? `${tonFiyat || (kgFiyat * 1000)} USD/ton (${kgFiyat.toFixed(4)} USD/kg)`
            : `${tonFiyat || (kgFiyat * 1000)} ₺/ton (${kgFiyat.toFixed(4)} ₺/kg)`;
        const kalanBilgi = (kalanKg > 0 && kalanKg < anlasilanKg - 0.01) ? ` · kalan borç ${Math.round(kalanKg * 100) / 100} kg` : '';
        const aciklama = `${temizAd} · ${d.ApartmanAd || 'Apartman'} ${daireEtiket} · ${anlasilanKg} kg · ${fiyatEtiket}${kalanBilgi}`;
        const adetInt = Math.round(anlasilanKg);
        const kalanBorcGoster = Math.round(kalanKg * 100) / 100;
        const teslimDurumu = kalanBorcGoster <= 0.001 ? 'Teslim Edildi' : 'Bekliyor';

        // Mevcut cari satırı: tutarı güncelle, TARİH'e dokunma
        let mevcutKimlik = null;
        let mevcutTarihStr = null;
        if (d.AnlasmaMakbuzNo) {
            const eskiRes = await tx.request().input('mNo', sql.NVarChar, d.AnlasmaMakbuzNo).query(`
                SELECT TOP 1 Kimlik, CONVERT(varchar(19), TARİH, 120) AS TarihStr
                FROM [komur].[dbo].[MusteriHareket]
                WHERE MakbuzNo = @mNo
            `);
            if (eskiRes.recordset[0]) {
                mevcutKimlik = eskiRes.recordset[0].Kimlik;
                mevcutTarihStr = eskiRes.recordset[0].TarihStr || null;
            }
        }

        // Sabit anlaşma tarihi: bir kez kilitlenir, sonraki eşitlemeler kaydırmaz
        let anlasmaTarihStr = null;
        if (d.AnlasmaTarihi) {
            anlasmaTarihStr = normalizeIslemTarihiStr(
                d.AnlasmaTarihi instanceof Date
                    ? istanbulSimdiSqlStr(d.AnlasmaTarihi)
                    : d.AnlasmaTarihi
            );
        } else if (mevcutTarihStr) {
            anlasmaTarihStr = normalizeIslemTarihiStr(mevcutTarihStr);
            // Daha önce her eşitlemede "bugün"e kaymış olabilir → daire oluşturma gününe geri al
            if (d.OlusturmaZamani) {
                const olusturmaStr = istanbulSimdiSqlStr(new Date(d.OlusturmaZamani));
                const bugunStr = istanbulSimdiSqlStr().slice(0, 10);
                if (anlasmaTarihStr.slice(0, 10) === bugunStr && olusturmaStr.slice(0, 10) < bugunStr) {
                    anlasmaTarihStr = olusturmaStr;
                }
            }
        } else if (d.OlusturmaZamani && d.AnlasmaMakbuzNo) {
            anlasmaTarihStr = istanbulSimdiSqlStr(new Date(d.OlusturmaZamani));
        } else {
            anlasmaTarihStr = normalizeIslemTarihiStr(new Date());
        }
        const tarihObj = sqlTarihDateObj(anlasmaTarihStr);
        const yil = sqlYilFromTarihStr(anlasmaTarihStr);

        if (mevcutKimlik) {
            const tarihKilitli = !!d.AnlasmaTarihi;
            const reqUp = tx.request()
                .input('kid', sql.Int, mevcutKimlik)
                .input('kisi', sql.Int, d.MusteriKimlik)
                .input('aciklama', sql.NVarChar, aciklama)
                .input('miktar', sql.Int, adetInt)
                .input('tutar', sql.Decimal(18, 2), tutar)
                .input('yil', sql.Int, yil)
                .input('birimTur', sql.NVarChar, 'Kg')
                .input('islemiYapan', sql.NVarChar, islemiYapan || 'Sistem')
                .input('durum', sql.NVarChar, teslimDurumu)
                .input('kalan', sql.Float, kalanBorcGoster);
            if (!tarihKilitli) reqUp.input('tarih', sql.DateTime2, tarihObj);
            await reqUp.query(tarihKilitli ? `
                    UPDATE [komur].[dbo].[MusteriHareket]
                    SET Kisi = @kisi, YIL = @yil, AÇIKLAMA = @aciklama, ADET = @miktar,
                        BORÇ = @tutar, TeslimDurumu = @durum,
                        KalanTeslimat = @kalan, birimtür = @birimTur, IslemiYapan = @islemiYapan,
                        notlar = N'Apartman anlaşması (kg)'
                    WHERE Kimlik = @kid
                ` : `
                    UPDATE [komur].[dbo].[MusteriHareket]
                    SET Kisi = @kisi, YIL = @yil, AÇIKLAMA = @aciklama, ADET = @miktar,
                        BORÇ = @tutar, TARİH = @tarih, TeslimDurumu = @durum,
                        KalanTeslimat = @kalan, birimtür = @birimTur, IslemiYapan = @islemiYapan,
                        notlar = N'Apartman anlaşması (kg)'
                    WHERE Kimlik = @kid
                `);

            await tx.request().input('id', sql.Int, daireId)
                .input('mNo', sql.NVarChar, d.AnlasmaMakbuzNo)
                .input('fiyat', sql.Decimal(18, 6), kgFiyat)
                .input('at', sql.DateTime2, tarihObj)
                .query(`
                    UPDATE [komur].[dbo].[ApartmanDaireler]
                    SET AnlasmaMakbuzNo = @mNo, BirimFiyat = @fiyat, AnlasmaTarihi = ISNULL(AnlasmaTarihi, @at)
                    WHERE Id = @id
                `);

            await tx.commit();
            return { ok: true, borc: tutar, makbuzNo: d.AnlasmaMakbuzNo, kalanKg, paraBirimi, usdKur };
        }

        const makbuzNo = await yeniMakbuzNoAl(tx);
        await tx.request()
            .input('kisi', sql.Int, d.MusteriKimlik)
            .input('aciklama', sql.NVarChar, aciklama)
            .input('miktar', sql.Int, adetInt)
            .input('tutar', sql.Decimal(18, 2), tutar)
            .input('tarih', sql.DateTime2, tarihObj)
            .input('yil', sql.Int, yil)
            .input('birimTur', sql.NVarChar, 'Kg')
            .input('islemiYapan', sql.NVarChar, islemiYapan || 'Sistem')
            .input('mNo', sql.NVarChar, makbuzNo)
            .input('durum', sql.NVarChar, teslimDurumu)
            .input('kalan', sql.Float, kalanBorcGoster)
            .query(`
                INSERT INTO [komur].[dbo].[MusteriHareket]
                (Kisi, YIL, AÇIKLAMA, ADET, BİRİM, BORÇ, ÖDEME, TARİH, notlar, TeslimDurumu, KalanTeslimat, birimtür, IslemiYapan, MakbuzNo)
                VALUES (@kisi, @yil, @aciklama, @miktar, 0, @tutar, 0, @tarih, N'Apartman anlaşması (kg)', @durum, @kalan, @birimTur, @islemiYapan, @mNo)
            `);

        await tx.request().input('id', sql.Int, daireId).input('mNo', sql.NVarChar, makbuzNo)
            .input('fiyat', sql.Decimal(18, 6), kgFiyat)
            .input('at', sql.DateTime2, tarihObj)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET AnlasmaMakbuzNo = @mNo, BirimFiyat = @fiyat, AnlasmaTarihi = @at WHERE Id = @id`);

        await tx.commit();
        return { ok: true, borc: tutar, makbuzNo, kalanKg, paraBirimi, usdKur };
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ignore */ }
        const detay = e.precedingErrors?.map((x) => x.message).join(' | ') || e.originalError?.message || e.message;
        throw new Error(detay);
    }
}

/** Ayarlar tablosundan değer oku */
async function aptAyarDeger(pool, anahtar) {
    try {
        const r = await pool.request().input('a', sql.NVarChar, anahtar)
            .query(`SELECT TOP 1 Deger FROM [komur].[dbo].[Ayarlar] WHERE Anahtar = @a`);
        return r.recordset[0]?.Deger != null ? String(r.recordset[0].Deger).trim() : '';
    } catch (_) {
        return '';
    }
}

/** Ödeme türü → ayar anahtarı (eski: NAKİT/KKARTI/VADE DOLAR) */
function aptOdemeTurAyarAnahtari(odemeTuru) {
    const t = String(odemeTuru || 'Nakit').toLocaleLowerCase('tr-TR');
    if (t.includes('taksit')) return 'AptUsdTonKartTaksit';
    if (t.includes('kredi') || t.includes('kart')) return 'AptUsdTonKart';
    if (t.includes('vade')) return 'AptUsdTonVade';
    return 'AptUsdTonNakit'; // Nakit + Havale/EFT
}

/**
 * Ödeme türüne göre efektif USD/ton.
 * Ayar doluysa onu kullan (eski programdaki günlük NAKİT/KK/VADE DOLAR);
 * boşsa dairenin anlaşma TonFiyat'ı.
 */
async function aptOdemeEfektifTonFiyat(pool, odemeTuru, anlasmaTonFiyat) {
    const anahtar = aptOdemeTurAyarAnahtari(odemeTuru);
    const ham = await aptAyarDeger(pool, anahtar);
    const ayarTon = parseFloat(String(ham).replace(',', '.'));
    if (Number.isFinite(ayarTon) && ayarTon > 0) return ayarTon;
    const anl = parseFloat(anlasmaTonFiyat) || 0;
    return anl > 0 ? anl : 0;
}

/** Ödeme alındığında apartman kg borcundan düş (USD: anlık kur + türe göre ton fiyatı) */
async function apartmanOdemeKgIsle(pool, musteriId, odemeTl, islemiYapan, odemeTuru) {
    const tutar = parseFloat(odemeTl) || 0;
    if (tutar <= 0 || !musteriId) {
        return { islenen: 0, kgDusen: 0, detay: [], kur: null, odenenUsd: 0, tonFiyat: null, odemeTuru: odemeTuru || null };
    }

    await ensureApartmanTablolari();
    const daireler = await pool.request().input('mk', sql.Int, parseInt(musteriId, 10)).query(`
        SELECT Id, AnlasilanMiktar, KalanBorcKg, BirimFiyat, TonFiyat, ParaBirimi, AnlasmaKuru, Blok, DaireNo
        FROM [komur].[dbo].[ApartmanDaireler]
        WHERE MusteriKimlik = @mk AND UrunID IS NOT NULL
          AND AnlasilanMiktar > 0
          AND ISNULL(KalanBorcKg, AnlasilanMiktar) > 0.001
        ORDER BY Id ASC
    `);

    let kalanOdeme = tutar;
    let toplamKg = 0;
    const detay = [];
    let usdKur = null;
    let kullanilanTonFiyat = null;
    let toplamOdenenUsd = 0;

    for (const d of daireler.recordset || []) {
        if (kalanOdeme <= 0.001) break;

        const anlasilanKg = parseFloat(d.AnlasilanMiktar) || 0;
        let borcKg = d.KalanBorcKg != null ? parseFloat(d.KalanBorcKg) : anlasilanKg;
        if (!Number.isFinite(borcKg) || borcKg <= 0) continue;

        const paraBirimi = String(d.ParaBirimi || 'TRY').toUpperCase();
        // Anlaşma tonu (borç değerlemesi); ödeme kg'si için türe göre fiyat
        const anlasmaTon = parseFloat(d.TonFiyat) || ((parseFloat(d.BirimFiyat) || 0) * 1000);
        let kgFiyat;
        let odemeTon = anlasmaTon;

        if (paraBirimi === 'USD') {
            if (usdKur == null) {
                usdKur = await tcmbUsdSatisKuruGetir() || parseFloat(d.AnlasmaKuru) || null;
            }
            if (!usdKur || usdKur <= 0) continue;
            odemeTon = await aptOdemeEfektifTonFiyat(pool, odemeTuru, anlasmaTon);
            if (odemeTon <= 0) continue;
            kgFiyat = apartmanKgFiyatFromTon(odemeTon);
            if (kullanilanTonFiyat == null) kullanilanTonFiyat = odemeTon;
        } else {
            kgFiyat = apartmanDaireKgFiyat(d);
        }
        if (kgFiyat <= 0) continue;

        const kgBirimTl = paraBirimi === 'USD' ? kgFiyat * usdKur : kgFiyat;
        if (kgBirimTl <= 0) continue;

        const kalanTlTam = Math.round(borcKg * kgBirimTl * 100) / 100;
        let odenebilirKg;
        let harcananTl;
        let yeniKalan;
        if (kalanOdeme >= kalanTlTam - 0.5) {
            odenebilirKg = borcKg;
            harcananTl = Math.min(kalanOdeme, Math.max(kalanTlTam, 0));
            yeniKalan = 0;
        } else {
            odenebilirKg = Math.min(borcKg, kalanOdeme / kgBirimTl);
            if (odenebilirKg <= 0.0001) continue;
            harcananTl = Math.round(odenebilirKg * kgBirimTl * 100) / 100;
            yeniKalan = Math.max(0, Math.round((borcKg - odenebilirKg) * 100) / 100);
            if (yeniKalan > 0 && yeniKalan * kgBirimTl < 1) {
                harcananTl = Math.min(kalanOdeme, Math.round((harcananTl + yeniKalan * kgBirimTl) * 100) / 100);
                odenebilirKg = borcKg;
                yeniKalan = 0;
            }
        }
        if (harcananTl <= 0) continue;

        const odenenUsd = paraBirimi === 'USD' && usdKur
            ? Math.round((harcananTl / usdKur) * 10000) / 10000
            : 0;
        toplamOdenenUsd += odenenUsd;

        await pool.request()
            .input('id', sql.Int, d.Id)
            .input('kg', sql.Decimal(18, 2), yeniKalan)
            .input('tl', sql.Decimal(18, 2), harcananTl)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET KalanBorcKg = @kg, OdenenTl = ISNULL(OdenenTl,0) + @tl WHERE Id = @id`);

        // Cari borç satırı anlaşma fiyatı + güncel kur ile güncellenir
        await daireAnlasmaBorcEsitle(pool, d.Id, islemiYapan || 'Sistem', usdKur);

        kalanOdeme -= harcananTl;
        toplamKg += odenebilirKg;
        detay.push({
            daireId: d.Id,
            blok: d.Blok,
            daireNo: d.DaireNo,
            kgDusen: Math.round(odenebilirKg * 100) / 100,
            kalanKg: Math.round(yeniKalan * 100) / 100,
            harcananTl,
            kur: paraBirimi === 'USD' ? usdKur : null,
            tonFiyat: paraBirimi === 'USD' ? odemeTon : null,
            odenenUsd
        });
    }

    return {
        islenen: Math.round((tutar - kalanOdeme) * 100) / 100,
        kgDusen: Math.round(toplamKg * 100) / 100,
        detay,
        kur: usdKur,
        odenenUsd: Math.round(toplamOdenenUsd * 10000) / 10000,
        tonFiyat: kullanilanTonFiyat,
        odemeTuru: odemeTuru || 'Nakit'
    };
}

/** Apartmana özgü ödeme silindiğinde kg borcunu geri yükle (OdenenTl kadar) */
async function apartmanOdemeKgGeriAl(pool, musteriId, odemeTl, islemiYapan) {
    const tutar = parseFloat(odemeTl) || 0;
    if (tutar <= 0 || !musteriId) return { geriAlinan: 0, kgEklenen: 0, detay: [] };

    await ensureApartmanTablolari();
    // OdenenTl > 0 olan daireleri sondan başa (ödeme dağıtımının tersi) al
    const daireler = await pool.request().input('mk', sql.Int, parseInt(musteriId, 10)).query(`
        SELECT Id, AnlasilanMiktar, KalanBorcKg, BirimFiyat, TonFiyat, ParaBirimi, AnlasmaKuru, OdenenTl, Blok, DaireNo
        FROM [komur].[dbo].[ApartmanDaireler]
        WHERE MusteriKimlik = @mk AND UrunID IS NOT NULL
          AND ISNULL(OdenenTl, 0) > 0.001
        ORDER BY Id DESC
    `);

    let kalanGeri = tutar;
    let toplamKg = 0;
    const detay = [];
    let usdKur = null;

    for (const d of daireler.recordset || []) {
        if (kalanGeri <= 0.001) break;

        const odenenTl = parseFloat(d.OdenenTl) || 0;
        if (odenenTl <= 0) continue;

        const anlasilanKg = parseFloat(d.AnlasilanMiktar) || 0;
        let borcKg = d.KalanBorcKg != null ? parseFloat(d.KalanBorcKg) : 0;

        const paraBirimi = String(d.ParaBirimi || 'TRY').toUpperCase();
        let kgFiyat = apartmanDaireKgFiyat(d);
        if (kgFiyat <= 0) continue;

        if (paraBirimi === 'USD') {
            // Geri almada da güncel (günlük) kuru kullan
            if (usdKur == null) usdKur = await tcmbUsdSatisKuruGetir() || parseFloat(d.AnlasmaKuru);
            if (!usdKur || usdKur <= 0) continue;
        }
        const kgBirimTl = paraBirimi === 'USD' ? kgFiyat * usdKur : kgFiyat;
        if (kgBirimTl <= 0) continue;

        // Bu daireden geri alınabilecek tutar, ödenen kadarını aşamaz
        const geriTl = Math.min(kalanGeri, odenenTl);
        const kgEkle = geriTl / kgBirimTl;
        let yeniKalan = borcKg + kgEkle;
        if (anlasilanKg > 0 && yeniKalan > anlasilanKg) yeniKalan = anlasilanKg;
        const yeniOdenen = Math.max(0, odenenTl - geriTl);

        await pool.request()
            .input('id', sql.Int, d.Id)
            .input('kg', sql.Decimal(18, 2), yeniKalan)
            .input('tl', sql.Decimal(18, 2), yeniOdenen)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET KalanBorcKg = @kg, OdenenTl = @tl WHERE Id = @id`);

        await daireAnlasmaBorcEsitle(pool, d.Id, islemiYapan || 'Sistem', usdKur);

        kalanGeri -= geriTl;
        toplamKg += kgEkle;
        detay.push({ daireId: d.Id, blok: d.Blok, daireNo: d.DaireNo, kgEklenen: Math.round(kgEkle * 100) / 100, kalanKg: Math.round(yeniKalan * 100) / 100 });
    }

    return { geriAlinan: tutar - kalanGeri, kgEklenen: Math.round(toplamKg * 100) / 100, detay };
}

// --- Apartman ekle ---
app.post('/api/apartman', async (req, res) => {
    const { ad, il, ilce, mahalle, adres, sorumluAd, sorumluTel, aciklama } = req.body;
    if (!ad || !String(ad).trim()) {
        return res.status(400).json({ hata: 'Apartman adı gerekli' });
    }
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('ad', sql.NVarChar, String(ad).trim())
            .input('il', sql.NVarChar, il ? String(il).trim() : null)
            .input('ilce', sql.NVarChar, ilce ? String(ilce).trim() : null)
            .input('mahalle', sql.NVarChar, mahalle ? String(mahalle).trim() : null)
            .input('adres', sql.NVarChar, adres ? String(adres).trim() : null)
            .input('sad', sql.NVarChar, sorumluAd ? String(sorumluAd).trim() : null)
            .input('stel', sql.NVarChar, sorumluTel ? String(sorumluTel).trim() : null)
            .input('acik', sql.NVarChar, aciklama ? String(aciklama).trim() : null)
            .query(`
                INSERT INTO [komur].[dbo].[Apartmanlar] (Ad, Il, Ilce, Mahalle, Adres, SorumluAd, SorumluTel, Aciklama)
                OUTPUT INSERTED.Id
                VALUES (@ad, @il, @ilce, @mahalle, @adres, @sad, @stel, @acik)
            `);
        res.status(201).json({ mesaj: 'Apartman eklendi', id: result.recordset[0].Id });
    } catch (err) {
        console.error('APARTMAN EKLE HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Apartman listesi (özet ile) ---
app.get('/api/apartmanlar', async (req, res) => {
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT A.*,
                (SELECT COUNT(*) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id) AS DaireSayisi,
                (SELECT COUNT(*) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id AND D.MusteriKimlik IS NOT NULL) AS DoluDaire,
                (SELECT ISNULL(SUM(D.AnlasilanMiktar),0) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id) AS ToplamAnlasilan,
                (SELECT ISNULL(SUM(D.TeslimEdilen),0) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id) AS ToplamTeslim,
                (SELECT COUNT(*) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id AND D.AnlasilanMiktar > 0 AND D.TeslimEdilen >= D.AnlasilanMiktar) AS TamamDaire,
                (SELECT COUNT(*) FROM [komur].[dbo].[ApartmanDaireler] D WHERE D.ApartmanId = A.Id AND D.TeslimEdilen > 0 AND D.TeslimEdilen < D.AnlasilanMiktar) AS KismiDaire
            FROM [komur].[dbo].[Apartmanlar] A
            ORDER BY A.Ad ASC
        `);
        res.json(result.recordset || []);
    } catch (err) {
        console.error('APARTMAN LISTE HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Apartman detay + daireler ---
app.get('/api/apartman/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz id' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const apt = await pool.request().input('id', sql.Int, id)
            .query(`SELECT * FROM [komur].[dbo].[Apartmanlar] WHERE Id = @id`);
        if (!apt.recordset.length) return res.status(404).json({ hata: 'Apartman bulunamadı' });

        const daireler = await pool.request().input('id', sql.Int, id)
            .query(`
                SELECT D.*,
                    ISNULL(K.Unvan, K.Adı) AS MusteriAd,
                    K.CEPTEL AS MusteriTel,
                    S.UrunAdi AS UrunAdi,
                    (D.AnlasilanMiktar - D.TeslimEdilen) AS Kalan
                FROM [komur].[dbo].[ApartmanDaireler] D
                LEFT JOIN [komur].[dbo].[Kimlik] K ON D.MusteriKimlik = K.Kimlik
                LEFT JOIN [komur].[dbo].[StokListesi] S ON D.UrunID = S.ID
                WHERE D.ApartmanId = @id
                ORDER BY D.Blok ASC, D.Sira ASC, D.Id ASC
            `);
        res.json({ apartman: apt.recordset[0], daireler: daireler.recordset || [] });
    } catch (err) {
        console.error('APARTMAN DETAY HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Apartman güncelle ---
app.put('/api/apartman/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz id' });
    const { ad, il, ilce, mahalle, adres, sorumluAd, sorumluTel, aciklama } = req.body;
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        await pool.request()
            .input('id', sql.Int, id)
            .input('ad', sql.NVarChar, ad ? String(ad).trim() : '')
            .input('il', sql.NVarChar, il ? String(il).trim() : null)
            .input('ilce', sql.NVarChar, ilce ? String(ilce).trim() : null)
            .input('mahalle', sql.NVarChar, mahalle ? String(mahalle).trim() : null)
            .input('adres', sql.NVarChar, adres ? String(adres).trim() : null)
            .input('sad', sql.NVarChar, sorumluAd ? String(sorumluAd).trim() : null)
            .input('stel', sql.NVarChar, sorumluTel ? String(sorumluTel).trim() : null)
            .input('acik', sql.NVarChar, aciklama ? String(aciklama).trim() : null)
            .query(`
                UPDATE [komur].[dbo].[Apartmanlar]
                SET Ad=@ad, Il=@il, Ilce=@ilce, Mahalle=@mahalle, Adres=@adres,
                    SorumluAd=@sad, SorumluTel=@stel, Aciklama=@acik
                WHERE Id=@id
            `);
        res.json({ mesaj: 'Güncellendi' });
    } catch (err) {
        console.error('APARTMAN GUNCELLE HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Apartman sil (daireler + teslimatlar dahil; ödeme varsa engellenir) ---
app.delete('/api/apartman/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz id' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);

        const odeme = await pool.request().input('id', sql.Int, id).query(`
            SELECT TOP 1 Id, Blok, DaireNo,
                   ISNULL(OdenenTl, 0) AS OdenenTl,
                   ISNULL(AnlasilanMiktar, 0) AS AnlasilanMiktar,
                   KalanBorcKg
            FROM [komur].[dbo].[ApartmanDaireler]
            WHERE ApartmanId = @id
              AND (
                ISNULL(OdenenTl, 0) > 0.01
                OR (ISNULL(AnlasilanMiktar, 0) - ISNULL(KalanBorcKg, ISNULL(AnlasilanMiktar, 0))) > 0.01
              )
        `);
        if (odeme.recordset.length) {
            const d = odeme.recordset[0];
            return res.status(400).json({
                hata: `Apartmanda ödeme var (${d.Blok || ''} ${d.DaireNo || ''}). Önce ilgili carilerde apartman ödemelerini silin.`,
                kod: 'ODEME_VAR'
            });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const makbuzlar = await tx.request().input('id', sql.Int, id).query(`
                SELECT DISTINCT AnlasmaMakbuzNo FROM [komur].[dbo].[ApartmanDaireler]
                WHERE ApartmanId = @id AND AnlasmaMakbuzNo IS NOT NULL
            `);
            for (const row of makbuzlar.recordset) {
                await tx.request().input('mNo', sql.NVarChar, row.AnlasmaMakbuzNo)
                    .query(`DELETE FROM [komur].[dbo].[MusteriHareket] WHERE MakbuzNo = @mNo`);
            }
            await tx.request().input('id', sql.Int, id).query(`
                DELETE FROM [komur].[dbo].[ApartmanTeslimatlar]
                WHERE DaireId IN (SELECT Id FROM [komur].[dbo].[ApartmanDaireler] WHERE ApartmanId = @id);
                DELETE FROM [komur].[dbo].[ApartmanDaireler] WHERE ApartmanId = @id;
                DELETE FROM [komur].[dbo].[Apartmanlar] WHERE Id = @id;
            `);
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.json({ mesaj: 'Apartman silindi' });
    } catch (err) {
        console.error('APARTMAN SIL HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Blok sil (o bloktaki tüm daireler; ödeme varsa engellenir) ---
app.delete('/api/apartman/:id/blok', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const blokHam = req.body?.blok != null ? String(req.body.blok) : (req.query.blok != null ? String(req.query.blok) : '');
    const blok = blokHam.trim();
    if (!id) return res.status(400).json({ hata: 'Geçersiz id' });
    if (!blok || blok === 'TUMU') return res.status(400).json({ hata: 'Silinecek blok seçin' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const bloksuz = blok === '(Bloksuz)';

        const odemeReq = pool.request().input('id', sql.Int, id).input('blok', sql.NVarChar, blok);
        const odeme = await odemeReq.query(`
            SELECT TOP 1 Id, Blok, DaireNo
            FROM [komur].[dbo].[ApartmanDaireler]
            WHERE ApartmanId = @id
              AND (
                (${bloksuz ? '1' : '0'} = 1 AND (Blok IS NULL OR LTRIM(RTRIM(Blok)) = ''))
                OR LTRIM(RTRIM(ISNULL(Blok, ''))) = @blok
              )
              AND (
                ISNULL(OdenenTl, 0) > 0.01
                OR (ISNULL(AnlasilanMiktar, 0) - ISNULL(KalanBorcKg, ISNULL(AnlasilanMiktar, 0))) > 0.01
              )
        `);
        if (odeme.recordset.length) {
            const d = odeme.recordset[0];
            return res.status(400).json({
                hata: `Bu blokta ödeme var (Daire ${d.DaireNo || ''}). Önce ilgili carilerde apartman ödemelerini silin.`,
                kod: 'ODEME_VAR'
            });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const whereBlok = bloksuz
                ? `(Blok IS NULL OR LTRIM(RTRIM(Blok)) = '')`
                : `LTRIM(RTRIM(ISNULL(Blok, ''))) = @blok`;
            const makbuzlar = await tx.request().input('id', sql.Int, id).input('blok', sql.NVarChar, blok).query(`
                SELECT DISTINCT AnlasmaMakbuzNo FROM [komur].[dbo].[ApartmanDaireler]
                WHERE ApartmanId = @id AND AnlasmaMakbuzNo IS NOT NULL AND ${whereBlok}
            `);
            for (const row of makbuzlar.recordset) {
                await tx.request().input('mNo', sql.NVarChar, row.AnlasmaMakbuzNo)
                    .query(`DELETE FROM [komur].[dbo].[MusteriHareket] WHERE MakbuzNo = @mNo`);
            }
            await tx.request().input('id', sql.Int, id).input('blok', sql.NVarChar, blok).query(`
                DELETE FROM [komur].[dbo].[ApartmanTeslimatlar]
                WHERE DaireId IN (
                    SELECT Id FROM [komur].[dbo].[ApartmanDaireler]
                    WHERE ApartmanId = @id AND ${whereBlok}
                );
                DELETE FROM [komur].[dbo].[ApartmanDaireler]
                WHERE ApartmanId = @id AND ${whereBlok};
            `);
            await tx.commit();
            res.json({ mesaj: 'Blok silindi' });
        } catch (e) {
            await tx.rollback();
            throw e;
        }
    } catch (err) {
        console.error('BLOK SIL HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Toplu / tekli daire oluştur ---
app.post('/api/apartman/:id/daireler', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    const { blok, baslangic, bitis, daireNolar } = req.body;
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);

        let liste = [];
        if (Array.isArray(daireNolar) && daireNolar.length) {
            liste = daireNolar.map((n, i) => ({ no: String(n).trim(), sira: i + 1 }));
        } else {
            const bas = parseInt(baslangic, 10);
            const bit = parseInt(bitis, 10);
            if (!Number.isFinite(bas) || !Number.isFinite(bit) || bit < bas) {
                return res.status(400).json({ hata: 'Geçerli daire aralığı girin' });
            }
            if (bit - bas > 500) return res.status(400).json({ hata: 'En fazla 500 daire' });
            for (let n = bas; n <= bit; n += 1) liste.push({ no: String(n), sira: n });
        }
        if (!liste.length) return res.status(400).json({ hata: 'Daire yok' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const d of liste) {
                await tx.request()
                    .input('aid', sql.Int, apartmanId)
                    .input('blok', sql.NVarChar, blok ? String(blok).trim() : null)
                    .input('no', sql.NVarChar, d.no)
                    .input('sira', sql.Int, d.sira)
                    .query(`
                        INSERT INTO [komur].[dbo].[ApartmanDaireler] (ApartmanId, Blok, DaireNo, Sira)
                        VALUES (@aid, @blok, @no, @sira)
                    `);
            }
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.status(201).json({ mesaj: `${liste.length} daire eklendi`, adet: liste.length });
    } catch (err) {
        console.error('DAIRE OLUSTUR HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Daire güncelle (müşteri bağla + anlaşma) ---
app.put('/api/apartman-daire/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz daire' });
    const {
        blok, daireNo, musteriKimlik, urunId, anlasilanMiktar, birim, birimFiyat,
        aciklama, islemiYapan, daireTipi, paraBirimi, tonFiyat, kalanBorcKg
    } = req.body;
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);

        const anlasilan = anlasilanMiktar != null ? parseFloat(anlasilanMiktar) || 0 : 0;
        const tonF = tonFiyat != null && tonFiyat !== '' ? parseFloat(tonFiyat) : null;
        const kgFiyat = birimFiyat != null && birimFiyat !== ''
            ? parseFloat(birimFiyat)
            : (tonF ? apartmanKgFiyatFromTon(tonF) : null);
        const para = paraBirimi ? String(paraBirimi).toUpperCase() : 'TRY';
        let anlasmaKuru = null;
        if (para === 'USD') anlasmaKuru = await tcmbUsdSatisKuruGetir();

        let kalanKgVal = kalanBorcKg != null && kalanBorcKg !== ''
            ? parseFloat(kalanBorcKg)
            : anlasilan;

        // Ödeme yapılmış müşteri kaldırılamaz / değiştirilemez
        const once = await pool.request().input('id', sql.Int, id).query(`
            SELECT MusteriKimlik, AnlasilanMiktar, KalanBorcKg, ISNULL(OdenenTl, 0) AS OdenenTl
            FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @id
        `);
        if (!once.recordset.length) return res.status(404).json({ hata: 'Daire bulunamadı' });
        const eski = once.recordset[0];
        const yeniMk = musteriKimlik ? parseInt(musteriKimlik, 10) : null;
        const eskiMk = eski.MusteriKimlik ? parseInt(eski.MusteriKimlik, 10) : null;
        if (eskiMk && Number(eskiMk) !== Number(yeniMk || 0)) {
            const anl = parseFloat(eski.AnlasilanMiktar) || 0;
            const kalanKg = eski.KalanBorcKg != null ? parseFloat(eski.KalanBorcKg) : anl;
            const odenenKg = Math.max(0, anl - kalanKg);
            const odenenTl = parseFloat(eski.OdenenTl) || 0;
            if (odenenTl > 0.01 || odenenKg > 0.01) {
                return res.status(400).json({
                    hata: 'Bu dairede ödeme var. Müşteriyi kaldırmak/değiştirmek için önce carisine gidip apartman ödemesini silin.',
                    kod: 'ODEME_VAR'
                });
            }
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('blok', sql.NVarChar, blok != null ? String(blok).trim() : null)
            .input('no', sql.NVarChar, daireNo != null ? String(daireNo).trim() : null)
            .input('mk', sql.Int, yeniMk)
            .input('urun', sql.Int, urunId ? parseInt(urunId, 10) : null)
            .input('anlasilan', sql.Decimal(18, 2), anlasilan)
            .input('birim', sql.NVarChar, 'Kg')
            .input('fiyat', sql.Decimal(18, 4), kgFiyat)
            .input('tonF', sql.Decimal(18, 4), tonF)
            .input('para', sql.NVarChar, para)
            .input('kuru', sql.Decimal(18, 4), anlasmaKuru)
            .input('kalanKg', sql.Decimal(18, 2), kalanKgVal)
            .input('tip', sql.NVarChar, daireTipi ? String(daireTipi).trim() : null)
            .input('acik', sql.NVarChar, aciklama != null ? String(aciklama).trim() : null)
            .query(`
                UPDATE [komur].[dbo].[ApartmanDaireler]
                SET Blok=@blok, DaireNo=@no, MusteriKimlik=@mk, UrunID=@urun,
                    AnlasilanMiktar=@anlasilan, Birim=@birim, BirimFiyat=@fiyat,
                    TonFiyat=@tonF, ParaBirimi=@para, AnlasmaKuru=@kuru,
                    KalanBorcKg=@kalanKg, DaireTipi=@tip, Aciklama=@acik
                WHERE Id=@id
            `);

        const borcSonuc = await daireAnlasmaBorcEsitle(pool, id, islemiYapan || 'Sistem', anlasmaKuru);
        res.json({
            mesaj: 'Daire güncellendi',
            cariBorc: borcSonuc.borc || 0,
            makbuzNo: borcSonuc.makbuzNo || null,
            kalanKg: borcSonuc.kalanKg
        });
    } catch (err) {
        console.error('DAIRE GUNCELLE HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Sadece müşteri değiştir (yanlış daireye yanlış kişi atamasını düzelt) ---
app.put('/api/apartman-daire/:id/musteri', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz daire' });
    const musteriKimlik = req.body.musteriKimlik != null && req.body.musteriKimlik !== ''
        ? parseInt(req.body.musteriKimlik, 10) : null;
    const islemiYapan = req.body.islemiYapan || 'Sistem';
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const once = await pool.request().input('id', sql.Int, id).query(`
            SELECT Id, MusteriKimlik, AnlasilanMiktar, KalanBorcKg, ISNULL(OdenenTl, 0) AS OdenenTl, Blok, DaireNo
            FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @id
        `);
        if (!once.recordset.length) return res.status(404).json({ hata: 'Daire bulunamadı' });
        const eski = once.recordset[0];
        if (Number(eski.MusteriKimlik || 0) === Number(musteriKimlik || 0)) {
            return res.json({ mesaj: 'Değişiklik yok', degisti: false });
        }

        // Ödeme yapılmış müşteri kaldırılamaz / değiştirilemez
        const anlasilan = parseFloat(eski.AnlasilanMiktar) || 0;
        const kalanKg = eski.KalanBorcKg != null ? parseFloat(eski.KalanBorcKg) : anlasilan;
        const odenenKg = Math.max(0, anlasilan - kalanKg);
        const odenenTl = parseFloat(eski.OdenenTl) || 0;
        const eskiMk = eski.MusteriKimlik ? parseInt(eski.MusteriKimlik, 10) : null;
        if (eskiMk && (odenenTl > 0.01 || odenenKg > 0.01)) {
            return res.status(400).json({
                hata: 'Bu dairede ödeme var. Müşteriyi kaldırmak/değiştirmek için önce carisine gidip apartman ödemesini silin.',
                kod: 'ODEME_VAR',
                odenenKg: Math.round(odenenKg * 100) / 100,
                odenenTl: Math.round(odenenTl * 100) / 100,
                musteriKimlik: eskiMk
            });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('mk', sql.Int, musteriKimlik)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET MusteriKimlik = @mk WHERE Id = @id`);

        // Cari borç satırı eski müşteriden silinip yeni müşteriye yazılır
        const borcSonuc = await daireAnlasmaBorcEsitle(pool, id, islemiYapan);
        let musteriAd = null;
        if (musteriKimlik) {
            const mRes = await pool.request().input('mk', sql.Int, musteriKimlik)
                .query(`SELECT ISNULL(Unvan, ISNULL(Adı,'')) AS Ad FROM [komur].[dbo].[Kimlik] WHERE Kimlik = @mk`);
            musteriAd = mRes.recordset[0]?.Ad || null;
        }
        res.json({
            mesaj: 'Müşteri güncellendi',
            degisti: true,
            daireId: id,
            eskiMusteriKimlik: eski.MusteriKimlik,
            musteriKimlik,
            musteriAd,
            cariBorc: borcSonuc.borc || 0,
            kalanKg: borcSonuc.kalanKg
        });
    } catch (err) {
        console.error('DAIRE MUSTERI DEGISTIR HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- İki dairenin müşterilerini takas et ---
app.post('/api/apartman/musteri-takas', async (req, res) => {
    const daireId1 = parseInt(req.body.daireId1, 10);
    const daireId2 = parseInt(req.body.daireId2, 10);
    const islemiYapan = req.body.islemiYapan || 'Sistem';
    if (!daireId1 || !daireId2 || daireId1 === daireId2) {
        return res.status(400).json({ hata: 'İki farklı daire seçin' });
    }
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const r = await pool.request()
            .input('a', sql.Int, daireId1)
            .input('b', sql.Int, daireId2)
            .query(`
                SELECT Id, MusteriKimlik, Blok, DaireNo, ApartmanId,
                       AnlasilanMiktar, KalanBorcKg, ISNULL(OdenenTl, 0) AS OdenenTl
                FROM [komur].[dbo].[ApartmanDaireler]
                WHERE Id IN (@a, @b)
            `);
        if (r.recordset.length !== 2) return res.status(404).json({ hata: 'Daireler bulunamadı' });
        const d1 = r.recordset.find((x) => x.Id === daireId1);
        const d2 = r.recordset.find((x) => x.Id === daireId2);
        if (d1.ApartmanId !== d2.ApartmanId) {
            return res.status(400).json({ hata: 'Takas aynı apartman içinde olmalı' });
        }
        const odemeVarMi = (d) => {
            const anlasilan = parseFloat(d.AnlasilanMiktar) || 0;
            const kalanKg = d.KalanBorcKg != null ? parseFloat(d.KalanBorcKg) : anlasilan;
            const odenenKg = Math.max(0, anlasilan - kalanKg);
            const odenenTl = parseFloat(d.OdenenTl) || 0;
            return odenenTl > 0.01 || odenenKg > 0.01;
        };
        if (odemeVarMi(d1) || odemeVarMi(d2)) {
            return res.status(400).json({
                hata: 'Ödeme yapılmış daire takas edilemez. Önce ilgili caride apartman ödemesini silin.',
                kod: 'ODEME_VAR'
            });
        }
        const mk1 = d1.MusteriKimlik;
        const mk2 = d2.MusteriKimlik;
        await pool.request().input('id', sql.Int, daireId1).input('mk', sql.Int, mk2)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET MusteriKimlik = @mk WHERE Id = @id`);
        await pool.request().input('id', sql.Int, daireId2).input('mk', sql.Int, mk1)
            .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET MusteriKimlik = @mk WHERE Id = @id`);

        await daireAnlasmaBorcEsitle(pool, daireId1, islemiYapan);
        await daireAnlasmaBorcEsitle(pool, daireId2, islemiYapan);

        res.json({
            mesaj: 'Müşteriler takas edildi',
            daire1: { id: daireId1, blok: d1.Blok, no: d1.DaireNo, musteriKimlik: mk2 },
            daire2: { id: daireId2, blok: d2.Blok, no: d2.DaireNo, musteriKimlik: mk1 }
        });
    } catch (err) {
        console.error('MUSTERI TAKAS HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Blok bazlı ton anlaşması: toplam ton → dairelere kg olarak böl ---
app.put('/api/apartman/:id/blok-anlasma', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    const {
        blok, urunId, toplamTon, paraBirimi, tonFiyat, daireTipi, sadeceBos, islemiYapan, daireIdler
    } = req.body;

    const ton = parseFloat(toplamTon);
    const tonF = parseFloat(tonFiyat);
    if (!blok || !String(blok).trim()) return res.status(400).json({ hata: 'Blok adı gerekli' });
    if (!ton || ton <= 0) return res.status(400).json({ hata: 'Geçerli toplam ton girin' });
    if (!tonF || tonF <= 0) return res.status(400).json({ hata: 'Geçerli ton fiyatı girin' });
    if (!urunId) return res.status(400).json({ hata: 'Ürün seçin' });

    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const blokAd = String(blok).trim();
        const para = String(paraBirimi || 'TRY').toUpperCase();
        let anlasmaKuru = null;
        if (para === 'USD') {
            anlasmaKuru = await tcmbUsdSatisKuruGetir();
            if (!anlasmaKuru) return res.status(400).json({ hata: 'USD kuru alınamadı. İnternet bağlantısını kontrol edin.' });
        }

        let whereSql = 'ApartmanId = @aid AND Blok = @blok';
        if (Array.isArray(daireIdler) && daireIdler.length) {
            const ids = daireIdler.map((x) => parseInt(x, 10)).filter(Boolean);
            if (ids.length) whereSql += ` AND Id IN (${ids.join(',')})`;
        }
        if (sadeceBos) whereSql += ' AND AnlasilanMiktar = 0';

        const daireRes = await pool.request()
            .input('aid', sql.Int, apartmanId)
            .input('blok', sql.NVarChar, blokAd)
            .query(`SELECT Id FROM [komur].[dbo].[ApartmanDaireler] WHERE ${whereSql}`);

        const daireIds = (daireRes.recordset || []).map((r) => r.Id);
        if (!daireIds.length) {
            return res.status(400).json({ hata: `"${blokAd}" bloğunda uygulanacak daire bulunamadı` });
        }

        const kgToplam = ton * 1000;
        const kgPerDaire = Math.round((kgToplam / daireIds.length) * 100) / 100;
        const kgFiyat = apartmanKgFiyatFromTon(tonF);

        for (const did of daireIds) {
            await pool.request()
                .input('id', sql.Int, did)
                .input('urun', sql.Int, parseInt(urunId, 10))
                .input('kg', sql.Decimal(18, 2), kgPerDaire)
                .input('fiyat', sql.Decimal(18, 4), kgFiyat)
                .input('tonF', sql.Decimal(18, 4), tonF)
                .input('para', sql.NVarChar, para)
                .input('kuru', sql.Decimal(18, 4), anlasmaKuru)
                .input('tip', sql.NVarChar, daireTipi ? String(daireTipi).trim() : null)
                .query(`
                    UPDATE [komur].[dbo].[ApartmanDaireler]
                    SET UrunID=@urun, AnlasilanMiktar=@kg, Birim='Kg', BirimFiyat=@fiyat,
                        TonFiyat=@tonF, ParaBirimi=@para, AnlasmaKuru=@kuru,
                        KalanBorcKg=@kg, TeslimEdilen=0, OdenenTl=0,
                        DaireTipi = CASE WHEN @tip IS NOT NULL AND @tip <> '' THEN @tip ELSE DaireTipi END
                    WHERE Id=@id
                `);
        }

        let toplamBorc = 0;
        for (const did of daireIds) {
            const r = await daireAnlasmaBorcEsitle(pool, did, islemiYapan || 'Sistem', anlasmaKuru);
            toplamBorc += r.borc || 0;
        }

        res.json({
            mesaj: `${blokAd} bloğuna ${ton} ton anlaşma uygulandı`,
            blok: blokAd,
            daireSayisi: daireIds.length,
            kgPerDaire,
            kgFiyat,
            tonFiyat: tonF,
            paraBirimi: para,
            toplamBorc: Math.round(toplamBorc * 100) / 100,
            anlasmaKuru: anlasmaKuru
        });
    } catch (err) {
        console.error('BLOK ANLASMA HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Eski toplu anlaşma (geriye uyumluluk — kg bazlı) ---
app.put('/api/apartman/:id/toplu-anlasma', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    const { daireIdler, urunId, anlasilanMiktar, birimFiyat, sadeceBos, islemiYapan } = req.body;
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        let idWhere = 'ApartmanId = @aid';
        if (Array.isArray(daireIdler) && daireIdler.length) {
            const ids = daireIdler.map((x) => parseInt(x, 10)).filter(Boolean);
            if (ids.length) idWhere += ` AND Id IN (${ids.join(',')})`;
        }
        if (sadeceBos) idWhere += ' AND AnlasilanMiktar = 0';

        const idRes = await pool.request().input('aid', sql.Int, apartmanId)
            .query(`SELECT Id FROM [komur].[dbo].[ApartmanDaireler] WHERE ${idWhere}`);
        const syncIds = (idRes.recordset || []).map((r) => r.Id);
        const kg = parseFloat(anlasilanMiktar) || 0;
        const kgF = parseFloat(birimFiyat) || 0;

        await pool.request()
            .input('aid', sql.Int, apartmanId)
            .input('urun', sql.Int, urunId ? parseInt(urunId, 10) : null)
            .input('anlasilan', sql.Decimal(18, 2), kg)
            .input('fiyat', sql.Decimal(18, 4), kgF)
            .query(`
                UPDATE [komur].[dbo].[ApartmanDaireler]
                SET UrunID=@urun, AnlasilanMiktar=@anlasilan, Birim='Kg', BirimFiyat=@fiyat, KalanBorcKg=@anlasilan, OdenenTl=0
                WHERE ${idWhere}
            `);

        let toplamBorc = 0;
        for (const did of syncIds) {
            const r = await daireAnlasmaBorcEsitle(pool, did, islemiYapan || 'Sistem');
            toplamBorc += r.borc || 0;
        }
        res.json({ mesaj: 'Toplu anlaşma uygulandı', daireSayisi: syncIds.length, toplamBorc });
    } catch (err) {
        console.error('TOPLU ANLASMA HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Daire sil ---
app.delete('/api/apartman-daire/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz daire' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const dRes = await pool.request().input('id', sql.Int, id).query(`
            SELECT AnlasmaMakbuzNo, AnlasilanMiktar, KalanBorcKg, ISNULL(OdenenTl, 0) AS OdenenTl
            FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @id
        `);
        if (!dRes.recordset.length) return res.status(404).json({ hata: 'Daire bulunamadı' });
        const eski = dRes.recordset[0];
        const anlasilan = parseFloat(eski.AnlasilanMiktar) || 0;
        const kalanKg = eski.KalanBorcKg != null ? parseFloat(eski.KalanBorcKg) : anlasilan;
        const odenenKg = Math.max(0, anlasilan - kalanKg);
        const odenenTl = parseFloat(eski.OdenenTl) || 0;
        if (odenenTl > 0.01 || odenenKg > 0.01) {
            return res.status(400).json({
                hata: 'Bu dairede ödeme var. Önce carisine gidip apartman ödemesini silin.',
                kod: 'ODEME_VAR'
            });
        }
        const makbuz = eski.AnlasmaMakbuzNo;
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            if (makbuz) {
                await tx.request().input('mNo', sql.NVarChar, makbuz)
                    .query(`DELETE FROM [komur].[dbo].[MusteriHareket] WHERE MakbuzNo = @mNo`);
            }
            await tx.request().input('id', sql.Int, id).query(`
                DELETE FROM [komur].[dbo].[ApartmanTeslimatlar] WHERE DaireId = @id;
                DELETE FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @id;
            `);
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.json({ mesaj: 'Daire silindi' });
    } catch (err) {
        console.error('DAIRE SIL HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Mevcut anlaşmaların cari borcunu eşitle (TOKİ gibi eski kayıtlar için) ---
app.post('/api/apartman/:id/borc-esitle', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    const { islemiYapan } = req.body || {};
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const daireler = await pool.request().input('aid', sql.Int, apartmanId).query(`
            SELECT Id FROM [komur].[dbo].[ApartmanDaireler]
            WHERE ApartmanId = @aid AND MusteriKimlik IS NOT NULL AND UrunID IS NOT NULL
              AND AnlasilanMiktar > 0 AND BirimFiyat > 0
        `);
        let toplamBorc = 0;
        let adet = 0;
        for (const row of daireler.recordset || []) {
            const r = await daireAnlasmaBorcEsitle(pool, row.Id, islemiYapan || 'Sistem');
            if (r.borc > 0) { toplamBorc += r.borc; adet += 1; }
        }
        await apartmanYetimBorcSatirlariTemizle(pool);
        res.json({ mesaj: `${adet} dairenin cari borcu güncellendi`, toplamBorc, daireSayisi: adet });
    } catch (err) {
        console.error('BORC ESITLE HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Daireye kömür teslim et (kalan düşer, stok düşüşü — borç anlaşmada yazılır) ---
app.post('/api/apartman-daire/:id/teslimat', async (req, res) => {
    const daireId = parseInt(req.params.id, 10);
    if (!daireId) return res.status(400).json({ hata: 'Geçersiz daire' });
    const { miktar, tarih, islemiYapan, izinliAsim } = req.body;
    const teslimMiktar = parseFloat(miktar);
    if (!teslimMiktar || teslimMiktar <= 0) {
        return res.status(400).json({ hata: 'Geçerli miktar girin' });
    }
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const dRes = await pool.request().input('id', sql.Int, daireId)
            .query(`SELECT * FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @id`);
        if (!dRes.recordset.length) return res.status(404).json({ hata: 'Daire bulunamadı' });
        const daire = dRes.recordset[0];

        const kalan = (parseFloat(daire.AnlasilanMiktar) || 0) - (parseFloat(daire.TeslimEdilen) || 0);
        if (!izinliAsim && daire.AnlasilanMiktar > 0 && teslimMiktar > kalan + 0.0001) {
            return res.status(400).json({ hata: `Kalan miktar ${kalan}. Fazla teslim için onay gerekli.`, kod: 'ASIM', kalan });
        }

        const islemTarihiStr = normalizeIslemTarihiStr(tarih);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            // Stok düşüşü (borç anlaşma kaydında zaten cariye yazıldı)
            if (daire.UrunID) {
                await tx.request().input('uid', sql.Int, daire.UrunID)
                    .input('m', sql.Decimal(18, 2), teslimMiktar)
                    .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu,0) - @m WHERE ID = @uid`);
            }

            await tx.request()
                .input('did', sql.Int, daireId)
                .input('m', sql.Decimal(18, 2), teslimMiktar)
                .input('tarih', sql.NVarChar, islemTarihiStr)
                .input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                .query(`
                    INSERT INTO [komur].[dbo].[ApartmanTeslimatlar] (DaireId, Miktar, Tarih, IslemiYapan)
                    VALUES (@did, @m, @tarih, @yapan)
                `);

            await tx.request().input('did', sql.Int, daireId).input('m', sql.Decimal(18, 2), teslimMiktar)
                .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET TeslimEdilen = ISNULL(TeslimEdilen,0) + @m WHERE Id = @did`);

            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.status(201).json({ mesaj: 'Teslimat kaydedildi', stokDustu: !!daire.UrunID });
    } catch (err) {
        console.error('DAIRE TESLIMAT HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Blok bazlı toplu teslimat: girilen kg'yi bloktaki dairelere dağıtır ---
app.post('/api/apartman/:id/blok-teslimat', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    const { blok, miktar, tarih, islemiYapan, izinliAsim } = req.body;
    const teslimMiktar = parseFloat(miktar);
    if (!teslimMiktar || teslimMiktar <= 0) return res.status(400).json({ hata: 'Geçerli miktar (kg) girin' });

    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);

        // Bloktaki, anlaşması olan daireleri sırayla al
        const blokKosul = (blok && blok !== 'TUMU' && blok !== '(Bloksuz)')
            ? `AND ISNULL(NULLIF(LTRIM(RTRIM(Blok)), ''), '(Bloksuz)') = @blok`
            : (blok === '(Bloksuz)' ? `AND ISNULL(NULLIF(LTRIM(RTRIM(Blok)), ''), '(Bloksuz)') = '(Bloksuz)'` : '');
        const dReq = pool.request().input('aid', sql.Int, apartmanId);
        if (blokKosul.includes('@blok')) dReq.input('blok', sql.NVarChar, blok);
        const dRes = await dReq.query(`
            SELECT Id, Blok, DaireNo, UrunID, AnlasilanMiktar, TeslimEdilen
            FROM [komur].[dbo].[ApartmanDaireler]
            WHERE ApartmanId = @aid AND UrunID IS NOT NULL AND AnlasilanMiktar > 0 ${blokKosul}
            ORDER BY Id ASC
        `);
        const daireler = dRes.recordset || [];
        if (!daireler.length) return res.status(404).json({ hata: 'Bu blokta anlaşmalı daire yok' });

        const toplamKalan = daireler.reduce((t, d) => t + Math.max(0, (parseFloat(d.AnlasilanMiktar) || 0) - (parseFloat(d.TeslimEdilen) || 0)), 0);
        if (!izinliAsim && teslimMiktar > toplamKalan + 0.01) {
            return res.status(400).json({ hata: `Blokta kalan teslimat ${Math.round(toplamKalan * 100) / 100} kg. Fazla teslim için onay gerekli.`, kod: 'ASIM', kalan: Math.round(toplamKalan * 100) / 100 });
        }

        const islemTarihiStr = normalizeIslemTarihiStr(tarih);
        const grupId = 'BT' + Date.now() + Math.floor(Math.random() * 1000);
        const blokEtiket = (blok && blok !== 'TUMU') ? blok : (daireler[0]?.Blok || '');
        const tx = new sql.Transaction(pool);
        await tx.begin();
        let kalanDagit = teslimMiktar;
        const dagitim = [];
        try {
            for (const d of daireler) {
                if (kalanDagit <= 0.001) break;
                const dKalan = Math.max(0, (parseFloat(d.AnlasilanMiktar) || 0) - (parseFloat(d.TeslimEdilen) || 0));
                if (dKalan <= 0.001 && !izinliAsim) continue;
                // Bu daireye düşen pay: kalanına kadar (aşım izinliyse son daireye taşabilir)
                let pay = Math.min(kalanDagit, dKalan > 0 ? dKalan : kalanDagit);
                if (izinliAsim && dKalan <= 0.001) pay = 0; // aşımda bile 0 kalanı zorlamayalım, son dairede toplanır
                if (pay <= 0.001) continue;

                if (d.UrunID) {
                    await tx.request().input('uid', sql.Int, d.UrunID).input('m', sql.Decimal(18, 2), pay)
                        .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu,0) - @m WHERE ID = @uid`);
                }
                await tx.request().input('did', sql.Int, d.Id).input('m', sql.Decimal(18, 2), pay)
                    .input('tarih', sql.NVarChar, islemTarihiStr).input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                    .input('grup', sql.NVarChar, grupId).input('blk', sql.NVarChar, blokEtiket)
                    .query(`INSERT INTO [komur].[dbo].[ApartmanTeslimatlar] (DaireId, Miktar, Tarih, IslemiYapan, TeslimatGrup, Blok) VALUES (@did, @m, @tarih, @yapan, @grup, @blk)`);
                await tx.request().input('did', sql.Int, d.Id).input('m', sql.Decimal(18, 2), pay)
                    .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET TeslimEdilen = ISNULL(TeslimEdilen,0) + @m WHERE Id = @did`);

                dagitim.push({ daireId: d.Id, blok: d.Blok, daireNo: d.DaireNo, miktar: Math.round(pay * 100) / 100 });
                kalanDagit -= pay;
            }

            // Aşım izinli ve hâlâ dağıtılacak varsa son daireye ekle
            if (izinliAsim && kalanDagit > 0.001 && daireler.length) {
                const son = daireler[daireler.length - 1];
                if (son.UrunID) {
                    await tx.request().input('uid', sql.Int, son.UrunID).input('m', sql.Decimal(18, 2), kalanDagit)
                        .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu,0) - @m WHERE ID = @uid`);
                }
                await tx.request().input('did', sql.Int, son.Id).input('m', sql.Decimal(18, 2), kalanDagit)
                    .input('tarih', sql.NVarChar, islemTarihiStr).input('yapan', sql.NVarChar, islemiYapan || 'Sistem')
                    .input('grup', sql.NVarChar, grupId).input('blk', sql.NVarChar, blokEtiket)
                    .query(`INSERT INTO [komur].[dbo].[ApartmanTeslimatlar] (DaireId, Miktar, Tarih, IslemiYapan, TeslimatGrup, Blok) VALUES (@did, @m, @tarih, @yapan, @grup, @blk)`);
                await tx.request().input('did', sql.Int, son.Id).input('m', sql.Decimal(18, 2), kalanDagit)
                    .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET TeslimEdilen = ISNULL(TeslimEdilen,0) + @m WHERE Id = @did`);
                dagitim.push({ daireId: son.Id, blok: son.Blok, daireNo: son.DaireNo, miktar: Math.round(kalanDagit * 100) / 100 });
                kalanDagit = 0;
            }

            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.status(201).json({ mesaj: 'Blok teslimatı kaydedildi', grupId, dagitilan: Math.round((teslimMiktar - kalanDagit) * 100) / 100, dagitim });
    } catch (err) {
        console.error('BLOK TESLIMAT HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Blok teslimat geçmişi (grup bazında) ---
app.get('/api/apartman/:id/blok-teslimat-gecmisi', async (req, res) => {
    const apartmanId = parseInt(req.params.id, 10);
    const blok = req.query.blok;
    if (!apartmanId) return res.status(400).json({ hata: 'Geçersiz apartman' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const blokKosul = (blok && blok !== 'TUMU')
            ? `AND ISNULL(NULLIF(LTRIM(RTRIM(D.Blok)), ''), '(Bloksuz)') = @blok`
            : '';
        const rq = pool.request().input('aid', sql.Int, apartmanId);
        if (blokKosul) rq.input('blok', sql.NVarChar, blok);
        const r = await rq.query(`
            SELECT
                T.TeslimatGrup AS Grup,
                MAX(T.Tarih) AS Tarih,
                MAX(T.IslemiYapan) AS IslemiYapan,
                SUM(T.Miktar) AS ToplamKg,
                COUNT(*) AS DaireSayisi
            FROM [komur].[dbo].[ApartmanTeslimatlar] T
            INNER JOIN [komur].[dbo].[ApartmanDaireler] D ON D.Id = T.DaireId
            WHERE D.ApartmanId = @aid AND T.TeslimatGrup IS NOT NULL ${blokKosul}
            GROUP BY T.TeslimatGrup
            ORDER BY MAX(T.OlusturmaZamani) DESC
        `);
        res.json(r.recordset || []);
    } catch (err) {
        console.error('BLOK TESLIMAT GECMISI HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Blok teslimat grubunu geri al (stok + TeslimEdilen düzeltilir) ---
app.delete('/api/apartman/blok-teslimat-grup/:grup', async (req, res) => {
    const grup = req.params.grup;
    if (!grup) return res.status(400).json({ hata: 'Geçersiz grup' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const satirlar = await pool.request().input('g', sql.NVarChar, grup)
            .query(`SELECT T.Id, T.DaireId, T.Miktar, D.UrunID
                    FROM [komur].[dbo].[ApartmanTeslimatlar] T
                    INNER JOIN [komur].[dbo].[ApartmanDaireler] D ON D.Id = T.DaireId
                    WHERE T.TeslimatGrup = @g`);
        if (!satirlar.recordset.length) return res.status(404).json({ hata: 'Teslimat kaydı bulunamadı' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const s of satirlar.recordset) {
                if (s.UrunID) {
                    await tx.request().input('uid', sql.Int, s.UrunID).input('m', sql.Decimal(18, 2), s.Miktar)
                        .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu,0) + @m WHERE ID = @uid`);
                }
                await tx.request().input('did', sql.Int, s.DaireId).input('m', sql.Decimal(18, 2), s.Miktar)
                    .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET TeslimEdilen = CASE WHEN ISNULL(TeslimEdilen,0) - @m < 0 THEN 0 ELSE ISNULL(TeslimEdilen,0) - @m END WHERE Id = @did`);
            }
            await tx.request().input('g', sql.NVarChar, grup)
                .query(`DELETE FROM [komur].[dbo].[ApartmanTeslimatlar] WHERE TeslimatGrup = @g`);
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.json({ mesaj: 'Teslimat geri alındı' });
    } catch (err) {
        console.error('BLOK TESLIMAT GERI ALMA HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Daire teslimat geçmişi ---
app.get('/api/apartman-daire/:id/teslimatlar', async (req, res) => {
    const daireId = parseInt(req.params.id, 10);
    if (!daireId) return res.status(400).json({ hata: 'Geçersiz daire' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const result = await pool.request().input('id', sql.Int, daireId)
            .query(`SELECT * FROM [komur].[dbo].[ApartmanTeslimatlar] WHERE DaireId = @id ORDER BY Id DESC`);
        res.json(result.recordset || []);
    } catch (err) {
        console.error('TESLIMAT GECMIS HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Teslimat geri al (kalanı iade, cari + stok düzelt) ---
app.delete('/api/apartman-teslimat/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ hata: 'Geçersiz teslimat' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const tRes = await pool.request().input('id', sql.Int, id)
            .query(`SELECT * FROM [komur].[dbo].[ApartmanTeslimatlar] WHERE Id = @id`);
        if (!tRes.recordset.length) return res.status(404).json({ hata: 'Teslimat bulunamadı' });
        const t = tRes.recordset[0];

        const dRes = await pool.request().input('did', sql.Int, t.DaireId)
            .query(`SELECT * FROM [komur].[dbo].[ApartmanDaireler] WHERE Id = @did`);
        const daire = dRes.recordset[0];

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            if (daire && daire.UrunID) {
                await tx.request().input('uid', sql.Int, daire.UrunID).input('m', sql.Decimal(18, 2), t.Miktar)
                    .query(`UPDATE [komur].[dbo].[StokListesi] SET BaslangicStogu = ISNULL(BaslangicStogu,0) + @m WHERE ID = @uid`);
            }
            await tx.request().input('did', sql.Int, t.DaireId).input('m', sql.Decimal(18, 2), t.Miktar)
                .query(`UPDATE [komur].[dbo].[ApartmanDaireler] SET TeslimEdilen = ISNULL(TeslimEdilen,0) - @m WHERE Id = @did`);
            await tx.request().input('id', sql.Int, id)
                .query(`DELETE FROM [komur].[dbo].[ApartmanTeslimatlar] WHERE Id = @id`);
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }
        res.json({ mesaj: 'Teslimat geri alındı' });
    } catch (err) {
        console.error('TESLIMAT GERI AL HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Müşterinin tüm apartman anlaşma borçlarını cariye yaz/güncelle ---
app.post('/api/musteri/:id/apartman-borc-esitle', async (req, res) => {
    const musteriId = parseInt(req.params.id, 10);
    if (!musteriId) return res.status(400).json({ hata: 'Geçersiz müşteri' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const daireler = await pool.request().input('mk', sql.Int, musteriId).query(`
            SELECT Id FROM [komur].[dbo].[ApartmanDaireler]
            WHERE MusteriKimlik = @mk AND UrunID IS NOT NULL
              AND AnlasilanMiktar > 0 AND BirimFiyat > 0
        `);
        let toplamBorc = 0;
        for (const row of daireler.recordset || []) {
            const r = await daireAnlasmaBorcEsitle(pool, row.Id, 'Sistem');
            toplamBorc += r.borc || 0;
        }
        res.json({ mesaj: 'Cari borç güncellendi', toplamBorc, daireSayisi: (daireler.recordset || []).length });
    } catch (err) {
        const detay = err.precedingErrors?.map((x) => x.message).join(' | ') || err.originalError?.message || err.message;
        console.error('MUSTERI BORC ESITLE HATASI:', detay, err);
        res.status(500).json({ hata: detay });
    }
});

// --- Apartman ödeme önizleme (anlık kur + türe göre ton + tahmini kg) ---
app.get('/api/musteri/:id/apartman-odeme-onizleme', async (req, res) => {
    const musteriId = parseInt(req.params.id, 10);
    const tutar = parseFloat(String(req.query.tutar || '0').replace(',', '.')) || 0;
    const odemeTuru = req.query.odemeTuru || 'Nakit';
    if (!musteriId) return res.status(400).json({ hata: 'Geçersiz müşteri' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const kur = await tcmbUsdSatisKuruGetir();
        const daireler = await pool.request().input('mk', sql.Int, musteriId).query(`
            SELECT TOP 1 TonFiyat, BirimFiyat, ParaBirimi, KalanBorcKg, AnlasilanMiktar
            FROM [komur].[dbo].[ApartmanDaireler]
            WHERE MusteriKimlik = @mk AND UrunID IS NOT NULL
              AND AnlasilanMiktar > 0
              AND ISNULL(KalanBorcKg, AnlasilanMiktar) > 0.001
              AND UPPER(ISNULL(ParaBirimi,'TRY')) = 'USD'
            ORDER BY Id ASC
        `);
        const d = daireler.recordset[0];
        if (!d) {
            return res.json({
                varMi: false,
                kur,
                mesaj: 'USD apartman borcu yok'
            });
        }
        const anlasmaTon = parseFloat(d.TonFiyat) || ((parseFloat(d.BirimFiyat) || 0) * 1000);
        const tonFiyat = await aptOdemeEfektifTonFiyat(pool, odemeTuru, anlasmaTon);
        const kgFiyat = apartmanKgFiyatFromTon(tonFiyat);
        const kgBirimTl = kur && kgFiyat ? kgFiyat * kur : 0;
        const tahminiKg = tutar > 0 && kgBirimTl > 0 ? Math.round((tutar / kgBirimTl) * 100) / 100 : 0;
        const odenenUsd = tutar > 0 && kur ? Math.round((tutar / kur) * 10000) / 10000 : 0;
        const ayarAnahtar = aptOdemeTurAyarAnahtari(odemeTuru);
        const ayarHam = await aptAyarDeger(pool, ayarAnahtar);
        res.json({
            varMi: true,
            kur,
            odemeTuru,
            anlasmaTon,
            tonFiyat,
            tonKaynak: (parseFloat(String(ayarHam).replace(',', '.')) > 0) ? 'ayar' : 'anlasma',
            odenenUsd,
            tahminiKg,
            kgBirimTl: kgBirimTl ? Math.round(kgBirimTl * 10000) / 10000 : 0
        });
    } catch (err) {
        res.status(500).json({ hata: err.message });
    }
});

// --- Müşteri borç özeti: apartman vs genel ayrımı ---
app.get('/api/musteri/:id/borc-ozet', async (req, res) => {
    const musteriId = parseInt(req.params.id, 10);
    if (!musteriId) return res.status(400).json({ hata: 'Geçersiz müşteri' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);

        const bakRes = await pool.request().input('id', sql.Int, musteriId).query(`
            SELECT (ISNULL(SUM(BORÇ),0) - ISNULL(SUM(ÖDEME),0)) AS Bakiye
            FROM [komur].[dbo].[MusteriHareket] WHERE Kisi = @id
        `);
        const toplamBakiye = Math.round((parseFloat(bakRes.recordset[0]?.Bakiye) || 0) * 100) / 100;

        const daireRes = await pool.request().input('mk', sql.Int, musteriId).query(`
            SELECT AnlasilanMiktar, KalanBorcKg, BirimFiyat, TonFiyat, ParaBirimi, AnlasmaKuru
            FROM [komur].[dbo].[ApartmanDaireler]
            WHERE MusteriKimlik = @mk AND UrunID IS NOT NULL AND AnlasilanMiktar > 0
        `);

        let usdKur = null;
        let apartmanBorc = 0;
        let apartmanKalanKg = 0;
        for (const d of daireRes.recordset || []) {
            const anlasilanKg = parseFloat(d.AnlasilanMiktar) || 0;
            let kalanKg = d.KalanBorcKg != null ? parseFloat(d.KalanBorcKg) : anlasilanKg;
            if (!Number.isFinite(kalanKg) || kalanKg < 0) kalanKg = 0;
            const para = String(d.ParaBirimi || 'TRY').toUpperCase();
            const kgFiyat = apartmanDaireKgFiyat(d);
            if (para === 'USD' && usdKur == null) usdKur = await tcmbUsdSatisKuruGetir();
            apartmanBorc += apartmanBorcTlHesapla(kalanKg, kgFiyat, para, para === 'USD' ? usdKur : null);
            apartmanKalanKg += kalanKg;
        }
        apartmanBorc = Math.round(apartmanBorc * 100) / 100;
        let genelBorc = Math.round((toplamBakiye - apartmanBorc) * 100) / 100;
        if (Math.abs(genelBorc) < 0.5) genelBorc = 0;

        res.json({
            toplamBakiye,
            apartmanBorc: apartmanBorc > 0.5 ? apartmanBorc : 0,
            genelBorc: genelBorc > 0 ? genelBorc : 0,
            apartmanKalanKg: Math.round(apartmanKalanKg * 100) / 100,
            usdKur
        });
    } catch (err) {
        console.error('BORC OZET HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

// --- Bir müşterinin bağlı olduğu apartman daireleri ---
app.get('/api/musteri/:id/apartman-daireler', async (req, res) => {
    const musteriId = parseInt(req.params.id, 10);
    if (!musteriId) return res.status(400).json({ hata: 'Geçersiz müşteri' });
    try {
        await ensureApartmanTablolari();
        const pool = await sql.connect(config);
        const result = await pool.request().input('mk', sql.Int, musteriId).query(`
            SELECT D.Id, D.Blok, D.DaireNo, D.DaireTipi, D.AnlasilanMiktar, D.TeslimEdilen,
                   D.Birim, D.BirimFiyat, D.TonFiyat, D.ParaBirimi, D.KalanBorcKg, D.AnlasmaKuru,
                   (D.AnlasilanMiktar - D.TeslimEdilen) AS Kalan,
                   A.Id AS ApartmanId, A.Ad AS ApartmanAd,
                   S.UrunAdi AS UrunAdi
            FROM [komur].[dbo].[ApartmanDaireler] D
            INNER JOIN [komur].[dbo].[Apartmanlar] A ON D.ApartmanId = A.Id
            LEFT JOIN [komur].[dbo].[StokListesi] S ON D.UrunID = S.ID
            WHERE D.MusteriKimlik = @mk
            ORDER BY A.Ad ASC, D.Blok ASC, D.Sira ASC
        `);
        res.json(result.recordset || []);
    } catch (err) {
        console.error('MUSTERI APARTMAN HATASI:', err);
        res.status(500).json({ hata: err.message });
    }
});

async function sunucuyuBaslat({ exitOnError = true } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, () => {
            console.log(`Sunucu http://localhost:${PORT} adresinde aktif.`);
            sistemLogYaz('bilgi', `Sunucu http://localhost:${PORT} üzerinde dinliyor`);
            resolve(server);
        });
        server.on('error', (err) => {
            if (exitOnError) {
                console.error('Sunucu baslatilamadi:', err.message);
                process.exit(1);
            }
            reject(err);
        });
    });
}

if (require.main === module) {
    sunucuyuBaslat().then(async () => {
        try {
            await ensureApartmanTablolari();
            const pool = await sql.connect(config);
            await apartmanAnlasmaTarihleriniOnar(pool);
        } catch (e) {
            console.warn('Apartman başlangıç onarımı:', e.message);
        }
    }).catch(() => {});
}

module.exports = { app, sunucuyuBaslat };