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
    return path.join(os.homedir(), 'KOMUR-backups');
}

function yedekDosyaAdi() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `yedek-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
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
        res.json({ success: true, message: 'Yedek oluşturuldu.', dosyaAdi });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Yedek alınamadı.' });
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
                (ISNULL(SUM(MH.BORÇ), 0) - ISNULL(SUM(MH.ÖDEME), 0)) AS Bakiye
            
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
    let islemTarihiStr = tarih;
    if (!islemTarihiStr || islemTarihiStr === "" || islemTarihiStr === "undefined") {
        let simdi = new Date();
        let trZamani = new Date(simdi.toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
        const pad = (n) => n.toString().padStart(2, '0');
        islemTarihiStr = `${trZamani.getFullYear()}-${pad(trZamani.getMonth()+1)}-${pad(trZamani.getDate())} ${pad(trZamani.getHours())}:${pad(trZamani.getMinutes())}:${pad(trZamani.getSeconds())}`;
    } else {
        // Eğer tarayıcı araya T veya Z harfi sıkıştırdıysa temizle (Örn: 2026-04-24T15:30 -> 2026-04-24 15:30)
        islemTarihiStr = String(islemTarihiStr).replace('T', ' ').replace('Z', '').trim();
    }

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
    const { kisiId, odeme, aciklama, notlar, tarih, islemiYapan } = req.body;
    
    // --- SAAT KORUMASI ---
    let islemTarihiStr = tarih;
    if (!islemTarihiStr || islemTarihiStr === "" || islemTarihiStr === "undefined") {
        let simdi = new Date();
        let trZamani = new Date(simdi.toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
        const pad = (n) => n.toString().padStart(2, '0');
        islemTarihiStr = `${trZamani.getFullYear()}-${pad(trZamani.getMonth()+1)}-${pad(trZamani.getDate())} ${pad(trZamani.getHours())}:${pad(trZamani.getMinutes())}:${pad(trZamani.getSeconds())}`;
    } else {
        islemTarihiStr = String(islemTarihiStr).replace('T', ' ').replace('Z', '').trim();
    }

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
            VALUES 
            (@kisiId, @tutar, 0, @aciklama, 0, 0, @tarih, YEAR(@tarih), @notlar, @islemiYapan) 
        `;
        
        await request.query(query);
        console.log(`✅ Tahsilat Kaydedildi: Müşteri ID: ${kisiId}, Yapan: ${islemiYapan || 'Sistem'}`);
        res.status(201).json({ mesaj: 'Ödeme başarıyla kaydedildi.', tutar: guvenliOdeme });

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
        const query = `
            SELECT 
                S.ID as id,
                S.UrunAdi as cins,
                S.SatisFiyati as ton_fiyati,
                ISNULL(S.BaslangicStogu, 0) AS mevcut_stok_ton,
                S.EsikAlt as esik_alt,
                S.EsikUst as esik_ust
            FROM [komur].[dbo].[StokListesi] S
            WHERE S.TakipEdilsinMi = 1
        `;
        const result = await sql.query(query);
        const zengin = (result.recordset || []).map((row) => {
            const p = parseStokUrunAdi(row.cins);
            return {
                ...row,
                temel_ad: p.temizAd,
                birim_turu: p.birimTuru
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
    const { UrunAdi, TonFiyati, MevcutStok, EsikAlt, EsikUst } = req.body;

    try {
        await ensureStokEsikKolonlari();
        const query = `
            INSERT INTO [komur].[dbo].[StokListesi] 
            (UrunAdi, SatisFiyati, BaslangicStogu, EsikAlt, EsikUst, TakipEdilsinMi) 
            VALUES (@urunAdi, @fiyat, @miktar, @esikAlt, @esikUst, 1)
        `;

        const request = new sql.Request();
        request.input('urunAdi', sql.NVarChar, UrunAdi);
        request.input('fiyat', sql.Decimal(18,2), TonFiyati);
        request.input('miktar', sql.Decimal(18,2), MevcutStok);
        request.input('esikAlt', sql.Decimal(18,2), EsikAlt);
        request.input('esikUst', sql.Decimal(18,2), EsikUst);

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
        const p_unvan = unvan ? unvan.trim() : '';
        const p_telefon = telefon ? telefon.trim() : '';

        // 1. MÜKERRER KONTROLÜ (Sadece Unvan'ı kontrol ediyoruz, ID sildik)
        request.input('checkUnvan', sql.NVarChar, p_unvan);
        request.input('checkTel', sql.NVarChar, p_telefon);

        // Sorguda ID yerine Unvan çekiyoruz ki sütun hatası vermesin
        const checkQuery = `
            SELECT TOP 1 Unvan 
            FROM [komur].[dbo].[Kimlik] 
            WHERE Unvan = @checkUnvan AND CEPTEL = @checkTel AND @checkUnvan <> ''
        `;

        const checkResult = await request.query(checkQuery);

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ 
                success: false, 
                hata: `Bu isim ve telefon numarasıyla zaten bir kayıt mevcut.` 
            });
        }

        // 2. KAYIT İŞLEMİ (OUTPUT kısmını tamamen sildik)
        request.input('ad', sql.NVarChar, ad_soyad ? ad_soyad.trim() : '');
        request.input('soyad', sql.NVarChar, ''); 
        request.input('telefon', sql.NVarChar, p_telefon);
        request.input('unvan', sql.NVarChar, p_unvan);
        request.input('adres', sql.NVarChar, adres ? adres.trim() : '');
        request.input('ilce', sql.NVarChar, ilce ? ilce.trim() : '');
        request.input('mahalle', sql.NVarChar, mahalle ? mahalle.trim() : '');

        const query = `
            INSERT INTO [komur].[dbo].[Kimlik] (Adı, Soyadı, CEPTEL, Unvan, Adres, Ilce, Mahalle) 
            VALUES (@ad, @soyad, @telefon, @unvan, @adres, @ilce, @mahalle)
        `;

        await request.query(query);
        
        // Yanıtta yeniId göndermiyoruz
        res.status(201).json({ success: true, mesaj: 'Müşteri başarıyla eklendi!' });

    } catch (err) {
        console.error("Müşteri Kayıt Hatası:", err);
        res.status(500).json({ success: false, hata: 'Veritabanı hatası: ' + err.message });
    }
});
// STOK GÜNCELLEME API
app.put('/api/komur/:id', async (req, res) => {
    const id = req.params.id;
    const { UrunAdi, TonFiyati, MevcutStok, EsikAlt, EsikUst } = req.body;

    try {
        await ensureStokEsikKolonlari();
        const query = `
            UPDATE [komur].[dbo].[StokListesi]
            SET UrunAdi = @urunAdi, 
                SatisFiyati = @fiyat, 
                BaslangicStogu = @miktar,
                EsikAlt = @esikAlt,
                EsikUst = @esikUst
            WHERE ID = @id
        `;
        const request = new sql.Request();
        request.input('id', sql.Int, id);
        request.input('urunAdi', sql.NVarChar, UrunAdi);
        request.input('fiyat', sql.Decimal(18,2), TonFiyati);
        request.input('miktar', sql.Decimal(18,2), MevcutStok);
        request.input('esikAlt', sql.Decimal(18,2), EsikAlt);
        request.input('esikUst', sql.Decimal(18,2), EsikUst);

        await request.query(query);
        res.status(200).json({ mesaj: 'Ürün başarıyla güncellendi.' });
    } catch (err) {
        console.error("Güncelleme Hatası:", err);
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
    const { islemiYapan, odemeTuru, odenenTutar, musteriId } = req.body; 

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
                .query(`
                    DECLARE @EskiBakiye DECIMAL(18,2);
                    SELECT @EskiBakiye = ISNULL(SUM(BORÇ) - SUM(ÖDEME), 0) FROM [komur].[dbo].[MusteriHareket] WHERE Kisi = @kisi;
                    INSERT INTO [komur].[dbo].[MusteriHareket] (Kisi, YIL, AÇIKLAMA, ADET, BİRİM, BORÇ, ÖDEME, TARİH, IslemiYapan, MakbuzNo, ISLEM_BAKIYESI)
                    VALUES (@kisi, YEAR(GETDATE()), @aciklama, 0, 0, 0, @tutar, GETDATE(), @yapan, @mNo, @EskiBakiye - @tutar);
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
    
    try {
        const pool = await sql.connect(config);

        // 🚨 OTOMATİK SÜPÜRGE: Yeni plan yapmadan önce eski ödenmemiş (DURUM='0') taksitleri siliyoruz
        // Böylece 400 Hatası (Zaten plan var) almazsın, sistem eskisini silip yenisini yazar.
        await pool.request()
            .input('kisi', sql.Int, musteri_id)
            .query("DELETE FROM [komur].[dbo].[TAKSIT] WHERE kişi = @kisi AND DURUM = '0'");

        // 🎯 KURUŞ HASSASİYETİ (0.01 Hatasını Öldüren Kısım)
        // Toplam tutarı kuruşa çevirip bölüyoruz, sonra tekrar liraya çeviriyoruz
        const toplamKurus = Math.round(parseFloat(toplam_tutar) * 100);
        const birimTaksitKurus = Math.floor(toplamKurus / parseInt(taksit_sayisi));
        let sonTaksitKurus = toplamKurus - (birimTaksitKurus * (parseInt(taksit_sayisi) - 1));

        let vadeTarihi = new Date(baslangic_tarihi);

        for (let i = 1; i <= taksit_sayisi; i++) {
            // Son taksitte kuruş farkı kalmasın diye dengeleme yapıyoruz
            const guncelMiktar = (i === parseInt(taksit_sayisi) ? sonTaksitKurus : birimTaksitKurus) / 100;

            const request = pool.request();
            request.input('kisi', sql.Int, musteri_id);
            request.input('miktar', sql.Decimal(18, 2), guncelMiktar);
            request.input('aciklama', taksit_sayisi == 1 ? "Vadeli Borç" : `${i}/${taksit_sayisi}`);
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
app.delete('/api/taksit-plani-tumunu-sil/:kisiId', async (req, res) => {
    const musteriId = req.params.kisiId;
    try {
        const pool = await sql.connect(config);
        // Sadece bu kişiye ait (kişi = @id) olanları siler
        await pool.request()
            .input('id', sql.Int, musteriId)
            .query("DELETE FROM [komur].[dbo].[TAKSIT] WHERE kişi = @id");
            
        res.json({ success: true, mesaj: "Müşterinin planı temizlendi." });
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

    // --- SAAT KORUMASI (METİN OLARAK KİLİTLENDİ) ---
    let islemTarihiStr = tarih;
    if (!islemTarihiStr || islemTarihiStr === "" || islemTarihiStr === "undefined") {
        let simdi = new Date();
        let trZamani = new Date(simdi.toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
        const pad = (n) => n.toString().padStart(2, '0');
        islemTarihiStr = `${trZamani.getFullYear()}-${pad(trZamani.getMonth()+1)}-${pad(trZamani.getDate())} ${pad(trZamani.getHours())}:${pad(trZamani.getMinutes())}:${pad(trZamani.getSeconds())}`;
    } else {
        islemTarihiStr = String(islemTarihiStr).replace('T', ' ').replace('Z', '').trim();
    }

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
    // BURASI DÜZELTİLDİ: tedarikciId ve tedarikciFirma ayrı ayrı alınıyor
    const { tarih, tedarikciId, tedarikciFirma, urunId, miktar, birimFiyat, odeme, aciklama, islemiYapan } = req.body;
    const toplamTutar = miktar * birimFiyat;

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // BURASI DÜZELTİLDİ: TedarikciID ve TedarikciFirma SQL'e doğru sütunlarda gidiyor
            await transaction.request()
                .input('tarih', sql.NVarChar, tarih || new Date().toISOString().split('T')[0])
                .input('tId', sql.Int, tedarikciId)           // ID Sütunu
                .input('tFirma', sql.NVarChar, tedarikciFirma) // İsim Sütunu
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), miktar)
                .input('b', sql.Decimal(18,2), birimFiyat)
                .input('top', sql.Decimal(18,2), toplamTutar)
                .input('o', sql.NVarChar, odeme)
                .input('a', sql.NVarChar, aciklama)
                .input('y', sql.NVarChar, islemiYapan)
                .query(`INSERT INTO [komur].[dbo].[MalAlimlari] 
                       (Tarih, TedarikciID, TedarikciFirma, UrunID, Miktar, BirimMaliyet, ToplamTutar, OdemeDurumu, Aciklama, IslemiYapan) 
                        VALUES (@tarih, @tId, @tFirma, @u, @m, @b, @top, @o, @a, @y)`);

            // ... (Stoğu güncelleyen kodlar aynı kalacak, buraya dokunma) ...

            // 2. Stoğu ve Alış Fiyatını Güncelle (Ortalama Maliyet Zekası)
            await transaction.request()
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), miktar)
                .input('b', sql.Decimal(18,2), birimFiyat)
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
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT 
                M.ID, M.Tarih, M.TedarikciFirma, M.UrunID, S.UrunAdi, 
                M.Miktar, M.BirimMaliyet, M.ToplamTutar, M.OdemeDurumu, M.Aciklama, M.IslemiYapan
            FROM [komur].[dbo].[MalAlimlari] M
            LEFT JOIN [komur].[dbo].[StokListesi] S ON M.UrunID = S.ID
            ORDER BY M.Tarih DESC
        `);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ hata: err.message }); }
});

