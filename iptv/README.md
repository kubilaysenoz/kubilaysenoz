# TakIR TV

Philips (ve diğer) akıllı TV'lerin tarayıcısında, **kumandayla** kullanılan bir IPTV
oynatıcı. Tek sayfa, kurulum gerektirmez, derleme adımı yok.

> **Bu uygulama içerik sağlamaz.** Kanal yayını, abonelik ya da hazır liste
> içermez. Yalnızca *senin verdiğin* M3U/Xtream adresini oynatır. Kullandığın
> kaynağın yayın hakkına sahip olduğundan emin ol.

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

## Kanal listesi ekleme

İlk açılışta kurulum ekranı gelir. Sonradan: **Ayarlar → Kanal listeleri**.

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
  tools/server.js         yerel sunucu + yayın vekili
  tools/e2e-test.js       uçtan uca test (Playwright)
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
