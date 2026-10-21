# Ada

Arkadaşlarla oda koduyla oynanan, tur tabanlı ada kurma oyunu. Altıgen harita, kaynak toplama, takas, haydut ve **oyuncu rolleri**.
Web uygulaması olarak çalışır, telefona PWA olarak eklenebilir; sonradan Capacitor ile store uygulamasına dönüştürülebilir.

> Not: Bu proje kendi adını ve kendi görsellerini kullanır. Mekanikler Catan'dan esinlenmiştir, ama "Catan" adı ve görselleri ticari markadır; herkese açık yayınlamadan önce bunu aklında tut.

## Çalıştırma

```bash
npm install

# Geliştirme (iki terminal)
npm run dev:server      # :3001  Socket.IO sunucusu
npm run dev:client      # :5173  Vite (telefondan http://<bilgisayar-ip>:5173)

# Tek süreç (üretim benzeri)
npm run build           # istemciyi derler
npm run start           # sunucu hem oyunu hem derlenmiş istemciyi :3001'den sunar

npm test                # çekirdek + sunucu testleri
npm run typecheck
```

## Mimari

```
packages/
  game-core/   Saf TypeScript. State, kurallar, roller, gizli bilgi filtresi. Ağdan ve arayüzden bağımsız.
  server/      Node + Socket.IO. Odalar, lobi, yeniden bağlanma. Tek otorite: zar ve kart çekimi burada.
  client/      Vite + React. SVG harita, mobil öncelikli arayüz, PWA manifesti.
```

**Temel ilke:** İstemci yalnızca *aksiyon* gönderir (`{type:'placeRoad', edge: 12}`), sunucu `applyAction(state, oyuncu, aksiyon, rng)`
ile doğrular ve uygular, her oyuncuya `viewFor(state, oyuncu)` ile filtrelenmiş görünümü yollar (rakiplerin eli yalnızca kart sayısı olarak gider).
Aynı paket istemcide yasal hamleleri vurgulamak için de kullanılır, ama sunucu her zaman yeniden doğrular.

- **Harita:** `board.ts` pointy-top altıgenlerden köşe ve kenar kimliklerini bir kez üretir (54 köşe, 72 kenar). Sunucu ve istemci aynı kimlikleri kullanır.
- **Yeniden bağlanma:** İstemci tarayıcıda kalıcı bir `playerId` tutar; aynı kimlikle odaya girince oyuncu yerine geri döner (sayfa yenileme dahil).
- **Oda ömrü:** Herkes çevrimdışı kaldıktan 3 saat sonra oda silinir. Durum bellekte tutulur (sunucu yeniden başlarsa odalar kaybolur).

## Yeni rol eklemek

`packages/game-core/src/roles.ts` içine bir kayıt eklemen yeterli. Çekirdek kurallar rol adına bakmaz, sadece hook'ları çağırır:

| Hook | Ne zaman çağrılır |
|---|---|
| `bankRatio(base, resource)` | Bankayla takasta oran |
| `cost(piece, base)` | Yol/yerleşim/şehir maliyeti |
| `onProduce({gains, roll})` | Zar sonrası üretimde ekstra kaynak |
| `discardLimit` | 7 gelince kart atma eşiği |
| `onSettlementBuilt({adjacent, rng})` | Yerleşim kurulunca ekstra kaynak |

Yeni bir hook gerekirse, kural dosyasında ilgili noktaya tek satır eklenir ve `RoleDef` tipine alan eklenir.
`RoleId` tipine (`types.ts`) yeni kimliği eklemeyi unutma.

## Telefona kurma

- **PWA:** HTTPS ile yayınla; Android Chrome'da "Yükle", iOS Safari'de Paylaş > Ana Ekrana Ekle.
- **Capacitor (sonra):** `VITE_SERVER_URL` ile sunucu adresini ver, sunucuda `CORS_ORIGINS` ortam değişkenini ayarla
  (`capacitor://localhost,http://localhost`), `wss://` kullan.

## Prototipte olmayanlar (sıradaki işler)

- Gelişim kartları (şövalye, en büyük ordu), limanlar, sınırlı banka stoku
- Bağlantısı kopan oyuncunun sırası için zamanlayıcı / oda sahibinin atlatması
- Oda durumunun Redis/Postgres'e kaydedilmesi, istek hız sınırı
- Ses, animasyon ve yeni roller için denge ayarı
