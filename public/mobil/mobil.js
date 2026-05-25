(function () {
    const STORAGE_SERVER = 'komurMobilSunucu';
    const STORAGE_SESSION = 'komurMobilOturum';

    let musteriCache = [];
    let stokCache = [];
    let aktifMusteri = null;
    let aktifMusteriEkstreRows = [];
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

    function bugunIso() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function tarihGoster(v) {
        if (!v) return '—';
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return String(v);
        return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function musteriAdi(m) {
        return m.Adı || m.Unvan || [m.Adı, m.Soyadı].filter(Boolean).join(' ') || 'Müşteri';
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

    function fabGeriDurumGuncelle() {
        const overlayAcik = !!document.querySelector('.overlay.overlay-active');
        const ekstreAcik = $('ekstreOnizleme')?.classList.contains('active');
        fabGeriGoster(overlayAcik || ekstreAcik || aktifPanel !== 'ana');
    }

    function fabGeriTikla() {
        if ($('ekstreOnizleme')?.classList.contains('active')) {
            ekstreOnizlemeKapat();
            return;
        }
        if (document.querySelector('.overlay.overlay-active')) {
            overlayKapat();
            return;
        }
        if (aktifPanel !== 'ana') {
            panelGoster('ana');
        }
    }

    function overlayAc(id) {
        document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('overlay-active'));
        const el = $(id);
        if (el) el.classList.add('overlay-active');
        fabGeriDurumGuncelle();
    }

    function overlayKapat() {
        document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('overlay-active'));
        modallariKapat();
        fabGeriDurumGuncelle();
    }

    function modalAc(id) {
        const el = $(id);
        if (el) el.classList.add('modal-active');
    }

    function modalKapat(id) {
        const el = $(id);
        if (el) el.classList.remove('modal-active');
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
        const d = hamTarih ? new Date(hamTarih) : null;
        const tarihGunu = d && !Number.isNaN(d.getTime())
            ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const saatKismi = d && !Number.isNaN(d.getTime())
            ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
            : '—';
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
            sortKey: d && !Number.isNaN(d.getTime()) ? d.getTime() : 0,
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
        fabGeriDurumGuncelle();
    }

    function ekstreOnizlemeAc(html) {
        const icerik = $('ekstreOnizlemeIcerik');
        const ov = $('ekstreOnizleme');
        if (!icerik || !ov) throw new Error('Ekstre önizleme alanı yok');
        icerik.innerHTML = html;
        ov.classList.add('active');
        ov.setAttribute('aria-hidden', 'false');
        icerik.scrollTop = 0;
        fabGeriGoster(false);
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
            const paylas = { files: [file], title: 'Cari ekstre', text: 'Karaarslan Kömür — cari ekstre' };

            if (navigator.share && (!navigator.canShare || navigator.canShare(paylas))) {
                await navigator.share(paylas);
                toast('WhatsApp veya başka uygulamayı seçin');
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = sonEkstreDosyaAd;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 8000);
            toast('PDF indirildi — WhatsApp’ta 📎 ile dosyayı ekleyin');
        } catch (err) {
            console.warn('Ekstre paylaş:', err);
            toast(err.message || 'Paylaşım başarısız');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = btnHtml || '<i class="fab fa-whatsapp"></i> Paylaş';
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
            toast('Önizleme — Paylaş (WhatsApp) veya Yazdır');
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

    function panelGoster(panel) {
        aktifPanel = panel || 'ana';
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('panel-active'));
        const el = $(`panel-${aktifPanel}`);
        if (el) el.classList.add('panel-active');
        document.querySelectorAll('.nav-item').forEach((n) => {
            n.classList.toggle('nav-active', n.dataset.panel === aktifPanel);
        });
        if (aktifPanel === 'stok') stokYukle();
        if (aktifPanel === 'sevk') sevkYukle();
        if (aktifPanel === 'musteri') musteriYukle();
        fabGeriDurumGuncelle();
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
        const tr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
        const pad = (n) => String(n).padStart(2, '0');
        return `${tr.getFullYear()}-${pad(tr.getMonth() + 1)}-${pad(tr.getDate())} ${pad(tr.getHours())}:${pad(tr.getMinutes())}:${pad(tr.getSeconds())}`;
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
        modalAc('modal-odeme');
    }

    /** Masaüstü ile aynı: makbuzlu ödeme, açıklama "Nakit Tahsilat" vb. */
    async function makbuzluOdemeKaydet(tutar, odemeTuru, aciklama, notlar, islemBakiyesi) {
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
                islemBakiyesi: islemBakiyesi != null ? islemBakiyesi : 0
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
                <div class="ozet-rozet tiklanabilir" id="cardBugun" role="button" tabindex="0" title="Bugünkü hareketler">
                    <div class="rozet-baslik">Bugünkü satış</div>
                    <div class="rozet-deger">${formatSayi(d.bugunKomur)}</div>
                    <div class="rozet-detay">kömür</div>
                    <div class="rozet-deger rozet-deger-alt">${formatSayi(d.bugunUn)}</div>
                    <div class="rozet-detay">un</div>
                </div>
                <div class="ozet-rozet tiklanabilir" id="cardMusteri" role="button" tabindex="0" title="Müşteri listesi">
                    <div class="rozet-baslik">Müşteri</div>
                    <div class="rozet-deger">${formatSayi(d.toplamMusteri)}</div>
                    <div class="rozet-detay">kayıtlı cari · dokun</div>
                </div>
                <div class="ozet-rozet tiklanabilir" id="cardSevk" role="button" tabindex="0" title="Bekleyen sevkiyat">
                    <div class="rozet-baslik">Bekleyen sevk</div>
                    <div class="rozet-deger">${formatSayi(d.bekleyenSevk)}</div>
                    <div class="rozet-detay">teslimat · dokun</div>
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

    async function bugunGoster() {
        overlayAc('overlay-bugun');
        const gun = bugunIso();
        $('bugunTarihLbl').textContent = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        $('bugunListe').innerHTML = '<div class="empty-msg">Yükleniyor…</div>';
        $('bugunOzet').innerHTML = '';

        try {
            const [ozetRes, hareketRes] = await Promise.all([
                apiFetch('/api/mobil-ozet', { cache: 'no-store' }),
                apiFetch(`/api/gunluk-hareketler?baslangic=${gun}&bitis=${gun}`)
            ]);
            const ozet = await apiJson(ozetRes, 'Özet alınamadı.');
            const hareketler = await apiJson(hareketRes, 'Hareket listesi alınamadı.');

            if (ozetRes.ok) {
                $('bugunOzet').innerHTML = `
                    <div class="oz"><div class="n">${formatSayi(ozet.bugunKomur)}</div><div class="l">Kömür satış</div></div>
                    <div class="oz"><div class="n">${formatSayi(ozet.bugunUn)}</div><div class="l">Un satış</div></div>
                `;
            }

            if (!hareketRes.ok || !Array.isArray(hareketler)) {
                $('bugunListe').innerHTML = '<div class="empty-msg">Hareket listesi alınamadı</div>';
                return;
            }
            if (!hareketler.length) {
                $('bugunListe').innerHTML = '<div class="empty-msg">Bugün kayıt yok</div>';
                return;
            }

            let toplamBorc = 0;
            let toplamOdeme = 0;
            hareketler.forEach((h) => {
                toplamBorc += Number(h.BORÇ) || 0;
                toplamOdeme += Number(h.ÖDEME) || 0;
            });
            $('bugunOzet').innerHTML += `
                <div class="oz"><div class="n">${formatPara(toplamBorc)}</div><div class="l">Toplam borç</div></div>
                <div class="oz"><div class="n">${formatPara(toplamOdeme)}</div><div class="l">Toplam tahsilat</div></div>
            `;

            $('bugunListe').innerHTML = hareketler.map((h) => {
                const ad = [h.Adı, h.Soyadı].filter(Boolean).join(' ') || h.Unvan || '—';
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
                        <div class="bugun-musteri">${ekstreRaporKacis(ad)}</div>
                        ${yapan ? `<div class="bugun-yapan">${yapan}</div>` : ''}
                    </div>
                    <div class="bugun-sag">
                        <div class="bugun-tarih">${ekstreRaporKacis(tarihGoster(h.TARİH))}</div>
                        <div class="bugun-aciklama">${ekstreRaporKacis(aciklama)}</div>
                        ${miktarHtml}
                        <div class="bugun-tutar">${tutarHtml}</div>
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            $('bugunListe').innerHTML = `<div class="empty-msg">${err.message}</div>`;
        }
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
                const ad = [r.Adı, r.Soyadı].filter(Boolean).join(' ') || r.Unvan || 'Müşteri';
                const kalan = r.KalanTeslimat ?? r.ADET ?? 0;
                const adr = [r.Ilce, r.Mahalle, r.Adres].filter(Boolean).join(' · ');
                return `<div class="sevk-item">
                    <div class="ad">${ad}</div>
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
            const ad = musteriAdi(m);
            const b = bakiyeMetni(m.Bakiye);
            return `<div class="musteri-item" data-id="${id}" role="button" tabindex="0">
                <div class="ad">${ad}</div>
                <div class="tel">${m.CEPTEL || '—'}</div>
                <div class="bakiye ${b.cls}">${b.txt}</div>
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
        $('musteriDetayAd').textContent = musteriAdi(m);
        $('musteriDetayTel').textContent = m.CEPTEL || '—';
        musteriOzetGuncelle(m);
        overlayAc('overlay-musteri');
        await musteriEkstreYukle(id);
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
                    islemiYapan: oturum?.adSoyad || 'Mobil'
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.hata || 'Satış kaydedilemedi');

            if (odemeAl && odemeTutar > 0) {
                const yeniBakiye = (oncekiBakiye + tutar) - odemeTutar;
                await makbuzluOdemeKaydet(
                    odemeTutar,
                    odemeTuru,
                    tahsilatAciklama(odemeTuru, notlar, true),
                    notlar,
                    yeniBakiye
                );
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
            await makbuzluOdemeKaydet(
                tutar,
                odemeTuru,
                tahsilatAciklama(odemeTuru, not, false),
                not,
                oncekiBakiye - tutar
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
            musteriDetayAc(Number(item.dataset.id));
        });

        $('btnMusteriKapat').addEventListener('click', overlayKapat);
        $('btnBugunKapat').addEventListener('click', overlayKapat);
        $('btnFabGeri').addEventListener('click', fabGeriTikla);
        $('btnCariEkstrePdf').addEventListener('click', cariEkstrePdfIndir);
        $('btnEkstreOnizlemeKapat')?.addEventListener('click', ekstreOnizlemeKapat);
        $('btnEkstreOnizlemePaylas')?.addEventListener('click', ekstreMobilPaylas);
        $('btnEkstreOnizlemeYazdir')?.addEventListener('click', ekstreMobilYazdirBaslat);
        $('btnModalSatis').addEventListener('click', modalSatisAc);
        $('btnModalOdeme').addEventListener('click', modalOdemeAc);
        $('btnSatisKaydet').addEventListener('click', satisKaydet);
        $('btnOdemeKaydet').addEventListener('click', odemeKaydet);
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
