# Ada

Oda koduyla oynanan, tur tabanlı, çok oyunculu ada kurma oyunu. Kaynak gerçek: [docs/GDD.md](docs/GDD.md). Proje kuralları: [CLAUDE.md](CLAUDE.md). Verilen kararlar ve varsayımlar: [docs/DECISIONS.md](docs/DECISIONS.md).

## Durum: Aşama 4 (oyun hissi ve takas ekranı) tamam

`packages/game-core` (kural motoru), `packages/protocol` (istemci-sunucu mesaj tipleri), `packages/server` (Node + Socket.IO) ve `packages/client` (Vite + React, SVG tahta, mobil öncelikli, tr/en) yazıldı. Tahtada zar animasyonu, üretim vurgusu ve yeniden tasarlanmış takas ekranı var. Hesap sistemi, ses/müzik ve eşleştirme yok.

```
npm install
npm test          # istemci 114 + çekirdek 155 (fuzz dahil) + sunucu 91 test
npm run typecheck
npm run build     # istemciyi packages/client/dist içine derler
npm run start     # tek süreç: sunucu + derlenmiş istemci, http://localhost:3001
npm run e2e       # Playwright (36 senaryo, üç test sunucusu: play, finish, capture) (önce npm run build; tarayıcı: npx playwright install chromium)
npm run dev       # yalnızca istemci geliştirme sunucusu (Vite, :5173; sunucu ayrıca çalışmalı)
npm run balance   # rol denge raporu (-- --games=300 --seed=2)
```

### Tek süreç ve telefonla deneme

`npm run build` sonrası `npm run start` hem oyun sunucusunu hem derlenmiş istemciyi aynı porttan (3001) sunar; ayrı bir statik sunucu gerekmez (`CLIENT_DIR` ile başka bir klasör gösterilebilir).

