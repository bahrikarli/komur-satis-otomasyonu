/**
 * Konya — ilçe / mahalle referansı (liste seçiminden gelir).
 * Karatay, Meram, Ilgın için dizi boş → arayüz serbest mahalle metni kullanır.
 */
(function () {
    function titleCaseKelimeTr(kelime) {
        if (!kelime) return '';
        const kucuk = kelime.toLocaleLowerCase('tr-TR');
        return kucuk.charAt(0).toLocaleUpperCase('tr-TR') + kucuk.slice(1);
    }

    /** Örn: "BATI İSTASYON MAHALLESİ" veya "BATI İSTASYON MAH." → "Batı İstasyon Mah." */
    window.mahalleAdiniBiçimlendir = function (raw) {
        if (raw == null) return '';
        let s = String(raw).trim().replace(/\s+/g, ' ');
        if (!s) return '';

        function kelimeGovdesi(t) {
            return String(t || '').trim().replace(/\.+$/g, '');
        }
        function trKucukKelime(t) {
            return kelimeGovdesi(t).toLocaleLowerCase('tr-TR');
        }
        /** MAHALLESİ / Mahallesi: /i bayrağı Türkçe İ ile güvenilir eşleşmez; tr-TR kullan. */
        function mahallesiKelimesiMi(t) {
            return trKucukKelime(t) === 'mahallesi';
        }
        /** Sondan kırpılacak: Mahalle, Mah, Mah. */
        function mahalleTrSonekKelimesiMi(t) {
            const k = trKucukKelime(t);
            return k === 'mahalle' || k === 'mah';
        }

        let parcalar = s.split(' ').filter(Boolean);
        while (parcalar.length) {
            const son = parcalar[parcalar.length - 1];
            if (mahallesiKelimesiMi(son) || mahalleTrSonekKelimesiMi(son)) parcalar.pop();
            else break;
        }
        parcalar = parcalar.filter((p) => !mahallesiKelimesiMi(p));
        if (!parcalar.length) return 'Mah.';
        return parcalar.map(titleCaseKelimeTr).join(' ') + ' Mah.';
    };

    window.KONYA_ILCELER_ALFABE = ['Altınekin', 'Ilgın', 'Kadınhanı', 'Karatay', 'Meram', 'Sarayönü', 'Selçuklu'].sort((a, b) =>
        a.localeCompare(b, 'tr', { sensitivity: 'base' })
    );

    window.ADRES_SOZLUGU_KONYA = {
        Sarayönü: [
            'Akdoğan Mah.',
            'BAHÇESARAY MAHALLESİ',
            'BAŞHÜYÜK MAHALLESİ',
            'BATI İSTASYON MAHALLESİ',
            'BOYALI MAHALLESİ',
            'BÜYÜKZENGİ MAHALLESİ',
            'ÇEŞMELİSEBİL MAHALLESİ',
            'DEĞİRMENLİ MAHALLESİ',
            'DOĞU İSTASYON MAHALLESİ',
            'ERTUĞRUL MAHALLESİ',
            'FATİH MAHALLESİ',
            'GÖZLÜ MAHALLESİ',
            'HATİP MAHALLESİ',
            'İNLİ MAHALLESİ',
            'KADIOĞLU MAHALLESİ',
            'KARABIYIK MAHALLESİ',
            'KARATEPE MAHALLESİ',
            'KAYIÖREN MAHALLESİ',
            'KONAR MAHALLESİ',
            'KURŞUNLU MAHALLESİ',
            'KUYULUSEBİL MAHALLESİ',
            'LADİK MAHALLESİ',
            'ÖZKENT MAHALLESİ',
            'SARAÇ MAHALLESİ',
            'SELİMİYE MAHALLESİ',
            'YENİCEKAYA MAHALLESİ',
            'YUKARI MAHALLESİ'
        ],
        Kadınhanı: [
            'AFŞARLI MAHALLESİ',
            'ALABAĞ MAHALLESİ',
            'ATLANTI MAHALLESİ',
            'BAKIRPINAR MAHALLESİ',
            'BAŞKUYU MAHALLESİ',
            'BAYRAMLI MAHALLESİ',
            'BEYKAVAĞI MAHALLESİ',
            'BULGURPINARI MAHALLESİ',
            'ÇAVDAR MAHALLESİ',
            'ÇEŞMECİK MAHALLESİ',
            'ÇUBUK MAHALLESİ',
            'DEMİROLUK MAHALLESİ',
            'DOĞANLAR MAHALLESİ',
            'GÜNGÖREN MAHALLESİ',
            'HACIMEHMETLİ MAHALLESİ',
            'HACIOFLAZLAR MAHALLESİ',
            'HACIPİRLİ MAHALLESİ',
            'İSTİKLAL MAHALLESİ',
            'KABACALI MAHALLESİ',
            'KAMIŞLIÖZÜ MAHALLESİ',
            'KARAHİSARLI MAHALLESİ',
            'KARAKAYA MAHALLESİ',
            'KARAKURTLU MAHALLESİ',
            'KARASEVİNÇ MAHALLESİ',
            'KARAYÜRÜKLÜ MAHALLESİ',
            'KAYABAŞI MAHALLESİ',
            'KIZILKUYU MAHALLESİ',
            'KOLUKISA BERATLI MAHALLESİ',
            'KOLUKISA MESCİT MAHALLESİ',
            'KONURÖREN MAHALLESİ',
            'KÖKEZ MAHALLESİ',
            'KÖYLÜTOLU MAHALLESİ',
            'KURTHASANLI MAHALLESİ',
            'KÜÇÜKKUYU MAHALLESİ',
            'MAHMUDİYE MAHALLESİ',
            'MEYDANLI MAHALLESİ',
            'OSMANCIK MAHALLESİ',
            'ÖRNEK MAHALLESİ',
            'PINARBAŞI MAHALLESİ',
            'PİRALİ MAHALLESİ',
            'PUSAT MAHALLESİ',
            'SAÇIKARA MAHALLESİ',
            'SARIKAYA MAHALLESİ',
            'SÖĞÜTÖZÜ MAHALLESİ',
            'ŞAHÖREN MAHALLESİ',
            'TEPEBAŞI MAHALLESİ',
            'TOSUNOĞLU MAHALLESİ',
            'TURGUTLU MAHALLESİ',
            'ÜNVEREN MAHALLESİ',
            'YAĞLICA MAHALLESİ',
            'YAYLAYAKA MAHALLESİ',
            'YENİ MAHALLESİ',
            'ZAFER MAHALLESİ'
        ],
        Selçuklu: [
            'AKADEMİ MAHALLESİ',
            'AKINCILAR MAHALLESİ',
            'AKPINAR MAHALLESİ',
            'AKŞEMSETTİN MAHALLESİ',
            'ARDIÇLI MAHALLESİ',
            'AŞAĞIPINARBAŞI MAHALLESİ',
            'AYDINLIKEVLER MAHALLESİ',
            'BAĞRIKURT MAHALLESİ',
            'BAŞARAKAVAK MAHALLESİ',
            'BEDİR MAHALLESİ',
            'BEYHEKİM MAHALLESİ',
            'BİÇER MAHALLESİ',
            'BİLECİK MAHALLESİ',
            'BİNKONUTLAR MAHALLESİ',
            'BOSNA HERSEK MAHALLESİ',
            'BUHARA MAHALLESİ',
            'BÜYÜKKAYACIK MAHALLESİ',
            'CUMHURİYET MAHALLESİ',
            'ÇALDERE MAHALLESİ',
            'ÇALTI MAHALLESİ',
            'ÇANDIR MAHALLESİ',
            'DAĞDERE MAHALLESİ',
            'DOKUZ MAHALLESİ',
            'DUMLUPINAR MAHALLESİ',
            'EĞRİBAYAT MAHALLESİ',
            'ERENKÖY MAHALLESİ',
            'ESENLER MAHALLESİ',
            'FATİH MAHALLESİ',
            'FERHUNİYE MAHALLESİ',
            'FERİTPAŞA MAHALLESİ',
            'GÜVENÇ MAHALLESİ',
            'HACIKAYMAK MAHALLESİ',
            'HANAYBAŞI MAHALLESİ',
            'HOCACİHAN MAHALLESİ',
            'HOROZLUHAN MAHALLESİ',
            'HÜSAMETTİN ÇELEBİ MAHALLESİ',
            'IŞIKLAR MAHALLESİ',
            'İHSANİYE MAHALLESİ',
            'KALEKÖY MAHALLESİ',
            'KARAÖMERLER MAHALLESİ',
            'KERVAN MAHALLESİ',
            'KILINÇARSLAN MAHALLESİ',
            'KINIK MAHALLESİ',
            'KIZILCAKUYU MAHALLESİ',
            'KOSOVA MAHALLESİ',
            'KÜÇÜKMUHSİNE MAHALLESİ',
            'MALAZGİRT MAHALLESİ',
            'MEHMET AKİF MAHALLESİ',
            'MEYDANKÖY MAHALLESİ',
            'MUSALLA BAĞLARI MAHALLESİ',
            'NİŞANTAŞ MAHALLESİ',
            'PARSANA MAHALLESİ',
            'SAKARYA MAHALLESİ',
            'SALAHATTİN MAHALLESİ',
            'SANCAK MAHALLESİ',
            'SARAYKÖY MAHALLESİ',
            'SARICALAR MAHALLESİ',
            'SELAHADDİNİ EYYUBİ MAHALLESİ',
            'SELÇUK MAHALLESİ',
            'SIZMA MAHALLESİ',
            'SİLLE MAHALLESİ',
            'SİLLE AK MAHALLESİ',
            'SULUTAS MAHALLESİ',
            'ŞEKER MAHALLESİ',
            'ŞEYH ŞAMİL MAHALLESİ',
            'TATKÖY MAHALLESİ',
            'TEPEKENT MAHALLESİ',
            'TÖMEK MAHALLESİ',
            'ULUMUHSİNE MAHALLESİ',
            'YAZIBELEN MAHALLESİ',
            'YAZIR MAHALLESİ',
            'YUKARIPINARBAŞI MAHALLESİ'
        ],
        Altınekin: [
            'AKÇAŞAR MAHALLESİ',
            'AKINCILAR MAHALLESİ',
            'AKKÖY MAHALLESİ',
            'AYIŞIĞI MAHALLESİ',
            'BORUKKUYU MAHALLESİ',
            'DEDELER MAHALLESİ',
            'HACINUMAN MAHALLESİ',
            'KALE MAHALLESİ',
            'KARAKAYA MAHALLESİ',
            'KOÇAŞ MAHALLESİ',
            'KOÇYAKA MAHALLESİ',
            'MANTAR MAHALLESİ',
            'OĞUZELİ MAHALLESİ',
            'ÖLMEZ MAHALLESİ',
            'SARNIÇ MAHALLESİ',
            'TOPRAKLIK MAHALLESİ',
            'YENİ ÖLMEZ MAHALLESİ',
            'YENİCE MAHALLESİ',
            'YENİKUYU MAHALLESİ',
            'YENİYAYLA MAHALLESİ'
        ],
        Karatay: [],
        Meram: [],
        Ilgın: []
    };

    const fmt = window.mahalleAdiniBiçimlendir;
    Object.keys(window.ADRES_SOZLUGU_KONYA).forEach((ilce) => {
        const d = window.ADRES_SOZLUGU_KONYA[ilce];
        if (!Array.isArray(d) || !d.length) return;
        window.ADRES_SOZLUGU_KONYA[ilce] = d.map((m) => fmt(m));
    });
})();
