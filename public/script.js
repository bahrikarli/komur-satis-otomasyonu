// =========================================================
// 🛡️ GÜVENLİK KONTROLÜ (KAPIDAKİ KORUMA)
// =========================================================
// Sayfa başında yetki kontrolü yapan yerleri bul ve güncelle

if (localStorage.getItem('kullaniciYetki')) {
    localStorage.clear(); // Eskiden ne varsa çöpe at
}

const aktifKullanici = sessionStorage.getItem('aktifKullanici');
const kullaniciYetki = sessionStorage.getItem('kullaniciYetki');

// Eğer giriş yapılmamışsa login sayfasına at
if (!aktifKullanici && !window.location.pathname.includes('login.html')) {
    window.location.href = '/login.html';
}

window.sistemdenCikisYap = function() {
    if(confirm("Sistemden çıkış yapmak istediğinize emin misiniz?")) {
        sessionStorage.clear(); // Hafızayı boşalt
        window.location.href = '/login.html';
    }
};

// =========================================================
// 🚀 SAYFA İLK AÇILDIĞINDA ÇALIŞAN ANA MOTOR
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('KARAARSLAN KÖMÜR Arayüzü Hazır. Sistem Başlatılıyor...');

    // 1. VERİLERİ ÇEK: Hem eski kalıcı (Local), hem yeni geçici (Session) hafızaya bak
    // 1. VERİLERİ ÇEK: İsimlerin tam eşleştiğinden emin oluyoruz
// Eğer 'kullaniciYetki' boş gelirse 'yetki' ismine de bak diyoruz.
let aktifKullanici = sessionStorage.getItem('aktifKullanici') || sessionStorage.getItem('adSoyad');
let yetki = sessionStorage.getItem('kullaniciYetki') || sessionStorage.getItem('yetki');

// 🚨 Eğer hala Personel çıkıyorsa, terminalden gelen o 'admin' yazısını 
// büyük harfe duyarsız şekilde yakalayalım
if (yetki && yetki.toLowerCase() === 'admin') {
    yetki = 'Admin';
}

    // 🚨 KRİTİK DÜZELTME: Eğer hafızadaki yetki hatalıysa bile sunucudaki gerçek bilgiyi bekleyeceğiz.
    // Navbar öğelerini yakala
    const adKutusu = document.getElementById('navbarKullaniciAd');
    const yetkiKutusu = document.getElementById('navbarKullaniciYetki');

    // İlk aşamada mevcut olanı yaz (Yükleniyor yazısı hemen gitsin)
    if (aktifKullanici && adKutusu) {
        adKutusu.innerText = aktifKullanici;
        yetkiKutusu.innerText = (yetki === 'Admin') ? '👑 Yönetici' : '👤 Personel';
        const hosgeldinEl = document.getElementById('hosgeldinBaslik');
        if (hosgeldinEl) hosgeldinEl.innerText = 'Hoşgeldiniz, ' + aktifKullanici;
        
        if (!sessionStorage.getItem('aktifKullanici')) {
            sessionStorage.setItem('aktifKullanici', aktifKullanici);
            sessionStorage.setItem('kullaniciYetki', yetki);
            localStorage.clear(); 
        }
    } else {
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = 'login.html';
            return;
        }
    }

    // 3. TABLOLARI YÜKLE
    if (typeof stoklariYukle === 'function') stoklariYukle();
    if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();

    // 4. AYARLARI VE MODÜL GİZLEMEYİ ÇALIŞTIR
    try {
        const res = await fetch('/api/ayarlar');
        const ayarlar = await res.json();
        
        const otoMakbuz = ayarlar.find(a => a.Anahtar === 'MakbuzOtomatikYazdir');
        localStorage.setItem('ayarOtoMakbuz', otoMakbuz ? otoMakbuz.Deger : "true");

        // 🚨 YETKİ SENKRONİZASYONU: 
        // fetch('/api/ayarlar') başarılı olduysa sunucuyla iletişim var demektir.
        // Terminaldeki "Admin" bilgisinin ekrana yansıması için yetkiyi tekrar teyit ediyoruz.
        if (yetki === 'Admin') {
            const ayarBtn = document.getElementById('btnTanimlamalar');
            const ayarCizgi = document.getElementById('ayiriciAyarlar');
            if(ayarBtn) ayarBtn.classList.remove('d-none');
            if(ayarCizgi) ayarCizgi.classList.remove('d-none');
        }

        // --- SADECE PERSONEL İÇİN GİZLİLİK PELERİNİ ---
        if (yetki !== 'Admin') {
            const gGider = ayarlar.find(a => a.Anahtar === 'ModulGider');
            const gToptanci = ayarlar.find(a => a.Anahtar === 'ModulToptanci');
            const gSevkiyat = ayarlar.find(a => a.Anahtar === 'ModulSevkiyat');

            let giderKapali = (gGider && gGider.Deger === 'false');
            let toptanciKapali = (gToptanci && gToptanci.Deger === 'false');

            const modulGizle = (btnId) => {
                const btn = document.getElementById(btnId);
                if (btn) {
                    const li = btn.closest('li');
                    if (li) {
                        li.classList.add('d-none');
                        const nextLi = li.nextElementSibling;
                        if (nextLi && nextLi.innerHTML.includes('<hr')) nextLi.classList.add('d-none');
                    }
                }
            };

            if (giderKapali) modulGizle('menuModulGider');
            if (toptanciKapali) {
                modulGizle('menuModulToptanci');
                modulGizle('menuModulAlimGecmisi');
            }

            if (giderKapali && toptanciKapali) {
                const dropdownUl = document.querySelector('[aria-labelledby="giderAlimDropdown"]');
                if (dropdownUl) {
                    dropdownUl.innerHTML = `<li><div class="px-3 py-3 text-center text-muted"><i class="fas fa-lock text-warning fs-4 d-block mb-2"></i><h6 class="fw-bold mb-1 text-dark">Erişim Kapalı</h6></div></li>`;
                }
            }

            if (gSevkiyat && gSevkiyat.Deger === 'false') {
                const btnSev = document.getElementById('btnModulSevkiyat');
                if (btnSev) btnSev.classList.add('d-none');
            }
        }

    } catch(e) {
        console.error("Ayarlar yüklenirken hata:", e);
    }
});
// script.js dosyasının en başına veya uygun bir yere eklenecek temizleyici
function urunAdiniTemizle(tamAd) {
    if (!tamAd) return "";
    // Parantezden önceki boşluğa kadar olan kısmı al (örn: "ÜRÜN (Birim)" -> "ÜRÜN")
    const temizAd = tamAd.split(' (')[0].trim();
    return temizAd;
}

// --- STOK İŞLEMLERİ (Şimdilik eski yapıda, MSSQL'e göre güncellenecek) ---
// --- STOK İŞLEMLERİ ---
/** Eşikler artık veritabanından gelir (esik_alt / esik_ust). */

/** @returns {'Yetersiz'|'Orta'|'Yeterli'} */
function stokSeviyeMiktardan(miktar, alt, ust) {
    const m = Number(miktar);
    const a = Number(alt);
    const u = Number(ust);
    if (!Number.isFinite(m) || !Number.isFinite(a) || !Number.isFinite(u) || u <= a) return 'Orta';
    if (m <= a) return 'Yetersiz';
    if (m >= u) return 'Yeterli';
    return 'Orta';
}

/** Stok tablosu «Mevcut Stok» hücresi: çuvalda birim_turu «25 KG Çuval» gibi gelince «13 25 KG» gibi saçma görünüm oluşmasın — sadece adet + Çuval */
function stokTablosuMiktarHucreMetni(komur) {
    const miktar = parseFloat(komur.mevcut_stok_ton ?? komur.MevcutStok);
    const mStr = Number.isFinite(miktar) ? miktar.toLocaleString('tr-TR') : '0';
    let birimRaw = String(komur.birim_turu || '').trim();
    const cins = komur.cins || '';
    if (!birimRaw) {
        if (/çuval/i.test(cins)) birimRaw = 'Çuval';
        else if (/adet/i.test(cins)) birimRaw = 'Adet';
        else birimRaw = 'Ton';
    }
    const low = birimRaw.toLowerCase();
    if (low.includes('çuval')) return `${mStr} Çuval`;
    if (low.includes('adet')) return `${mStr} Adet`;
    if (low.includes('ton')) return `${mStr} Ton`;
    return `${mStr} ${birimRaw}`;
}

function stokSeviyeBadgeHtml(sev, esik) {
    const v = ['Yeterli', 'Orta', 'Yetersiz'].includes(sev) ? sev : 'Orta';
    let tit = '';
    if (esik && Number.isFinite(esik.alt) && Number.isFinite(esik.ust) && esik.ust > esik.alt) {
        tit = `Eşik: ≤${esik.alt} Yetersiz | arası Orta | ≥${esik.ust} Yeterli`;
    }
    const titEsc = tit.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const tAttr = titEsc ? ` title="${titEsc}"` : '';
    if (v === 'Yeterli') return `<span class="badge bg-success badge-stok"${tAttr}>Yeterli</span>`;
    if (v === 'Yetersiz') return `<span class="badge bg-danger badge-stok"${tAttr}>Yetersiz</span>`;
    return `<span class="badge bg-warning text-dark badge-stok"${tAttr}>Orta</span>`;
}

window.stoklariYukle = async function() {
    const tabloGövdesi = document.getElementById('stokTabloGövdesi');
    const toplamStokGosterge = document.getElementById('toplamStokGosterge');
    const btnYeniStok = document.getElementById('btnYeniStokEkle'); 
    
    if (!tabloGövdesi) return; 

    // =======================================================
    // 🚨 YETKİ KONTROLÜ (BÜYÜK/KÜÇÜK HARF ZIRHLI)
    // =======================================================
    // Hem sessionStorage hem de yedekli isimleri kontrol ediyoruz
    const hamYetki = sessionStorage.getItem('kullaniciYetki') || sessionStorage.getItem('yetki') || "";
    const isAdmin = hamYetki.toLowerCase() === 'admin';

    // Üstteki "Yeni Ürün" butonunu sadece Admin görsün
    if (btnYeniStok) {
        btnYeniStok.style.display = isAdmin ? 'inline-block' : 'none';
    }

    tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4"><div class="spinner-border text-warning spinner-border-sm me-2"></div>Güncel stoklar yükleniyor...</td></tr>`;

    try {
        const response = await fetch('/api/komur?_t=' + new Date().getTime());
        const komurler = await response.json();

        tabloGövdesi.innerHTML = ''; 
        let totalTon = 0;

        if (komurler.length === 0) {
            tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Henüz ürün eklenmemiş.</td></tr>`;
            if (toplamStokGosterge) toplamStokGosterge.innerHTML = `0`;
            return;
        }

        komurler.forEach((komur, index) => {
            totalTon += parseFloat(komur.mevcut_stok_ton);
            
            let miktar = parseFloat(komur.mevcut_stok_ton);
            const miktarHucre = stokTablosuMiktarHucreMetni(komur);

            const esik = {
                alt: Number(komur.esik_alt),
                ust: Number(komur.esik_ust)
            };
            let tehlikeBadge;
            if (!Number.isFinite(esik.alt) || !Number.isFinite(esik.ust) || esik.ust <= esik.alt) {
                tehlikeBadge = '<span class="badge bg-secondary badge-stok" title="Bu ürün için eşik girilmemiş — düzenleyerek iki rakam ekleyin">Eşik yok</span>';
            } else {
                const sev = stokSeviyeMiktardan(miktar, esik.alt, esik.ust);
                tehlikeBadge = stokSeviyeBadgeHtml(sev, esik);
            }

            // =======================================================
            // 🚨 TABLO İÇİ AKSİYON BUTONLARI YETKİ KONTROLÜ
            // =======================================================
            let islemButonlari = '';
            if (isAdmin) {
                // Admin ise tam yetki ver (Kalem ve Çöp Kutusu)
                islemButonlari = `
                    <button class="btn btn-sm btn-outline-secondary me-1 shadow-sm" onclick="stokDuzenle(${komur.id})" title="Düzenle"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger shadow-sm" onclick="stokSil(${komur.id})" title="Sil"><i class="fas fa-trash"></i></button>
                `;
            } else {
                // Personel ise sadece kilit simgesi göster
                islemButonlari = `<span class="badge bg-light text-muted border px-2 py-1 shadow-sm"><i class="fas fa-lock"></i></span>`;
            }

            const satir = `
                <tr>
                    <td class="text-muted small fw-bold">${index + 1}</td>
                    <td class="fw-bold text-dark-custom">${komur.cins}</td>
                    <td>${parseFloat(komur.ton_fiyati).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                    <td class="fw-bold">${miktarHucre}</td>
                    <td>${tehlikeBadge}</td>
                    <td class="text-center">
                        ${islemButonlari}
                    </td>
                </tr>
            `;
            tabloGövdesi.innerHTML += satir;
        });
        
        if (toplamStokGosterge) toplamStokGosterge.innerHTML = `${totalTon.toLocaleString('tr-TR')} <small>Birim</small>`;
    } catch (error) {
        console.error('Stok yükleme hatası:', error);
        tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Veriler çekilirken hata oluştu.</td></tr>`;
    }
};
// --- ÖZET BİLGİLERİ (ANA SAYFA ÜST KUTULAR) YÜKLEME ---
async function ozetBilgileriYukle() {
    try {
        const response = await fetch('/api/ozet'); 
        const data = await response.json();
        
        // Eğer sunucudan 500 hatası gelirse (şu an yaşadığımız gibi)
        if (!response.ok) {
            console.error("Özet Verisi Çekilemedi:", data.hata);
            document.getElementById('kayitliMusteriGosterge').innerHTML = `Hata <small>Kişi</small>`;
            document.getElementById('bugunkuKomurGosterge').innerHTML = `Hata <small class="fs-6 fw-normal text-muted">Birim Kömür</small>`;
            document.getElementById('bugunkuUnGosterge').innerHTML = `Hata <small class="fs-6 fw-normal text-muted">Birim Un</small>`;
            return; // Kodun aşağı inmesini ve "undefined" yazmasını durdur
        }

        // Veriler sorunsuz geldiyse (sıfır bile olsa) ekrana bas
        document.getElementById('kayitliMusteriGosterge').innerHTML = `${data.toplamMusteri || 0} <small>Kişi</small>`;
        document.getElementById('bugunkuKomurGosterge').innerHTML = `${data.bugunKomur || 0} <small class="fs-6 fw-normal text-muted">Birim Kömür</small>`;
        document.getElementById('bugunkuUnGosterge').innerHTML = `${data.bugunUn || 0} <small class="fs-6 fw-normal text-muted">Birim Un</small>`;
        
    } catch (error) {
        console.error('Özet bilgileri yükleme hatası:', error);
    }
}

// --- CARİ VE MÜŞTERİ YÖNETİMİ (MSSQL'e GÖRE GÜNCELLENDİ) ---

document.addEventListener('DOMContentLoaded', () => {
    const musterilerModalEl = document.getElementById('musterilerModal');
    if (musterilerModalEl) musterilerModalEl.addEventListener('show.bs.modal', cariListesiniYukle);
    ['yeniMusteri', 'duzenle', 'hizliAdres'].forEach((p) => {
        if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan(p);
    });
});

// 1. Tüm Müşterileri Listeleme (MSSQL Kimlik ve MusteriHareket Tablosundan)
// async function cariListesiniYukle() {
//     const tabloGövdesi = document.getElementById('cariTabloGövdesi');
//     tabloGövdesi.innerHTML = '<tr><td colspan="6" class="text-center py-4">Veriler yükleniyor...</td></tr>';
    
//     try {
//         const response = await fetch('/api/musteriler');
//         const musteriler = await response.json();
//         tabloGövdesi.innerHTML = '';

//        // ... fonksiyonun başı aynı kalacak ...
// musteriler.forEach(musteri => {
//     // 1. TEMİZLİK: Soyadını hiç karıştırmıyoruz. Sadece Adı alıyoruz.
//     // Eğer Adı veritabanında 'null' olarak kayıtlıysa onu da siliyoruz.
//     let temizAd = musteri.Adı;

//     // Eğer gelen veri null objesi ya da "null" yazısı ise boşluk yap
//     if (!temizAd || temizAd === 'null') {
//         temizAd = 'İSİMSİZ MÜŞTERİ';
//     }

//     // Telefon kontrolü
//     let tel = (musteri.CEPTEL && musteri.CEPTEL !== 'null' && musteri.CEPTEL !== '-') ? musteri.CEPTEL : 'Telefon Yok';

//     // Rakamlar
//     const toplamBorc = parseFloat(musteri.ToplamBorc) || 0;
//     const toplamOdenen = parseFloat(musteri.ToplamOdeme) || 0;
//     const kalanBakiye = parseFloat(musteri.Bakiye) || 0;

//     let bakiyeMetni = kalanBakiye > 0 
//         ? `<span class="text-danger fw-bold">${kalanBakiye.toLocaleString('tr-TR')} ₺</span>` 
//         : `<span class="text-success fw-bold">Borcu Yok</span>`;

//     tabloGövdesi.innerHTML += `
//         <tr>
//             <td class="fw-bold text-dark-custom">${temizAd}</td>
//             <td>${tel}</td>
//             <td class="text-danger fw-bold text-end">${toplamBorc.toLocaleString('tr-TR')} ₺</td>
//             <td class="text-success fw-bold text-end">${toplamOdenen.toLocaleString('tr-TR')} ₺</td>
//             <td class="text-center">${bakiyeMetni}</td>
//             <td class="text-center">
//                 <button class="btn btn-sm btn-outline-primary shadow-sm" onclick="musteriDetayGoster(${musteri.Kimlik}, '${temizAd}', '${tel}')">
//                     <i class="fas fa-folder-open me-1"></i> Detay
//                 </button>
//             </td>
//         </tr>
//     `;
// });
//     } catch (error) {
//         console.error("Cari liste hatası:", error);
//         tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Veri çekme hatası!</td></tr>`;
//     }
// }
// --- Müşteri cari notları (modal + açılış uyarıları + SQL) ---

/** Sunucudan gelen UyariAcik bit — eksik eski satırda varsayılan açık */
function musteriNotUyariAcikMi(n) {
    if (!n || typeof n.UyariAcik === 'undefined' || n.UyariAcik === null) return true;
    const v = n.UyariAcik;
    if (v === false || v === 0 || v === '0') return false;
    if (v === true || v === 1 || v === '1') return true;
    return true;
}

function musteriOturumKimligi() {
    const adSoyad = sessionStorage.getItem('aktifKullanici') || sessionStorage.getItem('adSoyad') || localStorage.getItem('aktifKullanici') || '';
    const kadi = sessionStorage.getItem('aktifKullaniciAdi') || localStorage.getItem('aktifKullaniciAdi') || '';
    return { adSoyad: adSoyad.trim(), kullaniciAdi: kadi.trim() };
}

function musteriNotHtmlEscape(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function musteriNotAltModalZIndex(modalEl) {
    if (!modalEl) return;
    setTimeout(() => {
        modalEl.style.setProperty('z-index', '1095', 'important');
        const backs = document.querySelectorAll('.modal-backdrop');
        if (backs.length > 0) backs[backs.length - 1].style.setProperty('z-index', '1090', 'important');
    }, 80);
}

async function musteriNotlarListesiniYenile(musteriId) {
    const listeEl = document.getElementById('musteriNotlarListe');
    if (!listeEl || !musteriId) return [];
    listeEl.innerHTML = '<div class="text-muted py-2"><i class="fas fa-spinner fa-spin me-2"></i>Yükleniyor...</div>';
    try {
        const res = await fetch(`/api/musteri-notlar/${musteriId}?_t=${Date.now()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.hata || 'Liste alınamadı');
        const rows = Array.isArray(data.notlar) ? data.notlar : [];
        window._musteriNotlarSonListe = rows;
        if (rows.length === 0) {
            listeEl.innerHTML = '<div class="text-muted fst-italic py-2">Henüz not yok.</div>';
            return rows;
        }
        const listeBaslik = `
            <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom px-1">
                <span class="small fw-bold text-secondary">Not</span>
                <div class="d-flex align-items-center gap-2 flex-shrink-0">
                    <span class="small fw-bold text-secondary text-center mb-0" style="width: 5.5rem; line-height: 1.2;">Uyarı versin mi?</span>
                    <span class="d-inline-block" style="width: 2.5rem;" aria-hidden="true"></span>
                </div>
            </div>`;
        listeEl.innerHTML =
            listeBaslik +
            rows
            .map((n) => {
                const nid = n.Id;
                const metin = musteriNotHtmlEscape(n.NotMetni || '').replace(/\n/g, '<br>');
                const ad = musteriNotHtmlEscape(n.OlusturanAdSoyad || '—');
                const ka = musteriNotHtmlEscape(n.OlusturanKullaniciAdi || '');
                const z = n.OlusturmaZamani;
                let zStr = '';
                try {
                    zStr = z ? new Date(z).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                } catch (_) {
                    zStr = String(z || '');
                }
                const kim = ka ? `${ad} <span class="text-muted">(@${ka})</span>` : ad;
                const uyAcik = musteriNotUyariAcikMi(n);
                return `
                <div class="border rounded p-2 mb-2 bg-white shadow-sm">
                    <div class="d-flex justify-content-between align-items-start gap-2">
                        <div class="flex-grow-1">
                            <div class="text-dark">${metin}</div>
                            <div class="mt-1 small text-muted"><i class="fas fa-user text-secondary me-1"></i>${kim}${zStr ? ` · ${zStr}` : ''}</div>
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-shrink-0">
                            <div class="form-check form-switch m-0 d-flex justify-content-center" style="width: 5.5rem;" title="Açıkken cari açılışında bu not için uyarı verilir">
                                <input class="form-check-input" type="checkbox" role="switch" ${uyAcik ? 'checked' : ''}
                                    onchange="musteriNotUyariDegistir(${nid}, this.checked, this)">
                            </div>
                            <button type="button" class="btn btn-sm btn-outline-danger" onclick="musteriNotSil(${nid})" title="Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>`;
            })
            .join('');
        return rows;
    } catch (e) {
        listeEl.innerHTML = `<div class="text-danger small">${musteriNotHtmlEscape(e.message)}</div>`;
        window._musteriNotlarSonListe = [];
        return [];
    }
}

window.musteriNotlarModalAc = async function () {
    if (typeof aktifMusteriId === 'undefined' || aktifMusteriId === null) return;
    await musteriNotlarListesiniYenile(aktifMusteriId);
    const el = document.getElementById('musteriNotlarModal');
    if (!el) return;
    musteriNotAltModalZIndex(el);
    bootstrap.Modal.getOrCreateInstance(el).show();
};

window.musteriNotSil = async function (notId) {
    if (!notId) return;
    if (!confirm('Bu notu silmek istediğinize emin misiniz?')) return;
    try {
        const res = await fetch(`/api/musteri-not/${notId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hata || 'Silinemedi');
        if (typeof aktifMusteriId !== 'undefined' && aktifMusteriId !== null) {
            await musteriNotlarListesiniYenile(aktifMusteriId);
        }
    } catch (e) {
        alert(e.message || String(e));
    }
};

window.musteriNotUyariDegistir = async function (notId, acik, inputEl) {
    if (!notId) return;
    try {
        const res = await fetch(`/api/musteri-not/${notId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uyariAcik: !!acik })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hata || 'Kaydedilemedi');
        if (typeof aktifMusteriId !== 'undefined' && aktifMusteriId !== null) {
            await musteriNotlarListesiniYenile(aktifMusteriId);
        }
    } catch (e) {
        if (inputEl) inputEl.checked = !acik;
        alert(e.message || String(e));
    }
};

function musteriNotUyariTekNotGoster(notlar, idx) {
    if (idx >= notlar.length) return;
    const n = notlar[idx];
    const govde = document.getElementById('musteriNotUyariGovde');
    const baslik = document.getElementById('musteriNotUyariBaslik');
    const el = document.getElementById('musteriNotUyariModal');
    if (!govde || !baslik || !el) return;
    baslik.innerHTML = `<i class="fas fa-envelope-open-text me-2"></i> Not <span class="badge bg-light text-primary ms-1">${idx + 1} / ${notlar.length}</span>`;
    const metin = musteriNotHtmlEscape(n.NotMetni || '').replace(/\n/g, '<br>');
    const ad = musteriNotHtmlEscape(n.OlusturanAdSoyad || '—');
    const ka = musteriNotHtmlEscape(n.OlusturanKullaniciAdi || '');
    const kim = ka ? `${ad} <span class="text-muted">(@${ka})</span>` : ad;
    let zStr = '';
    try {
        zStr = n.OlusturmaZamani
            ? new Date(n.OlusturmaZamani).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
            : '';
    } catch (_) {
        zStr = '';
    }
    govde.innerHTML = `<div class="p-3 rounded bg-light border">${metin}</div><div class="small text-muted mt-2 mb-0"><i class="fas fa-user me-1"></i>${kim}${zStr ? ` · ${zStr}` : ''}</div>`;

    const modal = bootstrap.Modal.getOrCreateInstance(el);
    const sonraki = () => {
        el.removeEventListener('hidden.bs.modal', sonraki);
        setTimeout(() => musteriNotUyariTekNotGoster(notlar, idx + 1), 200);
    };
    el.addEventListener('hidden.bs.modal', sonraki, { once: true });
    musteriNotAltModalZIndex(el);
    modal.show();
}

function musteriNotAcilisUyarilariniBaslat(notlar) {
    if (!notlar || !notlar.length) return;
    const uyariNotlar = notlar.filter(musteriNotUyariAcikMi);
    if (!uyariNotlar.length) return;
    setTimeout(() => {
        musteriNotUyariTekNotGoster(uyariNotlar, 0);
    }, 450);
}

async function musteriDetayNotlariSenkronize(musteriId) {
    const ta = document.getElementById('musteriNotYeniMetin');
    if (ta) ta.value = '';
    const rows = await musteriNotlarListesiniYenile(musteriId);
    musteriNotAcilisUyarilariniBaslat(rows);
}

window.musteriNotKaydet = async function () {
    const ta = document.getElementById('musteriNotYeniMetin');
    if (!ta || typeof aktifMusteriId === 'undefined' || aktifMusteriId === null) return;
    const metin = ta.value.trim();
    if (!metin) {
        alert('Not metnini yazın.');
        return;
    }
    const kim = musteriOturumKimligi();
    try {
        const res = await fetch(`/api/musteri-notlar/${aktifMusteriId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metin,
                kullaniciAdi: kim.kullaniciAdi || null,
                adSoyad: kim.adSoyad || null
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hata || 'Kaydedilemedi');
        ta.value = '';
        await musteriNotlarListesiniYenile(aktifMusteriId);
    } catch (e) {
        alert(e.message || String(e));
    }
};

// 2. Bir Müşterinin Detay Modalını Açma (MSSQL MusteriHareket Tablosundan)
window.musteriDetayGoster = async function(musteriId, adSoyad, ceptel) {
    // 1. EĞER ANA MÜŞTERİ REHBERİ AÇIKSA ONU KAPAT (Çakışmayı tam önler)
    const listeModalEl = document.getElementById('musterilerModal');
    if (listeModalEl) {
        const listeModal = bootstrap.Modal.getInstance(listeModalEl);
        if (listeModal) listeModal.hide();
    }

    // 2. Detay Penceresini Açıyoruz
    const detayModalEl = document.getElementById('musteriDetayModal');
    let detayModal = bootstrap.Modal.getInstance(detayModalEl);
    if (!detayModal) detayModal = new bootstrap.Modal(detayModalEl);
    detayModal.show();

    // --- 3. KRİTİK NOKTA: GRİ EKRAN KİLİT KIRICI ---
    setTimeout(() => {
        detayModalEl.style.setProperty('z-index', '1070', 'important');
        const backdrops = document.querySelectorAll('.modal-backdrop');
        if (backdrops.length > 0) {
            backdrops[backdrops.length - 1].style.setProperty('z-index', '1069', 'important');
        }
    }, 150);
    // ------------------------------------------------

    // 4. İsim ve Telefon temizliği
    let temizAd = String(adSoyad).replace(/null/g, '').trim();
    if (!temizAd) temizAd = "-";
    let temizTel = (ceptel && ceptel !== 'null' && ceptel !== 'undefined') ? ceptel : '-';

    // Global değişkenleri güncelle
    aktifMusteriId = musteriId;
    aktifMusteriAd = temizAd;

    // --- 5. AKILLI BAŞLIK SİSTEMİ (ÜNVAN DESTEKLİ) ---
    // --- 5. AKILLI BAŞLIK SİSTEMİ (ÜNVAN DESTEKLİ - YENİ NESİL) ---
const adSoyadElementi = document.getElementById('detayAdSoyad');

const baslikGuncelle = (unvan) => {
    if (!adSoyadElementi) return;
    
    let gosterilecekBaslik = '';
    const unvanTemiz = (unvan && unvan !== 'null' && unvan.trim() !== '');

    if (unvanTemiz) {
        // Ünvan varsa: Üstte yeşil ve büyük Ünvan, altta gri Adı
        gosterilecekBaslik = `
            <div class="d-flex flex-column">
                <span class="fw-bold fs-4 text-success text-uppercase" style="letter-spacing: -0.5px; line-height: 1.1;">
                    <i class="fas fa-building me-2"></i>${unvan.trim()}
                </span>
                <span class="text-muted fw-medium mt-1" style="font-size: 0.9rem;">
                    <i class="fas fa-user me-1"></i> ${temizAd}
                </span>
            </div>
        `;
    } else {
        // Ünvan yoksa: Sadece Adı normal haliyle görünsün
        gosterilecekBaslik = `
            <div class="d-flex flex-column">
                <span class="fw-bold fs-5 text-dark">${temizAd}</span>
            </div>
        `;
    }

    adSoyadElementi.innerHTML = `
        <div class="d-flex justify-content-between align-items-center w-100 py-2">
            ${gosterilecekBaslik}
            <button class="btn btn-sm btn-outline-primary border-0" 
                    onclick="musteriDuzenleAc('${temizAd.replace(/'/g, "\\'")}', '${temizTel}')" 
                    title="Bilgileri Düzenle">
                <i class="fas fa-edit me-1"></i> Düzenle
            </button>
        </div>
    `;
};

    // Hafızayı Sıfırla
    // Hafızayı Sıfırla
    aktifMusteriUnvan = "";
    aktifMusteriAdiResmi = "";
    aktifMusteriSoyadiResmi = "";
    window.aktifMusteriAdres = ""; 
    window.aktifMusteriIlce = "Sarayönü"; // 🚨 YENİ EKLENDİ
    window.aktifMusteriMahalle = "";      // 🚨 YENİ EKLENDİ

    // =========================================================
    // 🚨 1. ADIM: ÜNVANI VE ADRESİ ANA LİSTEDEN GARANTİLE
    // =========================================================
    try {
        const mRes = await fetch('/api/musteriler');
        if (mRes.ok) {
            const mList = await mRes.json();
            const gercekMusteri = mList.find(x => x.Kimlik == musteriId || x.KİMLİK == musteriId);
            
            if (gercekMusteri) {
                // Ünvanı ve ADRESİ hafızaya alıyoruz
                aktifMusteriUnvan = gercekMusteri.Unvan || gercekMusteri.UNVAN || gercekMusteri.unvan || "";
                window.aktifMusteriAdres = gercekMusteri.Adres || gercekMusteri.ADRES || gercekMusteri.adres || ""; 
                
                // 🚨 İLÇE VE MAHALLEYİ DE HAFIZAYA ALIYORUZ!
                window.aktifMusteriIlce = gercekMusteri.Ilce || gercekMusteri.ILCE || gercekMusteri.ilce || "Sarayönü";
                window.aktifMusteriMahalle = gercekMusteri.Mahalle || gercekMusteri.MAHALLE || gercekMusteri.mahalle || "";
                
                baslikGuncelle(aktifMusteriUnvan); 
                
                // 🚨 ADRESİ EKRANDAKİ (VİTRİNDEKİ) YERİNE YAZDIR
                const adresElementi = document.getElementById('detayAdres');
                if (adresElementi) {
                    // Vitrinde gösterirken şık dursun diye birleştiriyoruz
                    let vitrinAdresi = window.aktifMusteriAdres;
                    if(window.aktifMusteriMahalle || window.aktifMusteriIlce) {
                        vitrinAdresi += ` - ${window.aktifMusteriMahalle} / ${window.aktifMusteriIlce}`;
                    }
                    adresElementi.innerText = vitrinAdresi.startsWith(' -') ? vitrinAdresi.substring(3) : (vitrinAdresi ? vitrinAdresi : "Adres bilgisi yok...");
                }
            }
        }
    } catch (e) { 
        console.error("Müşteri ana bilgileri çekilemedi", e); 
    }
    // =========================================================

    const telElementi = document.getElementById('detayTelefon');
    if (telElementi) telElementi.innerText = temizTel;

    try {
        // Ekstre Bilgilerini Çek
        const resEkstre = await fetch(`/api/musteri-ekstre/${musteriId}?yenile=${new Date().getTime()}`);
        let islemler = await resEkstre.json();

        if (islemler && islemler.length > 0) {
            // JOIN sayesinde gelen resmi bilgileri hafızaya alıyoruz
            aktifMusteriUnvan = islemler[0].Unvan || "";
            aktifMusteriAdiResmi = islemler[0].Adı || "";
            aktifMusteriSoyadiResmi = islemler[0].Soyadı || "";
            
            // --- KRİTİK EKLENTİ: ÜNVAN GELDİĞİ AN BAŞLIĞA YAPIŞTIR ---
            baslikGuncelle(aktifMusteriUnvan);
        }
        
        // --- SIRALAMA EN YENİ İŞLEM EN ÜSTTE OLACAK ŞEKİLDE AYARLANDI ---
        islemler.sort((a, b) => new Date(b.TARİH || b.TARIH) - new Date(a.TARİH || a.TARIH));

        const tabloGovdesi = document.getElementById('detayTabloGovdesi');
        tabloGovdesi.innerHTML = '';

        let toplamBorc = 0, toplamOdenen = 0;

        islemler.forEach(islem => {
            const borc = parseFloat(islem.BORÇ) || 0; 
            const odeme = parseFloat(islem.ÖDEME) || 0; 
            
            toplamBorc += borc; 
            toplamOdenen += odeme; 

            const hamTarih = islem.TARIH || islem.TARİH;
            const tamTarihMetni = hamTarih ? tarihFormatla(hamTarih, false) : 'Tarih Yok';
            const parcalar = tamTarihMetni.split(' ');
            const tarihGunu = parcalar[0];
            const saatKismi = parcalar[1] || '00:00';

            const islemId = islem.Kimlik || islem.KİMLİK || islem.ID;

            let orjinalAciklama = islem.AÇIKLAMA || '-';
            let temizAciklama = orjinalAciklama; 
            let miktar = parseFloat(islem.ADET) || parseFloat(islem.miktar) || 0;
            let birim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || "-"; 

            // Temizleme işlemleri
            if (orjinalAciklama.includes(' x ')) {
                if (miktar === 0) miktar = parseFloat(orjinalAciklama.split(' x ')[0]) || 0;
                temizAciklama = orjinalAciklama.split(' x ')[1];
            }
            
            // 🚨 MAKAS BURADA! (Taksit kelimesi geçmiyorsa kes, geçiyorsa elleme)
            if (temizAciklama.includes(' (') && !temizAciklama.includes('Taksit')) {
                temizAciklama = temizAciklama.split(' (')[0].trim();
            }
            
            // Tahsilatları Süsle
            let orjAciklamaKucuk = orjinalAciklama.toLowerCase();
            if (odeme > 0 && borc === 0 && !(orjAciklamaKucuk.includes('iade'))) {
                let ikon = '';
                if (orjAciklamaKucuk.includes('nakit')) ikon = '<i class="fas fa-money-bill-wave text-success fs-5 me-2 align-middle"></i>';
                else if (orjAciklamaKucuk.includes('kart') || orjAciklamaKucuk.includes('kredi')) ikon = '<i class="fas fa-credit-card text-primary fs-5 me-2 align-middle"></i>';
                else if (orjAciklamaKucuk.includes('havale') || orjAciklamaKucuk.includes('eft')) ikon = '<i class="fas fa-university text-info fs-5 me-2 align-middle"></i>';

                if (ikon !== '') {
                    temizAciklama = `<div class="d-flex align-items-center">${ikon} <span class="fw-bold text-dark">${temizAciklama}</span></div>`;
                }
            }

            // ZIRHLI SARI ETİKET
            let metinKontrol = orjinalAciklama.toUpperCase().replace(/İ/g, 'I'); 
            let badge = '';

            if (borc > 0) {
                badge = '<span class="badge bg-danger text-white">Satış</span>';
            } else if (metinKontrol.includes('IADE')) {
                badge = '<span class="badge bg-warning text-dark shadow-sm fw-bold"><i class="fas fa-undo me-1"></i> İade</span>';
            } else {
                badge = '<span class="badge bg-success text-white">Tahsilat</span>';
            }

            // Notları ve Personeli ekle
            if (islem.notlar && islem.notlar !== 'null' && islem.notlar.trim() !== '') {
                temizAciklama += `<div class="mt-1"><small class="text-warning fw-bold"><i class="fas fa-sticky-note me-1"></i> Not: ${islem.notlar}</small></div>`;
            }
            
            // 👤 Personel Gösterimi
            let yapanPersonel = islem.IslemiYapan || islem.kullanici || '';
            if (yapanPersonel && yapanPersonel !== 'null' && yapanPersonel !== 'Sistem') {
                temizAciklama += `<div class="mt-1"><span class="badge bg-light text-secondary border px-2 py-1"><i class="fas fa-user-check me-1 text-info opacity-75"></i> ${yapanPersonel.toUpperCase()}</span></div>`;
            }

            // Garantili Teslimat Okuma Sistemi
            let teslimDurumu = islem.TeslimDurumu;
            if (!teslimDurumu || teslimDurumu === 'null' || teslimDurumu === '') {
                teslimDurumu = 'Teslim Edildi';
            }

            let kalanTeslimat = 0; 
            if (teslimDurumu === 'Bekliyor') {
                if (islem.KalanTeslimat !== null && islem.KalanTeslimat !== undefined) {
                    kalanTeslimat = parseFloat(islem.KalanTeslimat);
                } else {
                    kalanTeslimat = miktar; 
                }
            }

            if (kalanTeslimat < 0) kalanTeslimat = 0; 

            let teslimEdilen = miktar - kalanTeslimat;
            if (teslimEdilen < 0) teslimEdilen = 0;

            if (kalanTeslimat === 0) {
                teslimDurumu = 'Teslim Edildi';
                teslimEdilen = miktar;
            }

            // Miktar ve Birim Gösterim Sistemi
            let miktarHucresi = '-';
            let gosterilecekBirim = birim;

            if (borc > 0 && miktar > 0) {
                // Kalan > 0 ise Teslimat bilgisini (T ve K) göster
                if (kalanTeslimat > 0) {
                    miktarHucresi = `
                        <div class="fw-bold fs-6">${miktar}</div>
                        <div style="font-size: 0.75rem; line-height: 1.2;" class="mt-1 text-nowrap">
                            <span class="text-success fw-bold"><i class="fas fa-check-circle"></i> T: ${teslimEdilen}</span> / 
                            <span class="text-danger fw-bold"><i class="fas fa-clock"></i> K: ${kalanTeslimat}</span>
                        </div>
                    `;
                } else {
                    // Kalan = 0 ise teslimat detayını HİÇ GÖSTERME
                    miktarHucresi = `<div class="fw-bold fs-6">${miktar}</div>`;
                }
            } 
            else if (odeme > 0 && miktar > 0 && metinKontrol.includes('IADE')) {
                miktarHucresi = `<div class="fw-bold fs-6 text-warning"><i class="fas fa-undo me-1"></i> ${miktar}</div>`;
            } 
            else if (miktar > 0) {
                miktarHucresi = `<div class="fw-bold fs-6">${miktar}</div>`;
            }
            
            // --- AKSİYON BUTONLARI ---
            let aksiyonlar = '';

            // 1. MAKBUZ BUTONU (Sadece Tahsilat ise)
            if (odeme > 0 && borc === 0 && !metinKontrol.includes('IADE')) {
                let oAnkiKalan = parseFloat(islem.ISLEM_BAKIYESI) || 0; 
                let gonderilecekEskiBakiye = oAnkiKalan + odeme;
                // 🚨 Yazdırmaya gönderilen isim parametresi güncellendi
                let makbuzYapan = (yapanPersonel && yapanPersonel !== 'Sistem') ? yapanPersonel : (localStorage.getItem('aktifKullanici') || 'SİSTEM');

                aksiyonlar += `
                    <button class="btn btn-sm btn-outline-primary border-0 me-1" 
                            onclick="makbuzOnizle('${encodeURIComponent(aktifMusteriAd)}', ${odeme}, '${orjinalAciklama}', '${tarihGunu}', '${islem.MakbuzNo || ''}', '${makbuzYapan}', ${gonderilecekEskiBakiye})" 
                            title="Makbuzu Yazdır">
                        <i class="fas fa-print"></i>
                    </button>`;
            }

            // 2. İADE BUTONU
            if (metinKontrol.includes('IADE')) {
                aksiyonlar += `
                    <button class="btn btn-sm btn-outline-warning border-0 me-1" 
                            onclick="iadeOnizlemeYazdir('${islem.MakbuzNo || ''}', ${odeme}, '${hamTarih}', '${encodeURIComponent(orjinalAciklama)}', '${miktar}', '${gosterilecekBirim}')" 
                            title="İade Fişini Yazdır">
                        <i class="fas fa-print"></i>
                    </button>`;
            }

            // 3. DÜZENLE BUTONU (Sadece Borç varsa)
            if (borc > 0) {
                aksiyonlar += `
                    <button class="btn btn-sm btn-outline-warning border-0 me-1" 
                            onclick="islemDuzenleAc(${islemId}, ${kalanTeslimat}, ${miktar}, '${teslimDurumu}', '${encodeURIComponent(islem.notlar || '')}')" title="Düzenle">
                        <i class="fas fa-edit"></i>
                    </button>`;
            }

            // 4. SİL BUTONU (Her zaman)
            aksiyonlar += `
                <button class="btn btn-sm btn-outline-danger border-0" onclick="islemSil(${islemId})" title="İşlemi Sil">
                    <i class="fas fa-trash"></i>
                </button>`;

            // --- TABLOYA BASMA ---
            tabloGovdesi.innerHTML += `
                <tr class="align-middle">
                    <td>
                        <div class="fw-bold text-dark" style="font-size: 0.85rem;">${tarihGunu}</div>
                        <div class="text-muted" style="font-size: 0.75rem;"><i class="far fa-clock me-1"></i>${saatKismi}</div>
                    </td>
                    <td class="text-center">${badge}</td>
                    <td><div class="fw-bold text-dark" style="font-size: 0.95rem;">${temizAciklama}</div></td>
                    <td class="text-center">${miktarHucresi}</td>
                    <td class="text-center text-muted fw-bold small">${gosterilecekBirim}</td>
                    <td class="text-end text-primary">${borc > 0 && miktar > 0 ? (borc / miktar).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺' : '-'}</td>
                    <td class="text-end text-danger fw-bold">${borc > 0 ? borc.toLocaleString('tr-TR') : '-'}</td>
                    <td class="text-end text-success fw-bold">${odeme > 0 ? odeme.toLocaleString('tr-TR') : '-'}</td>
                    <td class="text-center">
                        <div class="d-flex justify-content-center">${aksiyonlar}</div>
                    </td>
                </tr>
            `;
        });

        // Alt Toplamlar
        document.getElementById('detayToplamBorc').innerText = `${toplamBorc.toLocaleString('tr-TR')} ₺`;
        document.getElementById('detayToplamOdenen').innerText = `${toplamOdenen.toLocaleString('tr-TR')} ₺`;
        document.getElementById('detayKalanBakiye').innerText = `${(toplamBorc - toplamOdenen).toLocaleString('tr-TR')} ₺`;

        try {
            await musteriDetayNotlariSenkronize(musteriId);
        } catch (eN) {
            console.warn('Müşteri notları yüklenemedi:', eN);
        }

        // =======================================================
        // 🚨 YENİ: ÜNVAN EKSİKSE OTOMATİK GÜNCELLEME EKRANINI AÇ
        // =======================================================
        window.atlananMusteriler = window.atlananMusteriler || new Set(); 
        
        if ((!aktifMusteriUnvan || aktifMusteriUnvan === 'null' || aktifMusteriUnvan.trim() === '') && !window.atlananMusteriler.has(musteriId)) {
            setTimeout(() => {
                musteriDuzenleAc(temizAd, temizTel, true, musteriId); 
            }, 800); 
        }

    } catch (error) {
        console.error("Detay yükleme hatası", error);
        if (document.getElementById('detayTabloGovdesi')) {
            document.getElementById('detayTabloGovdesi').innerHTML = '<tr><td colspan="10" class="text-center text-danger py-4">Veriler çekilirken hata oluştu!</td></tr>';
        }
    }
};
// BU YARDIMCI FONKSİYONU DA SCRIPT.JS EN ALTINA EKLEMEYİ UNUTMA PATRON!
window.makbuzOnizle = function(adEnc, tutar, tur, tarih, mNo, yapan, oGunkuEskiBakiye) { 
    // <--- 'oGunkuEskiBakiye' parametresi eklendi!
    const ad = decodeURIComponent(adEnc);
    
    // Artık mavi karttan değil, DİREKT olarak butondan gelen mühürlü bakiyeyi alıyoruz
    // Eğer eski kayıtlarda (NULL olanlarda) sorun olmasın diye en azından tutarı eski bakiye yapıyoruz.
    const eskiBakiye = parseFloat(oGunkuEskiBakiye) || parseFloat(tutar) || 0;

    if (typeof makbuzYazdir === 'function') {
        makbuzYazdir(ad, tutar, tur, tarih, mNo || '______', eskiBakiye, yapan);
    } else {
        console.error("Hata: makbuzYazdir fonksiyonu bulunamadı!");
    }
};
// --- CARİ KARTTAN GELDİĞİ YERE GERİ DÖNÜŞ (AKILLI GPS) ---
// =================================================================
// 🛑 FİZİKSEL MÜHÜRLÜ GERİ DÖNÜŞ SİSTEMİ (KESİN ÇÖZÜM)
// =================================================================




// 4. Müşteri Detayından (Geldiği Yere) Geri Dön

// --- TAHSİLAT (ÖDEME ALMA) İŞLEMLERİ ---

let aktifMusteriId = null; 
let aktifMusteriAd = "";

function odemeAlModalAc() {
    if (!aktifMusteriId) {
        alert("Lütfen önce bir müşteri seçin.");
        return;
    }
    document.getElementById('tahsilatMusteriAd').innerText = aktifMusteriAd;
    document.getElementById('tahsilatTutar').value = ""; 
    document.getElementById('tahsilatAciklama').value = ""; 

    // YENİ: Tarih kutusuna bugünü otomatik atıyoruz
    const tarihKutusu = document.getElementById('odemeTarihi');
    if(tarihKutusu) tarihKutusu.value = bugununTarihiFormati();

    const tahsilatModal = new bootstrap.Modal(document.getElementById('tahsilatModal'));
    guvenliModalAc('tahsilatModal');
}

// =========================================================
// 💰 TAHSİLAT KAYDI (MAKBUZ VE PERSONEL İMZALI)
// =========================================================
// =========================================================
// 💰 TAHSİLAT KAYDI (AKILLI RADAR VE YÖNLENDİRME DESTEKLİ)
// =========================================================
async function tahsilatiKaydet() {
    // 1. GİRDİLERİ AL
    const tutarInput = document.getElementById('tahsilatTutar');
    const odemeTuruInput = document.getElementById('tahsilatAciklama');
    const ozelNotInput = document.getElementById('odemeNot');
    
    const tutar = tutarInput ? tutarInput.value : "";
    const odemeTuru = odemeTuruInput ? odemeTuruInput.value : "";
    const ozelNot = ozelNotInput ? ozelNotInput.value.trim() : ""; 
    
    if (!tutar || !odemeTuru) { 
        alert("Lütfen tutar ve ödeme türü kısımlarını doldurun."); 
        return; 
    }

    // =========================================================
    // 👤 PERSONEL ZIRHI (EN TEPEYE ALDIK Kİ RADAR DA KULLANABİLSİN)
    // =========================================================
    let aktifPersonel = localStorage.getItem('aktifKullanici');
    if (!aktifPersonel || aktifPersonel === 'Sistem' || aktifPersonel === 'null') {
        const navbarAd = document.getElementById('navbarKullaniciAd')?.innerText;
        aktifPersonel = (navbarAd && navbarAd !== 'Yükleniyor...') ? navbarAd : 'SİSTEM KAYDI';
    }

    // =======================================================
    // 🚨 AKILLI HAVUZ RADARI (YÖNLENDİRME SİSTEMİ)
    // =======================================================
    try {
        const tRes = await fetch(`/api/musteri-taksitler/${aktifMusteriId}`);
        const taksitler = await tRes.json();

        let toplamTaksitBorcu = 0;
        if (taksitler && taksitler.length > 0) {
            taksitler.forEach(t => {
                if (t.DURUM == '0') {
                    let orj = parseFloat(t.MIKTAR) || 0;
                    let ode = parseFloat(t.ODEMELER) || 0;
                    toplamTaksitBorcu += (orj - ode);
                }
            });
        }

        if (toplamTaksitBorcu > 0) {
            const yonlendir = confirm(`⚠️ DİKKAT - AKILLI RADAR!\n\nBu müşterinin ödenmemiş ${toplamTaksitBorcu.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺ TAKSİT borcu bulunuyor.\n\nAlınan ${tutar} ₺ tutarındaki bu tahsilatı doğrudan TAKSİT HAVUZUNA (Ödeme Planına) yönlendirmek ister misiniz?\n\n[TAMAM] -> Taksit Havuzuna Aktar (Tavsiye Edilen)\n[İPTAL] -> Normal Cari Ödeme Olarak İşle`);

            if (yonlendir) {
                // 1. Fazla Ödeme Kalkanı için güncel borcu global değişkene yazıyoruz (Kritik!)
                window.guncelToplamTaksitBorcu = toplamTaksitBorcu;

                // 2. Açık olan Tahsilat Modalı'nı gizle
                const tahsilatModalEl = document.getElementById('tahsilatModal');
                if (tahsilatModalEl) bootstrap.Modal.getInstance(tahsilatModalEl)?.hide();

                // 3. Havuz motorunu ateşle (İlk taksitin ID'sini bulup gönderiyoruz)
                const ilkTaksitId = taksitler.find(t => t.DURUM == '0')?.Kimlik || 0;
                
                // NOT varsa açıklamaya ekle
                const havuzAciklama = ozelNot ? `${odemeTuru} (${ozelNot})` : odemeTuru;
                
                // 🚨 RADAR YÖNLENDİRMESİNE DE PERSONELİ EKLİYORUZ
                taksitOdendiYap(ilkTaksitId, tutar, "Genel Tahsilattan Yönlendirme", havuzAciklama, aktifPersonel);
                
                // 4. Normal işlemi DONDUR, çünkü Havuz halledecek!
                return; 
            }
        }
    } catch (e) {
        console.error("Radar hatası:", e);
    }
    // =======================================================


    // 2. AKILLI TARİH VE SAAT MOTORU
    const islemTarihiKutusu = document.getElementById('odemeTarihi');
    let secilenTarih = islemTarihiKutusu ? islemTarihiKutusu.value : ''; 
    
    const pad = (n) => n.toString().padStart(2, '0');
    const simdi = new Date();

    const saat = pad(simdi.getHours());
    const dakika = pad(simdi.getMinutes());
    const saniye = pad(simdi.getSeconds());
    const tamSaat = `${saat}:${dakika}:${saniye}`;

    let islemTarihiSql = "";    // Veritabanı için (Örn: 2026-04-24 15:30:00)
    let islemTarihiMakbuz = ""; // Makbuz için (Örn: 24.04.2026)

    if (!secilenTarih) {
        const g = pad(simdi.getDate());
        const a = pad(simdi.getMonth() + 1);
        const y = simdi.getFullYear();
        
        islemTarihiSql = `${y}-${a}-${g} ${tamSaat}`;
        islemTarihiMakbuz = `${g}.${a}.${y}`;
    } else {
        const p = secilenTarih.split('-'); 
        islemTarihiSql = `${secilenTarih} ${tamSaat}`;
        islemTarihiMakbuz = `${p[2]}.${p[1]}.${p[0]}`; 
    }

    // 3. AÇIKLAMA İMZASI
    const birlesikAciklama = `${odemeTuru} Tahsilat${ozelNot ? ' - ' + ozelNot : ''}`;

    // 4. BAKİYE MÜHÜRLEME HESABI
    const bakiyeElement = document.getElementById('detayKalanBakiye');
    let suankiBakiye = 0; 
    if (bakiyeElement) {
        suankiBakiye = parseFloat(bakiyeElement.innerText.replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
    }
    const yeniKalanMuhur = suankiBakiye - parseFloat(tutar);

    // 5. SUNUCUYA GÖNDERİM
    try {
        const response = await fetch('/api/musteri-odeme-makbuzlu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musteriId: aktifMusteriId,
                tutar: parseFloat(tutar), 
                odemeTuru: odemeTuru,
                aciklama: birlesikAciklama,
                notlar: ozelNot,
                tarih: islemTarihiSql,
                islemiYapan: aktifPersonel, // 🚨 BURASI GÜVENCE ALTINDA
                islemBakiyesi: yeniKalanMuhur 
            })
        });

        const data = await response.json();
        
        // 6. BAŞARILI KAYIT İŞLEMLERİ
        if (response.ok && data.success) {
            const tahsilatModalEl = document.getElementById('tahsilatModal');
            if (tahsilatModalEl) {
                const tahsilatModal = bootstrap.Modal.getInstance(tahsilatModalEl);
                if (tahsilatModal) tahsilatModal.hide();
            }
            if (document.getElementById('tahsilatFormu')) document.getElementById('tahsilatFormu').reset();
            
            if (localStorage.getItem('ayarOtoMakbuz') !== 'false') {
                // 🚨 MAKBUZA DA PERSONEL GİDİYOR
                makbuzYazdir(aktifMusteriAd, tutar, odemeTuru, islemTarihiMakbuz, data.makbuzNo, suankiBakiye, aktifPersonel);
            } else {
                // Otomatik yazdırma kapalıysa personeli mesajda gösterelim
                alert(`✅ ${tutar} ₺ ödeme kaydedildi.\nİşlemi Yapan: ${aktifPersonel}\nMakbuz No: ${data.makbuzNo}`);
            }
            
            const tel = document.getElementById('detayTelefon')?.innerText || "";
            musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel); // Kendi orijinal listeye dönme metodun
            
            if (typeof cariListesiniYukle === 'function') cariListesiniYukle(); 
            if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();

        } else { 
            alert("Hata: " + (data.hata || "Kayıt yapılamadı.")); 
        }
    } catch (error) { 
        console.error("Tahsilat Hatası:", error);
        alert("Sunucuya ulaşılamadı. Lütfen bağlantınızı kontrol edin."); 
    }
}
// 1. Tüm Müşterileri Listeleme (PERFORMANS İÇİN OPTİMİZE EDİLDİ)
// Arama yaparken kullanmak için verileri bu global değişkende tutacağız
let tumMusteriler = []; 

async function cariListesiniYukle() {
    const tabloGövdesi = document.getElementById('cariTabloGövdesi');
    tabloGövdesi.innerHTML = '<tr><td colspan="6" class="text-center py-4">Veriler yükleniyor, lütfen bekleyin...</td></tr>';
    
    try {
        const response = await fetch('/api/musteriler'); 
        // Backend'den gelen tüm listeyi kaydediyoruz
        tumMusteriler = await response.json(); 
        
        // Tabloyu ilk kez dolduruyoruz
        tabloyuGuncelle(tumMusteriler);

    } catch (error) {
        console.error("Müşteri listesi çekilirken hata:", error);
        tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Hata oluştu! Veritabanı bağlantısını kontrol edin.</td></tr>`;
    }
}

/** DB’den gelen ham mahalleyi "Batı İstasyon Mah." biçimine çevirir; boşsa ''. */
function mahalleGorunumStr(ham) {
    if (ham == null) return '';
    const t = String(ham).trim();
    if (!t || t === 'null') return '';
    return typeof window.mahalleAdiniBiçimlendir === 'function' ? window.mahalleAdiniBiçimlendir(t) : t;
}

/** Rapor/seçicide eksik adres satırı etiketi (mahalle değil). */
function mahalleRaporEksikEtiketi() {
    return 'Girilmeyenler';
}

// Tabloyu çizen ana fonksiyon (Hem ilk yüklemede hem aramada burası çalışır)
function tabloyuGuncelle(liste) {
    const tabloGövdesi = document.getElementById('cariTabloGövdesi');
    let tabloIcerigi = ''; 

    liste.forEach(musteri => {
        const adi = musteri.Adı ? musteri.Adı.trim() : '';
        const unvan = musteri.Unvan ? musteri.Unvan.trim() : '';
        const mahalle = mahalleGorunumStr(musteri.Mahalle);
        
        // Unvan / Adı gösterim mantığı
        let musteriGosterim = '';
        if (unvan.length > 0) {
            musteriGosterim = `
                <div class="fw-bold text-dark">${unvan}</div>
                <div class="text-muted" style="font-size: 0.85em;">${adi}</div>
            `;
        } else {
            musteriGosterim = `<div class="fw-bold text-dark-custom">${adi}</div>`;
        }

        const toplamBorc = parseFloat(musteri.ToplamBorc) || 0;
        const toplamOdenen = parseFloat(musteri.ToplamOdeme) || 0;
        const kalanBakiye = parseFloat(musteri.Bakiye) || 0;

        let bakiyeMetni = kalanBakiye > 0 
            ? `<span class="text-danger fw-bold">${kalanBakiye.toLocaleString('tr-TR')} ₺</span>` 
            : `<span class="text-success fw-bold">Borcu Yok</span>`;

        tabloIcerigi += `
            <tr>
                <td>${musteriGosterim}</td>
                <td>
                    <div class="fw-bold">${musteri.CEPTEL || '-'}</div>
                    <div class="text-primary small fw-semibold">${mahalle}</div>
                </td>
                <td class="text-danger">${toplamBorc.toLocaleString('tr-TR')} ₺</td>
                <td class="text-success">${toplamOdenen.toLocaleString('tr-TR')} ₺</td>
                <td>${bakiyeMetni}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary" onclick="cariDetayaGit(${musteri.Kimlik}, '${adi.replace(/'/g, "\\'")}', '${musteri.CEPTEL}')">
                        <i class="fas fa-folder-open me-1"></i> Detay
                    </button>
                </td>
            </tr>
        `;
    });

    tabloGövdesi.innerHTML = tabloIcerigi;
}

// 🔎 ARAMA FONKSİYONU: HTML'deki inputun oninput olayına bağla
// Örnek: <input type="text" oninput="cariAra(this.value)">
// Eski cariAra() fonksiyonunu bununla değiştir:
function cariAra() {
    // 1. Arama kutusuna yazılan metni al (Türkçe uyumlu küçük harf)
    const aramaMetni = document.getElementById('cariAramaKutusu').value.toLocaleLowerCase('tr-TR').trim();
    
    // 2. Eğer arama kutusu boşsa tüm listeyi göster
    if (aramaMetni === "") {
        tabloyuGuncelle(tumMusteriler);
        return;
    }

    // 3. tumMusteriler dizisi içinde Adı, Unvan, Mahalle veya Telefonu kontrol et
    const filtrelenmisSonuclar = tumMusteriler.filter(m => {
        const ad = (m.Adı || "").toLocaleLowerCase('tr-TR');
        const unvan = (m.Unvan || "").toLocaleLowerCase('tr-TR');
        const mahalleHam = (m.Mahalle || "").toLocaleLowerCase('tr-TR');
        const mahalleFmt = mahalleGorunumStr(m.Mahalle).toLocaleLowerCase('tr-TR');
        const tel = (m.CEPTEL || "");

        return ad.includes(aramaMetni) ||
               unvan.includes(aramaMetni) ||
               mahalleHam.includes(aramaMetni) ||
               (mahalleFmt && mahalleFmt.includes(aramaMetni)) ||
               tel.includes(aramaMetni);
    });
    
    // 4. Sadece bulunan sonuçları tabloya bas
    tabloyuGuncelle(filtrelenmisSonuclar);
}

// --- 1. NORMAL SATIŞI TAMAMLA ---
// ==========================================================
// 1. ANA SAYFADAN (BÜYÜK BUTONDAN) YAPILAN NORMAL SATIŞ
// ==========================================================
// ==========================================================
// 1. ANA SAYFADAN (BÜYÜK BUTONDAN) YAPILAN NORMAL SATIŞ
// ==========================================================
// ==========================================================
// 1. ANA SAYFADAN (BÜYÜK BUTONDAN) YAPILAN NORMAL SATIŞ
// ==========================================================
// ==========================================================
// 1. ANA SAYFADAN (BÜYÜK BUTONDAN) YAPILAN NORMAL SATIŞ
// ==========================================================
// ==========================================================
// 1. ANA SAYFADAN (BÜYÜK BUTONDAN) YAPILAN SATIŞ VE MAKBUZ KESİMİ
// ==========================================================
window.satisiTamamla = async function() {
    let musteri_id = null;
    let musteriAd = "İsimsiz Müşteri";
    
    const mSelect = document.getElementById('satisMusteri') || document.getElementById('hizliSatisMusteriId');
    if (mSelect && mSelect.value) {
        musteri_id = mSelect.value.trim();
        musteriAd = mSelect.options[mSelect.selectedIndex].text.split(' - ')[0].trim();
    } else if (typeof aktifMusteriId !== 'undefined' && aktifMusteriId) {
        musteri_id = aktifMusteriId; 
        musteriAd = (aktifMusteriAd || "İsimsiz Müşteri");
    }

    if (!musteri_id) {
        alert('⚠️ Hata: Müşteri seçilmedi veya kimliği bulunamadı!'); 
        return;
    }

    if (!window.aktifSatisSepeti || window.aktifSatisSepeti.length === 0) {
        alert("Sepetiniz boş! Lütfen ürünü ekleyin."); return;
    }

    const notlarInput = document.getElementById('satisNotlar') || document.getElementById('hizliSatisNotlar');
    let notlar = notlarInput ? notlarInput.value.trim() : "";

    // --- TARİH/SAAT MOTORU ---
    const tarihKutusu = document.getElementById('satisTarihi') || document.getElementById('hizliSatisTarihi');
    let secilenTarih = tarihKutusu && tarihKutusu.value ? tarihKutusu.value : '';

    const simdi = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const saat = pad(simdi.getHours());
    const dakika = pad(simdi.getMinutes());
    const saniye = pad(simdi.getSeconds());

    let islemTarihiSql = "";
    if (!secilenTarih) {
        const y = simdi.getFullYear();
        const a = pad(simdi.getMonth() + 1);
        const g = pad(simdi.getDate());
        islemTarihiSql = `${y}-${a}-${g} ${saat}:${dakika}:${saniye}`;
    } else {
        const sadeceTarih = secilenTarih.split('T')[0]; 
        islemTarihiSql = `${sadeceTarih} ${saat}:${dakika}:${saniye}`;
    }
    
    const p = islemTarihiSql.split(' ')[0].split('-');
    const islemTarihiMakbuz = `${p[2]}.${p[1]}.${p[0]}`;

    const taksitSayisi = document.getElementById('satisTaksitSayisi') ? document.getElementById('satisTaksitSayisi').value : 1;
    const vadeTarihi = document.getElementById('satisVadeTarihi') ? document.getElementById('satisVadeTarihi').value : islemTarihiSql.split(' ')[0];

    const odemeVarMi = document.getElementById('hizliOdemeVarMi') ? document.getElementById('hizliOdemeVarMi').checked : false;
    const odemeTuru = odemeVarMi ? (document.getElementById('hizliOdemeTuru') ? document.getElementById('hizliOdemeTuru').value : 'Peşin') : 'Veresiye';

    // =========================================================
    // 👤 PERSONEL ZIRHI (SİSTEM YAZISINI BİTİREN KISIM)
    // =========================================================
    let aktifPersonel = localStorage.getItem('aktifKullanici');
    
    // Eğer hafıza boşsa Navbardaki ekrana yansıyan ismi çek
    if (!aktifPersonel || aktifPersonel === 'Sistem' || aktifPersonel === 'null') {
        const navbarAd = document.getElementById('navbarKullaniciAd')?.innerText;
        aktifPersonel = (navbarAd && navbarAd !== 'Yükleniyor...') ? navbarAd : 'SİSTEM KAYDI';
    }

    try {
        let suankiBakiye = 0;
        try {
            const bRes = await fetch(`/api/musteriler`);
            const mList = await bRes.json();
            const mData = mList.find(x => x.Kimlik == musteri_id);
            if (mData) suankiBakiye = parseFloat(mData.Bakiye) || 0;
        } catch(e){ console.error("Bakiye çekilemedi", e); }

        let basariliKayitlar = 0;
        let sepetToplami = 0;

        // SEPETİ GÖNDER (islemiYapan artık zırhlı)
        for (const item of window.aktifSatisSepeti) {
            sepetToplami += parseFloat(item.tutar);
            const teslimatSecimi = item.durum ? item.durum : 'Teslim Edildi';
            const gecerliKomurId = item.komur_id || item.id;

            const response = await fetch('/api/satis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    musteri_id: parseInt(musteri_id),
                    komur_id: parseInt(gecerliKomurId),
                    miktar_ton: parseFloat(item.miktar),
                    toplam_tutar: parseFloat(item.tutar),
                    notlar: notlar,
                    teslim_durumu: teslimatSecimi,
                    tarih: islemTarihiSql, 
                    satis_odeme_turu: odemeTuru, 
                    taksit_sayisi: taksitSayisi,
                    vade_tarihi: vadeTarihi,
                    islemiYapan: aktifPersonel // 🚨 BURASI MÜHÜRLENDİ
                })
            });

            if (response.ok) basariliKayitlar++;
        }

        // KASAYA GİRİŞ VE MAKBUZ
        if (basariliKayitlar === window.aktifSatisSepeti.length) {
            
            let odemeKutusu = document.getElementById('hizliOdemeTutari');
            let alinanPara = odemeKutusu && odemeKutusu.value ? parseFloat(odemeKutusu.value.replace(',', '.')) : 0;
            if (isNaN(alinanPara)) alinanPara = 0;

            if (odemeVarMi && alinanPara === 0) alinanPara = sepetToplami;

            let kesilenMakbuzNo = null;

            if (odemeVarMi && alinanPara > 0) {
                const islemBakiyesi = (suankiBakiye + sepetToplami) - alinanPara;

                try {
                    const resTahsilat = await fetch('/api/musteri-odeme-makbuzlu', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            musteriId: parseInt(musteri_id),  
                            tarih: islemTarihiSql, 
                            tutar: alinanPara,              
                            odemeTuru: odemeTuru,            
                            aciklama: "Satış Tahsilatı (" + odemeTuru + ")" + (notlar ? " - " + notlar : ""),
                            notlar: "",
                            islemiYapan: aktifPersonel, // 🚨 TAHSİLAT İÇİN DE MÜHÜRLENDİ
                            islemBakiyesi: islemBakiyesi
                        })
                    });
                    const tData = await resTahsilat.json();
                    if (resTahsilat.ok && tData.success) {
                        kesilenMakbuzNo = tData.makbuzNo;
                    }
                } catch (e) { console.error("Ödeme API Hatası", e); }
            }
            
            // Temizlik işlemleri
            window.aktifSatisSepeti = [];
            if (typeof sepetiCiz === 'function') sepetiCiz();
            
            const mEl = document.getElementById('hizliSatisModal') || document.getElementById('yeniSatisModal');
            if (mEl) { bootstrap.Modal.getInstance(mEl)?.hide(); }
            
            const sForm = document.getElementById('satisFormu') || document.getElementById('hizliSatisFormu');
            if (sForm) sForm.reset();

            // YAZDIRMA VE MESAJ
            if (odemeVarMi && alinanPara > 0) {
                let makbuzMesaji = kesilenMakbuzNo ? ` Makbuz No: ${kesilenMakbuzNo}` : ` (Numarasız İşlem)`;
                
                if (localStorage.getItem('ayarOtoMakbuz') !== 'false') {
                    // Makbuza da personeli gönderiyoruz
                    makbuzYazdir(musteriAd, alinanPara, odemeTuru, islemTarihiMakbuz, kesilenMakbuzNo, (suankiBakiye + sepetToplami), aktifPersonel);
                } else {
                    alert(`✅ Başarılı! Satış ve Tahsilat kaydedildi.${makbuzMesaji}`);
                }
            } else {
                alert(`✅ Başarılı! Veresiye Satış kaydedildi.`);
            }

            if (typeof stoklariYukle === 'function') stoklariYukle();
            if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();
            if (typeof cariListesiniYukle === 'function') cariListesiniYukle();
            if (typeof musteriHareketleriniYukle === 'function') musteriHareketleriniYukle(musteri_id);
            if (typeof satistanDetayaDon === 'function') satistanDetayaDon(); 
            
        } else {
            alert(`⚠️ Sepetteki ${window.aktifSatisSepeti.length} ürünün sadece ${basariliKayitlar} tanesi kaydedildi!`);
        }
        
    } catch (error) {
        console.error("Satış Hatası:", error);
        alert('Satış sırasında bir hata oluştu.');
    }
};
// ==========================================================
// 2. MÜŞTERİ KARTININ İÇİNDEN YAPILAN HIZLI SATIŞ
// ==========================================================
// ==========================================================
// 2. MÜŞTERİ KARTININ İÇİNDEN YAPILAN HIZLI SATIŞ
// ==========================================================
window.hizliSatisiKaydet = async function() {
    const hizliTeslimatSecimi = document.getElementById('hizliAdreseGidecekMi').checked ? 'Bekliyor' : 'Teslim Edildi';
    
    const komurSelect = document.getElementById('hizliSatisKomur');
    const komur_id = komurSelect ? komurSelect.value.trim() : null;
    
    const miktarInput = document.getElementById('hizliSatisMiktar');
    const miktar_ton_str = miktarInput ? miktarInput.value.trim() : null;

    const notlarInput = document.getElementById('hizliSatisNot');
    const notlar = notlarInput ? notlarInput.value.trim() : "";
    
    // --- SAAT ÇALMASINI KÖKTEN ÇÖZEN ZIRH ---
    const islemTarihiKutusu = document.getElementById('hizliSatisTarihi');
    let secilenTarih = islemTarihiKutusu ? islemTarihiKutusu.value : '';

    const simdi = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    
    const saat = pad(simdi.getHours());
    const dakika = pad(simdi.getMinutes());
    const saniye = pad(simdi.getSeconds());
    
    // DİKKAT: Backend'in saati 3 saat geri almasını engellemek için araya 'T', sona 'Z' ekliyoruz!
    // Örnek Giden Format: "2026-04-24T14:55:00.000Z"
    let islemTarihiSql = "";
    if (!secilenTarih) {
        const y = simdi.getFullYear();
        const a = pad(simdi.getMonth() + 1);
        const g = pad(simdi.getDate());
        islemTarihiSql = `${y}-${a}-${g}T${saat}:${dakika}:${saniye}.000Z`;
    } else {
        islemTarihiSql = `${secilenTarih}T${saat}:${dakika}:${saniye}.000Z`;
    }
    // --------------------------------------------------------

    if (!komur_id || !miktar_ton_str) { alert("Lütfen ürün ve miktar seçin."); return; }

    const miktar_ton = parseFloat(miktar_ton_str);
    if (isNaN(miktar_ton) || miktar_ton <= 0) { alert("Geçerli bir miktar girin."); return; }

    const secilenOption = komurSelect.options[komurSelect.selectedIndex];
    const birimFiyati = parseFloat(secilenOption.getAttribute('data-fiyat')) || 0;
    const hesaplananTutar = birimFiyati * miktar_ton;

    const tutarGirdisi = prompt(`Birim Fiyat: ${birimFiyati.toLocaleString('tr-TR')} ₺\nMiktar: ${miktar_ton}\n\nToplam Tutar:`, hesaplananTutar.toFixed(2));
    if (tutarGirdisi === null || tutarGirdisi.trim() === "") return;

    const toplam_tutar = parseFloat(tutarGirdisi.replace(',', '.'));
    if (isNaN(toplam_tutar) || toplam_tutar <= 0) { alert("Geçerli tutar girin."); return; }

    const odemeTuru = document.getElementById('hizliSatisOdemeTuru') ? document.getElementById('hizliSatisOdemeTuru').value : 'Peşin';
    const taksitSayisi = document.getElementById('hizliSatisTaksitSayisi') ? document.getElementById('hizliSatisTaksitSayisi').value : 1;
    
    // Vade tarihini alırken 'T' harfinden bölüp sadece tarihi alıyoruz
    const vadeTarihi = document.getElementById('hizliSatisVadeTarihi') && document.getElementById('hizliSatisVadeTarihi').value 
                        ? document.getElementById('hizliSatisVadeTarihi').value 
                        : islemTarihiSql.split('T')[0];

    const aktifPersonel = localStorage.getItem('aktifKullanici') || 'Sistem';

    try {
        const response = await fetch('/api/satis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musteri_id: aktifMusteriId,
                komur_id: parseInt(komur_id),
                miktar_ton: miktar_ton,
                toplam_tutar: toplam_tutar,
                notlar: notlar,
                teslim_durumu: hizliTeslimatSecimi,
                satis_odeme_turu: odemeTuru,
                taksit_sayisi: taksitSayisi,
                vade_tarihi: vadeTarihi,
                tarih: islemTarihiSql, // <-- ZIRHLI SAAT BURADAN GİDİYOR
                islemiYapan: aktifPersonel 
            })
        });

        const data = await response.json();
        if (response.ok) {
            alert(`✅ Hızlı satış kaydedildi!`);
            bootstrap.Modal.getInstance(document.getElementById('hizliSatisModal')).hide();
            if (document.getElementById('hizliSatisFormu')) document.getElementById('hizliSatisFormu').reset();
            document.getElementById('hizliAdreseGidecekMi').checked = false;
            
            musteriDetayGoster(aktifMusteriId, aktifMusteriAd || "", document.getElementById('detayTelefon')?.innerText || "");
            
            if (typeof stoklariYukle === 'function') stoklariYukle(); 
            if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle(); 
            if (typeof cariListesiniYukle === 'function') cariListesiniYukle();
        } else { 
            alert('Hata: ' + (data.hata || 'Kayıt başarısız.')); 
        }
    } catch (error) { 
        alert('Sunucu hatası oluştu.'); 
    }
};
// --- CARİ ÜZERİNDEN HIZLI SATIŞ MODALINI AÇAN FONKSİYON (KİLİT KIRICI VERSİYON) ---
// =================================================================
// 🛒 ÇOKLU SATIŞ VE AKILLI SEPET SİSTEMİ 
// =================================================================
// =================================================================
// 🛒 ÇOKLU SATIŞ VE AKILLI SEPET SİSTEMİ 
// =================================================================
window.aktifSatisSepeti = []; 

// 1. MODALI AÇ VE TEMİZLE (KÖK BOOTSTRAP ÇÖZÜMÜ)
window.hizliSatisModalAc = async function() {
    if (!aktifMusteriId) { alert("Lütfen önce bir müşteri seçin."); return; }

    // --- ÇELİK YELEK 1: AÇIK OLAN DİĞER EKRANLARI GİZLE ---
    ['musterilerModal', 'musteriDetayModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const inst = bootstrap.Modal.getInstance(el);
            if (inst) inst.hide();
        }
    });

    // --- ÇELİK YELEK 2: MODALI DOM'UN EN DIŞINA TAŞI (ARKADA KALMAYI ÖNLER) ---
    const modalEl = document.getElementById('hizliSatisModal');
    if (modalEl) document.body.appendChild(modalEl);

    // Sepeti ve formu sıfırla
    window.aktifSatisSepeti = []; 
    if (typeof sepetiCiz === 'function') sepetiCiz(); 

    let ad = (aktifMusteriAd || "").replace(/null/g, '').trim() || "İsimsiz Müşteri";
    document.getElementById('hizliSatisMusteriAd').innerText = ad;

    // =======================================================
    // 🚨 YENİ: HIZLI SATIŞ ERKEN UYARI (ROZET) SİSTEMİ
    // =======================================================
    try {
        const tRes = await fetch(`/api/musteri-taksitler/${aktifMusteriId}`);
        const taksitler = await tRes.json();
        let tpBorc = 0;
        
        if (taksitler && taksitler.length > 0) {
            taksitler.forEach(t => {
                if (t.DURUM == '0') {
                    tpBorc += (parseFloat(t.MIKTAR) || 0) - (parseFloat(t.ODEMELER) || 0);
                }
            });
        }
        
        if (tpBorc > 0) {
            // Eğer taksiti varsa, isminin yanına yanıp sönen kırmızı bir etiket ekle!
            document.getElementById('hizliSatisMusteriAd').innerHTML = `
                ${ad} 
                <span class="badge bg-danger ms-2 py-1 px-2 border border-white shadow-sm" style="font-size:0.75rem;">
                    <i class="fas fa-exclamation-triangle"></i> DİKKAT: ${tpBorc.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺ Taksit Borcu Var!
                </span>`;
        }
    } catch(e) { console.error("Rozet hatası", e); }
    // =======================================================

    const formEl = document.getElementById('hizliSatisFormu');
    if (formEl) formEl.reset();

    // 💵 YENİ: ÖDEME ŞALTERİNİ VE KUTULARINI SIFIRLA (Her müşteriye temiz ekran)
    if(document.getElementById('hizliOdemeVarMi')) document.getElementById('hizliOdemeVarMi').checked = false;
    if(document.getElementById('hizliOdemeDetay')) document.getElementById('hizliOdemeDetay').style.display = 'none';
    if(document.getElementById('hizliOdemeTutari')) document.getElementById('hizliOdemeTutari').value = '';
    
    const tarihKutu = document.getElementById('hizliSatisTarihi');
    if (tarihKutu) tarihKutu.value = bugununTarihiFormati();

    // Diğer modalların kapanması için yarım saniye (300ms) mola verip öyle açıyoruz
    setTimeout(() => {
        let mInst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        mInst.show();

        // Arka plan örtüsü ayarı (Garanti olsun diye)
        setTimeout(() => {
            modalEl.style.setProperty('z-index', '1060', 'important');
            const backdrops = document.querySelectorAll('.modal-backdrop');
            if (backdrops.length > 0) {
                backdrops[backdrops.length - 1].style.setProperty('z-index', '1059', 'important');
            }
        }, 150);
    }, 300);

    // Ürünleri veritabanından çek
    const select = document.getElementById('hizliSatisKomur');
    if(select) select.innerHTML = '<option value="" disabled selected>Yükleniyor...</option>';

    try {
        const res = await fetch('/api/komur');
        const stoklar = await res.json();
        
        // Fiyatları otomatik çekmek için hafızaya alıyoruz
        window.tumUrunlerYedek = stoklar; 
        
        if(select) {
            select.innerHTML = '<option value="" disabled selected>Ürün Seçin...</option>';
            stoklar.forEach(s => {
                const ad = (s.cins || s.UrunAdi || '').trim();
                select.innerHTML += `<option value="${s.id || s.ID}" data-isim="${ad}" data-fiyat="${s.ton_fiyati || s.SatisFiyati || 0}">${ad} — Kalan: ${stokTablosuMiktarHucreMetni(s)}</option>`;
            });
        }
    } catch (err) { 
        if(select) select.innerHTML = '<option value="">Hata!</option>'; 
    }
};
// 2. MATEMATİK HESAPLAMALARI (Zeka Kısmı)
// ==========================================
// 🧮 AKILLI MATEMATİK HESAPLAMALARI
// ==========================================

window.urunSecildi = function() {
    const s = document.getElementById('hizliSatisKomur');
    if(!s.value) return;
    const fiyat = parseFloat(s.options[s.selectedIndex].getAttribute('data-fiyat')) || 0;
    document.getElementById('hizliSatisBirimFiyat').value = fiyat;
    document.getElementById('hizliSatisMiktar').value = '';
    document.getElementById('hizliSatisTutar').value = '';
};

// 1. Fiyat değişirse -> Tutarı günceller
window.fiyatDegisti = function() { 
    window.miktarDegisti(); 
}; 

// 2. Miktar değişirse -> Tutarı hesaplar (Normal İşleyiş)
window.miktarDegisti = function() {
    const f = parseFloat(document.getElementById('hizliSatisBirimFiyat').value) || 0;
    const m = parseFloat(document.getElementById('hizliSatisMiktar').value) || 0;
    
    if (f > 0 && m > 0) {
        document.getElementById('hizliSatisTutar').value = (f * m).toFixed(2);
    } else {
        document.getElementById('hizliSatisTutar').value = '';
    }
};

// 3. Tutar değişirse -> BİRİM FİYATI esnetir (Düz Hesap / İndirim mantığı)
window.tutarDegisti = function() {
    const t = parseFloat(document.getElementById('hizliSatisTutar').value) || 0;
    const m = parseFloat(document.getElementById('hizliSatisMiktar').value) || 0;
    
    // Eğer miktar kutusu doluysa, o miktara dokunma, birim fiyatı yeniden hesapla
    if (m > 0) {
        document.getElementById('hizliSatisBirimFiyat').value = (t / m).toFixed(2);
    } 
    // Eğer miktar boşsa (adam direkt tutar yazdıysa), fiyattan miktarı bul
    else {
        const f = parseFloat(document.getElementById('hizliSatisBirimFiyat').value) || 0;
        if (f > 0) {
            document.getElementById('hizliSatisMiktar').value = (t / f).toFixed(2);
        }
    }
};

// 3. SEPETE ÜRÜN AT
window.sepeteEkle = function() {
    const uSelect = document.getElementById('hizliSatisKomur');
    const mKutu = document.getElementById('hizliSatisMiktar'); 
    const tKutu = document.getElementById('hizliSatisTutar');
    const fKutu = document.getElementById('hizliSatisBirimFiyat');
    const adreseMi = document.getElementById('satirTeslimat') ? document.getElementById('satirTeslimat').checked : false;

    // Kontrol: Boş değer varsa durdur
    if(!uSelect.value || !mKutu.value || !tKutu.value) {
        alert("⚠️ Ürün, miktar ve tutar boş olamaz!"); 
        return;
    }

    // Birim fiyatı güvenli bir şekilde sayıya çevir
    const birimFiyat = parseFloat(fKutu.value) || 0;

    // Sepet dizisine ekle
    window.aktifSatisSepeti.push({
        komur_id: uSelect.value,
        urunAdi: uSelect.options[uSelect.selectedIndex].getAttribute('data-isim'),
        miktar: parseFloat(mKutu.value),
        tutar: parseFloat(tKutu.value),
        birim_fiyat: birimFiyat, // Artık hata vermez, burada tanımlı
        durum: adreseMi ? 'Bekliyor' : 'Teslim Edildi'
    });

    // Formu temizle
    uSelect.value = ""; 
    mKutu.value = ""; 
    tKutu.value = ""; 
    if(fKutu) fKutu.value = "";
    if(document.getElementById('satirTeslimat')) document.getElementById('satirTeslimat').checked = false;

    // Tabloyu güncelle
    sepetiCiz();
};

window.sepettenSil = function(index) {
    window.aktifSatisSepeti.splice(index, 1);
    sepetiCiz();
};

window.sepetiCiz = function() {
    const govde = document.getElementById('sepetTabloGovdesi');
    const toplamKutu = document.getElementById('sepetGenelToplam');
    
    if (!govde) return; // Tedbir: Tablo gövdesi yoksa hata verme
    
    let toplam = 0; 
    govde.innerHTML = "";

    // Sütun sayısı 6 oldu (Ürün, Teslimat, Miktar, B.Fiyat, Tutar, Sil)
    if(window.aktifSatisSepeti.length === 0) {
        govde.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sepet boş...</td></tr>';
        if(toplamKutu) toplamKutu.innerText = "0,00 ₺"; 
        return;
    }

    window.aktifSatisSepeti.forEach((item, i) => {
        toplam += item.tutar;
        
        // Teslimat Rozeti
        const kargoBadge = item.durum === 'Bekliyor' 
            ? '<span class="badge bg-danger"><i class="fas fa-truck me-1"></i> Gidecek</span>' 
            : '<span class="badge bg-success"><i class="fas fa-hand-holding-usd me-1"></i> Elden</span>';
            
        // Satırı Oluştur (Hata yapılan yer düzeltildi: urun yerine item kullanıldı)
        govde.innerHTML += `
            <tr class="align-middle border-bottom">
                <td class="fw-bold text-dark">${item.urunAdi}</td>
                <td class="text-center">${kargoBadge}</td>
                <td class="text-center fw-bold">${item.miktar}</td>
                
                <td class="text-center text-muted small">${(item.birim_fiyat || 0).toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</td>
                
                <td class="text-danger fw-bold text-end pe-3">${item.tutar.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger border-0" onclick="sepettenSil(${i})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    });

    // Genel Toplamı Yazdır
    if(toplamKutu) {
        toplamKutu.innerText = toplam.toLocaleString('tr-TR', {minimumFractionDigits: 2}) + " ₺";
    }
};
// =================================================================
// 💰 YENİ ÖDEME (TAHSİLAT) MODALI VE KAYIT İŞLEMİ
// =================================================================

// 4. ÖDEME EKRANINI AÇ
// 4. ÖDEME EKRANINI AÇ (GARANTİLİ NÖBET DEĞİŞİMİ)

window.satisOdemeEkraniAc = function() {
    if(window.aktifSatisSepeti.length === 0) { alert("Sepet boş!"); return; }
    
    // 1. ÖNCE SATIŞ MODALINI KAPAT (Gri ekran çakışmasını kökten çözer)
    const satisModalEl = document.getElementById('hizliSatisModal');
    if (satisModalEl) {
        let satisInst = bootstrap.Modal.getInstance(satisModalEl);
        if (satisInst) satisInst.hide();
    }

    // 2. ÖDEME BİLGİLERİNİ HAZIRLA
    const toplam = window.aktifSatisSepeti.reduce((sum, item) => sum + item.tutar, 0);
    document.getElementById('odemeEkraniToplam').innerText = toplam.toLocaleString('tr-TR', {minimumFractionDigits: 2}) + " ₺";
    
    document.getElementById('odemeYontemi').value = "Açık Hesap";
    odemeYontemiSecildi();

    // 3. YARIM SANİYE BEKLE VE ÖDEME MODALINI AÇ (Diğeri tam kapansın diye)
    setTimeout(() => {
        const pModal = document.getElementById('satisOdemeModal');
        let inst = bootstrap.Modal.getInstance(pModal) || new bootstrap.Modal(pModal);
        inst.show();
    }, 400); 
};

// 5. ÖDEME YÖNTEMİ DEĞİŞİNCE
window.odemeYontemiSecildi = function() {
    const yontem = document.getElementById('odemeYontemi').value;
    const kutu = document.getElementById('alinanTutarKutusu');
    const input = document.getElementById('odemeAlinanTutar');
    const toplam = window.aktifSatisSepeti.reduce((sum, item) => sum + item.tutar, 0);

    if (yontem === "Açık Hesap") {
        kutu.style.display = 'none';
        input.value = 0;
    } else {
        kutu.style.display = 'block';
        input.value = toplam; // Varsayılan olarak hesabı kapatır gibi tam tutarı yazarız
    }
};

// 6. FİŞİ KES (SATIŞI VE TAHSİLATI KAYDET)
// 6. FİŞİ KES (SATIŞI VE TAHSİLATI KAYDET)
window.satisVeTahsilatiBitir = async function() {
    const btn = document.querySelector('#satisOdemeModal .btn-success');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Kaydediliyor...'; }

    // --- AKILLI SAAT MOTORU ---
    const tarihKutusu = document.getElementById('hizliSatisTarihi');
    let secilenTarih = tarihKutusu ? tarihKutusu.value : '';

    const simdi = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    
    const saat = pad(simdi.getHours());
    const dakika = pad(simdi.getMinutes());
    const saniye = pad(simdi.getSeconds());
    
    let islemTarihiSql = "";
    if (!secilenTarih) {
        // Tarih seçilmediyse bugünü al ve ŞU ANKİ saati yapıştır
        const y = simdi.getFullYear();
        const a = pad(simdi.getMonth() + 1);
        const g = pad(simdi.getDate());
        islemTarihiSql = `${y}-${a}-${g} ${saat}:${dakika}:${saniye}`;
    } else {
        // Tarih seçildiyse yanına ŞU ANKİ saati yapıştır
        islemTarihiSql = `${secilenTarih} ${saat}:${dakika}:${saniye}`;
    }
    // --------------------------

    const notlarInput = document.getElementById('hizliSatisNotlar');
    const notlar = notlarInput ? notlarInput.value : '';
    
    const odemeYontemiInput = document.getElementById('odemeYontemi');
    const odemeYontemi = odemeYontemiInput ? odemeYontemiInput.value : 'Nakit';
    
    const alinanNakitInput = document.getElementById('odemeAlinanTutar');
    const alinanNakit = alinanNakitInput ? (parseFloat(alinanNakitInput.value) || 0) : 0;
    
    const aktifPersonel = localStorage.getItem('aktifKullanici') || 'Sistem';

    try {
        // 1. Sepetteki her ürünü tek tek sat (Backend'e gönder)
        for (const item of window.aktifSatisSepeti) {
            await fetch('/api/satis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    musteri_id: aktifMusteriId,
                    komur_id: item.komur_id,
                    miktar_ton: item.miktar,
                    toplam_tutar: item.tutar,
                    notlar: notlar,
                    teslim_durumu: item.durum, 
                    tarih: islemTarihiSql, // <-- DOĞRU SAAT BURADAN GİDİYOR
                    satis_odeme_turu: 'Açık Hesap', 
                    taksit_sayisi: 1,
                    islemiYapan: aktifPersonel // <-- İMZA
                })
            });
        }

        // 2. Eğer peşinat alındıysa (veya nakit seçildiyse) anında tahsilat yap
        if (alinanNakit > 0 && odemeYontemi !== "Açık Hesap") {
            await fetch('/api/tahsilat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kisiId: aktifMusteriId,
                    odeme: alinanNakit,
                    aciklama: `Satış Tahsilatı (${odemeYontemi})`, 
                    notlar: notlar,
                    tarih: islemTarihiSql, // <-- DOĞRU SAAT TAHSİLATA DA GİDİYOR
                    islemiYapan: aktifPersonel // <-- İMZA
                })
            });
        }

        alert("✅ Satış ve tahsilat başarıyla tamamlandı!");
        
        if (typeof satistanDetayaDon === 'function') satistanDetayaDon();

    } catch (err) {
        alert("Kayıt sırasında hata oluştu!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle me-1"></i> İşlemi Tamamla'; }
    }
};
// Hızlı Satışı Kaydet (Not alanı korunuyor)

// --- YENİ MÜŞTERİ EKLEME (MSSQL BAĞLANTILI) ---
window.yeniMusteriKaydet = async function() {
    // 1. Ekrandaki tüm verileri topla
    const ad_soyad = document.getElementById('yeniMusteriAd').value.trim();
    const unvan = document.getElementById('yeniMusteriUnvan').value.trim(); 
    const telefon = document.getElementById('yeniMusteriTelefon').value.trim();
    const adres = document.getElementById('yeniMusteriAdres').value.trim(); 
    const km = typeof window.konyaMahalleVeIlceOku === 'function' ? window.konyaMahalleVeIlceOku('yeniMusteri') : {};
    const ilce = km.ilce || '';
    const mahalle = km.mahalle || '';

    // 2. Zorunlu Alan Kontrolleri
    if (!unvan) {
        alert("⚠️ Makbuz kesilebilmesi için 'Resmi Ünvan' alanı zorunludur.");
        document.getElementById('yeniMusteriUnvan').focus();
        return;
    }

    if (!telefon) {
        alert("⚠️ Müşteriye ulaşabilmek için 'Telefon Numarası' girmelisiniz.");
        document.getElementById('yeniMusteriTelefon').focus();
        return;
    }

    if (telefon.length !== 10) {
        alert("⚠️ Lütfen telefon numarasını başında '0' olmadan tam 10 hane olarak giriniz!");
        document.getElementById('yeniMusteriTelefon').focus();
        return;
    }

    // 3. MÜKERRER KAYIT KONTROLÜ (Hem isim hem tel aynıysa uyarı ver)
    if (typeof tumMusteriler !== 'undefined' && Array.isArray(tumMusteriler)) {
        const varMi = tumMusteriler.find(m => {
            const mevcutTel = String(m.telefon || m.tel || "").trim();
            const girilenTel = String(telefon).trim();
            
            const mevcutUnvan = (m.unvan || "").toLocaleUpperCase('tr-TR').trim();
            const yeniUnvan = unvan.toLocaleUpperCase('tr-TR').trim();

            // Sadece ikisi birden eşleşirse true döner
            return mevcutTel === girilenTel && mevcutUnvan === yeniUnvan;
        });

        if (varMi) {
            const mesaj = `⚠️ BU MÜŞTERİ ZATEN VAR!\n\nKayıtlı Ünvan: ${varMi.unvan}\nTelefon: ${varMi.telefon || varMi.tel}\n\nBu bilgilerin aynısıyla ikinci bir kayıt oluşturmak istiyor musunuz?`;
            if (!confirm(mesaj)) return; 
        }
    }

    try {
        const response = await fetch('/api/musteri', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                ad_soyad, unvan, telefon, adres, ilce, mahalle
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Başarılıysa modalı kapat
            const modalElement = document.getElementById('yeniMusteriModal');
            if (modalElement) {
                const modalInstance = bootstrap.Modal.getInstance(modalElement);
                if (modalInstance) modalInstance.hide();
            }

            // Formu temizle
            document.getElementById('yeniMusteriFormu').reset();
            if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan('yeniMusteri');
            
            // Listeleri yenile (await ile listenin güncellenmesini bekle)
            if (typeof cariListesiniYukle === 'function') await cariListesiniYukle();
            if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();

            // 4. OTOMATİK CARİ AÇILIŞI 🚨
            if (data.yeniId) {
                console.log("Yeni müşteri carisi açılıyor, ID:", data.yeniId);
                setTimeout(() => {
                    if (typeof window.musteriDetayGoster === 'function') {
                        window.musteriDetayGoster(data.yeniId);
                    }
                }, 150);
            }

        } else {
            alert("⚠️ Hata: " + (data.hata || "Kayıt sırasında bir problem oluştu."));
        }
    } catch (error) {
        console.error("Müşteri ekleme hatası:", error);
        alert("❌ Sunucuyla iletişim kurulamadı.");
    }
};
// --- CARİ ARAMA (FİLTRELEME) FONKSİYONU ---

// --- ANA SAYFA YENİ SATIŞ MODALINI AÇAN VE DOLDURAN FONKSİYON ---
async function yeniSatisModalAc() {
    const musteriSelect = document.getElementById('satisMusteri');
    const komurSelect = document.getElementById('satisKomur');
    const formEl = document.getElementById('satisFormu');

    // Modalı aç
    const yeniSatisModal = new bootstrap.Modal(document.getElementById('yeniSatisModal'));
    yeniSatisModal.show();

    // Formu temizle ve yükleniyor mesajı ver
    if (formEl) formEl.reset();
    document.getElementById('satisNotlar').value = "";
    musteriSelect.innerHTML = '<option value="" disabled selected>Müşteriler çekiliyor, bekleyin...</option>';
    komurSelect.innerHTML = '<option value="" disabled selected>Ürünler çekiliyor...</option>';

    try {
        // İki veriyi (Müşteri ve Stok) aynı anda çekiyoruz (Hız için)
        const [musteriRes, komurRes] = await Promise.all([
            fetch('/api/musteriler'),
            fetch('/api/komur')
        ]);

        const musteriler = await musteriRes.json();
        const stoklar = await komurRes.json();

        // 1. MÜŞTERİLERİ DOLDUR (Performanslı Yöntem)
        musteriSelect.innerHTML = '<option value="" disabled selected>Müşteri Seçin...</option>';
        let musteriOptions = '';
        musteriler.forEach(m => {
            let adSoyad = `${m.Adı} ${m.Soyadı}`.replace(/null/g, '').trim() || '-';
            musteriOptions += `<option value="${m.Kimlik}">${adSoyad} - (${m.CEPTEL || 'Tel Yok'})</option>`;
        });
        musteriSelect.innerHTML += musteriOptions;

        // 2. KÖMÜRLERİ DOLDUR
// musteriDetayGoster içindeki döngü tamamen bu olacak:

// yeniSatisModalAc() fonksiyonunun içi ...
        // 2. KÖMÜRLERİ DOLDUR
        komurSelect.innerHTML = '<option value="" disabled selected>Kömür Cinsi Seçin...</option>';
        let komurOptions = '';
        stoklar.forEach(s => {
            const tamEtiket = (s.cins || '').trim();
            komurOptions += `
                <option value="${s.id}" data-fiyat="${s.ton_fiyati}">
                    ${tamEtiket} — Fiyat: ${s.ton_fiyati}₺ — Kalan: ${stokTablosuMiktarHucreMetni(s)}
                </option>`;
        });
        komurSelect.innerHTML += komurOptions;

    } catch (error) {
        console.error('Modal verileri yüklenirken hata:', error);
        musteriSelect.innerHTML = '<option value="" disabled selected>Bağlantı Hatası!</option>';
        komurSelect.innerHTML = '<option value="" disabled selected>Bağlantı Hatası!</option>';
    }
}
// STOK MODALINI AÇAN FONKSİYON
// STOK MODALINI AÇAN FONKSİYON
// STOK MODALINI AÇAN FONKSİYON
function yeniStokModalAc() {
    const formEl = document.getElementById('yeniStokFormu');
    if (formEl) formEl.reset();
    stokBirimDegisti(); // Form sıfırlandığında KG alanını gizlemek ve yazıları düzeltmek için çağırıyoruz
    
    const modal = new bootstrap.Modal(document.getElementById('yeniStokModal'));
    modal.show();
}

// BİRİM DEĞİŞTİĞİNDE KG KUTUSUNU AÇIP KAPATAN FONKSİYON
function stokBirimDegisti() {
    const birim = document.getElementById('stokBirim').value;
    
    // Yazıları değiştir
    document.getElementById('lblStokFiyat').innerHTML = `${birim} Fiyatı (₺) <span class="text-danger">*</span>`;
    document.getElementById('lblStokMiktar').innerHTML = `Başlangıç Stoğu (${birim}) <span class="text-danger">*</span>`;
    
    // Çuval seçildiyse KG soran kutuyu göster, değilse gizle
    const kgDiv = document.getElementById('kgAlanDiv');
    if (birim === 'Çuval') {
        kgDiv.classList.remove('d-none'); // Göster
    } else {
        kgDiv.classList.add('d-none'); // Gizle
        document.getElementById('stokCuvalKg').value = ""; // Gizlerken içini de temizle
    }
}

// YENİ STOĞU VERİTABANINA GÖNDEREN FONKSİYON
async function yeniStokKaydet() {
    const urunAdiGirdisi = document.getElementById('stokUrunAdi').value.trim();
    const birim = document.getElementById('stokBirim').value;
    const fiyat = parseFloat(document.getElementById('stokFiyat').value);
    const miktar = parseFloat(document.getElementById('stokMiktar').value);
    const altEsik = parseFloat(document.getElementById('stokEsikAlt').value);
    const ustEsik = parseFloat(document.getElementById('stokEsikUst').value);
    let tamUrunAdi = "";

    if (!urunAdiGirdisi || isNaN(fiyat) || isNaN(miktar) || isNaN(altEsik) || isNaN(ustEsik)) {
        alert("Lütfen tüm alanları (ürün, fiyat, stok ve iki eşik rakamını) eksiksiz doldurun.");
        return;
    }
    if (ustEsik <= altEsik) {
        alert("Üst eşik, alt eşikten büyük olmalıdır.");
        return;
    }

    // Birimi yalnızca "Satış Birimi" alanından al: parantezle yazılırsa Çift (Ton) oluşur, eşleşme bozulur
    if (urunAdiGirdisi.includes('(') || urunAdiGirdisi.includes(')')) {
        alert('Ürün adına birim yazmayın (parantez kullanmayın). Birimi alttaki "Satış Birimi" listesinden seçin; sistem tek satırda "Ad + birim" kaydedecek.');
        return;
    }

    // ÇUVAL SEÇİLDİYSE KG BİLGİSİNİ DE İSMİN İÇİNE KATIYORUZ
    if (birim === 'Çuval') {
        const kg = document.getElementById('stokCuvalKg').value.trim();
        if (!kg) {
            alert("Lütfen 1 çuvalın kaç KG olduğunu yazın.");
            return;
        }
        tamUrunAdi = `${urunAdiGirdisi} (${kg} KG Çuval)`;
    } else {
        tamUrunAdi = `${urunAdiGirdisi} (${birim})`;
    }

    try {
        const response = await fetch('/api/komur', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                UrunAdi: tamUrunAdi,
                TonFiyati: fiyat,
                MevcutStok: miktar,
                EsikAlt: altEsik,
                EsikUst: ustEsik
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert(`✅ Başarılı! ${tamUrunAdi} stoğa eklendi.`);
            
            const modalEl = document.getElementById('yeniStokModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalInstance.hide();

            if (typeof stoklariYukle === 'function') stoklariYukle();
            if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();
        } else {
            alert('HATA: ' + (data.hata || 'Ürün kaydedilemedi.'));
        }
    } catch (error) {
        console.error('Stok ekleme hatası:', error);
        alert('Sunucu ile bağlantı kurulamadı.');
    }
}
// --- STOK DÜZENLEME İŞLEMLERİ ---
async function stokDuzenle(id) {
    try {
        const response = await fetch('/api/komur');
        const stoklar = await response.json();
        const urun = stoklar.find(s => s.id === id || s.ID === id);

        if (!urun) {
            alert("Ürün bilgisi bulunamadı!");
            return;
        }

        // SOL TARAF: KUTULARI DOLDUR
        document.getElementById('duzenleStokId').value = urun.id || urun.ID;
        const etiket = urun.cins || urun.UrunAdi || '';
        document.getElementById('duzenleUrunAdi').value = etiket;
        document.getElementById('duzenleStokEtiketiOrig').value = etiket;
        document.getElementById('duzenleFiyat').value = urun.ton_fiyati || urun.SatisFiyati;
        document.getElementById('duzenleMiktar').value = urun.mevcut_stok_ton || urun.BaslangicStogu || 0;
        const ea = document.getElementById('duzenleEsikAlt');
        const eu = document.getElementById('duzenleEsikUst');
        if (ea && eu) {
            const kayitliAlt = Number(urun.esik_alt);
            const kayitliUst = Number(urun.esik_ust);
            if (Number.isFinite(kayitliAlt) && Number.isFinite(kayitliUst) && kayitliUst > kayitliAlt) {
                ea.value = kayitliAlt;
                eu.value = kayitliUst;
            } else {
                ea.value = '';
                eu.value = '';
            }
        }

        // SAĞ TARAF: GİZLİLİK ZIRHINI KALDIRDIK, DİREKT EMİR VERİYORUZ
        urunAlimGecmisiYukle(urun.id || urun.ID);

        // MODALI AÇ
        const modalElement = document.getElementById('stokDuzenleModal');
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        modal.show();

    } catch (error) {
        console.error("Düzenleme hatası:", error);
    }
}

async function stokGuncelleKaydet() {
    const id = document.getElementById('duzenleStokId').value;
    const urunAdi = document.getElementById('duzenleUrunAdi').value.trim();
    const fiyat = parseFloat(document.getElementById('duzenleFiyat').value);
    const miktar = parseFloat(document.getElementById('duzenleMiktar').value);
    const altEsik = parseFloat(document.getElementById('duzenleEsikAlt').value);
    const ustEsik = parseFloat(document.getElementById('duzenleEsikUst').value);
    if (!urunAdi || isNaN(fiyat) || isNaN(miktar) || isNaN(altEsik) || isNaN(ustEsik)) {
        alert("Lütfen tüm alanları (iki eşik dahil) doldurun.");
        return;
    }
    if (ustEsik <= altEsik) {
        alert("Üst eşik, alt eşikten büyük olmalıdır.");
        return;
    }

    try {
        const response = await fetch('/api/komur/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                UrunAdi: urunAdi,
                TonFiyati: fiyat,
                MevcutStok: miktar,
                EsikAlt: altEsik,
                EsikUst: ustEsik
            })
        });

        if (response.ok) {
            alert("✅ Ürün başarıyla güncellendi.");
            bootstrap.Modal.getInstance(document.getElementById('stokDuzenleModal')).hide();
            if (typeof stoklariYukle === 'function') stoklariYukle();
        } else {
            const data = await response.json();
            alert("Hata: " + data.hata);
        }
    } catch (error) {
        console.error("Güncelleme hatası:", error);
        alert("Sunucuya ulaşılamadı.");
    }
}

// --- STOK SİLME İŞLEMİ (GÜVENLİ SİLME) ---
async function stokSil(id) {
    const onay = confirm("Bu ürünü listeden kaldırmak istediğinize emin misiniz?\n\nNot: Eski müşteri hesaplarının bozulmaması için geçmiş satışlardaki ismi kalacaktır.");
    
    if (!onay) return;

    try {
        const response = await fetch('/api/komur/' + id, { method: 'DELETE' });

        if (response.ok) {
            alert("🗑️ Ürün listeden kaldırıldı.");
            if (typeof stoklariYukle === 'function') stoklariYukle(); // Listeyi yenile
        } else {
            const data = await response.json();
            alert("Hata: " + data.hata);
        }
    } catch (error) {
        console.error("Silme hatası:", error);
        alert("Sunucuya ulaşılamadı.");
    }
}
// MÜŞTERİ EKSTRESİNDEN İŞLEM SİLME (VE STOK İADE ETME)
window.islemSil = async function(islemKimlik) {
    const onay = confirm("⚠️ DİKKAT!\n\nBu işlemi silmek istediğinize emin misiniz?\nİptal edilen işleme göre STOK otomatik güncellenecektir.");
    
    if (!onay) return;

    try {
        // Silme isteğini gönder
        const response = await fetch('/api/islem/' + islemKimlik, { method: 'DELETE' });
        
        // Response gelmeden data'yı okumaya çalışmaması için tedbir
        let data = {};
        try { data = await response.json(); } catch(e) {}

        if (response.ok) {
            alert("✅ İşlem silindi ve stoklar ayarlandı!");
            
            // 1. CARİ EKSTREYİ YENİLE
            const telElement = document.getElementById('detayTelefon');
            const telefon = telElement ? telElement.innerText : "-";
            if (typeof musteriDetayGoster === 'function' && typeof aktifMusteriId !== 'undefined') {
                musteriDetayGoster(aktifMusteriId, aktifMusteriAd, telefon); 
            }

            // 2. TAKSİT PLANI EKRANINI YENİLE
            const taksitModal = document.getElementById('taksitPlaniModal');
            if (typeof musteriTaksitleriniAc === 'function' && taksitModal && taksitModal.classList.contains('show')) {
                musteriTaksitleriniAc();
            }
            
            // 🚀 3. ALTIN VURUŞ: ZAMAN AYARLI STOK VE ÖZET YENİLEME
            setTimeout(() => {
                // Ana sayfadaki stok tablosunu zorla yenile
                if (typeof stoklariYukle === 'function') stoklariYukle();
                
                // Yukarıdaki müşteri/satış özetlerini yeniler
                if (typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle(); 
                
                // Ana cari listesini (borçlar vb.) yeniler
                if (typeof cariListesiniYukle === 'function') cariListesiniYukle(); 
                
            }, 600); // 600 milisaniye bekle (SQL tam toparlasın diye)

        } else {
            alert("❌ HATA: " + (data.hata || "İşlem silinemedi."));
        }
    } catch (error) {
        console.error("Silme hatası:", error);
        alert("⚠️ Sunucuya ulaşılamadı. Terminali kontrol edin.");
    }
};
// GÜNLÜK ÖZET MODALINI AÇMA (Bugünün tarihiyle başlar)
function gunlukOzetModalAc() {
    const bugun = new Date().toISOString().split('T')[0]; // Format: 2024-03-24
    document.getElementById('ozetTarihSecici').value = bugun;
    
    const modal = new bootstrap.Modal(document.getElementById('gunlukOzetModal'));
// --- ESKİ KOD GİTTİ, YENİ MAYMUNCUK GELDİ ---
    guvenliModalAc('gunlukOzetModal');
    // -------------------------------------------
    
    // Açılır açılmaz bugünün verilerini çek
    gunlukOzetGetir();
}

// SEÇİLEN TARİHE GÖRE İŞLEMLERİ GETİRME

// --- BOOTSTRAP GRİ EKRAN (BACKDROP) TAKILMA SORUNU KESİN ÇÖZÜMÜ ---
document.addEventListener('hidden.bs.modal', function () {
    // Ekranda açık olan başka bir modal (pencere) kalmadıysa temizlik yap
    if (document.querySelectorAll('.modal.show').length === 0) {
        // Vücuttaki kilitleri aç
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        
        // Sahnede unutulan tüm gri örtüleri (backdrop) zorla sil
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
    }
});
// ====================================================
// 🚚 BEKLEYEN TESLİMATLAR (ŞOFÖR YIKIM İŞLEMLERİ)
// ====================================================

// 1. Şoför tablosunu SQL'den çekip dolduran fonksiyon
// ====================================================
// 🚚 BEKLEYEN TESLİMATLAR (ŞOFÖR YIKIM İŞLEMLERİ)
// ====================================================

// 1. ANA BUTONA BASILINCA ÇALIŞAN FONKSİYON: Modalı açar ve veriyi yükler
async function bekleyenTeslimatModaliniAc() {
    // Önce güncel listeyi çekelim
    await bekleyenTeslimatlariYukle();
    
    // Şimdi listeyi içeren büyük modalı açalım
    const sevkiyatModalElement = document.getElementById('sevkiyatListesiModal');
    const sevkiyatModalInstance = bootstrap.Modal.getOrCreateInstance(sevkiyatModalElement);
    sevkiyatModalInstance.show();
}

// 2. Tabloyu (Modal içindeki) SQL'den çekip dolduran fonksiyon
// --- 1. ŞIKLAŞTIRILMIŞ ŞOFÖR LİSTESİ ---
window.bekleyenTeslimatlariYukle = async function() {
    try {
        const response = await fetch('/api/bekleyen-teslimatlar');
        const veriler = await response.json();
        window.sonSevkiyatVerileri = veriler;
        const tabloGovdesi = document.getElementById('bekleyenTeslimatlarGovdesi');
        
        tabloGovdesi.innerHTML = ''; 

        const aramaKutusu = document.getElementById('sevkiyatAramaKutusu');
        if (aramaKutusu) aramaKutusu.value = '';

        if (veriler.length === 0) {
            // Sütun sayısını 6 yaptık çünkü Mahalle eklendi
            tabloGovdesi.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5"><i class="fas fa-check-circle fs-1 text-success mb-3 d-block"></i> Bekleyen teslimat yok, tüm kömürler kapılara yıkılmış!</td></tr>';
            return;
        }

        veriler.forEach(islem => {
            let dinamikBirim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || islem.BİRİMTÜR || null;
            let tamAciklama = islem.AÇIKLAMA || "";
            let urunAdiTemiz = tamAciklama;

            if (tamAciklama.includes(' x ')) {
                urunAdiTemiz = tamAciklama.split(' x ')[1].split(' (')[0];
            } else if (tamAciklama.includes(' (')) {
                urunAdiTemiz = tamAciklama.split(' (')[0];
            }

            if (!dinamikBirim && tamAciklama.includes(' (')) {
                let match = tamAciklama.match(/\(([^)]+)\)/);
                if (match) dinamikBirim = match[1];
            }

            // --- AKILLI SÖZLÜK DEVREDE ---
            if (!dinamikBirim || dinamikBirim === "Birim" || dinamikBirim === "-") {
                let kucukAd = urunAdiTemiz.toLowerCase();
                
                if (kucukAd.includes('un') || kucukAd.includes('yem') || kucukAd.includes('kg') || kucukAd.includes('torba') || kucukAd.includes('çuval')) {
                    dinamikBirim = 'Çuval';
                } else if (kucukAd.includes('odun') || kucukAd.includes('paket') || kucukAd.includes('adet') || kucukAd.includes('polat') || kucukAd.includes('erik') || kucukAd.includes('ceviz') || kucukAd.includes('dempo')) {
                    dinamikBirim = 'Adet'; 
                } else {
                    dinamikBirim = 'Adet'; 
                }
            }

            let ad = (islem.Adı && islem.Adı !== "null") ? islem.Adı : "";
            let soyad = (islem.Soyadı && islem.Soyadı !== "null") ? islem.Soyadı : "";
            let unvan = (islem.Unvan && islem.Unvan !== 'null' && islem.Unvan.trim() !== "") ? islem.Unvan : `${ad} ${soyad}`.trim();
            if(!unvan) unvan = "İSİMSİZ MÜŞTERİ";

            let tel = (islem.CEPTEL && islem.CEPTEL !== "null" && islem.CEPTEL !== "+") ? islem.CEPTEL : "Telefon Yok";
            
            // 🚨 MÜŞTERİ VE İŞLEM KİMLİKLERİ GÜVENLİ MÜHÜRLENDİ
            let musteriId = islem.MusteriID || islem.Kimlik;
            let islemID = islem.HareketID || islem.hareketid || islem.HareketId || islem.Kimlik || islem.ID;
            
            let mahalle = (islem.Mahalle && islem.Mahalle !== "null" && islem.Mahalle.trim() !== "")
                ? mahalleGorunumStr(islem.Mahalle)
                : '<span class="text-danger small"><i class="fas fa-exclamation-triangle"></i> Girilmemiş</span>';
            let toplamAdet = islem.ADET || islem.KalanTeslimat;

            // 🚨 HTML İÇİNDEKİ KARIŞIKLIK TEMİZLENDİ VE ÇİFT TIKLAMA İÇİN islemID KULLANILDI
            tabloGovdesi.innerHTML += `
    <tr class="sevkiyat-row border-bottom align-middle table-hover" 
        style="transition: all 0.2s ease; cursor: pointer;"
        title="Yıkım (Teslimat) işlemi girmek için satıraya ÇİFT TIKLAYIN"
        ondblclick="yikildiIslemDuzenleAc(${islemID}, ${islem.KalanTeslimat}, ${toplamAdet}, '${encodeURIComponent(islem.notlar || '')}', '${encodeURIComponent(unvan)}')">
        
        <td class="ps-4 py-2" style="width: 25%;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold text-dark text-uppercase">${unvan}</span>
                
                <button type="button" class="btn btn-sm btn-light border shadow-sm px-2 py-0 ms-2" 
                        onclick="event.stopPropagation(); hizliAdresDuzenleAc(
                            ${musteriId},
                            '${encodeURIComponent(ad + ' ' + soyad)}',
                            '${encodeURIComponent(islem.Unvan || '')}',
                            '${encodeURIComponent(islem.Ilce || 'Sarayönü')}',
                            '${encodeURIComponent(islem.Mahalle || '')}',
                            '${encodeURIComponent(islem.Adres || '')}'
                        )" 
                        title="Adres ve Ünvanı Düzenle">
                    <i class="fas fa-edit text-primary" style="font-size: 0.8rem;"></i>
                </button>
            </div>
        </td>

        <td class="py-2" style="width: 15%;">
            <span class="fw-bold text-info" style="font-size: 0.9rem;"><i class="fas fa-map-marker-alt me-1"></i> ${mahalle}</span>
        </td>

        <td class="py-2" style="width: 15%;">
            <span class="small ${tel === 'Telefon Yok' ? 'text-muted' : 'text-danger fw-bold'}">
                <i class="fas fa-phone-alt opacity-75"></i> ${tel}
            </span>
        </td>

        <td class="py-2" style="width: 20%;">
            <span class="fw-bold text-primary">${urunAdiTemiz}</span>
        </td>

        <td class="text-center py-2" style="width: 10%;">
            <span class="badge rounded-pill bg-danger bg-opacity-75 px-2 py-1 shadow-sm border border-white border-opacity-50">
                ${islem.KalanTeslimat} <small class="fw-normal">${dinamikBirim}</small>
            </span>
        </td>

        <td class="py-2" style="width: 15%;">
            ${islem.notlar ? `
                <span class="d-inline-block text-truncate px-2 py-1 rounded bg-warning bg-opacity-10 text-dark small border border-warning border-opacity-25" 
                      style="max-width: 140px; font-size: 0.8rem;" 
                      title="${islem.notlar}">
                    <i class="fas fa-comment-dots text-warning me-1"></i><i>${islem.notlar}</i>
                </span>
            ` : '<span class="text-muted small">-</span>'}
        </td>
    </tr>
`;
        });
    } catch (error) {
        console.error("Teslimatlar yüklenemedi:", error);
    }
};
// --- 2. CANLI ARAMA MOTORU ---
window.sevkiyatAra = function() {
    // Arama kutusuna yazılan yazıyı alıp küçük harfe çeviriyoruz
    const aramaMetni = document.getElementById('sevkiyatAramaKutusu').value.toLocaleLowerCase('tr-TR');
    
    // Tablodaki tüm satırları buluyoruz
    const satirlar = document.getElementById('bekleyenTeslimatlarGovdesi').getElementsByTagName('tr');

    for (let i = 0; i < satirlar.length; i++) {
        const satir = satirlar[i];
        
        // Tablo boşsa (uyarı mesajı varsa) arama yapma
        if (satir.getElementsByTagName('td').length < 2) continue;

        // 0. Hücre: Müşteri Adı ve Tel | 1. Hücre: Ürün ve Not
        const musteriVeTel = satir.getElementsByTagName('td')[0].textContent.toLocaleLowerCase('tr-TR');
        const urunVeNot = satir.getElementsByTagName('td')[1].textContent.toLocaleLowerCase('tr-TR');

        // Aranan kelime ismin, telefonun veya ürünün içinde geçiyorsa göster, yoksa gizle
        if (musteriVeTel.includes(aramaMetni) || urunVeNot.includes(aramaMetni)) {
            satir.style.display = ""; 
        } else {
            satir.style.display = "none"; 
        }
    }
};
// 3. Şoför "Yıkıldı" butonuna basınca "Miktar Girme" modalını açar
// 1. Şoför "Yıkıldı" butonuna basınca miktar girme penceresini açar
function teslimatMiktarGirisiAc(islemId, musteriAd, kalanMiktar, birim) {
    document.getElementById('teslimatHareketId').value = islemId;
    document.getElementById('teslimatMusteriIsim').innerText = musteriAd;
    document.getElementById('teslimatBekleyenMiktar').innerText = kalanMiktar + " " + birim;
    document.getElementById('teslimEdilenMiktar').value = ''; 
    
    const miktarModal = new bootstrap.Modal(document.getElementById('teslimatModal'));
    miktarModal.show();
}

// 2. "Teslimatı Onayla" butonuna basınca veriyi sunucuya gönderir
async function teslimatiKaydet() {
    const islemId = document.getElementById('teslimatHareketId').value;
    const kalanMetin = document.getElementById('teslimatBekleyenMiktar').innerText;
    const kalanMiktar = parseFloat(kalanMetin.split(' ')[0]); // Rakamı ayıkla
    
    const teslimEdilenInput = document.getElementById('teslimEdilenMiktar').value;
    const teslimEdilen = parseFloat(teslimEdilenInput.replace(',', '.')); // Virgülü noktaya çevir

    // Hata kontrolleri
    if (!teslimEdilen || isNaN(teslimEdilen) || teslimEdilen <= 0) {
        alert("Lütfen geçerli bir miktar girin!");
        return;
    }

    if (teslimEdilen > kalanMiktar) {
        alert(`Dikkat! Müşterinin bekleyen ${kalanMiktar} birimi var. Fazla miktar giremezsin.`);
        return;
    }

    try {
        const response = await fetch(`/api/teslimat-guncelle/${islemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teslim_edilen: teslimEdilen })
        });

        if (response.ok) {
            // 1. Miktar penceresini kapat
            const miktarModalEl = document.getElementById('teslimatModal');
            bootstrap.Modal.getInstance(miktarModalEl).hide();
            
            // 2. Ana listeyi (arkadaki büyük tabloyu) tazele
            await bekleyenTeslimatlariYukle(); 
            
            // 3. Başarı mesajı
            alert("✅ Teslimat başarıyla düşüldü!");
        } else {
            alert("Hata: Kayıt yapılamadı.");
        }
    } catch (error) {
        console.error("Teslimat hatası:", error);
        alert("Sunucu bağlantısı koptu!");
    }
}
function yeniMusteriModalAc() {
    if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan('yeniMusteri');
    // Bootstrap 5 modal açma komutu
    const modalEl = document.getElementById('yeniMusteriModal'); // index.html'deki modal ID'si
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } else {
        alert("Hata: 'yeniMusteriModal' ID'li pencere index.html'de bulunamadı!");
    }
}
// --- İŞLEM DÜZENLEME FONKSİYONLARI ---

// 1. Düzenle butonuna basılınca modalı doldurup açar
// 1. Modalı Açan Fonksiyon
// 1. Modalı Açan Fonksiyon
// --- İŞLEM DÜZENLEME FONKSİYONLARI ---

// Modalı Açan ve Geçmişi Çeken Fonksiyon
// --- İŞLEM DÜZENLEME FONKSİYONLARI ---

// 1. Modalı Açan ve Geçmişi Çeken Fonksiyon


// Alt kısımdaki kırmızı yazıyı günceller
function guncelleLimitBilgisi(kalan, toplam) {
    const teslimEdilen = Math.max(0, toplam - kalan);
    document.getElementById('teslimatLimitBilgi').innerHTML = 
        `Toplam Satış: <span class="text-dark">${toplam}</span> | Teslim Edilen: <span class="text-success">${teslimEdilen}</span>`;
}
// ====================================================

// 2. Modalı Kaydeden Fonksiyon
// BU KOD HER ŞEYİ EZER GEÇER, DİREKT BUTONA BAĞLANIR
// window.islemGuncelleKaydet = async function() {
    
//     const id = document.getElementById('duzenleIslemId').value;
//     const teslimEdilen = parseFloat(document.getElementById('duzenleKalanTeslimat').value) || 0;
//     const notlar = document.getElementById('duzenleIslemNotu').value || '';

//     if (teslimEdilen <= 0) {
//         alert("Teslim edilecek miktarı giriniz!");
//         return;
//     }

//     const kaydetBtn = document.querySelector('#islemDuzenleModal .btn-warning');
//     if (kaydetBtn) {
//         kaydetBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Kaydediliyor...';
//         kaydetBtn.disabled = true;
//     }

//     try {
//         const response = await fetch(`/api/islem-guncelle/${id}`, {
//             method: 'PUT',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ 
//                 teslim_edilen_miktar: teslimEdilen, 
//                 notlar: notlar 
//             })
//         });

//         const result = await response.json();

//         if (response.ok && result.success) {
//             alert("✅ Teslimat başarıyla kaydedildi!");

//             // Modalı kapat
//             const modalEl = document.getElementById('islemDuzenleModal');
//             if (modalEl) {
//                 const modalInstance = bootstrap.Modal.getInstance(modalEl);
//                 if (modalInstance) modalInstance.hide();
//                 else modalEl.style.display = 'none';
//             }

//             // Listeyi tazele (en önemli kısım)
//             setTimeout(() => {
//                 if (typeof musteriDetayGoster === 'function' && typeof aktifMusteriId !== 'undefined') {
//                     const telefon = document.getElementById('detayTelefon')?.innerText || '';
//                     musteriDetayGoster(aktifMusteriId, aktifMusteriAd, telefon);
//                 } else {
//                     location.reload();
//                 }
//             }, 300);
// if (typeof bekleyenTeslimatlariYukle === 'function') bekleyenTeslimatlariYukle();
//         } else {
//             alert("❌ " + (result.hata || result.mesaj || "Güncelleme başarısız!"));
//         }
//     } catch (error) {
//         console.error(error);
//         alert("❌ Bağlantı hatası!");
//     } finally {
//         if (kaydetBtn) {
//             kaydetBtn.innerHTML = '<i class="fas fa-save me-1"></i> Değişiklikleri Kaydet';
//             kaydetBtn.disabled = false;
//         }
//     }
// };

// ====================== YENİ MODAL İÇİN KAYDET FONKSİYONU ======================
// ====================== YIKIM MODALI İÇİN KAYDET FONKSİYONU ======================

// Özet modalını ilk açtığımızda kutulara bugünü yazsın
// Özet modalını ilk açtığımızda kutulara bugünü yazsın ve YETKİ KONTROLÜ yapsın
window.gunlukOzetModalAc = function() {
    // 1. Türkiye saatine göre 'bugün'ü ayarla
    const yerelTarih = new Date();
    yerelTarih.setMinutes(yerelTarih.getMinutes() - yerelTarih.getTimezoneOffset());
    const bugun = yerelTarih.toISOString().split('T')[0]; 
    
    const baslangicKutu = document.getElementById('ozetBaslangicTarihi');
    const bitisKutu = document.getElementById('ozetBitisTarihi');
    
    if(!baslangicKutu || !bitisKutu) return;

    // Her açılışta kutuları bugüne sıfırla
    baslangicKutu.value = bugun;
    bitisKutu.value = bugun;
    
    // =======================================================
    // 🚨 YETKİ KONTROLÜ (sessionStorage ve Harf Zırhlı)
    // =======================================================
    const hamYetki = sessionStorage.getItem('kullaniciYetki') || sessionStorage.getItem('yetki') || "";
    const isAdmin = hamYetki.toLowerCase() === 'admin';

    const bitisAlani = bitisKutu.parentElement; 
    const baslangicAlani = baslangicKutu.parentElement; 
    const baslangicLabel = baslangicAlani.querySelector('label');

    if (!isAdmin) {
        // --- PERSONEL MODU ---
        if (bitisAlani) bitisAlani.style.display = 'none'; // Bitiş tarihini gizle
        if (baslangicAlani) {
            baslangicAlani.className = 'col-md-10'; // Kutuyu genişlet
            if (baslangicLabel) baslangicLabel.innerText = 'Rapor Tarihi Seçin';
        }
        
        // Personel tarihi değiştirdiğinde bitişi de zorla aynı yap (Tek gün sınırı)
        baslangicKutu.onchange = function() {
            bitisKutu.value = this.value;
            gunlukOzetGetir();
        };
        // Bitiş kutusuna biri manuel müdahale ederse (F12 vs) diye onu da onchange'e bağladık
        bitisKutu.onchange = function() {
            this.value = baslangicKutu.value;
        };
    } else {
        // --- ADMİN MODU (Tam Yetki) ---
        if (bitisAlani) bitisAlani.style.display = 'block'; 
        if (baslangicAlani) {
            baslangicAlani.className = 'col-md-5';
            if (baslangicLabel) baslangicLabel.innerText = 'Başlangıç Tarihi';
        }
        
        // Admin her iki kutuyu da özgürce kullanır
        baslangicKutu.onchange = () => gunlukOzetGetir();
        bitisKutu.onchange = () => gunlukOzetGetir();
    }
    // =======================================================

    guvenliModalAc('gunlukOzetModal');
    gunlukOzetGetir();
};

window.gunlukOzetGetir = async function() {
    const bas = document.getElementById('ozetBaslangicTarihi').value;
    const bit = document.getElementById('ozetBitisTarihi').value;
    const tabloGovdesi = document.getElementById('gunlukOzetTabloGovdesi');
    
    tabloGovdesi.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-muted"><div class="spinner-border text-success mb-2"></div><br>Kasa hareketleri toplanıyor...</td></tr>';
    
    try {
        const [resHareket, resGider] = await Promise.all([
            fetch(`/api/gunluk-hareketler?baslangic=${bas}&bitis=${bit}`),
            fetch(`/api/gunluk-giderler?baslangic=${bas}&bitis=${bit}`)
        ]);

        const hareketler = await resHareket.json();
        const giderler = await resGider.json();
        
        tabloGovdesi.innerHTML = '';
        
        let toplamSatis = 0, toplamTahsilat = 0, toplamGider = 0;
        let nakitToplam = 0, kartToplam = 0, havaleToplam = 0;
        let birlesikListe = [];

        // 1. Müşteri Hareketleri
        if (Array.isArray(hareketler)) {
            hareketler.forEach(h => {
                const borc = parseFloat(h.BORÇ) || 0;
                const odeme = parseFloat(h.ÖDEME) || 0;
                toplamSatis += borc;
                toplamTahsilat += odeme;

                if (odeme > 0) {
                    const aciklamaText = (h.AÇIKLAMA || '').toLowerCase();
                    if (aciklamaText.includes('kart') || aciklamaText.includes('kredi')) kartToplam += odeme;
                    else if (aciklamaText.includes('havale') || aciklamaText.includes('eft')) havaleToplam += odeme;
                    else if (!aciklamaText.includes('iade')) nakitToplam += odeme;
                }

                birlesikListe.push({
                    tip: 'cari',
                    tarihRaw: h.TARİH || h.TARIH,
                    baslik: `${h.Adı || h.ADI || ''} ${h.Soyadı || h.SOYADI || ''}`.trim() || 'Müşteri',
                    altBaslik: '', // 🗑️ "Cari İşlem" yazısı kaldırıldı
                    aciklama: h.AÇIKLAMA || '',
                    notlar: h.notlar,
                    satisTutari: borc,
                    tahsilatTutari: odeme,
                    giderTutari: 0,
                    yapan: h.IslemiYapan || 'Sistem',
                    makbuzNo: h.MakbuzNo || ''
                });
            });
        }

        // 2. Giderleri havuza at
        if (Array.isArray(giderler)) {
            giderler.forEach(g => {
                let buGiderParaCikarirMi = (g.IslemTipi !== 'Mazot Çıkışı');
                let gTutar = buGiderParaCikarirMi ? (parseFloat(g.Tutar) || 0) : 0;
                toplamGider += gTutar;

                birlesikListe.push({
                    tip: 'gider',
                    tarihRaw: g.Tarih,
                    baslik: g.FirmaKisi || 'Gider Belgesi',
                    altBaslik: '<span class="badge bg-danger" style="font-size:0.6rem;">GİDER</span>', // Sadece Giderde uyarı
                    aciklama: g.Kategori + (!buGiderParaCikarirMi ? ' (Kasadan Çıkmaz)' : ''),
                    notlar: g.Aciklama,
                    satisTutari: 0,
                    tahsilatTutari: 0,
                    giderTutari: gTutar,
                    yapan: g.IslemiYapan || '-' 
                });
            });
        }

        birlesikListe.sort((a, b) => new Date(b.tarihRaw) - new Date(a.tarihRaw));

        if (birlesikListe.length === 0) {
            tabloGovdesi.innerHTML = '<tr><td colspan="6" class="text-center py-4 fw-bold text-danger">Bu tarih aralığında hareket yok.</td></tr>';
        } else {
            birlesikListe.forEach(islem => {
                const formatliTarih = tarihFormatla(islem.tarihRaw);
                const aciklamaMetni = islem.notlar 
                    ? `<div class="fw-bold text-dark text-truncate" style="max-width:180px;">${islem.aciklama}</div><small class="text-muted fst-italic" style="font-size:0.7rem;">${islem.notlar}</small>` 
                    : `<div class="fw-bold text-dark text-truncate" style="max-width:180px;">${islem.aciklama}</div>`;

                const isIade = islem.aciklama.toUpperCase().replace(/İ/g, 'I').includes('IADE');
                const satirClass = isIade ? 'align-middle table-warning cursor-pointer' : 'align-middle';
                const satirTiklama = isIade ? `onclick="iadeOnizlemeYazdir('${islem.makbuzNo}', ${islem.tahsilatTutari}, '${islem.tarihRaw}', '${encodeURIComponent(islem.aciklama)}')"` : '';

                tabloGovdesi.innerHTML += `
                    <tr class="${satirClass}" ${satirTiklama} style="height: 50px;">
                        <td class="ps-3">
                            <div class="text-dark fw-bold" style="font-size:0.85rem;">${formatliTarih.split(' ')[0]}</div>
                            <div class="text-muted" style="font-size: 0.7rem;"><i class="far fa-clock"></i> ${formatliTarih.split(' ')[1] || ''}</div>
                        </td>
                        <td>
                            <div class="fw-bold text-dark d-inline-block text-truncate" style="max-width: 280px;" title="${islem.baslik}">
                                ${islem.baslik}
                            </div>
                            ${islem.altBaslik ? '<br><small>' + islem.altBaslik + '</small>' : ''}
                        </td>
                        <td>${aciklamaMetni}</td>
                        <td class="text-center">
                            ${islem.yapan && islem.yapan !== 'Sistem' && islem.yapan !== '-' 
                                ? `<span class="badge bg-light text-secondary border px-2 py-1" style="font-size:0.7rem;">${islem.yapan.toUpperCase()}</span>` 
                                : '-'}
                        </td>
                        <td class="text-end fw-bold text-danger">
                            ${islem.satisTutari > 0 ? islem.satisTutari.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺' : '-'}
                        </td>
                        <td class="text-end fw-bold pe-3">
                            ${islem.tahsilatTutari > 0 ? '<span class="text-success">+' + islem.tahsilatTutari.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺</span>' : ''}
                            ${islem.giderTutari > 0 ? '<span class="text-danger">-' + islem.giderTutari.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺</span>' : ''}
                            ${islem.tahsilatTutari === 0 && islem.giderTutari === 0 ? '<span class="text-muted">-</span>' : ''}
                        </td>
                    </tr>
                `;
            });
        }

        // --- ALT TOPLAMLARI GÜNCELLE ---
        if(document.getElementById('ozetToplamSatis')) document.getElementById('ozetToplamSatis').innerText = toplamSatis.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
        if(document.getElementById('ozetToplamTahsilat')) document.getElementById('ozetToplamTahsilat').innerText = toplamTahsilat.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
        if(document.getElementById('ozetToplamGider')) document.getElementById('ozetToplamGider').innerText = toplamGider.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
        
        const netKasa = toplamTahsilat - toplamGider;
        if(document.getElementById('ozetNetKasa')) document.getElementById('ozetNetKasa').innerText = netKasa.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

        if (document.getElementById('ozetNakit')) document.getElementById('ozetNakit').innerText = nakitToplam.toLocaleString('tr-TR') + ' ₺';
        if (document.getElementById('ozetKart')) document.getElementById('ozetKart').innerText = kartToplam.toLocaleString('tr-TR') + ' ₺';
        if (document.getElementById('ozetHavale')) document.getElementById('ozetHavale').innerText = havaleToplam.toLocaleString('tr-TR') + ' ₺';

    } catch (error) {
        console.error("Kasa yükleme hatası:", error);
    }
};
// --- BOOTSTRAP GRİ EKRAN (BACKDROP) TAKILMA SORUNU KESİN ÇÖZÜMÜ ---
document.addEventListener('hidden.bs.modal', function () {
    // Ekranda açık olan başka bir modal (pencere) kalmadıysa temizlik yap
    if (document.querySelectorAll('.modal.show').length === 0) {
        // Vücuttaki kilitleri aç
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        
        // Sahnede unutulan tüm gri örtüleri (backdrop) zorla sil
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
    }
});

// 1. GEÇMİŞİ YÜKLEYEN FONKSİYON (Hata veren kısım burasıydı)
// --- DÜZENLEME VE GEÇMİŞ FONKSİYONLARI (TEMİZ HALİ) ---

// 2. GEÇMİŞİ YÜKLEYEN FONKSİYON
// 1. GÜNCELLENMİŞ GEÇMİŞ YÜKLEME FONKSİYONU (Silme butonu eklendi)

// 2. YENİ EKLENECEK SİLME FONKSİYONU

// 3. KAYDETME FONKSİYONU (SADECE 1 TANE OLACAK)
// --- İŞLEM DÜZENLEME FONKSİYONLARI ---

// 1. Modalı Açan ve Geçmişi Çeken Fonksiyon
// --- İŞLEM DÜZENLEME FONKSİYONLARI ---

// 1. Modalı Açan ve Geçmişi Çeken Fonksiyon
// =========================================================
// --- İŞLEM DÜZENLEME VE GEÇMİŞ FONKSİYONLARI ---
// =========================================================

// 6. parametre olarak musteriAdiEncoded eklendi
window.islemDuzenleAc = async function(id, kalanMiktar, toplamMiktar, teslimDurumu, notlarEncoded, musteriAdiEncoded = '') {
    
    // --- AKILLI İSİM BULUCU ---
    let ad = "";
    if (musteriAdiEncoded) {
        // Eğer Sevkiyat listesinden geliyorsa özel ismi kullan
        ad = decodeURIComponent(musteriAdiEncoded).trim();
    } else {
        // Eğer Müşteri Ekstresinden geliyorsa hafızadaki ismi kullan
        ad = (aktifMusteriAd || "").replace(/null/g, '').trim();
    }

    const adKutusu = document.getElementById('duzenleMusteriAd');
    if(adKutusu) adKutusu.innerText = ad || "-";
    // --------------------------

    document.getElementById('duzenleIslemId').value = id;
    document.getElementById('duzenleToplamMiktar').value = toplamMiktar;
    
 const teslimInput = document.getElementById('duzenleTeslimEdilecek');
    if (teslimInput) teslimInput.value = kalanMiktar || 0;
    
    const salter = document.getElementById('duzenleTeslimatDurumu');
    if (salter) salter.checked = (teslimDurumu === 'Bekliyor');

    const bilgiEl = document.getElementById('teslimatLimitBilgi');
    if (bilgiEl) bilgiEl.innerHTML = `Toplam Satış: ${toplamMiktar} | <b class="text-danger">Güncel Kalan: ${kalanMiktar}</b>`;
    
    document.getElementById('duzenleIslemNotu').value = decodeURIComponent(notlarEncoded).replace(/null/g, '');
    
    guvenliModalAc('islemDuzenleModal');

    gecmisiYukle(id); 
};
async function gecmisiYukle(hareketId) {
    const tbody = document.getElementById('teslimatGecmisiGovdesi');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Yükleniyor...</td></tr>';

    try {
        const response = await fetch(`/api/teslimat-gecmisi/${hareketId}`);
        const gecmis = await response.json();
        tbody.innerHTML = '';

        if (!gecmis || gecmis.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Geçmiş kayıt yok.</td></tr>';
            return;
        }

        gecmis.forEach(g => {
            const tarih = tarihFormatla(g.Tarih);
            tbody.innerHTML += `
                <tr>
                    <td class="align-middle">${tarih}</td>
                    <td class="text-center align-middle"><span class="badge bg-success fs-6">${g.YikilanMiktar}</span></td>
                    <td class="align-middle">
                        ${g.Aciklama || 'Düzenleme'}
                        <button class="btn btn-sm btn-outline-danger float-end py-0 px-2" onclick="gecmisKayitSil(${g.ID}, ${hareketId})" title="Sil ve İade Et">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-danger text-center">Çekilemedi.</td></tr>';
    }
}

// window.gecmisKayitSil = async function(gecmisId, hareketId) {
//     if (!confirm("Bu teslimatı iptal edip miktarı müşteriye iade etmek istediğinize emin misiniz?")) return;

//     try {
//         const response = await fetch(`/api/teslimat-gecmisi/${gecmisId}`, { method: 'DELETE' });
//         const result = await response.json();

//         if (response.ok && result.success) {
//             alert("🗑️ Kayıt silindi ve kömür müşteriye iade edildi.");
//             const modalEl = document.getElementById('islemDuzenleModal');
//             bootstrap.Modal.getInstance(modalEl).hide();

//             const tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '';
//             if (typeof musteriDetayGoster === 'function') musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
//         } else {
//             alert("❌ Hata: " + (result.hata || "Silinemedi"));
//         }
//     } catch (err) {
//         alert("⚠️ Bağlantı hatası!");
//     }
// };

// 3. SİLME FONKSİYONU (Hatasız Yenileme Eklendi)
window.gecmisKayitSil = async function(gecmisId, hareketId) {
    if (!confirm("Bu teslimatı iptal edip miktarı müşteriye iade etmek istediğinize emin misiniz?")) return;

    try {
        const response = await fetch(`/api/teslimat-gecmisi/${gecmisId}`, { method: 'DELETE' });
        const result = await response.json();

        if (response.ok && result.success) {
            alert("🗑️ Kayıt silindi ve kömür müşteriye iade edildi.");
            
            const modalEl = document.getElementById('islemDuzenleModal');
            const modalInst = bootstrap.Modal.getInstance(modalEl);
            if (modalInst) modalInst.hide();

            // --- AKILLI YENİLEME SİSTEMİ ---
            // Şoför listesi açıksa onu yenile
            if (typeof bekleyenTeslimatlariYukle === 'function') bekleyenTeslimatlariYukle();
            
            // Müşteri ekranı açıksa onu yenile (Hata vermemesi için korumaya alındı)
            if (typeof aktifMusteriId !== 'undefined' && aktifMusteriId !== null) {
                const tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '';
                if (typeof musteriDetayGoster === 'function') musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
            }

        } else {
            alert("❌ Hata: " + (result.hata || "Silinemedi"));
        }
    } catch (err) {
        alert("⚠️ Bağlantı hatası!");
    }
};

// 4. KAYDETME FONKSİYONU (Hatasız Yenileme Eklendi)
window.islemGuncelleKaydet = async function() {
    const elId = document.getElementById('duzenleIslemId');
    const elMiktar = document.getElementById('duzenleTeslimEdilecek');
    const elNot = document.getElementById('duzenleIslemNotu');
    const elSalter = document.getElementById('duzenleTeslimatDurumu');

    if (!elId || !elMiktar) return;

    const id = elId.value;
    const miktar = parseFloat(elMiktar.value) || 0; 
    const notlar = elNot ? elNot.value : '';
    const durum = (elSalter && elSalter.checked) ? 'Bekliyor' : 'Teslim Edildi';

    if (miktar < 0) {
        alert("Miktar sıfırdan küçük olamaz!");
        return;
    }

    const kaydetBtn = document.querySelector('#islemDuzenleModal .btn-warning');
    if (kaydetBtn) { kaydetBtn.disabled = true; kaydetBtn.innerHTML = 'Kaydediliyor...'; }

    try {
        const response = await fetch('/api/islem-guncelle/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teslim_edilen_miktar: miktar, notlar: notlar, durum: durum })
        });

        const resultData = await response.json();

        if (response.ok) {
            alert("✅ İşlem başarıyla kaydedildi!");
            
            const modalEl = document.getElementById('islemDuzenleModal');
            const modalInst = bootstrap.Modal.getInstance(modalEl);
            if (modalInst) modalInst.hide();

            // --- AKILLI YENİLEME SİSTEMİ ---
            // Şoför listesi açıksa onu yenile
            if (typeof bekleyenTeslimatlariYukle === 'function') bekleyenTeslimatlariYukle();
            
            // Müşteri ekranı açıksa onu yenile (Hata vermemesi için korumaya alındı)
            if (typeof aktifMusteriId !== 'undefined' && aktifMusteriId !== null) {
                const tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '';
                if (typeof musteriDetayGoster === 'function') musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
            }

        } else {
            alert("❌ " + (resultData.hata || "İşlem yapılamadı."));
        }
    } catch (error) {
        alert("⚠️ Bağlantı hatası!");
    } finally {
        if (kaydetBtn) { kaydetBtn.disabled = false; kaydetBtn.innerHTML = '<i class="fas fa-save me-1"></i> Değişiklikleri Kaydet'; }
    }
};

// =================================================================
// TAKSİT PLANI (ÖNE ÇIKARMA KİLİT KIRICI EKLENDİ)
// =================================================================
// =================================================================
// TAKSİT PLANI (SIRA KİLİTLİ VERSİYON)
// =================================================================
window.musteriTaksitleriniAc = async function() {
    const govde = document.getElementById('taksitPlaniGovdesi');
    
    document.getElementById('taksitModalBaslik').innerHTML = `
        <i class="fas fa-file-invoice-dollar me-2"></i> ${aktifMusteriAd} - Ödeme Planı 
        <button class="btn btn-sm btn-danger ms-3 shadow-sm" onclick="taksitPlaniTumunuSil(${aktifMusteriId})">
            <i class="fas fa-broom me-1"></i> Temizle
        </button>`;

    govde.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-warning"></div></td></tr>';
    
    guvenliModalAc('taksitPlaniModal');

    try {
        const res = await fetch(`/api/musteri-taksitler/${aktifMusteriId}`);
        const taksitler = await res.json();
        govde.innerHTML = '';

        if (taksitler.length === 0) {
            govde.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Kayıt bulunamadı.</td></tr>';
            return;
        }

        // --- SİHİRLİ BAYRAK (Sıradaki taksiti bulmak için) ---
        let siradakiOdemeBulundu = false; 

        // 🚨 YENİ KALKAN: Toplam borcu hesaplamak için kumbaramız
        window.guncelToplamTaksitBorcu = 0; 

        taksitler.forEach(t => {
            const hamTarih = t.TARIH || t.TARİH || t.ODEMETARİHİ || t.VADETARİHİ;
            const vade = hamTarih ? tarihFormatla(hamTarih, true) : '-';
            
            // MATEMATİKSEL KONTROL
            let orjinalMiktar = parseFloat(t.MIKTAR) || 0;
            let odenenKisim = parseFloat(t.ODEMELER) || 0;
            let kalanBorc = orjinalMiktar - odenenKisim;

            // 🚨 Sadece ödenmemişleri (DURUM = 0) toplam borca ekle
            if (t.DURUM == '0') {
                window.guncelToplamTaksitBorcu += kalanBorc;
            }

            const aciklamaGonder = (t.AÇIKLAMA || '').replace(/['"]/g, '').trim(); 
            let durumBadge = '';
            let islemButon = '';
            let tutarGorseli = '';

            // =========================================================
            // 1. DURUM: TAMAMI ÖDENMİŞ
            // =========================================================
            if (t.DURUM == '1' || kalanBorc <= 0) {
                durumBadge = '<span class="badge bg-success px-3">ÖDENDİ</span>';
                islemButon = `<i class="fas fa-check-double text-success me-2" title="Ödendi"></i>`;
                
                tutarGorseli = `
                    <div class="text-center">
                        <span class="fw-bold text-success">${orjinalMiktar.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</span>
                    </div>`;
            } 
            // =========================================================
            // 2. DURUM: KISMİ ÖDENMİŞ VEYA HİÇ ÖDENMEMİŞ (BEKLİYOR)
            // =========================================================
            else {
                durumBadge = '<span class="badge bg-danger px-3">BEKLİYOR</span>';

                // Kısmi ödeme yapıldıysa havuz görselini bas
                if (odenenKisim > 0) {
                    tutarGorseli = `
                        <div class="text-end" style="line-height: 1.2;">
                            <div class="text-muted text-decoration-line-through" style="font-size: 0.75rem;">${orjinalMiktar.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</div>
                            <div class="text-success" style="font-size: 0.8rem;"><i class="fas fa-arrow-down"></i> ${odenenKisim.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺ </div>
                            <div class="fw-bold text-danger fs-6">${kalanBorc.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</div>
                            <div class="text-danger" style="font-size: 0.65rem;">(Kalan)</div>
                        </div>`;
                } else {
                    tutarGorseli = `
                        <div class="text-end">
                            <span class="fw-bold text-primary">${orjinalMiktar.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</span>
                        </div>`;
                }

                // EĞER BAYRAK HALA FALSE İSE (İlk ödenmemiş taksit buysa)
                if (!siradakiOdemeBulundu) {
                    // Butona kalan borcu gönderiyoruz
                    islemButon = `<button class="btn btn-sm btn-success fw-bold me-1 shadow-sm" onclick="taksitOdemeTuruSec(${t.Kimlik}, ${kalanBorc}, '${aciklamaGonder}')"><i class="fas fa-check"></i> Öde</button>`;
                    siradakiOdemeBulundu = true; // İlkini bulduk, sonrakileri kilitle!
                } 
                // İlk taksit değilse
                else {
                    islemButon = `<button class="btn btn-sm btn-secondary fw-bold me-1 opacity-50" disabled title="Önce önceki taksiti ödemelisiniz!"><i class="fas fa-lock"></i> Kilitli</button>`;
                }
            }

            const silButon = `<button class="btn btn-sm btn-outline-danger shadow-sm" onclick="taksitPlaniSil(${t.Kimlik})"><i class="fas fa-trash"></i></button>`;

            let personelHtml = '';
            let yapanPersonel = t.IslemiYapan || t.islemiyapan || '';
            if (yapanPersonel && yapanPersonel !== 'null' && yapanPersonel !== 'Sistem') {
                personelHtml = `
                    <div style="font-size: 0.65rem;" class="text-muted mt-1">
                        <i class="fas fa-user-edit text-info opacity-75"></i> OPR: ${yapanPersonel.toUpperCase()}
                    </div>`;
            }

            govde.innerHTML += `
                <tr class="align-middle">
                    <td class="fw-bold">${vade}</td>
                    <td>
                        <div class="fw-bold text-dark">${t.AÇIKLAMA || '-'}</div>
                        ${personelHtml}
                    </td>
                    <td class="align-middle" style="min-width: 90px;">${tutarGorseli}</td>
                    <td class="text-center">${durumBadge}</td>
                    <td class="text-center" style="white-space: nowrap;">${islemButon}${silButon}</td>
                </tr>`;
        });
    } catch (err) { 
        console.error(err);
        govde.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Hata oluştu!</td></tr>'; 
    }
};
// ==========================================================
// İŞTE YENİ EKLENEN SİLME MOTORUNU BURAYA YAPIŞTIRIYORUZ
// ==========================================================
window.taksitPlaniSil = async function(taksitId) {
    if (!confirm("⚠️ Bu taksiti (ödeme planını) tamamen silmek istediğinize emin misiniz?")) return;

    try {
        const response = await fetch(`/api/taksit-sil/${taksitId}`, { 
            method: 'DELETE' 
        });

        if (response.ok) {
            // Başarılıysa üstteki fonksiyonu tekrar çağırıp listeyi tazeliyoruz
            musteriTaksitleriniAc(); 
        } else {
            const data = await response.json();
            alert("❌ Hata: " + (data.hata || "Taksit silinemedi."));
        }
    } catch (error) {
        console.error("Taksit silme hatası:", error);
        alert("⚠️ Sunucu bağlantısı kurulamadı!");
    }
};

window.hizliOdemeTuruDegisti = function() {
    const turKutusu = document.getElementById('hizliSatisOdemeTuru');
    if (!turKutusu) return; // Sayfada bu kutu yoksa hiç çalışma, çökme!

    const tur = turKutusu.value;
    const tDiv = document.getElementById('hizliTaksitAlani');
    const vDiv = document.getElementById('hizliVadeAlani');

    // Kutular varsa gizle
    if (tDiv) tDiv.classList.add('d-none');
    if (vDiv) vDiv.classList.add('d-none');

    // Seçime göre göster
    if (tur === 'Taksitli' && tDiv) {
        tDiv.classList.remove('d-none');
    } else if (tur === 'Vadeli' && vDiv) {
        vDiv.classList.remove('d-none');
        const vadeTarihKutusu = document.getElementById('hizliSatisVadeTarihi');
        if (vadeTarihKutusu) vadeTarihKutusu.valueAsDate = new Date();
    }
};
window.borcuTaksitlendirAc = async function() { 

    // --- Müşteri Adını Modalın Tepesine Yazdırma ---
    let ad = (aktifMusteriAd || "").replace(/null/g, '').trim();
    const adKutusu = document.getElementById('taksitMusteriAd');
    if(adKutusu) adKutusu.innerText = ad || "İsimsiz Müşteri";
    // -----------------------------------------------------

    // 1. Bakiyeyi oku ve sayıya çevir
    const bakiyeMetni = document.getElementById('detayKalanBakiye').innerText;
    const bakiye = parseFloat(bakiyeMetni.replace(' ₺', '').replace(/\./g, '').replace(',', '.'));
    
    // 2. FREN: Eğer borç yoksa veya müşteri alacaklıysa modalı açma!
    if (bakiye <= 0) {
        alert("⚠️ Bu müşterinin borcu yok. Borcu olmayan birine taksit planı yapılamaz!");
        return;
    }

    // =======================================================
    // 🚨 KONSOLİDASYON (BİRLEŞTİRME) RADARI
    // =======================================================
    try {
        const res = await fetch(`/api/musteri-taksitler/${aktifMusteriId}`);
        const taksitler = await res.json();
        
        // Ödenmemiş taksiti var mı diye bakıyoruz
        const odenmemisVarMi = taksitler.some(t => t.DURUM == '0');

        if (odenmemisVarMi) {
            const onay = confirm(`⚠️ DİKKAT: MÜŞTERİNİN DEVAM EDEN TAKSİT PLANI VAR!\n\nBu müşterinin halihazırda ödenmemiş taksitleri bulunuyor. Yeni bir plan yaparsanız:\n\n1. Eski taksit planı iptal edilip, havuzdaki ödenmemiş kayıtlar silinecek.\n2. Mevcut toplam borç (${bakiye.toLocaleString('tr-TR')} ₺) üzerinden yepyeni ve tek bir plan oluşturulacak.\n\nBunu onaylıyor musunuz?`);
            
            if (!onay) return; // Personel "İptal" derse işlemi durdur ve modalı açma
        }
    } catch(e) { 
        console.error("Taksit kontrol hatası:", e); 
    }
    // =======================================================

    document.getElementById('yapilandirmaBakiyesi').innerText = bakiye.toLocaleString('tr-TR');
    document.getElementById('taksitlendirilecekTutar').value = bakiye;
    document.getElementById('yapiBaslangicTarihi').valueAsDate = new Date();

    // Evrensel Maymuncuk ile güvenli açılış
    guvenliModalAc('borcSatisModal');
};

window.borcYapilandirKaydet = async function() {
    const tutar = parseFloat(document.getElementById('taksitlendirilecekTutar').value);
    const taksit = parseInt(document.getElementById('yapiTaksitSayisi').value);
    const tarih = document.getElementById('yapiBaslangicTarihi').value;

    if (!tutar || !tarih) { alert("Lütfen tutar ve tarih giriniz!"); return; }

    // =========================================================
    // 👤 PERSONEL ZIRHI (SİSTEM YAZISINI BİTİREN KISIM)
    // =========================================================
    let aktifPersonel = localStorage.getItem('aktifKullanici');
    if (!aktifPersonel || aktifPersonel === 'Sistem' || aktifPersonel === 'null') {
        const navbarAd = document.getElementById('navbarKullaniciAd')?.innerText;
        aktifPersonel = (navbarAd && navbarAd !== 'Yükleniyor...') ? navbarAd : 'SİSTEM KAYDI';
    }

    try {
        const res = await fetch('/api/borc-taksitlendir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musteri_id: aktifMusteriId,
                toplam_tutar: tutar,
                taksit_sayisi: taksit,
                baslangic_tarihi: tarih,
                islemiYapan: aktifPersonel // 🚨 İMZA MÜHÜRLENDİ
            })
        });

        if (!res.ok) {
            const hataData = await res.json();
            alert(hataData.hata); 
            return; 
        }

        // Başarı mesajında da kimin yaptığını görelim
        alert(`✅ Ödeme planı başarıyla oluşturuldu.\nİşlemi Yapan: ${aktifPersonel}`);
        
        // İşlem bitince taksit planı ekranını aç
        musteriTaksitleriniAc(); 

    } catch (err) {
        console.error("Hata:", err);
        alert("⚠️ Sunucuya bağlanırken bir hata oluştu!");
    }
};

window.taksitPlaniTumunuSil = async function(kisiId) {
    // Çift onay alalım ki kaza çıkmasın
    const onay = confirm(`⚠️ DİKKAT: ${aktifMusteriAd} isimli müşterinin TÜM ödeme planı silinecek! \n\nEmin misiniz?`);
    
    if (onay) {
        try {
            const res = await fetch(`/api/taksit-plani-tumunu-sil/${kisiId}`, { method: 'DELETE' });
            if (res.ok) {
                alert("🧹 Liste tertemiz yapıldı.");
                
                // --- İŞTE ÇÖZÜM BURADA ---
                // 1. Zaten açık olan Taksit Planı modalını zorla kapatıyoruz ki gri örtü gitsin
                const tModalEl = document.getElementById('taksitPlaniModal');
                if (tModalEl) {
                    let inst = bootstrap.Modal.getInstance(tModalEl);
                    if (inst) inst.hide();
                }

                // 2. Yarım saniye bekleyip, ekran temizlendikten sonra listeyi tekrar çağırıyoruz
                setTimeout(() => {
                    musteriTaksitleriniAc(); // Şimdi tertemiz ve boş haliyle açılacak
                }, 400);
                
            }
        } catch (err) {
            alert("⚠️ Temizleme sırasında bir hata oluştu!");
        }
    }
};
window.vadesiGelenleriGetir = async function() {
    const govde = document.getElementById('raporTabloGovdesi');
    const modalHeader = document.querySelector('#raporModal .modal-header');
    
    // FORM MAKYAJI: Simsiyah arka plan ve beyaz yazılar/çarpı
    modalHeader.className = 'modal-header border-0 py-3 d-flex justify-content-between align-items-center';
    modalHeader.style.backgroundColor = '#dc3545'; 
    
    modalHeader.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="bg-danger text-white rounded-circle p-2 me-3 shadow-sm d-flex align-items-center justify-content-center" style="width: 35px; height: 35px;">
                <i class="fas fa-bell fs-5"></i>
            </div>
            <div>
                <h5 class="mb-0 fw-bold text-white" style="letter-spacing: 0.5px;">Vadesi Gelen ve Geçen Ödemeler</h5>
            </div>
        </div>
        <button type="button" class="btn-close btn-close-white shadow-none" data-bs-dismiss="modal" aria-label="Close"></button>
    `;

    // Sütun sayısını 5'e düşürdük
    govde.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-danger spinner-border-sm"></div> <span class="text-muted ms-2">Sorgulanıyor...</span></td></tr>';
    
    guvenliModalAc('raporModal');

    try {
        const res = await fetch('/api/rapor-vadesi-gelenler');
        const veriler = await res.json();
        
        let htmlBuffer = '';

        if (veriler.length === 0) {
            govde.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-success fw-bold"><i class="fas fa-check-double fs-4 d-block mb-2"></i> Harika! Vadesi geçmiş hiç ödeme bulunmuyor.</td></tr>';
            if(document.getElementById('vadeKayitSayisi')) document.getElementById('vadeKayitSayisi').innerText = "0";
            if(document.getElementById('raporGenelToplam')) document.getElementById('raporGenelToplam').innerText = "0,00";
            return;
        }

        let genelToplamVade = 0;

        veriler.forEach(r => {
            const hamTarih = r.TARIH || r.TARİH || r.ODEMETARİHİ || r.VADETARİHİ;
            const vade = hamTarih ? tarihFormatla(hamTarih, true) : 'Tarih Yok';
            const gecikme = r.GecikmeGunu;
            const renk = gecikme > 0 ? 'text-danger' : 'text-warning text-dark';
            const uyariMetni = gecikme > 0 ? `${gecikme} gün geçti` : `Ödeme Günü Bugün`;

            const miktar = parseFloat(r.MIKTAR) || 0;
            genelToplamVade += miktar;

            let guvenliAd = (r.Adı || 'İsimsiz').replace(/'/g, "\\'");
            let guvenliTel = (r.CEPTEL || '-').replace(/'/g, "\\'");

            // SİHİRLİ KISIM: Çift tıklama ve arama class'ı (vadesi-row) eklendi. paddingler kısıldı.
            htmlBuffer += `
                <tr class="align-middle table-hover-custom vadesi-row" 
                    style="border-left: 4px solid ${gecikme > 0 ? '#dc3545' : '#ffc107'}; cursor: pointer; transition: background-color 0.2s;"
                    ondblclick="vadeDetayaGit(${r.MusteriID}, '${guvenliAd}', '${guvenliTel}')"
                    title="Detaylar için çift tıklayın">
                    
                    <td class="ps-3 py-2">
                        <div class="fw-bold text-dark">${r.Adı}</div>
                        <div class="small text-muted"><i class="fas fa-phone-alt opacity-50 me-1 text-primary"></i> ${r.CEPTEL || '-'}</div>
                    </td>
                    
                    <td class="${renk} fw-bold py-2" style="font-size:0.9rem;">
                        ${vade}<br>
                        <small class="text-muted fw-normal" style="font-size:0.75rem;">${uyariMetni}</small>
                    </td>
                    
                    <td class="small text-muted py-2" style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${r.AÇIKLAMA || '-'}
                    </td>
                    
                    <td class="text-end fw-bolder text-dark py-2" style="font-size: 1.05rem;">
                        ${miktar.toLocaleString('tr-TR')} ₺
                    </td>
                    
                    <td class="text-center pe-3 py-2">
                        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 rounded-pill px-3 py-1" style="font-size:0.7rem;">BEKLİYOR</span>
                    </td>
                </tr>
            `;
        });

        govde.innerHTML = htmlBuffer;
        
        // EKRANIN TEPESİNE YAZDIR
        if(document.getElementById('vadeKayitSayisi')) document.getElementById('vadeKayitSayisi').innerText = veriler.length;
        if(document.getElementById('raporGenelToplam')) document.getElementById('raporGenelToplam').innerText = genelToplamVade.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    } catch (err) {
        govde.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Rapor yüklenemedi! Sunucu bağlantısını kontrol edin.</td></tr>';
    }
};

// --- YENİ VADE ARAMA MOTORU ---
window.vadeAra = function() {
    const input = document.getElementById('raporAramaKutusu');
    if(!input) return;
    
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const rows = document.querySelectorAll('.vadesi-row');
    
    let gorunurSayisi = 0;

    rows.forEach(row => {
        const text = row.innerText.toLocaleLowerCase('tr-TR');
        if (text.includes(filter)) {
            row.style.display = "";
            gorunurSayisi++;
        } else {
            row.style.display = "none";
        }
    });

    const kayitKutusu = document.getElementById('vadeKayitSayisi');
    if(kayitKutusu) kayitKutusu.innerText = gorunurSayisi;
};
// Rapor ekranını kapatıp detay ekranını en öne getiren fonksiyon
window.vadeDetayaGit = function(id, ad, tel) {
    // 1. Önce rapor modalını (vade listesini) zorla kapat
    modalZorlaKapat('raporModal');

    // 2. Çok kısa bir süre bekle (modallar arası çakışmayı önlemek için)
    setTimeout(() => {
        // 3. Mevcut detay açma fonksiyonunu çağır (Artık meydan boş, en öne açılacak)
        musteriDetayGoster(id, ad, tel);
    }, 300);
};

// --- YENİ: VADE LİSTESİ ARAMA FONKSİYONU ---
window.vadeFiltrele = function() {
    const input = document.getElementById('vadeAramaKutusu');
    if(!input) return;
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const rows = document.querySelectorAll('.vadesi-row');

    rows.forEach(row => {
        const text = row.innerText.toLocaleLowerCase('tr-TR');
        row.style.display = text.includes(filter) ? "" : "none";
    });
};
// MODALI AÇAN FONKSİYON
// --- MÜŞTERİ DÜZENLEME MODALINI AÇAN FONKSİYON (KİLİT KIRICI VERSİYON) ---
window.musteriDuzenleAc = async function(ad, tel, otomatikMi = false, mId = null) { 
    document.getElementById('duzenleAd').value = ad || "";
    
    const gecerliId = mId || (typeof aktifMusteriId !== 'undefined' ? aktifMusteriId : null);

    // 📱 AKILLI TELEFON KUTUSU
    const telKutusu = document.getElementById('duzenleTelefon');
    if (telKutusu) {
        let temizTel = (tel === '-' || tel === 'null' || !tel) ? '' : String(tel).replace(/[^0-9]/g, '');
        if(temizTel.startsWith('0')) temizTel = temizTel.substring(1);
        telKutusu.value = temizTel.substring(0, 10);
        
        telKutusu.oninput = function() {
            let val = this.value.replace(/[^0-9]/g, '');
            if(val.startsWith('0')) val = val.substring(1);
            this.value = val.substring(0, 10);
        };
    }
    
    // 🔠 AKILLI KUTULAR (GARANTİLİ VERİ ÇEKME MOTORU)
    const unvanKutusu = document.getElementById('duzenleUnvan');
    const adresKutusu = document.getElementById('duzenleAdres');
    const ilceKutusu = document.getElementById('duzenleIlce');

    let unvanDeger = (typeof aktifMusteriUnvan !== 'undefined' && aktifMusteriUnvan && aktifMusteriUnvan !== 'null') ? aktifMusteriUnvan : '';
    let adresDeger = (typeof window.aktifMusteriAdres !== 'undefined' && window.aktifMusteriAdres && window.aktifMusteriAdres !== 'null') ? window.aktifMusteriAdres : '';
    
    // İlçe için varsayılan değer "Sarayönü", mahalle için boş
    let ilceDeger = (typeof window.aktifMusteriIlce !== 'undefined' && window.aktifMusteriIlce && window.aktifMusteriIlce !== 'null') ? window.aktifMusteriIlce : 'Sarayönü';
    let mahalleDeger = (typeof window.aktifMusteriMahalle !== 'undefined' && window.aktifMusteriMahalle && window.aktifMusteriMahalle !== 'null') ? window.aktifMusteriMahalle : '';

    // 🚨 EĞER HAFIZADA BİLGİ EKSİKSE, VERİTABANINDAN ZORLA ÇEKİYORUZ!
    if ((!unvanDeger || !adresDeger) && gecerliId) {
        try {
            const mRes = await fetch('/api/musteriler');
            if (mRes.ok) {
                const mList = await mRes.json();
                const gercekMusteri = mList.find(x => x.Kimlik == gecerliId || x.KİMLİK == gecerliId);
                
                if (gercekMusteri) {
                    if (!unvanDeger && (gercekMusteri.Unvan || gercekMusteri.UNVAN || gercekMusteri.unvan)) {
                        unvanDeger = gercekMusteri.Unvan || gercekMusteri.UNVAN || gercekMusteri.unvan;
                        if (typeof aktifMusteriUnvan !== 'undefined') aktifMusteriUnvan = unvanDeger; 
                    }
                    if (!adresDeger && (gercekMusteri.Adres || gercekMusteri.ADRES || gercekMusteri.adres)) {
                        adresDeger = gercekMusteri.Adres || gercekMusteri.ADRES || gercekMusteri.adres;
                        window.aktifMusteriAdres = adresDeger; 
                    }
                    // 🚨 VERİTABANINDAN İLÇE VE MAHALLEYİ OKU
                    if (gercekMusteri.Ilce || gercekMusteri.ILCE || gercekMusteri.ilce) {
                        ilceDeger = gercekMusteri.Ilce || gercekMusteri.ILCE || gercekMusteri.ilce;
                        window.aktifMusteriIlce = ilceDeger;
                    }
                    if (gercekMusteri.Mahalle || gercekMusteri.MAHALLE || gercekMusteri.mahalle) {
                        mahalleDeger = gercekMusteri.Mahalle || gercekMusteri.MAHALLE || gercekMusteri.mahalle;
                        window.aktifMusteriMahalle = mahalleDeger;
                    }
                }
            }
        } catch (e) { console.error("Veriler zorla çekilemedi:", e); }
    }

    // Ünvanı Kutuya Bas
    if (unvanKutusu) {
        unvanKutusu.value = unvanDeger.trim();
        unvanKutusu.oninput = function() {
            this.value = this.value.toLocaleUpperCase('tr-TR');
        };
    }

    if (adresKutusu) adresKutusu.value = adresDeger.trim();
    if (typeof window.konyaAdresiniFormaYukle === 'function') {
        window.konyaAdresiniFormaYukle('duzenle', ilceDeger.trim(), mahalleDeger.trim());
    } else if (ilceKutusu) ilceKutusu.value = ilceDeger.trim();
    
    // --- OTOMATİK AÇILIŞ MODU MAKYAJI ---
    const vazgecBtn = document.querySelector('#musteriDuzenleModal .btn-secondary, #musteriDuzenleModal .btn-outline-secondary'); 
    
    if (otomatikMi) {
        if (unvanKutusu) {
            unvanKutusu.placeholder = "LÜTFEN GERÇEK AD SOYADI GİRİNİZ";
            if (!unvanKutusu.value) {
                unvanKutusu.classList.add('border-danger', 'border-2'); 
            } else {
                unvanKutusu.classList.remove('border-danger', 'border-2');
            }
        }
        if (vazgecBtn) {
            vazgecBtn.innerHTML = '<i class="fas fa-forward"></i> Atla (Adını Bilmiyorum)';
            vazgecBtn.onclick = function() {
                if (gecerliId) {
                    window.atlananMusteriler = window.atlananMusteriler || new Set();
                    window.atlananMusteriler.add(gecerliId); 
                }
            };
        }
    } else {
        if (unvanKutusu) {
            unvanKutusu.placeholder = "Örn: RAMAZAN BAĞIŞ";
            unvanKutusu.classList.remove('border-danger', 'border-2');
        }
        if (vazgecBtn) {
            vazgecBtn.innerText = "Vazgeç";
            vazgecBtn.onclick = null; 
        }
    }

    // Modalı Göster
    const modalEl = document.getElementById('musteriDuzenleModal');
    let modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modalInstance.show();

    // Gri Ekran Kilit Kırıcı
    setTimeout(() => {
        modalEl.style.setProperty('z-index', '1080', 'important');
        const backdrops = document.querySelectorAll('.modal-backdrop');
        if (backdrops.length > 1) {
            backdrops[backdrops.length - 1].style.setProperty('z-index', '1079', 'important');
        }
    }, 150);
};
// KAYDEDEN FONKSİYON
window.musteriGuncelleKaydet = async function() {
    const adInput = document.getElementById('duzenleAd').value;
    const telInput = document.getElementById('duzenleTelefon').value.trim();
    const unvanInput = document.getElementById('duzenleUnvan').value.trim();
    const adresInput = document.getElementById('duzenleAdres').value.trim();
    
    // 🚨 YENİ EKLENEN KUTULARI BURADA OKUYORUZ
    const km = typeof window.konyaMahalleVeIlceOku === 'function' ? window.konyaMahalleVeIlceOku('duzenle') : {};
    const ilceInput = (km.ilce || '').trim();
    const mahalleInput = (km.mahalle || '').trim();

    if (telInput && telInput.length !== 10 && telInput.length > 0) {
        alert("⚠️ Lütfen telefon numarasını başında '0' olmadan tam 10 hane olarak giriniz!");
        return;
    }

    // 🚨 KONSOL RADARI: Giden paketi kontrol edelim
    console.log("✈️ Gönderilen Paket:", { ad: adInput, telefon: telInput, unvan: unvanInput, adres: adresInput, ilce: ilceInput, mahalle: mahalleInput });

    try {
        const res = await fetch(`/api/musteri-guncelle/${aktifMusteriId}`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                ad: adInput, 
                telefon: telInput, 
                unvan: unvanInput,
                adres: adresInput,
                ilce: ilceInput,     // 🚨 PAKETE EKLENDİ
                mahalle: mahalleInput // 🚨 PAKETE EKLENDİ
            })
        });

        if (res.ok) {
            aktifMusteriUnvan = unvanInput; 

            const duzenleModalEl = document.getElementById('musteriDuzenleModal');
            if (duzenleModalEl) {
                const duzenleModal = bootstrap.Modal.getInstance(duzenleModalEl);
                if (duzenleModal) duzenleModal.hide();
            }

            setTimeout(() => {
                const backdrops = document.querySelectorAll('.modal-backdrop');
                if (backdrops.length > 1) {
                    backdrops[backdrops.length - 1].remove();
                }
                document.body.classList.add('modal-open'); 

                musteriDetayGoster(aktifMusteriId, adInput, telInput);
                if (typeof cariListesiniYukle === 'function') cariListesiniYukle();

            }, 350);

        } else {
            alert("Sunucu bir hata döndürdü!");
        }
    } catch (err) {
        console.error("❌ Hata:", err);
    }
};
// --- 1. BORÇLU MÜŞTERİLERİ GETİR (Durum Sütunu Silindi, Sütun Sayısı 3 Oldu) ---
window.borcluMusterileriGetir = async function() {
    const govde = document.getElementById('raporTabloGovdesi');
    const modalHeader = document.querySelector('#raporModal .modal-header');
    
    // FORM MAKYAJI: Simsiyah arka plan
    if (modalHeader) {
    modalHeader.className = 'modal-header border-0 py-3 d-flex justify-content-between align-items-center';
    modalHeader.style.backgroundColor = '#000000'; 
        modalHeader.style.backgroundColor = '#000000'; 
    
    // SİHİRLİ KISIM: Başlığın sonuna bembeyaz bir çarpı (btn-close btn-close-white) ekledik
    modalHeader.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="bg-warning text-dark rounded-circle p-2 me-3 shadow-sm d-flex align-items-center justify-content-center" style="width: 35px; height: 35px;">
                <i class="fas fa-hand-holding-usd fs-5"></i>
            </div>
            <div>
                <h5 class="mb-0 fw-bold text-white" style="letter-spacing: 0.5px;">Borçlu Müşteriler</h5>
            </div>
        </div>
        <button type="button" class="btn-close btn-close-white shadow-none" data-bs-dismiss="modal" aria-label="Close"></button>
    `;
}

    
    // Sütun sayısını 3 olarak ayarladık (Colspan=3)
    govde.innerHTML = '<tr><td colspan="3" class="text-center py-4"><div class="spinner-border text-warning spinner-border-sm"></div> <span class="text-muted ms-2">Hesaplanıyor...</span></td></tr>';
    
    guvenliModalAc('raporModal');

    try {
        const res = await fetch('/api/rapor-borclular');
        const veriler = await res.json();
        govde.innerHTML = '';

        if (veriler.length === 0) {
            govde.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-success fw-bold">Borçlu müşteri bulunamadı. Herkes ödemesini yapmış!</td></tr>';
            if(document.getElementById('vadeKayitSayisi')) document.getElementById('vadeKayitSayisi').innerText = "0";
            if(document.getElementById('raporGenelToplam')) document.getElementById('raporGenelToplam').innerText = "0,00";
            return;
        }

        let genelToplamBorc = 0;

        veriler.forEach((m) => {
            const bakiye = parseFloat(m.Bakiye) || 0;
            genelToplamBorc += bakiye;

            const bakiyeRenk = bakiye > 5000 ? 'text-danger' : 'text-warning text-dark';
            let guvenliAd = (m.Adı || 'İsimsiz').replace(/'/g, "\\'");
            let guvenliTel = (m.CEPTEL || '-').replace(/'/g, "\\'");
            
            // SİHİRLİ KISIM: Arama yapabilmek için satıra 'borclu-row' class'ını ekledik!
            govde.innerHTML += `
                <tr class="align-middle table-hover-custom borclu-row" 
                    style="border-left: 4px solid ${bakiye > 5000 ? '#dc3545' : '#ffc107'}; cursor: pointer; transition: background-color 0.2s;"
                    ondblclick="borcluDetayaGit(${m.Kimlik}, '${guvenliAd}', '${guvenliTel}')"
                    title="Müşteri detayı için çift tıklayın">
                    
                    <td class="ps-3 py-3 fw-bold text-dark">${m.Adı}</td>
                    
                    <td class="py-3 text-muted" style="font-size: 0.9rem;">
                        <i class="fas fa-phone-alt opacity-50 me-1"></i> ${m.CEPTEL || '-'}
                    </td>
                    
                    <td class="py-3 text-end pe-4">
                        <span class="fw-bolder ${bakiyeRenk}" style="font-size: 1.05rem;">${bakiye.toLocaleString('tr-TR')} ₺</span>
                    </td>
                    
                </tr>
            `;
        });

        if(document.getElementById('vadeKayitSayisi')) document.getElementById('vadeKayitSayisi').innerText = veriler.length;
        if(document.getElementById('raporGenelToplam')) document.getElementById('raporGenelToplam').innerText = genelToplamBorc.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    } catch (err) {
        govde.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4">Hata: Veriler yüklenemedi!</td></tr>';
    }
};

// --- 2. BORÇLU ARAMA MOTORU (YENİ EKLENDİ) ---
window.borcluAra = function() {
    // HTML'deki arama kutusunun ID'sini buraya bağladık
    const input = document.getElementById('raporAramaKutusu');
    if(!input) return;
    
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const rows = document.querySelectorAll('.borclu-row'); // Yukarıda satırlara verdiğimiz isim
    
    let gorunurSayisi = 0;

    rows.forEach(row => {
        // İsim ve telefonu da kapsayacak şekilde tüm satırı okur
        const text = row.innerText.toLocaleLowerCase('tr-TR');
        if (text.includes(filter)) {
            row.style.display = "";
            gorunurSayisi++;
        } else {
            row.style.display = "none";
        }
    });

    // Filtreleme yapınca alt kısımdaki Kayıt Sayısı da otomatik güncellenir
    const kayitKutusu = document.getElementById('vadeKayitSayisi');
    if(kayitKutusu) kayitKutusu.innerText = gorunurSayisi;
};
window.urunIadeAc = async function() {
    if (!aktifMusteriId) { alert("Lütfen önce bir müşteri seçin."); return; }

    // --- YENİ: Müşteri Adını Modalın Tepesine Yazdırma ---
    let ad = (aktifMusteriAd || "").replace(/null/g, '').trim();
    const adKutusu = document.getElementById('iadeMusteriAd');
    if(adKutusu) adKutusu.innerText = ad || "İsimsiz Müşteri";

    // Ürünleri satış ekranındaki gibi veritabanından çekeriz
    const select = document.getElementById('iadeUrunSec');
    select.innerHTML = '<option value="">Yükleniyor...</option>';

    // Tarih kutusuna bugünü otomatik atıyoruz
    const tarihKutusu = document.getElementById('iadeTarihi');
    if(tarihKutusu) tarihKutusu.value = bugununTarihiFormati();
    
    // Yeni nesil kilit kırıcı ile modalı aç
    guvenliModalAc('urunIadeModal');

    try {
        const res = await fetch('/api/komur');
        const urunler = await res.json();
        
        select.innerHTML = '<option value="">--- İade Edilen Ürünü Seçin ---</option>';
        urunler.forEach(u => {
            select.innerHTML += `<option value="${u.id}">${u.cins}</option>`;
        });
    } catch (err) {
        select.innerHTML = '<option value="">Ürünler yüklenemedi!</option>';
    }
};
window.urunIadeKaydet = async function() {
    const urunId = document.getElementById('iadeUrunSec').value;
    const miktar = document.getElementById('iadeMiktar').value;
    const tutar = document.getElementById('iadeTutar').value;
    const notlar = document.getElementById('iadeNotlar').value;

    // =========================================================
    // 👤 PERSONEL ZIRHI (SİSTEM YAZISINI BİTİREN KISIM)
    // =========================================================
    let aktifPersonel = localStorage.getItem('aktifKullanici');
    if (!aktifPersonel || aktifPersonel === 'Sistem' || aktifPersonel === 'null') {
        const navbarAd = document.getElementById('navbarKullaniciAd')?.innerText;
        aktifPersonel = (navbarAd && navbarAd !== 'Yükleniyor...') ? navbarAd : 'SİSTEM KAYDI';
    }

    // --- SENİN KUSURSUZ AKILLI SAAT MOTORUN ---
    const islemTarihiKutusu = document.getElementById('iadeTarihi');
    let secilenTarih = islemTarihiKutusu && islemTarihiKutusu.value ? islemTarihiKutusu.value : '';

    const simdi = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const saat = pad(simdi.getHours());
    const dakika = pad(simdi.getMinutes());
    const saniye = pad(simdi.getSeconds());

    let islemTarihiSql = "";
    if (!secilenTarih) {
        const y = simdi.getFullYear();
        const a = pad(simdi.getMonth() + 1);
        const g = pad(simdi.getDate());
        islemTarihiSql = `${y}-${a}-${g} ${saat}:${dakika}:${saniye}`;
    } else {
        const sadeceTarih = secilenTarih.split('T')[0]; 
        islemTarihiSql = `${sadeceTarih} ${saat}:${dakika}:${saniye}`;
    }

    // Makbuz için Türk usulü tarih formatı (Örn: 24.04.2026)
    const tarihParcalari = islemTarihiSql.split(' ')[0].split('-');
    const islemTarihiMakbuz = `${tarihParcalari[2]}.${tarihParcalari[1]}.${tarihParcalari[0]}`;
    // --------------------------------------------------------

    if (!urunId || !miktar || !tutar) {
        alert("Lütfen ürün, miktar ve iade tutarını eksiksiz girin!");
        return;
    }

    if (!confirm(`${miktar} miktar ürün stoğa geri eklenecek ve ${tutar} ₺ müşterinin borcundan düşülecek. \n\n"İADE FİŞİ" kesilsin mi?`)) return;

    try {
        const res = await fetch('/api/iade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                musteri_id: aktifMusteriId,
                komur_id: urunId,
                miktar: miktar,  
                tutar: tutar,    
                notlar: notlar,
                islemiYapan: aktifPersonel, // 🚨 İŞTE BURASI MÜHÜRLENDİ
                tarih: islemTarihiSql 
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            // Ekranda da kimin yaptığını görelim ki içimiz rahat etsin
            alert(`✅ İade işlemi tamamlandı.\nİşlemi Yapan: ${aktifPersonel}\nMakbuz No: ${data.makbuzNo}`);
            
            // --- YENİ: İSİM VE BİRİMİ AKILLICA PARÇALAYAN YAZDIRMA MOTORU ---
            if (localStorage.getItem('ayarOtoMakbuz') !== 'false') {
                if (typeof makbuzYazdir === 'function') {
                    
                    // Seçilen ürünün adını ekrandan yakalıyoruz
                    const urunSelect = document.getElementById('iadeUrunSec');
                    let hamUrunIsmi = urunSelect.options[urunSelect.selectedIndex].text; // Örn: "SARI POLAT-5750 (Adet)"
                    
                    let temizIsim = hamUrunIsmi;
                    let birim = "Adet"; // Parantez yoksa varsayılan
                    
                    // Akıllı Cımbız: Parantez içindeki birimi ayıkla
                    if (hamUrunIsmi.includes(' (')) {
                        temizIsim = hamUrunIsmi.split(' (')[0].trim(); // "SARI POLAT-5750" kalır
                        birim = hamUrunIsmi.split(' (')[1].replace(')', '').trim(); // "Adet" kalır
                    }

                    makbuzYazdir(
                        aktifMusteriAd, 
                        tutar, 
                        `ÜRÜN İADESİ (${temizIsim} - ${miktar} ${birim})`, 
                        islemTarihiMakbuz, 
                        data.makbuzNo, 
                        0, 
                        aktifPersonel // 🚨 MAKBUZA DA PERSONEL GİDİYOR
                    );
                }
            }
            
            // Modalı kapat ve formu temizle
            const iadeModal = document.getElementById('urunIadeModal');
            if (iadeModal) {
                const modalInstance = bootstrap.Modal.getInstance(iadeModal);
                if (modalInstance) modalInstance.hide();
            }
            
            document.getElementById('iadeMiktar').value = '';
            document.getElementById('iadeTutar').value = '';
            document.getElementById('iadeNotlar').value = '';
            
            // --- EKRANI TAZELE ---
            const telText = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '';
            await musteriDetayGoster(aktifMusteriId, aktifMusteriAd, telText);

        } else {
            alert("Hata: " + (data.hata || "İşlem başarısız"));
        }
    } catch (err) {
        console.error("İade Hatası:", err);
        alert("Bağlantı hatası!");
    }
};
// BUGÜNÜN TARİHİNİ Y-A-G FORMATINDA VEREN YARDIMCI
function bugununTarihiFormati() {
    const bugun = new Date();
    // Saat farkından dolayı dünün tarihini vermesin diye lokal tarihi alıyoruz
    bugun.setMinutes(bugun.getMinutes() - bugun.getTimezoneOffset());
    return bugun.toISOString().split('T')[0];
}

// --- SATIŞTAN VEYA ÖDEMEDEN MÜŞTERİ DETAYINA GERİ DÖNÜŞ FONKSİYONU ---
window.satistanDetayaDon = function() {
    // 1. Satış Modalını Kapat
    const sModalEl = document.getElementById('hizliSatisModal');
    if (sModalEl) {
        let sInst = bootstrap.Modal.getInstance(sModalEl);
        if (sInst) sInst.hide();
    }
    
    // 2. Ödeme Modalını Kapat (Eğer oradaysa)
    const oModalEl = document.getElementById('satisOdemeModal');
    if (oModalEl) {
        let oInst = bootstrap.Modal.getInstance(oModalEl);
        if (oInst) oInst.hide();
    }

    // 3. Modallar kapandıktan yarım saniye sonra Müşteri Detayını tekrar aç!
    setTimeout(() => {
        if (aktifMusteriId) {
            // Telefon numarasını ekrandan yakalayıp gönderiyoruz
            let tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '-';
            musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
        }
    }, 400);
};
// =================================================================
// 🛡️ EVRENSEL MODAL YÖNETİCİSİ (TÜM GRİ EKRANLARI DÜZELTİR)
// =================================================================

// 1. GÜVENLİ MODAL AÇICI (Hangi ID'yi verirsen onu pürüzsüz açar)
// =================================================================
// 🛡️ EVRENSEL MODAL YÖNETİCİSİ (GÜNCELLENDİ - KESİN ÇÖZÜM)
// =================================================================

// Sistemde var olan bütün pencerelerin kimlik kartları (ID'leri)
window.sistemdekiTumModallar = [
    'musterilerModal', 'musteriDetayModal', 'musteriNotlarModal', 'musteriNotUyariModal',
    'hizliSatisModal', 
    'satisOdemeModal', 'tahsilatModal', 'urunIadeModal', 
    'borcSatisModal', 'taksitPlaniModal', 'islemDuzenleModal','gunlukOzetModal',
    'sistemLoglariModal'
];

function sistemLoglariMetinKacir(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sistemLoglariSeviyeRengi(sev) {
    if (sev === 'hata') return 'danger';
    if (sev === 'uyari') return 'warning text-dark';
    return 'info';
}

window.sistemLoglariYenile = async function () {
    const tbody = document.getElementById('sistemLoglariTabloGovdesi');
    const durum = document.getElementById('sistemLoglariDurum');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-white-50 py-3">Yükleniyor…</td></tr>';
    if (durum) durum.textContent = 'Yükleniyor…';
    try {
        const r = await fetch('/api/sistem-loglari?_t=' + Date.now());
        const data = await r.json();
        if (!r.ok) throw new Error(data.hata || 'Loglar alınamadı');
        const kayitlar = data.kayitlar || [];
        if (kayitlar.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-white-50 py-4">Henüz kayıt yok. Bir satış veya kayıt işlemi yaptığınızda burada görünecek.</td></tr>';
            if (durum) durum.textContent = 'Kayıt yok';
            return;
        }
        tbody.innerHTML = kayitlar.map((l) => {
            const sev = l.seviye || 'bilgi';
            const badge = sistemLoglariSeviyeRengi(sev);
            const ek = l.ek != null && l.ek !== '' ? sistemLoglariMetinKacir(String(l.ek)) : '—';
            return `
            <tr>
                <td class="ps-3 text-nowrap small text-white-50">${sistemLoglariMetinKacir(l.zamanTr || l.zaman || '')}</td>
                <td><span class="badge bg-${badge}">${sistemLoglariMetinKacir(sev)}</span></td>
                <td class="small font-monospace">${sistemLoglariMetinKacir(l.mesaj || '')}</td>
                <td class="pe-3 small text-break text-white-50">${ek}</td>
            </tr>`;
        }).join('');
        if (durum) durum.textContent = `Son ${kayitlar.length} kayıt (en yeni üstte)`;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger small px-3 py-3">Hata: ${sistemLoglariMetinKacir(e.message)}</td></tr>`;
        if (durum) durum.textContent = 'Hata';
    }
};

window.sistemLoglariModalAc = function () {
    guvenliModalAc('sistemLoglariModal');
    sistemLoglariYenile();
};

// 1. GÜVENLİ MODAL AÇICI (Ekranda ne kadar çöp varsa temizler, yenisini açar)
window.guvenliModalAc = function(hedefModalId) {
    
    const modalEl = document.getElementById(hedefModalId);
    if (!modalEl) return;

    // Temizlik işlemleri (önceki hali koruyoruz)
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    
    document.querySelectorAll('.modal.show').forEach(m => {
        if (m.id !== hedefModalId) {
            const inst = bootstrap.Modal.getInstance(m);
            if (inst) inst.hide();
        }
    });

    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');

    if (window.sistemdekiTumModallar) {
        window.sistemdekiTumModallar.forEach(id => {
            if (id === hedefModalId) return;
            if (id === 'sevkiyatListesiModal' && hedefModalId === 'islemDuzenleModal') return;

            const el = document.getElementById(id);
            if (el && el.classList.contains('show')) {
                const inst = bootstrap.Modal.getInstance(el);
                if (inst) inst.hide();
            }
        });
    }

    if (modalEl.parentElement !== document.body) {
        document.body.appendChild(modalEl);
    }

    let modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (!modalInstance) {
        modalInstance = new bootstrap.Modal(modalEl, {
            backdrop: true,
            keyboard: true,
            focus: true
        });
    }

    // ====================== ÖNEMLİ DEĞİŞİKLİK BURADA ======================
    // Modal tamamen açıldıktan sonra veri yükle
    const loadHandler = function() {
        modalEl.removeEventListener('shown.bs.modal', loadHandler);

        if (hedefModalId === 'sevkiyatListesiModal') {
            if (typeof bekleyenTeslimatlariYukle === 'function') {
                bekleyenTeslimatlariYukle();
            }
        }
        
        // İleride başka modallar için de ekleyebilirsin:
        // if (hedefModalId === 'musterilerModal' && typeof cariTabloyuYukle === 'function') {
        //     cariTabloyuYukle();
        // }
    };

    modalEl.addEventListener('shown.bs.modal', loadHandler);
    // =====================================================================

    modalInstance.show();

    // Z-index: tüm backdrop katmanları modalın altında kalmalı (birden fazla kalıntıda üsttekini düşürmek yetmez).
    setTimeout(() => {
        modalEl.style.setProperty('z-index', '1090', 'important');
        document.querySelectorAll('.modal-backdrop').forEach((b) => {
            b.style.setProperty('z-index', '1085', 'important');
        });
    }, 100);
};
// 2. İŞLEM BİTİNCE MÜŞTERİ DETAYINA (EKSTREYE) GERİ DÖN
window.detayaGeriDon = function() {
    // Müşteri Detay ekranı HARİÇ her şeyi kapat
    window.sistemdekiTumModallar.forEach(id => {
        if (id !== 'musteriDetayModal') {
            const el = document.getElementById(id);
            if (el) {
                let inst = bootstrap.Modal.getInstance(el);
                if (inst) inst.hide();
            }
        }
    });

    // Ekran temizlenince Müşteri Ekstresini tekrar çağır
    setTimeout(() => {
        if (aktifMusteriId) {
            let tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '-';
            musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
        }
    }, 400);
};
// --- SARI İŞLEM DÜZENLE EKRANI İÇİN AKILLI KAPATMA ---
window.islemDuzenleKapat = function() {
    // 1. Sarı düzenle modalını gizle
    const modalEl = document.getElementById('islemDuzenleModal');
    if (modalEl) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    }

    // 2. Arkada Sevkiyat Listesi açık mı diye bak
    const sevkiyatModal = document.getElementById('sevkiyatListesiModal');
    const sevkiyatAcikMi = sevkiyatModal && sevkiyatModal.classList.contains('show');
    
    // 3. Geldiği yere göre karar ver
    if (sevkiyatAcikMi) {
        // Eğer Sevkiyat Listesinden geldiysek, listeyi bir yenile ve orada kal
        bekleyenTeslimatlariYukle(); 
    } else {
        // Eğer Müşteri Detayından (Ekstreden) geldiysek, ekstreyi yeniden yükle
        detayaGeriDon();
    }
};
window.modalZorlaKapat = function(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return;

    // 1. Bootstrap instance varsa normal şekilde kapat
    const instance = bootstrap.Modal.getInstance(modalEl);
    if (instance) {
        instance.hide();
    } else {
        // 2. Instance yoksa manuel kapat
        modalEl.classList.remove('show');
        modalEl.style.display = 'none';
    }

    // 3. GECİKMEYİ BİRAZ ARTIRIP DAHA KAPSAMLI TEMİZLİK YAP
    setTimeout(() => {
        // Tüm backdrop'ları tamamen sil
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
            backdrop.style.opacity = '0';
            setTimeout(() => backdrop.remove(), 150);
        });

        // Body ve html temizliği (en sık kalan kalıntılar)
        document.body.classList.remove('modal-open');
        document.documentElement.classList.remove('modal-open');
        
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('padding-right');

        // Ekstra güvenlik - gizli kalan backdrop'lar
        document.querySelectorAll('.modal-backdrop.fade.show').forEach(b => b.remove());

    }, 300);
};
window.sevkiyatFiltrele = function() {
    const input = document.getElementById('sevkiyatAramaKutusu');
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const tbody = document.getElementById('bekleyenTeslimatlarGovdesi');
    const rows = tbody.getElementsByTagName('tr');
    let gorunurSayisi = 0;

    for (let i = 0; i < rows.length; i++) {
        // Müşteri adı ve Açıklama hücrelerini kontrol et
        const musteri = rows[i].getElementsByTagName('td')[0]?.innerText.toLocaleLowerCase('tr-TR') || "";
        const urun = rows[i].getElementsByTagName('td')[1]?.innerText.toLocaleLowerCase('tr-TR') || "";
        
        if (musteri.includes(filter) || urun.includes(filter)) {
            rows[i].style.display = "";
            gorunurSayisi++;
        } else {
            rows[i].style.display = "none";
        }
    }
    // Alt taraftaki kayıt sayısını güncelle
    document.getElementById('sevkiyatKayitSayisi').innerText = gorunurSayisi;
};
window.tamModalTemizle = function() {
    // Tüm backdrop'ları sil
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    
    // Tüm modalları kapat
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
        modal.style.display = 'none';
    });

    // Body temizliği
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('padding-right');
    document.documentElement.style.removeProperty('overflow');
};
// ====================== YIKILDI MODALI İÇİN YENİ AÇMA FONKSİYONU ======================
// ==========================================================
// 1. MODALI AÇAN MOTOR (MÜHÜR TEMİZLEYİCİ EKLENDİ)
// ==========================================================
window.yikildiIslemDuzenleAc = async function(islemId, kalanMiktar, toplamMiktar, notlar, musteriAd) {
    guvenliModalAc('yikildiIslemDuzenleModal');

    // --- Temel Bilgileri Doldur ---
    document.getElementById('yikildiDuzenleIslemId').value = islemId;
    
    // 🚨 SİHİRLİ DOKUNUŞ 1: Her modal açılışında eski mühürü temizliyoruz
    const toplamMiktarKutusu = document.getElementById('yikildiDuzenleToplamMiktar');
    if (toplamMiktarKutusu) {
        toplamMiktarKutusu.value = toplamMiktar || 0;
        toplamMiktarKutusu.removeAttribute('data-gercek-toplam'); // Temiz sayfa!
    }

    document.getElementById('yikildiDuzenleMusteriAd').textContent = decodeURIComponent(musteriAd || '');
    
    const miktarInput = document.getElementById('yikildiDuzenleTeslimEdilecek');
    if (miktarInput) miktarInput.value = kalanMiktar || 0;

    const notAlani = document.getElementById('yikildiDuzenleIslemNotu');
    if (notAlani) notAlani.value = decodeURIComponent(notlar || '');

    const switchEl = document.getElementById('yikildiDuzenleTeslimatDurumu');
    if (switchEl) switchEl.checked = true;

    // ====================== GEÇMİŞ TABLOSU ======================
    const gecmisGovde = document.getElementById('yikildiTeslimatGecmisiGovdesi');
    if (gecmisGovde) {
        gecmisGovde.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">Yükleniyor...</td></tr>';
        if (typeof yikildiTeslimatGecmisiniYukle === 'function') {
            await yikildiTeslimatGecmisiniYukle(islemId);
        }
    }
};

// ==========================================================
// 2. GEÇMİŞİ YÜKLEYEN MOTOR (TOPLAM SATIŞ KİLİTLEYİCİ EKLENDİ)
// ==========================================================
window.yikildiTeslimatGecmisiniYukle = async function(islemId) {
    if (!islemId || islemId === 'undefined' || islemId === 'null') return;

    const tbody = document.getElementById('yikildiTeslimatGecmisiGovdesi');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted"><i class="fas fa-spinner fa-spin"></i> Yükleniyor...</td></tr>';

    try {
        const response = await fetch(`/api/teslimat-gecmisi/${islemId}`);
        if (!response.ok) throw new Error("Sunucu yanıt vermedi");

        const gecmis = await response.json();
        tbody.innerHTML = '';

        let toplamYikilan = 0; 

        if (!gecmis || !Array.isArray(gecmis) || gecmis.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3 text-muted"><i class="fas fa-info-circle me-1"></i> Henüz geçmiş kayıt yok.</td></tr>';
        } else {
            gecmis.forEach(g => {
                toplamYikilan += parseFloat(g.YikilanMiktar) || 0; 
                const tarih = tarihFormatla(g.Tarih);
                tbody.innerHTML += `
                    <tr>
                        <td class="align-middle">${tarih}</td>
                        <td class="text-center align-middle">
                            <span class="badge bg-danger fs-6">${g.YikilanMiktar}</span>
                        </td>
                        <td class="align-middle">
                            ${g.Aciklama || 'Teslimat'}
                            <button class="btn btn-sm btn-outline-danger float-end py-0 px-2" 
                                    onclick="yikildiGecmisKayitSil(${g.ID}, ${islemId})" title="Bu Teslimatı Geri Al">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>`;
            });
        }

        // 🚨 SİHİRLİ DOKUNUŞ 2: "TOPLAM SATIŞ" DÜŞME SORUNUNU KÖKTEN ÇÖZEN MATEMATİK
        const miktarInput = document.getElementById('yikildiDuzenleTeslimEdilecek');
        const toplamMiktarKutusu = document.getElementById('yikildiDuzenleToplamMiktar');
        
        if (toplamMiktarKutusu && miktarInput) {
            // Mühürlü değeri okumaya çalışıyoruz
            let gercekToplam = parseFloat(toplamMiktarKutusu.getAttribute('data-gercek-toplam'));
            
            // Eğer mühür yoksa (Modal ilk kez açıldıysa), gerçek toplamı bir kere hesapla ve mühürle!
            if (!gercekToplam) {
                const acilisKalani = parseFloat(miktarInput.value) || 0;
                gercekToplam = acilisKalani + toplamYikilan; // Gerçek Satış = Şu Anki Kalan + Eskiden Yıkılanlar
                toplamMiktarKutusu.setAttribute('data-gercek-toplam', gercekToplam);
            }

            // Artık formül çok basit ve ASLA ŞAŞMAZ: Yeni Kalan = Gerçek Toplam - Tüm Geçmiş Yıkılanlar
            let guncelKalan = gercekToplam - toplamYikilan;
            if (guncelKalan < 0) guncelKalan = 0;

            // Miktar kutusunun içine taze Kalanı yaz (Geçmiş silindiğinde rakam otomatik geri yüklenir)
            miktarInput.value = guncelKalan;

            // Bilgi ekranını güncelle -> Toplam Satış beton gibi sabit kalır!
            const limitBilgi = document.getElementById('yikildiTeslimatLimitBilgi');
            if (limitBilgi) {
                limitBilgi.innerHTML = `Toplam Satış: <span class="text-dark fw-bold">${gercekToplam}</span> | <span class="text-danger">Güncel Kalan: ${guncelKalan}</span>`;
            }
            
            // Kalan sıfırlandıysa şalteri otomatik kapat
            const switchEl = document.getElementById('yikildiDuzenleTeslimatDurumu');
            if (switchEl) switchEl.checked = (guncelKalan > 0);
        }

    } catch (err) {
        console.error("Geçmiş çekilirken hata:", err);
        tbody.innerHTML = '<tr><td colspan="3" class="text-danger text-center">Veriler çekilemedi!</td></tr>';
    }
};
        // =================================================================
// 🗑️ YIKIM EKRANI - GEÇMİŞ KAYIT SİLME MOTORU (KAYBOLAN KOD)
// =================================================================
window.yikildiGecmisKayitSil = async function(gecmisId, islemId) {
    if (!confirm("⚠️ Bu teslimat kaydını silmek ve miktarı müşteriye geri iade etmek istediğinize emin misiniz?")) return;

    try {
        const response = await fetch(`/api/teslimat-gecmisi/${gecmisId}`, { method: 'DELETE' });
        const result = await response.json();

        if (response.ok && result.success) {
            // PENCEREYİ KAPATMIYORUZ! Sadece mesaj veriyoruz.
            alert("🗑️ Kayıt silindi ve miktar müşteriye iade edildi.");
            
            // 1. Sadece formun içindeki "Geçmiş Teslimatlar" tablosunu ve üstteki kalan miktar kutusunu anında yenile
            if (typeof yikildiTeslimatGecmisiniYukle === 'function') {
                yikildiTeslimatGecmisiniYukle(islemId);
            }

            // 2. Arka plandaki dev Sevkiyat listesini çaktırmadan yenile
            if (typeof bekleyenTeslimatlariYukle === 'function') {
                bekleyenTeslimatlariYukle(); 
            }

        } else {
            alert("❌ Hata: " + (result.hata || "Silinemedi"));
        }
    } catch (err) {
        console.error(err);
        alert("⚠️ Bağlantı hatası! Kayıt silinemedi.");
    }
};
// --- YIKIM (ŞOFÖR) MODALINI İPTAL ET VEYA KAPAT (GERİ DÖNÜŞ) ---
window.yikildiIslemDuzenleKapat = function() {
    // 1. Kırmızı düzenleme penceresini zorla kapatıyoruz
    modalZorlaKapat('yikildiIslemDuzenleModal');
    
    // 2. Yarım saniye sonra geldiği yer olan Sevkiyat Listesini şak diye geri açıyoruz!
    setTimeout(() => {
        guvenliModalAc('sevkiyatListesiModal'); 
        if (typeof bekleyenTeslimatlariYukle === 'function') {
            bekleyenTeslimatlariYukle(); // Listeyi de güncelliyoruz
        }
    }, 350);
};
// --- SAAT KAYMASINI DÜZELTEN EVRENSEL FONKSİYON ---
// --- SAAT KAYMASINI DÜZELTEN AKILLI FONKSİYON ---
// --- SAAT KAYMASINI VE SIFIRLARI (00:00:00) GİZLEYEN AKILLI FONKSİYON ---
window.tarihFormatla = function(tarihVerisi, sadeceTarihMi = false) {
    if (!tarihVerisi) return '-';
    
    // Eğer tarih "2026-04-24T12:00:00.000Z" gibi 'Z' ile geliyorsa 'Z'yi siliyoruz
    // Bu sayede tarayıcı ekleme/çıkarma yapmadan saati olduğu gibi okur.
    let temizVeri = tarihVerisi.toString().replace('Z', '').replace('T', ' ');
    let d = new Date(temizVeri);
    
    if (isNaN(d.getTime())) return '-';

    const gun = d.getDate().toString().padStart(2, '0');
    const ay = (d.getMonth() + 1).toString().padStart(2, '0');
    const yil = d.getFullYear();
    const saat = d.getHours().toString().padStart(2, '0');
    const dakika = d.getMinutes().toString().padStart(2, '0');

    if (sadeceTarihMi || (saat === '00' && dakika === '00')) {
        return `${gun}.${ay}.${yil}`;
    } else {
        return `${gun}.${ay}.${yil} ${saat}:${dakika}`;
    }
};
// =================================================================
// 🛑 FİZİKSEL MÜHÜRLÜ GERİ DÖNÜŞ SİSTEMİ (SON VE KESİN SÜRÜM)
// =================================================================

// 1. Ana Listeden Geliş
window.cariDetayaGit = function(id, ad, tel) {
    document.getElementById('musteriDetayModal').setAttribute('data-gelis-yeri', 'musteriler');
    modalZorlaKapat('musterilerModal');
    setTimeout(() => { musteriDetayGoster(id, ad, tel); }, 350);
};

// 2. Borçlular Raporundan Geliş
window.borcluDetayaGit = function(id, ad, tel) {
    document.getElementById('musteriDetayModal').setAttribute('data-gelis-yeri', 'borclu');
    modalZorlaKapat('raporModal');
    setTimeout(() => { musteriDetayGoster(id, ad, tel); }, 350);
};

// 3. Vadesi Gelenler Raporundan Geliş
window.vadeDetayaGit = function(id, ad, tel) {
    document.getElementById('musteriDetayModal').setAttribute('data-gelis-yeri', 'vade');
    modalZorlaKapat('raporModal');
    setTimeout(() => { musteriDetayGoster(id, ad, tel); }, 350);
};

// 4. "Listeye Dön" Butonu Motoru (Okuyucu)
window.detaydanListeyeDon = function() {
    const gelisYeri = document.getElementById('musteriDetayModal').getAttribute('data-gelis-yeri');
    modalZorlaKapat('musteriDetayModal'); // Detayı kapat
    
    setTimeout(() => {
        if (gelisYeri === 'borclu') {
            borcluMusterileriGetir(); // Borçlulara götür
        } 
        else if (gelisYeri === 'vade') {
            vadesiGelenleriGetir(); // Vadeye götür
        } 
        else {
            guvenliModalAc('musterilerModal'); // Ana listeye götür
            if (typeof cariListesiniYukle === 'function') cariListesiniYukle();
        }
    }, 350);
};
// =================================================================
// 💰 İŞLETME GİDERLERİ VE MAZOT STOK YÖNETİMİ
// =================================================================

// Sistemin bu modalları da tanıması için listeye ekleyelim (Eğer yukarıdaki dizide yoksa)
if (window.sistemdekiTumModallar && !window.sistemdekiTumModallar.includes('giderListesiModal')) {
    window.sistemdekiTumModallar.push('giderListesiModal', 'yeniGiderModal');
}

// 1. Listeyi Yükle ve Hesaplamaları Yap
window.giderleriYukle = async function() {
    guvenliModalAc('giderListesiModal');
    const govde = document.getElementById('giderTabloGovdesi');
    govde.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border text-primary"></div></td></tr>';

    try {
        const res = await fetch('/api/giderler');
        const giderler = await res.json();
        govde.innerHTML = '';

        let toplamGider = 0;
        let toplamMazotGiren = 0;
        let toplamMazotCikan = 0;

        if (!Array.isArray(giderler) || giderler.length === 0) {
            govde.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Henüz gider veya mazot kaydı yok.</td></tr>';
        } else {
            giderler.forEach(g => {
                const tutar = parseFloat(g.Tutar) || 0;
                const miktar = parseFloat(g.Miktar) || 0;
                toplamGider += tutar;

                // Mazot hesaplaması
                if (g.IslemTipi === 'Mazot Girişi') toplamMazotGiren += miktar;
                if (g.IslemTipi === 'Mazot Çıkışı') toplamMazotCikan += miktar;

                const tarih = tarihFormatla(g.Tarih, true);
                
                // İkonlar ve Renkler
                let ikon = '<i class="fas fa-receipt text-secondary"></i>';
                let renk = 'text-dark';
                let tutarYazisi = `${tutar.toLocaleString('tr-TR')} ₺`;
                let miktarYazisi = '-';
                
                if (g.IslemTipi === 'Mazot Girişi') {
                    ikon = '<i class="fas fa-gas-pump text-success"></i>';
                    renk = 'text-success fw-bold';
                    miktarYazisi = `<span class="badge bg-success">+ ${miktar} Lt</span>`;
                } else if (g.IslemTipi === 'Mazot Çıkışı') {
                    ikon = '<i class="fas fa-truck-moving text-danger"></i>';
                    renk = 'text-danger fw-bold';
                    tutarYazisi = '-'; // Kullanımda para ödenmez
                    miktarYazisi = `<span class="badge bg-danger">- ${miktar} Lt</span>`;
                }

                govde.innerHTML += `
                    <tr class="align-middle">
                        <td class="ps-4 fw-bold text-muted small">${tarih}</td>
                        <td class="${renk}">${ikon} ${g.Kategori || g.IslemTipi}</td>
                        <td class="fw-bold">${g.FirmaKisi || '-'}</td>
                        <td class="small">${g.Aciklama || '-'}</td>
                        <td class="text-center">${miktarYazisi}</td>
                        <td class="text-end fw-bold text-danger">${tutarYazisi}</td>
                        <td class="text-center pe-4">
                            <button class="btn btn-sm btn-outline-danger" onclick="giderSil(${g.ID})" title="İptal Et">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
        }

        // Tepe tabelalarını güncelle
        document.getElementById('giderGenelToplam').innerText = toplamGider.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
        const kalanMazot = toplamMazotGiren - toplamMazotCikan;
        document.getElementById('mazotKalanStok').innerText = kalanMazot.toLocaleString('tr-TR');

    } catch (err) {
        console.error(err);
        govde.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Veriler çekilemedi!</td></tr>';
    }
};
// Firma listesini SQL'den çekip gizli DataList'e doldurur
window.firmalariDatalisteYukle = async function() {
    const dataList = document.getElementById('firmaListesi');
    if (!dataList) return;
    
    try {
        const res = await fetch('/api/gider-firmalar');
        const firmalar = await res.json();
        
        dataList.innerHTML = ''; // Önce eskisini temizle
        
        // Gelen her bir firmayı seçenek olarak listeye ekle
        firmalar.forEach(f => {
            if(f.FirmaKisi) {
                dataList.innerHTML += `<option value="${f.FirmaKisi}"></option>`;
            }
        });
    } catch (error) {
        console.error("Firmalar yüklenemedi:", error);
    }
};
// 2. Yeni Gider Formunu Aç ve Hazırla
// 2. Yeni Gider Formunu Aç ve Hazırla
window.yeniGiderModalAc = function() {
    document.getElementById('giderFormu').reset();
    document.getElementById('giderTarihi').value = bugununTarihiFormati();
    giderTuruDegisti(); // Formu şeçime göre şekillendir
    
    // İŞTE SİHİR BURADA: Form açılırken eski firmaları da arka planda çekip kutuya bağla
    firmalariDatalisteYukle(); 

    guvenliModalAc('yeniGiderModal');
};
// 3. Akıllı Form: Şeçime Göre Kutuları Gizle/Göster
window.giderTuruDegisti = function() {
    const secim = document.getElementById('giderTuruSecim').value;
    const alanMiktar = document.getElementById('alanMiktar');
    const alanTutar = document.getElementById('alanTutar');
    const alanFirma = document.getElementById('alanFirma');
    const lblAciklama = document.getElementById('lblAciklama');
    const txtAciklama = document.getElementById('giderAciklama');

    if (secim === 'Normal') {
        alanMiktar.style.display = 'none';
        alanTutar.style.display = 'block';
        alanFirma.style.display = 'block';
        lblAciklama.innerText = "Açıklama / Detay";
        txtAciklama.placeholder = "Örn: Dükkan kirası, Ahmet Usta yevmiye...";
    } 
    else if (secim === 'MazotGirisi') {
        alanMiktar.style.display = 'block';
        alanTutar.style.display = 'block';
        alanFirma.style.display = 'block';
        lblAciklama.innerText = "Açıklama";
        txtAciklama.placeholder = "Fatura numarası veya not...";
    } 
    else if (secim === 'MazotCikisi') {
        // Şoför araca mazot alırken sadece Litre ve Plaka girer, para ödemez
        alanMiktar.style.display = 'block';
        alanTutar.style.display = 'none'; 
        alanFirma.style.display = 'none';
        lblAciklama.innerText = "Araç Plakası / Şoför (ZORUNLU)";
        txtAciklama.placeholder = "Örn: 42 ABC 123 plakalı araca Ali Usta aldı...";
    }
};

// 4. Kaydetme İşlemi
window.gideriKaydet = async function() {
    const secim = document.getElementById('giderTuruSecim').value;
    const tarih = document.getElementById('giderTarihi').value;
    const firma = document.getElementById('giderFirma').value;
    const tutar = parseFloat(document.getElementById('giderTutar').value) || 0;
    const miktar = parseFloat(document.getElementById('giderMiktar').value) || 0;
    const aciklama = document.getElementById('giderAciklama').value;

    let islemTipi = 'Gider';
    let kategori = 'Diğer Gider';

    if (secim === 'Normal') {
        if (tutar <= 0) { alert("Lütfen harcanan tutarı girin!"); return; }
        // Eğer açıklamanın içinde kelimeler geçiyorsa kategoriyi akıllıca belirle
        let kucukAciklama = aciklama.toLowerCase();
        if(kucukAciklama.includes('maaş') || kucukAciklama.includes('yevmiye')) kategori = 'Maaş/Yevmiye';
        else if(kucukAciklama.includes('elektrik') || kucukAciklama.includes('su') || kucukAciklama.includes('internet')) kategori = 'Fatura';
        else if(kucukAciklama.includes('yemek') || kucukAciklama.includes('çay')) kategori = 'Mutfak/Yemek';
    } 
    else if (secim === 'MazotGirisi') {
        if (tutar <= 0 || miktar <= 0) { alert("Lütfen alınan litre ve ödenen parayı girin!"); return; }
        islemTipi = 'Mazot Girişi';
        kategori = 'Mazot Alımı';
    } 
    else if (secim === 'MazotCikisi') {
        if (miktar <= 0 || !aciklama) { alert("Lütfen verilen Litreyi ve Araç Plakasını girin!"); return; }
        islemTipi = 'Mazot Çıkışı';
        kategori = 'Mazot Kullanımı';
    }

    try {
        const response = await fetch('/api/gider', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Tarih: tarih, Kategori: kategori, IslemTipi: islemTipi,
                Tutar: tutar, Miktar: miktar, FirmaKisi: firma, Aciklama: aciklama
            })
        });

        if (response.ok) {
            alert("✅ Kayıt başarılı!");
            modalZorlaKapat('yeniGiderModal');
            setTimeout(() => { giderleriYukle(); }, 300); // Listeyi yenile
        } else {
            alert("❌ Kayıt yapılamadı!");
        }
    } catch (err) {
        alert("⚠️ Sunucu bağlantı hatası!");
    }
};

// 5. Silme İşlemi
window.giderSil = async function(id) {
    if(!confirm("⚠️ Bu kaydı silmek istediğinize emin misiniz? Sildiğiniz mazot hareketleri stoğu anında etkiler!")) return;

    try {
        const res = await fetch('/api/gider/' + id, { method: 'DELETE' });
        if(res.ok) {
            alert("🗑️ Kayıt silindi.");
            giderleriYukle(); // Listeyi anında yenile
        }
    } catch (err) {
        alert("Bağlantı hatası!");
    }
};
window.stokFiltrele = function() {
    const input = document.getElementById('stokAramaKutusu');
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const tabloGovdesi = document.getElementById('stokTabloGövdesi');
    const satirlar = tabloGovdesi.getElementsByTagName('tr');

    for (let i = 0; i < satirlar.length; i++) {
        const urunAdiHucre = satirlar[i].getElementsByTagName('td')[1]; 
        if (urunAdiHucre) {
            const metin = (urunAdiHucre.textContent || urunAdiHucre.innerText).toLocaleLowerCase('tr-TR');
            satirlar[i].style.display = metin.includes(filter) ? "" : "none";
        }
    }
};

window.anaStokFiltrele = function() {
    const input = document.getElementById('anaStokArama');
    const filter = input.value.toLocaleLowerCase('tr-TR');
    const tabloGovdesi = document.getElementById('stokTabloGövdesi');
    const satirlar = tabloGovdesi.getElementsByTagName('tr');

    for (let i = 0; i < satirlar.length; i++) {
        // 2. sütun (index 1) Kömür Cinsi'dir
        const urunAdiHucre = satirlar[i].getElementsByTagName('td')[1]; 
        if (urunAdiHucre) {
            const metin = (urunAdiHucre.textContent || urunAdiHucre.innerText).toLocaleLowerCase('tr-TR');
            if (metin.includes(filter)) {
                satirlar[i].style.display = ""; // Kelime geçiyorsa göster
            } else {
                satirlar[i].style.display = "none"; // Geçmiyorsa satırı gizle
            }
        }
    }
};
// Şalteri açıp kapatan fonksiyon
window.odemeAlaniniTetikle = function() {
    const kutu = document.getElementById('hizliOdemeDetay');
    const tik = document.getElementById('hizliOdemeVarMi').checked;
    
    if (tik) {
        kutu.style.display = 'block';
        tutariTamamla(); // Şalteri açınca otomatik "Genel Toplam"ı yazsın ki uğraşma
    } else {
        kutu.style.display = 'none';
        document.getElementById('hizliOdemeTutari').value = ''; // Kapatınca içini boşalt
    }
};

// "Tümü" butonuna basınca sepetteki parayı toplayıp kutuya yazan fonksiyon
window.tutariTamamla = function() {
    let genelToplam = 0;
    if (window.aktifSatisSepeti) {
        window.aktifSatisSepeti.forEach(s => genelToplam += s.tutar);
    }
    
    const tutarKutusu = document.getElementById('hizliOdemeTutari');
    if (tutarKutusu && genelToplam > 0) {
        tutarKutusu.value = genelToplam; // Kuruşluysa genelToplam.toFixed(2) yapabilirsin
    }
};
// ==========================================================
// 🛡️ STOK DÜZENLEME VE Z-INDEX KORUMASI (KESİN ÇÖZÜM)
// ==========================================================

// 1. Ürün Düzenle Butonuna Basılınca Çalışan Fonksiyon (Düzeltildi)
// --- 1. TABLOYU DOLDURAN MOTOR (Direkt çalışacak şekilde ayarlandı) ---
window.urunAlimGecmisiYukle = async function(urunId) {
    const tablo = document.getElementById('urunAlimGecmisiGövdesi');
    if (!tablo) return; // Ekranda tablo yoksa arka planda hata vermesin
    
    // Yükleniyor yazısını bas
    tablo.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Kayıtlar aranıyor...</td></tr>';
    
    try {
        const res = await fetch(`/api/urun-alimlari/${urunId}`);
        const alimlar = await res.json();
        
        tablo.innerHTML = '';
        if(!alimlar || alimlar.length === 0) {
            tablo.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Bu ürüne ait henüz mal alım kaydı bulunmuyor.</td></tr>';
            return;
        }
        
        alimlar.forEach(a => {
            const tarih = new Date(a.Tarih).toLocaleDateString('tr-TR');
            const fiyat = a.Fiyat ? a.Fiyat.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺" : "-";
            tablo.innerHTML += `
                <tr>
                    <td class="text-muted ps-3">${tarih}</td>
                    <td class="fw-bold text-dark">${a.Firma}</td>
                    <td class="text-center"><span class="badge bg-secondary px-2 py-1">${a.Miktar}</span></td>
                    <td class="text-end text-danger fw-bold pe-3">${fiyat}</td>
                </tr>
            `;
        });
    } catch(e) {
        console.error("Geçmiş yükleme hatası:", e);
        tablo.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-3">Bağlantı hatası oluştu! Node.js arkada açık mı?</td></tr>';
    }
};

// --- 2. DÜZENLEME EKRANINI AÇAN ANA MOTOR ---
// --- 2. DÜZENLEME EKRANINI AÇAN ANA MOTOR (ZIRHLI VERSİYON) ---
window.stokDuzenle = async function(id) {
    try {
        const response = await fetch('/api/komur');
        const stoklar = await response.json();
        const urun = stoklar.find(s => s.id === id || s.ID === id);

        if (!urun) {
            alert("Ürün bilgisi bulunamadı!");
            return;
        }

        // 1. KUTULARI DOLDUR
        document.getElementById('duzenleStokId').value = urun.id || urun.ID;
        const etiketW = urun.cins || urun.UrunAdi || '';
        document.getElementById('duzenleUrunAdi').value = etiketW;
        const origEl = document.getElementById('duzenleStokEtiketiOrig');
        if (origEl) origEl.value = etiketW;
        document.getElementById('duzenleFiyat').value = urun.ton_fiyati || urun.SatisFiyati;
        document.getElementById('duzenleMiktar').value = urun.mevcut_stok_ton || urun.BaslangicStogu || 0;
        const eaW = document.getElementById('duzenleEsikAlt');
        const euW = document.getElementById('duzenleEsikUst');
        if (eaW && euW) {
            const kayitliAltW = Number(urun.esik_alt);
            const kayitliUstW = Number(urun.esik_ust);
            if (Number.isFinite(kayitliAltW) && Number.isFinite(kayitliUstW) && kayitliUstW > kayitliAltW) {
                eaW.value = kayitliAltW;
                euW.value = kayitliUstW;
            } else {
                eaW.value = '';
                euW.value = '';
            }
        }

        // 2. GEÇMİŞİ YÜKLE
        urunAlimGecmisiYukle(urun.id || urun.ID);

        // --- 3. İŞTE ALTIN VURUŞ (GRİ EKRAN KİLİDİNİ KIRAN KISIM) ---
        // Eski sorunlu modal.show() yerine kendi yazdığımız evrensel maymuncuğu kullanıyoruz!
        guvenliModalAc('stokDuzenleModal');

    } catch (error) {
        console.error("Düzenleme hatası:", error);
        alert("Bağlantı hatası! Lütfen tekrar deneyin.");
    }
};
// 2. Düzenleme Kayıt Fonksiyonu (Eski Koduna Uyumlu)
window.stokGuncelleKaydet = async function() {
    const id = document.getElementById('duzenleStokId').value;
    const urunAdi = document.getElementById('duzenleUrunAdi').value.trim();
    const fiyat = parseFloat(document.getElementById('duzenleFiyat').value);
    const miktar = parseFloat(document.getElementById('duzenleMiktar').value);
    const altEsik = parseFloat(document.getElementById('duzenleEsikAlt').value);
    const ustEsik = parseFloat(document.getElementById('duzenleEsikUst').value);
    if (!id || !urunAdi || isNaN(fiyat) || isNaN(miktar) || isNaN(altEsik) || isNaN(ustEsik)) {
        alert("Lütfen tüm alanları (iki eşik dahil) doldurun!");
        return;
    }
    if (ustEsik <= altEsik) {
        alert("Üst eşik, alt eşikten büyük olmalıdır.");
        return;
    }

    try {
        const response = await fetch('/api/komur/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                UrunAdi: urunAdi,
                TonFiyati: fiyat,
                MevcutStok: miktar,
                EsikAlt: altEsik,
                EsikUst: ustEsik
            })
        });

        if (response.ok) {
            alert("✅ Ürün bilgileri güncellendi.");
            modalZorlaKapat('stokDuzenleModal');
            stoklariYukle(); // Tabloyu yenile
        } else {
            const data = await response.json();
            alert("Hata: " + data.hata);
        }
    } catch (error) {
        alert("Sunucu bağlantı hatası!");
    }
};

// 3. Mevcut Modal Listesine Stok Düzenlemeyi de Ekle
if (window.sistemdekiTumModallar && !window.sistemdekiTumModallar.includes('stokDuzenleModal')) {
    window.sistemdekiTumModallar.push('stokDuzenleModal');
}

// DÜZELTME: Sayfa yüklenirken kullanıcı adını (kısa olanı) da hafızaya almalıyız
document.addEventListener('DOMContentLoaded', () => {
    const ad = localStorage.getItem('aktifKullanici');
    const yetki = localStorage.getItem('kullaniciYetki');
    if(ad) {
        const adKutusu = document.getElementById('navbarKullaniciAd');
        const yetkiKutusu = document.getElementById('navbarKullaniciYetki');
        
        if (adKutusu) adKutusu.innerText = ad;
        if (yetkiKutusu) yetkiKutusu.innerText = yetki === 'Admin' ? '👑 Yönetici' : '👤 Personel';
        
        // SİHİRLİ KISIM: Eğer yetki Admin ise ve o buton sayfada VARSA görünür yap!
        if (yetki === 'Admin') {
            const adminBtn = document.getElementById('btnAdminPanel');
            if (adminBtn) adminBtn.classList.remove('d-none');
        }
    }
});

// --- SİSTEMDEKİ MODALLARA EKLE (Kilit Kırıcı İçin) ---
if (window.sistemdekiTumModallar && !window.sistemdekiTumModallar.includes('yeniKullaniciModal')) {
    window.sistemdekiTumModallar.push('yeniKullaniciModal');
}

// --- PERSONEL KAYDETME MOTORU ---
window.yeniPersonelKaydet = async function() {
    const btn = document.querySelector('#yeniKullaniciModal .btn-dark');
    const adSoyad = document.getElementById('perAdSoyad').value.trim();
    const kullaniciAdi = document.getElementById('perKadi').value.trim();
    const sifre = document.getElementById('perSifre').value.trim();
    const yetki = document.getElementById('perYetki').value;

    if(!adSoyad || !kullaniciAdi || !sifre) {
        alert("Lütfen tüm alanları doldurun!");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Kaydediliyor...';

    try {
        const res = await fetch('/api/kullanici', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adSoyad, kullaniciAdi, sifre, yetki })
        });

        const data = await res.json();

        if(res.ok) {
            alert(`✅ Başarılı! ${adSoyad}, sisteme eklendi.`);
            document.getElementById('formYeniKullanici').reset(); // Formu temizle
            modalZorlaKapat('yeniKullaniciModal'); // Pencereyi kapat
        } else {
            alert("❌ Hata: " + data.hata);
        }
    } catch(err) {
        alert("⚠️ Sunucu ile bağlantı kurulamadı!");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle me-1 text-success"></i> PERSONELİ KAYDET';
    }
};

// Sisteme modalı tanıtıyoruz ki kilitlenme olmasın
if (window.sistemdekiTumModallar && !window.sistemdekiTumModallar.includes('personelYonetimModal')) {
    window.sistemdekiTumModallar.push('personelYonetimModal');
}

// 1. Modalı Açan Motor (Yetkiye Göre Şekil Alır)
window.personelYonetimAc = function() {
    const yetki = localStorage.getItem('kullaniciYetki');
    
    // Formları temizle
    document.getElementById('eskiSifre').value = '';
    document.getElementById('yeniSifre').value = '';
    document.getElementById('yeniPersonelEkleKutusu').style.display = 'none';

    // Sadece Admin ise alt tarafı göster ve listeyi çek
    if (yetki === 'Admin') {
        document.getElementById('adminPanelAlani').style.display = 'block';
        kullanicilariListele();
    } else {
        document.getElementById('adminPanelAlani').style.display = 'none';
    }

    guvenliModalAc('personelYonetimModal');
};

// 2. Kendi Şifresini Değiştirme
// 2. Kendi Şifresini Değiştirme
window.kendiSifremiDegistir = async function() {
    const aktifKadi = localStorage.getItem('aktifKullaniciAdi'); 
    
    // ÇELİK YELEK: Eğer kullanıcı adı hafızada yoksa işlemi durdur!
    if (!aktifKadi) { 
        alert("Sistem kimliğinizi tanıyamadı! Lütfen hesaptan çıkış yapıp tekrar giriş yapın (Login ekranında 'aktifKullaniciAdi' kaydedilmelidir)."); 
        return; 
    }

// script.js içindeki kendiSifremiDegistir fonksiyonunun şu 2 satırını böyle değiştir:
const eskiSifre = document.getElementById('eskiSifre').value.trim();
const yeniSifre = document.getElementById('yeniSifre').value.trim();

    if (!eskiSifre || !yeniSifre) { alert("Şifre alanları boş bırakılamaz!"); return; }

    try {
        const res = await fetch('/api/sifre-degistir', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kullaniciAdi: aktifKadi, eskiSifre: eskiSifre, yeniSifre: yeniSifre })
        });
        
        const data = await res.json();
        if(res.ok) {
            alert("✅ Şifreniz başarıyla değiştirildi! Lütfen yeni şifrenizle tekrar giriş yapın.");
            sistemdenCikisYap(); // Şifre değişince güvenlik için sistemden atıyoruz
        } else {
            alert("❌ Hata: " + (data.hata || "Şifre değiştirilemedi."));
        }
    } catch (err) { alert("Bağlantı hatası!"); }
};

// 3. Kullanıcıları Listele (Sadece Admin)
window.kullanicilariListele = async function() {
    const tbody = document.getElementById('kullaniciTabloGovdesi');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Yükleniyor...</td></tr>';
    
    try {
        const res = await fetch('/api/kullanicilar');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(k => {
            const yetkiBadge = k.Yetki === 'Admin' ? '<span class="badge bg-danger">Yönetici</span>' : '<span class="badge bg-secondary">Personel</span>';
            // Kendini silemesin diye ufak bir koruma
            const silButon = k.KullaniciAdi === localStorage.getItem('aktifKullaniciAdi') 
                ? `<span class="text-muted small">Sen</span>`
                : `<button class="btn btn-sm btn-outline-danger rounded-circle px-2 py-1" onclick="kullaniciSil(${k.ID}, '${k.AdSoyad}')"><i class="fas fa-trash"></i></button>`;

            tbody.innerHTML += `
                <tr>
                    <td class="ps-4 fw-bold text-dark">${k.AdSoyad}</td>
                    <td class="text-muted">@${k.KullaniciAdi}</td>
                    <td>${yetkiBadge}</td>
                    <td class="text-center pe-4">${silButon}</td>
                </tr>
            `;
        });
    } catch (err) { tbody.innerHTML = '<tr><td colspan="4" class="text-danger text-center">Liste çekilemedi!</td></tr>'; }
};

// 4. Yeni Personel Formunu Aç
window.yeniPersonelFormuGoster = function() {
    document.getElementById('perAdSoyad').value = '';
    document.getElementById('perKadi').value = '';
    document.getElementById('perSifre').value = '';
    document.getElementById('yeniPersonelEkleKutusu').style.display = 'block';
};

// 5. Yeni Personeli Kaydet
window.yeniPersonelKaydetMotoru = async function() {
    const adSoyad = document.getElementById('perAdSoyad').value.trim();
    const kullaniciAdi = document.getElementById('perKadi').value.trim();
    const sifre = document.getElementById('perSifre').value.trim();
    const yetki = document.getElementById('perYetki').value;

    if(!adSoyad || !kullaniciAdi || !sifre) { alert("Lütfen tüm alanları doldurun!"); return; }

    try {
        const res = await fetch('/api/kullanici', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adSoyad, kullaniciAdi, sifre, yetki })
        });
        
        if(res.ok) {
            alert(`✅ ${adSoyad}, sisteme eklendi.`);
            document.getElementById('yeniPersonelEkleKutusu').style.display = 'none';
            kullanicilariListele(); // Listeyi anında tazele
        } else {
            const data = await res.json();
            alert("❌ Hata: " + data.hata);
        }
    } catch(err) { alert("Bağlantı hatası!"); }
};

// 6. Kullanıcıyı Sil
window.kullaniciSil = async function(id, adSoyad) {
    if(!confirm(`⚠️ DİKKAT: ${adSoyad} isimli kullanıcının sisteme erişimi tamamen kesilecek! Onaylıyor musunuz?`)) return;

    try {
        const res = await fetch(`/api/kullanici/${id}`, { method: 'DELETE' });
        if(res.ok) {
            alert("🗑️ Kullanıcı sistemden silindi.");
            kullanicilariListele(); // Listeyi anında tazele
        }
    } catch (err) { alert("Bağlantı hatası!"); }
};

// DÜZELTME: Sayfa yüklenirken kullanıcı adını (kısa olanı) da hafızaya almalıyız
document.addEventListener('DOMContentLoaded', () => {
    const ad = localStorage.getItem('aktifKullanici');
    const yetki = localStorage.getItem('kullaniciYetki');
    if(ad) {
        document.getElementById('navbarKullaniciAd').innerText = ad;
        document.getElementById('navbarKullaniciYetki').innerText = yetki === 'Admin' ? '👑 Yönetici' : '👤 Personel';
    }
});

// =======================================================
// 🔍 EVRENSEL RAPOR ARAMA MOTORU (Hem Vade Hem Borç İçin)
// =======================================================
// =======================================================
// 🔍 EVRENSEL RAPOR ARAMA MOTORU (Hem Vade Hem Borç İçin)
// =======================================================
window.raporTablosundaAra = function() {
    const input = document.getElementById('raporAramaKutusu');
    if (!input) return;

    const filter = input.value.toLocaleLowerCase('tr-TR');
    const rows = document.querySelectorAll('#raporTabloGovdesi tr');

    let gorunurSayisi = 0;

    rows.forEach(row => {
        const metin = row.innerText || "";
        if (metin.includes('Hesaplanıyor') || metin.includes('bulunamadı') || metin.includes('Yükleniyor')) return; 

        if (metin.toLocaleLowerCase('tr-TR').includes(filter)) {
            row.style.display = ""; 
            gorunurSayisi++;
        } else {
            row.style.display = "none"; 
        }
    });

    const kayitKutusu = document.getElementById('vadeKayitSayisi');
    if (kayitKutusu) kayitKutusu.innerText = gorunurSayisi;
};
// =======================================================
// 🧹 MODAL KAPANINCA ARAMA KUTULARINI OTOMATİK TEMİZLE
// =======================================================
document.addEventListener('hidden.bs.modal', function (event) {
    // Kapanan pencerenin (modalın) içindeki tüm inputları bul
    const aramaKutulari = event.target.querySelectorAll('input');
    
    aramaKutulari.forEach(kutu => {
        // Eğer kutunun ID'sinde "arama" veya "Arama" kelimesi geçiyorsa içini boşalt
        // (Böylece raporAramaKutusu, cariAramaKutusu gibi hepsi otomatik temizlenir)
        if (kutu.id && kutu.id.toLowerCase().includes('arama')) {
            kutu.value = '';
        }
    });
});
// 1. Modalı Aç ve Ürünleri Yükle
let aktifAlimId = null; // Yeni mi yoksa düzenleme mi yapıyoruz onu tutacak

// 1. Yeni Kayıt İçin Modalı Aç
window.malAlimModalAc = async function() {
    aktifAlimId = null; // Sıfırla (Yeni kayıt modu)
    document.getElementById('malAlimFormu').reset();
    document.getElementById('alimToplamTutarGosterge').innerText = "0,00 ₺";
    
    // YENİ: Form açıldığında birim yazısını da sıfırla ki eski fişten kalmasın
    const birimGosterge = document.getElementById('alimBirimGosterge');
    if(birimGosterge) birimGosterge.innerText = "(?)";
    
    // Tarihi Bugüne Ayarla
    document.getElementById('alimTarih').value = new Date().toISOString().split('T')[0];

    // Kutuları yükleniyor moduna al
    const urunSelect = document.getElementById('alimUrunSec');
    const tedarikciSelect = document.getElementById('alimTedarikci');
    
    urunSelect.innerHTML = '<option value="">Yükleniyor...</option>';
    tedarikciSelect.innerHTML = '<option value="">Yükleniyor...</option>';
    
    guvenliModalAc('malAlimModal');

    try {
        // 1. Toptancıları (Tedarikçileri) Veritabanından Çek
        const resTedarikci = await fetch('/api/tedarikciler');
        const tedarikciler = await resTedarikci.json();
        
        tedarikciSelect.innerHTML = '<option value="" disabled selected>--- Toptancı Seçin ---</option>';
        tedarikciler.forEach(t => {
            // Arka planda ID'yi tutar, ekranda Firma Adını gösterir
            tedarikciSelect.innerHTML += `<option value="${t.ID}">${t.FirmaAdi}</option>`;
        });

        // 2. Ürünleri (Kömürleri) Veritabanından Çek
        const resUrun = await fetch('/api/komur');
        const urunler = await resUrun.json();
        
        urunSelect.innerHTML = '<option value="" disabled selected>--- Ürün Seçin ---</option>';
        urunler.forEach(u => {
            // BURASI DÜZELTİLDİ: data-birim ile ürünün birimi arka planda kutuya saklanıyor!
            urunSelect.innerHTML += `<option value="${u.id || u.ID}" data-birim="${u.Birim || 'Ton'}">${u.cins || u.UrunAdi}</option>`;
        });

    } catch (err) { 
        console.error("Yükleme Hatası:", err);
        alert("Veriler yüklenemedi! Bağlantıyı kontrol edin."); 
    }
};
// 2. Anlık Tutar Hesaplama
window.alimHesapla = function() {
    const m = parseFloat(document.getElementById('alimMiktar').value) || 0;
    const f = parseFloat(document.getElementById('alimBirimFiyat').value) || 0;
    document.getElementById('alimToplamTutarGosterge').innerText = (m * f).toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺";
};

// 3. Veritabanına Kaydetme (Hem YENİ hem DÜZENLEME yapar)
// --- YENİ KAYIT VE GÜNCELLEME (HEM ID HEM FİRMA ADI GİDER) ---
window.malAlimiKaydet = async function() {
    const tarih = document.getElementById('alimTarih').value;
    
    // BURASI DÜZELTİLDİ: Hem ID'yi hem de Ekranda Yazan Firma Adını alıyoruz
    const tedarikciSelect = document.getElementById('alimTedarikci');
    const tedarikciId = tedarikciSelect.value;
    const tedarikciFirma = tedarikciSelect.options[tedarikciSelect.selectedIndex]?.text || '';

    const urunId = document.getElementById('alimUrunSec').value;
    const miktar = parseFloat(document.getElementById('alimMiktar').value);
    const birimFiyat = parseFloat(document.getElementById('alimBirimFiyat').value);
    const odeme = document.getElementById('alimOdemeDurumu').value;
    const aciklama = document.getElementById('alimAciklama').value;

    if(!tarih || !tedarikciId || !urunId || miktar <= 0 || birimFiyat <= 0) {
        alert("Lütfen tüm alanları eksiksiz doldurun!"); return;
    }

    const url = aktifAlimId ? `/api/mal-alimi/${aktifAlimId}` : '/api/mal-alimi';
    const method = aktifAlimId ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tarih, 
                tedarikciId,    // Veritabanı ID'si için
                tedarikciFirma, // Ekranda yazan isim için
                urunId, miktar, birimFiyat, odeme, aciklama,
                islemiYapan: localStorage.getItem('aktifKullanici') || 'Sistem'
            })
        });

       if(res.ok) {
            alert(aktifAlimId ? "✅ Kayıt güncellendi!" : "✅ Malzeme girişi yapıldı.");
            
            // ESKİ KOD SİLİNDİ, YENİ GERİ DÖNÜŞ MOTORU EKLENDİ
            malAlimindanGeriDon(); 
            
            if(typeof stoklariYukle === 'function') stoklariYukle(); 
            const gecmisModal = document.getElementById('alimGecmisiModal');
            if(gecmisModal && gecmisModal.classList.contains('show')) alimGecmisiYukle();
        } else {
            const h = await res.json(); alert("Hata: " + h.hata);
        }
    } catch (err) { alert("Bağlantı hatası!"); }
};

// 4. Geçmiş Tablosunu Yükleme ve Çizme
window.alimGecmisiYukle = async function() {
    guvenliModalAc('alimGecmisiModal');
    const tablo = document.getElementById('alimGecmisiTablosu');
    tablo.innerHTML = '<tr><td colspan="8" class="text-center py-4">Yükleniyor...</td></tr>';

    try {
        const res = await fetch('/api/mal-alimlari');
        const alimlar = await res.json();
        
        tablo.innerHTML = '';
        if(alimlar.length === 0) {
            tablo.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Henüz bir mal alımı yapılmamış.</td></tr>';
            return;
        }

        alimlar.forEach(a => {
            // Tarihi arayüze ve butona uygun formatlama
            let gosterilecekTarih = "Tarih Yok";
            let hamTarih = "";
            if(a.Tarih) {
                const d = new Date(a.Tarih);
                gosterilecekTarih = d.toLocaleDateString('tr-TR');
                hamTarih = a.Tarih.split('T')[0]; // 2026-04-23 formatı (Kutular için lazım)
            }
            
            const miktar = parseFloat(a.Miktar).toLocaleString('tr-TR');
            const birim = parseFloat(a.BirimMaliyet).toLocaleString('tr-TR', {minimumFractionDigits:2});
            const toplam = parseFloat(a.ToplamTutar).toLocaleString('tr-TR', {minimumFractionDigits:2});
            const odemeBadge = a.OdemeDurumu === 'Peşin' ? '<span class="badge bg-success">Peşin</span>' : '<span class="badge bg-warning text-dark">Açık Hesap</span>';
            const temizAciklama = (a.Aciklama === 'null' || !a.Aciklama) ? '' : a.Aciklama;

            tablo.innerHTML += `
                <tr>
                    <td class="text-muted small fw-bold">${gosterilecekTarih}</td>
                    <td class="fw-bold">${a.TedarikciFirma}</td>
                    <td class="text-primary fw-bold">${a.UrunAdi || 'Bilinmeyen Ürün'}</td>
                    <td class="text-center fw-bold fs-6">${miktar}</td>
                    <td class="text-end text-danger">${birim} ₺</td>
                    <td class="text-end fw-bold text-dark">${toplam} ₺</td>
                    <td class="text-center">${odemeBadge}</td>
                    <td class="text-center text-nowrap">
                        <button class="btn btn-sm btn-outline-warning shadow-sm me-1" 
                                onclick="alimDuzenleAc(${a.ID}, '${hamTarih}', '${a.TedarikciFirma}', ${a.UrunID}, ${a.Miktar}, ${a.BirimMaliyet}, '${a.OdemeDurumu}', '${encodeURIComponent(temizAciklama)}')" title="Düzenle">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger shadow-sm" onclick="alimSil(${a.ID}, '${a.UrunAdi}', ${a.Miktar})" title="Fişi İptal Et">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    } catch (err) { tablo.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">Veriler çekilemedi!</td></tr>'; }
};

// 5. DÜZENLEME İÇİN Modalı Aç
window.alimDuzenleAc = async function(id, tarih, firma, urunId, miktar, birimFiyat, odemeDurumu, aciklamaEncoded) {
    await malAlimModalAc(); // Önce formu ve ürünleri yükle
    aktifAlimId = id; // Sistemi Düzenleme Moduna Al
    
    // Gelen verileri kutulara doldur
    document.getElementById('alimTarih').value = tarih;
    document.getElementById('alimTedarikci').value = firma;
    document.getElementById('alimUrunSec').value = urunId;
    document.getElementById('alimMiktar').value = miktar;
    document.getElementById('alimBirimFiyat').value = birimFiyat;
    document.getElementById('alimOdemeDurumu').value = odemeDurumu;
    document.getElementById('alimAciklama').value = decodeURIComponent(aciklamaEncoded);
    
    alimHesapla(); 
};

// 6. Alım Fişi Silme ve Stoktan Düşme
window.alimSil = async function(id, urunAdi, miktar) {
    if(!confirm(`DİKKAT!\nBu alım fişini silerseniz, ${miktar} adet/ton ${urunAdi} stoklarınızdan DÜŞÜLECEKTİR!\n\nOnaylıyor musunuz?`)) return;

    try {
        const res = await fetch(`/api/mal-alimi/${id}`, { method: 'DELETE' });
        if(res.ok) {
            alert("✅ Alım fişi iptal edildi ve stoklar güncellendi.");
            alimGecmisiYukle(); // Tabloyu yenile
            if(typeof stoklariYukle === "function") stoklariYukle(); // Arka plandaki ana stoğu yenile
        }
    } catch (err) { alert("Silme işlemi başarısız!"); }
};

// --- 1. TOPTANCILARI VERİTABANINDAN ÇEKİP LİSTELEME ---
window.tedarikcileriYukle = async function() {
    guvenliModalAc('tedarikcilerModal');
    const tablo = document.getElementById('tedarikciListesiGövdesi');
    tablo.innerHTML = '<tr><td colspan="5" class="text-center py-4">Yükleniyor...</td></tr>';
    
    try {
        const res = await fetch('/api/tedarikciler');
        const veriler = await res.json();
        
        tablo.innerHTML = '';
        if(veriler.length === 0) {
            tablo.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Sistemde henüz toptancı yok.</td></tr>'; 
            return;
        }
        
        veriler.forEach(t => {
            const bakiye = parseFloat(t.Bakiye || 0);
            // Bizim onlara borcumuz varsa Kırmızı (Borç), Onların bize borcu varsa Yeşil (Alacak)
            const bakiyeRenk = bakiye > 0 ? 'text-danger' : (bakiye < 0 ? 'text-success' : 'text-dark');
            const bakiyeYazi = bakiye > 0 ? '(Borcumuz)' : (bakiye < 0 ? '(Alacağımız)' : '');
            
            tablo.innerHTML += `
                <tr>
                    <td class="fw-bold">${t.FirmaAdi}</td>
                    <td>${t.YetkiliKisi || '-'}</td>
                    <td>${t.Telefon || '-'}</td>
                    <td class="text-end fw-bold ${bakiyeRenk}">
                        ${Math.abs(bakiye).toLocaleString('tr-TR', {minimumFractionDigits:2})} ₺ <br>
                        <small class="text-muted">${bakiyeYazi}</small>
                    </td>
                    <td class="text-center">

<button class="btn btn-sm btn-info text-white shadow-sm" onclick="tedarikciDetayYukle(${t.ID}, '${t.FirmaAdi}')" title="Hesap Hareketleri">
    <i class="fas fa-list"></i> Detay
</button>
                    </td>
                </tr>
            `;
        });
    } catch(e) { tablo.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Yüklenemedi!</td></tr>'; }
};

// --- 2. YENİ TOPTANCIYI KAYDETME (BUTONA BASINCA ÇALIŞAN KOD) ---
window.tedarikciKaydet = async function() {
    const firmaAdi = document.getElementById('yeniTedarikciFirma').value;
    const yetkili = document.getElementById('yeniTedarikciYetkili').value;
    const tel = document.getElementById('yeniTedarikciTel').value;
    const aciklama = document.getElementById('yeniTedarikciAciklama').value;

    if(!firmaAdi) { alert("Firma adı zorunludur!"); return; }

    try {
        const res = await fetch('/api/tedarikci', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firmaAdi, yetkili, tel, aciklama })
        });

        if(res.ok) {
            alert("✅ Yeni toptancı başarıyla eklendi!");
            modalZorlaKapat('tedarikciEkleModal'); // Ekleme ekranını kapat
            document.getElementById('tedarikciEkleFormu').reset(); // Formu temizle
            tedarikcileriYukle(); // Arka plandaki listeyi hemen güncelle!
        } else {
            const h = await res.json(); alert("Hata: " + h.hata);
        }
    } catch(err) { alert("Bağlantı hatası!"); }
};

// --- TOPTANCI HESAP HAREKETLERİNİ DOLDURMA ---
let aktifTedarikciId = null;

window.tedarikciDetayYukle = async function(id, firmaAdi) {
    aktifTedarikciId = id;
    document.getElementById('detayTedarikciAdi').innerText = firmaAdi + " - Hesap Özeti";
    guvenliModalAc('tedarikciDetayModal');

    const tablo = document.getElementById('tedarikciHareketGövdesi');
    tablo.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner-border text-secondary mb-2"></div><br>Yükleniyor...</td></tr>';

    try {
        // 🚀 İŞTE ALTIN VURUŞ: Chrome'un önbelleğini ezip geçmesi için sonuna saat damgası ekledik!
        const res = await fetch(`/api/tedarikci-hareketleri/${id}?_t=` + new Date().getTime());
        const hareketler = await res.json();

        tablo.innerHTML = '';
        if(hareketler.length === 0) {
            tablo.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Henüz bir hesap hareketi yok.</td></tr>';
            document.getElementById('ozetToplamBorc').innerText = "0,00 ₺";
            document.getElementById('ozetToplamOdeme').innerText = "0,00 ₺";
            document.getElementById('ozetGuncelBakiye').innerText = "0,00 ₺";
            document.getElementById('ozetGuncelBakiye').className = "h4 mb-0 fw-bold";
            return;
        }

        let tBorc = 0;
        let tOdeme = 0;
        let yuruyenBakiye = 0;
        
        hareketler.forEach(h => {
            tBorc += h.Borc;
            tOdeme += h.Odeme;
            yuruyenBakiye += (h.Borc - h.Odeme); 

            const tarih = new Date(h.Tarih).toLocaleDateString('tr-TR');
            
            const miktarTxt = h.Miktar ? `<span class="badge bg-secondary">${h.Miktar}</span>` : '<span class="text-muted">-</span>';
            const birimTxt = h.BirimFiyat ? h.BirimFiyat.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺" : '<span class="text-muted">-</span>';
            
            const borcTxt = h.Borc > 0 ? h.Borc.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺" : "-";
            const odemeTxt = h.Odeme > 0 ? h.Odeme.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺" : "-";
            
            // --- ID VE TÜR YAKALAYICI ---
            const islemId = h.ID; 
            const islemTur = h.Tur; // 'ALIM' veya 'ODEME' gelecek
            
            const silButon = `<button class="btn btn-sm btn-outline-danger shadow-sm ms-1" onclick="tedarikciHareketSil(${islemId}, '${islemTur}')" title="Bu hareketi sil"><i class="fas fa-trash-alt"></i></button>`;

            tablo.innerHTML += `
                <tr class="align-middle">
                    <td class="text-muted small">${tarih}</td>
                    <td class="fw-bold">${h.Islem}</td>
                    <td class="text-center">${miktarTxt}</td>      
                    <td class="text-end text-muted">${birimTxt}</td> 
                    <td class="text-end text-danger fw-bold">${borcTxt}</td>
                    <td class="text-end text-success fw-bold">${odemeTxt}</td>
                    <td class="text-muted small">${h.Aciklama || '-'}</td>
                    <td class="text-center">${silButon}</td>
                </tr>
            `;
        });

        // Üst Özet Panelini Güncelle
        document.getElementById('ozetToplamBorc').innerText = tBorc.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺";
        document.getElementById('ozetToplamOdeme').innerText = tOdeme.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺";
        document.getElementById('ozetGuncelBakiye').innerText = yuruyenBakiye.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺";
        document.getElementById('ozetGuncelBakiye').className = yuruyenBakiye > 0 ? "h4 mb-0 text-danger fw-bold" : "h4 mb-0 text-success fw-bold";

    } catch (e) { 
        tablo.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Hata oluştu!</td></tr>'; 
    }
};

// =========================================================
// 🗑️ TEDARİKÇİ HAREKETİ SİLME MOTORU (KALMASI GEREKEN KOD)
// =========================================================
window.tedarikciHareketSil = async function(hareketId, tur) {
    if (!confirm(`⚠️ DİKKAT: Bu ${tur === 'ALIM' ? 'Alım İşlemini' : 'Ödeme İşlemini'} silmek istediğinize emin misiniz?`)) return; 

    try {
        const res = await fetch(`/api/tedarikci-hareket/${hareketId}?tur=${tur}`, { method: 'DELETE' });

        // İŞTE BURASI: Birebir senin gönderdiğin o tıkır tıkır çalışan yapı!
        if(res.ok) {
            alert("✅ İşlem başarıyla silindi!");
            
            // 1. Tıpkı malAlimindanGeriDon() gibi tedarikçi sayfasını tazeler
            const firmaAdi = document.getElementById('detayTedarikciAdi').innerText.split(' -')[0];
            tedarikciDetayYukle(aktifTedarikciId, firmaAdi); 
            
            // 2. Tıpkı senin kodundaki gibi stokları anında yükler
            if(typeof stoklariYukle === 'function') stoklariYukle(); 
            
            // 3. Geçmiş modalı açıksa onu da tazeler
            const gecmisModal = document.getElementById('alimGecmisiModal');
            if(gecmisModal && gecmisModal.classList.contains('show')) {
                if(typeof alimGecmisiYukle === 'function') alimGecmisiYukle();
            }

            // Ekstra: Üstteki kasa/özet kutularını da güncelleyelim
            if(typeof ozetBilgileriYukle === 'function') ozetBilgileriYukle();

        } else {
            const h = await res.json(); 
            alert("Hata: " + (h.hata || "İşlem silinemedi"));
        }
    } catch (err) { 
        alert("Bağlantı hatası!"); 
    }
};

// =========================================================
// 👁️ DİNLEYİCİLER (EVENT LISTENERS) - SAYFA YÜKLENDİĞİNDE ÇALIŞIR
// =========================================================
document.addEventListener('DOMContentLoaded', function() {
    
    // Toptancı Mal Alım Ekranında Ürün Seçilince Birimi Değiştir
    const urunSecKutusu = document.getElementById('alimUrunSec');
    if (urunSecKutusu) {
        urunSecKutusu.addEventListener('change', function() {
            const seciliOption = this.options[this.selectedIndex];
            const birim = seciliOption.getAttribute('data-birim') || 'Ton'; // Birim yoksa varsayılan Ton
            const gosterge = document.getElementById('alimBirimGosterge');
            
            if (gosterge) {
                gosterge.innerText = "(" + birim + ")";
            }
        });
    }

});
// --- ÇUVALLAMA EKRANINI AÇ VE ÜRÜNLERİ DOLDUR ---
window.paketlemeModalAc = async function() {
    document.getElementById('paketlemeFormu').reset();
    
    const kaynakSelect = document.getElementById('paketlemeKaynakUrun');
    const hedefSelect = document.getElementById('paketlemeHedefUrun');
    
    kaynakSelect.innerHTML = '<option value="">Yükleniyor...</option>';
    hedefSelect.innerHTML = '<option value="">Yükleniyor...</option>';
    
    guvenliModalAc('paketlemeModal');

    try {
        const res = await fetch('/api/komur');
        const urunler = await res.json();
        
        let optionsHtml = '<option value="" disabled selected>--- Ürün Seçin ---</option>';
        urunler.forEach(u => {
            optionsHtml += `<option value="${u.id || u.ID}">${u.cins || u.UrunAdi} (${u.BaslangicStogu} ${u.Birim || 'Stok'})</option>`;
        });

        kaynakSelect.innerHTML = optionsHtml;
        hedefSelect.innerHTML = optionsHtml;
    } catch (err) { alert("Ürünler yüklenemedi!"); }
};

// --- ÇUVALLAMA / TRANSFER İŞLEMİNİ KAYDET ---
window.paketlemeKaydet = async function() {
    const kaynakUrunId = document.getElementById('paketlemeKaynakUrun').value;
    const eksilenMiktar = parseFloat(document.getElementById('paketlemeEksilenMiktar').value);
    const hedefUrunId = document.getElementById('paketlemeHedefUrun').value;
    const artanMiktar = parseFloat(document.getElementById('paketlemeArtanMiktar').value);

    if(!kaynakUrunId || !hedefUrunId || eksilenMiktar <= 0 || artanMiktar <= 0) {
        alert("Lütfen tüm alanları geçerli şekilde doldurun!"); return;
    }
    if(kaynakUrunId === hedefUrunId) {
        alert("Aynı ürünü kendine transfer edemezsiniz!"); return;
    }

    try {
        const res = await fetch('/api/stok-paketleme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kaynakUrunId, eksilenMiktar, hedefUrunId, artanMiktar })
        });

        if(res.ok) {
            alert("✅ Paketleme/Transfer işlemi başarıyla tamamlandı!");
            modalZorlaKapat('paketlemeModal');
            if(typeof stoklariYukle === 'function') stoklariYukle(); // Ana sayfadaki stokları hemen güncelle
        } else {
            const h = await res.json(); alert("Hata: " + h.hata);
        }
    } catch (err) { alert("Bağlantı hatası!"); }
};

// Detay ekranından ödeme yapma formunu açar
window.tedarikciOdemeModalAc = function() {
    const firmaAdi = document.getElementById('detayTedarikciAdi').innerText.split(' - ')[0];
    document.getElementById('odemeFirmaAdi').value = firmaAdi;
    
    // YENİ EKLENDİ: Ekran açılırken tarihi otomatik bugüne ayarla
    document.getElementById('odemeTarih').value = new Date().toISOString().split('T')[0];

    guvenliModalAc('tedarikciOdemeModal');
};

// Detay ekranından direkt o toptancı seçili şekilde mal alımını açar
window.detaydanMalAliminiAc = function() {
    modalZorlaKapat('tedarikciDetayModal'); // Önce detayı kapat
    setTimeout(() => {
        malAlimModalAc(); // Mal alım formunu aç
        // Form açıldıktan sonra o toptancıyı otomatik seçelim (JS ile biraz gecikmeli yapmak gerekebilir)
        setTimeout(() => {
            document.getElementById('alimTedarikci').value = aktifTedarikciId;
        }, 500);
    }, 300);
};

// Ödemeyi Veritabanına Kaydet
window.tedarikciOdemeKaydet = async function() {
    // 1. Kutulardaki tüm verileri topla
    const tarih = document.getElementById('odemeTarih').value; // Tarihi aldık!
    const tutar = parseFloat(document.getElementById('odemeTutari').value);
    const tur = document.getElementById('odemeTuru').value;
    const aciklama = document.getElementById('odemeAciklama').value;

    if(!tarih || !tutar || tutar <= 0) { 
        alert("Lütfen tarih ve geçerli bir tutar girin!"); 
        return; 
    }

    try {
        const res = await fetch('/api/tedarikci-odeme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 2. TARİHİ DE PAKETE (BODY) EKLEYİP GÖNDERİYORUZ
            body: JSON.stringify({ tedarikciId: aktifTedarikciId, tarih: tarih, tutar: tutar, tur: tur, aciklama: aciklama }) 
        });

        if(res.ok) {
            alert("✅ Ödeme başarıyla kaydedildi.");
            odemeEkranindanGeriDon(); 
        } else {
            alert("Hata oluştu, kaydedilemedi.");
        }
    } catch (err) { alert("Bağlantı hatası!"); }
};

// --- MAL ALIMINDAN TOPTANCI DETAYINA GERİ DÖNÜŞ MOTORU ---
window.malAlimindanGeriDon = function() {
    // 1. Önce mal alım modalını güvenlice kapat
    modalZorlaKapat('malAlimModal');

    // 2. Kapanma animasyonunun bitmesi için azıcık (400ms) bekle
    setTimeout(() => {
        const tedarikciSelect = document.getElementById('alimTedarikci');
        // Ekranda seçili olan firmanın adını ve ID'sini yakala
        const seciliId = tedarikciSelect.value || aktifTedarikciId; 
        const seciliFirma = tedarikciSelect.options[tedarikciSelect.selectedIndex]?.text || "Hesap Özeti";

        // Eğer bir toptancı seçiliyse onun ekstresini geri yükle
        if (seciliId) {
            tedarikciDetayYukle(seciliId, seciliFirma);
        }
    }, 400); 
};
// --- ÖDEME EKRANINDAN TOPTANCI DETAYINA GERİ DÖNÜŞ MOTORU ---
window.odemeEkranindanGeriDon = function() {
    // 1. Ödeme modalını kapat
    modalZorlaKapat('tedarikciOdemeModal');

    // 2. Animasyon bitsin diye azıcık bekle, sonra ekstreyi geri yükle
    setTimeout(() => {
        const firmaAdi = document.getElementById('odemeFirmaAdi').value;
        if (typeof aktifTedarikciId !== 'undefined' && aktifTedarikciId) {
            tedarikciDetayYukle(aktifTedarikciId, firmaAdi);
        }
    }, 400); 
};

// --- MAKBUZ NUMARATÖRÜ VE YAZDIRMA MOTORU ---
// İleride bunu veritabanından çekeceğiz, şimdilik buradan başlatıyoruz.
let guncelMakbuzNo = 4164; 

// 🖨️ MAKBUZ YAZDIRMA MOTORU (A4 ÜZERİNE 2 KOPYA)
// =========================================================
window.makbuzYazdir = function(musteriAdi, tutar, odemeTuru, tarih, makbuzNo, eskiBakiye, yapan) {
    // --- 1. RESMİ İSİM SEÇİCİ (KİMLİK TABLOSU ÖNCELİKLİ) ---
    let resmiIsim = "";
    
    // Öncelik 1: Unvan (KARAARSLAN TİC. LTD. ŞTİ. vb.)
    if (typeof aktifMusteriUnvan !== 'undefined' && aktifMusteriUnvan && aktifMusteriUnvan !== 'null' && aktifMusteriUnvan.trim() !== "") {
        resmiIsim = aktifMusteriUnvan;
    } 
    // Öncelik 2: Adı + Soyadı (RAMAZAN BAĞIŞ vb.)
    else if (typeof aktifMusteriAdiResmi !== 'undefined' && aktifMusteriAdiResmi && aktifMusteriAdiResmi !== 'null' && aktifMusteriAdiResmi.trim() !== "") {
        resmiIsim = aktifMusteriAdiResmi + " " + (aktifMusteriSoyadiResmi || "");
    } 
    // Öncelik 3: Hiçbiri yoksa rehberdeki dükkan ismi (faret amcanın oğlu...)
    else {
        resmiIsim = musteriAdi; 
    }

    // İsmi her zaman BÜYÜK HARF ve Türkçe 'İ' harfini koruyarak temizle
    const basilacakIsim = resmiIsim.replace(/i/g, 'İ').toUpperCase().trim();

    // --- 2. HESAPLAMALAR VE FORMATLAR ---
    const formatliNo = (makbuzNo === '---' || !makbuzNo) ? '---' : String(makbuzNo).padStart(6, '0');
    const odenen = parseFloat(tutar) || 0;
    const yeniKalan = (parseFloat(eskiBakiye) || 0) - odenen;
    const tutarMetni = sayiyiYaziyaCevir(odenen); 

    const isIade = odemeTuru.toUpperCase().includes("İADE");
    
    // Tarih Formatı Temizleme
    let temizTarih = tarih;
    if (tarih && tarih.includes('T')) {
        temizTarih = tarih.split('T')[0].split('-').reverse().join('.');
    } else if (tarih && tarih.includes('-')) {
        temizTarih = tarih.split('-').reverse().join('.');
    }

    // --- 3. MAKBUZ PARÇALARINI DOLDURMA ---
    [1, 2].forEach(i => {
    const setVal = (id, val) => {
        const el = document.getElementById(`m${i}_${id}`);
        if (el) el.innerText = val;
    };

    setVal('baslik', isIade ? "İADE ALIMI" : "PARA MAKBUZU");
    setVal('isim', basilacakIsim);

    // 🚀 İŞTE BURASI: Artık "Nakit" yazmak yerine "1/3 Taksit (Kısmi Ödeme, Kalan: 100 TL)" yazacak!
    setVal('aciklama', odemeTuru);

        const kalanSatiri = document.getElementById(`m${i}_kalanSatiri`);
        if (isIade) {
            if (kalanSatiri) kalanSatiri.style.display = 'none';
            setVal('iadeNotu', "İADE ALINDI");
            setVal('tutarYazi', tutarMetni + " iade alınmıştır.");
        } else {
            if (kalanSatiri) kalanSatiri.style.display = 'block';
            setVal('iadeNotu', "");
            setVal('kalan', yeniKalan.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + " ₺");
            setVal('tutarYazi', tutarMetni + " alınmıştır.");
        }

        setVal('no', formatliNo);
        setVal('tarih', temizTarih);
        
        const turAlt = odemeTuru.toLowerCase();
        const tutarFormatli = odenen.toLocaleString('tr-TR', {minimumFractionDigits:2}) + " ₺";
        
        // Ödeme türlerini daha net ayrıştıran mantık
        setVal('nakit', (turAlt.includes("nakit") || isIade) ? tutarFormatli : "");
        setVal('kart', turAlt.includes("kart") ? tutarFormatli : "");
        setVal('havale', (turAlt.includes("havale") || turAlt.includes("eft")) ? tutarFormatli : "");
        setVal('teslimAlan', yapan || 'SİSTEM'); 
    });

    // --- 4. YAZDIRMA ---
    const printAlani = document.getElementById('makbuzPrintAlani');
    if (printAlani) {
        printAlani.style.display = 'flex';
        setTimeout(() => {
            window.print();
            printAlani.style.display = 'none';
        }, 500); 
    }
};
// --- RAKAMI YAZIYA ÇEVİRME MOTORU (DEĞİŞMEDİ) ---
function sayiyiYaziyaCevir(n) {
    if (n == 0) return "Sıfır";
    const birler = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
    const onlar = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Atmış", "Yetmiş", "Seksen", "Doksan"];
    const binler = ["", "Bin", "Milyon", "Milyar"];
    
    let tl = Math.floor(n);
    let krs = Math.round((n - tl) * 100);
    
    function uclu(s) {
        let sonuc = "";
        if (Math.floor(s / 100) > 0) {
            sonuc += (Math.floor(s / 100) == 1 ? "" : birler[Math.floor(s / 100)]) + "Yüz";
        }
        let o = Math.floor((s % 100) / 10);
        let b = s % 10;
        sonuc += onlar[o] + birler[b];
        return sonuc;
    }

    let tlSonuc = "";
    if (tl == 0) tlSonuc = "";
    else if (tl < 1000) tlSonuc = uclu(tl);
    else {
        let bin = Math.floor(tl / 1000);
        let artakalan = tl % 1000;
        tlSonuc = (bin == 1 ? "" : uclu(bin)) + "Bin" + uclu(artakalan);
    }

    let final = tlSonuc + " TL";
    if (krs > 0) final += " " + uclu(krs) + " Kuruş";
    
    return final;
}

// =========================================================
// ⚙️ TANIMLAMALAR VE AYARLAR (FRONTEND)
// =========================================================

// Sistemin bu modalı da tanıması için listeye ekleyelim
if (window.sistemdekiTumModallar && !window.sistemdekiTumModallar.includes('tanimlamalarModal')) {
    window.sistemdekiTumModallar.push('tanimlamalarModal');
}

// Admin girerse Ayarlar butonunu göster
document.addEventListener('DOMContentLoaded', () => {
    const yetki = localStorage.getItem('kullaniciYetki');
    if (yetki === 'Admin') {
        const ayarBtn = document.getElementById('btnTanimlamalar');
        if(ayarBtn) ayarBtn.classList.remove('d-none');
    }
});




// Ayarları Sunucuya Gönder
window.ayarlariKaydet = async function() {
    const basNo = document.getElementById('ayarMakbuzBaslangic').value;
    const otoSelect = document.getElementById('ayarOtoMakbuz');
    const otoMakbuz = otoSelect ? otoSelect.value : "true";
    
    if(!basNo || basNo <= 0) { alert("Lütfen geçerli bir başlangıç numarası girin."); return; }

    try {
        await fetch('/api/ayar-guncelle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anahtar: 'MakbuzBaslangicNo', deger: basNo })
        });

        await fetch('/api/ayar-guncelle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anahtar: 'MakbuzOtomatikYazdir', deger: otoMakbuz })
        });

        localStorage.setItem('ayarOtoMakbuz', otoMakbuz); // Güncel ayarı hafızaya çak
        
        alert("✅ Sistem ayarları başarıyla kaydedildi!");
        modalZorlaKapat('tanimlamalarModal');
    } catch(e) { 
        alert("⚠️ Bağlantı hatası!"); 
    }
};
window.iadeOnizlemeYazdir = function(makbuzNo, tutar, tarih, aciklama, miktar = "", birim = "") {
    
    // 1. ŞİFREYİ ÇÖZ 
    let temizAciklama = "";
    try {
        temizAciklama = decodeURIComponent(aciklama);
    } catch (e) {
        temizAciklama = aciklama;
    }

    // 🌟 YENİ: Miktar ve Birim varsa açıklamaya jilet gibi ekle
    let miktarEk = "";
    if (miktar && parseFloat(miktar) > 0) {
        let temizBirim = (birim && birim !== "-" && birim !== "null") ? birim : "Adet/Çuval";
        miktarEk = ` - ${miktar} ${temizBirim}`;
    }

    // 2. TARİHİ KUSURSUZ FORMATLA 
    let mTar = tarih;
    if(tarih) {
        let sadeceTarih = tarih.split('T')[0].split(' ')[0]; 
        if(sadeceTarih.includes('-')) {
            const parca = sadeceTarih.split('-'); 
            if(parca.length === 3) mTar = `${parca[2]}.${parca[1]}.${parca[0]}`; 
        } else {
            mTar = sadeceTarih;
        }
    }

    // 3. İŞLEMİ YAPAN PERSONELİ HAFIZADAN ÇEK
    const aktifPersonel = localStorage.getItem('aktifKullanici') || 'SİSTEM';

    // 4. MAKBUZ YAZDIRMA MOTORUNU TETİKLE
    if (typeof makbuzYazdir === 'function') {
        makbuzYazdir(
            aktifMusteriAd, 
            tutar, 
            "ÜRÜN İADESİ (" + temizAciklama + miktarEk + ")", 
            mTar, 
            makbuzNo || '---', 
            0, 
            aktifPersonel
        );
    }
};
// =================================================================
// 💳 1. AKILLI ÖDEME SEÇİM EKRANI (MİKTAR DEĞİŞTİRİLEBİLİR)
// =================================================================
window.taksitOdemeTuruSec = function(id, tutar, aciklama) {
    let oldModal = document.getElementById('taksitOdemeTuruModal');
    if (oldModal) oldModal.remove();

    // Yeni modal (İçinde tutarı değiştirebileceğin input var)
    const modalHtml = `
    <div class="modal fade" id="taksitOdemeTuruModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content border-0 shadow-lg">
                <div class="modal-header bg-success text-white py-2">
                    <h6 class="modal-title fw-bold"><i class="fas fa-wallet me-1"></i> Tahsilat Girişi</h6>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body text-center">
                    <p class="mb-2 text-muted small">Beklenen Taksit: <strong>${tutar.toLocaleString('tr-TR')} ₺</strong></p>
                    
                    <div class="input-group mb-3 shadow-sm">
                        <span class="input-group-text bg-light fw-bold text-success">₺</span>
                        <input type="number" id="gercekOdenenTutar" class="form-control form-control-lg text-center fw-bold text-dark" value="${tutar}" step="0.01">
                    </div>

                    <p class="mb-2 text-muted small">Alınan Paranın Türünü Seçin:</p>
                    <div class="d-grid gap-2">
                        <button class="btn btn-outline-success fw-bold" onclick="odemeIsleminiBaslat(${id}, '${aciklama}', 'Nakit')"><i class="fas fa-money-bill-wave me-2"></i> Nakit İşle</button>
                        <button class="btn btn-outline-primary fw-bold" onclick="odemeIsleminiBaslat(${id}, '${aciklama}', 'Kredi Kartı')"><i class="fas fa-credit-card me-2"></i> Kart Çekimi</button>
                        <button class="btn btn-outline-info fw-bold" onclick="odemeIsleminiBaslat(${id}, '${aciklama}', 'Havale')"><i class="fas fa-university me-2"></i> Havale / EFT</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const myModalEl = document.getElementById('taksitOdemeTuruModal');
    const myModal = new bootstrap.Modal(myModalEl);
    myModal.show();

    // Kilit Kırıcı
    setTimeout(() => {
        myModalEl.style.setProperty('z-index', '9999', 'important'); 
        const backdrops = document.querySelectorAll('.modal-backdrop');
        if (backdrops.length > 0) backdrops[backdrops.length - 1].style.setProperty('z-index', '9998', 'important');
    }, 150);
};

// Ara Köprü: Kutudaki parayı okuyup ana motora gönderir
window.odemeIsleminiBaslat = function(id, aciklama, odemeTuru) {
    const tutarKutusu = document.getElementById('gercekOdenenTutar');
    const odenenTutar = parseFloat(tutarKutusu.value);

    if (!odenenTutar || odenenTutar <= 0) {
        alert("Lütfen sıfırdan büyük geçerli bir ödeme tutarı girin!");
        return;
    }
    taksitOdendiYap(id, odenenTutar, aciklama, odemeTuru);
};

// Ana Gönderim Motoru
// =================================================================
// 💰 ANA TAHSİLAT MOTORU (SUNUCUYA GÖNDERİM VE MAKBUZ)
// =================================================================
window.taksitOdendiYap = async function(id, tutar, taksitAciklama, odemeTuru) {
    
    // =======================================================
    // 🚨 1. FAZLA ÖDEME KALKANI (ZIRH)
    // =======================================================
    // JavaScript küsurat hatalarına karşı toFixed ile yuvarlayıp kıyaslıyoruz
    let odenecekPara = parseFloat(parseFloat(tutar).toFixed(2));
    let maksimumKabulEdilebilir = parseFloat((window.guncelToplamTaksitBorcu || 0).toFixed(2));

    if (odenecekPara > maksimumKabulEdilebilir) {
        alert(`🛑 DUR ORADA PATRON!\n\nMüşterinin toplam taksit borcu: ${maksimumKabulEdilebilir.toLocaleString('tr-TR')} ₺\nHavuza bu rakamdan fazla para atamazsın, yoksa paranın üstü uzay boşluğuna uçar!`);
        return; // İşlemi anında iptal et, devam etme! (Modal da kapanmaz, düzeltme şansı verir)
    }

    // =======================================================
    // 2. HER ŞEY YOLUNDAYSA MODALI KAPAT
    // =======================================================
    const turModalEl = document.getElementById('taksitOdemeTuruModal');
    if(turModalEl) {
        const inst = bootstrap.Modal.getInstance(turModalEl);
        if(inst) inst.hide();
    }

    // 🚨 RADAR 3: Havuz sistemi için tüm cephaneler tam mı kontrol ediyoruz
    console.log("🚀 FRONTEND'DEN ÇIKAN BİLGİ:", { id: id, tutar: tutar, tur: odemeTuru, musteriId: aktifMusteriId });

    // =========================================================
    // 👤 PERSONEL ZIRHI (SİSTEM YAZISINI BİTİREN KISIM)
    // =========================================================
    let islemYapan = localStorage.getItem('aktifKullanici');
    
    if (!islemYapan || islemYapan === 'Sistem' || islemYapan === 'null') {
        const navbarAd = document.getElementById('navbarKullaniciAd')?.innerText;
        islemYapan = (navbarAd && navbarAd !== 'Yükleniyor...') ? navbarAd : 'SİSTEM KAYDI';
    }

    try {
        const res = await fetch(`/api/taksit-ode/${id}`, { 
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                islemiYapan: islemYapan,      // 🚨 PERSONEL MÜHÜRLENDİ
                odemeTuru: odemeTuru,
                odenenTutar: tutar,           // 🚨 EKRANDAN GİRİLEN GERÇEK PARA
                musteriId: aktifMusteriId     // 🚨 HAVUZ MOTORUNUN YAKITI (Şart!)
            })
        });
        
        const data = await res.json(); 

        if (res.ok) {
            const gercekMakbuzNo = data.makbuzNo || '---';
            
            // 🎯 BACKEND'DEN GELEN DETAYLI RAPOR (Havuz bilgisi makbuza yansısın)
            const makbuzAciklamasi = data.finansalOzet || `TAKSİT ÖDEMESİ - ${odemeTuru || 'Nakit'} (${taksitAciklama})`;

            // =======================================================
            // 🚨 3. ZAMANLANMIŞ EKRAN TAZELEME (YARIŞ SORUNU ÇÖZÜMÜ)
            // =======================================================
            // Veritabanının kaydı tam bitirebilmesi için 400ms bilerek bekliyoruz.
            setTimeout(() => {
                if (typeof musteriTaksitleriniAc === 'function') musteriTaksitleriniAc(); 
                if (typeof musteriDetayGoster === 'function' && typeof aktifMusteriId !== 'undefined') {
                    const tel = document.getElementById('detayTelefon') ? document.getElementById('detayTelefon').innerText : '';
                    musteriDetayGoster(aktifMusteriId, aktifMusteriAd, tel);
                }
            }, 400);

            // 4. Makbuz için eski bakiye hesabı
            let guncelEskiBakiye = parseFloat(tutar); 
            const bakiyeKutusu = document.getElementById('detayKalanBakiye');
            if (bakiyeKutusu) {
                let ekrandakiBakiye = parseFloat(bakiyeKutusu.innerText.replace(' ₺', '').replace(/\./g, '').replace(',', '.'));
                // Ekran yeni tazelendiği için ödenen parayı geri ekleyip eski bakiyeyi buluyoruz
                if (!isNaN(ekrandakiBakiye)) guncelEskiBakiye = ekrandakiBakiye + parseFloat(tutar); 
            }

            // --- 5. ŞALTER KONTROLÜ VE MAKBUZ ---
            if (localStorage.getItem('ayarOtoMakbuz') !== 'false') {
                // Makbuzun da ekranlar tazelendikten sonra çıkması için süreyi biraz uzattık
                setTimeout(() => {
                    // Mühürlü islemYapan buraya gönderildi 
                    makbuzOnizle(encodeURIComponent(aktifMusteriAd), tutar, makbuzAciklamasi, new Date().toLocaleDateString('tr-TR'), gercekMakbuzNo, islemYapan, guncelEskiBakiye);
                }, 600); 
            } else {
                setTimeout(() => {
                    alert(`✅ Tahsilat İşlendi!\n${makbuzAciklamasi}\nİşlemi Yapan: ${islemYapan}\nMakbuz No: ${gercekMakbuzNo}`);
                }, 500);
            }

        } else {
            alert("❌ Hata: " + (data.hata || "Ödeme işlenemedi."));
        }
    } catch (err) {
        console.error("Ödeme hatası:", err);
        alert("⚠️ Sunucu ile bağlantı kurulamadı!");
    }
};

// Modalı Aç ve Ayarları Getir
window.tanimlamalarModalAc = async function() {
    guvenliModalAc('tanimlamalarModal');
    document.getElementById('ayarMakbuzBaslangic').value = "Yükleniyor...";
    
    try {
        const res = await fetch('/api/ayarlar');
        const ayarlar = await res.json();
        
        // Makbuz Numarası
        const makbuzAyar = ayarlar.find(a => a.Anahtar === 'MakbuzBaslangicNo');
        document.getElementById('ayarMakbuzBaslangic').value = makbuzAyar ? makbuzAyar.Deger : "1";

        // Otomatik Makbuz Şalteri
        const otoMakbuz = ayarlar.find(a => a.Anahtar === 'MakbuzOtomatikYazdir');
        const otoSelect = document.getElementById('ayarOtoMakbuz');
        if (otoSelect) {
            otoSelect.value = otoMakbuz ? otoMakbuz.Deger : "true";
            localStorage.setItem('ayarOtoMakbuz', otoSelect.value); 
        }

        // --- YENİ: MODÜL ŞALTERLERİNİ OKU ---
        const ok = (anahtar) => {
            const ayar = ayarlar.find(a => a.Anahtar === anahtar);
            return ayar ? (ayar.Deger === 'true') : true; // Ayar yoksa varsayılan olarak TRUE (Açık) kabul et
        };

        if(document.getElementById('ayarModulGider')) document.getElementById('ayarModulGider').checked = ok('ModulGider');
        if(document.getElementById('ayarModulToptanci')) document.getElementById('ayarModulToptanci').checked = ok('ModulToptanci');
        if(document.getElementById('ayarModulSevkiyat')) document.getElementById('ayarModulSevkiyat').checked = ok('ModulSevkiyat');

    } catch(e) { 
        document.getElementById('ayarMakbuzBaslangic').value = "";
    }
};

// Ayarları Sunucuya Gönder
window.ayarlariKaydet = async function() {
    const basNo = document.getElementById('ayarMakbuzBaslangic').value;
    const otoSelect = document.getElementById('ayarOtoMakbuz');
    const otoMakbuz = otoSelect ? otoSelect.value : "true";
    
    // Şalterlerin durumunu okuyoruz (Checked ise 'true', değilse 'false')
    const mGider = document.getElementById('ayarModulGider')?.checked ? 'true' : 'false';
    const mToptanci = document.getElementById('ayarModulToptanci')?.checked ? 'true' : 'false';
    const mSevkiyat = document.getElementById('ayarModulSevkiyat')?.checked ? 'true' : 'false';
    
    if(!basNo || basNo <= 0) { alert("Lütfen geçerli bir başlangıç numarası girin."); return; }

    const kaydetBtn = document.querySelector('#tanimlamalarModal .btn-success');
    if(kaydetBtn) { kaydetBtn.disabled = true; kaydetBtn.innerHTML = 'Kaydediliyor...'; }

    try {
        // Tüm ayarları asenkron şekilde aynı anda kaydediyoruz (Hızlı olması için Promise.all kullanıyoruz)
        await Promise.all([
            fetch('/api/ayar-guncelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anahtar: 'MakbuzBaslangicNo', deger: basNo }) }),
            fetch('/api/ayar-guncelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anahtar: 'MakbuzOtomatikYazdir', deger: otoMakbuz }) }),
            fetch('/api/ayar-guncelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anahtar: 'ModulGider', deger: mGider }) }),
            fetch('/api/ayar-guncelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anahtar: 'ModulToptanci', deger: mToptanci }) }),
            fetch('/api/ayar-guncelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anahtar: 'ModulSevkiyat', deger: mSevkiyat }) })
        ]);

        localStorage.setItem('ayarOtoMakbuz', otoMakbuz); 
        
        alert("✅ Sistem modülleri ve ayarlar başarıyla kaydedildi!");
        
        // Şalter değişimlerinin anında aktif olması için sayfayı yeniliyoruz
        location.reload(); 
        
    } catch(e) { 
        alert("⚠️ Bağlantı hatası!"); 
        if(kaydetBtn) { kaydetBtn.disabled = false; kaydetBtn.innerHTML = '<i class="fas fa-save me-1"></i> Ayarları Kaydet'; }
    }
};
window.musteriRehberiniAc = function() {
    /** Navbar ile aynı yol: backdrop temizliği + z-index (doğrudan show() modalı gri tabakanın altında bırakıyordu). */
    guvenliModalAc('musterilerModal');
};
// =========================================================
// 🌍 KONYA: İl (sabit) → ilçe → mahalle seçimi (public/adres-sozlugu.js)
// =========================================================

function kIlceListeSira() {
    if (window.KONYA_ILCELER_ALFABE && window.KONYA_ILCELER_ALFABE.length) return window.KONYA_ILCELER_ALFABE;
    const w = window.ADRES_SOZLUGU_KONYA || {};
    return Object.keys(w).sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
}

window.konyaIlceDropdownDoldur = function (ilceEl, korunacakIlceDegeri) {
    if (!ilceEl) return;
    const list = kIlceListeSira();
    const kaynak = korunacakIlceDegeri !== undefined && korunacakIlceDegeri !== null
        ? String(korunacakIlceDegeri).trim()
        : String(ilceEl.value || '').trim();
    ilceEl.innerHTML = list.map((ilce) => {
        const güvenli = String(ilce).replace(/"/g, '&quot;');
        return `<option value="${güvenli}">${ilce}</option>`;
    }).join('');
    const uyumlu = [...ilceEl.options].find((o) => kaynak && (o.value === kaynak ||
        o.value.localeCompare(kaynak, 'tr', { sensitivity: 'base' }) === 0));
    if (uyumlu) {
        ilceEl.value = uyumlu.value;
        return;
    }
    if (kaynak) {
        const opt = document.createElement('option');
        opt.value = kaynak;
        opt.textContent = kaynak + ' (kayıtta geçici)';
        ilceEl.insertBefore(opt, ilceEl.firstChild);
        ilceEl.value = kaynak;
        return;
    }
    if (list.indexOf('Sarayönü') >= 0) ilceEl.value = 'Sarayönü';
    else if (list.length) ilceEl.value = list[0];
};

window.konyaMahalleListesiniIlceyeGoreAyarla = function (prefix, mahalleKaliciArg) {
    const ilceEl = document.getElementById(`${prefix}Ilce`);
    const listeEl = document.getElementById(`${prefix}MahalleListe`);
    if (!ilceEl || !listeEl) return;

    const bic = typeof window.mahalleAdiniBiçimlendir === 'function' ? window.mahalleAdiniBiçimlendir : (x) => String(x || '').trim();
    const mHam = mahalleKaliciArg !== undefined && mahalleKaliciArg !== null
        ? String(mahalleKaliciArg).trim()
        : '';
    const mNorm = mHam ? bic(mHam) : '';

    listeEl.classList.remove('d-none');
    const sozluk = window.ADRES_SOZLUGU_KONYA || {};
    const mh = Array.isArray(sozluk[ilceEl.value]) ? sozluk[ilceEl.value] : [];

    if (mh.length === 0) {
        listeEl.innerHTML = '';
        if (mHam) {
            listeEl.disabled = false;
            listeEl.appendChild(new Option('Mahalle seçin...', ''));
            listeEl.appendChild(new Option(mNorm + ' (kayıttaki)', mNorm));
            listeEl.value = mNorm;
        } else {
            listeEl.disabled = true;
            listeEl.appendChild(new Option('Bu ilçe için mahalle listesi henüz tanımlı değil', '', true, true));
        }
        return;
    }

    listeEl.disabled = false;
    listeEl.innerHTML = '<option value="">Mahalle seçin...</option>';
    mh.forEach((m) => listeEl.appendChild(new Option(m, m)));

    const bul = mHam
        ? [...listeEl.options].find((o) => o.value && (o.value === mNorm
            || o.value.localeCompare(mNorm, 'tr', { sensitivity: 'base' }) === 0))
        : null;
    if (bul) {
        listeEl.value = bul.value;
        return;
    }
    if (mHam) {
        listeEl.appendChild(new Option(mNorm + ' (kayıtta — listede eşleşmedi)', mNorm));
        listeEl.value = mNorm;
        return;
    }
    listeEl.value = '';
};

window.konyaAdresTekIlceOlaylari = function (prefix) {
    const ilceEl = document.getElementById(`${prefix}Ilce`);
    if (!ilceEl || ilceEl.dataset.konyaMotor === 'ok') return;
    ilceEl.dataset.konyaMotor = 'ok';
    ilceEl.addEventListener('change', () => window.konyaMahalleListesiniIlceyeGoreAyarla(prefix, ''));
};

window.konyaAdresiniFormaYukle = function (prefix, ilceKaydi, mahalleKaydi) {
    window.konyaAdresTekIlceOlaylari(prefix);
    window.konyaIlceDropdownDoldur(document.getElementById(`${prefix}Ilce`), ilceKaydi);
    window.konyaMahalleListesiniIlceyeGoreAyarla(prefix, mahalleKaydi);
};

window.konyaMahalleVeIlceOku = function (prefix) {
    const ilceEl = document.getElementById(`${prefix}Ilce`);
    const listeEl = document.getElementById(`${prefix}MahalleListe`);
    if (!ilceEl) return { ilce: '', mahalle: '' };
    const ilce = (ilceEl.value || '').trim();
    const ham = listeEl && !listeEl.disabled ? (listeEl.value || '').trim() : '';
    const bic = typeof window.mahalleAdiniBiçimlendir === 'function' ? window.mahalleAdiniBiçimlendir : (x) => x;
    const mahalle = ham ? bic(ham) : '';
    return { ilce, mahalle };
};

window.konyaAdresFormunuVarsayilan = function (prefix) {
    window.konyaAdresiniFormaYukle(prefix, 'Sarayönü', '');
};

/** Eski sayfalardan (datalist devri) gelebilecek çağrıları kırmayı önlemek için */
window.mahalleleriDoldur = function (_a, _b) { };

// =========================================================
// 🚚 SEVKİYAT İÇİN HIZLI ADRES DÜZENLEME MOTORU
// =========================================================



window.yikildiIslemGuncelleKaydet = async function() {
    
    const elId = document.getElementById('yikildiDuzenleIslemId');
    const elMiktar = document.getElementById('yikildiDuzenleTeslimEdilecek');
    const elNot = document.getElementById('yikildiDuzenleIslemNotu');
    const elSalter = document.getElementById('yikildiDuzenleTeslimatDurumu');

    if (!elId || !elMiktar) return;

    const id = elId.value;
    const miktar = parseFloat(elMiktar.value) || 0; 
    const notlar = elNot ? elNot.value : '';
    const durum = (elSalter && elSalter.checked) ? 'Bekliyor' : 'Teslim Edildi';

    if (miktar <= 0) {
        alert("❌ Teslim edilecek miktarı giriniz!");
        return;
    }

    const kaydetBtn = document.querySelector('#yikildiIslemDuzenleModal .btn-danger');
    if (kaydetBtn) { 
        kaydetBtn.disabled = true; 
        kaydetBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Kaydediliyor...'; 
    }

    try {
        const response = await fetch('/api/islem-guncelle/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                teslim_edilen_miktar: miktar, 
                notlar: notlar, 
                durum: durum 
            })
        });

        const resultData = await response.json();

        if (response.ok) {
            // MODALI KAPATMIYORUZ! Sadece mesaj veriyoruz.
            alert("✅ Yıkım işlemi başarıyla eklendi!");
            
            // 1. Kutuları temizle ki arka arkaya aynı miktarı girmesin
            elMiktar.value = '';
            if(elNot) elNot.value = '';

            // 2. Sadece formun içindeki "Geçmiş Teslimatlar" tablosunu yenile
            if (typeof yikildiTeslimatGecmisiniYukle === 'function') {
                yikildiTeslimatGecmisiniYukle(id);
            }

            // 3. Arka plandaki dev Sevkiyat listesini çaktırmadan yenile
            if (typeof bekleyenTeslimatlariYukle === 'function') {
                bekleyenTeslimatlariYukle();
            }

        } else {
            // "Kota aştı" vb. detaylı hataları buradan yakalayacağız
            console.error("Sunucu Hatası:", resultData);
            alert("❌ " + (resultData.hata || resultData.message || "İşlem yapılamadı."));
        }
    } catch (error) {
        console.error("Bağlantı Hatası:", error);
        alert("⚠️ Bağlantı hatası!");
    } finally {
        if (kaydetBtn) { 
            kaydetBtn.disabled = false; 
            kaydetBtn.innerHTML = '<i class="fas fa-save me-1"></i> Değişiklikleri Kaydet'; 
        }
    }
};
// =========================================================
// 🚚 HIZLI ADRES DÜZENLEME MOTORU (ZIRHLI VERSİYON)
// =========================================================

// =========================================================
// 🚚 HIZLI ADRES DÜZENLEME MOTORU (KESİN ÇÖZÜM)
// =========================================================

window.hizliAdresDuzenleAc = async function(mId, adEncoded) {
    // 🚨 1. GÜVENLİK DUVARI: ID boş gelirse işlemi durdur
    if (!mId || mId === "undefined" || mId === "null") {
        alert("Hata: Müşteri numarası bulunamadı! Lütfen sayfayı yenileyip tekrar deneyin.");
        return;
    }

    const adSoyad = decodeURIComponent(adEncoded || "");

    // 2. Modalı hazırla ve bekleme moduna al
    document.getElementById('hizliAdresMusteriId').value = String(mId).trim();
    document.getElementById('hizliAdresMusteriAd').innerText = adSoyad || "Müşteri";
    
    document.getElementById('hizliAdresUnvan').value = "Yükleniyor...";
    const telKutusu = document.getElementById('hizliAdresTelefon');
    if (telKutusu) telKutusu.value = "Yükleniyor...";
    if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan('hizliAdres');
    document.getElementById('hizliAdresDetay').value = "Yükleniyor...";

    // 3. Arka plandaki dev Sevkiyat listesini geçici olarak gizle
    const sevkiyatModalEl = document.getElementById('sevkiyatListesiModal');
    if (sevkiyatModalEl) {
        const inst = bootstrap.Modal.getInstance(sevkiyatModalEl);
        if (inst) inst.hide();
    }
    
    // 4. Hızlı düzenleme modalını aç
    guvenliModalAc('hizliAdresDuzenleModal');

    try {
        // 5. Veritabanından Taze Bilgileri Çek (Sadece O Müşteriyi Çekeriz)
        const res = await fetch('/api/musteriler?_t=' + new Date().getTime());
        const musteriler = await res.json();
        
        // 🚨 SİHİRLİ NOKTA: ID eşleşmesini hem string hem integer ihtimaline karşı zırhladık
        const musteri = musteriler.find(m => String(m.Kimlik) === String(mId) || String(m.KİMLİK) === String(mId));

        if (musteri) {
            document.getElementById('hizliAdresUnvan').value = musteri.Unvan && musteri.Unvan !== 'null' ? musteri.Unvan : "";
            const yi = musteri.Ilce && musteri.Ilce !== 'null' ? musteri.Ilce : 'Sarayönü';
            const ym = musteri.Mahalle && musteri.Mahalle !== 'null' ? musteri.Mahalle : '';
            if (typeof window.konyaAdresiniFormaYukle === 'function') window.konyaAdresiniFormaYukle('hizliAdres', yi, ym);
            document.getElementById('hizliAdresDetay').value = musteri.Adres && musteri.Adres !== 'null' ? musteri.Adres : "";

            if (telKutusu) {
                telKutusu.value = (musteri.CEPTEL && musteri.CEPTEL !== "null" && musteri.CEPTEL !== "-") ? musteri.CEPTEL : "";
            }
        } else {
            document.getElementById('hizliAdresUnvan').value = "";
            document.getElementById('hizliAdresDetay').value = "";
            if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan('hizliAdres');
            if (telKutusu) telKutusu.value = "";
        }
    } catch (error) {
        console.error("Detaylar getirilirken hata:", error);
        document.getElementById('hizliAdresUnvan').value = "";
        document.getElementById('hizliAdresDetay').value = "";
        if (typeof window.konyaAdresFormunuVarsayilan === 'function') window.konyaAdresFormunuVarsayilan('hizliAdres');
        if (telKutusu) telKutusu.value = "";
    }
};

// ====================== KAPAT ======================
window.hizliAdresModalKapat = function() {
    modalZorlaKapat('hizliAdresDuzenleModal');
    
    // Kapatınca geldiğimiz yer olan Sevkiyat listesini şak diye geri açıyoruz
    setTimeout(() => {
        guvenliModalAc('sevkiyatListesiModal');
        if (typeof bekleyenTeslimatlariYukle === 'function') {
            bekleyenTeslimatlariYukle();
        }
    }, 350);
};

// ====================== KAYDET ======================
window.hizliAdresKaydet = async function() {
    const id = document.getElementById('hizliAdresMusteriId').value;
    const adSoyad = document.getElementById('hizliAdresMusteriAd').innerText;
    const unvan = document.getElementById('hizliAdresUnvan').value.trim();
    const km = typeof window.konyaMahalleVeIlceOku === 'function' ? window.konyaMahalleVeIlceOku('hizliAdres') : {};
    const ilce = (km.ilce || '').trim();
    const mahalle = (km.mahalle || '').trim();
    const adres = document.getElementById('hizliAdresDetay').value.trim();
    
    const telKutusu = document.getElementById('hizliAdresTelefon');
    const yeniTelefon = telKutusu ? telKutusu.value.trim() : "";

    // 🚨 1. GÜVENLİK KONTROLÜ
    if (!id || id === "" || id === "undefined") {
        alert("Hata: Müşteri numarası (ID) eksik! Lütfen sayfayı yenileyin.");
        return;
    }

    const kaydetBtn = document.querySelector('#hizliAdresDuzenleModal .btn-primary');
    if (kaydetBtn) { 
        kaydetBtn.disabled = true; 
        kaydetBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Kaydediliyor...'; 
    }

    try {
        const payload = {
            ad: adSoyad, 
            telefon: yeniTelefon, 
            unvan: unvan,
            ilce: ilce,
            mahalle: mahalle,
            adres: adres
        };

        const response = await fetch(`/api/hizli-adres-guncelle/${id}`, {
            method: 'POST', // Backend 'POST' ile güncelliyor, o yüzden POST kaldı.
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("✅ Müşteri bilgileri başarıyla güncellendi!");
            hizliAdresModalKapat();
            if (typeof bekleyenTeslimatlariYukle === 'function') {
                bekleyenTeslimatlariYukle(); // Listeyi anında yenile
            }
        } else {
            const hata = await response.text();
            alert("Sunucu Hatası: " + hata);
        }
    } catch (e) {
        alert("Bağlantı hatası oluştu!");
    } finally {
        if (kaydetBtn) { 
            kaydetBtn.disabled = false; 
            kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i> Güncelle'; 
        }
    }
};

// --- MAHALLE BAZLI SEVKİYAT RAPORU OLUŞTURUCU ---
// --- MAHALLE BAZLI SEVKİYAT RAPORU OLUŞTURUCU (ZIRHLI VERSİYON) ---
window.mahalleRaporuYazdir = async function() {
    const btn = document.querySelector('button[onclick="mahalleRaporuYazdir()"]');
    if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Hazırlanıyor...'; }

    try {
        // 1. VERİYİ GARANTİYE AL: Hafızada yoksa SQL'den anlık olarak kendi çeker
        let raporVerileri = window.sonSevkiyatVerileri;
        
        if (!raporVerileri || raporVerileri.length === 0) {
            console.log("Hafıza boş, veriler sunucudan anlık çekiliyor...");
            const response = await fetch('/api/bekleyen-teslimatlar?_t=' + new Date().getTime());
            raporVerileri = await response.json();
            window.sonSevkiyatVerileri = raporVerileri; // Bir dahakine hazır olsun
        }

        if (!raporVerileri || raporVerileri.length === 0) {
            alert("Veritabanında raporlanacak bekleyen sevkiyat bulunamadı!");
            return;
        }

        // 2. MAHALLELERE GÖRE GRUPLA
        const gruplar = {};
        raporVerileri.forEach(islem => {
            const ham = (islem.Mahalle && islem.Mahalle !== 'null' && islem.Mahalle.trim() !== '')
                ? islem.Mahalle.trim()
                : '';
            const mahalle = ham ? mahalleGorunumStr(ham) : `${mahalleRaporEksikEtiketi()} (adres)`;

            if (!gruplar[mahalle]) { gruplar[mahalle] = []; }
            gruplar[mahalle].push(islem);
        });

        // 3. RAPOR PENCERESİNİ HAZIRLA
        let printWindow = window.open('', '_blank');
        let html = `
        <html>
        <head>
            <title>Sevkiyat ve Yıkım Raporu</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #222; }
                h2 { text-align: center; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 10px; margin-bottom: 30px; }
                .mahalle-baslik { background: #ecf0f1; padding: 10px 15px; margin-top: 20px; border-left: 5px solid #e74c3c; font-size: 16px; font-weight: bold; color: #2c3e50;}
                table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 13px; }
                th, td { border: 1px solid #bdc3c7; padding: 8px; text-align: left; vertical-align: middle; }
                th { background-color: #f9f9f9; font-weight: bold; color: #333; }
                .text-center { text-align: center; }
                .kalan { font-weight: bold; color: #e74c3c; font-size: 14px; }
                .not-kutu { font-style: italic; color: #555; font-size: 11px; margin-top: 4px; }
                .tarih { text-align: right; font-size: 12px; color: #7f8c8d; margin-top: -20px; margin-bottom: 20px; }
                @media print {
                    body { padding: 0; }
                    button { display: none; }
                    .mahalle-baslik { background: #ddd !important; -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <h2>KARAARSLAN KÖMÜR - GÜNLÜK SEVKİYAT PLANI</h2>
            <div class="tarih"><strong>Çıktı Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')} - ${new Date().toLocaleTimeString('tr-TR')}</div>
        `;

        // 4. GRUPLARI TABLOYA DÖK
        for (const mahalle in gruplar) {
            html += `<div class="mahalle-baslik"><i class="fas fa-map-marker-alt"></i> ${mahalle} (${gruplar[mahalle].length} Teslimat Noktası)</div>`;
            html += `
            <table>
                <thead>
                    <tr>
                        <th width="22%">Müşteri / Ünvan</th>
                        <th width="15%">İletişim</th>
                        <th width="28%">Ürün</th>
                        <th width="10%" class="text-center">Miktar</th>
                        <th width="25%">Adres Detayı & Notlar</th>
                    </tr>
                </thead>
                <tbody>
            `;

            gruplar[mahalle].forEach(islem => {
                let ad = (islem.Adı && islem.Adı !== "null") ? islem.Adı : "";
                let soyad = (islem.Soyadı && islem.Soyadı !== "null") ? islem.Soyadı : "";
                let unvan = (islem.Unvan && islem.Unvan !== 'null' && islem.Unvan.trim() !== "") ? islem.Unvan : `${ad} ${soyad}`.trim();
                
                let tel = (islem.CEPTEL && islem.CEPTEL !== "null" && islem.CEPTEL !== "-" && islem.CEPTEL !== "+") ? islem.CEPTEL : "Telefon Yok";
                let adres = (islem.Adres && islem.Adres !== "null" && islem.Adres.trim() !== "") ? islem.Adres : "-";
                let notlar = islem.notlar ? islem.notlar : "";
                
                // Ürün ve Birim Mantığı
                let tamAciklama = islem.AÇIKLAMA || "";
                let urunAdiTemiz = tamAciklama;
                if (tamAciklama.includes(' x ')) urunAdiTemiz = tamAciklama.split(' x ')[1].split(' (')[0];
                else if (tamAciklama.includes(' (')) urunAdiTemiz = tamAciklama.split(' (')[0];

                let dinamikBirim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || islem.BİRİMTÜR || null;
                if (!dinamikBirim && tamAciklama.includes(' (')) {
                    let match = tamAciklama.match(/\(([^)]+)\)/);
                    if (match) dinamikBirim = match[1];
                }
                if (!dinamikBirim || dinamikBirim === "Birim" || dinamikBirim === "-") {
                    let kucukAd = urunAdiTemiz.toLowerCase();
                    dinamikBirim = (kucukAd.includes('un') || kucukAd.includes('yem') || kucukAd.includes('kg') || kucukAd.includes('torba') || kucukAd.includes('çuval')) ? 'Çuval' : 'Adet';
                }

                let kalanMiktar = islem.KalanTeslimat || islem.ADET || 0;

                html += `
                    <tr>
                        <td><strong>${unvan.toUpperCase()}</strong></td>
                        <td>${tel}</td>
                        <td>${urunAdiTemiz}</td>
                        <td class="text-center kalan">${kalanMiktar} <span style="font-size:11px; color:#555;">${dinamikBirim}</span></td>
                        <td>
                            <div>${adres}</div>
                            ${notlar ? `<div class="not-kutu"><b>Not:</b> ${notlar}</div>` : ''}
                        </td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }

        html += `
            <script>
                window.onload = function() { 
                    setTimeout(() => { window.print(); }, 500);
                }
            </script>
        </body>
        </html>`;

        printWindow.document.write(html);
        printWindow.document.close();

    } catch (error) {
        console.error("Rapor oluşturulurken hata:", error);
        alert("Bağlantı hatası! Rapor verileri çekilemedi.");
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-print me-2"></i> Rapor Al'; }
    }
};


// --- YENİ RAPORLAMA MERKEZİ KODLARI ---

// 1. Modalı Aç ve Verileri Hazırla
window.raporMerkeziAc = async function() {
    try {
        let veriler = window.sonSevkiyatVerileri;
        if (!veriler || veriler.length === 0) {
            const response = await fetch('/api/bekleyen-teslimatlar?_t=' + new Date().getTime());
            veriler = await response.json();
            window.sonSevkiyatVerileri = veriler;
        }

        if (!veriler || veriler.length === 0) {
            alert("Raporlanacak bekleyen sevkiyat yok!");
            return;
        }

        // Mahalleleri çıkar ve Select'i doldur
        const mahalleler = new Set();
        veriler.forEach(i => {
            const ham = (i.Mahalle && i.Mahalle !== 'null' && i.Mahalle.trim() !== '')
                ? i.Mahalle.trim()
                : '';
            const m = ham ? mahalleGorunumStr(ham) : mahalleRaporEksikEtiketi();
            mahalleler.add(m);
        });

        const select = document.getElementById('raporMahalleSecim');
        select.innerHTML = '<option value="TUMU">Tüm Mahalleler (Genel Rapor)</option>';
        [...mahalleler].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' })).forEach((m) => {
            select.innerHTML += `<option value="${m.replace(/"/g, '&quot;')}">${m}</option>`;
        });

        guvenliModalAc('raporMerkeziModal');
        raporOnizlemeGuncelle(); // İlk açılışta toplamı hesapla

    } catch (e) {
        alert("Veriler alınırken hata oluştu.");
    }
};

// 2. Kamyona Yüklenecekleri Hesapla (Modal İçin)
// 2. Kamyona Yüklenecekleri Hesapla ve Sağ Listeyi Doldur
window.raporOnizlemeGuncelle = function() {
    const seciliMahalle = document.getElementById('raporMahalleSecim').value;
    const veriler = window.sonSevkiyatVerileri || [];
    
    let urunToplamlari = {}; // Örn: { 'SARI POLAT': {miktar: 36, birim: 'Adet'} }
    let detayHtml = `
        <table class="table table-sm table-hover align-middle mb-0">
            <thead class="table-light sticky-top">
                <tr>
                    <th>Müşteri / Ünvan</th>
                    <th>Ürün</th>
                    <th class="text-center">Miktar</th>
                </tr>
            </thead>
            <tbody>
    `;

    let gosterilenSayi = 0;

    veriler.forEach(islem => {
        const ham = (islem.Mahalle && islem.Mahalle !== 'null' && islem.Mahalle.trim() !== '')
            ? islem.Mahalle.trim()
            : '';
        const m = ham ? mahalleGorunumStr(ham) : mahalleRaporEksikEtiketi();
        if (seciliMahalle !== 'TUMU' && m !== seciliMahalle) return;

        gosterilenSayi++;

        // Ürün Adı Temizliği
        let tamAciklama = islem.AÇIKLAMA || "";
        let urunAdiTemiz = tamAciklama;
        if (tamAciklama.includes(' x ')) urunAdiTemiz = tamAciklama.split(' x ')[1].split(' (')[0];
        else if (tamAciklama.includes(' (')) urunAdiTemiz = tamAciklama.split(' (')[0];

        // Birim Bulma
        let dinamikBirim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || islem.BİRİMTÜR || null;
        if (!dinamikBirim && tamAciklama.includes(' (')) {
            let match = tamAciklama.match(/\(([^)]+)\)/);
            if (match) dinamikBirim = match[1];
        }
        if (!dinamikBirim || dinamikBirim === "Birim" || dinamikBirim === "-") {
            dinamikBirim = (urunAdiTemiz.toLowerCase().includes('un') || urunAdiTemiz.toLowerCase().includes('yem') || urunAdiTemiz.toLowerCase().includes('çuval') || urunAdiTemiz.toLowerCase().includes('torba')) ? 'Çuval' : 'Adet';
        }

        let miktar = parseInt(islem.KalanTeslimat || islem.ADET || 0);

        // 🚨 1. SOL TARAF İÇİN: Ürün adına göre topla
        let urunAnahtari = urunAdiTemiz.toUpperCase();
        if (!urunToplamlari[urunAnahtari]) {
            urunToplamlari[urunAnahtari] = { miktar: 0, birim: dinamikBirim };
        }
        urunToplamlari[urunAnahtari].miktar += miktar;

        // 🚨 2. SAĞ TARAF İÇİN: Detay satırını oluştur
        let ad = (islem.Adı && islem.Adı !== "null") ? islem.Adı : "";
        let soyad = (islem.Soyadı && islem.Soyadı !== "null") ? islem.Soyadı : "";
        let unvan = (islem.Unvan && islem.Unvan !== 'null' && islem.Unvan.trim() !== "") ? islem.Unvan : `${ad} ${soyad}`.trim();

        detayHtml += `
            <tr>
                <td class="fw-bold text-dark" style="font-size: 0.9rem;">${unvan.toUpperCase()}</td>
                <td class="text-primary" style="font-size: 0.85rem;">${urunAdiTemiz}</td>
                <td class="text-center fw-bold text-danger" style="font-size: 0.9rem;">
                    ${miktar} <span style="font-size: 0.75rem; font-weight: normal; color: #666;">${dinamikBirim}</span>
                </td>
            </tr>
        `;
    });

    detayHtml += `</tbody></table>`;

    if (gosterilenSayi === 0) {
        detayHtml = '<div class="alert alert-secondary text-center">Bu bölge için sevkiyat bulunamadı.</div>';
    }

    // Ekrana Basma İşlemleri
    const ozetAlani = document.getElementById('raporOzetAlani');
    const detayAlani = document.getElementById('raporDetayListesi');

    detayAlani.innerHTML = detayHtml;
    ozetAlani.innerHTML = '';
    
    if (Object.keys(urunToplamlari).length === 0) {
        ozetAlani.innerHTML = '<span class="text-muted small">Sevkiyat yok.</span>';
        return;
    }

    // Sol taraftaki Ürün Toplamlarını Listele
    for (const [urun, data] of Object.entries(urunToplamlari)) {
        ozetAlani.innerHTML += `
            <div class="d-flex justify-content-between align-items-center border-bottom border-warning border-opacity-50 pb-2 mb-1">
                <span class="fw-bold" style="font-size: 0.85rem;">${urun}</span>
                <span class="badge bg-warning text-dark fs-6 px-2 py-1 shadow-sm">${data.miktar} ${data.birim}</span>
            </div>
        `;
    }
};
// 3. Çıktıyı Al (Seçime Göre)
// 3. Çıktıyı Al (Ayrı Sekme Açmadan, Detaylı Ürün Özetiyle)
window.seciliRaporuYazdir = function() {
    const seciliMahalle = document.getElementById('raporMahalleSecim').value;
    const veriler = window.sonSevkiyatVerileri || [];

    const gruplar = {};
    veriler.forEach(islem => {
        const ham = (islem.Mahalle && islem.Mahalle !== 'null' && islem.Mahalle.trim() !== '')
            ? islem.Mahalle.trim()
            : '';
        const mahalle = ham ? mahalleGorunumStr(ham) : mahalleRaporEksikEtiketi();

        if (seciliMahalle !== 'TUMU' && mahalle !== seciliMahalle) return;

        // 🚨 YENİ: Kağıt için de ürün bazlı toplamları hafızada tutuyoruz
        if (!gruplar[mahalle]) { gruplar[mahalle] = { islemler: [], urunToplamlari: {} }; }
        gruplar[mahalle].islemler.push(islem);

        let tamAciklama = islem.AÇIKLAMA || "";
        let urunAdiTemiz = tamAciklama;
        if (tamAciklama.includes(' x ')) urunAdiTemiz = tamAciklama.split(' x ')[1].split(' (')[0];
        else if (tamAciklama.includes(' (')) urunAdiTemiz = tamAciklama.split(' (')[0];

        let dinamikBirim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || islem.BİRİMTÜR || null;
        if (!dinamikBirim && tamAciklama.includes(' (')) { let match = tamAciklama.match(/\(([^)]+)\)/); if (match) dinamikBirim = match[1]; }
        if (!dinamikBirim || dinamikBirim === "Birim" || dinamikBirim === "-") { dinamikBirim = (urunAdiTemiz.toLowerCase().includes('un') || urunAdiTemiz.toLowerCase().includes('yem') || urunAdiTemiz.toLowerCase().includes('çuval') || urunAdiTemiz.toLowerCase().includes('torba')) ? 'Çuval' : 'Adet'; }

        let miktar = parseInt(islem.KalanTeslimat || islem.ADET || 0);
        let urunAnahtari = urunAdiTemiz.toUpperCase();

        if (!gruplar[mahalle].urunToplamlari[urunAnahtari]) {
            gruplar[mahalle].urunToplamlari[urunAnahtari] = { miktar: 0, birim: dinamikBirim };
        }
        gruplar[mahalle].urunToplamlari[urunAnahtari].miktar += miktar;
    });

    // Yazdırma Ekranı HTML'i
    let html = `
    <html>
    <head>
        <title>Sevkiyat Planı</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #111; margin: 0; }
            h2 { text-align: center; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 10px; margin-bottom: 20px; text-transform: uppercase; font-size: 20px;}
            .tarih { text-align: right; font-size: 11px; color: #555; margin-top: -15px; margin-bottom: 15px; }
            .mahalle-kapsayici { margin-bottom: 30px; page-break-inside: avoid; }
            .mahalle-baslik { background: #ecf0f1; padding: 8px 12px; border-left: 5px solid #e74c3c; font-size: 15px; font-weight: bold; color: #2c3e50; margin-bottom: 5px;}
            .ozet-alani { border: 1px dashed #7f8c8d; padding: 8px 12px; margin-bottom: 8px; font-size: 12px; background: #fafafa; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;}
            .ozet-baslik { font-weight: bold; color: #c0392b; margin-right: 5px; }
            .ozet-badge { background: #f39c12; color: #000; padding: 3px 8px; border: 1px solid #d68910; border-radius: 4px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #bdc3c7; padding: 6px; text-align: left; vertical-align: middle; }
            th { background-color: #f2f2f2; font-weight: bold; color: #333; }
            .text-center { text-align: center; }
            .kalan { font-weight: bold; color: #e74c3c; font-size: 13px; }
            .not-kutu { font-style: italic; color: #555; font-size: 10px; margin-top: 2px; }
            @media print { body { padding: 0; } .mahalle-baslik { background: #eee !important; -webkit-print-color-adjust: exact; } .ozet-badge { background: #ddd !important; -webkit-print-color-adjust: exact; border: 1px solid #999;} .ozet-alani { background: #fff !important; } }
        </style>
    </head>
    <body>
        <h2>KARAARSLAN KÖMÜR - ${seciliMahalle === "TUMU" ? "GÜNLÜK SEVKİYAT PLANI" : seciliMahalle + " PLANI"}</h2>
        <div class="tarih"><strong>Çıktı Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')} - ${new Date().toLocaleTimeString('tr-TR')}</div>
    `;

    for (const mahalle in gruplar) {
        html += `<div class="mahalle-kapsayici">`;
        html += `<div class="mahalle-baslik">${mahalle} (${gruplar[mahalle].islemler.length} Teslimat Noktası)</div>`;
        
        // 🚨 YENİ: Kağıttaki detaylı ürün özeti kutusu
        html += `<div class="ozet-alani"><span class="ozet-baslik"><i class="fas fa-truck-loading"></i> YÜKLENECEK ÜRÜNLER:</span>`;
        for (const [urun, data] of Object.entries(gruplar[mahalle].urunToplamlari)) {
            html += `<span class="ozet-badge">${urun}: ${data.miktar} ${data.birim}</span>`;
        }
        html += `</div>`;

        html += `
        <table>
            <thead>
                <tr>
                    <th width="25%">Müşteri / Ünvan</th>
                    <th width="15%">İletişim</th>
                    <th width="25%">Ürün</th>
                    <th width="10%" class="text-center">Miktar</th>
                    <th width="25%">Adres & Notlar</th>
                </tr>
            </thead>
            <tbody>
        `;

        gruplar[mahalle].islemler.forEach(islem => {
            let ad = (islem.Adı && islem.Adı !== "null") ? islem.Adı : "";
            let soyad = (islem.Soyadı && islem.Soyadı !== "null") ? islem.Soyadı : "";
            let unvan = (islem.Unvan && islem.Unvan !== 'null' && islem.Unvan.trim() !== "") ? islem.Unvan : `${ad} ${soyad}`.trim();
            let tel = (islem.CEPTEL && islem.CEPTEL !== "null" && islem.CEPTEL !== "-" && islem.CEPTEL !== "+") ? islem.CEPTEL : "Yok";
            let adres = (islem.Adres && islem.Adres !== "null" && islem.Adres.trim() !== "") ? islem.Adres : "-";
            let notlar = islem.notlar ? islem.notlar : "";
            
            let tamAciklama = islem.AÇIKLAMA || "";
            let urunAdiTemiz = tamAciklama;
            if (tamAciklama.includes(' x ')) urunAdiTemiz = tamAciklama.split(' x ')[1].split(' (')[0];
            else if (tamAciklama.includes(' (')) urunAdiTemiz = tamAciklama.split(' (')[0];

            let dinamikBirim = islem.birimtür || islem.BirimTur || islem.BirimTür || islem.birimtur || islem.BİRİMTÜR || null;
            if (!dinamikBirim && tamAciklama.includes(' (')) { let match = tamAciklama.match(/\(([^)]+)\)/); if (match) dinamikBirim = match[1]; }
            if (!dinamikBirim || dinamikBirim === "Birim" || dinamikBirim === "-") { dinamikBirim = (urunAdiTemiz.toLowerCase().includes('un') || urunAdiTemiz.toLowerCase().includes('çuval')) ? 'Çuval' : 'Adet'; }

            let miktar = islem.KalanTeslimat || islem.ADET || 0;

            html += `
                <tr>
                    <td><strong>${unvan.toUpperCase()}</strong></td>
                    <td>${tel}</td>
                    <td>${urunAdiTemiz}</td>
                    <td class="text-center kalan">${miktar} <span style="font-size:10px; color:#555;">${dinamikBirim}</span></td>
                    <td>
                        <div>${adres}</div>
                        ${notlar ? `<div class="not-kutu"><b>Not:</b> ${notlar}</div>` : ''}
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
    }

    html += `</body></html>`;

    // 🚨 YENİ SİHİR: Ayrı Sekme Yerine Hayalet Çerçeve (Iframe) Kullanıyoruz
    // 🚨 YENİ SİHİR: Ayrı Sekme Yerine Hayalet Çerçeve (Iframe) Kullanıyoruz
    let printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    let doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    printFrame.contentWindow.focus();

    setTimeout(() => {
        // 1. Tarayıcının yazdırma ekranını açar 
        printFrame.contentWindow.print();
        
        // 🚨 KULLANICI YAZDIR VEYA İPTAL'E BASTIĞI AN BURASI ÇALIŞIR 🚨
        
        // 2. Sadece Arka plandaki hayalet kağıdı temizliyoruz. 
        // Modalı kapatan kodları sildiğimiz için Rapor ekranı açık kalacak!
        setTimeout(() => document.body.removeChild(printFrame), 1000);

    }, 500);
}; // <-- DİKKAT: Fonksiyon burada bitiyor. Altında "hide()" falan yok!

window.raporMerkeziniKapat = function() {
    // 1. Rapor modalını kapat
    const raporModalEl = document.getElementById('raporMerkeziModal');
    if (raporModalEl) {
        const raporInst = bootstrap.Modal.getInstance(raporModalEl);
        if (raporInst) raporInst.hide();
    }

    // 2. Ana Sevkiyat Listesi modalını geri aç
    // (guvenliModalAc fonksiyonun zaten var, onu kullanıyoruz)
    setTimeout(() => {
        guvenliModalAc('sevkiyatListesiModal');
    }, 300); // Kapanma animasyonunun bitmesi için çok kısa bir bekleme süresi
};

window.surumModalAc = async function() {
    const set = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    };
    set('surumAppName', 'Yükleniyor…');
    set('surumVersion', 'Yükleniyor…');
    set('surumDesc', 'Yükleniyor…');
    set('surumNode', 'Yükleniyor…');
    set('surumGeneratedAt', 'Yükleniyor…');
    set('surumGuncellemeDurum', 'Henüz kontrol edilmedi.');
    try {
        const res = await fetch('/api/surum');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Sürüm bilgisi alınamadı.');
        set('surumAppName', data.appName || '-');
        set('surumVersion', data.version || '-');
        set('surumDesc', data.description || '-');
        set('surumNode', data.node || '-');
        set('surumGeneratedAt', data.generatedAt ? new Date(data.generatedAt).toLocaleString('tr-TR') : '-');
    } catch (err) {
        set('surumAppName', 'Hata');
        set('surumVersion', '-');
        set('surumDesc', 'Sürüm bilgisi alınamadı.');
        set('surumNode', '-');
        set('surumGeneratedAt', '-');
    }
    yedekListele();
    desktopGuncellemeKontrolBaslat();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('surumModal')).show();
};

window.guncellemeKontrolEt = async function() {
    const el = document.getElementById('surumGuncellemeDurum');
    if (!el) return;
    el.className = 'small text-muted';
    el.textContent = 'Kontrol ediliyor…';
    try {
        const res = await fetch('/api/guncelleme-kontrol');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Kontrol başarısız.');
        if (!data.configured) {
            el.className = 'small text-warning';
            el.textContent = data.message || 'Güncelleme manifest adresi tanımlı değil.';
            return;
        }
        if (data.updateAvailable) {
            const urlTxt = data.updateUrl ? ` İndir: ${data.updateUrl}` : '';
            el.className = 'small text-success fw-semibold';
            el.textContent = `Yeni sürüm var: ${data.remoteVersion} (mevcut: ${data.currentVersion}).${urlTxt}`;
            return;
        }
        el.className = 'small text-secondary';
        el.textContent = `Güncel sürümdesiniz (${data.currentVersion}).`;
    } catch (err) {
        el.className = 'small text-danger';
        el.textContent = `Kontrol hatası: ${err.message || err}`;
    }
};

window.yedekListele = async function() {
    const el = document.getElementById('surumYedekListe');
    if (!el) return;
    el.className = 'small text-muted';
    el.textContent = 'Yedekler yükleniyor…';
    try {
        const res = await fetch('/api/yedekler');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Yedek listesi alınamadı.');
        const rows = Array.isArray(data.backups) ? data.backups : [];
        if (!rows.length) {
            el.textContent = 'Henüz yedek yok.';
            return;
        }
        el.innerHTML = rows.slice(0, 8).map((r) => {
            const dt = r.tarih ? new Date(r.tarih).toLocaleString('tr-TR') : '—';
            const kb = Math.round((Number(r.boyut || 0) / 1024) * 10) / 10;
            return `<div class="d-flex justify-content-between border-bottom py-1"><span>${r.dosyaAdi}</span><span class="text-muted">${dt} · ${kb} KB</span></div>`;
        }).join('');
    } catch (err) {
        el.className = 'small text-danger';
        el.textContent = `Yedek listesi hatası: ${err.message || err}`;
    }
};

window.yedekAl = async function() {
    try {
        const res = await fetch('/api/yedek-al', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Yedek alınamadı.');
        alert(data.message || 'Yedek oluşturuldu.');
        yedekListele();
    } catch (err) {
        alert(`Yedek hatası: ${err.message || err}`);
    }
};

window.tekTikGuncelle = async function() {
    const btn = document.getElementById('tekTikGuncelleBtn');
    const durumEl = document.getElementById('surumGuncellemeDurum');
    const eski = btn ? btn.innerHTML : '';
    if (!confirm('Tek tık güncelleme başlatılsın mı? Uygulama kısa süre içinde yeniden başlatılacaktır.')) return;
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Başlatılıyor...';
        }
        if (durumEl) {
            durumEl.className = 'small text-muted';
            durumEl.textContent = 'Tek tık güncelleme başlatılıyor...';
        }
        const res = await fetch('/api/tek-tik-guncelle', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'İşlem başlatılamadı.');
        if (durumEl) {
            durumEl.className = 'small text-warning fw-semibold';
            durumEl.textContent = data.message || 'Güncelleme başlatıldı.';
        }
        alert('Güncelleme süreci başlatıldı. Uygulama birkaç saniye içinde yeniden açılacaktır.');
        setTimeout(() => {
            window.location.reload();
        }, 8000);
    } catch (err) {
        if (durumEl) {
            durumEl.className = 'small text-danger';
            durumEl.textContent = `Tek tık güncelleme hatası: ${err.message || err}`;
        }
        alert(`Tek tık güncelleme hatası: ${err.message || err}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = eski || '<i class="fa-solid fa-bolt me-1"></i>Tek Tık Güncelle';
        }
    }
};

// ─── Desktop (Electron) Güncelleme ───

let _desktopUpdateInterval = null;

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function desktopGuncellemeKontrolBaslat() {
    try {
        const res = await fetch('/api/desktop-update-status');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;
        const area = document.getElementById('desktopUpdateArea');
        if (area) area.style.display = '';
        desktopGuncellemeDurumGuncelle(data);
        if (data.status === 'downloading' || data.status === 'checking') {
            if (!_desktopUpdateInterval) {
                _desktopUpdateInterval = setInterval(desktopGuncellemePollEt, 1500);
            }
        }
    } catch (_) {}
}

async function desktopGuncellemePollEt() {
    try {
        const res = await fetch('/api/desktop-update-status');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;
        desktopGuncellemeDurumGuncelle(data);
        if (data.status !== 'downloading' && data.status !== 'checking') {
            clearInterval(_desktopUpdateInterval);
            _desktopUpdateInterval = null;
        }
    } catch (_) {}
}

function desktopGuncellemeDurumGuncelle(data) {
    const statusEl = document.getElementById('desktopUpdateStatus');
    const progressWrap = document.getElementById('desktopUpdateProgressWrap');
    const progressBar = document.getElementById('desktopUpdateProgress');
    const detailsEl = document.getElementById('desktopUpdateDetails');
    const installBtn = document.getElementById('desktopUpdateInstallBtn');
    if (!statusEl) return;

    switch (data.status) {
        case 'checking':
            statusEl.innerHTML = '<span class="text-info">Güncelleme kontrol ediliyor...</span>';
            if (progressWrap) progressWrap.style.display = 'none';
            if (installBtn) installBtn.style.display = 'none';
            break;
        case 'downloading':
            const pct = data.progress ? Math.round(data.progress.percent || 0) : 0;
            statusEl.innerHTML = '<span class="text-primary">İndiriliyor... %' + pct + '</span>';
            if (progressWrap) { progressWrap.style.display = ''; }
            if (progressBar) { progressBar.style.width = pct + '%'; }
            if (detailsEl && data.progress) {
                detailsEl.innerText = formatBytes(data.progress.transferred) + ' / ' + formatBytes(data.progress.total) + ' (' + formatBytes(data.progress.bytesPerSecond) + '/s)';
            }
            if (installBtn) installBtn.style.display = 'none';
            break;
        case 'ready':
            statusEl.innerHTML = '<span class="text-success">Güncelleme hazır! v' + (data.version || '') + '</span>';
            if (progressWrap) progressWrap.style.display = 'none';
            if (installBtn) installBtn.style.display = '';
            break;
        case 'up-to-date':
            statusEl.innerHTML = '<span class="text-success">✅ Uygulama güncel.</span>';
            if (progressWrap) progressWrap.style.display = 'none';
            if (installBtn) installBtn.style.display = 'none';
            break;
        case 'error':
            statusEl.innerHTML = '<span class="text-danger">⚠ ' + (data.error || 'Bilinmeyen hata') + '</span>';
            if (progressWrap) progressWrap.style.display = 'none';
            if (installBtn) installBtn.style.display = 'none';
            break;
        default:
            statusEl.innerHTML = '<span class="text-muted">Henüz kontrol edilmedi.</span>';
            if (progressWrap) progressWrap.style.display = 'none';
            if (installBtn) installBtn.style.display = 'none';
    }
}

window.desktopGuncellemKur = async function() {
    try {
        const res = await fetch('/api/desktop-update-install', { method: 'POST' });
        const data = await res.json();
        if (!data.success) alert(data.message || 'Hata');
    } catch (e) { alert('Güncelleme kurulamadı: ' + e.message); }
};

window.desktopGuncellemeKontrolEt = async function() {
    try {
        const res = await fetch('/api/desktop-update-check', { method: 'POST' });
        if (!_desktopUpdateInterval) {
            _desktopUpdateInterval = setInterval(desktopGuncellemePollEt, 1500);
        }
    } catch (_) {}
};