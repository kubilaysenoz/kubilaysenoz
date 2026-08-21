# NOMADS INDUSTRY IPTV

Philips (ve diğer) akıllı TV'lerde **kumandayla** kullanılan bir IPTV oynatıcı.
İki şekilde çalışır: TV tarayıcısında bir web sayfası olarak, ya da Android TV'ye
kurulan bir **APK** olarak.

Kutudan **10.476 kanal** çıkar (175 ülke) — bunlar iptv-org açık kataloğundan
derlenmiştir: yayıncıların kendi sitelerinde herkese açık sunduğu akışlar.
Kendi M3U adresini ya da Xtream Codes hesabını da ekleyebilirsin.

> **Şifreli/ücretli kanalların korsan bağlantıları bu depoda yok ve olmayacak.**
> Kendi eklediğin kaynağın yayın hakkına sahip olduğundan emin olmak sana ait.

---

## Ne yapar

- **M3U / M3U8** listeleri ve **Xtream Codes** hesapları (sunucu + kullanıcı + şifre)
- Üç yayın motoru, otomatik sırayla denenir ve **çalışan motor hatırlanır**:
  1. TV'nin kendi çözücüsü (en düşük gecikme, donanım hızlandırmalı)
  2. `hls.js` — MSE üzerinden `.m3u8`
  3. `mpegts.js` — MSE üzerinden ham MPEG-TS (Xtream'in varsayılan çıktısı)
- **XMLTV (EPG)** desteği: şimdi/sonra bilgisi, tam ekran yayın akışı ızgarası
- Numarayla kanal geçişi, favoriler, son izlenenler, arama, gruplar
- Donma tespiti ve otomatik yeniden bağlanma (üstel geri çekilmeli)
- Ses / altyazı / kalite seçimi, görüntü oranı, ebeveyn kilidi
- 10.000 kanallı listelerde bile akıcı gezinme (sanal liste)
- Overscan (kenar payı) ve arayüz boyutu ayarı — eski TV'lerde kenarlar kesilirse
- Çevrimdışı çalışma: uygulama dosyaları servis çalışanıyla önbelleklenir

`hls.js` ve `mpegts.js` depoya gömülüdür; TV dışarıya bir CDN'e çıkamasa da çalışır.

---

## Kurulum: iki yol

### Yol A — Yerel sunucu (önerilen)

Bilgisayarında ya da Raspberry Pi'de, TV ile **aynı ağda**:

```bash
node iptv/tools/server.js
```

Çıktıda `http://192.168.1.x:8080/` gibi bir adres göreceksin. TV'nin tarayıcısına
bunu yaz.

Bu yol neden önerilir: sayfa `http://` üzerinden açıldığı için `http://` yayınlar
engellenmez, ve aynı sunucu **vekil (proxy)** görevi de görerek CORS ile özel
`User-Agent`/`Referer` sorunlarını çözer. Çoğu IPTV kaynağı için gereklidir.

### Yol B — GitHub Pages

Depo ayarlarından Pages'i aç, `https://<kullanıcı>.github.io/iptv/` adresini TV'de aç.

Kurulum gerektirmez, ama sayfa `https://` olduğu için tarayıcı **`http://` yayınları
engeller** (karışık içerik). Yalnızca `https://` kaynaklarla çalışır. `http://`
kaynakların varsa Yol A'yı kullan ya da ayarlardan bir vekil adresi tanımla.

---

## Android TV uygulaması (APK)

Philips'in **Android TV / Google TV** modellerinde tarayıcı açmakla uğraşmak yerine
uygulamayı kurabilirsin. APK'yı GitHub derliyor:

1. Depoda **Actions** → **APK derle** → son çalıştırma → **Artifacts** →
   `nomads-industry-iptv-apk` indir, zip'ten `app-debug.apk` çıkar.
   (Hiç çalışmadıysa: **Run workflow** ile elle başlat.)
2. TV'de **Ayarlar → Cihaz tercihleri → Güvenlik → Bilinmeyen kaynaklar**'a izin ver.
3. APK'yı TV'ye at: USB bellek + bir dosya yöneticisi, ya da bilgisayardan
   `adb install app-debug.apk`, ya da "Send Files to TV" tipi bir uygulama.
4. Ana ekranda **NOMADS INDUSTRY IPTV** görünür.

**APK neden tarayıcıdan iyi:** uygulamanın içinde küçük bir HTTP sunucusu ve vekil
çalışıyor (`LocalServer.java`). Sayfa `http://127.0.0.1` üzerinden açıldığı için:

- karışık içerik engeli hiç devreye girmiyor — `http://` yayınlar doğrudan oynuyor,
- CORS başlıkları vekil tarafından ekleniyor,
- `User-Agent` / `Referer` ayarlanabiliyor,
- kanal listeleri APK'nın içinde geliyor, PC'ye ya da ağda ikinci bir cihaza gerek yok.

Yani `tools/server.js`'i çalıştırmana gerek kalmıyor; o yalnızca tarayıcı yolu için.

Kendin derlemek istersen (Android SDK kurulu bir makinede):

```bash
cd iptv/android
gradle assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Web uygulaması derleme sırasında `assets/web/` içine kopyalanır — tek kaynak,
tarayıcıda ve APK'da aynı kod çalışır.

---

## Philips TV'de açmak

| Model / yazılım | Nasıl |
|---|---|
| **Saphi** (2018 ve sonrası) | Ana ekran → Uygulamalar → **Web Browser** → adresi yaz. Adresi sık kullanılanlara ekle. |
| **Android TV / Google TV** | Yerleşik tarayıcı yoktur. Play Store'dan bir tarayıcı kur (ör. TV Bro), ya da telefondan "Send to TV" tipi bir uygulamayla adresi gönder. |
| **Net TV** (2013–2017) | Ana ekran → İnternet. Bu nesil eski bir motor kullanır; MSE olmayabilir, o zaman yalnızca TV'nin kendi çözücüsü çalışır (genelde `.m3u8` gerekir). |

Uzun adresleri kumandayla yazmak zordur. İki kolaylık:

- Sunucuyu **80. porttan** çalıştır (`sudo node iptv/tools/server.js --port 80`),
  böylece TV'ye sadece `192.168.1.20` yazman yeter.
- Uygulamayı bir kez açtıktan sonra tarayıcının sık kullanılanlarına ekle.

**Kenarlar ekran dışında kalıyorsa** (overscan): Ayarlar → Görüntü ve arayüz →
Kenar payı değerini 3–5 % yap. Yazılar küçük geliyorsa Arayüz boyutunu arttır.

---

## Kanal listeleri

### Hazır paketler (uygulamayla geliyor)

| Paket | İçerik |
|---|---|
| **Türkiye** | 208 kanal |
| **Dünya** | 175 ülke, 10.476 kanal |

İlk açılıştaki kurulum ekranından ya da **Ayarlar → Kanal listeleri → Hazır listeler**
ile tek tuşla eklenir. `iptv/playlists/` altında dururlar, uygulamayla aynı yerden
okunurlar — dış bir sunucuya, CORS'a ya da vekile ihtiyaç duymazlar.

Bu paketler **iptv-org açık kataloğundan** derlenmiştir: yayıncıların kendi
sitelerinde herkese açık sunduğu akışlar. Şifreli/ücretli kanalların korsan
bağlantılarını içermez.

### Listeyi kendin üretmek

```bash
# Türkiye
node iptv/tools/build-playlist.js --countries tr --out iptv/playlists/turkiye.m3u

# Tüm dünya
node iptv/tools/build-playlist.js --out iptv/playlists/dunya.m3u

# Yalnızca cevap veren yayınlar (kendi ağında çalıştır!)
node iptv/tools/build-playlist.js --countries tr --validate --out temiz.m3u

# Kategoriye göre, grupları kategori yap
node iptv/tools/build-playlist.js --categories news,sports --group category --out haber.m3u
```

Araç kanal veritabanını da indirip listeyi zenginleştirir: logo, ülke, kategori.
Kaynağın kendi engel listesindeki ve yetişkin içerikli kanallar varsayılan olarak
dışarıda bırakılır.

**`--validate` mutlaka kendi ağında koşmalı.** Hangi yayının açıldığı bulunduğun
ülkeye, operatörüne ve saate göre değişir; başka bir makinede alınan sonuç seni
yanıltır.

### Kendi listeni eklemek

**Ayarlar → Kanal listeleri**:

- **M3U adresi** — sağlayıcının verdiği ya da kendi sunucundan aldığın
  `.m3u` / `.m3u8` bağlantısı.
- **Xtream Codes** — sunucu adresi (`http://ornek:8080`), kullanıcı adı, şifre.
  `get.php` kısmını yazma, uygulama kendi üretir. EPG adresi de otomatik bulunur.

Listede `url-tvg` alanı varsa EPG adresi kendiliğinden ayarlanır.

Yasal kaynak fikirleri: kendi Jellyfin / Plex / TVHeadend sunucun, yayıncıların
kendi sitelerinde sunduğu ücretsiz HLS akışları, iptv-org gibi açık dizinler,
ya da ödediğin aboneliğin M3U bağlantısı.

---

## Kumanda tuşları

**Kanal listesinde**

| Tuş | İşlev |
|---|---|
| ▲ ▼ | Liste içinde gezin |
| ◀ ▶ | Gruplar ↔ kanallar arası geçiş |
| OK | İzle |
| 0–9 | Kanal numarası yaz |
| Kırmızı | Favoriye ekle / çıkar |
| Yeşil | Listeyi yenile |
| Sarı | Sıralamayı değiştir |
| Mavi | Kanal bilgisi |
| Geri | Geri / çıkış |

**Yayın oynarken**

| Tuş | İşlev |
|---|---|
| ▲ ▼ / CH+ CH− | Önceki / sonraki kanal |
| OK | Bilgi çubuğunu aç-kapat |
| 0–9 | Numarayla kanal değiştir |
| Kırmızı | Favori (hata ekranındayken: yeniden dene) |
| Yeşil | Görüntü oranı (sığdır / doldur / ger) |
| Sarı | Ses, altyazı, kalite menüsü |
| Mavi | Teknik bilgi (motor, çözünürlük, bit hızı, tampon) |
| ◀ ▶ | Kayıttan izlemede ±30 sn (canlıda bilgi çubuğu) |
| Geri | Listeye dön |

Fiziksel klavye ya da telefon kumanda uygulaması bağlıysa harfler doğrudan çalışır.

---

## Vekil sunucu

`tools/server.js` aynı zamanda bir yayın vekilidir. Üç sorunu çözer:

1. **Karışık içerik** — `https://` sayfa `http://` yayın çekemez.
2. **CORS** — `hls.js` ve `mpegts.js` yayını XHR ile çeker; sunucu izin başlığı
   vermezse tarayıcı reddeder.
3. **Özel başlıklar** — bazı kaynaklar belirli bir `User-Agent` ya da `Referer`
   bekler. Tarayıcı bunları değiştiremez, vekil değiştirebilir.

Ayarlar → Ağ ve vekil sunucu → Vekil adresi:

```
http://192.168.1.20:8080/proxy?url=
```

Varsayılan olarak yalnızca gerektiğinde devreye girer. "Her zaman vekil kullan"
ile zorlayabilirsin.

Vekil, `.m3u8` dosyalarının **içindeki** adresleri de yeniden yazar; böylece
segmentler de aynı yoldan gelir. `Range` istekleri aktarılır, yönlendirmeler
(5 adıma kadar) izlenir.

```bash
node tools/server.js --port 8080 --host 0.0.0.0 --token GIZLIKELIME
```

`--token` verirsen vekil ucu o anahtar olmadan kullanılamaz. Sunucuyu internete
açacaksan bunu mutlaka kullan; tasarımı yerel ağ içindir.

---

## Sorun giderme

| Belirti | Sebep ve çözüm |
|---|---|
| "Yayın açılamadı", sayfa `https://` | Karışık içerik. Yol A ile `http://` üzerinden aç ya da vekil tanımla. |
| Hata: "Ağ hatası (CORS…)" | Kaynak CORS başlığı vermiyor. Vekili aç. |
| Görüntü var, ses yok | Sarı tuş → Ses menüsünden başka bir parça seç. |
| Sürekli donuyor | Ayarlar → Oynatma → Tamponu arttır, "Düşük gecikme"yi kapat. |
| "MPEG-DASH / DRM desteklenmiyor" | `.mpd` ve DRM korumalı yayınlar kapsam dışı. |
| Hiçbir kanal açılmıyor, TV eski | Ayarlar → Hakkında ve tanı → MSE "Yok" ise yalnızca TV çözücüsü var; `.m3u8` kaynak kullan. |
| Kenarlar kesik | Ayarlar → Görüntü ve arayüz → Kenar payı. |
| Ayarlar kaydedilmiyor | Tarayıcıda site verisi kapalı. Hakkında ekranında "Kalıcı depolama" satırına bak. |
| Liste çok yavaş açılıyor | Liste önbelleğe alınır; 12 saatte bir tazelenir. Yeşil tuşla elle yenileyebilirsin. |

Teşhis için: yayın oynarken **Mavi** tuş → motor, çözünürlük, bit hızı ve tampon
doluluğu bilgi çubuğunda görünür.

---

## Dosya yapısı

```
iptv/
  index.html              uygulama kabuğu
  css/app.css             10-foot arayüz (flexbox, rem; CSS değişkeni yok)
  js/compat.js            eski TV tarayıcıları için yamalar + yetenek tespiti
  js/store.js             localStorage: ayarlar, listeler, favoriler, önbellek
  js/http.js              XHR sarmalayıcı + vekil yönlendirme
  js/m3u.js               M3U/M3U8 çözümleyici
  js/xmltv.js             XMLTV çözümleyici (akış tarayan, bellek dostu)
  js/nav.js               kumanda tuş eşlemesi + odak yığını
  js/vlist.js             sanal liste (10k satırda akıcı)
  js/player.js            yayın motoru, motor zinciri, kurtarma
  js/ui.js                ekran yönetimi, pencere, ekran klavyesi
  js/screens.js           ana liste, rehber, arama
  js/settings-screen.js   ayarlar ve liste yönetimi
  js/app.js               durum, oynatıcı arayüzü, açılış
  sw.js                   servis çalışanı (yalnızca uygulama dosyaları)
  vendor/                 hls.js, mpegts.js
  playlists/              hazır kanal listeleri (Türkiye, Dünya)
  tools/server.js         yerel sunucu + yayın vekili (tarayıcı yolu için)
  tools/build-playlist.js kanal listesi üretici
  tools/e2e-test.js       uçtan uca test (Playwright)
  android/                Android TV uygulaması
    app/src/main/java/.../MainActivity.java   WebView kabuğu, kumanda
    app/src/main/java/.../LocalServer.java    gömülü HTTP sunucusu + vekil
```

Kodun tamamı bilerek **ES5**'tir: `let`/`const`, ok fonksiyonu, şablon dizgesi,
`Promise` ve `fetch` kullanılmaz. Philips Saphi/NetTV gibi eski WebKit türevleriyle
modern Android TV WebView'ini aynı anda desteklemenin en güvenli yolu budur.

---

## Test

```bash
npm i playwright
node iptv/tools/e2e-test.js
```

Test kendi kanal listesini, EPG'sini ve video dosyasını üretir; gerçek bir tarayıcıda
uygulamayı açar, kumanda tuşlarını basar, video oynatır, bozuk yayınla hata
kurtarma yolunu sınar ve 1280/1920/1366 genişliklerinde taşma olup olmadığına bakar.