**Telefonla denemek için** (bilgisayar ve telefon aynı Wi-Fi'da):

1. Bilgisayarda `npm run build` ve `npm run start`. Sunucu tüm ağ arayüzlerini dinler.
2. Bilgisayarın yerel adresini öğren (Windows: `ipconfig`, "IPv4 Address"; macOS/Linux: `ifconfig` ya da `ip addr`), örn. `192.168.1.23`.
3. Telefonun tarayıcısında `http://192.168.1.23:3001` adresini aç. Windows güvenlik duvarı ilk seferde Node.js için izin isteyebilir; "özel ağlar"a izin ver.
4. Bir oda kur, bilgisayardaki tarayıcıdan ya da ikinci bir telefondan koduyla katıl.

Geliştirirken (`npm run dev`) Vite da yerel ağdan açılır: `http://192.168.1.23:5173`; `/socket.io` isteklerini sunucuya (`ADA_SERVER`, varsayılan `http://localhost:3001`) yönlendirir. İstemci her zaman kendi origin'ine bağlandığından telefonda da ek ayar gerekmez. Ana ekrana eklenebilir (manifest ve simgeler var); servis çalışanı bilerek yok (DECISIONS.md).

### İstemci (`packages/client`)

| Alan | Dosya | Not |
| --- | --- | --- |
| Soket ve oturum | `src/net/` | `Connection` (hello, yeniden bağlanma, sürüm denetimi), `store.ts` (saf reducer), `storage.ts` (engelli ya da dolu depolamada bellekte devam eder) |
| Çok dilli | `src/i18n/` | `tr.ts` anahtarları belirler, `en.ts` aynı anahtarlara sahip olmak zorunda; çekirdeğin ve sunucunun tüm olay ve hata anahtarları test edilir |
| Tahta | `src/board/` | `MapDef`'ten çizilir (`topologyOf`); üç harita, desenli bölgeler, jeton, haydut, limanlar, yasal hamle vurgusu, yakınlaştırma |
| Oyun denetimi | `src/game/controls.ts` | saf: görünüm ve `LegalMoves`'tan faza göre kontroller, pasiflik nedenleri |
| Zar ve üretim | `src/game/roll.ts`, `src/ui/DiceTray.tsx` | saf durum makinesi (yuvarlanma 800 ms, ortada 500 ms, köşeye 200 ms); animasyon yalnızca olanı anlatır, oyunu bekletmez |
| Takas | `src/game/tradeView.ts`, `src/screens/sheets/TradeSheet.tsx` | saf mantık (oranlar çekirdekten, pasiflik nedenleri, özet cümleler) ve sabit eylem çubuklu ekran |
| Ekranlar | `src/screens/`, `src/ui/` | giriş, lobi, oyun; takas, maliyet, günlük, atma, çalma, kartlar, ele geçirme, oyun sonu |
| Uçtan uca | `e2e/` | Playwright, iki mobil bağlam; ekran görüntüleri `docs/screenshots/` (commit'te değil) |

İstemci kural yeniden yazmaz: yasal hamleler sunucudan (`legal`, her güncellemeyle gelir), reddin nedeni ve ele geçirme önizlemesi `game:preview`'den gelir; rakibin eli istemciye hiç gelmez.

### Sunucu (`packages/server`)

| Alan | Dosya | Not |
| --- | --- | --- |
| Soket katmanı | `src/server.ts` | yalnızca taşıma: doğrula, yönlendir, her oyuncuya kendi görünümünü yolla |
| Oda ve lobi iş mantığı | `src/service.ts`, `src/rooms/` | soket bilmez; oyun mantığından ayrı (ileride eşleştirme buraya takılır) |
| Oda deposu | `src/rooms/store.ts`, `memoryStore.ts` | `RoomStore` arayüzü, şimdilik bellek içi |
| Çekirdek köprüsü | `src/game/session.ts` | çekirdeğe yalnızca `createGame`, `applyAction`, `viewFor`, `eventsFor` ve tiplerle bağlanır |
| Kimlik | `src/identity.ts` | `PlayerIdentity` arayüzü, şimdilik imzalı rastgele kimlik |
| Mesaj doğrulama | `src/validate.ts` | her gelen veri yeni bir nesneye çevrilir |
| Hız sınırı | `src/rateLimit.ts` | bağlantı başına jeton kovası, adres başına oda kurma sınırı |
| Mesaj tipleri | `packages/protocol` | olay adları, `LobbyView`, hata anahtarları |

**Olaylar.** İstemci → sunucu (hepsi ack'li): `identity:hello`, `room:create`, `room:join`, `room:leave`, `lobby:setName`, `lobby:setRole`, `lobby:setMode`, `lobby:start`, `lobby:reset`, `game:action`. Sunucu → istemci: `lobby:update`, `game:snapshot` (başlangıç ve yeniden bağlanma), `game:update` (`{view, events}`: her oyuncuya kendi görünümü ve sansürlü olaylar), `presence` (kopma/dönme), `replaced`. Hata: `{ok:false, error:{key, ...değerler}}`; çekirdek reddi `key:'game'` içinde `error` olarak aynen taşınır. Sunucuda metin yok.

**Kimlik akışı.** Bağlanınca `identity:hello {token?}`: geçerli token aynı oyuncuyu geri verir, yoksa ya da geçersizse yeni kimlik üretilir. Cevapta oyuncunun aktif odası da gelir; sayfa yenilenince oda ve oyun kendiliğinden geri yüklenir.

**Testler.** Birim: oda kodu, lobi (rol çakışması, host yetkisi ve devri), `RoomStore`, kimlik, hız sınırı. Uçtan uca (gerçek WebSocket): oda kur/katıl, rol çakışması, yetkisiz başlatma, geç katılım, yeniden bağlanma, oda ömrü, bozuk istekler, hız sınırı. 2-5 oyunculu kısa mod oyunları botlarla soketler üzerinden bitirilir; her adımda istemcinin aldığı görünüm `viewFor` çıktısıyla birebir karşılaştırılır ve sızıntı denetlenir (rakip eli, gelişim kartları, deste içeriği ve sırası, gizli puanlar, çalınan/satın alınan kart türü; oyun bitince açılması beklenen davranıştır).

### İki terminalle elle deneme (`ada-cli`)

Terminal istemcisi sunucuyu elle denemek içindir (geliştirici aracı, yeni bağımlılık yok). Kimlik `~/.ada-cli/<id>.json` içinde saklanır; aynı `--id` ile kapatıp açınca odanıza dönersiniz.

```
# Terminal 1: sunucu
npm run server                       # PORT=3001; tarayıcı istemcisi için CORS_ORIGINS='*'

# Terminal 2: oyuncu A (elle)
npm run cli -- --id ayse             # --url http://localhost:3001 varsayılan, --raw ham mesajları yazar
> create Ayse                        # oda kodunu yazar, örn. KMTP
> mode short                         # 7 puanlık kısa oyun
> role sage                          # istersen; seçmezsen başlatırken rastgele atanır

# Terminal 3: oyuncu B (bot)
npm run cli -- --id bora
> join KMTP Bora
> autoplay on                        # açgözlü botla kendiliğinden oynar

# Terminal 2: oyunu başlat ve elle oyna
> start
> map                                # köşe/kenar kimlikleri ve yapılar
> legal                              # şu an yasal olanlar (settle: ..., road: ... )
> settle 12                          # kurulum: yerleşim, sonra yol
> road 17
> state                              # faz, sıra kimde, elin, puanlar
> roll   >  settle/city/road/buy/bank wool ore   >  end
```

Komutlar: `help` hepsini listeler (`create`, `join`, `name`, `role`, `mode`, `start`, `reset`, `leave`, `roll`, `end`, `settle`, `city`, `road`, `buy`, `bank`, `robber`, `steal`, `discard`, `knight`, `plenty`, `monopoly`, `offer`/`accept`/`cancel`, `capture`, `state`, `map`, `legal`, `autoplay`, `raw <json>`, `emit <olay> <json>`). Yeniden bağlanmayı denemek için A'yı `quit` ile kapatıp aynı `--id` ile açın; oda ve oyun geri gelir, B'ye `playerDisconnected` / `playerReconnected` bildirimi düşer. Gizli bilgi sızıntısını gözle kontrol etmek için `--raw` ile açıp rakibin `hand` ve `devCards` alanlarının `null` olduğuna bakın.

`legal` ve `autoplay` sunucudaki `game:legal` olayını kullanır: çekirdekteki `legalMovesFor`, doğrulayan fonksiyonlarla aynı kodu çağırır ve yalnızca soran oyuncunun kendi seçeneklerini döndürür.

### Asker'i elle deneme

Asker'in ele geçirmesi pahalıdır (yerleşim 2 koyun + 2 buğday + 3 cevher) ve oyunun başında kimsenin elinde bu kadar kart olmaz. Denemek için sunucuyu **test ortamında** `ADA_TEST_RESOURCES` ile başlat: oyun başında her oyuncuya her kaynaktan o sayıda kart verilir (bankadan düşülür; kaynak toplamı değişmez). Bu seçenek yalnızca `NODE_ENV=test` iken okunur, başka her ortamda yok sayılır (sunucu testi kanıtlar).

```powershell
# 1) derle ve sunucuyu test ortamında başlat (PowerShell)
npm run build
$env:NODE_ENV = 'test'
$env:ADA_TEST_RESOURCES = '6'     # her oyuncuya her kaynaktan 6 kart
npm run start                     # http://localhost:3001

# işin bitince aynı pencerede değişkenleri temizle
Remove-Item Env:NODE_ENV, Env:ADA_TEST_RESOURCES
```

İsteğe bağlı: `$env:ADA_TEST_SEED = '7'` aynı zarları ve tahtayı yeniden üretir, `$env:ADA_TEST_VP = '4'` oyunu 4 puanda bitirir.

**Kaç oyuncu, hangi roller.** İki oyuncu yeter: ikinci oyuncu için başka bir tarayıcı ya da gizli pencere aç (kimlik tarayıcıda saklanır, aynı pencerede iki oyuncu olmaz). Birinci oyuncu odayı kurar ve **Asker**'i seçer, ikinci oyuncu katılır ve başka bir rol seçer (örn. **Bilge**). Birinci oyuncu **Kısa** modu seçip başlatır. Üç ya da daha çok oyuncuyla bankanın stoğu yetmeyebilir; kartlar turlar halinde dağıtılır, kimse koltuğu yüzünden eksik kalmaz.

**Ne yapacaksın.**

1. Kurulumu bitir (her oyuncu bir yerleşim ve bir yol, sonra ikinci yerleşim ve yol).
2. Sıra Asker'e gelince zarı at (her oyuncunun 30 kartı vardır; yedi gelirse kart atma ekranı çıkar ve yarısını, 15 kartı atarsın).
3. **Ele geçir** düğmesine bas. Rakibin yapıları ve yolları tahtada işaretlenir: turuncu kesikli = seçilebilir, gri = şu an seçilemez.
4. Rakibin bir yerleşimine dokun. Altta maliyet ve puan değişimi görünür ("Rakip: 2 → 1 puan", "Asker: 2 → 3 puan"). **Onayla**'ya bas: yapı Asker'in rengine geçer, iki ekranda da aynı sonuç görünür, günlükte "ele geçirdi" yazar.
5. Turda yalnızca bir kez ele geçirebilirsin; düğme pasif olur. Turu bitir, rakip oynasın, sıra tekrar sende olunca rakibin kalan **tek** yerleşimine dokun: seçilemez, nedeni yazar ("Rakibin son yerleşimi ya da şehri ele geçirilemez"). Rakibin yollarını ele geçirmek (2 cevher + 2 koyun) hâlâ mümkündür.

Aynı akış otomatik olarak da denenir: `npm run e2e` içindeki `capture.spec.ts` üçüncü bir sunucuyu (`ADA_TEST_RESOURCES=6`, port 4302) kullanır.

### Çekirdek (`packages/game-core`)

#### Ne var

| Alan | Dosya | Not |
| --- | --- | --- |
| Harita (veri) | `src/maps/` | `MapDef`, 3 harita, topoloji, tahta üretimi |
| Kurallar | `src/validate.ts`, `src/reducer.ts` | tek doğrulama, tek giriş noktası `applyAction` |
| Üretim, takas, limanlar | `src/production.ts`, `src/trade.ts` | sınırlı banka, 4 / 3 / 2 oranı |
| Puan | `src/scoring.ts` | en uzun yol, en büyük ordu, gizli puan, kazanma |
| Gelişim kartları | `src/reducer.ts`, `src/validate.ts` | 25 kartlık deste, faz makinesi (`returnPhase`) |
| Roller (veri) | `src/roles/` | 5 rol, hook'lar ve rol aksiyonları |
| Gizli bilgi | `src/view.ts` | `viewFor`, `eventFor` |
| Testler | `test/` | birim, sızıntı ve rastgele oyun (fuzz) |

**Giriş noktası:** `applyAction(state, playerId, action, rng) → {ok:true, state, events} | {ok:false, error}`. Çekirdek metin üretmez; olay ve hata `{type, ...değerler}` biçimindedir, çevirmek istemcinin işidir. State düz JSON'dur, rastgelelik yalnızca `rng` ile gelir. Yasal hamle listeleyicileri (`legalSettlementVertices`, `legalRoadEdges`, `legalBankTrades`, `legalDevPlays`, `legalRoleActions` ...) hamleyi doğrulayan `validate`'i çağırır; yani istemcinin vurguladığı ile sunucunun kabul ettiği aynı koddur.

**Yeni rol eklemek:** `src/roles/defs.ts` içine bir kayıt eklemek yeter (hook'lar ve isteğe bağlı `actions`). Çekirdekte rol adı yoktur (`roles.test.ts` denetler). Yeni bir hook gerekirse `RoleDef`'e eklenir ve ilgili kural noktasında çağrılır.

**Yeni harita eklemek:** `MapDef` verisi yazılır (`tiles`, `terrains`, `numbers`, `harborSlots`, `harborPool`); `validateMap` kontrol eder, `createGame({ map })` ile kullanılır.

### Kural kararları (özet)

- **Haritalar:** klasik 19 bölge (2-4 oyuncu), 5 oyuncuda 30 bölgelik genişleme düzeni, kısa modda 14 bölgelik elmas; kısa modda 5 oyuncu klasik haritayı kullanır. Banka stoğu: standart 19 (5 oyuncuda 24), kısa 14 (5 oyuncuda 19).
- **Kazanma:** Standart 10, Kısa 7 puan. Her aksiyondan ve tur başlangıcından sonra yalnızca sırası gelen oyuncu için kontrol edilir; gizli zafer puanı kartları sahibinin kendi kontrolünde sayılır.
- **Takas oranı:** liman en iyisi, sonra rol hook'u, 2:1'in altı yok.
- **Roller:** Asker (ele geçirme), Bilge, Denizci, Diplomat (rastgele banka kaynağı), Hasatçı. Ayrıntılar ve tüm varsayımlar DECISIONS.md'de.
- **Gizli bilgi:** istemci yalnızca `viewFor` çıktısını görür; olaylar `eventFor` ile sansürlenir.

### Test özeti

- Birim: harita (3 harita × 300 tohum), kurulum, inşa, üretim ve banka stoğu, yedi/atma/haydut, takas, en uzun yol, limanlar, gelişim kartları, 5 rol.
- Sızıntı: rakibin el dağılımı, kart türleri ve deste sırası değişince görünüm değişmemeli (gerçek oyun adımlarında da).
- Fuzz: botlar 200 oyun oynar (2-5 oyuncu, her rol 140 oyunda, iki mod); her adımda banka+eller sabit toplam, deste+oynanan+eldeki 25, negatif kaynak yok, parça limitleri, mesafe kuralı, en uzun yol/en büyük ordu sahipliği, puanların yapılardan yeniden hesabı ve doğrulama-reducer uyumu kontrol edilir.

### Açık kalanlar

- **Denge:** `npm run balance` (rastgele ve açgözlü bot ayrı, oynanan oyuna göre, 300 oyun/oyuncu sayısı/mod, sonda gürültü payı). Hasatçı bonusu daraltıldı (yalnızca kendi atışında, yapıya denk gelmediyse ve elinde en çok 3 kart varken); tüm oyunlarda Hasatçı %31-32 (eşit pay %28,6). Açık: Bilge eşit paydanın +5/+8 puan üstünde, Asker −6 civarında, 2 oyunculu oyunda Hasatçı +17/+19 (bilinen, kabul edilmiş). Ayrıntı DECISIONS.md'de.
- **Kısa mod + 5 oyuncu** ve **large30 / short14 dizilimleri** varsayımdır; gerçek oyun testiyle doğrulanmadı.
- **Diplomat bonusu** seçimsiz rastgele kaynaktır; oyuncunun seçmesi istenirse bekleyen-karar fazı gerekir.
- **En uzun yol hesabı** her yol/yapı değişiminde tüm oyuncular için çalışır (DFS); fuzz testinde sorun çıkmadı, ama sunucu yükü ölçülmedi.
- **Çeviri dosyaları (tr/en)** istemciyle gelecek; çekirdek ve sunucu yalnızca anahtar ve değer üretir.
- Rol hook'larında şu an `discardLimit` ve `cost` kullanan rol yok; GDD "bazı roller için farklı limit" dediği için tutuldu.

### Canlıya alırken

- **`SERVER_SECRET` sabit bir değer olmalı** (uzun, rastgele, gizli). Yoksa sunucu her başlatmada rastgele bir anahtar üretir ve o ana kadar verilen tüm oyuncu kimlikleri geçersiz olur; oyuncular yeni kimlik alır, açık odalarına dönemez.
- `CORS_ORIGINS` yalnızca kullanılan adresler olmalı (`*` canlıda kullanılmaz); `PORT` ortamdan gelir.
- Oda deposu bellektedir: sunucu yeniden başlarsa odalar gider.

### Sunucuda açık kalanlar

- Sunucu yeniden başlarsa odalar gider (kalıcı depo yok); `SERVER_SECRET` sabitse token'lar geçerli kalır.
- Kopan oyuncunun sırasında oyun bekler; tur zamanlayıcısı ve "atlat" yok (GDD'de sonraki sürüm).
- Hesaplı kimlik, eşleştirme, izleyici, sohbet yok. Oyun sırasında `room:leave` yalnızca koltuğu "ayrıldı" yapar, oyuncuyu oyundan çıkarmaz.
- Hız sınırı değerleri ilk tahmindir, gerçek yük altında ölçülmedi.
- Dağıtım için `build` (tsc çıktısı) yok; sunucu `vite-node` ile çalışır.
- Bilge ve Asker dengesi gerçek oyun testinden sonra ele alınacak (bkz. Denge).
