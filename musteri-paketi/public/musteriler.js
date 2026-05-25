// Sayfa yüklendiğinde listeyi çek
document.addEventListener('DOMContentLoaded', () => {
    cariListesiniYukle();
});

// Veritabanından Cari (Borç/Alacak) listesini çeken fonksiyon
async function cariListesiniYukle() {
    const tabloGövdesi = document.getElementById('cariTabloGövdesi');
    
    try {
        const response = await fetch('/api/cari-liste');
        const musteriler = await response.json();

        tabloGövdesi.innerHTML = ''; // "Yükleniyor" yazısını temizle

        if (musteriler.length === 0) {
            tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Sistemde henüz kayıtlı müşteri bulunmuyor.</td></tr>`;
            return;
        }

        musteriler.forEach(musteri => {
            // Rakamları virgüllü sayıya (float) çevirip matematiği yapıyoruz
            const toplamBorc = parseFloat(musteri.toplam_borc);
            const toplamOdenen = parseFloat(musteri.toplam_odenen);
            const kalanBakiye = toplamBorc - toplamOdenen;

            // Kalan bakiyeye göre renk belirleme (Borcu varsa Kırmızı, yoksa Yeşil)
            let bakiyeRengi = kalanBakiye > 0 ? 'text-danger fw-bold' : 'text-success fw-bold';
            let bakiyeMetni = kalanBakiye > 0 ? `${kalanBakiye.toLocaleString('tr-TR')} ₺` : 'Borcu Yok';

            const satir = `
                <tr>
                    <td class="fw-bold text-dark-custom"><i class="fas fa-user-circle text-secondary me-2"></i>${musteri.ad_soyad}</td>
                    <td>${musteri.telefon || '-'}</td>
                    <td class="text-danger">${toplamBorc.toLocaleString('tr-TR')} ₺</td>
                    <td class="text-success">${toplamOdenen.toLocaleString('tr-TR')} ₺</td>
                    <td class="${bakiyeRengi}">${bakiyeMetni}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-success me-1" onclick="odemeAlModalAc(${musteri.id}, '${musteri.ad_soyad}')" title="Tahsilat (Ödeme) Al">
                            <i class="fas fa-lira-sign"></i> Ödeme Al
                        </button>
                        <button class="btn btn-sm btn-outline-info" onclick="ekstreGor(${musteri.id}, '${musteri.ad_soyad}')" title="Hesap Ekstresi (Detay)">
                            <i class="fas fa-list"></i> Detay
                        </button>
                    </td>
                </tr>
            `;
            tabloGövdesi.innerHTML += satir;
        });

    } catch (error) {
        console.error('Cari liste yükleme hatası:', error);
        tabloGövdesi.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Veriler çekilirken bir hata oluştu!</td></tr>`;
    }
}

// Şimdilik boş duran buton fonksiyonları (Bir sonraki adımda dolduracağız)
function yeniMusteriEkle() {
    alert("Yeni Müşteri Ekleme ekranı henüz hazır değil.");
}

function odemeAlModalAc(musteriId, musteriAd) {
    alert(`${musteriAd} adlı müşteriden ödeme alma ekranı açılacak.`);
}

// Müşteri hesap ekstresini (detayını) getiren fonksiyon
// Müşterinin özel detay (Cari Kart) sayfasına yönlendirir
function ekstreGor(musteriId) {
    // URL'nin sonuna ?id=5 gibi müşterinin ID'sini ekleyerek yeni sayfaya geçiyoruz
    window.location.href = `musteri-detay.html?id=${musteriId}`;
}