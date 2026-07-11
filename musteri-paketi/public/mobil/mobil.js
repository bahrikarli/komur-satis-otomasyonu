(function () {
    const STORAGE_SERVER = 'komurMobilSunucu';
    const STORAGE_SESSION = 'komurMobilOturum';

    let musteriCache = [];
    let tedarikciCache = [];
    let stokCache = [];
    let aktifMusteri = null;
    let aktifTedarikci = null;
    let aktifMusteriEkstreRows = [];
    let guncelToplamTaksitBorcu = 0;
    let aktifTaksitlerCache = [];
    let musteriNotUyariKuyruk = [];
    let musteriNotUyariIdx = 0;
    let raporMod = '';
    let raporVeriler = [];
    let overlayGeriHedef = null;
    let sonEkstreDosyaAd = 'Cari_Ekstre.pdf';
    let aktifPanel = 'ana';

    function $(id) { return document.getElementById(id); }

    function sunucuUrl() {
        const kayitli = localStorage.getItem(STORAGE_SERVER);
        if (kayitli) return kayitli.replace(/\/$/, '');
        return window.location.origin.replace(/\/$/, '');
    }

    function sunucuKaydet(url) {
        const u = String(url || '').trim().replace(/\/$/, '');
        if (!u) throw new Error('Adres boş olamaz.');
        localStorage.setItem(STORAGE_SERVER, u);
        return u;
    }

    function oturumOku() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_SESSION) || 'null');
        } catch {
            return null;
        }
    }

    function oturumYaz(data) {
        sessionStorage.setItem(STORAGE_SESSION, JSON.stringify(data));
    }

    function oturumTemizle() {
        sessionStorage.removeItem(STORAGE_SESSION);
    }

    async function apiFetch(yol, opts) {
        return fetch(sunucuUrl() + yol, opts);
    }

    async function apiJson(res, varsayilanHata) {
        const metin = await res.text();
        if (!metin.trim()) {
            if (!res.ok) throw new Error(varsayilanHata || `HTTP ${res.status}`);
            return {};
        }
        try {
            return JSON.parse(metin);
        } catch {
            if (metin.trimStart().startsWith('<')) {
                throw new Error('Sunucu HTML döndü — adres veya API eksik. Sunucuyu yeniden başlatın.');
            }
            throw new Error(varsayilanHata || 'Sunucu yanıtı okunamadı');
        }
    }

    function formatSayi(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return '0';
        return x.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    }

    function formatPara(n) {
        return formatSayi(n) + ' ₺';
    }

    const TZ_IST = 'Europe/Istanbul';

    function istanbulBilesenler(ref = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: TZ_IST,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(ref);
        const get = (t) => parts.find((p) => p.type === t)?.value || '00';
        return {
            year: get('year'),
            month: get('month'),
            day: get('day'),
            hour: get('hour'),
            minute: get('minute'),
            second: get('second')
        };
    }

    function bugunIso() {
        const p = istanbulBilesenler();
        return `${p.year}-${p.month}-${p.day}`;
    }

    function dbTarihTemizle(v) {
        return String(v ?? '').trim().replace(/\.\d{3}Z?$/i, '').replace(/Z$/i, '').replace('T', ' ');
    }

    function parseDbTarihParcala(v) {
        const s = dbTarihTemizle(v);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (!m) return null;
        return {
            y: +m[1],
            mo: +m[2],
            d: +m[3],
            h: +(m[4] || 0),
            mi: +(m[5] || 0),
            se: +(m[6] || 0)
        };
    }

    function dbTarihSortKey(v) {
        const p = parseDbTarihParcala(v);
        if (!p) return 0;
        return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.se);
    }

    function mobilAdminMi() {
        const y = (oturumOku()?.yetki || '').toLowerCase();
        return y === 'admin';
    }

    function tarihIsoGoster(iso) {
        if (!iso) return '—';
        const p = String(iso).split('-');
        if (p.length !== 3) return iso;
        return `${p[2]}.${p[1]}.${p[0]}`;
    }

    function gunlukOzetAralikMetni(bas, bit) {
        if (bas === bit) {
            const d = new Date(bas + 'T12:00:00');
            if (!Number.isNaN(d.getTime())) {
                return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            }
            return tarihIsoGoster(bas);
        }
        return `${tarihIsoGoster(bas)} – ${tarihIsoGoster(bit)}`;
    }

    function gunlukOzetTarihleriIlk() {
        const bugun = bugunIso();
        const bas = $('bugunBaslangic');
        const bit = $('bugunBitis');
        if (bas) bas.value = bugun;
        if (bit) bit.value = bugun;
    }

    function gunlukOzetYetkiAyarla() {
        const filtre = document.querySelector('.gunluk-tarih-filtre');
        const bitisWrap = $('bugunBitisWrap');
        const basLbl = $('bugunBaslangicLbl');
        const admin = mobilAdminMi();
        if (filtre) filtre.classList.toggle('gunluk-tarih-filtre--tek', !admin);
        if (bitisWrap) bitisWrap.style.display = admin ? '' : 'none';
        if (basLbl) basLbl.textContent = admin ? 'Başlangıç' : 'Tarih';
    }

    function hareketlerdenSatisAdet(hareketler) {
        let komur = 0;
        let un = 0;
        (hareketler || []).forEach((h) => {
            const borc = Number(h.BORÇ) || 0;
            if (borc <= 0) return;
            const adet = Number(h.ADET) || 0;
            const acik = String(h.AÇIKLAMA || '').toUpperCase();
            if (acik.includes('UN')) un += adet;
            else komur += adet;
        });
        return { komur, un };
    }

    function hareketlerdenTahsilatKirilim(hareketler) {
        let nakit = 0;
        let kart = 0;
        let havale = 0;
        (hareketler || []).forEach((h) => {
            const odeme = Number(h.ÖDEME) || 0;
            if (odeme <= 0) return;
            const aciklama = String(h.AÇIKLAMA || '').toLowerCase();
            if (aciklama.includes('kart') || aciklama.includes('kredi')) kart += odeme;
            else if (aciklama.includes('havale') || aciklama.includes('eft')) havale += odeme;
            else if (!aciklama.includes('iade')) nakit += odeme;
        });
        return { nakit, kart, havale };
    }

    function gunlukOzetRozetHtml(opts) {
        const { komur, un, nakit, kart, havale, toplamBorc, toplamOdeme, toplamGider, netKasa } = opts;
        return `
            <div class="oz oz--mini">
                <div class="oz-baslik">Birim satış</div>
                <div class="oz-satir"><span>Kömür</span><b>${formatSayi(komur)}</b></div>
                <div class="oz-satir"><span>Un</span><b>${formatSayi(un)}</b></div>
            </div>
            <div class="oz oz--mini">
                <div class="oz-baslik">Tahsilat dağılımı</div>
                <div class="oz-satir"><span>Nakit</span><b>${formatPara(nakit)}</b></div>
                <div class="oz-satir"><span>Kart</span><b>${formatPara(kart)}</b></div>
                <div class="oz-satir"><span>Havale</span><b>${formatPara(havale)}</b></div>
            </div>
            <div class="oz oz--mini">
                <div class="oz-baslik">Kasa özeti</div>
                <div class="oz-satir"><span>Satış</span><b class="oz-v-borc">${formatPara(toplamBorc)}</b></div>
                <div class="oz-satir"><span>Tahsilat</span><b class="oz-v-odeme">${formatPara(toplamOdeme)}</b></div>
                <div class="oz-satir"><span>Gider</span><b class="oz-v-gider">${formatPara(toplamGider)}</b></div>
            </div>
            <div class="oz oz--mini oz--net">
                <div class="oz-baslik">Net kasa</div>
                <div class="oz-net-deger">${formatPara(netKasa)}</div>
                <div class="oz-net-alt">Tahsilat − Gider</div>
            </div>`;
    }

    function gunlukOzetHareketKarti(h) {
        const musteriHtml = musteriKimlikHtml(h);
        const borc = Number(h.BORÇ) || 0;
        const odeme = Number(h.ÖDEME) || 0;
        let tutarHtml = '—';
        if (borc > 0) tutarHtml = `<span class="borc">+${formatPara(borc)}</span>`;
        else if (odeme > 0) tutarHtml = `<span class="odeme">-${formatPara(odeme)}</span>`;

        let aciklama = h.AÇIKLAMA || '—';
        let miktar = Number(h.ADET) || 0;
        const birim = (h.birimtür || h.BirimTur || '').trim();
        if (aciklama.includes(' x ')) {
            const parcalar = aciklama.split(' x ');
            if (miktar === 0) miktar = parseFloat(parcalar[0]) || 0;
            aciklama = parcalar.slice(1).join(' x ').trim() || aciklama;
        }
        if (h.notlar && String(h.notlar).trim()) {
            aciklama += ` · ${h.notlar}`;
        }

        let miktarHtml = '';
        if (borc > 0 && miktar > 0) {
            const bf = borc / miktar;
            const birimLbl = birim || 'adet';
            miktarHtml = `<div class="bugun-miktar">${formatSayi(miktar)} ${ekstreRaporKacis(birimLbl)} · ${formatPara(bf)}/${ekstreRaporKacis(birimLbl)}</div>`;
        } else if (borc > 0 && birim) {
            miktarHtml = `<div class="bugun-miktar">${ekstreRaporKacis(birim)}</div>`;
        }

        const yapan = h.IslemiYapan ? ekstreRaporKacis(h.IslemiYapan) : '';
        return `<div class="bugun-item">
            <div class="bugun-sol">
                ${musteriHtml}
                ${yapan ? `<div class="bugun-yapan">${yapan}</div>` : ''}
            </div>
            <div class="bugun-sag">
                <div class="bugun-tarih">${ekstreRaporKacis(tarihGoster(h.TARİH))}</div>
                <div class="bugun-aciklama">${ekstreRaporKacis(aciklama)}</div>
                ${miktarHtml}
                <div class="bugun-tutar">${tutarHtml}</div>
            </div>
        </div>`;
    }

    function gunlukOzetGiderKarti(g) {
        const kasadanCikar = g.IslemTipi !== 'Mazot Çıkışı';
        const tutar = kasadanCikar ? (Number(g.Tutar) || 0) : 0;
        const baslik = g.FirmaKisi || 'Gider';
        const aciklama = [g.Kategori, g.Aciklama].filter(Boolean).join(' · ') || '—';
        const tutarHtml = tutar > 0
            ? `<span class="borc">-${formatPara(tutar)}</span>`
            : '<span class="text-muted">—</span>';
        return `<div class="bugun-item bugun-item--gider">
            <div class="bugun-sol">
                <div class="bugun-musteri">${ekstreRaporKacis(baslik)}</div>
                <div class="bugun-musteri-alt"><span class="gider-rozet">GİDER</span></div>
            </div>
            <div class="bugun-sag">
                <div class="bugun-tarih">${ekstreRaporKacis(tarihGoster(g.Tarih))}</div>
                <div class="bugun-aciklama">${ekstreRaporKacis(aciklama)}</div>
                <div class="bugun-tutar">${tutarHtml}</div>
            </div>
        </div>`;
    }

    function tarihGoster(v, sadeceTarih = false) {
        if (!v) return '—';
        const ham = String(v);
        if (/Z$/i.test(ham) || /[+-]\d{2}:\d{2}$/.test(ham)) {
            const d = new Date(ham);
            if (Number.isNaN(d.getTime())) return ham;
            return new Intl.DateTimeFormat('tr-TR', {
                timeZone: TZ_IST,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: sadeceTarih ? undefined : '2-digit',
                minute: sadeceTarih ? undefined : '2-digit',
                hour12: false
            }).format(d);
        }
        const p = parseDbTarihParcala(v);
        if (!p) return String(v);
        const gun = String(p.d).padStart(2, '0');
        const ay = String(p.mo).padStart(2, '0');
        const saat = String(p.h).padStart(2, '0');
        const dk = String(p.mi).padStart(2, '0');
        if (sadeceTarih || (p.h === 0 && p.mi === 0 && p.se === 0)) {
            return `${gun}.${ay}.${p.y}`;
        }
        return `${gun}.${ay}.${p.y} ${saat}:${dk}`;
    }

    function musteriKimlikGosterim(kayit) {
        const unvan = String(kayit?.Unvan ?? kayit?.UNVAN ?? '').replace(/null/gi, '').trim();
        const adi = String(kayit?.Adı ?? kayit?.ADI ?? '').replace(/null/gi, '').trim();
        const soyadi = String(kayit?.Soyadı ?? kayit?.SOYADI ?? '').replace(/null/gi, '').trim();
        const adSoyad = [adi, soyadi].filter(Boolean).join(' ').trim();
        if (unvan) {
            const alt = adSoyad && adSoyad.localeCompare(unvan, 'tr', { sensitivity: 'accent' }) !== 0 ? adSoyad : '';
            return { ana: unvan, alt };
        }
        return { ana: adSoyad || 'Müşteri', alt: '' };
    }

    function musteriKimlikHtml(kayit) {
        const g = musteriKimlikGosterim(kayit);
        if (g.alt) {
            return `<div class="bugun-musteri">${ekstreRaporKacis(g.ana)}</div><div class="bugun-musteri-alt">${ekstreRaporKacis(g.alt)}</div>`;
        }
        return `<div class="bugun-musteri">${ekstreRaporKacis(g.ana)}</div>`;
    }

    function musteriAdi(m) {
        return musteriKimlikGosterim(m).ana;
    }

    function musteriTelMahalleMeta(m) {
        const tel = String(m?.CEPTEL ?? '').trim();
        const telG = tel && tel !== '-' ? tel : '';
        const mah = String(m?.Mahalle ?? m?.MAHALLE ?? '').trim();
        const parcalar = [telG, mah].filter(Boolean);
        return parcalar.length ? parcalar.join(' · ') : '—';
    }

    function musteriListeKimlikHtml(kayit) {
        const g = musteriKimlikGosterim(kayit);
        if (g.alt) {
            return `<div class="musteri-item-ad">${ekstreRaporKacis(g.ana)}</div><div class="musteri-item-ad-alt">${ekstreRaporKacis(g.alt)}</div>`;
        }
        return `<div class="musteri-item-ad">${ekstreRaporKacis(g.ana)}</div>`;
    }

    function musteriDetayKimlikHtml(kayit) {
        const g = musteriKimlikGosterim(kayit);
        if (g.alt) {
            return `<span class="musteri-detay-ana">${ekstreRaporKacis(g.ana)}</span><span class="musteri-detay-alt">${ekstreRaporKacis(g.alt)}</span>`;
        }
        return `<span class="musteri-detay-ana">${ekstreRaporKacis(g.ana)}</span>`;
    }

    function musteriAlanOku(kayit, ...anahtarlar) {
        if (!kayit) return '';
        for (const a of anahtarlar) {
            const v = kayit[a];
            if (v != null && String(v).trim() && String(v).toLowerCase() !== 'null') {
                return String(v).trim();
            }
        }
        return '';
    }

    function musteriDetayBaslikGuncelle(m) {
        $('musteriDetayAd').innerHTML = musteriDetayKimlikHtml(m);
        $('musteriDetayMeta').textContent = musteriTelMahalleMeta(m);
    }

    function musteriCacheGuncelle(guncel) {
        const id = musteriKimlik(guncel);
        if (!id) return;
        const idx = musteriCache.findIndex((x) => musteriKimlik(x) === id);
        if (idx >= 0) musteriCache[idx] = { ...musteriCache[idx], ...guncel };
        else musteriCache.push(guncel);
    }

    function kIlceListeSira() {
        if (window.KONYA_ILCELER_ALFABE && window.KONYA_ILCELER_ALFABE.length) {
            return window.KONYA_ILCELER_ALFABE;
        }
        const sozluk = window.ADRES_SOZLUGU_KONYA || {};
        return Object.keys(sozluk).sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
    }

    function mobilKonyaIlceDoldur(ilceEl, korunacakIlce) {
        if (!ilceEl) return;
        const list = kIlceListeSira();
        const kaynak = korunacakIlce != null ? String(korunacakIlce).trim() : String(ilceEl.value || '').trim();
        ilceEl.innerHTML = list.map((ilce) => {
            const guvenli = String(ilce).replace(/"/g, '&quot;');
            return `<option value="${guvenli}">${ilce}</option>`;
        }).join('');
        const uyumlu = [...ilceEl.options].find((o) => kaynak && (
            o.value === kaynak || o.value.localeCompare(kaynak, 'tr', { sensitivity: 'base' }) === 0
        ));
        if (uyumlu) {
            ilceEl.value = uyumlu.value;
            return;
        }
        if (kaynak) {
            const opt = document.createElement('option');
            opt.value = kaynak;
            opt.textContent = `${kaynak} (kayıtta)`;
            ilceEl.insertBefore(opt, ilceEl.firstChild);
            ilceEl.value = kaynak;
            return;
        }
        if (list.indexOf('Sarayönü') >= 0) ilceEl.value = 'Sarayönü';
        else if (list.length) ilceEl.value = list[0];
    }

    function mobilKonyaMahalleAyarla(mahalleEl, ilceDeger, mahalleKaydi) {
        if (!mahalleEl) return;
        const bic = typeof window.mahalleAdiniBiçimlendir === 'function'
            ? window.mahalleAdiniBiçimlendir
            : (x) => String(x || '').trim();
        const mHam = mahalleKaydi != null ? String(mahalleKaydi).trim() : '';
        const mNorm = mHam ? bic(mHam) : '';
        const sozluk = window.ADRES_SOZLUGU_KONYA || {};
        const mh = Array.isArray(sozluk[ilceDeger]) ? sozluk[ilceDeger] : [];

        if (mh.length === 0) {
            mahalleEl.innerHTML = '';
            if (mHam) {
                mahalleEl.disabled = false;
                mahalleEl.appendChild(new Option('Mahalle seçin…', ''));
                mahalleEl.appendChild(new Option(`${mNorm} (kayıttaki)`, mNorm));
                mahalleEl.value = mNorm;
            } else {
                mahalleEl.disabled = true;
                mahalleEl.appendChild(new Option('Bu ilçe için mahalle listesi yok', '', true, true));
            }
            return;
        }

        mahalleEl.disabled = false;
        mahalleEl.innerHTML = '<option value="">Mahalle seçin…</option>';
        mh.forEach((m) => mahalleEl.appendChild(new Option(m, m)));

        const bul = mHam
            ? [...mahalleEl.options].find((o) => o.value && (
                o.value === mNorm || o.value.localeCompare(mNorm, 'tr', { sensitivity: 'base' }) === 0
            ))
            : null;
        if (bul) {
            mahalleEl.value = bul.value;
            return;
        }
        if (mHam) {
            mahalleEl.appendChild(new Option(`${mNorm} (kayıtta)`, mNorm));
            mahalleEl.value = mNorm;
            return;
        }
        mahalleEl.value = '';
    }

    function mobilKonyaAdresYukle(prefix, ilceKaydi, mahalleKaydi) {
        const ilceEl = $(`${prefix}Ilce`);
        const mahEl = $(`${prefix}MahalleListe`);
        if (!ilceEl || !mahEl) return;
        mobilKonyaIlceDoldur(ilceEl, ilceKaydi || 'Sarayönü');
        mobilKonyaMahalleAyarla(mahEl, ilceEl.value, mahalleKaydi);
        const okKey = `mobilKonyaOk_${prefix}`;
        if (!ilceEl.dataset[okKey]) {
            ilceEl.dataset[okKey] = '1';
            ilceEl.addEventListener('change', () => mobilKonyaMahalleAyarla(mahEl, ilceEl.value, ''));
        }
    }

    function mobilKonyaAdresOku(prefix) {
        const ilceEl = $(`${prefix}Ilce`);
        const mahEl = $(`${prefix}MahalleListe`);
        const ilce = (ilceEl?.value || '').trim();
        const ham = mahEl && !mahEl.disabled ? (mahEl.value || '').trim() : '';
        const bic = typeof window.mahalleAdiniBiçimlendir === 'function'
            ? window.mahalleAdiniBiçimlendir
            : (x) => String(x || '').trim();
        return { ilce, mahalle: ham ? bic(ham) : '' };
    }

    function musteriFormTelefonBagla(telEl) {
        if (!telEl) return;
        telEl.oninput = function () {
            let val = this.value.replace(/[^0-9]/g, '');
            if (val.startsWith('0')) val = val.substring(1);
            this.value = val.substring(0, 10);
        };
    }

    function musteriFormUnvanBagla(unvanEl) {
        if (!unvanEl) return;
        unvanEl.oninput = function () {
            this.value = this.value.toLocaleUpperCase('tr-TR');
        };
    }

    function musteriFormVeriOku(prefix) {
        const ad = ($(`${prefix}Ad`)?.value || '').trim();
        const tel = musteriTelefonTemizle($(`${prefix}Telefon`)?.value || '');
        const unvan = ($(`${prefix}Unvan`)?.value || '').trim();
        const adres = ($(`${prefix}Adres`)?.value || '').trim();
        const { ilce, mahalle } = mobilKonyaAdresOku(prefix);
        return { ad, tel, unvan, adres, ilce, mahalle };
    }

    function musteriTelefonTemizle(ham) {
        let t = String(ham ?? '').replace(/[^0-9]/g, '');
        if (t.startsWith('0')) t = t.substring(1);
        return t.substring(0, 10);
    }

    function musteriDuzenleFormDoldur(m) {
        const unvanEl = $('mDuzenleUnvan');
        const adEl = $('mDuzenleAd');
        const telEl = $('mDuzenleTelefon');
        const adresEl = $('mDuzenleAdres');
        if (unvanEl) unvanEl.value = musteriAlanOku(m, 'Unvan', 'UNVAN', 'unvan');
        if (adEl) adEl.value = musteriAlanOku(m, 'Adı', 'ADI', 'ad');
        if (telEl) telEl.value = musteriTelefonTemizle(musteriAlanOku(m, 'CEPTEL', 'ceptel', 'Telefon'));
        if (adresEl) adresEl.value = musteriAlanOku(m, 'Adres', 'ADRES', 'adres');
        musteriFormUnvanBagla(unvanEl);
        musteriFormTelefonBagla(telEl);
        mobilKonyaAdresYukle(
            'mDuzenle',
            musteriAlanOku(m, 'Ilce', 'ILCE', 'ilce') || 'Sarayönü',
            musteriAlanOku(m, 'Mahalle', 'MAHALLE', 'mahalle')
        );
    }

    function musteriEkleFormTemizle() {
        ['mEkleUnvan', 'mEkleAd', 'mEkleTelefon', 'mEkleAdres'].forEach((id) => {
            const el = $(id);
            if (el) el.value = '';
        });
        musteriFormUnvanBagla($('mEkleUnvan'));
        musteriFormTelefonBagla($('mEkleTelefon'));
        mobilKonyaAdresYukle('mEkle', 'Sarayönü', '');
    }

    function musteriEkleAc() {
        musteriEkleFormTemizle();
        modalAc('modal-musteri-ekle');
        setTimeout(() => $('mEkleUnvan')?.focus(), 200);
    }

    async function musteriEkleKaydet() {
        const { ad, tel, unvan, adres, ilce, mahalle } = musteriFormVeriOku('mEkle');

        if (!unvan) {
            toast('Resmi ünvan zorunludur');
            $('mEkleUnvan')?.focus();
            return;
        }
        if (!tel) {
            toast('Telefon numarası zorunludur');
            $('mEkleTelefon')?.focus();
            return;
        }
        if (tel.length !== 10) {
            toast('Telefonu başında 0 olmadan 10 hane girin');
            $('mEkleTelefon')?.focus();
            return;
        }

        const unvanNorm = unvan.toLocaleUpperCase('tr-TR');
        const varMi = musteriCache.find((m) => {
            const mTel = musteriTelefonTemizle(musteriAlanOku(m, 'CEPTEL', 'ceptel', 'Telefon'));
            const mUnvan = musteriAlanOku(m, 'Unvan', 'UNVAN', 'unvan').toLocaleUpperCase('tr-TR');
            return mTel === tel && mUnvan === unvanNorm && unvanNorm !== '';
        });
        if (varMi && !confirm(`Bu ünvan ve telefonla kayıt var (${varMi.Unvan || varMi.Adı}). Yine de eklensin mi?`)) {
            return;
        }

        const btn = $('btnMusteriEkleKaydet');
        if (btn) btn.disabled = true;
        try {
            const res = await apiFetch('/api/musteri', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_soyad: ad,
                    unvan,
                    telefon: tel,
                    adres,
                    ilce,
                    mahalle
                })
            });
            const data = await apiJson(res, 'Müşteri eklenemedi');
            if (!res.ok || data.success === false) {
                throw new Error(data.hata || data.mesaj || 'Müşteri eklenemedi');
            }

            modalKapat('modal-musteri-ekle');
            toast('Müşteri eklendi');
            await musteriYukle();

            const yeni = musteriCache.find((m) => {
                const mTel = musteriTelefonTemizle(musteriAlanOku(m, 'CEPTEL', 'ceptel', 'Telefon'));
                const mUnvan = musteriAlanOku(m, 'Unvan', 'UNVAN', 'unvan').toLocaleUpperCase('tr-TR');
                return mTel === tel && mUnvan === unvanNorm;
            });
            if (yeni) {
                overlayGeriHedef = null;
                await musteriDetayAc(musteriKimlik(yeni));
            }
        } catch (err) {
            toast(err.message || 'Müşteri eklenemedi');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function musteriDuzenleAc() {
        if (!aktifMusteri) {
            toast('Önce müşteri seçin');
            return;
        }
        musteriMenuKapat();
        musteriDuzenleFormDoldur(aktifMusteri);
        modalAc('modal-musteri-duzenle');
    }

    async function musteriDuzenleKaydet() {
        if (!aktifMusteri) return;
        const mid = musteriKimlik(aktifMusteri);
        const ad = ($('mDuzenleAd')?.value || '').trim();
        const tel = musteriTelefonTemizle($('mDuzenleTelefon')?.value || '');
        const unvan = ($('mDuzenleUnvan')?.value || '').trim();
        const adres = ($('mDuzenleAdres')?.value || '').trim();
        const { ilce, mahalle } = mobilKonyaAdresOku('mDuzenle');

        if (tel && tel.length !== 10) {
            toast("Telefonu başında 0 olmadan 10 hane girin");
            return;
        }

        const btn = $('btnMusteriDuzenleKaydet');
        if (btn) btn.disabled = true;
        try {
            const res = await apiFetch(`/api/musteri-guncelle/${mid}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad,
                    telefon: tel,
                    unvan,
                    adres,
                    ilce,
                    mahalle
                })
            });
            const data = await apiJson(res, 'Kayıt güncellenemedi');
            if (!res.ok) throw new Error(data?.hata || 'Kayıt güncellenemedi');

            const guncel = {
                ...aktifMusteri,
                Adı: ad,
                CEPTEL: tel || '-',
                Unvan: unvan,
                Adres: adres,
                Ilce: ilce,
                Mahalle: mahalle
            };
            aktifMusteri = guncel;
            musteriCacheGuncelle(guncel);
            musteriDetayBaslikGuncelle(guncel);
            musteriFiltrele($('musteriAra')?.value || '');
            modalKapat('modal-musteri-duzenle');
            toast('Müşteri bilgileri güncellendi');
        } catch (err) {
            toast(err.message || 'Kayıt güncellenemedi');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function musteriKimlik(m) {
        return Number(m.Kimlik ?? m.kimlik ?? m.ID ?? m.id ?? 0) || 0;
    }

    function stokSeviye(miktar, alt, ust) {
        const m = Number(miktar);
        const a = Number(alt);
        const u = Number(ust);
        if (!Number.isFinite(m) || !Number.isFinite(a) || !Number.isFinite(u) || u <= a) return 'Orta';
        if (m <= a) return 'Yetersiz';
        if (m >= u) return 'Yeterli';
        return 'Orta';
    }

    function badgeHtml(sev) {
        const s = sev === 'Yeterli' ? 'badge-yeterli' : sev === 'Yetersiz' ? 'badge-yetersiz' : 'badge-orta';
        return `<span class="badge ${s}">${sev}</span>`;
    }

    function viewGoster(viewId) {
        document.querySelectorAll('.view').forEach((v) => v.classList.remove('view-active'));
        const el = $(`view-${viewId}`);
        if (el) el.classList.add('view-active');
        overlayKapat();
    }

    function fabGeriGoster(goster) {
        const fab = $('btnFabGeri');
        if (fab) fab.classList.toggle('d-none', !goster);
        if (fab && goster) {
            fab.style.display = 'flex';
        } else if (fab) {
            fab.style.display = '';
        }
    }

    function geriTusGuncelle() {
        const overlayAcik = !!document.querySelector('.overlay.overlay-active');
        const ekstreAcik = $('ekstreOnizleme')?.classList.contains('active');
        const modalAcik = !!document.querySelector('.modal.modal-active');
        const topGeri = $('btnTopGeri');
        const gosterAnaGeri = !overlayAcik && !ekstreAcik && !modalAcik && aktifPanel !== 'ana';
        if (topGeri) topGeri.classList.toggle('d-none', !gosterAnaGeri);
        fabGeriGoster(overlayAcik || ekstreAcik || aktifPanel !== 'ana');
    }

    function fabGeriTikla() {
        if ($('ekstreOnizleme')?.classList.contains('active')) {
            ekstreOnizlemeKapat();
            return;
        }
        const aktifOverlay = document.querySelector('.overlay.overlay-active');
        if (aktifOverlay?.id === 'overlay-musteri' && overlayGeriHedef) {
            musteriOverlayKapat();
            return;
        }
        if (aktifOverlay) {
            overlayKapat();
            return;
        }
        if (aktifPanel !== 'ana') {
            panelGoster('ana');
        }
    }

    function musteriOverlayKapat() {
        if (overlayGeriHedef) {
            const hedef = overlayGeriHedef;
            overlayGeriHedef = null;
            musteriMenuKapat();
            overlayAc(hedef);
            return;
        }
        overlayKapat();
    }

    function overlayAc(id) {
        document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('overlay-active'));
        const el = $(id);
        if (el) el.classList.add('overlay-active');
        geriTusGuncelle();
    }

    function overlayKapat() {
        overlayGeriHedef = null;
        musteriMenuKapat();
        anaMenuKapat();
        document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('overlay-active'));
        modallariKapat();
        geriTusGuncelle();
    }

    function modalAc(id) {
        const el = $(id);
        if (el) el.classList.add('modal-active');
        geriTusGuncelle();
    }

    function modalKapat(id) {
        const el = $(id);
        if (el) el.classList.remove('modal-active');
        geriTusGuncelle();
    }

    function musteriMenuKapat() {
        const menu = $('musteriMenuDropdown');
        const btn = $('btnMusteriMenu');
        if (menu) menu.classList.add('d-none');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function anaMenuKapat() {
        const menu = $('anaMenuDropdown');
        const btn = $('btnAnaMenu');
        if (menu) menu.classList.add('d-none');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function anaMenuToggle() {
        const menu = $('anaMenuDropdown');
        const btn = $('btnAnaMenu');
        if (!menu || !btn) return;
        if (menu.classList.contains('d-none')) {
            menu.classList.remove('d-none');
            btn.setAttribute('aria-expanded', 'true');
        } else {
            anaMenuKapat();
        }
    }

    function raporVadeTarihGoster(ham) {
        return tarihGoster(ham, true);
    }

    function raporBaslikAyarla(mod) {
        const baslik = $('raporOverlayBaslik');
        const alt = $('raporOverlayAlt');
        if (mod === 'borclu') {
            if (baslik) baslik.textContent = 'Borçlu müşteriler';
            if (alt) alt.textContent = 'Bakiyesi olan müşteriler';
        } else {
            if (baslik) baslik.textContent = 'Vadesi gelen / geçen';
            if (alt) alt.textContent = 'Ödenmemiş taksit vadeleri';
        }
    }

    function raporListeFiltrele() {
        const q = ($('raporArama')?.value || '').toLocaleLowerCase('tr-TR').trim();
        if (!q) return raporVeriler;
        return raporVeriler.filter((r) => {
            const blob = [r._arama, r.Adı, r.CEPTEL, r.AÇIKLAMA].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
            return blob.includes(q);
        });
    }

    function raporOzetGuncelle(liste, toplam) {
        const sayi = $('raporKayitSayisi');
        const top = $('raporGenelToplam');
        if (sayi) sayi.textContent = String(liste.length);
        if (top) top.textContent = formatPara(toplam);
    }

    function raporListeCiz() {
        const el = $('raporListe');
        if (!el) return;
        const filtreli = raporListeFiltrele();
        let toplam = 0;
        filtreli.forEach((r) => { toplam += Number(r._tutar) || 0; });
        raporOzetGuncelle(filtreli, toplam);

        if (!filtreli.length) {
            el.innerHTML = '<div class="empty-msg">Kayıt bulunamadı</div>';
            return;
        }

        if (raporMod === 'borclu') {
            el.innerHTML = filtreli.map((m) => {
                const id = Number(m.Kimlik) || 0;
                const bakiye = Number(m.Bakiye) || 0;
                const cls = bakiye > 5000 ? 'rapor-item--borc-yuksek' : 'rapor-item--borc-orta';
                const tutarCls = bakiye > 5000 ? 'borc-yuksek' : 'borc-orta';
                const ad = ekstreRaporKacis(m.Adı || 'İsimsiz');
                const tel = ekstreRaporKacis(m.CEPTEL || '—');
                return `<div class="rapor-item ${cls}" data-mid="${id}" role="button" tabindex="0">
                    <div class="rapor-item-ust">
                        <div>
                            <div class="rapor-item-ad">${ad}</div>
                            <div class="rapor-item-tel">${tel}</div>
                        </div>
                        <div class="rapor-item-tutar ${tutarCls}">${formatPara(bakiye)}</div>
                    </div>
                </div>`;
            }).join('');
            return;
        }

        el.innerHTML = filtreli.map((r) => {
            const id = Number(r.MusteriID) || 0;
            const miktar = Number(r.MIKTAR) || 0;
            const gecikme = Number(r.GecikmeGunu) || 0;
            const cls = gecikme > 0 ? 'rapor-item--gecikme' : 'rapor-item--bugun';
            const vadeCls = gecikme > 0 ? '' : 'bugun';
            const uyari = gecikme > 0 ? `${gecikme} gün geçti` : 'Ödeme günü bugün';
            const hamTarih = r.TARIH || r.TARİH || r.ODEMETARİHİ || r.VADETARİHİ;
            return `<div class="rapor-item ${cls}" data-mid="${id}" role="button" tabindex="0">
                <div class="rapor-item-ust">
                    <div>
                        <div class="rapor-item-ad">${ekstreRaporKacis(r.Adı || 'İsimsiz')}</div>
                        <div class="rapor-item-tel">${ekstreRaporKacis(r.CEPTEL || '—')}</div>
                    </div>
                    <div class="rapor-item-tutar borc-yuksek">${formatPara(miktar)}</div>
                </div>
                <div class="rapor-item-alt">
                    <span class="rapor-item-vade ${vadeCls}">${raporVadeTarihGoster(hamTarih)}</span>
                    · ${ekstreRaporKacis(uyari)}
                    ${r.AÇIKLAMA ? `<br>${ekstreRaporKacis(r.AÇIKLAMA)}` : ''}
                </div>
                <span class="rapor-rozet">BEKLİYOR</span>
            </div>`;
        }).join('');
    }

    async function raporMusteriDetayAc(musteriId) {
        const id = Number(musteriId);
        if (!id) return;
        let m = musteriCache.find((x) => musteriKimlik(x) === id);
        if (!m) {
            try {
                const res = await apiFetch('/api/musteriler');
                const liste = await apiJson(res, 'Müşteriler alınamadı');
                if (res.ok && Array.isArray(liste)) {
                    musteriCache = liste;
                    m = musteriCache.find((x) => musteriKimlik(x) === id);
                }
            } catch {
                /* ignore */
            }
        }
        if (!m) {
            toast('Müşteri bulunamadı');
            return;
        }
        overlayGeriHedef = 'overlay-rapor';
        await musteriDetayAc(id);
    }

    async function raporVeriYukle() {
        const el = $('raporListe');
        if (!el) return;
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        const arama = $('raporArama');
        if (arama) arama.value = '';

        try {
            const url = raporMod === 'borclu' ? '/api/rapor-borclular' : '/api/rapor-vadesi-gelenler';
            const res = await apiFetch(url);
            const veriler = await apiJson(res, 'Rapor alınamadı');
            if (!res.ok || !Array.isArray(veriler)) {
                throw new Error(veriler?.hata || 'Rapor alınamadı');
            }

            raporVeriler = veriler.map((r) => {
                const ad = r.Adı || '';
                const tel = r.CEPTEL || '';
                const acik = r.AÇIKLAMA || '';
                const tutar = raporMod === 'borclu'
                    ? (Number(r.Bakiye) || 0)
                    : (Number(r.MIKTAR) || 0);
                return {
                    ...r,
                    _tutar: tutar,
                    _arama: [ad, tel, acik].join(' ')
                };
            });

            if (!raporVeriler.length) {
                const bos = raporMod === 'borclu'
                    ? 'Borçlu müşteri yok — herkes ödemesini yapmış!'
                    : 'Vadesi geçmiş ödeme yok';
                el.innerHTML = `<div class="empty-msg">${bos}</div>`;
                raporOzetGuncelle([], 0);
                return;
            }

            let genelToplam = 0;
            raporVeriler.forEach((r) => { genelToplam += r._tutar; });
            raporOzetGuncelle(raporVeriler, genelToplam);
            raporListeCiz();
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
            raporOzetGuncelle([], 0);
        }
    }

    async function borcluMusterileriAc() {
        anaMenuKapat();
        raporMod = 'borclu';
        raporBaslikAyarla('borclu');
        overlayAc('overlay-rapor');
        await raporVeriYukle();
    }

    async function vadesiGelenleriAc() {
        anaMenuKapat();
        raporMod = 'vade';
        raporBaslikAyarla('vade');
        overlayAc('overlay-rapor');
        await raporVeriYukle();
    }

    function musteriMenuToggle() {
        const menu = $('musteriMenuDropdown');
        const btn = $('btnMusteriMenu');
        if (!menu || !btn) return;
        const acik = menu.classList.contains('d-none');
        if (acik) {
            menu.classList.remove('d-none');
            btn.setAttribute('aria-expanded', 'true');
        } else {
            musteriMenuKapat();
        }
    }

    function modallariKapat() {
        document.querySelectorAll('.modal').forEach((m) => m.classList.remove('modal-active'));
    }

    function musteriOzetGuncelle(m) {
        const alis = Number(m.ToplamBorc) || 0;
        const odeme = Number(m.ToplamOdeme) || 0;
        const bakiye = Number(m.Bakiye) || 0;
        $('ozetToplamAlis').textContent = formatPara(alis);
        $('ozetToplamOdeme').textContent = formatPara(odeme);
        const bEl = $('ozetBakiye');
        if (bakiye > 0) {
            bEl.textContent = formatPara(bakiye);
            bEl.className = 'val bakiye-borc';
        } else if (bakiye < 0) {
            bEl.textContent = formatPara(Math.abs(bakiye));
            bEl.className = 'val bakiye-alacak';
        } else {
            bEl.textContent = 'Kapalı';
            bEl.className = 'val';
        }
    }

    async function musteriYenileVeGoster(id) {
        const mRes = await apiFetch('/api/musteriler');
        const liste = await mRes.json();
        if (Array.isArray(liste)) {
            musteriCache = liste;
            aktifMusteri = liste.find((x) => musteriKimlik(x) === id) || aktifMusteri;
            musteriOzetGuncelle(aktifMusteri);
        }
        await musteriEkstreYukle(id);
    }

    function ekstreRaporKacis(metin) {
        return String(metin ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ekstreRaporSatir(islem) {
        const borc = Number(islem.BORÇ) || 0;
        const odeme = Number(islem.ÖDEME) || 0;
        const hamTarih = islem.TARİH || islem.TARIH;
        const tamMetin = tarihGoster(hamTarih);
        const parcalar = tamMetin.split(' ');
        const tarihGunu = parcalar[0] || '—';
        const saatKismi = parcalar[1] || '—';
        let aciklama = islem.AÇIKLAMA || '—';
        const miktar = Number(islem.ADET) || 0;
        const birim = islem.birimtür || islem.BirimTur || '—';
        let islemTipi = 'Tahsilat';
        if (borc > 0) islemTipi = 'Satış';
        else if (String(aciklama).toUpperCase().includes('İADE') || String(aciklama).toUpperCase().includes('IADE')) {
            islemTipi = 'İade';
        }
        if (aciklama.includes(' x ')) {
            aciklama = aciklama.split(' x ')[1] || aciklama;
        }
        if (aciklama.includes(' (') && !aciklama.includes('Taksit')) {
            aciklama = aciklama.split(' (')[0].trim();
        }
        aciklama = aciklama.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (islem.notlar && String(islem.notlar).trim()) {
            aciklama += ` — ${islem.notlar}`;
        }
        const islemSira = islemTipi === 'Satış' ? 1 : (islemTipi === 'İade' ? 2 : 3);
        return {
            sortKey: dbTarihSortKey(hamTarih),
            tarihGunu,
            saatKismi,
            islemTipi,
            islemSira,
            siraId: Number(islem.Kimlik ?? islem.KİMLİK ?? islem.ID ?? 0) || 0,
            aciklama,
            miktar: miktar > 0 ? miktar : null,
            birim,
            birimFiyat: borc > 0 && miktar > 0 ? borc / miktar : null,
            borc,
            odeme
        };
    }

    function ekstreRaporSiralama(a, b) {
        if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
        if (a.saatKismi !== b.saatKismi) return String(a.saatKismi).localeCompare(String(b.saatKismi));
        if (a.islemSira !== b.islemSira) return a.islemSira - b.islemSira;
        return a.siraId - b.siraId;
    }

    async function musteriEkstreYukle(id) {
        $('musteriEkstre').innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch(`/api/musteri-ekstre/${id}?_t=${Date.now()}`);
            const rows = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = rows && rows.hata ? rows.hata : `HTTP ${res.status}`;
                $('musteriEkstre').innerHTML = `<div class="empty-msg">Cari hatası: ${msg}</div>`;
                aktifMusteriEkstreRows = [];
                return;
            }
            if (!Array.isArray(rows)) {
                $('musteriEkstre').innerHTML = '<div class="empty-msg">Cari yüklenemedi</div>';
                aktifMusteriEkstreRows = [];
                return;
            }
            aktifMusteriEkstreRows = rows;
            if (!rows.length) {
                $('musteriEkstre').innerHTML = '<div class="empty-msg">Hareket yok</div>';
                return;
            }
            $('musteriEkstre').innerHTML = rows.map((h) => {
                const borc = Number(h.BORÇ) || 0;
                const odeme = Number(h.ÖDEME) || 0;
                let tutar = '—';
                if (borc > 0) tutar = `<span class="borc">Borç ${formatPara(borc)}</span>`;
                if (odeme > 0) tutar = `<span class="odeme">Ödeme ${formatPara(odeme)}</span>`;
                const adet = h.ADET ? ` · ${formatSayi(h.ADET)} ${h.birimtür || ''}` : '';
                return `<div class="ekstre-item">
                    <div class="ust"><span>${tarihGoster(h.TARİH)}</span><span>${h.TeslimDurumu || ''}</span></div>
                    <div class="aciklama">${h.AÇIKLAMA || '—'}${adet}</div>
                    <div class="alt">${tutar}</div>
                    ${h.notlar ? `<div class="bakiye-satir">${h.notlar}</div>` : ''}
                </div>`;
            }).join('');
        } catch (err) {
            aktifMusteriEkstreRows = [];
            $('musteriEkstre').innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function ekstreToplamlariHesapla(rows, musteri) {
        let toplamAlis = Number(musteri?.ToplamBorc) || 0;
        let toplamOdeme = Number(musteri?.ToplamOdeme) || 0;
        if (Array.isArray(rows) && rows.length) {
            let borcSatir = 0;
            let odemeSatir = 0;
            rows.forEach((h) => {
                borcSatir += Number(h.BORÇ) || 0;
                odemeSatir += Number(h.ÖDEME) || 0;
            });
            if (!toplamAlis) toplamAlis = borcSatir;
            if (!toplamOdeme) toplamOdeme = odemeSatir;
        }
        let kalan = Number(musteri?.Bakiye);
        if (!Number.isFinite(kalan)) kalan = toplamAlis - toplamOdeme;
        return { toplamAlis, toplamOdeme, kalan };
    }

    function cariEkstreHtmlOlustur(rows, musteri) {
        const { toplamAlis, toplamOdeme, kalan } = ekstreToplamlariHesapla(rows, musteri);
        const ad = musteriAdi(musteri);
        const tel = musteri.CEPTEL || '—';
        const konum = [musteri.Ilce, musteri.Mahalle].filter(Boolean).join(' / ') || '—';
        const satirlar = rows.map(ekstreRaporSatir).sort(ekstreRaporSiralama);
        const unvan = (musteri.Unvan || '').trim();
        const anaAd = unvan || ad;
        const altAd = (unvan && ad && ad !== unvan) ? ad : '';

        const tabloSatir = satirlar.map((s) => `
            <tr>
                <td style="white-space:nowrap;">
                    <div style="font-weight:700;color:#111;">${ekstreRaporKacis(s.tarihGunu)}</div>
                    <div style="font-size:9px;color:#666;margin-top:2px;">${ekstreRaporKacis(s.saatKismi)}</div>
                </td>
                <td style="color:#111;">${ekstreRaporKacis(s.islemTipi)}</td>
                <td style="color:#111;">${ekstreRaporKacis(s.aciklama)}</td>
                <td class="c" style="color:#111;">${s.miktar != null ? formatSayi(s.miktar) : '—'}</td>
                <td style="color:#111;">${ekstreRaporKacis(s.birim)}</td>
                <td class="c" style="color:#111;">${s.birimFiyat != null ? formatSayi(s.birimFiyat) : '—'}</td>
                <td class="c" style="color:#c0392b;font-weight:700;">${s.borc > 0 ? formatSayi(s.borc) : '—'}</td>
                <td class="c" style="color:#27ae60;font-weight:700;">${s.odeme > 0 ? formatSayi(s.odeme) : '—'}</td>
            </tr>`).join('');

        return `
            <div class="ekstre-print-root" style="font-family:Segoe UI,Arial,sans-serif;color:#111;padding:4px;">
                <h2 style="text-align:center;margin:0 0 4px;font-size:18px;color:#2c3e50;border-bottom:2px solid #e67e22;padding-bottom:8px;">
                    KARAARSLAN KÖMÜR — CARİ EKSTRE
                </h2>
                <p style="text-align:right;font-size:10px;color:#555;margin:0 0 12px;">
                    ${new Date().toLocaleString('tr-TR')}
                </p>
                <div style="margin:0 0 14px;padding:10px 12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;">
                    <div style="font-size:20px;font-weight:800;color:#1a5276;text-transform:uppercase;">${ekstreRaporKacis(anaAd)}</div>
                    ${altAd ? `<div style="font-size:13px;font-weight:600;color:#495057;margin:6px 0 8px;">${ekstreRaporKacis(altAd)}</div>` : ''}
                    <div style="font-size:12px;margin:4px 0;color:#111;"><b>Telefon</b> ${ekstreRaporKacis(tel)}</div>
                    <div style="font-size:12px;margin:4px 0;color:#111;"><b>Adres</b> ${ekstreRaporKacis(konum)}</div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:11px;">
                    <tr>
                        <td style="border:1px solid #ccc;padding:8px;background:#fde8e8;text-align:center;color:#111;"><b>Toplam alış</b><br><span style="color:#c0392b;font-weight:800;font-size:14px;">${formatPara(toplamAlis)}</span></td>
                        <td style="border:1px solid #ccc;padding:8px;background:#e8f8ee;text-align:center;color:#111;"><b>Toplam ödeme</b><br><span style="color:#27ae60;font-weight:800;font-size:14px;">${formatPara(toplamOdeme)}</span></td>
                        <td style="border:1px solid #ccc;padding:8px;background:#e8eef8;text-align:center;color:#111;"><b>Kalan bakiye</b><br><span style="color:${kalan > 0 ? '#c0392b' : (kalan < 0 ? '#27ae60' : '#333')};font-weight:800;font-size:14px;">${formatPara(Math.abs(kalan))}${kalan < 0 ? ' (Alacak)' : ''}</span></td>
                    </tr>
                </table>
                <table style="width:100%;border-collapse:collapse;font-size:10px;">
                    <thead>
                        <tr style="background:#ecf0f1;">
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Tarih</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">İşlem</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Açıklama</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Miktar</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Birim</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">B.Fiyat</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Borç</th>
                            <th style="border:1px solid #bdc3c7;padding:5px;color:#111;">Alacak</th>
                        </tr>
                    </thead>
                    <tbody>${tabloSatir || '<tr><td colspan="8" style="padding:12px;text-align:center;color:#111;">Hareket yok</td></tr>'}</tbody>
                    <tfoot>
                        <tr style="background:#f1f3f5;font-weight:800;">
                            <td colspan="6" style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#111;">TOPLAM</td>
                            <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#c0392b;">${formatPara(toplamAlis)}</td>
                            <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#27ae60;">${formatPara(toplamOdeme)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;
    }

    function ekstreOnizlemeKapat() {
        const ov = $('ekstreOnizleme');
        if (ov) {
            ov.classList.remove('active');
            ov.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('ekstre-yazdir-modu');
        geriTusGuncelle();
    }

    function ekstreOnizlemeAc(html) {
        const icerik = $('ekstreOnizlemeIcerik');
        const ov = $('ekstreOnizleme');
        if (!icerik || !ov) throw new Error('Ekstre önizleme alanı yok');
        icerik.innerHTML = html;
        ov.classList.add('active');
        ov.setAttribute('aria-hidden', 'false');
        icerik.scrollTop = 0;
        geriTusGuncelle();
    }

    function ekstreMobilYazdirBaslat() {
        document.body.classList.add('ekstre-yazdir-modu');
        setTimeout(() => {
            try {
                window.print();
            } finally {
                setTimeout(() => document.body.classList.remove('ekstre-yazdir-modu'), 500);
            }
        }, 200);
    }

    async function ekstrePdfBlobUret() {
        const el = $('ekstreOnizlemeIcerik');
        if (!el || !el.innerHTML.trim()) throw new Error('Ekstre içeriği yok');
        if (typeof html2pdf === 'undefined') throw new Error('PDF hazırlanamıyor (kütüphane yok)');
        const root = el.querySelector('.ekstre-print-root') || el;
        return html2pdf().set({
            margin: [6, 6, 6, 6],
            filename: sonEkstreDosyaAd,
            image: { type: 'jpeg', quality: 0.92 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(root).outputPdf('blob');
    }

    function whatsappAc(metin) {
        const enc = encodeURIComponent(metin);
        const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const url = ios ? `https://wa.me/?text=${enc}` : `https://api.whatsapp.com/send?text=${enc}`;
        window.location.href = url;
    }

    async function ekstreMobilPaylas() {
        const btn = $('btnEkstreOnizlemePaylas');
        const btnHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> …';
        }
        try {
            const blob = await ekstrePdfBlobUret();
            const file = new File([blob], sonEkstreDosyaAd, { type: 'application/pdf' });
            const musteriAd = aktifMusteri ? musteriAdi(aktifMusteri) : 'Müşteri';
            const metin = `Karaarslan Kömür — ${musteriAd} cari ekstre`;

            if (navigator.share) {
                try {
                    const paylasVeri = { title: 'Cari ekstre', text: metin };
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        paylasVeri.files = [file];
                    }
                    await navigator.share(paylasVeri);
                    toast('WhatsApp\'ı seçin');
                    return;
                } catch (err) {
                    if (err && err.name === 'AbortError') return;
                }
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = sonEkstreDosyaAd;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            toast('WhatsApp açılıyor…');
            setTimeout(() => {
                whatsappAc(`${metin}\n\n(PDF indirildi — sohbette 📎 Dosya ekle → İndirilenler)`);
            }, 450);
        } catch (err) {
            console.warn('Ekstre paylaş:', err);
            toast(err.message || 'Paylaşım başarısız');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = btnHtml || '<i class="fab fa-whatsapp"></i> WhatsApp';
            }
        }
    }

    async function cariEkstrePdfIndir() {
        if (!aktifMusteri) {
            toast('Müşteri seçili değil');
            return;
        }
        const btn = $('btnCariEkstrePdf');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'PDF hazırlanıyor…';
        }
        try {
            let rows = aktifMusteriEkstreRows;
            if (!rows || !rows.length) {
                const id = musteriKimlik(aktifMusteri);
                const res = await apiFetch(`/api/musteri-ekstre/${id}?_t=${Date.now()}`);
                rows = await apiJson(res, 'Ekstre alınamadı');
                if (!res.ok || !Array.isArray(rows) || !rows.length) {
                    toast((rows && rows.hata) ? rows.hata : 'Hesap hareketi yok');
                    return;
                }
                aktifMusteriEkstreRows = rows;
            }

            const ad = musteriAdi(aktifMusteri);
            sonEkstreDosyaAd = `Cari_Ekstre_${ad.replace(/[^\w\u00C0-\u024F\s-]/gi, '').trim().replace(/\s+/g, '_') || 'musteri'}.pdf`;
            const html = cariEkstreHtmlOlustur(rows, aktifMusteri);
            ekstreOnizlemeAc(html);
            toast('Önizleme — WhatsApp veya Yazdır');
        } catch (err) {
            toast(err.message || 'Ekstre hazırlanamadı');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-file-pdf me-1"></i>Cari ekstre (PDF)';
            }
        }
    }

    function toast(msg) {
        const t = $('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.remove('d-none');
        clearTimeout(toast._tm);
        toast._tm = setTimeout(() => t.classList.add('d-none'), 2800);
    }

    const PANEL_BASLIKLAR = {
        stok: { title: 'Stok listesi', icon: 'fa-boxes-stacked' },
        sevk: { title: 'Bekleyen sevkiyat', icon: 'fa-truck' },
        musteri: { title: 'Müşteri rehberi', icon: 'fa-users' },
        tedarikci: { title: 'Tedarikçiler', icon: 'fa-truck' }
    };

    function panelBaslikGuncelle() {
        const bar = $('panelBaslikBar');
        const meta = PANEL_BASLIKLAR[aktifPanel];
        const ekleBtn = $('btnMusteriEkle');
        if (!bar) return;
        if (!meta) {
            bar.classList.add('d-none');
            bar.setAttribute('aria-hidden', 'true');
            if (ekleBtn) ekleBtn.classList.add('d-none');
            return;
        }
        bar.classList.remove('d-none');
        bar.setAttribute('aria-hidden', 'false');
        const metin = $('panelBaslikMetin');
        const ikon = $('panelBaslikIkon');
        if (metin) metin.textContent = meta.title;
        if (ikon) ikon.className = `fas ${meta.icon}`;
        if (ekleBtn) {
            ekleBtn.classList.toggle('d-none', aktifPanel !== 'musteri');
        }
    }

    function panelGoster(panel) {
        aktifPanel = panel || 'ana';
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('panel-active'));
        const el = $(`panel-${aktifPanel}`);
        if (el) el.classList.add('panel-active');
        document.querySelectorAll('.nav-item').forEach((n) => {
            n.classList.toggle('nav-active', n.dataset.panel === aktifPanel);
        });
        panelBaslikGuncelle();
        if (aktifPanel === 'stok') stokYukle();
        if (aktifPanel === 'sevk') sevkYukle();
        if (aktifPanel === 'musteri') musteriYukle();
        if (aktifPanel === 'tedarikci') tedarikciYukle();
        geriTusGuncelle();
        const scroll = $('mainScroll');
        if (scroll) scroll.scrollTop = 0;
    }

    async function sunucuCanliMi() {
        try {
            const res = await apiFetch('/api/surum', { cache: 'no-store' });
            return res.ok;
        } catch {
            return false;
        }
    }

    async function stoklariYukleCache() {
        const res = await apiFetch('/api/komur');
        const rows = await res.json();
        stokCache = Array.isArray(rows) ? rows : [];
        return stokCache;
    }

    function satisUrunSelectDoldur() {
        const sel = $('satisUrun');
        if (!sel) return;
        sel.innerHTML = stokCache.map((r) => {
            const fiyat = Number(r.ton_fiyati) || 0;
            return `<option value="${r.id}" data-fiyat="${fiyat}">${r.cins || r.temel_ad} (${formatPara(fiyat)})</option>`;
        }).join('');
        satisTutarHesapla();
    }

    function satisTutarHesapla() {
        const sel = $('satisUrun');
        const miktar = parseFloat($('satisMiktar').value) || 0;
        const opt = sel.options[sel.selectedIndex];
        const fiyat = opt ? parseFloat(opt.dataset.fiyat) || 0 : 0;
        if (miktar > 0 && fiyat > 0) {
            const tutar = (miktar * fiyat).toFixed(2);
            $('satisTutar').value = tutar;
            if ($('satisOdemeAl').checked) {
                $('satisOdemeTutar').value = tutar;
            }
        }
    }

    function simdiTarihSql() {
        const p = istanbulBilesenler();
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    }

    function satisOdemeSenkron() {
        const chk = $('satisOdemeAl');
        const odemeInp = $('satisOdemeTutar');
        const blok = $('satisOdemeBlok');
        const turSel = $('satisOdemeTuru');
        if (blok) blok.classList.toggle('d-none', !chk.checked);
        odemeInp.disabled = !chk.checked;
        if (turSel) turSel.disabled = !chk.checked;
        if (chk.checked) {
            const t = parseFloat($('satisTutar').value);
            if (t > 0) odemeInp.value = t.toFixed(2);
        } else {
            odemeInp.value = '';
        }
    }

    async function modalSatisAc() {
        if (!aktifMusteri) return;
        $('satisMiktar').value = '';
        $('satisTutar').value = '';
        $('satisNot').value = '';
        $('satisOdemeAl').checked = true;
        $('satisOdemeTuru').value = 'Nakit';
        $('satisOdemeTutar').value = '';
        try {
            await stoklariYukleCache();
            satisUrunSelectDoldur();
        } catch {
            toast('Stok yüklenemedi');
        }
        satisOdemeSenkron();
        modalAc('modal-satis');
    }

    function modalOdemeAc() {
        if (!aktifMusteri) return;
        const bakiye = Number(aktifMusteri.Bakiye) || 0;
        $('odemeTutar').value = bakiye > 0 ? bakiye.toFixed(2) : '';
        $('odemeTuru').value = 'Nakit';
        $('odemeNot').value = '';
        odemeKapsamHazirlaMob(musteriKimlik(aktifMusteri));
        modalAc('modal-odeme');
    }

    async function odemeKapsamHazirlaMob(musteriId) {
        const kutu = $('odemeKapsamKutu');
        const sel = $('odemeKapsam');
        const bilgi = $('odemeKapsamBilgi');
        window.mobilOdemeKapsam = 'genel';
        if (kutu) kutu.classList.add('d-none');
        try {
            const res = await apiFetch(`/api/musteri/${musteriId}/borc-ozet?_t=` + Date.now());
            const o = await res.json();
            if (!res.ok) return;
            const ap = parseFloat(o.apartmanBorc) || 0;
            const gn = parseFloat(o.genelBorc) || 0;
            if (ap > 0 && gn > 0) {
                window.mobilOdemeKapsam = 'apartman';
                if (sel) sel.value = 'apartman';
                if (kutu) kutu.classList.remove('d-none');
                if (bilgi) bilgi.innerHTML = `🏢 Apartman: ${formatPara(ap)}${o.apartmanKalanKg ? ' (' + o.apartmanKalanKg + ' kg)' : ''} · 📋 Genel: ${formatPara(gn)}`;
            } else if (ap > 0) {
                window.mobilOdemeKapsam = 'apartman';
            } else {
                window.mobilOdemeKapsam = 'genel';
            }
        } catch (e) { /* sessiz */ }
    }

    /** Masaüstü ile aynı: makbuzlu ödeme, açıklama "Nakit Tahsilat" vb. */
    async function makbuzluOdemeKaydet(tutar, odemeTuru, aciklama, notlar, islemBakiyesi, apartmanUygula) {
        const oturum = oturumOku();
        const mid = musteriKimlik(aktifMusteri);
        const res = await apiFetch('/api/musteri-odeme-makbuzlu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musteriId: mid,
                tutar,
                odemeTuru: odemeTuru || 'Nakit',
                aciklama,
                notlar: notlar || '',
                tarih: simdiTarihSql(),
                islemiYapan: oturum?.adSoyad || 'Mobil',
                islemBakiyesi: islemBakiyesi != null ? islemBakiyesi : 0,
                apartmanUygula: apartmanUygula !== false
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.hata || 'Ödeme kaydedilemedi');
        return data;
    }

    function tahsilatAciklama(odemeTuru, ozelNot, satisMi) {
        const tur = odemeTuru || 'Nakit';
        if (satisMi) {
            return `Satış Tahsilatı (${tur})${ozelNot ? ' - ' + ozelNot : ''}`;
        }
        return `${tur} Tahsilat${ozelNot ? ' - ' + ozelNot : ''}`;
    }

    function islemYapanAdi() {
        const o = oturumOku();
        return o?.adSoyad || o?.kullaniciAdi || 'Mobil';
    }

    function musteriNotUyariAcikMi(n) {
        if (!n || typeof n.UyariAcik === 'undefined' || n.UyariAcik === null) return true;
        const v = n.UyariAcik;
        if (v === false || v === 0 || v === '0') return false;
        return true;
    }

    function musteriOturumKimligi() {
        const o = oturumOku() || {};
        return {
            adSoyad: String(o.adSoyad || '').trim(),
            kullaniciAdi: String(o.kullaniciAdi || '').trim()
        };
    }

    async function musteriNotlarListesiniYenile(musteriId) {
        const el = $('musteriNotlarListe');
        if (!el || !musteriId) return [];
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch(`/api/musteri-notlar/${musteriId}?_t=${Date.now()}`);
            const data = await apiJson(res, 'Notlar alınamadı');
            if (!res.ok) throw new Error(data.hata || 'Notlar alınamadı');
            const rows = Array.isArray(data.notlar) ? data.notlar : [];
            if (!rows.length) {
                el.innerHTML = '<div class="empty-msg">Henüz not yok</div>';
                return rows;
            }
            el.innerHTML = rows.map((n) => {
                const nid = n.Id;
                const metin = ekstreRaporKacis(n.NotMetni || '');
                const ad = ekstreRaporKacis(n.OlusturanAdSoyad || '—');
                const ka = n.OlusturanKullaniciAdi ? `@${ekstreRaporKacis(n.OlusturanKullaniciAdi)}` : '';
                let zStr = '';
                try {
                    zStr = n.OlusturmaZamani ? tarihGoster(n.OlusturmaZamani) : '';
                } catch {
                    zStr = '';
                }
                const uyAcik = musteriNotUyariAcikMi(n);
                return `<div class="musteri-not-item">
                    <div class="musteri-not-metin">${metin.replace(/\n/g, '<br>')}</div>
                    <div class="musteri-not-kim">${ad}${ka ? ' ' + ka : ''}${zStr ? ' · ' + ekstreRaporKacis(zStr) : ''}</div>
                    <div class="musteri-not-alt">
                        <label class="musteri-not-switch">
                            <input type="checkbox" data-not-uyari="${nid}" ${uyAcik ? 'checked' : ''}>
                            <span>Uyarı versin</span>
                        </label>
                        <button type="button" class="btn btn-ghost btn-sm musteri-not-sil" data-not-sil="${nid}" aria-label="Sil"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
            }).join('');
            return rows;
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${ekstreRaporKacis(err.message)}</div>`;
            return [];
        }
    }

    function musteriNotUyariIcerikGoster() {
        const baslik = $('musteriNotUyariBaslik');
        const govde = $('musteriNotUyariGovde');
        if (!govde || musteriNotUyariIdx >= musteriNotUyariKuyruk.length) {
            modalKapat('modal-not-uyari');
            return;
        }
        const n = musteriNotUyariKuyruk[musteriNotUyariIdx];
        if (baslik) {
            baslik.innerHTML = `<i class="fas fa-bell me-1"></i> Not <span class="not-uyari-sira">${musteriNotUyariIdx + 1} / ${musteriNotUyariKuyruk.length}</span>`;
        }
        const metin = ekstreRaporKacis(n.NotMetni || '').replace(/\n/g, '<br>');
        const ad = ekstreRaporKacis(n.OlusturanAdSoyad || '—');
        const ka = n.OlusturanKullaniciAdi ? `@${ekstreRaporKacis(n.OlusturanKullaniciAdi)}` : '';
        let zStr = '';
        try {
            zStr = n.OlusturmaZamani ? tarihGoster(n.OlusturmaZamani) : '';
        } catch {
            zStr = '';
        }
        govde.innerHTML = `<div class="musteri-not-uyari-kutu">${metin}</div>
            <div class="musteri-not-kim">${ad}${ka ? ' ' + ka : ''}${zStr ? ' · ' + ekstreRaporKacis(zStr) : ''}</div>`;
    }

    function musteriNotAcilisUyarilariniBaslat(notlar) {
        const uyariNotlar = (notlar || []).filter(musteriNotUyariAcikMi);
        if (!uyariNotlar.length) return;
        musteriNotUyariKuyruk = uyariNotlar;
        musteriNotUyariIdx = 0;
        setTimeout(() => {
            modalAc('modal-not-uyari');
            musteriNotUyariIcerikGoster();
        }, 450);
    }

    async function musteriDetayNotlariSenkronize(musteriId) {
        const ta = $('musteriNotYeniMetin');
        if (ta) ta.value = '';
        const rows = await musteriNotlarListesiniYenile(musteriId);
        musteriNotAcilisUyarilariniBaslat(rows);
        return rows;
    }

    async function musteriNotlarModalAc() {
        if (!aktifMusteri) return;
        musteriMenuKapat();
        const mid = musteriKimlik(aktifMusteri);
        const baslik = $('musteriNotlarBaslik');
        if (baslik) baslik.textContent = `${musteriAdi(aktifMusteri)} — Notlar`;
        const ta = $('musteriNotYeniMetin');
        if (ta) ta.value = '';
        modalAc('modal-notlar');
        await musteriNotlarListesiniYenile(mid);
    }

    async function musteriNotKaydet() {
        if (!aktifMusteri) return;
        const ta = $('musteriNotYeniMetin');
        const metin = (ta?.value || '').trim();
        if (!metin) {
            toast('Not metnini yazın');
            return;
        }
        const mid = musteriKimlik(aktifMusteri);
        const kim = musteriOturumKimligi();
        const btn = $('btnMusteriNotKaydet');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Kaydediliyor…';
        }
        try {
            const res = await apiFetch(`/api/musteri-notlar/${mid}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metin,
                    kullaniciAdi: kim.kullaniciAdi || null,
                    adSoyad: kim.adSoyad || null
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Kaydedilemedi');
            if (ta) ta.value = '';
            toast('Not kaydedildi');
            await musteriNotlarListesiniYenile(mid);
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save me-1"></i>Kaydet';
            }
        }
    }

    async function musteriNotSil(notId) {
        if (!notId) return;
        if (!confirm('Bu notu silmek istiyor musunuz?')) return;
        try {
            const res = await apiFetch(`/api/musteri-not/${notId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Silinemedi');
            if (aktifMusteri) await musteriNotlarListesiniYenile(musteriKimlik(aktifMusteri));
            toast('Not silindi');
        } catch (err) {
            toast(err.message || 'Hata');
        }
    }

    async function musteriNotUyariDegistir(notId, acik, inputEl) {
        if (!notId) return;
        try {
            const res = await apiFetch(`/api/musteri-not/${notId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uyariAcik: !!acik })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Kaydedilemedi');
        } catch (err) {
            if (inputEl) inputEl.checked = !acik;
            toast(err.message || 'Hata');
        }
    }

    function taksitOdemeTuruMobil(val) {
        const v = String(val || '');
        if (v.includes('Kredi') || v.includes('Kart')) return 'Kredi Kartı';
        if (v.includes('Havale') || v.includes('EFT')) return 'Havale';
        return v || 'Nakit';
    }

    function taksitToplamBorcHesapla(taksitler) {
        let toplam = 0;
        (taksitler || []).forEach((t) => {
            if (String(t.DURUM) !== '0') return;
            const orj = parseFloat(t.MIKTAR) || 0;
            const ode = parseFloat(t.ODEMELER) || 0;
            toplam += orj - ode;
        });
        return Math.max(0, toplam);
    }

    function taksitVadeGoster(t) {
        const ham = t.ODEMETARİHİ || t.ODEMETARIHI || t.TARIH || t.TARİH;
        return tarihGoster(ham, true);
    }

    async function musteriTaksitleriGetir(musteriId) {
        const res = await apiFetch(`/api/musteri-taksitler/${musteriId}`);
        const data = await apiJson(res, 'Taksitler alınamadı');
        if (!res.ok || !Array.isArray(data)) throw new Error(data?.hata || 'Taksitler alınamadı');
        return data;
    }

    async function taksitOdendiYap(id, tutar, taksitAciklama, odemeTuru) {
        const odenecek = parseFloat(parseFloat(tutar).toFixed(2));
        const maks = parseFloat((guncelToplamTaksitBorcu || 0).toFixed(2));
        if (maks > 0 && odenecek > maks) {
            toast(`Toplam taksit borcu ${formatPara(maks)} — fazla ödeme yapılamaz`);
            return;
        }
        const mid = musteriKimlik(aktifMusteri);
        const res = await apiFetch(`/api/taksit-ode/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                islemiYapan: islemYapanAdi(),
                odemeTuru: odemeTuru || 'Nakit',
                odenenTutar: tutar,
                musteriId: mid,
                tarih: simdiTarihSql()
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.hata || 'Taksit ödemesi kaydedilemedi');
        modalKapat('modal-taksit-odeme');
        toast(data.finansalOzet || 'Taksit tahsilatı kaydedildi');
        await musteriYenileVeGoster(mid);
        if ($('modal-taksit')?.classList.contains('modal-active')) await taksitPlaniYukle();
        anaYukle();
        return data;
    }

    async function tahsilatTaksitRadari(tutar, odemeTuru, ozelNot, kapatModalId = 'modal-odeme') {
        const mid = musteriKimlik(aktifMusteri);
        let taksitler;
        try {
            taksitler = await musteriTaksitleriGetir(mid);
        } catch (e) {
            console.error('Taksit radar:', e);
            return false;
        }
        guncelToplamTaksitBorcu = taksitToplamBorcHesapla(taksitler);
        if (guncelToplamTaksitBorcu <= 0) return false;

        const yonlendir = confirm(
            `⚠️ DİKKAT - AKILLI RADAR!\n\n` +
            `Bu müşterinin ödenmemiş ${formatPara(guncelToplamTaksitBorcu)} TAKSİT borcu bulunuyor.\n\n` +
            `Alınan ${formatPara(tutar)} tutarındaki bu tahsilatı doğrudan TAKSİT HAVUZUNA (Ödeme Planına) yönlendirmek ister misiniz?\n\n` +
            `[Tamam] → Taksit havuzuna aktar (tavsiye)\n[İptal] → Normal cari ödeme`
        );
        if (!yonlendir) return false;

        const ilkTaksit = taksitler.find((t) => String(t.DURUM) === '0');
        const havuzAciklama = ozelNot
            ? `${taksitOdemeTuruMobil(odemeTuru)} (${ozelNot})`
            : taksitOdemeTuruMobil(odemeTuru);
        modalKapat(kapatModalId);
        await taksitOdendiYap(ilkTaksit?.Kimlik || 0, tutar, 'Genel Tahsilattan Yönlendirme', havuzAciklama);
        return true;
    }

    function taksitOdemeModalAc(taksitId, kalanBorc, aciklama) {
        $('taksitOdemeId').value = taksitId;
        $('taksitOdemeAciklama').value = aciklama || '';
        $('taksitOdemeTutar').value = (parseFloat(kalanBorc) || 0).toFixed(2);
        $('taksitOdemeBeklenen').textContent = formatPara(kalanBorc);
        modalAc('modal-taksit-odeme');
    }

    async function taksitPlaniSil(taksitId) {
        if (!confirm('Bu taksiti ödeme planından silmek istiyor musunuz?')) return;
        const res = await apiFetch(`/api/taksit-sil/${taksitId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(data.hata || 'Taksit silinemedi');
            return;
        }
        toast('Taksit silindi');
        await taksitPlaniYukle();
    }

    async function taksitPlaniYukle() {
        const el = $('taksitListe');
        const ozet = $('taksitOzetBar');
        if (!el || !aktifMusteri) return;
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        if (ozet) ozet.classList.add('d-none');

        try {
            const mid = musteriKimlik(aktifMusteri);
            const taksitler = await musteriTaksitleriGetir(mid);
            aktifTaksitlerCache = taksitler;
            guncelToplamTaksitBorcu = taksitToplamBorcHesapla(taksitler);

            if (!taksitler.length) {
                el.innerHTML = '<div class="empty-msg">Taksit kaydı yok</div>';
                return;
            }

            if (ozet && guncelToplamTaksitBorcu > 0) {
                ozet.classList.remove('d-none');
                ozet.innerHTML = `<span>Kalan taksit borcu</span><strong>${formatPara(guncelToplamTaksitBorcu)}</strong>`;
            }

            let siradakiBulundu = false;
            el.innerHTML = taksitler.map((t) => {
                const orj = parseFloat(t.MIKTAR) || 0;
                const ode = parseFloat(t.ODEMELER) || 0;
                const kalan = orj - ode;
                const odendi = String(t.DURUM) === '1' || kalan <= 0;
                const aciklama = (t.AÇIKLAMA || '—').trim();
                const vade = taksitVadeGoster(t);
                const tid = t.Kimlik;

                let tutarHtml = `<div class="taksit-tutar-tek">${formatPara(orj)}</div>`;
                if (!odendi && ode > 0) {
                    tutarHtml = `
                        <div class="taksit-tutar-ust">${formatPara(orj)}</div>
                        <div class="taksit-tutar-ode">${formatPara(ode)} ödendi</div>
                        <div class="taksit-tutar-kalan">${formatPara(kalan)} kalan</div>`;
                }

                let aksiyon = '';
                if (odendi) {
                    aksiyon = '<span class="taksit-durum taksit-durum--ok">Ödendi</span>';
                } else if (!siradakiBulundu) {
                    siradakiBulundu = true;
                    aksiyon = `<button type="button" class="btn btn-success btn-sm taksit-ode-btn" data-tid="${tid}">Öde</button>`;
                } else {
                    aksiyon = '<span class="taksit-durum taksit-durum--kilit" title="Önce önceki taksiti ödeyin"><i class="fas fa-lock"></i></span>';
                }

                const silBtn = odendi
                    ? ''
                    : `<button type="button" class="btn btn-ghost btn-sm taksit-sil-btn" data-tid="${tid}" aria-label="Sil"><i class="fas fa-trash"></i></button>`;

                return `<div class="taksit-item ${odendi ? 'taksit-item--odendi' : ''}">
                    <div class="taksit-item-ust">
                        <div>
                            <div class="taksit-vade">${ekstreRaporKacis(vade)}</div>
                            <div class="taksit-aciklama">${ekstreRaporKacis(aciklama)}</div>
                        </div>
                        <div class="taksit-tutar-blok">${tutarHtml}</div>
                    </div>
                    <div class="taksit-item-alt">
                        ${aksiyon}
                        ${silBtn}
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    let yapiPlanModu = 'otomatik';

    function yapiPlanModuAyarla(mod) {
        yapiPlanModu = mod === 'manuel' ? 'manuel' : 'otomatik';
        $('btnYapiModOtomatik')?.classList.toggle('yapi-mod-btn--aktif', yapiPlanModu === 'otomatik');
        $('btnYapiModManuel')?.classList.toggle('yapi-mod-btn--aktif', yapiPlanModu === 'manuel');
        $('yapiOtomatikBlokMobil')?.classList.toggle('d-none', yapiPlanModu === 'manuel');
        $('yapiManuelBlokMobil')?.classList.toggle('d-none', yapiPlanModu !== 'manuel');
        if (yapiPlanModu === 'manuel' && !$('yapiManuelListe')?.children.length) {
            yapiManuelSatirlariOlustur();
        }
    }

    function ayEkleIso(iso, ay) {
        const d = new Date(iso + 'T12:00:00');
        d.setMonth(d.getMonth() + ay);
        return d.toISOString().slice(0, 10);
    }

    function yapiManuelSatirlariOlustur() {
        const adet = parseInt($('yapiManuelSayi')?.value, 10) || 1;
        const bas = $('yapiManuelBaslangic')?.value || bugunIso();
        const bakiye = parseFloat($('yapiTaksitTutar')?.value) || Number(aktifMusteri?.Bakiye) || 0;
        const esit = adet > 0 && bakiye > 0 ? bakiye / adet : 0;
        const liste = $('yapiManuelListe');
        if (!liste) return;
        liste.innerHTML = Array.from({ length: adet }, (_, i) => {
            const n = i + 1;
            const tarih = ayEkleIso(bas, i);
            const tutar = esit > 0 ? esit.toFixed(2) : '';
            return `<div class="yapi-manuel-satir">
                <span class="yapi-manuel-satir-no">${n}</span>
                <input type="number" class="field-input yapi-manuel-tutar" step="0.01" min="0.01" value="${tutar}" placeholder="₺">
                <input type="date" class="field-input yapi-manuel-tarih" value="${tarih}">
            </div>`;
        }).join('');
        liste.querySelectorAll('.yapi-manuel-tutar').forEach((inp) => {
            inp.addEventListener('input', yapiManuelToplamGuncelle);
        });
        yapiManuelToplamGuncelle();
    }

    function yapiManuelToplamGuncelle() {
        const el = $('yapiManuelToplam');
        if (!el) return;
        let t = 0;
        document.querySelectorAll('.yapi-manuel-tutar').forEach((inp) => { t += parseFloat(inp.value) || 0; });
        const bakiye = parseFloat($('yapiTaksitTutar')?.value) || Number(aktifMusteri?.Bakiye) || 0;
        let uyari = '';
        if (bakiye > 0 && Math.abs(t - bakiye) > 0.02) {
            uyari = ` · bakiye ${formatPara(bakiye)}`;
        }
        el.textContent = `Toplam: ${formatPara(t)}${uyari}`;
    }

    async function borcuTaksitlendirAc() {
        if (!aktifMusteri) return;
        const bakiye = Number(aktifMusteri.Bakiye) || 0;
        if (bakiye <= 0) {
            toast('Bu müşterinin borcu yok. Borcu olmayan müşteriye taksit planı yapılamaz.');
            return;
        }

        const mid = musteriKimlik(aktifMusteri);
        try {
            const taksitler = await musteriTaksitleriGetir(mid);
            const odenmemisVarMi = taksitler.some((t) => String(t.DURUM) === '0');
            if (odenmemisVarMi) {
                const onay = confirm(
                    '⚠️ Devam eden taksit planı var.\n\n' +
                    'Ödenmemiş taksitler silinir; ödenmiş / havuzda parası olanlar korunur.\n\nOnaylıyor musunuz?'
                );
                if (!onay) return;
            }
        } catch (e) {
            console.error('Taksit kontrol:', e);
        }

        const adEl = $('yapiMusteriAd');
        if (adEl) adEl.textContent = musteriAdi(aktifMusteri);
        const bakEl = $('yapilandirmaBakiyesi');
        if (bakEl) bakEl.textContent = formatPara(bakiye);
        const tutarInp = $('yapiTaksitTutar');
        if (tutarInp) tutarInp.value = bakiye.toFixed(2);
        const tarihInp = $('yapiBaslangicTarihi');
        if (tarihInp) tarihInp.value = bugunIso();
        const manBas = $('yapiManuelBaslangic');
        if (manBas) manBas.value = bugunIso();
        const sayiSel = $('yapiTaksitSayisi');
        if (sayiSel && !sayiSel.value) sayiSel.value = '3';
        yapiPlanModuAyarla('otomatik');
        const manListe = $('yapiManuelListe');
        if (manListe) manListe.innerHTML = '';

        modalAc('modal-borc-yapilandir');
    }

    async function borcYapilandirKaydet() {
        if (!aktifMusteri) return;
        const mid = musteriKimlik(aktifMusteri);

        if (yapiPlanModu === 'manuel') {
            const satirlar = document.querySelectorAll('#yapiManuelListe .yapi-manuel-satir');
            if (!satirlar.length) {
                toast('Önce taksit satırlarını oluşturun');
                return;
            }
            const taksitler = [];
            satirlar.forEach((row) => {
                const miktar = parseFloat(row.querySelector('.yapi-manuel-tutar')?.value);
                const tarih = row.querySelector('.yapi-manuel-tarih')?.value;
                if (miktar > 0 && tarih) taksitler.push({ miktar, tarih });
            });
            if (taksitler.length < 1 || taksitler.length > 12) {
                toast('1–12 arası geçerli taksit girin');
                return;
            }
            const btn = $('btnBorcYapilandirKaydet');
            if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…'; }
            try {
                const res = await apiFetch('/api/borc-taksitlendir-manuel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        musteri_id: mid,
                        taksitler,
                        islemiYapan: islemYapanAdi()
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.hata || 'Plan oluşturulamadı');
                modalKapat('modal-borc-yapilandir');
                toast('Manuel ödeme planı kaydedildi');
                modalAc('modal-taksit');
                const baslik = $('taksitModalBaslik');
                if (baslik) baslik.textContent = `${musteriAdi(aktifMusteri)} — Ödeme planı`;
                await taksitPlaniYukle();
            } catch (err) {
                toast(err.message || 'Hata');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save me-1"></i>Planı oluştur';
                }
            }
            return;
        }

        const tutar = parseFloat($('yapiTaksitTutar')?.value);
        const taksit = parseInt($('yapiTaksitSayisi')?.value, 10);
        const tarih = $('yapiBaslangicTarihi')?.value;

        if (!tutar || tutar <= 0 || !tarih || !taksit || taksit < 1 || taksit > 12) {
            toast('Tutar, tarih ve 1–12 arası taksit sayısı girin');
            return;
        }

        const btn = $('btnBorcYapilandirKaydet');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Kaydediliyor…';
        }
        try {
            const res = await apiFetch('/api/borc-taksitlendir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    musteri_id: mid,
                    toplam_tutar: tutar,
                    taksit_sayisi: taksit,
                    baslangic_tarihi: tarih,
                    islemiYapan: islemYapanAdi()
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Plan oluşturulamadı');

            modalKapat('modal-borc-yapilandir');
            toast('Ödeme planı oluşturuldu');
            await musteriYenileVeGoster(mid);
            modalAc('modal-taksit');
            const baslik = $('taksitModalBaslik');
            if (baslik) baslik.textContent = `${musteriAdi(aktifMusteri)} — Ödeme planı`;
            await taksitPlaniYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save me-1"></i>Planı oluştur';
            }
        }
    }

    async function taksitPlaniTumunuSil() {
        if (!aktifMusteri) return;
        const ad = musteriAdi(aktifMusteri);
        if (!confirm(`⚠️ ${ad} — ödenmemiş taksitler silinecek.\n\nÖdenmiş kayıtlar korunur. Emin misiniz?`)) return;

        const mid = musteriKimlik(aktifMusteri);
        try {
            const res = await apiFetch(`/api/taksit-plani-tumunu-sil/${mid}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Plan silinemedi');
            toast('Ödenmemiş taksitler temizlendi');
            guncelToplamTaksitBorcu = 0;
            await taksitPlaniYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        }
    }

    async function modalTaksitPlaniAc() {
        if (!aktifMusteri) return;
        const baslik = $('taksitModalBaslik');
        if (baslik) baslik.textContent = `${musteriAdi(aktifMusteri)} — Ödeme planı`;
        modalAc('modal-taksit');
        await taksitPlaniYukle();
    }

    async function taksitOdemeTurKaydet(odemeTuru) {
        const id = parseInt($('taksitOdemeId').value, 10);
        const tutar = parseFloat($('taksitOdemeTutar').value);
        const aciklama = $('taksitOdemeAciklama').value || '';
        if (!id || !tutar || tutar <= 0) {
            toast('Geçerli tutar girin');
            return;
        }
        try {
            await taksitOdendiYap(id, tutar, aciklama, odemeTuru);
        } catch (err) {
            toast(err.message || 'Hata');
        }
    }

    async function baslangic() {
        const oturum = oturumOku();
        const kayitliSunucu = localStorage.getItem(STORAGE_SERVER);

        if (!kayitliSunucu) {
            const canli = await sunucuCanliMi();
            if (canli) sunucuKaydet(window.location.origin);
            else { viewGoster('setup'); return; }
        } else if (!(await sunucuCanliMi())) {
            viewGoster('setup');
            $('sunucuUrl').value = kayitliSunucu;
            return;
        }

        if (oturum && oturum.adSoyad) {
            viewGoster('main');
            $('headerUser').textContent = oturum.adSoyad;
            anaYukle();
            return;
        }
        $('loginServerPill').textContent = sunucuUrl();
        viewGoster('login');
    }

    async function girisYap() {
        const btn = $('btnGiris');
        const hata = $('loginHata');
        hata.classList.add('d-none');
        const kAdi = $('kAdi').value.trim();
        const sifre = $('sifre').value;
        if (!kAdi || !sifre) {
            hata.textContent = 'Kullanıcı adı ve şifre girin.';
            hata.classList.remove('d-none');
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Kontrol…';
        try {
            const res = await apiFetch('/api/giris', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kullaniciAdi: kAdi, sifre })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Giriş başarısız.');
            oturumYaz({
                adSoyad: data.adSoyad,
                yetki: data.yetki,
                kullaniciAdi: data.kullaniciAdi || kAdi
            });
            $('headerUser').textContent = data.adSoyad;
            viewGoster('main');
            anaYukle();
        } catch (err) {
            hata.textContent = err.message || 'Bağlantı hatası.';
            hata.classList.remove('d-none');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Giriş yap';
        }
    }

    async function anaYukle() {
        const cards = $('ozetCards');
        try {
            const res = await apiFetch('/api/mobil-ozet', { cache: 'no-store' });
            const d = await apiJson(res, 'Özet alınamadı.');
            if (!res.ok) throw new Error(d.hata || d.message || 'Özet alınamadı.');

            cards.innerHTML = `
                <div class="ozet-rozet ozet-rozet--satis tiklanabilir" id="cardBugun" role="button" tabindex="0" title="Bugünkü hareketler">
                    <div class="rozet-ikon"><i class="fas fa-hand-holding-usd"></i></div>
                    <div class="rozet-icerik">
                        <div class="rozet-baslik">Bugünkü satış</div>
                        <div class="rozet-satir"><span class="rozet-deger">${formatSayi(d.bugunKomur)}</span><span class="rozet-birim">kömür</span></div>
                        <div class="rozet-satir rozet-satir-alt"><span class="rozet-deger">${formatSayi(d.bugunUn)}</span><span class="rozet-birim">un</span></div>
                    </div>
                </div>
                <div class="ozet-rozet ozet-rozet--musteri tiklanabilir" id="cardMusteri" role="button" tabindex="0" title="Müşteri listesi">
                    <div class="rozet-ikon"><i class="fas fa-users"></i></div>
                    <div class="rozet-icerik">
                        <div class="rozet-baslik">Müşteri</div>
                        <div class="rozet-satir"><span class="rozet-deger">${formatSayi(d.toplamMusteri)}</span><span class="rozet-birim">kişi</span></div>
                        <div class="rozet-alt-satir"><span class="rozet-aktif">${formatSayi(d.aktifMusteri)} aktif</span> · <span class="rozet-pasif">${formatSayi(d.pasifMusteri)} pasif</span></div>
                        <span class="rozet-ipucu">Listeyi aç</span>
                    </div>
                </div>
                <div class="ozet-rozet ozet-rozet--sevk tiklanabilir" id="cardSevk" role="button" tabindex="0" title="Bekleyen sevkiyat">
                    <div class="rozet-ikon"><i class="fas fa-truck"></i></div>
                    <div class="rozet-icerik">
                        <div class="rozet-baslik">Bekleyen sevk</div>
                        <div class="rozet-satir"><span class="rozet-deger">${formatSayi(d.bekleyenSevk)}</span></div>
                        <span class="rozet-ipucu">Sevk listesi</span>
                    </div>
                </div>
            `;
            $('cardBugun').addEventListener('click', bugunGoster);
            $('cardMusteri').addEventListener('click', () => panelGoster('musteri'));
            $('cardSevk').addEventListener('click', () => panelGoster('sevk'));
        } catch (err) {
            cards.innerHTML = `<div class="ozet-rozet" style="grid-column:1/-1"><div class="rozet-baslik">Hata</div><div class="rozet-detay">${ekstreRaporKacis(err.message)}</div></div>`;
        }
        piyasaYukle();
        stokOzetYukle();
    }

    async function gunlukOzetYukle() {
        const bas = $('bugunBaslangic')?.value;
        let bit = $('bugunBitis')?.value;
        if (!bas) return;
        if (!mobilAdminMi()) bit = bas;
        else if (!bit) bit = bas;
        if (bas > bit) {
            $('bugunListe').innerHTML = '<div class="empty-msg">Başlangıç tarihi bitişten sonra olamaz</div>';
            return;
        }

        $('bugunTarihLbl').textContent = gunlukOzetAralikMetni(bas, bit);
        $('bugunListe').innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        $('bugunOzet').innerHTML = '';

        try {
            const [hareketRes, giderRes] = await Promise.all([
                apiFetch(`/api/gunluk-hareketler?baslangic=${bas}&bitis=${bit}`),
                apiFetch(`/api/gunluk-giderler?baslangic=${bas}&bitis=${bit}`)
            ]);
            const hareketler = await apiJson(hareketRes, 'Hareket listesi alınamadı.');
            const giderler = giderRes.ok ? await giderRes.json().catch(() => []) : [];

            if (!hareketRes.ok || !Array.isArray(hareketler)) {
                $('bugunListe').innerHTML = '<div class="empty-msg">Hareket listesi alınamadı</div>';
                return;
            }

            const { komur, un } = hareketlerdenSatisAdet(hareketler);
            const { nakit, kart, havale } = hareketlerdenTahsilatKirilim(hareketler);
            let toplamBorc = 0;
            let toplamOdeme = 0;
            let toplamGider = 0;
            hareketler.forEach((h) => {
                toplamBorc += Number(h.BORÇ) || 0;
                toplamOdeme += Number(h.ÖDEME) || 0;
            });
            (Array.isArray(giderler) ? giderler : []).forEach((g) => {
                if (g.IslemTipi !== 'Mazot Çıkışı') toplamGider += Number(g.Tutar) || 0;
            });
            const netKasa = toplamOdeme - toplamGider;

            $('bugunOzet').className = 'bugun-ozet bugun-ozet--kompakt';
            $('bugunOzet').innerHTML = gunlukOzetRozetHtml({
                komur, un, nakit, kart, havale, toplamBorc, toplamOdeme, toplamGider, netKasa
            });

            const birlesik = [];
            hareketler.forEach((h) => {
                birlesik.push({ tip: 'cari', tarih: h.TARİH || h.TARIH, html: gunlukOzetHareketKarti(h) });
            });
            (Array.isArray(giderler) ? giderler : []).forEach((g) => {
                birlesik.push({ tip: 'gider', tarih: g.Tarih, html: gunlukOzetGiderKarti(g) });
            });
            birlesik.sort((a, b) => dbTarihSortKey(b.tarih) - dbTarihSortKey(a.tarih));

            if (!birlesik.length) {
                $('bugunListe').innerHTML = '<div class="empty-msg">Seçilen tarihlerde kayıt yok</div>';
                return;
            }
            $('bugunListe').innerHTML = birlesik.map((x) => x.html).join('');
        } catch (err) {
            $('bugunListe').innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    async function bugunGoster() {
        overlayAc('overlay-bugun');
        gunlukOzetTarihleriIlk();
        gunlukOzetYetkiAyarla();
        await gunlukOzetYukle();
    }

    async function piyasaYukle() {
        const el = $('piyasaBar');
        try {
            const res = await apiFetch('/api/piyasa-ozet', { cache: 'no-store' });
            const d = await apiJson(res, 'Piyasa alınamadı.');
            const usd = d.usd?.satis ?? d.usd;
            const eur = d.eur?.satis ?? d.eur;
            const gram = d.gramHasAltin ?? d.gramHas;
            const ceyrek = d.ceyrekAltinYaklasik ?? d.ceyrek;
            if (!d.ok && usd == null && eur == null) {
                el.innerHTML = '<span class="empty-msg">Piyasa verisi yok</span>';
                return;
            }
            const chips = [];
            if (usd != null) chips.push(`USD <b>${usd}</b>`);
            if (eur != null) chips.push(`EUR <b>${eur}</b>`);
            if (gram != null) chips.push(`Has <b>${formatSayi(gram)}</b>`);
            if (ceyrek != null) chips.push(`Çeyrek <b>${formatSayi(ceyrek)}</b>`);
            el.innerHTML = chips.map((c) => `<span class="piyasa-chip">${c}</span>`).join('') || '—';
        } catch {
            el.textContent = 'Piyasa yüklenemedi';
        }
    }

    async function stokOzetYukle() {
        const el = $('stokOzetListe');
        try {
            const rows = await stoklariYukleCache();
            if (!rows.length) {
                el.innerHTML = '<div class="empty-msg">Stok kaydı yok</div>';
                return;
            }
            el.innerHTML = rows.slice(0, 6).map((r) => {
                const ad = r.temel_ad || r.cins || '—';
                const birim = r.birim_turu || '';
                const sev = stokSeviye(r.mevcut_stok_ton, r.esik_alt, r.esik_ust);
                return `<div class="row"><span>${ad} <small>(${birim})</small></span>${badgeHtml(sev)}</div>`;
            }).join('');
            if (rows.length > 6) {
                el.innerHTML += `<div class="empty-msg">+${rows.length - 6} ürün (Stok sekmesi)</div>`;
            }
        } catch {
            el.textContent = 'Stok özeti yüklenemedi';
        }
    }

    async function stokYukle() {
        const el = $('stokListe');
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const rows = await stoklariYukleCache();
            if (!rows.length) {
                el.innerHTML = '<div class="empty-msg">Stok bulunamadı</div>';
                return;
            }
            el.innerHTML = rows.map((r) => {
                const sev = stokSeviye(r.mevcut_stok_ton, r.esik_alt, r.esik_ust);
                return `<div class="stok-item">
                    <div class="name">${r.cins || '—'}</div>
                    <div class="meta">${r.birim_turu || ''}</div>
                    <div class="row2">
                        <span><strong>${formatSayi(r.mevcut_stok_ton)}</strong> · ${formatPara(r.ton_fiyati)}</span>
                        ${badgeHtml(sev)}
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    async function sevkYukle() {
        const el = $('sevkListe');
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch('/api/bekleyen-teslimatlar');
            const rows = await res.json();
            if (!Array.isArray(rows) || !rows.length) {
                el.innerHTML = '<div class="empty-msg">Bekleyen sevkiyat yok</div>';
                return;
            }
            el.innerHTML = rows.map((r) => {
                const musteriHtml = musteriKimlikHtml(r).replace(/bugun-musteri/g, 'sevk-musteri').replace(/bugun-musteri-alt/g, 'sevk-musteri-alt');
                const kalan = r.KalanTeslimat ?? r.ADET ?? 0;
                const adr = [r.Ilce, r.Mahalle, r.Adres].filter(Boolean).join(' · ');
                return `<div class="sevk-item">
                    ${musteriHtml}
                    <div class="detay">${r.AÇIKLAMA || '—'}${adr ? '<br>' + adr : ''}</div>
                    <span class="miktar">Kalan: ${formatSayi(kalan)}</span>
                </div>`;
            }).join('');
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function bakiyeMetni(bakiye) {
        const b = Number(bakiye) || 0;
        if (b > 0) return { txt: `Borç: ${formatPara(b)}`, cls: 'bakiye-borc' };
        if (b < 0) return { txt: `Alacak: ${formatPara(Math.abs(b))}`, cls: 'bakiye-alacak' };
        return { txt: 'Kapalı', cls: '' };
    }

    function musteriGoster(liste) {
        const el = $('musteriListe');
        if (!liste.length) {
            el.innerHTML = '<div class="empty-msg">Kayıt yok</div>';
            return;
        }
        const goster = liste.slice(0, 150);
        const parca = goster.map((m) => {
            const id = musteriKimlik(m);
            const b = bakiyeMetni(m.Bakiye);
            const meta = musteriTelMahalleMeta(m);
            const durum = m.MusteriDurum || '';
            const durumHtml = durum === 'Aktif'
                ? '<span class="musteri-durum-rozet musteri-durum-rozet--aktif">Aktif</span>'
                : durum === 'Pasif'
                    ? '<span class="musteri-durum-rozet musteri-durum-rozet--pasif">Pasif</span>'
                    : '';
            return `<div class="musteri-item" data-id="${id}" role="button" tabindex="0">
                <div class="musteri-item-ust">
                    <div class="musteri-item-sol">
                        ${musteriListeKimlikHtml(m)}${durumHtml}
                        <div class="musteri-meta">${ekstreRaporKacis(meta)}</div>
                    </div>
                    <div class="bakiye ${b.cls}">${b.txt}</div>
                </div>
            </div>`;
        }).join('');
        const uyari = liste.length > 150
            ? `<div class="empty-msg">İlk 150 kayıt gösteriliyor (toplam ${liste.length}). Arama kutusu ile daraltın.</div>`
            : '';
        el.innerHTML = parca + uyari;
    }

    async function musteriDetayAc(musteriId) {
        const id = Number(musteriId);
        if (!id) {
            toast('Müşteri seçilemedi');
            return;
        }
        const m = musteriCache.find((x) => musteriKimlik(x) === id);
        if (!m) {
            toast('Müşteri bulunamadı');
            return;
        }
        aktifMusteri = m;
        musteriDetayBaslikGuncelle(m);
        musteriOzetGuncelle(m);
        musteriMenuKapat();
        overlayAc('overlay-musteri');
        await musteriApartmanBilgisiYukle(id);
        await musteriDetayNotlariSenkronize(id);
        await musteriEkstreYukle(id);
    }

    async function musteriApartmanBilgisiYukle(musteriId) {
        const bolum = $('musteriApartmanBolum');
        const liste = $('musteriApartmanListe');
        if (!bolum || !liste) return;
        bolum.style.display = 'none';
        liste.innerHTML = '';
        try {
            const res = await apiFetch(`/api/musteri/${musteriId}/apartman-daireler?_t=` + Date.now());
            const rows = await res.json();
            if (!res.ok || !Array.isArray(rows) || !rows.length) return;
            const borcGerekli = rows.some((d) => (parseFloat(d.AnlasilanMiktar) || 0) > 0 && (parseFloat(d.BirimFiyat) || 0) > 0);
            if (borcGerekli) {
                await apiFetch(`/api/musteri/${musteriId}/apartman-borc-esitle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            }
            liste.innerHTML = rows.map((d) => {
                const anlasilan = parseFloat(d.AnlasilanMiktar) || 0;
                const teslim = parseFloat(d.TeslimEdilen) || 0;
                const kalan = anlasilan - teslim;
                let durum, cls;
                if (anlasilan > 0 && teslim >= anlasilan) { durum = 'Tamam'; cls = 'tedarikci-tur--odeme'; }
                else if (teslim > 0) { durum = 'Kısmi'; cls = 'tedarikci-tur--alim'; }
                else if (anlasilan > 0) { durum = 'Bekliyor'; cls = 'tedarikci-tur--alim'; }
                else { durum = 'Anlaşma yok'; cls = ''; }
                const yer = `${d.Blok ? d.Blok + ' Blok · ' : ''}Daire ${d.DaireNo || ''}`;
                return `<div class="ekstre-item" data-apt-git="${d.ApartmanId}" role="button">
                    <div class="ust"><span>${ekstreRaporKacis(d.ApartmanAd)}</span><span class="ust-sag"><span class="tedarikci-tur ${cls}">${durum}</span></span></div>
                    <div class="aciklama">${ekstreRaporKacis(yer)}${d.UrunAdi ? ' · ' + ekstreRaporKacis(d.UrunAdi) : ''}</div>
                    <div class="alt"><span class="alt-detay">Anlaşılan ${aptSayi(anlasilan)} · Teslim ${aptSayi(teslim)}</span><span>${anlasilan ? 'Kalan: ' + aptSayi(kalan) : ''}</span></div>
                </div>`;
            }).join('');
            bolum.style.display = 'block';
        } catch (_) {}
    }

    async function satisKaydet() {
        if (!aktifMusteri) return;
        const komurId = parseInt($('satisUrun').value, 10);
        const miktar = parseFloat($('satisMiktar').value);
        const tutar = parseFloat($('satisTutar').value);
        const teslim = $('satisTeslim').value;
        const notlar = $('satisNot').value.trim();
        const odemeAl = $('satisOdemeAl').checked;
        const odemeTuru = $('satisOdemeTuru').value || 'Nakit';
        let odemeTutar = odemeAl ? (parseFloat($('satisOdemeTutar').value) || 0) : 0;
        if (odemeAl && odemeTutar <= 0) odemeTutar = tutar;
        const oturum = oturumOku();
        const mid = musteriKimlik(aktifMusteri);
        const oncekiBakiye = Number(aktifMusteri.Bakiye) || 0;
        const satisOdemeTuru = odemeAl && odemeTutar > 0 ? odemeTuru : 'Veresiye';

        if (!komurId || !miktar || miktar <= 0) {
            toast('Ürün ve miktar girin');
            return;
        }
        if (!tutar || tutar <= 0) {
            toast('Geçerli tutar girin');
            return;
        }

        const btn = $('btnSatisKaydet');
        btn.disabled = true;
        btn.textContent = 'Kaydediliyor…';
        try {
            const res = await apiFetch('/api/satis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    musteri_id: mid,
                    komur_id: komurId,
                    miktar_ton: miktar,
                    toplam_tutar: tutar,
                    notlar,
                    teslim_durumu: teslim,
                    satis_odeme_turu: satisOdemeTuru,
                    tarih: simdiTarihSql(),
                    islemiYapan: oturum?.adSoyad || 'Mobil'
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Satış kaydedilemedi');

            if (odemeAl && odemeTutar > 0) {
                const yonlendi = await tahsilatTaksitRadari(odemeTutar, odemeTuru, notlar, 'modal-satis');
                if (!yonlendi) {
                    const yeniBakiye = (oncekiBakiye + tutar) - odemeTutar;
                    await makbuzluOdemeKaydet(
                        odemeTutar,
                        odemeTuru,
                        tahsilatAciklama(odemeTuru, notlar, true),
                        notlar,
                        yeniBakiye,
                        false
                    );
                }
                toast(`Satış + ${odemeTuru} ${formatPara(odemeTutar)} kaydedildi`);
            } else {
                toast('Satış kaydedildi');
            }

            modalKapat('modal-satis');
            await musteriYenileVeGoster(mid);
            anaYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Kaydet';
        }
    }

    async function odemeKaydet() {
        if (!aktifMusteri) return;
        const tutar = parseFloat($('odemeTutar').value);
        const odemeTuru = $('odemeTuru').value || 'Nakit';
        const not = $('odemeNot').value.trim();
        const mid = musteriKimlik(aktifMusteri);
        const oncekiBakiye = Number(aktifMusteri.Bakiye) || 0;

        if (!tutar || tutar <= 0) {
            toast('Geçerli tutar girin');
            return;
        }
        if (!odemeTuru) {
            toast('Ödeme türü seçin');
            return;
        }

        const btn = $('btnOdemeKaydet');
        btn.disabled = true;
        btn.textContent = 'Kaydediliyor…';
        try {
            const yonlendi = await tahsilatTaksitRadari(tutar, odemeTuru, not);
            if (yonlendi) return;

            const kutuAcik = $('odemeKapsamKutu') && !$('odemeKapsamKutu').classList.contains('d-none');
            const secilenKapsam = kutuAcik ? ($('odemeKapsam').value) : (window.mobilOdemeKapsam || 'apartman');
            await makbuzluOdemeKaydet(
                tutar,
                odemeTuru,
                tahsilatAciklama(odemeTuru, not, false),
                not,
                oncekiBakiye - tutar,
                secilenKapsam !== 'genel'
            );
            toast(`${odemeTuru} tahsilat kaydedildi`);
            modalKapat('modal-odeme');
            await musteriYenileVeGoster(mid);
            anaYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Ödemeyi kaydet';
        }
    }

    let sonTedarikciHareketleri = [];
    let tedarikciMobilGuncelKur = null;
    let tedarikciMobilOzet = {};

    function alimParseUrunAdi(urunAdi) {
        if (!urunAdi) return { temizAd: '', birimTuru: 'Ton' };
        const s = String(urunAdi).trim();
        let temizAd = s;
        let birimTuru = 'Ton';
        if (s.includes(' (')) {
            const parcalar = s.split(' (');
            temizAd = parcalar[0].trim();
            birimTuru = (parcalar[1] || '').replace(/\)/g, '').trim() || 'Ton';
        } else if (s.toLowerCase().includes('çuval')) birimTuru = 'Çuval';
        else if (s.toLowerCase().includes('adet')) birimTuru = 'Adet';
        return { temizAd, birimTuru };
    }

    function malAlimStokToGiris(stokMiktar, girisBirimi, satisBirimi, adetKg) {
        const m = parseFloat(stokMiktar) || 0;
        if (m <= 0) return 0;
        const g = String(girisBirimi || '').trim();
        const s = String(satisBirimi || 'Ton').trim();
        if (!g || g === s) return m;
        const kg = parseFloat(adetKg) || 0;
        const cuvalKg = kg > 0 ? kg : malAlimCuvalKg(s);
        if (g === 'Ton' && s === 'Adet' && kg > 0) return (m * kg) / 1000;
        if (g === 'Ton' && /çuval/i.test(s) && cuvalKg > 0) return (m * cuvalKg) / 1000;
        return m;
    }

    function alimHareketGirisBirimi(h) {
        if (h.GirisBirimi) return h.GirisBirimi;
        const satisBirimi = alimParseUrunAdi(h.UrunAdi).birimTuru;
        const stokMiktar = parseFloat(h.Miktar) || 0;
        const adetKg = parseFloat(h.AdetBasinaKg) || 0;
        if (satisBirimi === 'Adet' && adetKg > 0 && stokMiktar > 0) return 'Ton';
        if (satisBirimi === 'Adet' || /çuval/i.test(satisBirimi)) return 'Adet';
        return h.AlimBirimi || 'Ton';
    }

    function alimHareketGirisOzet(h) {
        const satisBirimi = alimParseUrunAdi(h.UrunAdi).birimTuru;
        const alimBirimi = alimHareketGirisBirimi(h);
        const adetKg = parseFloat(h.AdetBasinaKg) || 0;
        const stokMiktar = parseFloat(h.Miktar) || 0;
        const girisMiktar = h.GirisMiktar != null && parseFloat(h.GirisMiktar) > 0
            ? parseFloat(h.GirisMiktar)
            : malAlimStokToGiris(stokMiktar, alimBirimi, satisBirimi, adetKg);
        const pb = h.ParaBirimi === 'USD' ? 'USD' : 'TRY';
        const pbSembol = pb === 'USD' ? '$' : '₺';
        const toplamBorcPb = pb === 'USD'
            ? (parseFloat(h.DovizTutar) || 0)
            : (parseFloat(h.ToplamTutar ?? h.Borc) || 0);
        const birimMaliyetGiris = girisMiktar > 0 && toplamBorcPb > 0 ? toplamBorcPb / girisMiktar : 0;
        const birimMaliyetStok = stokMiktar > 0 && toplamBorcPb > 0
            ? toplamBorcPb / stokMiktar
            : (parseFloat(h.BirimFiyat) || 0);
        const stokBirimEtiket = satisBirimi === 'Adet' ? 'Torba' : satisBirimi;
        return { satisBirimi, alimBirimi, adetKg, stokMiktar, girisMiktar, birimMaliyetGiris, birimMaliyetStok, stokBirimEtiket, toplamBorcPb, pbSembol, pb };
    }

    function alimMaliyetMetni(ozet, guncelKur) {
        if (ozet.birimMaliyetGiris <= 0) return '—';
        const satirlar = [`${ozet.birimMaliyetGiris.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${ozet.pbSembol}/${ozet.alimBirimi}`];
        const torbaGoster = (ozet.satisBirimi === 'Adet' || /çuval/i.test(ozet.satisBirimi))
            && ozet.birimMaliyetStok > 0
            && (ozet.alimBirimi !== ozet.satisBirimi || Math.abs(ozet.birimMaliyetGiris - ozet.birimMaliyetStok) > 0.005);
        if (torbaGoster) {
            satirlar.push(`${ozet.birimMaliyetStok.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${ozet.pbSembol}/${ozet.stokBirimEtiket}`);
        }
        const kur = parseFloat(guncelKur) || 0;
        if (ozet.pb === 'USD' && kur > 0) {
            satirlar.push(`≈ ${(ozet.birimMaliyetGiris * kur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺/${ozet.alimBirimi}`);
            if (torbaGoster) satirlar.push(`≈ ${(ozet.birimMaliyetStok * kur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺/${ozet.stokBirimEtiket}`);
        }
        return satirlar.join('\n');
    }

    function tedarikciGoster(liste) {
        const el = $('tedarikciListe');
        if (!liste.length) {
            el.innerHTML = '<div class="empty-msg">Kayıt yok</div>';
            return;
        }
        el.innerHTML = liste.map((t) => {
            const bakiye = Number(t.Bakiye) || 0;
            const cls = bakiye > 0 ? 'tedarikci-bakiye--borc' : bakiye < 0 ? 'tedarikci-bakiye--alacak' : '';
            const doviz = Number(t.ToplamDovizBorc) || 0;
            const kurNot = doviz > 0 && t.GuncelUsdKuru
                ? `<div class="tedarikci-item-meta">$${doviz.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} · güncel ${(t.GuncelTlKarsiligi || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>`
                : '';
            return `<div class="tedarikci-item" data-id="${t.ID}" role="button" tabindex="0">
                <div class="tedarikci-item-ust">
                    <div>
                        <div class="tedarikci-item-ad">${ekstreRaporKacis(t.FirmaAdi)}</div>
                        <div class="tedarikci-item-meta">${ekstreRaporKacis(t.YetkiliKisi || '')} ${ekstreRaporKacis(t.Telefon || '')}</div>
                        ${kurNot}
                    </div>
                    <div class="tedarikci-bakiye ${cls}">${formatPara(Math.abs(bakiye))}</div>
                </div>
            </div>`;
        }).join('');
    }

    async function tedarikciYukle() {
        const el = $('tedarikciListe');
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch('/api/tedarikciler');
            const rows = await res.json();
            if (!Array.isArray(rows)) throw new Error('Liste alınamadı');
            tedarikciCache = rows;
            tedarikciGoster(rows);
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function tedarikciFiltrele(q) {
        const s = String(q || '').trim().toLocaleLowerCase('tr-TR');
        if (!s) {
            tedarikciGoster(tedarikciCache);
            return;
        }
        tedarikciGoster(tedarikciCache.filter((t) => {
            const blob = [t.FirmaAdi, t.YetkiliKisi, t.Telefon].join(' ').toLocaleLowerCase('tr-TR');
            return blob.includes(s);
        }));
    }

    function tedarikciHareketSatirHtml(h) {
        const borc = Number(h.Borc) || 0;
        const odeme = Number(h.Odeme) || 0;
        const alimMi = h.Tur === 'ALIM' || borc > 0;
        const turCls = alimMi ? 'tedarikci-tur--alim' : 'tedarikci-tur--odeme';
        const turTxt = alimMi ? 'Alım' : 'Ödeme';

        let tutarHtml = '—';
        if (borc > 0) tutarHtml = `<span class="borc">${formatPara(borc)}</span>`;
        if (odeme > 0) tutarHtml = `<span class="odeme">${formatPara(odeme)}</span>`;

        let altDetay = '';
        if (alimMi && h.Miktar) {
            const ozet = alimHareketGirisOzet(h);
            const stokNot = ozet.alimBirimi !== ozet.satisBirimi
                ? ` (${ozet.girisMiktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${ozet.alimBirimi})`
                : '';
            altDetay = `${ozet.girisMiktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${ozet.alimBirimi} → ${formatSayi(ozet.stokMiktar)} ${ozet.satisBirimi}${stokNot}`;
            const maliyet = alimMaliyetMetni(ozet, tedarikciMobilGuncelKur);
            if (maliyet !== '—') altDetay += '\n' + maliyet;
        }

        const kurSatir = (h.ParaBirimi === 'USD' && h.DovizTutar)
            ? `<div class="bakiye-satir">$${Number(h.DovizTutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} @ ${Number(h.IslemKuru || 1).toLocaleString('tr-TR', { minimumFractionDigits: 4 })}</div>`
            : '';

        const odemeUsd = (!alimMi && h.ParaBirimi === 'USD' && h.DovizTutar)
            ? `<div class="bakiye-satir">$${Number(h.DovizTutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ödeme</div>`
            : '';

        const notSatir = (h.Aciklama && h.Aciklama !== 'null')
            ? `<div class="bakiye-satir">${ekstreRaporKacis(h.Aciklama)}</div>`
            : '';

        const infoBtn = alimMi && h.ID
            ? `<button type="button" class="ekstre-info-btn" data-alim-detay="${h.ID}" title="Maliyet detayı"><i class="fas fa-info-circle"></i></button>`
            : '';
        const silBtn = h.ID
            ? `<button type="button" class="ekstre-sil-btn" data-tedarikci-sil="${h.ID}" data-tedarikci-tur="${h.Tur || (alimMi ? 'ALIM' : 'ODEME')}" title="Sil"><i class="fas fa-trash-alt"></i></button>`
            : '';
        const aksiyonHtml = (infoBtn || silBtn)
            ? `<span class="ekstre-aksiyonlar">${infoBtn}${silBtn}</span>`
            : '';

        return `<div class="ekstre-item">
            <div class="ust">
                <span>${tarihGoster(h.Tarih, true)}</span>
                <span class="ust-sag"><span class="tedarikci-tur ${turCls}">${turTxt}</span>${aksiyonHtml}</span>
            </div>
            <div class="aciklama">${ekstreRaporKacis(h.Islem || '—')}</div>
            <div class="alt">
                <span class="alt-detay pre-line">${ekstreRaporKacis(altDetay)}</span>
                ${tutarHtml}
            </div>
            ${kurSatir}${odemeUsd}${notSatir}
        </div>`;
    }

    function tedarikciOzetGuncelle(toplamAlim, toplamOdeme, bakiye) {
        const alimEl = $('tedarikciOzetAlim');
        const odemeEl = $('tedarikciOzetOdeme');
        const bakiyeEl = $('tedarikciOzetBakiye');
        if (alimEl) alimEl.textContent = formatPara(toplamAlim);
        if (odemeEl) odemeEl.textContent = formatPara(toplamOdeme);
        if (bakiyeEl) {
            bakiyeEl.textContent = formatPara(Math.abs(bakiye));
            bakiyeEl.className = 'val ' + (bakiye > 0 ? 'bakiye-borc' : bakiye < 0 ? 'bakiye-alacak' : '');
        }
    }

    async function tedarikciDetayAc(id) {
        const t = tedarikciCache.find((x) => x.ID === id);
        if (!t) {
            toast('Tedarikçi bulunamadı');
            return;
        }
        aktifTedarikci = t;
        $('tedarikciDetayAd').textContent = t.FirmaAdi || 'Tedarikçi';
        const meta = [t.YetkiliKisi, t.Telefon].filter(Boolean).join(' · ');
        $('tedarikciDetayMeta').textContent = meta || '—';

        const kurNot = $('tedarikciMobilKurNotu');
        const bakiye = Number(t.Bakiye) || 0;
        const doviz = Number(t.ToplamDovizBorc) || 0;
        if (kurNot) {
            if (doviz > 0 && t.GuncelUsdKuru) {
                kurNot.classList.remove('d-none');
                kurNot.innerHTML = `<i class="fas fa-coins me-1"></i>Güncel kur <strong>${Number(t.GuncelUsdKuru).toLocaleString('tr-TR', { minimumFractionDigits: 4 })} ₺</strong> — kayıtlı <strong>$${doviz.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong> borcun karşılığı <strong>${formatPara(t.GuncelTlKarsiligi || 0)}</strong>`;
            } else if (bakiye > 0) {
                kurNot.classList.remove('d-none');
                kurNot.innerHTML = `<i class="fas fa-info-circle me-1"></i>Defter borcu: <strong>${formatPara(bakiye)}</strong>`;
            } else {
                kurNot.classList.add('d-none');
            }
        }

        overlayAc('overlay-tedarikci');
        const liste = $('tedarikciHareketListe');
        liste.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch(`/api/tedarikci-hareketleri/${id}?_t=${Date.now()}`);
            const yanit = await res.json();
            const hareketler = Array.isArray(yanit) ? yanit : (yanit.hareketler || []);
            sonTedarikciHareketleri = hareketler;
            tedarikciMobilGuncelKur = yanit.guncelUsdKuru || null;
            if (!hareketler.length) {
                tedarikciOzetGuncelle(0, 0, 0);
                liste.innerHTML = '<div class="empty-msg">Hareket yok</div>';
                return;
            }

            let toplamAlim = 0;
            let toplamOdeme = 0;
            let toplamDovizBorc = 0;
            hareketler.forEach((h) => {
                toplamAlim += Number(h.Borc) || 0;
                toplamOdeme += Number(h.Odeme) || 0;
                if (h.ParaBirimi === 'USD' && h.DovizTutar) {
                    const dv = parseFloat(h.DovizTutar) || 0;
                    if (h.Tur === 'ALIM') toplamDovizBorc += dv;
                    else if (h.Tur === 'ODEME') toplamDovizBorc -= dv;
                }
            });
            const guncelBakiye = toplamAlim - toplamOdeme;
            tedarikciMobilOzet = { tlBakiye: guncelBakiye, usdBorc: Math.max(0, toplamDovizBorc), guncelKur: tedarikciMobilGuncelKur };
            tedarikciOzetGuncelle(toplamAlim, toplamOdeme, guncelBakiye);

            const gosterim = [...hareketler].reverse();
            liste.innerHTML = gosterim.map(tedarikciHareketSatirHtml).join('');
        } catch (err) {
            liste.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function malAlimUrunMeta() {
        const sel = $('malAlimUrun');
        if (!sel || sel.selectedIndex < 0) return { satisBirimi: 'Ton', adetKg: 0, alimBirimi: 'Ton' };
        const opt = sel.options[sel.selectedIndex];
        return {
            satisBirimi: opt.getAttribute('data-birim') || 'Ton',
            adetKg: parseFloat(opt.getAttribute('data-adet-kg')) || 0,
            alimBirimi: opt.getAttribute('data-alim-birimi') || 'Ton'
        };
    }

    function malAlimCuvalKg(birim) {
        const m = String(birim || '').match(/(\d+(?:[.,]\d+)?)\s*KG/i);
        return m ? parseFloat(String(m[1]).replace(',', '.')) : 0;
    }

    function malAlimGirisToStok(girisMiktar, girisBirimi, satisBirimi, adetKg) {
        const miktar = parseFloat(girisMiktar) || 0;
        if (miktar <= 0) return 0;
        const g = String(girisBirimi || '').trim();
        const s = String(satisBirimi || 'Ton').trim();
        if (!g || g === s) return miktar;
        const cuvalKg = malAlimCuvalKg(s);
        if (g === 'Ton') {
            const kg = miktar * 1000;
            if (s === 'Adet' && adetKg > 0) return kg / adetKg;
            if (/çuval/i.test(s) && cuvalKg > 0) return kg / cuvalKg;
        }
        return miktar;
    }

    function malAlimGirisBirimSecenekleri(meta) {
        if (meta.satisBirimi === 'Adet' || /çuval/i.test(meta.satisBirimi)) return ['Ton', 'Adet'];
        if (meta.alimBirimi !== meta.satisBirimi) return [meta.alimBirimi || 'Ton', meta.satisBirimi];
        return [meta.satisBirimi || meta.alimBirimi || 'Ton'];
    }

    function malAlimUrunDegisti(preferredGiris) {
        const meta = malAlimUrunMeta();
        const miktarLbl = $('malAlimMiktarEtiket');
        const girisSel = $('malAlimGirisBirimi');
        const opts = [...new Set(malAlimGirisBirimSecenekleri(meta))];
        if (girisSel) {
            girisSel.innerHTML = opts.map((b) => `<option value="${b}">${b}</option>`).join('');
            const secim = preferredGiris && opts.includes(preferredGiris)
                ? preferredGiris
                : (opts.includes('Ton') ? 'Ton' : opts[0]);
            girisSel.value = secim;
        }
        if (miktarLbl) miktarLbl.textContent = `Miktar (${girisSel?.value || meta.alimBirimi})`;
        malAlimEtiketGuncelle();
        malAlimOzetGuncelle();
    }

    function malAlimEtiketGuncelle() {
        const odeme = $('malAlimOdeme')?.value || '';
        const acik = odeme.includes('Açık Hesap') || odeme.includes('Borç');
        const pb = $('malAlimParaBirimi')?.value || 'TRY';
        const girisBirimi = $('malAlimGirisBirimi')?.value || 'Ton';
        const sembol = acik && pb === 'USD' ? '$' : '₺';
        const maliyetEtiket = $('malAlimBirimMaliyetEtiket');
        const toplamEtiket = $('malAlimToplamEtiket2');
        if (maliyetEtiket) maliyetEtiket.textContent = `${girisBirimi} başına (${sembol})`;
        if (toplamEtiket) toplamEtiket.textContent = acik ? 'Toplam borç' : 'Toplam ödeme';
    }

    function malAlimOdemeDegisti() {
        const odeme = $('malAlimOdeme')?.value || '';
        const acik = odeme.includes('Açık Hesap') || odeme.includes('Borç');
        const blok = $('malAlimBorcBlok');
        if (blok) blok.style.display = acik ? '' : 'none';
        malAlimEtiketGuncelle();
        malAlimOzetGuncelle();
    }

    function malAlimParaBirimiDegisti() {
        const pb = $('malAlimParaBirimi')?.value || 'TRY';
        const kurLbl = document.querySelector('label[for="malAlimKur"]');
        const kurInp = $('malAlimKur');
        if (kurLbl) kurLbl.style.display = pb === 'USD' ? '' : 'none';
        if (kurInp) kurInp.style.display = pb === 'USD' ? '' : 'none';
        malAlimEtiketGuncelle();
        if (pb === 'USD') malAlimKurDoldur();
        malAlimOzetGuncelle();
    }

    async function tcmbKurAl() {
        try {
            const res = await apiFetch('/api/tcmb-piyasa');
            const data = await res.json();
            if (data.ok && data.usd?.satis) {
                const kur = parseFloat(String(data.usd.satis).replace(/\./g, '').replace(',', '.'));
                if (kur > 0) return kur;
            }
        } catch (_e) { /* sessiz */ }
        return null;
    }

    async function kurInputDoldur(hedefId) {
        const kur = await tcmbKurAl();
        const el = $(hedefId);
        if (kur && el && !parseFloat(el.value)) el.value = kur.toFixed(4);
    }

    async function malAlimKurDoldur() {
        await kurInputDoldur('malAlimKur');
    }

    function malAlimOzetGuncelle() {
        const girisMiktar = parseFloat($('malAlimMiktar')?.value) || 0;
        const birimMaliyet = parseFloat($('malAlimBirimMaliyet')?.value) || 0;
        const pb = $('malAlimParaBirimi')?.value || 'TRY';
        const kur = parseFloat($('malAlimKur')?.value) || 1;
        const odeme = $('malAlimOdeme')?.value || '';
        const acik = odeme.includes('Açık Hesap') || odeme.includes('Borç');
        const meta = malAlimUrunMeta();
        const girisBirimi = $('malAlimGirisBirimi')?.value || meta.alimBirimi;
        const stokMiktar = malAlimGirisToStok(girisMiktar, girisBirimi, meta.satisBirimi, meta.adetKg);
        const toplamBorc = girisMiktar > 0 && birimMaliyet > 0 ? girisMiktar * birimMaliyet : 0;
        const birimFiyatStok = stokMiktar > 0 && toplamBorc > 0 ? toplamBorc / stokMiktar : 0;
        const pbSembol = acik && pb === 'USD' ? '$' : '₺';

        const toplamGost = $('malAlimToplamGosterge');
        if (toplamGost) {
            toplamGost.textContent = toplamBorc > 0
                ? toplamBorc.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ' + pbSembol
                : '0,00';
        }

        const birimHesap = $('malAlimBirimFiyatHesap');
        if (birimHesap) {
            birimHesap.textContent = stokMiktar > 0 && toplamBorc > 0
                ? `Stok: ${birimFiyatStok.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${pbSembol}/${meta.satisBirimi}`
                : (girisMiktar > 0 && birimMaliyet > 0 ? `${girisMiktar} ${girisBirimi} × ${birimMaliyet.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${pbSembol}` : 'Miktar × birim maliyet = toplam');
        }

        const donusum = $('malAlimDonusumNotu');
        if (donusum) {
            donusum.textContent = girisBirimi !== meta.satisBirimi && stokMiktar > 0
                ? `Stoğa: ${formatSayi(stokMiktar)} ${meta.satisBirimi}`
                : (stokMiktar > 0 ? `Stok: ${formatSayi(stokMiktar)} ${meta.satisBirimi}` : '');
        }

        let tl = toplamBorc;
        const ozet = $('malAlimOzet');
        if (!ozet) return;
        if (acik && pb === 'USD' && toplamBorc > 0) {
            tl = toplamBorc * kur;
            ozet.innerHTML = `$${toplamBorc.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} × kur ${kur.toLocaleString('tr-TR', { minimumFractionDigits: 4 })} → defter <strong>${formatPara(tl)}</strong>`;
        } else {
            ozet.textContent = toplamBorc > 0 ? `Deftere: ${formatPara(tl)}` : '—';
        }
    }

    async function malAlimAc() {
        if (!aktifTedarikci) return;
        if (!stokCache.length) await stoklariYukleCache();
        const sel = $('malAlimUrun');
        sel.innerHTML = stokCache.map((r) => {
            const birim = r.birim_turu || r.Birim || 'Ton';
            const adetKg = r.adet_basina_kg || r.AdetBasinaKg || '';
            const alimBirimi = r.alim_birimi || r.AlimBirimi || 'Ton';
            return `<option value="${r.id}" data-birim="${birim}" data-adet-kg="${adetKg}" data-alim-birimi="${alimBirimi}">${r.cins || r.temel_ad}</option>`;
        }).join('');
        $('malAlimMiktar').value = '';
        $('malAlimBirimMaliyet').value = '';
        $('malAlimOdeme').value = 'Açık Hesap (Borç)';
        $('malAlimParaBirimi').value = 'TRY';
        malAlimUrunDegisti();
        malAlimOdemeDegisti();
        malAlimParaBirimiDegisti();
        await malAlimKurDoldur();
        malAlimOzetGuncelle();
        modalAc('modal-mal-alim');
    }

    async function malAlimKaydet() {
        if (!aktifTedarikci) return;
        const urunId = parseInt($('malAlimUrun').value, 10);
        const girisMiktar = parseFloat($('malAlimMiktar').value);
        const birimMaliyet = parseFloat($('malAlimBirimMaliyet')?.value) || 0;
        const toplamBorcKayit = girisMiktar > 0 && birimMaliyet > 0 ? girisMiktar * birimMaliyet : 0;
        const meta = malAlimUrunMeta();
        const girisBirimi = $('malAlimGirisBirimi')?.value || meta.alimBirimi;
        const stokMiktar = malAlimGirisToStok(girisMiktar, girisBirimi, meta.satisBirimi, meta.adetKg);
        if (!urunId || !girisMiktar || girisMiktar <= 0 || stokMiktar <= 0) {
            toast('Miktar girin');
            return;
        }
        if (!toplamBorcKayit || toplamBorcKayit <= 0) {
            toast('Birim maliyet girin');
            return;
        }
        const birimFiyat = stokMiktar > 0 ? toplamBorcKayit / stokMiktar : 0;
        const odeme = $('malAlimOdeme').value;
        const acik = odeme.includes('Açık Hesap') || odeme.includes('Borç');
        const paraBirimi = acik ? ($('malAlimParaBirimi').value || 'TRY') : 'TRY';
        const islemKuru = paraBirimi === 'USD' ? (parseFloat($('malAlimKur').value) || 0) : 1;
        if (girisBirimi !== meta.satisBirimi && meta.satisBirimi === 'Adet' && meta.adetKg <= 0) {
            toast('Üründe 1 adet kaç KG tanımlı değil');
            return;
        }
        if (acik && paraBirimi === 'USD' && islemKuru <= 0) {
            toast('USD borç için kur girin');
            return;
        }
        const btn = $('btnMalAlimKaydet');
        btn.disabled = true;
        try {
            const res = await apiFetch('/api/mal-alimi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tarih: bugunIso(),
                    tedarikciId: aktifTedarikci.ID,
                    tedarikciFirma: aktifTedarikci.FirmaAdi,
                    urunId,
                    miktar: stokMiktar,
                    birimFiyat,
                    girisMiktar,
                    girisBirimi,
                    toplamBorc: toplamBorcKayit,
                    odeme,
                    paraBirimi, islemKuru,
                    aciklama: '',
                    islemiYapan: oturumOku()?.kullanici || 'Mobil'
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Kayıt başarısız');
            toast('Mal alımı kaydedildi');
            modalKapat('modal-mal-alim');
            await tedarikciYukle();
            const guncel = tedarikciCache.find((x) => x.ID === aktifTedarikci.ID);
            if (guncel) await tedarikciDetayAc(guncel.ID);
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            btn.disabled = false;
        }
    }

    async function tedarikciHareketSil(hareketId, tur) {
        const turEtiket = tur === 'ALIM' ? 'alım' : 'ödeme';
        if (!confirm(`Bu ${turEtiket} kaydını silmek istediğinize emin misiniz?`)) return;
        try {
            const res = await apiFetch(`/api/tedarikci-hareket/${hareketId}?tur=${tur}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Silinemedi');
            toast('Kayıt silindi');
            await tedarikciYukle();
            if (aktifTedarikci) await tedarikciDetayAc(aktifTedarikci.ID);
            await stoklariYukleCache();
            stokYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        }
    }

    function tedarikciOdemeAc() {
        const oz = tedarikciMobilOzet || {};
        const borcEl = $('tedarikciOdemeBorcOzet');
        if (borcEl) {
            let metin = `Defter borcu: ${formatPara(oz.tlBakiye || 0)}`;
            if (oz.usdBorc > 0) metin += ` · Döviz: $${oz.usdBorc.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
            borcEl.textContent = metin;
        }
        $('tedarikciOdemeTutar').value = '';
        $('tedarikciOdemeParaBirimi').value = 'TRY';
        if (oz.guncelKur && $('tedarikciOdemeKur')) $('tedarikciOdemeKur').value = parseFloat(oz.guncelKur).toFixed(4);
        tedarikciOdemeParaDegisti();
        modalAc('modal-tedarikci-odeme');
    }

    function tedarikciOdemeParaDegisti() {
        const pb = $('tedarikciOdemeParaBirimi')?.value || 'TRY';
        const kurBlok = $('tedarikciOdemeKurBlok');
        const etiket = $('tedarikciOdemeTutarEtiket');
        if (kurBlok) kurBlok.style.display = pb === 'USD' ? '' : 'none';
        if (etiket) etiket.textContent = pb === 'USD' ? 'Tutar ($)' : 'Tutar (₺)';
        if (pb === 'USD') kurInputDoldur('tedarikciOdemeKur').then(() => tedarikciOdemeTutarHesapla());
        else tedarikciOdemeTutarHesapla();
    }

    function tedarikciOdemeTutarHesapla() {
        const pb = $('tedarikciOdemeParaBirimi')?.value || 'TRY';
        const tutar = parseFloat($('tedarikciOdemeTutar')?.value) || 0;
        const kur = parseFloat($('tedarikciOdemeKur')?.value) || 0;
        const defterEl = $('tedarikciOdemeDefterTutar');
        if (!defterEl) return;
        if (pb === 'USD' && tutar > 0 && kur > 0) {
            defterEl.textContent = formatPara(tutar * kur);
        } else if (pb === 'TRY' && tutar > 0) {
            defterEl.textContent = formatPara(tutar);
        } else {
            defterEl.textContent = '0,00 ₺';
        }
    }

    function tedarikciAlimDetayAc(hareketId) {
        const h = sonTedarikciHareketleri.find((x) => x.ID === hareketId && x.Tur === 'ALIM');
        if (!h) { toast('Kayıt bulunamadı'); return; }
        const ozet = alimHareketGirisOzet(h);
        const kayitKur = parseFloat(h.IslemKuru) || 1;
        $('alimDetayBaslik').textContent = (h.Islem || '').replace(/^Alım:\s*/, '');
        let html = `<div class="detay-kutu"><div class="lbl">Toptancıdan alım</div><div class="val">${ozet.girisMiktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${ozet.alimBirimi}</div></div>`;
        html += `<div class="detay-kutu"><div class="lbl">Stoğa giren</div><div class="val">${ozet.stokMiktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${ozet.satisBirimi}</div></div>`;
        html += `<div class="detay-kutu"><div class="lbl">${ozet.alimBirimi} başına</div><div class="val">${ozet.birimMaliyetGiris.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${ozet.pbSembol}/${ozet.alimBirimi}</div></div>`;
        const torbaGoster = (ozet.satisBirimi === 'Adet' || /çuval/i.test(ozet.satisBirimi))
            && ozet.birimMaliyetStok > 0
            && (ozet.alimBirimi !== ozet.satisBirimi || Math.abs(ozet.birimMaliyetGiris - ozet.birimMaliyetStok) > 0.005);
        if (torbaGoster) {
            html += `<div class="detay-kutu"><div class="lbl">${ozet.stokBirimEtiket} başına</div><div class="val text-ok">${ozet.birimMaliyetStok.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${ozet.pbSembol}/${ozet.stokBirimEtiket}</div></div>`;
        }
        if (ozet.pb === 'USD') {
            html += `<div class="detay-kutu"><div class="lbl">İşlem kuru</div><div class="val">${kayitKur.toLocaleString('tr-TR', { minimumFractionDigits: 4 })} ₺</div></div>`;
            if (tedarikciMobilGuncelKur) {
                html += `<div class="detay-kutu"><div class="lbl">Güncel kur karşılığı</div><div class="val text-info">${alimMaliyetMetni(ozet, tedarikciMobilGuncelKur).split('\n').slice(-2).join('<br>')}</div></div>`;
            }
            html += `<div class="detay-kutu detay-kutu--vurgu"><div class="lbl">Toplam borç</div><div class="val">$${ozet.toplamBorcPb.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} → ${formatPara(h.Borc)}</div></div>`;
        } else {
            html += `<div class="detay-kutu detay-kutu--vurgu"><div class="lbl">Toplam borç</div><div class="val">${formatPara(ozet.toplamBorcPb)}</div></div>`;
        }
        $('alimDetayIcerik').innerHTML = html;
        modalAc('modal-alim-detay');
    }

    async function donusumTopluAc() {
        const liste = $('donusumTopluListe');
        if (!liste) return;
        liste.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        modalAc('modal-donusum-toplu');
        try {
            const rows = await stoklariYukleCache();
            const donusumluler = rows.filter((u) => {
                const b = u.birim_turu || u.Birim || '';
                return b === 'Adet' || /çuval/i.test(b);
            });
            if (!donusumluler.length) {
                liste.innerHTML = '<div class="empty-msg">Adet/çuval ürün yok</div>';
                return;
            }
            liste.innerHTML = donusumluler.map((u) => {
                const birim = u.birim_turu || u.Birim || 'Adet';
                let kg = u.adet_basina_kg || u.AdetBasinaKg || '';
                if (!kg && /çuval/i.test(birim)) {
                    const m = String(birim).match(/(\d+(?:[.,]\d+)?)\s*KG/i);
                    if (m) kg = parseFloat(String(m[1]).replace(',', '.'));
                }
                const alim = u.alim_birimi || u.AlimBirimi || 'Ton';
                const ad = ekstreRaporKacis(u.cins || u.temel_ad || u.UrunAdi || '');
                return `<div class="donusum-satir" data-id="${u.id || u.ID}">
                    <div class="donusum-ad">${ad} <span class="badge-mini">${birim}</span></div>
                    <label class="field-label small">1 adet KG</label>
                    <input type="number" step="0.1" min="0" class="field-input toplu-kg-inp" value="${kg}" placeholder="25">
                    <label class="field-label small">Alım birimi</label>
                    <select class="field-input toplu-alim-inp">
                        <option value="Ton" ${alim === 'Ton' ? 'selected' : ''}>Ton</option>
                        <option value="Adet" ${alim === 'Adet' ? 'selected' : ''}>Adet</option>
                    </select>
                </div>`;
            }).join('');
        } catch (err) {
            liste.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function donusumHizliKg(tumune) {
        const kg = parseFloat($('topluKgHizli')?.value);
        if (!kg || kg <= 0) { toast('KG değeri girin'); return; }
        document.querySelectorAll('#donusumTopluListe .toplu-kg-inp').forEach((inp) => {
            if (tumune || !inp.value) inp.value = kg;
        });
    }

    async function donusumTopluKaydet() {
        const satirlar = document.querySelectorAll('#donusumTopluListe .donusum-satir');
        const kayitlar = [];
        satirlar.forEach((tr) => {
            const id = tr.getAttribute('data-id');
            const kg = parseFloat(tr.querySelector('.toplu-kg-inp')?.value);
            const alimBirimi = tr.querySelector('.toplu-alim-inp')?.value || 'Ton';
            kayitlar.push({ id, adetBasinaKg: kg > 0 ? kg : null, alimBirimi });
        });
        if (!kayitlar.length) { toast('Kayıt yok'); return; }
        try {
            const res = await apiFetch('/api/komur-donusum-toplu', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kayitlar })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Kayıt başarısız');
            toast(`${kayitlar.length} ürün kaydedildi`);
            modalKapat('modal-donusum-toplu');
            await stoklariYukleCache();
            stokYukle();
        } catch (err) {
            toast(err.message || 'Hata');
        }
    }

    async function tedarikciOdemeKaydet() {
        if (!aktifTedarikci) return;
        const tutar = parseFloat($('tedarikciOdemeTutar').value);
        const tur = $('tedarikciOdemeTur').value;
        const paraBirimi = $('tedarikciOdemeParaBirimi')?.value || 'TRY';
        const islemKuru = paraBirimi === 'USD' ? (parseFloat($('tedarikciOdemeKur')?.value) || 0) : 1;
        if (!tutar || tutar <= 0) {
            toast('Geçerli tutar girin');
            return;
        }
        if (paraBirimi === 'USD' && islemKuru <= 0) {
            toast('USD ödeme için kur girin');
            return;
        }
        const btn = $('btnTedarikciOdemeKaydet');
        btn.disabled = true;
        try {
            const res = await apiFetch('/api/tedarikci-odeme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tedarikciId: aktifTedarikci.ID,
                    tarih: bugunIso(),
                    tutar, tur, aciklama: '',
                    paraBirimi, islemKuru
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Ödeme başarısız');
            toast('Ödeme kaydedildi');
            modalKapat('modal-tedarikci-odeme');
            await tedarikciYukle();
            const guncel = tedarikciCache.find((x) => x.ID === aktifTedarikci.ID);
            if (guncel) await tedarikciDetayAc(guncel.ID);
        } catch (err) {
            toast(err.message || 'Hata');
        } finally {
            btn.disabled = false;
        }
    }

    // =========================================================
    // 🏢 APARTMAN (MOBİL)
    // =========================================================
    let apartmanCache = [];
    let aktifApartman = null;
    let aktifApartmanDaireler = [];
    let aptGeriMusteriId = null;

    function aptSayi(n) {
        return (parseFloat(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    }

    async function apartmanlariYukle() {
        anaMenuKapat();
        aptGeriMusteriId = null;
        overlayAc('overlay-apartman');
        const el = $('apartmanListe');
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch('/api/apartmanlar?_t=' + Date.now());
            const rows = await res.json();
            if (!Array.isArray(rows)) throw new Error(rows.hata || 'Liste alınamadı');
            apartmanCache = rows;
            apartmanGoster(rows);
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function apartmanGoster(liste) {
        const el = $('apartmanListe');
        if (!liste.length) {
            el.innerHTML = '<div class="empty-msg">Apartman yok. Sağ üstten ekleyin.</div>';
            return;
        }
        el.innerHTML = liste.map((a) => {
            const daire = a.DaireSayisi || 0;
            const tamam = a.TamamDaire || 0;
            const kismi = a.KismiDaire || 0;
            const bekleyen = Math.max(0, daire - tamam - kismi);
            const konum = [a.Mahalle, a.Ilce].filter(Boolean).join(' / ');
            return `<div class="tedarikci-item" data-apt-id="${a.Id}" role="button" tabindex="0">
                <div class="tedarikci-item-ust">
                    <div>
                        <div class="tedarikci-item-ad">${ekstreRaporKacis(a.Ad)}</div>
                        <div class="tedarikci-item-meta">${ekstreRaporKacis(konum || '—')}</div>
                        <div class="tedarikci-item-meta">✓ ${tamam} · ◐ ${kismi} · ○ ${bekleyen} · ${daire} daire</div>
                    </div>
                    <div class="tedarikci-bakiye">${aptSayi(a.ToplamTeslim)}/${aptSayi(a.ToplamAnlasilan)}</div>
                </div>
            </div>`;
        }).join('');
    }

    function apartmanFiltrele(q) {
        const s = String(q || '').trim().toLocaleLowerCase('tr-TR');
        if (!s) return apartmanGoster(apartmanCache);
        apartmanGoster(apartmanCache.filter((a) => {
            const blob = [a.Ad, a.Mahalle, a.Ilce, a.SorumluAd].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
            return blob.includes(s);
        }));
    }

    function apartmanEkleAc() {
        ['aptEkleAd', 'aptEkleAdres', 'aptEkleSorumlu', 'aptEkleSorumluTel'].forEach((id) => { if ($(id)) $(id).value = ''; });
        mobilKonyaAdresYukle('aptEkle', 'Sarayönü', '');
        modalAc('modal-apartman-ekle');
    }

    async function apartmanKaydet() {
        const ad = $('aptEkleAd').value.trim();
        if (!ad) { toast('Apartman adı gerekli'); return; }
        const km = mobilKonyaAdresOku('aptEkle');
        try {
            const res = await apiFetch('/api/apartman', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad,
                    il: 'KONYA',
                    ilce: km.ilce || '',
                    mahalle: km.mahalle || '',
                    adres: $('aptEkleAdres').value.trim(),
                    sorumluAd: $('aptEkleSorumlu').value.trim(),
                    sorumluTel: $('aptEkleSorumluTel').value.trim()
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Kayıt başarısız');
            modalKapat('modal-apartman-ekle');
            await apartmanlariYukle();
            if (data.id) apartmanDetayAc(data.id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    async function apartmanDetayAc(id) {
        if (!stokCache.length) await stoklariYukleCache();
        if (!musteriCache.length) {
            try { const r = await apiFetch('/api/musteriler'); musteriCache = await r.json(); } catch (_) {}
        }
        try {
            await apiFetch(`/api/apartman/${id}/borc-esitle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const res = await apiFetch(`/api/apartman/${id}?_t=` + Date.now());
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Detay alınamadı');
            aktifApartman = data.apartman;
            aktifApartmanDaireler = data.daireler || [];
            $('aptDetayAd').textContent = data.apartman.Ad || 'Apartman';
            $('aptDetayMeta').textContent = [data.apartman.Mahalle, data.apartman.Ilce].filter(Boolean).join(' / ') || '—';
            apartmanDetayCiz();
            overlayAc('overlay-apartman-detay');
        } catch (err) { toast(err.message || 'Hata'); }
    }

    function apartmanDetayCiz() {
        const daireler = aktifApartmanDaireler;
        const toplamAnlasilan = daireler.reduce((t, d) => t + (parseFloat(d.AnlasilanMiktar) || 0), 0);
        const toplamTeslim = daireler.reduce((t, d) => t + (parseFloat(d.TeslimEdilen) || 0), 0);
        const tamam = daireler.filter((d) => d.AnlasilanMiktar > 0 && d.TeslimEdilen >= d.AnlasilanMiktar).length;
        $('aptDetayOzet').innerHTML = `
            <div class="cari-ozet-kutu"><div class="lbl">Daire</div><div class="val">${daireler.length}</div></div>
            <div class="cari-ozet-kutu"><div class="lbl">Tamam</div><div class="val odeme">${tamam}</div></div>
            <div class="cari-ozet-kutu wide"><div class="lbl">Teslim / Anlaşılan</div><div class="val">${aptSayi(toplamTeslim)} / ${aptSayi(toplamAnlasilan)}</div></div>
        `;
        const el = $('aptDaireListe');
        if (!daireler.length) {
            el.innerHTML = '<div class="empty-msg">Daire yok. Sağ üstten oluşturun.</div>';
            return;
        }
        el.innerHTML = daireler.map((d) => {
            const anlasilan = parseFloat(d.AnlasilanMiktar) || 0;
            const teslim = parseFloat(d.TeslimEdilen) || 0;
            const kalan = anlasilan - teslim;
            let durum, cls;
            if (anlasilan > 0 && teslim >= anlasilan) { durum = 'Tamam'; cls = 'tedarikci-tur--odeme'; }
            else if (teslim > 0) { durum = 'Kısmi'; cls = 'tedarikci-tur--alim'; }
            else if (anlasilan > 0) { durum = 'Bekliyor'; cls = 'tedarikci-tur--alim'; }
            else { durum = 'Anlaşma yok'; cls = ''; }
            const teslimBtn = (d.MusteriKimlik && d.UrunID && anlasilan > 0)
                ? `<button type="button" class="ekstre-info-btn" data-teslim="${d.Id}" title="Teslim et"><i class="fas fa-truck-ramp-box"></i></button>`
                : '';
            const baslik = `${d.Blok ? d.Blok + ' ' : ''}Daire ${d.DaireNo || ''}${d.DaireTipi ? ' (' + d.DaireTipi + ')' : ''}`;
            return `<div class="ekstre-item" data-daire="${d.Id}" role="button">
                <div class="ust">
                    <span>${ekstreRaporKacis(baslik)}</span>
                    <span class="ust-sag"><span class="tedarikci-tur ${cls}">${durum}</span>${teslimBtn}</span>
                </div>
                <div class="aciklama">${d.MusteriAd ? ekstreRaporKacis(d.MusteriAd) : '<span class="text-danger">— müşteri yok —</span>'}</div>
                <div class="alt">
                    <span class="alt-detay">${d.UrunAdi ? ekstreRaporKacis(d.UrunAdi) : '-'}${anlasilan ? ' · ' + aptSayi(anlasilan) + ' kg' : ''}${d.TonFiyat ? ' · ' + aptSayi(d.TonFiyat) + ' ' + (d.ParaBirimi || 'TRY') + '/ton' : ''}</span>
                    <span>${anlasilan ? 'Kalan: ' + aptSayi(kalan) + ' kg' : ''}</span>
                </div>
            </div>`;
        }).join('');
    }

    function aptUrunSecenekleri(secili) {
        const opts = stokCache.map((u) => {
            const sel = String(u.id) === String(secili) ? 'selected' : '';
            return `<option value="${u.id}" data-birim="${ekstreRaporKacis(u.birim_turu || '')}" data-fiyat="${u.ton_fiyati || ''}" ${sel}>${ekstreRaporKacis(u.cins || u.temel_ad)}</option>`;
        }).join('');
        return '<option value="">— Ürün —</option>' + opts;
    }

    function daireOlusturAc() {
        if (!aktifApartman) return;
        $('daireBlok').value = '';
        $('daireBaslangic').value = 1;
        $('daireBitis').value = 10;
        modalAc('modal-daire-olustur');
    }

    async function daireOlusturKaydet() {
        const blok = $('daireBlok').value.trim();
        const baslangic = parseInt($('daireBaslangic').value, 10);
        const bitis = parseInt($('daireBitis').value, 10);
        if (!Number.isFinite(baslangic) || !Number.isFinite(bitis) || bitis < baslangic) {
            toast('Geçerli aralık girin'); return;
        }
        try {
            const res = await apiFetch(`/api/apartman/${aktifApartman.Id}/daireler`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blok, baslangic, bitis })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Oluşturulamadı');
            modalKapat('modal-daire-olustur');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    function daireDuzenleAc(daireId) {
        const d = aktifApartmanDaireler.find((x) => x.Id === daireId);
        if (!d) return;
        $('btnDaireKaydet').dataset.id = d.Id;
        $('btnDaireSil').dataset.id = d.Id;
        $('dDuzBlok').value = d.Blok || '';
        $('dDuzNo').value = d.DaireNo || '';
        $('dDuzMusteriId').value = d.MusteriKimlik || '';
        const dMusInp = $('dDuzMusteriArama');
        dMusInp.value = d.MusteriAd || '';
        dMusInp.classList.remove('apt-input-ok');
        $('dDuzMusteriOneriler').style.display = 'none';
        $('dDuzUrun').innerHTML = aptUrunSecenekleri(d.UrunID);
        $('dDuzAnlasilan').value = d.AnlasilanMiktar || 0;
        $('dDuzBirim').value = d.Birim || '';
        $('dDuzFiyat').value = d.BirimFiyat != null ? d.BirimFiyat : '';
        modalAc('modal-daire-duzenle');
    }

    function daireMusteriAramaCiz() {
        const q = $('dDuzMusteriArama').value.trim();
        const box = $('dDuzMusteriOneriler');
        const ql = q.toLocaleLowerCase('tr-TR');
        let matches;
        if (ql) {
            matches = musteriCache.filter((m) => {
                const ad = (m.Unvan || m.Adı || '').toLocaleLowerCase('tr-TR');
                return ad.includes(ql) || String(m.CEPTEL || '').includes(ql);
            }).slice(0, 25);
        } else {
            matches = musteriCache.slice(0, 25);
        }
        let html = matches.map((m) => {
            const ad = m.Unvan || m.Adı || ('#' + m.Kimlik);
            const tel = m.CEPTEL && m.CEPTEL !== '-' ? ' · ' + m.CEPTEL : '';
            return `<button type="button" class="apt-oneri-item" data-mid="${m.Kimlik}" data-ad="${ekstreRaporKacis(ad)}">${ekstreRaporKacis(ad)}<span class="apt-oneri-tel">${ekstreRaporKacis(tel)}</span></button>`;
        }).join('');
        if (ql) {
            const tam = musteriCache.some((m) => (m.Unvan || m.Adı || '').toLocaleLowerCase('tr-TR') === ql);
            if (!tam) {
                html += `<button type="button" class="apt-oneri-item apt-oneri-yeni" data-yeni="1"><i class="fas fa-plus-circle"></i> Yeni müşteri ekle: "${ekstreRaporKacis(q)}"</button>`;
            }
        }
        box.innerHTML = html || '<div class="apt-oneri-bos">Sonuç yok</div>';
        box.style.display = 'block';
    }

    async function daireYeniMusteriEkle(ad) {
        const temizAd = String(ad || '').trim();
        if (!temizAd) return;
        const apt = aktifApartman || {};
        const blok = $('dDuzBlok').value.trim();
        const no = $('dDuzNo').value.trim();
        const adres = [apt.Ad, blok ? blok + ' Blok' : '', no ? 'Daire ' + no : ''].filter(Boolean).join(' ');
        try {
            const res = await apiFetch('/api/musteri', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ad_soyad: temizAd, unvan: temizAd, telefon: '', adres, ilce: apt.Ilce || '', mahalle: apt.Mahalle || '' })
            });
            const data = await res.json().catch(() => ({}));
            const mRes = await apiFetch('/api/musteriler');
            musteriCache = await mRes.json();
            let yeniId = data.yeniId;
            if (!res.ok || data.success === false || !yeniId) {
                const bul = musteriCache.find((m) => (m.Unvan || m.Adı || '').toLocaleLowerCase('tr-TR') === temizAd.toLocaleLowerCase('tr-TR'));
                if (bul) yeniId = bul.Kimlik;
                else if (!res.ok) throw new Error(data.hata || 'Müşteri eklenemedi');
            }
            $('dDuzMusteriId').value = yeniId || '';
            const inp = $('dDuzMusteriArama');
            inp.value = temizAd;
            inp.classList.add('apt-input-ok');
            $('dDuzMusteriOneriler').style.display = 'none';
            toast(`✓ "${temizAd}" yeni müşteri eklendi ve seçildi`);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    async function daireKaydet() {
        const id = $('btnDaireKaydet').dataset.id;
        if (!id) return;
        let musteriKimlik = $('dDuzMusteriId').value || null;
        const aramaMetni = $('dDuzMusteriArama').value.trim();
        if (!musteriKimlik && aramaMetni) {
            const bul = musteriCache.find((m) => (m.Unvan || m.Adı || '').toLocaleLowerCase('tr-TR') === aramaMetni.toLocaleLowerCase('tr-TR'));
            if (bul) musteriKimlik = bul.Kimlik;
        }
        if (!aramaMetni) musteriKimlik = null;
        try {
            const res = await apiFetch(`/api/apartman-daire/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blok: $('dDuzBlok').value.trim(),
                    daireNo: $('dDuzNo').value.trim(),
                    musteriKimlik,
                    urunId: $('dDuzUrun').value || null,
                    anlasilanMiktar: parseFloat($('dDuzAnlasilan').value) || 0,
                    birim: 'Kg',
                    tonFiyat: parseFloat($('dDuzFiyat').value) || null,
                    birimFiyat: ($('dDuzFiyat').value ? parseFloat($('dDuzFiyat').value) / 1000 : null),
                    paraBirimi: 'TRY'
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Kayıt başarısız');
            modalKapat('modal-daire-duzenle');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    async function daireSil() {
        const id = $('btnDaireSil').dataset.id;
        if (!id) return;
        if (!confirm('Bu daireyi silmek istediğinize emin misiniz?')) return;
        try {
            const res = await apiFetch(`/api/apartman-daire/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Silinemedi');
            modalKapat('modal-daire-duzenle');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    function daireTeslimatAc(daireId) {
        const d = aktifApartmanDaireler.find((x) => x.Id === daireId);
        if (!d) return;
        const anlasilan = parseFloat(d.AnlasilanMiktar) || 0;
        const teslim = parseFloat(d.TeslimEdilen) || 0;
        const kalan = anlasilan - teslim;
        $('btnDaireTeslimatKaydet').dataset.id = d.Id;
        $('teslimatDaireBilgi').innerHTML = `<strong>${ekstreRaporKacis((d.Blok ? d.Blok + ' ' : '') + 'Daire ' + (d.DaireNo || ''))}</strong> · ${ekstreRaporKacis(d.MusteriAd || '')}<br>${ekstreRaporKacis(d.UrunAdi || '-')} · ${formatPara(d.BirimFiyat)}/${d.Birim || ''}`;
        $('teslimatMiktar').value = kalan > 0 ? kalan : '';
        $('teslimatKalanNot').textContent = `Anlaşılan ${aptSayi(anlasilan)}, teslim ${aptSayi(teslim)}, kalan ${aptSayi(kalan)} ${d.Birim || ''}`;
        $('teslimatGecmisi').innerHTML = '';
        modalAc('modal-daire-teslimat');
        daireTeslimatGecmisiYukle(d.Id);
    }

    async function daireTeslimatGecmisiYukle(daireId) {
        try {
            const res = await apiFetch(`/api/apartman-daire/${daireId}/teslimatlar?_t=` + Date.now());
            const rows = await res.json();
            const kutu = $('teslimatGecmisi');
            if (!Array.isArray(rows) || !rows.length) { kutu.innerHTML = ''; return; }
            kutu.innerHTML = '<div class="form-hint mb-1">Teslimat geçmişi</div>' + rows.map((t) => {
                const tar = (t.Tarih || '').split(' ')[0];
                return `<div class="alt"><span class="alt-detay">${ekstreRaporKacis(tar)} · ${aptSayi(t.Miktar)}</span><button type="button" class="ekstre-sil-btn" data-teslim-sil="${t.Id}"><i class="fas fa-trash-alt"></i></button></div>`;
            }).join('');
        } catch (_) {}
    }

    async function daireTeslimatKaydet() {
        const id = $('btnDaireTeslimatKaydet').dataset.id;
        const miktar = parseFloat($('teslimatMiktar').value);
        if (!miktar || miktar <= 0) { toast('Geçerli miktar girin'); return; }
        try {
            let res = await apiFetch(`/api/apartman-daire/${id}/teslimat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ miktar, tarih: bugunIso() })
            });
            let data = await res.json();
            if (res.status === 400 && data.kod === 'ASIM') {
                if (!confirm(`${data.hata}\n\nYine de teslim edilsin mi?`)) return;
                res = await apiFetch(`/api/apartman-daire/${id}/teslimat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ miktar, tarih: bugunIso(), izinliAsim: true })
                });
                data = await res.json();
            }
            if (!res.ok) throw new Error(data.hata || 'Teslim başarısız');
            toast('Teslim kaydedildi · stok düşüldü');
            modalKapat('modal-daire-teslimat');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    async function daireTeslimatGeriAl(teslimatId) {
        if (!confirm('Bu teslimatı geri almak istediğinize emin misiniz?')) return;
        try {
            const res = await apiFetch(`/api/apartman-teslimat/${teslimatId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Geri alınamadı');
            modalKapat('modal-daire-teslimat');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    function aptBlokListesiMob(daireler) {
        const set = new Set();
        (daireler || []).forEach((d) => set.add((d.Blok && String(d.Blok).trim()) || '(Bloksuz)'));
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
    }

    function topluAnlasmaTahminMob() {
        const blok = $('taAktifBlok')?.value;
        const ton = parseFloat($('taToplamTon')?.value) || 0;
        const daireler = (aktifApartmanDaireler || []).filter((d) => {
            const b = (d.Blok && String(d.Blok).trim()) || '(Bloksuz)';
            return b === blok;
        });
        const oz = $('taBlokOzet');
        if (oz) oz.textContent = daireler.length && ton ? `${blok}: ${daireler.length} daire · daire başı ${aptSayi((ton * 1000) / daireler.length)} kg` : '';
    }

    function topluAnlasmaAc() {
        if (!aktifApartman) return;
        $('taUrun').innerHTML = aptUrunSecenekleri('');
        $('taToplamTon').value = '';
        $('taTonFiyat').value = '';
        $('taPara').value = 'TRY';
        $('taDaireTipi').value = '';
        $('taSadeceBos').checked = true;
        const bloklar = aptBlokListesiMob(aktifApartmanDaireler);
        const ilk = bloklar[0] || 'A';
        $('taAktifBlok').value = ilk;
        const sek = $('taBlokSekmeler');
        if (sek) {
            sek.innerHTML = bloklar.map((b) => `<button type="button" class="btn btn-sm ${b === ilk ? 'btn-primary' : 'btn-outline-secondary'}" data-blok="${ekstreRaporKacis(b)}">${ekstreRaporKacis(b)}</button>`).join('');
        }
        topluAnlasmaTahminMob();
        modalAc('modal-toplu-anlasma');
    }

    async function topluAnlasmaKaydet() {
        const urunId = $('taUrun').value || null;
        const toplamTon = parseFloat($('taToplamTon').value) || 0;
        const tonFiyat = parseFloat($('taTonFiyat').value) || 0;
        const blok = $('taAktifBlok').value;
        if (!urunId || toplamTon <= 0 || tonFiyat <= 0) { toast('Ürün, ton ve fiyat girin'); return; }
        if (!confirm(`${blok} bloğuna ${toplamTon} ton uygulanacak. Devam?`)) return;
        try {
            const res = await apiFetch(`/api/apartman/${aktifApartman.Id}/blok-anlasma`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blok: blok === '(Bloksuz)' ? '' : blok,
                    urunId, toplamTon, tonFiyat,
                    paraBirimi: $('taPara').value || 'TRY',
                    daireTipi: $('taDaireTipi').value || null,
                    sadeceBos: $('taSadeceBos').checked
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.hata || 'Uygulanamadı');
            toast(`${data.kgPerDaire} kg/daire · ${data.toplamBorc} ₺ borç`);
            modalKapat('modal-toplu-anlasma');
            apartmanDetayAc(aktifApartman.Id);
        } catch (err) { toast(err.message || 'Hata'); }
    }

    async function musteriYukle() {
        const el = $('musteriListe');
        el.innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        try {
            const res = await apiFetch('/api/musteriler');
            const rows = await res.json();
            if (!Array.isArray(rows)) throw new Error('Liste alınamadı');
            musteriCache = rows;
            musteriGoster(rows);
        } catch (err) {
            el.innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
    }

    function musteriFiltrele(q) {
        const s = String(q || '').trim().toLocaleLowerCase('tr-TR');
        if (!s) {
            musteriGoster(musteriCache);
            return;
        }
        musteriGoster(musteriCache.filter((m) => {
            const blob = [m.Adı, m.Unvan, m.CEPTEL, m.Ilce, m.Mahalle].join(' ').toLocaleLowerCase('tr-TR');
            return blob.includes(s);
        }));
    }

    function baglaOlaylar() {
        $('btnSunucuKaydet').addEventListener('click', async () => {
            try {
                sunucuKaydet($('sunucuUrl').value);
                if (!(await sunucuCanliMi())) {
                    toast('Sunucuya ulaşılamadı');
                    return;
                }
                toast('Sunucu kaydedildi');
                $('loginServerPill').textContent = sunucuUrl();
                viewGoster('login');
            } catch (e) {
                toast(e.message);
            }
        });

        $('btnSunucuBuCihaz').addEventListener('click', async () => {
            sunucuKaydet(window.location.origin);
            if (await sunucuCanliMi()) {
                $('loginServerPill').textContent = sunucuUrl();
                viewGoster('login');
            } else {
                toast('Bu adreste sunucu yok');
            }
        });

        $('btnGiris').addEventListener('click', girisYap);
        $('sifre').addEventListener('keydown', (e) => { if (e.key === 'Enter') girisYap(); });

        $('btnSunucuDegistir').addEventListener('click', () => {
            oturumTemizle();
            $('sunucuUrl').value = localStorage.getItem(STORAGE_SERVER) || '';
            viewGoster('setup');
        });

        $('btnCikis').addEventListener('click', () => {
            oturumTemizle();
            viewGoster('login');
            $('loginServerPill').textContent = sunucuUrl();
        });

        document.querySelectorAll('.nav-item').forEach((btn) => {
            btn.addEventListener('click', () => panelGoster(btn.dataset.panel));
        });

        $('musteriAra').addEventListener('input', (e) => musteriFiltrele(e.target.value));

        $('musteriListe').addEventListener('click', (e) => {
            const item = e.target.closest('.musteri-item');
            if (!item || !item.dataset.id) return;
            overlayGeriHedef = null;
            musteriDetayAc(Number(item.dataset.id));
        });

        $('btnMusteriKapat').addEventListener('click', musteriOverlayKapat);
        $('btnMusteriEkle')?.addEventListener('click', musteriEkleAc);
        $('btnMusteriEkleKaydet')?.addEventListener('click', musteriEkleKaydet);
        $('btnMusteriDuzenle')?.addEventListener('click', musteriDuzenleAc);
        $('btnMusteriDuzenleKaydet')?.addEventListener('click', musteriDuzenleKaydet);
        $('btnRaporKapat')?.addEventListener('click', overlayKapat);
        $('btnAnaMenu')?.addEventListener('click', (e) => {
            e.stopPropagation();
            anaMenuToggle();
        });
        $('btnVadesiGelen')?.addEventListener('click', vadesiGelenleriAc);
        $('btnBorcluMusteri')?.addEventListener('click', borcluMusterileriAc);
        $('btnTedarikci')?.addEventListener('click', () => {
            anaMenuKapat();
            panelGoster('tedarikci');
        });
        $('btnApartman')?.addEventListener('click', apartmanlariYukle);
        $('btnApartmanKapat')?.addEventListener('click', overlayKapat);
        $('btnApartmanDetayKapat')?.addEventListener('click', () => {
            if (aptGeriMusteriId) {
                const mid = aptGeriMusteriId;
                aptGeriMusteriId = null;
                musteriDetayAc(mid);
            } else {
                apartmanlariYukle();
            }
        });
        $('apartmanAra')?.addEventListener('input', (e) => apartmanFiltrele(e.target.value));
        $('apartmanListe')?.addEventListener('click', (e) => {
            const item = e.target.closest('[data-apt-id]');
            if (item?.dataset.aptId) apartmanDetayAc(Number(item.dataset.aptId));
        });
        $('btnApartmanEkleAc')?.addEventListener('click', apartmanEkleAc);
        $('btnApartmanKaydet')?.addEventListener('click', apartmanKaydet);
        $('btnDaireOlusturAc')?.addEventListener('click', daireOlusturAc);
        $('btnDaireOlusturKaydet')?.addEventListener('click', daireOlusturKaydet);
        $('btnDaireKaydet')?.addEventListener('click', daireKaydet);
        $('btnDaireSil')?.addEventListener('click', daireSil);
        $('btnDaireTeslimatKaydet')?.addEventListener('click', daireTeslimatKaydet);
        $('btnTopluAnlasmaAc')?.addEventListener('click', topluAnlasmaAc);
        $('btnTopluAnlasmaKaydet')?.addEventListener('click', topluAnlasmaKaydet);
        $('taBlokSekmeler')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-blok]');
            if (!btn) return;
            $('taAktifBlok').value = btn.getAttribute('data-blok');
            $('taBlokSekmeler').querySelectorAll('[data-blok]').forEach((b) => {
                b.classList.toggle('btn-primary', b === btn);
                b.classList.toggle('btn-outline-secondary', b !== btn);
            });
            topluAnlasmaTahminMob();
        });
        ['taToplamTon', 'taTonFiyat'].forEach((id) => {
            $(id)?.addEventListener('input', topluAnlasmaTahminMob);
        });
        $('aptDaireListe')?.addEventListener('click', (e) => {
            const teslimBtn = e.target.closest('[data-teslim]');
            if (teslimBtn?.dataset.teslim) {
                e.preventDefault(); e.stopPropagation();
                daireTeslimatAc(Number(teslimBtn.dataset.teslim));
                return;
            }
            const item = e.target.closest('[data-daire]');
            if (item?.dataset.daire) daireDuzenleAc(Number(item.dataset.daire));
        });
        $('teslimatGecmisi')?.addEventListener('click', (e) => {
            const sil = e.target.closest('[data-teslim-sil]');
            if (sil?.dataset.teslimSil) daireTeslimatGeriAl(Number(sil.dataset.teslimSil));
        });
        $('dDuzUrun')?.addEventListener('change', (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if (opt && opt.value && !$('dDuzFiyat').value) $('dDuzFiyat').value = opt.getAttribute('data-fiyat') || '';
        });
        $('taUrun')?.addEventListener('change', (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if (opt && opt.value && !$('taTonFiyat').value) $('taTonFiyat').value = opt.getAttribute('data-fiyat') || '';
        });
        $('dDuzMusteriArama')?.addEventListener('input', () => {
            $('dDuzMusteriId').value = '';
            daireMusteriAramaCiz();
        });
        $('dDuzMusteriArama')?.addEventListener('focus', daireMusteriAramaCiz);
        $('dDuzMusteriOneriler')?.addEventListener('click', (e) => {
            const secim = e.target.closest('[data-mid]');
            if (secim) {
                $('dDuzMusteriId').value = secim.getAttribute('data-mid');
                $('dDuzMusteriArama').value = secim.getAttribute('data-ad');
                $('dDuzMusteriOneriler').style.display = 'none';
                return;
            }
            const yeni = e.target.closest('[data-yeni]');
            if (yeni) daireYeniMusteriEkle($('dDuzMusteriArama').value);
        });
        $('musteriApartmanListe')?.addEventListener('click', (e) => {
            const item = e.target.closest('[data-apt-git]');
            if (item?.dataset.aptGit) {
                aptGeriMusteriId = aktifMusteri ? musteriKimlik(aktifMusteri) : null;
                apartmanDetayAc(Number(item.dataset.aptGit));
            }
        });
        $('tedarikciAra')?.addEventListener('input', (e) => tedarikciFiltrele(e.target.value));
        $('tedarikciListe')?.addEventListener('click', (e) => {
            const item = e.target.closest('.tedarikci-item');
            if (!item?.dataset.id) return;
            tedarikciDetayAc(Number(item.dataset.id));
        });
        $('btnTedarikciKapat')?.addEventListener('click', overlayKapat);
        $('btnTedarikciMalAlim')?.addEventListener('click', malAlimAc);
        $('btnTedarikciOdeme')?.addEventListener('click', tedarikciOdemeAc);
        $('btnStokDonusum')?.addEventListener('click', donusumTopluAc);
        $('btnDonusumTopluKaydet')?.addEventListener('click', donusumTopluKaydet);
        $('btnTopluKgBos')?.addEventListener('click', () => donusumHizliKg(false));
        $('tedarikciOdemeParaBirimi')?.addEventListener('change', tedarikciOdemeParaDegisti);
        $('tedarikciOdemeTutar')?.addEventListener('input', tedarikciOdemeTutarHesapla);
        $('tedarikciOdemeKur')?.addEventListener('input', tedarikciOdemeTutarHesapla);
        $('tedarikciHareketListe')?.addEventListener('click', (e) => {
            const infoBtn = e.target.closest('[data-alim-detay]');
            if (infoBtn?.dataset.alimDetay) {
                e.preventDefault();
                e.stopPropagation();
                tedarikciAlimDetayAc(Number(infoBtn.dataset.alimDetay));
                return;
            }
            const silBtn = e.target.closest('[data-tedarikci-sil]');
            if (silBtn?.dataset.tedarikciSil) {
                e.preventDefault();
                e.stopPropagation();
                tedarikciHareketSil(Number(silBtn.dataset.tedarikciSil), silBtn.dataset.tedarikciTur || 'ALIM');
            }
        });
        $('btnMalAlimKaydet')?.addEventListener('click', malAlimKaydet);
        $('btnTedarikciOdemeKaydet')?.addEventListener('click', tedarikciOdemeKaydet);
        $('malAlimOdeme')?.addEventListener('change', malAlimOdemeDegisti);
        $('malAlimParaBirimi')?.addEventListener('change', malAlimParaBirimiDegisti);
        $('malAlimUrun')?.addEventListener('change', malAlimUrunDegisti);
        $('malAlimGirisBirimi')?.addEventListener('change', () => { malAlimEtiketGuncelle(); malAlimOzetGuncelle(); });
        ['malAlimMiktar', 'malAlimBirimMaliyet', 'malAlimKur'].forEach((id) => {
            $(id)?.addEventListener('input', malAlimOzetGuncelle);
        });
        $('raporArama')?.addEventListener('input', raporListeCiz);
        $('raporListe')?.addEventListener('click', (e) => {
            const item = e.target.closest('.rapor-item');
            if (item?.dataset.mid) raporMusteriDetayAc(item.dataset.mid);
        });
        document.addEventListener('click', (e) => {
            const wrap = document.querySelector('.ana-menu-wrap');
            if (wrap && !wrap.contains(e.target)) anaMenuKapat();
        });
        $('btnBugunKapat').addEventListener('click', overlayKapat);
        $('btnGunlukOzetGetir')?.addEventListener('click', () => gunlukOzetYukle());
        $('bugunBaslangic')?.addEventListener('change', () => {
            if (!mobilAdminMi() && $('bugunBitis')) $('bugunBitis').value = $('bugunBaslangic').value;
            gunlukOzetYukle();
        });
        $('bugunBitis')?.addEventListener('change', () => gunlukOzetYukle());
        $('btnTopGeri')?.addEventListener('click', fabGeriTikla);
        $('btnFabGeri')?.addEventListener('click', fabGeriTikla);
        $('btnLoginGeri')?.addEventListener('click', () => viewGoster('setup'));
        $('btnCariEkstrePdf')?.addEventListener('click', () => {
            musteriMenuKapat();
            cariEkstrePdfIndir();
        });
        $('btnEkstreOnizlemeKapat')?.addEventListener('click', ekstreOnizlemeKapat);
        $('btnEkstreOnizlemePaylas')?.addEventListener('click', ekstreMobilPaylas);
        $('btnEkstreOnizlemeYazdir')?.addEventListener('click', ekstreMobilYazdirBaslat);
        $('btnModalSatis').addEventListener('click', modalSatisAc);
        $('btnModalOdeme').addEventListener('click', modalOdemeAc);
        $('btnMusteriMenu')?.addEventListener('click', (e) => {
            e.stopPropagation();
            musteriMenuToggle();
        });
        $('btnModalTaksit')?.addEventListener('click', () => {
            musteriMenuKapat();
            modalTaksitPlaniAc();
        });
        $('btnModalBorcYapilandir')?.addEventListener('click', () => {
            musteriMenuKapat();
            borcuTaksitlendirAc();
        });
        $('btnModalNotlar')?.addEventListener('click', () => {
            musteriNotlarModalAc();
        });
        $('btnMusteriNotKaydet')?.addEventListener('click', musteriNotKaydet);
        $('btnMusteriNotUyariTamam')?.addEventListener('click', () => {
            musteriNotUyariIdx += 1;
            if (musteriNotUyariIdx >= musteriNotUyariKuyruk.length) {
                modalKapat('modal-not-uyari');
            } else {
                musteriNotUyariIcerikGoster();
            }
        });
        $('musteriNotlarListe')?.addEventListener('click', (e) => {
            const sil = e.target.closest('[data-not-sil]');
            if (sil) {
                musteriNotSil(Number(sil.getAttribute('data-not-sil')));
            }
        });
        $('musteriNotlarListe')?.addEventListener('change', (e) => {
            const inp = e.target.closest('[data-not-uyari]');
            if (inp) {
                musteriNotUyariDegistir(Number(inp.getAttribute('data-not-uyari')), inp.checked, inp);
            }
        });
        document.addEventListener('click', (e) => {
            const wrap = document.querySelector('.musteri-menu-wrap');
            if (wrap && !wrap.contains(e.target)) musteriMenuKapat();
        });
        $('btnTaksitYapilandir')?.addEventListener('click', borcuTaksitlendirAc);
        $('btnTaksitPlaniTemizle')?.addEventListener('click', taksitPlaniTumunuSil);
        $('btnBorcYapilandirKaydet')?.addEventListener('click', borcYapilandirKaydet);
        $('btnYapiModOtomatik')?.addEventListener('click', () => yapiPlanModuAyarla('otomatik'));
        $('btnYapiModManuel')?.addEventListener('click', () => yapiPlanModuAyarla('manuel'));
        $('btnYapiManuelSatir')?.addEventListener('click', yapiManuelSatirlariOlustur);
        $('btnSatisKaydet').addEventListener('click', satisKaydet);
        $('btnOdemeKaydet').addEventListener('click', odemeKaydet);

        $('taksitListe')?.addEventListener('click', (e) => {
            const odeBtn = e.target.closest('.taksit-ode-btn');
            if (odeBtn) {
                const tid = Number(odeBtn.dataset.tid);
                const t = aktifTaksitlerCache.find((x) => Number(x.Kimlik) === tid);
                if (!t) return;
                const orj = parseFloat(t.MIKTAR) || 0;
                const ode = parseFloat(t.ODEMELER) || 0;
                taksitOdemeModalAc(tid, orj - ode, (t.AÇIKLAMA || '').trim());
                return;
            }
            const silBtn = e.target.closest('.taksit-sil-btn');
            if (silBtn) taksitPlaniSil(Number(silBtn.dataset.tid));
        });

        document.querySelectorAll('[data-taksit-tur]').forEach((btn) => {
            btn.addEventListener('click', () => taksitOdemeTurKaydet(btn.getAttribute('data-taksit-tur')));
        });
        $('satisUrun').addEventListener('change', satisTutarHesapla);
        $('satisMiktar').addEventListener('input', satisTutarHesapla);
        $('satisTutar').addEventListener('input', satisOdemeSenkron);
        $('satisOdemeAl').addEventListener('change', satisOdemeSenkron);

        document.querySelectorAll('[data-modal-kapat]').forEach((el) => {
            el.addEventListener('click', () => modalKapat(el.getAttribute('data-modal-kapat')));
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        baglaOlaylar();
        baslangic();
    });
})();