// --- 3. DÜZENLEME (GÜNCELLEME) API (YEPYENİ EKLENDİ) ---
app.put('/api/mal-alimi/:id', async (req, res) => {
    const { tarih, tedarikci, urunId, miktar, birimFiyat, odeme, aciklama, islemiYapan } = req.body;
    const alimId = req.params.id;
    const toplamTutar = miktar * birimFiyat;

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Eski miktarı bulalım ki aradaki farkı hesaplayalım
            const eskiKayit = await transaction.request()
                .input('id', sql.Int, alimId)
                .query(`SELECT UrunID, Miktar FROM [komur].[dbo].[MalAlimlari] WHERE ID = @id`);
                
            const eskiMiktar = eskiKayit.recordset[0].Miktar;
            const miktarFarki = miktar - eskiMiktar; // Örneğin: 10'du, 15 yaptık. Fark: +5 ton.

            // 2. Faturayı (MalAlimlari) Güncelle
            await transaction.request()
                .input('id', sql.Int, alimId)
                .input('tarih', sql.NVarChar, tarih)
                .input('t', sql.NVarChar, tedarikci)
                .input('u', sql.Int, urunId)
                .input('m', sql.Decimal(18,2), miktar)
                .input('b', sql.Decimal(18,2), birimFiyat)
                .input('top', sql.Decimal(18,2), toplamTutar)
                .input('o', sql.NVarChar, odeme)
                .input('a', sql.NVarChar, aciklama)
                .query(`
                    UPDATE [komur].[dbo].[MalAlimlari] SET 
                        Tarih=@tarih, TedarikciFirma=@t, UrunID=@u, Miktar=@m, 
                        BirimMaliyet=@b, ToplamTutar=@top, OdemeDurumu=@o, Aciklama=@a 
                    WHERE ID=@id
                `);

            // 3. Stok Miktarını ve Fiyatını Fark Kadar Düzelt
            await transaction.request()
                .input('u', sql.Int, urunId)
                .input('fark', sql.Decimal(18,2), miktarFarki)
                .input('b', sql.Decimal(18,2), birimFiyat)
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
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT T.*, 
            (SELECT ISNULL(SUM(ToplamTutar),0) FROM MalAlimlari WHERE TedarikciID = T.ID) - 
            (SELECT ISNULL(SUM(OdenenTutar),0) FROM TedarikciOdemeleri WHERE TedarikciID = T.ID) as Bakiye
            FROM Tedarikciler T
        `);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ hata: err.message }); }
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
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT ID, Tur, Tarih, Islem, Miktar, BirimFiyat, Borc, Odeme, Aciklama FROM (
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
                        M.Aciklama 
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
                        Aciklama 
                    FROM [komur].[dbo].[TedarikciOdemeleri]
                    WHERE TedarikciID = @id
                ) AS Hareketler
                ORDER BY Tarih ASC
            `);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ hata: err.message }); }
});// --- ÜRÜNE ÖZEL MAL ALIM GEÇMİŞİ API'Sİ ---
app.get('/api/urun-alimlari/:id', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT TOP 50
                    Tarih, 
                    ISNULL(TedarikciFirma, 'Bilinmeyen Toptancı') as Firma, 
                    Miktar, 
                    BirimMaliyet as Fiyat 
                FROM [komur].[dbo].[MalAlimlari] 
                WHERE UrunID = @id 
                ORDER BY Tarih DESC
            `);
        res.json(result.recordset);
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
    // BURASI DÜZELTİLDİ: "tarih" verisini de req.body'den alıyoruz
    const { tedarikciId, tarih, tutar, tur, aciklama } = req.body;
    
    // Eğer ön yüzden tarih gelmezse güvenlik amaçlı bugünü al
    const islemTarihi = tarih || new Date().toISOString().split('T')[0];

    try {
        const pool = await sql.connect(config);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await transaction.request()
                .input('tId', sql.Int, tedarikciId)
                .input('tar', sql.NVarChar, islemTarihi) // islemTarihi olarak değiştirdik
                .input('tut', sql.Decimal(18,2), tutar)
                .input('tur', sql.NVarChar, tur)
                .input('aci', sql.NVarChar, aciklama)
                .query(`INSERT INTO [komur].[dbo].[TedarikciOdemeleri] (TedarikciID, Tarih, OdenenTutar, OdemeTuru, Aciklama) 
                        VALUES (@tId, @tar, @tut, @tur, @aci)`);
            
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
    const { musteriId, tutar, odemeTuru, aciklama, tarih, islemiYapan, islemBakiyesi } = req.body;

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
            await transaction.request()
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
                        VALUES (@mId, @tut, @aci, @tar, YEAR(GETDATE()), @mNo, @yapan, @bak)`);

            await transaction.commit(); 
            res.json({ success: true, makbuzNo: formatliMakbuzNo });

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
    sunucuyuBaslat();
}

module.exports = { app, sunucuyuBaslat };