// URL'den müşteri ID'sini al (Örn: musteri-detay.html?id=1 ise musteriId = 1 olur)
const urlParams = new URLSearchParams(window.location.search);
const musteriId = urlParams.get('id');

document.addEventListener('DOMContentLoaded', () => {
    // Eğer URL'de ID yoksa hata ver ve listeye geri gönder
    if (!musteriId) {
        alert("Geçersiz Müşteri! Lütfen listeden bir müşteri seçin.");
        window.location.href = "musteriler.html";
        return;
    }

    sayfayiYukle();
});

// Tüm verileri sırayla çeken ana fonksiyon
async function sayfayiYukle() {
    await musteriBilgileriniGetir();
    await ekstreVeBakiyeGetir();
}

// 1. Müşteri Profili ve İletişim Bilgilerini Getir
async function musteriBilgileriniGetir() {
    try {
        const response = await fetch(`/api/musteri-bilgi/${musteriId}`);
        if (!response.ok) throw new Error('Müşteri bulunamadı');
        const musteri = await response.json();

        // HTML'deki yerlerine yaz
        document.getElementById('detayAdSoyad').innerText = musteri.ad_soyad;
        document.getElementById('detayTelefon').innerText = musteri.telefon || 'Telefon kayıtlı değil';
        document.getElementById('detayAdres').innerText = musteri.adres || 'Adres kayıtlı değil';

        // WhatsApp Butonunu Ayarla
        const btnWhatsapp = document.getElementById('btnWhatsapp');
        if (musteri.telefon) {
            // Telefon numarasındaki boşlukları vs. temizleyip WhatsApp linki oluştur
            let tel = musteri.telefon.replace(/[^0-9]/g, '');
            if (tel.startsWith('0')) tel = '9' + tel; // 05... ise 905... yap
            if (!tel.startsWith('90')) tel = '90' + tel; // 5... ise 905... yap
            
            // Mesaj taslağı
            const mesaj = encodeURIComponent(`Merhaba ${musteri.ad_soyad}, KARAARSLAN KÖMÜR'den ulaşıyoruz.`);
            btnWhatsapp.onclick = () => window.open(`https://wa.me/${tel}?text=${mesaj}`, '_blank');
        } else {
            // Telefon yoksa butonu pasif yap
            btnWhatsapp.disabled = true;
        }

    } catch (error) {
        console.error('Müşteri bilgi hatası:', error);
        document.getElementById('detayAdSoyad').innerText = 'HATA: Müşteri Yüklenemedi';
    }
}

// 2. Hesap Ekstresini ve Bakiye Özeti Kutularını Doldur
async function ekstreVeBakiyeGetir() {
    const tabloGovdesi = document.getElementById('detayTabloGovdesi');
    
    try {
        const response = await fetch(`/api/musteri-ekstre/${musteriId}`);
        const islemler = await response.json();

        tabloGovdesi.innerHTML = ''; // "Yükleniyor" yazısını temizle

        let toplamBorc = 0;
        let toplamOdenen = 0;
        let anlikBakiye = 0;

        if (islemler.length === 0) {
            tabloGovdesi.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Bu müşteriye ait işlem bulunmuyor.</td></tr>';
        } else {
            // İşlemleri tabloya satır satır ekle
            islemler.forEach(islem => {
                const tarihObj = new Date(islem.tarih);
                const formatliTarih = tarihObj.toLocaleDateString('tr-TR') + ' ' + tarihObj.toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});

                const borc = parseFloat(islem.borc);
                const alacak = parseFloat(islem.alacak);
                
                // Matematik: Toplamları ve anlık bakiyeyi hesapla
                toplamBorc += borc;
                toplamOdenen += alacak;
                anlikBakiye += (borc - alacak);

                const islemBadge = islem.islem_tipi === 'Satış' 
                    ? '<span class="badge bg-danger">Satış</span>' 
                    : '<span class="badge bg-success">Tahsilat</span>';

                const satir = `
                    <tr>
                        <td>${formatliTarih}</td>
                        <td>${islemBadge}</td>
                        <td>${islem.aciklama}</td>
                        <td class="text-end text-danger">${borc > 0 ? borc.toLocaleString('tr-TR', {minimumFractionDigits: 2}) : '-'}</td>
                        <td class="text-end text-success">${alacak > 0 ? alacak.toLocaleString('tr-TR', {minimumFractionDigits: 2}) : '-'}</td>
                        <td class="text-end fw-bold text-primary">${anlikBakiye.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺</td>
                    </tr>
                `;
                tabloGovdesi.innerHTML += satir;
            });
        }

        // 3. Üstteki Bakiye Özeti Kartlarını (Kırmızı, Yeşil, Mavi Kutular) Güncelle
        document.getElementById('detayToplamBorc').innerText = `${toplamBorc.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺`;
        document.getElementById('detayToplamOdenen').innerText = `${toplamOdenen.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺`;
        document.getElementById('detayKalanBakiye').innerText = `${anlikBakiye.toLocaleString('tr-TR', {minimumFractionDigits: 2})} ₺`;

        // Eğer borcu varsa kalan bakiye kırmızı, yoksa yeşil görünsün
        const bakiyeKutusu = document.getElementById('detayKalanBakiye');
        if(anlikBakiye > 0) {
            bakiyeKutusu.className = 'text-danger fw-bold mb-0';
        } else {
            bakiyeKutusu.className = 'text-success fw-bold mb-0';
        }

    } catch (error) {
        console.error('Ekstre çekme hatası:', error);
        tabloGovdesi.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Veriler çekilirken bir hata oluştu!</td></tr>';
    }
}

// Hızlı İşlem Butonları (Sonraki Adım)
function hizliSatisYap() {
    alert("Bu müşteriye özel satış modalı açılacak.");
}

function hizliOdemeAl() {
    alert("Bu müşteriden tahsilat (ödeme alma) modalı açılacak.");
}