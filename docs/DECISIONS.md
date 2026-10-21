# Kararlar ve varsayımlar

Biçim: tarih, karar, gerekçe, etiket. "Varsayım" etiketli maddeler GDD'de belirsiz olan noktalardır; GDD ile çelişirse GDD kazanır.

## 2026-10-19: Aşama 1 (game-core)

### Altyapı
- **Bağımlılıklar** (kesin): yalnızca devDependencies `typescript`, `vitest`, `@types/node`. Gerekçe: v0 ile aynı araçlar, çalışma zamanı bağımlılığı yok. `build` script'i yok (yalnızca çekirdek paket, derlenecek çıktı yok).
- **Rol kimlikleri** düz `string`: rol listesi veridir, `RoleId` birleşik tipi roller eklenince çekirdeği değiştirmeye zorlar.
- **Oyuncu rengi** çekirdekte yok, yalnızca `seat`. Renk görsel karardır, istemcinin işi (GDD'de 4 renk var, 5 oyuncu için 5. renk istemcide seçilir).
- **State kendi haritasını taşır** (`state.map`): özel haritalar kayıt defterine bağlı kalmadan çalışır; topoloji `topologyOf(map)` ile türetilir ve önbelleğe alınır.

### Harita (Adım 1)
- **classic19** (2-4 oyuncu, standart): yarıçap 2, 19 bölge, 54 köşe, 72 kenar, 30 kıyı kenarı, 9 liman (4 genel + 5 özel). Arazi 4/4/4/3/3 + 1 çöl, jeton GDD'deki 18.
- **large30** (5 oyuncu, standart; kesin karar): klasik 5-6 oyunculu genişleme düzeni, 3-4-5-6-5-4-3 satırlarında 30 bölge, 80 köşe, 109 kenar, 38 kıyı kenarı. Arazi 6 odun, 6 koyun, 6 buğday, 5 tuğla, 5 cevher, 2 çöl; 28 jeton (2 ve 12 ikişer, diğerleri üçer). 11 liman (5 özel + 6 genel). Haydut ilk çölde başlar.
- **short14** (2-4 oyuncu, kısa mod; kesin karar): 2-3-4-3-2 satırlı elmas, 14 bölge, 42 köşe, 55 kenar, 26 kıyı kenarı. Arazi 3/3/3/2/2 + 1 çöl; 13 jeton (2,3,4,4,5,5,6,8,9,9,10,10,11). 7 liman (5 özel + 2 genel).
- **Varsayım:** Kısa modda 5 oyuncu, 14 bölgelik haritaya sığmaz (5 kişi × 2 yerleşim + mesafe kuralı), bu yüzden **kısa + 5 oyuncu klasik 19 bölgeli haritayı** kullanır.
- **Banka stoğu (kesin karar):** standart 19; standart 5 oyuncu 24 (klasik genişleme stoğu); kısa 14; **varsayım:** kısa 5 oyuncu 19. Gelişim destesi her yerde 25. Hedef puan: standart 10, kısa 7.
- Köşe ve kenar kimlikleri bölge sırası × köşe sırasından türer (deterministik). Liman konumu `(bölge, kenar yönü)` ile veridir; kıyı çevresinde eşit aralıklı seçildi (iki liman asla köşe paylaşmaz, testle sabit). Liman türleri oyun başında rastgele karıştırılır.
- 6 ve 8 jetonlarının komşuluğu tekrar denemeyle çözülür (en fazla 2000 deneme); 3 haritada 300'er tohumla test edilir.

### Temel kurallar (Adım 2)
- **Koltuk sırası** oyun başında `rng` ile karıştırılır; sıra `players` dizisinin sırasıdır. Kurulum sonrası ilk turu ilk koltuk oynar (yılan sırasının son yerleşimi ilk oyuncuya düşer).
- **Kazanma kontrolü** sırası gelen oyuncunun her aksiyonundan *ve tur başladığı anda* yapılır (`endTurn` sonrası yeni sıradaki oyuncu için de). **Varsayım:** rakibin turunda hedef puana ulaşan (örneğin yolu kesilince en uzun yol alan) oyuncu, kendi turu başlar başlamaz kazanır. Bir oyuncu kendi turunda hedefi geçince hamle sırasında hemen kazanır.
- **Kazanma anında** yarım kalmış adımlar (haydut, bedava yol, açık teklifler) silinir; oyun `finished` olur.
- **Yedi gelince:** limit (7) rolden değişebilir (`discardLimit` hook'u, şimdi kullanan rol yok). Atılan kartlar bankaya gider. Atma herkesten aynı anda alınır (sırası gelen olmayan da `discard` gönderir). Haydut başka bölgeye gitmek zorundadır. Kartı olmayan komşu, çalma hedefi sayılmaz.
- **Oyuncu takası:** aynı anda tek açık teklif; yeni teklif eskisinin yerine geçer; tur bitince silinir. Teklifi yalnızca sırası gelen verir, başkaları kabul eder, sırası gelmeyenler arasında takas yok.
- **Takas oranı sırası:** oyuncunun limanlarından en iyisi (4 / 3 / 2), sonra rol hook'u, çekirdek tabanı 2:1 (2'nin altı yok). Bankada olmayan kaynak istenemez.
- **Üretimde banka stoğu** GDD'deki paylaşım kuralına uyar (birden çok alıcı → kimse; tek alıcı → kalan kadar). Kurulumdaki ikinci yerleşim kaynakları da bankadan çıkar.
- **En uzun yol:** ≥5 ve tek başına en uzun; beraberlikte mevcut sahip korunur; sahip yokken beraberlik varsa kimse almaz. `longestRoad.length` sahip olmasa da en uzun yolun uzunluğunu (≥5 ise) taşır.
- **Çekirdek günlük (log) tutmaz.** `applyAction` olayları döndürür; saklama ve metne çevirme sunucu/istemcinin işidir.
- **Performans:** `applyAction` state'i kopyalarken `map`, `tiles` ve `harbors`'ı paylaşır (oyun kurulunca hiç değişmezler); gerisi `structuredClone` ile kopyalanır. Topoloji önbelleği harita kimliğine göre tutulur ve karelerle doğrulanır.

### Gelişim kartları (Adım 4)
- Kart `boughtTurn` ile saklanır; satın alınan tur oynanamaz. Turda en fazla 1 kart (zafer puanı kartları oynanmaz, sayılmaz).
- **Şövalye:** zar öncesi (`roll` fazı) ve ana fazda oynanır; `returnPhase` ile oyuncu bulunduğu faza döner. Zarla gelen 7'de `returnPhase = 'main'`.
- **Yol inşası:** `roadBuilding` fazı. **Varsayım:** hiç yasal yol yeri yokken oynanamaz (kart boşa gitmesin). Kalan hak, yasal yer ya da yol limiti bitince otomatik düşer (`roadBuildingEnded` olayı).
- **Bolluk yılı:** **Varsayım:** yalnızca banka seçilen iki kaynağı da karşılayabiliyorsa oynanır; seçim kaynak tipidir (aynı kaynak iki kez olabilir).
- **Tekel:** kaynak seçilir, diğer herkesin o kaynaktaki tüm kartları oynayana geçer; banka karışmaz.
- **En büyük ordu:** en az 3 şövalye ve mevcut sahibinden kesin fazla; beraberlikte sahip korunur.
- **Gizli zafer puanı kartları:** `publicPoints` saymaz; `totalPoints` sahibin kendi kazanma kontrolünde sayar. Oyun bitince `viewFor` herkesin kartlarını açar.

### Roller (Adım 5)
- Rol kimlikleri: `soldier` (Asker), `sage` (Bilge), `sailor` (Denizci), `diplomat` (Diplomat), `harvester` (Hasatçı). Çekirdek dosyalarında bu adlar geçmez (`roles.test.ts` tarar); yalnızca `roles/defs.ts`'te.
- **Hook'lar:** `cost`, `devCardCost`, `bankRatio`, `discardLimit`, `onProduce`, `onTradeAccepted`. Rol aksiyonu: `{type:'roleAction', name, params}`; çekirdek yalnızca oyuncunun *kendi* rolünün aksiyon tablosuna yönlendirir. v0'daki `onSettlementBuilt` kullanan rol kalmadığı için alınmadı.
- **Bonuslar banka stoğunu aşamaz:** tüm rol kazançları `grantFromBank` üzerinden geçer (kalan kadar verir).
- **Bilge:** gelişim kartı 1 koyun ucuz (koyun 0'a iner, başka bir şey değişmez).
- **Denizci:** liman oranından 1 düşer, sonra çekirdek tabanı 2:1.
- **Diplomat:** **Varsayım:** bonus, bankada stoğu olan kaynaklardan `rng` ile rastgele 1 karttır (seçim yok); bankada hiç kart yoksa verilmez ve sayaç artmaz. Teklif sahibinin rolü bakılır, kabul edenin değil. "Turda en fazla 1" sınırı `turnFlags.counters.tradeBonus` ile tutulur; tur bitince sıfırlanır.
- **Hasatçı:** ~~**Varsayım:** 7 dışı bir zarda üretimden toplam 0 kart aldıysa (haydut ya da banka stoğu yüzünden olsa da) bankada stoğu olan kaynaklardan rastgele 1 alır. Hiç yapısı olmayan oyuncu da bunu alır (kurulumdan sonra pratikte olmaz).~~ Aşama 2 Adım 0'da değişti, aşağıya bak.
- **Asker ele geçirme** (`capture`, `{kind, id}`): maliyetler GDD tablosundaki gibi (yol 2 cevher + 2 koyun; yerleşim 3 cevher + 2 koyun + 2 buğday; şehir 5 cevher + 3 koyun + 3 buğday), ana fazda, turda en fazla 1 (`counters.capture`). **Varsayımlar:** hedef herhangi bir rakip parçasıdır, yol için bağlantı şartı yoktur; Asker'in ilgili parça limiti doluysa seçilemez (ele geçirilen parça Asker'in sayısına, eski sahibinin sayısından düşer); maliyet bankaya gider; ele geçirilen parça `turn + oyuncu sayısı` turuna dek ele geçirilemez (bir tam tur); hedef oyuncunun son yerleşim/şehri ele geçirilemez (oyundan eleme koruması). Ele geçirmeden sonra en uzun yol yeniden hesaplanır, ardından kazanma kontrolü yapılır.

### Gizli bilgi (Adım 6)
- İstemciye giden tek şey `viewFor(state, playerId)`: rakip eli, gelişim kartları, gizli puanlar `null`, yalnızca `handCount` / `devCardCount`; deste `devDeckCount`. Seyirci (oyunda olmayan kimlik) hiçbir eli görmez. Oyuncunun kendi rol-ayarlı maliyetleri ve banka oranları `mine` içinde gelir.
- Olaylar da sansürlenir: `eventFor(event, playerId)` — çalınan kartı yalnızca çalan ve çalınan, satın alınan kartın türünü yalnızca alan görür.
- Sızıntı testleri **müdahale etmeme** ilkesiyle yazıldı: rakibin gizlilerini (el dağılımı, kart türleri, deste sırası) değiştirmek bir oyuncunun görünümünü değiştirmemeli; gerçek oyunlarda her adımda denenir.

### Rastgele oyun testi (Adım 7)
- Bot yalnızca yasal-hamle listeleyicilerinin ürettiği hamleleri oynar; her hamlede `validate` ile `applyAction`'ın uyuşması, reddin state'i değiştirmemesi (her 10 adımda JSON karşılaştırması), geçersiz hamle denemelerinin reddi ve CLAUDE.md'deki tüm değişmezler kontrol edilir. Kontroller `expect` değil düz `throw`.
- 200 oyun (2-5 oyuncu × iki mod × 25 tohum; roller döndürülerek her rol 140 oyunda oynar). Tüm aksiyon türleri ve Asker ele geçirmesi oynanır (testte zorunlu kılınır). Son koşuda 200 oyunun 200'ü bitti (80 bin hamle), 2575 çalma, 105 ele geçirme; süre yaklaşık 7 sn.
- **Not (denge, Aşama 4'te bakılacak):** rastgele botlarla Hasatçı kazanma oranı belirgin yüksek çıktı (son koşuda 200 oyunun 119'unu Hasatçı kazandı; Bilge 30, Denizci 28, Diplomat 14, Asker 9). Bot rastgele olduğu için kesin kanıt değil, ama "üretimi fazla artırmamalı" uyarısına işaret eder; ayarlanması GDD'deki denge simülasyonuna bırakıldı.

## 2026-10-19: Aşama 2, Adım 0 (Aşama 1 düzeltmeleri)

- **Hasatçı bonusu (karar, önceki varsayımın yerine geçer):** bonus yalnızca zar sonucu oyuncunun hiçbir yapısına denk gelmediği için kaynak alamadıysa çalışır. Zar yapısına denk geldiği halde haydut (bölge engelli) ya da banka stoğu yetersizliği yüzünden kaynak alamadıysa bonus yok. Uygulama: `onProduce` hook'una `matched` alanı eklendi (oyuncunun yapısı, bu sayıyı taşıyan bir bölgeye, haydutlu olsa da, değiyor mu); Hasatçı `matched` ise ya da zaten kaynak aldıysa bir şey almaz. Çekirdekte rol adı geçmez. Test: `roles.test.ts` (haydut ve banka stoğu durumları). **Bilinçli test değişikliği:** "engelli bölge üretimsiz sayılır" testi tersine çevrildi, çünkü kural tam olarak bu durumu dışarıda bırakıyor.
- **Denge raporu:** `npm run balance` (`-- --games=N --seed=S`). Roller oyunlara dengeli dağıtılır (her oyuncu sayısı için en az oynamış roller önce seçilir, eşitlikte tohumlu rastgele), oyuncu başına oynanan / kazanılan / oynanan oyuna göre kazanma oranı ve "beklenen" (eşit güçte 1/oyuncu sayısı) ile oran raporlanır; tümü, 2-5 oyunculu ve moda göre ayrı. Bitmeyen oyunlar (adım sınırı) oranların dışında bırakılır ve sayısı yazılır. Bot ve rastgele sayı üretici `packages/game-core/sim/` altına taşındı (fuzz testi ve rapor ortak kullanır); yeni bağımlılık yok (`vite-node` vitest ile gelir).
- **Ölçüm sonucu (150 oyun × 4 oyuncu sayısı × 2 mod, 840 oyun/rol):** kazanma oranı Hasatçı %87,4 (beklenen %28,6), Bilge %18,5, Diplomat %13,8, Denizci %12,4, Asker %10,8. Eski ve yeni Hasatçı kuralı arasında fark yok denecek kadar küçük (40'lık koşuda %90,2 → %89,7): baskınlık haydut/banka kenar durumlarından değil, "zar yapıya denk gelmedi" bonusundan geliyor. Dengeye bu aşamada dokunulmadı.

## 2026-10-19: Aşama 2 (sunucu)

### Yapı ve bağımlılıklar
- **Yeni bağımlılıklar** (plana uygun): `socket.io` (sunucu, `ws` ile gelir) ve `socket.io-client` (yalnızca sunucu testleri, devDependency). Başka bir şey eklenmedi. Çalıştırma için `vite-node` kullanılır (vitest ile zaten gelir).
- **`packages/protocol`** (karar): yalnızca tip ve sabit içeren yeni paket (olay adları, `LobbyView`, hata anahtarları); oyun tipleri `game-core`'dan yeniden dışa aktarılır. Gerekçe: istemci sunucu paketine bağımlı olmasın.
- **Çekirdek bağlantısı:** sunucu `createGame`, `applyAction`, `viewFor`, `eventsFor`, `isRoleId`, `ROLE_LIST`, sabitler ve tiplerle bağlanır; kural kontrolü sunucuda yok. Sunucu testlerindeki bot, `packages/game-core/sim/bot.ts`'i (Adım 0'da çıkarılan ortak bot) göreli yolla içe aktarır.
- Oda/lobi kodu (`rooms/`, `service.ts`) oyun mantığını bilmez; `game/session.ts` ikisi arasındaki tek köprü.

### Kimlik ve bağlantı
- **Kimlik:** sunucu `crypto.randomUUID` ile oyuncu kimliği üretir, HMAC-SHA256 ile imzalı token (`id.imza`) verir; istemci kendi uydurduğu kimliği kabul ettiremez. **Varsayım:** `SERVER_SECRET` ortam değişkeni eklendi; yoksa süreç başına rastgele üretilir (yeniden başlatmada eski token'lar geçersiz olur; geçersiz ya da eksik token'a sessizce yeni kimlik verilir, hata dönülmez).
- **Varsayım:** yalnızca WebSocket taşıması (long-polling kapalı).
- **Varsayım:** aynı kimlikle ikinci bağlantı gelince eskisi `replaced` bildirimiyle düşürülür (sayfa yenileme, ikinci sekme).
- `identity:hello` cevabında oyuncunun aktif odası da gelir; bağlanınca oda kendiliğinden geri yüklenir (lobi ve oyun görünümü).

### Oda ve lobi
- **Oda kodu:** 4 harf; alfabe 22 harf (`ABCDEFGHJKMNPRSTUVWXYZ`), I/L ve O/Q karışabildiği için elendi, rakam yok. Girişte büyük harfe çevrilir.
- **Varsayım:** lobide kopan oyuncunun koltuğu kalır (sayfa yenileyince rolü kaybolmasın); oda dolduğunda bağlı olmayan (ve host olmayan) bir koltuk boşaltılarak yeni oyuncu alınır. Başlatırken bağlı olmayan koltuklar düşürülür; en az 2 bağlı oyuncu gerekir.
- **Varsayım:** host bağlı değilse ya da ayrıldıysa devir, katılış sırasındaki ilk bağlı oyuncuya olur; dönen host rolünü geri almaz. Kimse bağlı değilse host korunur.
- **Varsayım:** oyun başladıktan sonra `room:leave` oyuncuyu oyundan çıkarmaz: koltuk "ayrıldı" (`away`) olur, oyuncu başka bir odaya girebilir ya da koduyla geri dönebilir. Oyun sürerken yeni oyuncu giremez.
- **Varsayım:** rol seçmeyene başlatırken, kimsenin tutmadığı roller arasından `crypto` rng ile rastgele atanır. Mod ve rol yalnızca lobide değişir.
- **Varsayım:** oyun bitince oda `finished` olur; hamleler `notInGame` ile reddedilir; yalnızca host `lobby:reset` ile lobiye döner (isim ve roller korunur, bağlı olmayanlar çıkar).
- **Oda ömrü:** bağlı oyuncu kalmayınca `emptySince` başlar; 3 saat dolunca dakikada bir çalışan süpürme siler; biri dönerse saat sıfırlanır. Lobide herkes çıkıp koltuk bile kalmasa oda yine 3 saat bekler (tek tip kural).
- **Kopan oyuncu:** oyun duraklamaz. Kopma/dönme `presence` bildirimiyle gelir (`playerDisconnected`, `playerReconnected`); lobi görünümünde `connected` bayrağı da güncellenir.

### Oyun akışı ve gizlilik
- Sunucu `applyAction`'ı `crypto` tabanlı `rng` ile çalıştırır (`rng.ts`). Başarılı hamleden sonra her oyuncuya `{view: viewFor(...), events: eventsFor(...)}` gider (`game:update`); başlangıçta ve yeniden bağlanmada `game:snapshot`.
- Hatalar `{key, ...değerler}`: `badPayload`, `unknownEvent`, `rateLimited`, `noIdentity`, `roomNotFound`, `roomFull`, `gameStarted`, `alreadyInRoom`, `notInRoom`, `notInLobby`, `notInGame`, `gameNotFinished`, `notHost`, `roleTaken`, `unknownRole`, `badName`, `badMode`, `needMorePlayers`, `internal`; çekirdek reddi `key:'game'` + `error` (çekirdeğin `GameError`'ı). Sunucuda Türkçe/İngilizce metin yok.
- **Mesaj doğrulama:** her istemci mesajı `validate.ts`'te şekil açısından denetlenir ve yeni bir nesneye kopyalanır (fazladan alan geçmez). Anlam denetimi çekirdeğe aittir. İsim 1-24 karakter, kontrol karakteri yok. `roleAction.params` düz nesne ve en çok 1000 karakter JSON. Soket mesaj sınırı 16 KB (aşan bağlantı düşer).
- **Hız sınırı (varsayım, ilk tahmin):** bağlantı başına jeton kovası (20 mesaj patlama, saniyede 10); art arda 100 sınırlama alan bağlantı koparılır. Adres başına oda kurma: 10 patlama, dakikada 10 yenilenme. Değerler seçenekle değiştirilebilir. Bilinmeyen olaylar ack ile `unknownEvent` döner.
- **Ortam:** `PORT` (varsayılan 3001), `CORS_ORIGINS` (virgülle ayrık; boşsa kimseye izin yok, `*` hepsine), `SERVER_SECRET`.

### Test kararları
- Sızıntı testi: bot oyunlarında her adımda her istemcinin aldığı `game:update` bire bir `viewFor(sunucu durumu, oyuncu)` ile eşit olmalı; ayrıca alınan her mesajda rakip `hand`/`devCards`/`hiddenPoints` `null`, `devDeck` anahtarı yok, destenin ilk 4 kartı ya da tamamı hiçbir mesajda geçmez, rakibin elindeki hiçbir kart nesnesi geçmez, çalınan/satın alınan kart türü yalnızca ilgili oyuncuda. Oyun bitince tüm ellerin açılması beklenen davranıştır ve testte ayrıca ele alınır. Testin yakaladığı, sunucuya geçici sızıntı koyarak doğrulandı.
- Botlar yasal hamleyi sunucunun durumundan seçer (testte istemci görünümünden yasal hamle çıkarmak için çekirdekte yardımcı yok); hamle yine gerçek soketten gider.

## 2026-10-19: Aşama 2b (denge ölçümü ve Hasatçı)

### Bot ve ölçüm
- **Açgözlü bot** (`packages/game-core/sim/greedy.ts`): sıra ile ele geçirme (Asker; şehir sonra yerleşim), şehir, yerleşim, gelişim kartı, yol (yalnızca yeni yerleşim yeri açan), şövalye, 4+ fazla kaynağı eksik olana çevirme; yedi gelince en çok yapısı olan rakibin bölgesi. Kararların yüzde 10'unu rastgele bota bırakır. Bot yalnızca istemcinin bildiği şeyden (`BotSee`: tahta, kendi eli ve maliyetleri) ve çekirdeğin `legalMovesFor` çıktısından karar verir; aynı bot CLI'nin `autoplay`'ini sürer.
- **`legalMovesFor(state, pid)`** (çekirdek, `src/legal.ts`): oyuncunun o anki tüm seçenekleri, doğrulayan fonksiyonlarla aynı kodla (CLAUDE.md madde 6). Sunucuda `game:legal` olayı yalnızca soran oyuncunun kendi seçeneklerini döndürür. `roadOpenings` her yasal yol için kaç yeni yerleşim yeri açtığını simülasyonla hesaplar.
- **`npm run balance`:** rastgele ve açgözlü botlar ayrı rapor; her ikisi ayrı tablo, sabit tohum, 2-5 oyunculu kırılım korundu. Varsayılan oyun sayısı oyuncu sayısı ve mod başına 300. Raporun sonunda tahmini gürültü payı (95%) yazılır.
- **Ölçüm gürültüsü (not):** tek bir (rol × oyuncu sayısı) hücresi için 100-200 oyunda gürültü yaklaşık ±4-5 puandır; 300 oyunda tüm oyunlar çizgisi ±2,2, 2 oyunculu ±6,3, 3 oyunculu ±4,9, 4 oyunculu ±3,9, 5 oyunculu ±3,2 puan. Bu aralıktan küçük farklar kanıt sayılmaz.

### Hasatçı (karar; Aşama 2 Adım 0'daki kuralın yerine geçer)
- **Kural:** Hasatçı bonusu yalnızca **kendi zar atışında**, zar hiçbir yapısına denk gelmediyse (haydut ve banka stoğu yüzünden alınamayan atış sayılmaz) ve **elinde en çok 3 kart varken** çalışır: bankada stoğu olan kaynaklardan rastgele 1 kart. Zaten kaynak aldıysa bonus yok. Yedide çalışmaz. Kural yalnızca `roles/defs.ts` içindeki hook'ta; çekirdekte rol adı yok.
- **Hook bağlamı:** `onProduce` artık `hand` (üretim sonrası el), `roller` (zarı atan) ve `self` (hook sahibi) bilgisini de alır.
- **Gerekçe:** adaylar (A: yalnızca kendi atışı; B: A + her ikinci boş atış; C: A + yalnızca 2-5 ve 9-12; D: A + en az eldeki kaynak; E: A + elde ≤3 kart) 100 oyun/hücre ile hem rastgele hem açgözlü botla ölçüldü. Mevcut kural Hasatçı'ya %88-94 kazandırıyordu (eşit pay %28,6). Tüm oyunlarda eşit paydadan sapma: A +24/+23, B +11/+6, C +16/+13, D +41/+37, E +2,0/+4,6 (rastgele/açgözlü). E genel sapmada ±5'e en yakın olan ve en az koşul ekleyen adaydı; B ek kalıcı sayaç (state değişikliği) gerektirirdi, E gerektirmez. Seçimden sonra deney anahtarı ve `roleState` eklemesi koddan çıkarıldı.
- **E+B ve başka varyantlar ölçülmedi** (karar: 3-5 oyunculu oyunlarda E zaten ±5 civarında).
- **Kabul edilmiş durum (b):** 2 oyunculu oyunda Hasatçı eşit paydanın yaklaşık 17-19 puan üstünde kalıyor (yapı az, boş atış çok). 2 oyunculu oyun şimdilik yalnızca test içindir, denge hedefi dışındadır.
- **Yeni ölçüm (300 oyun, E uygulanmış), tüm oyunlar:** rastgele botlarda Hasatçı %32,2, Bilge %33,3, Denizci %27,3, Diplomat %27,1, Asker %23,0; açgözlü botlarda Hasatçı %30,8, Bilge %36,3, Denizci %27,2, Diplomat %25,5, Asker %23,0 (eşit pay %28,6, gürültü ±2,2). Hasatçı 3 oyunculuda +5/+10 üstte, 5 oyunculuda −3/−5 altta; yani oyuncu sayısı arttıkça etkisi azalıyor.

### Açık maddeler
- **Bilge** her iki botta eşit paydanın üstünde: tüm oyunlarda rastgele botla +4,7, açgözlü botla +7,7 puan (3 oyunculuda açgözlü +9,5). Gerçek oyun testinden sonra ele alınacak; bu aşamada değiştirilmedi.
- **Asker** her iki botta eşit paydanın altında (tüm oyunlarda yaklaşık −5,6 puan; 5 oyunculuda −3/−4); ele geçirme açgözlü botta işe yarıyor ama toplamda yetmiyor. Değiştirilmedi.

### CLI (`ada-cli`)
- **Yer:** `packages/server/cli/` (ayrı paket yok); `socket.io-client` devDependency'den dependency'ye alındı (yeni paket değil). `npm run cli -- --id <ad> [--url] [--raw]`.
- **Varsayım:** CLI bir geliştirici aracıdır; kendi komut yanıtları ve `state`/`map` çıktıları sabit İngilizce metindir (çeviri dosyası kuralı kullanıcıya dönük istemci içindir). Sunucu hâlâ yalnızca anahtar ve değer üretir.
- **Kimlik** `~/.ada-cli/<id>.json` içinde saklanır; aynı `--id` ile açınca oda geri yüklenir. Komutlar piped girdide sırayla çalışır.
- **`game:legal`** (varsayım: onaylandı) protokolde yeni bir olay; yanıt yalnızca soran oyuncunun seçenekleri, e2e testinde çekirdek çıktısıyla eşleştirilir.

## 2026-10-20: Aşama 3, Adım 0 (Aşama 2 düzeltmeleri)

### Sızıntı testi sahte alarmı (kanıtlandı)
- **Neden:** sunucunun `rng` seçeneği zaten enjekte edilebilir (`createAdaServer({ rng })`; `main.ts` geçmediği için üretimde `crypto` kalır). Testler artık tohumlu rng ile çalışır (`test/gameplay.ts`, `test/leak-sweep.ts`).
- **Yeniden üretim:** tohum 9 (3 oyunculu, kısa mod) eski denetimi (destenin ilk 4 kartı ya da tamamı, JSON dizisi olarak) deterministik olarak düşürür. Eşleşen veri: `deckLen=0`, aranan metin `[]`; eşleşen yer her seferinde bir oyuncunun boş `"devCards":[]` listesi. Yani deste tükenince boş dizi serileştirmesi masum verilerle çakışıyordu; gerçek bir sızıntı yoktu. `leak.test.ts` bunu kalıcı bir test olarak sabitler (aynı tohum aynı oyunu verir: adım sayısı ve son tur eşit).
- **Düzeltme:** kısayol (deste en az 3 kart) yerine ayırt edici arama: oyun başında destenin tam sırası alınır ve bu sıranın 6 kartlık tüm kayan pencereleri (`"knight","monopoly",...` biçiminde, köşeli parantezsiz) her oyuncunun aldığı her mesajda aranır; boş ya da kısa dizi bu aramada eşleşemez (birim testi). Buna ek: `devDeck` anahtarı hiçbir yerde yok, rakibin elindeki hiçbir kart nesnesi geçmez, rakip `hand`/`devCards`/`hiddenPoints` `null`, çalınan ve satın alınan kart türü yalnızca ilgili oyuncuda.
- **Tarama:** 200 tohum (2-5 oyuncu karışık, kısa mod), her biri baştan sona oynanır, bütün mesajlar denetlenir; her 50'lik dilim ayrı test dosyasında paralel koşar (yaklaşık 75 sn). Her dilimde en az bir oyunun destesi tükenmiş olmak zorunda (eski denetimin yanıldığı durum kapsanıyor).
- **Duyarlılık kanıtı:** bilerek koyulan iki sızıntı da testi düşürdü, sonra geri alındı: (1) görünüme `peek: devDeck.slice(0, 8)` eklemek → görünüm eşitliği düştü; (2) lobi mesajına `note: devDeck` eklemek (görünüm eşitliğini atlatan kanal) → "a stretch of the deck order leaked".

### Asker ölçümü (yalnızca ölçüm; kural ayarlanmadı)
- `npm run balance` raporuna eklendi: oyun başına ele geçirme, Asker'in oyun başına ele geçirmesi, Asker'in ana faz turlarında ele geçirmenin yasal olduğu tur oranı, şehir/yerleşim hedefinin yasal olduğu oran, turun başında eldeki ortalama cevher, ele geçirme yapan ve yapmayan oyunlarda Asker'in kazanma oranı.
- **Bulgu (100 oyun/oyuncu sayısı/mod, `--compact`):** Asker'in ele geçirmesi turlarının yalnızca %3,3'ünde (rastgele bot) ve %3,5'inde (açgözlü bot) karşılanabilir; şehir ya da yerleşim hedefi ise yalnızca %0,4 ve %0,2'sinde. Ana faz başında eldeki cevher ortalama 0,9. En ucuz hedef olan yol (2 cevher + 2 koyun) dışında bütçe neredeyse hiç yetmiyor (yerleşim 3 cevher + 2 koyun + 2 buğday, şehir 5 cevher + 3 koyun + 3 buğday).
- **Açgözlü botta neden hâlâ ele geçirme görülüyor:** bot yalnızca şehir ve yerleşim hedeflerini ister (yolu "değer 0" sayar), bunlar neredeyse hiç karşılanamadığı için bilinçli ele geçirmesi hemen hiç olmuyor; oyun başına 0,82 ele geçirme, kararların %10'unu rastgele bota bıraktığı için gelen yol ele geçirmeleridir. Yani ölçülen "Asker zayıf" bulgusu kısmen bot kaynaklı: bot cevheri şehir ve gelişim kartı için harcıyor, ele geçirmeye biriktirmiyor.
- **Dikkat:** ele geçirme yapan oyunlarda Asker'in kazanma oranı yapmayanlardan yüksek (örn. rastgele botta %29,7'ye karşı %15,3), ama bu karıştırıcıdır: uzun süren oyunlarda ele geçirme şansı artar. Nedensel yorum çıkarılmaz.
- Kurallar bu adımda değiştirilmedi; ayarlama gerçek oyun testinden sonra.

## 2026-10-20: Aşama 3 (istemci), alınan kararlar

### Bağımlılıklar (onaylı liste)
- `react` ve `react-dom` `^18.3.1`, `@types/react` ve `@types/react-dom` `^18.3.0`, `vite` `^5.4.0` ve `@vitejs/plugin-react` `^4.3.0`, `@fontsource-variable/bricolage-grotesque` ve `@fontsource-variable/instrument-sans` `^5.3.0`, `@playwright/test` `^1.50.0`. `socket.io-client` zaten vardı. `jsdom`, `testing-library`, yönlendirici, durum kütüphanesi, CSS çerçevesi ve PWA eklentisi kullanılmadı: bileşen testleri `react-dom/server` ile, mantık testleri saf fonksiyonlarla yapılır.
- **Araç zinciri yükseltmesi (not):** `vitest` (2.x) ve `vite` (5.4) bilerek eski sürümde kalıyor (Vite 8, React 19 çıkmış durumda). Hepsi özellik işlerinden ayrı, tek bir "araç zinciri yükseltmesi" adımında birlikte güncellenecek; böylece iki Vite sürümü yan yana yaşamaz ve bir yükseltmenin kırdığı şey özellik değişikliğiyle karışmaz.
- **Yazı tipleri:** yalnızca `latin` ve `latin-ext` alt kümeleri yüklenir (`src/fonts.css`, Fontsource'un yayımladığı `unicode-range` değerleriyle; vietnamca alt küme yok). Türkçe harflerden ç, Ç, ö, Ö, ü, Ü ve ı Latin-1 / `latin` içindedir; ğ, Ğ, ş, Ş ve İ `latin-ext` içindedir. Test her iki yazı tipi ailesi için bu 12 harfin bir yüz tarafından karşılandığını ve ğ Ğ ş Ş İ'nin `latin-ext`'ten geldiğini denetler.

### Sunucu protokolü
- **`identity:hello` `protocolVersion` taşır** (`PROTOCOL_VERSION`, şimdi 1). Sunucu farklı, eksik ya da bozuk sürümü `incompatibleVersion` (ve `serverVersion`) ile reddeder; bağlantı kimliksiz kalır. İstemci "uygulama güncel değil, sayfayı yenile" ekranını gösterir ve yeniden denemeyi bırakır. Sunucu ve istemci tarafı testlerle kanıtlandı.
- **`legal` yüke eklendi:** `game:update` ve `game:snapshot` artık `{view, events, legal}` taşır (`legal` = o oyuncunun kendi `legalMovesFor` çıktısı). `game:legal` CLI için kalır.
- **`game:preview {action}`:** hamleyi o oyuncu için sunucuda dener, durumu değiştirmez ve oyunun rng'sini kullanmaz (sabit bir yedek rng). Çekirdeğin reddi aynen döner. Rastgelelik ya da başkasının gizli kartı içeren her şey için yalnızca `{restricted: true, cost}` döner: zar, gelişim kartı çekme, kart çalma, haydudu tek kurbanın bölgesine taşıma (otomatik çalma yapar), tekel, takas kabulü (Diplomat bonusu) ve kendini `random` ilan eden rol aksiyonları. Tam önizleme (`restricted: false`) yalnızca belirleyici ve herkese açık sonuçlar için: yerleşim, yol, şehir, banka takası, teklif ve geri çekme, tur sonu, atma, şövalye, yol inşası, bolluk yılı ve ele geçirme. İçerik: maliyet, kazanım, herkesin açık puanının önce ve sonra değeri ve isteyene göre sansürlenmiş olaylar. Her mesaj gibi hız sınırına tabidir. Testler: durum değişmez, rng sayacı değişmez, zar atışı / çekilecek kart / çalınacak kart hiçbir yanıtta yok, ele geçirme tam önizleme verir.
- **Tek süreç:** sunucu `packages/client/dist` klasörünü (ya da `CLIENT_DIR`) bağımlılıksız bir işleyiciyle sunar: yol gezinmesi engelli, uzantısız yollar `index.html`'e düşer, `assets/` değişmez önbellekli, diğerleri `no-cache`.
- **Yalnızca test için hedef puan:** `ADA_TEST_VP`, sadece `NODE_ENV === "test"` iken okunur; başka her değerde (boş, `production`, `development`, `Test`...) yok sayılır (testle kanıtlandı). Oyunları hızlı bitirmek içindir.
- Çekirdekte `GAME_EVENT_TYPES` ve `GAME_ERROR_TYPES`, protokolde `ERROR_KEYS` veri olarak tutulur; istemci çevirileri bu listelere karşı denetlenir. Olay listesi derleme zamanında `GameEvent` birleşimiyle eşleşmek zorundadır.

### Servis çalışanı yok
- Bu aşamada **servis çalışanı yazılmıyor**. Çevrimdışı çalışmanın oyun için değeri yok (otoriter sunucu olmadan oynanmaz), ve önbelleğe alınmış eski bir kabuk, yeni sunucuyla protokol uyumsuzluğu doğurur. Yalnızca `manifest`, simgeler ve `viewport-fit=cover` var; "uygulama güncel değil" ekranı sürüm uyumsuzluğunu zaten açıkça yakalar. İleride gerekirse, sürüm denetimiyle birlikte düşünülür.

### Ele geçirme maliyetleri
- Asker'in ele geçirme maliyetleri tek bir veri tablosunda duruyor: `packages/game-core/src/roles/defs.ts` içindeki `CAPTURE_COSTS` (yol, yerleşim, şehir; kod içine dağılmış başka bir kopya yok, `check` ve `apply` aynı tabloyu okur). Önizleme ve arayüz maliyeti bu tablodan, sunucudaki `game:preview` yanıtından alır; istemcide ikinci bir kopya yok. Değerler değiştirilmedi.

### İstemci: tasarım kararları
- **Durum:** tek `useReducer` (saf reducer, testli). İçinde yalnızca sunucunun bu oyuncuya yolladıkları var: kendi görünümü ve seçenekleri, sansürlü olaylar (günlük son 300 olay). Rakibin eli, gelişim kartları, gizli puanları ve deste hiç gelmediği için DOM'a, günlüğe ya da bellekteki duruma girmez; Playwright testi tarayıcının aldığı her oyun mesajında rakip `hand` ve `devCards` alanlarının `null` olduğunu ve sayfada yalnızca 5 kaynak çipi bulunduğunu denetler.
- **Oturum:** token tarayıcıda (`ada.token`); depolama engelliyse ya da doluysa bellekte devam eder (testli). Her bağlanışta `identity:hello`; yanıttaki oda için sunucu anlık görüntüyü kendiliğinden yollar, sayfa yenilenince oda ve oyun geri gelir (Playwright testi: el aynı kalır). `replaced` olunca (başka sekme) yeniden bağlanma durur ve "burada devam et" gösterilir; sürüm uyuşmazlığında yeniden denemeyi bırakıp "uygulama güncel değil" ekranı çıkar.
- **Bağlantı kopması:** durum satırı ("Bağlantı koptu. Yeniden bağlanılıyor…", deneme sayısı, "Şimdi dene"). Tarayıcı `offline` olayını verince istemci ölü bir soketi beklemeden bağlantıyı bırakır, `online` olunca yeniden bağlanır. **Sunucu** kopmayı daha çabuk fark etsin diye Socket.IO `pingInterval` ve `pingTimeout` 10 saniyeye indirildi (varsayılan 25 + 20); kopan oyuncu yaklaşık 20 saniye içinde diğerlerinde "çevrimdışı" görünür (Playwright testi).
- **Oyuncu şeridi:** her oyuncunun bağlı/çevrimdışı durumu yazıyla gösterilir (renk tek başına değil: kesikli çerçeve, boş nokta, "çevrimdışı" rozeti). Sırası çevrimdışı bir oyuncudaysa "X bağlantısı koptu, bekleniyor…" bandı çıkar (testli).
- **Tahta:** geometri `topologyOf(map)`'ten; `viewBox` köşe ve liman noktalarından hesaplanır (üç harita için testli). Bölgeler renk + harita sembolü deseni; jeton, olasılık noktaları, kırmızı 6 ve 8 (kırmızı + büyük yazı + beş nokta); haydut; limanlar oran ve kaynak simgesiyle. Parçalar oyuncu renginde, koyu çerçeveli, binaların içinde koltuk numarası (renk tek ipucu değil). Yakınlaştırma/kaydırma (iki parmak, tekerlek, düğmeler); dokunma, parmağın altındaki noktaya değil **30 px içindeki en yakın vurgulanan noktaya** gider, seçim önce vurgulanır sonra "Onayla" ile gönderilir (yanlış dokunuşa karşı). Her vurgulu nokta klavye ile erişilebilir bir düğmedir. Tarayıcının kendi odak halkası tahta ölçeğinde dev bir disk olarak çiziliyordu (ekran görüntüsünde fark edildi); kapatıldı, klavye odağı noktanın kendi beyaz halkasıyla gösterilir.
- **Beşinci oyuncu rengi** (`#2fd4c4`, turkuaz) deniz zemini ve altı arazi deseni üzerinde `04-colors-on-terrains` ekran görüntüsünde beş rengin yapı ve yollarıyla kontrol edildi: deniz zeminine karşı kontrast 8,6:1, koyu parça çerçevesine karşı 9,5:1; ham kontrast tarla ve çöl gibi açık araziler üzerinde düşük (1,06-1,09), ama her parça koyu çerçeveyle çizildiği için okunuyor ve en yakın ton olan otlak yeşiline (`#8fb45a`) karşı bile ayırt edilir. Değiştirilmedi. Testler: beş renk birbirinden ve arazilerden farklı, denize karşı > 4, çerçeveye karşı > 4,5.
- **Kontroller:** `controlsFor(view, legal, mode)` saf ve testli. Bir düğmenin açık olması yalnızca `legal` listesinden gelir; pasif düğme dokunulabilir kalır ve nedenini söyler (sıra sende değil, aşama, eksik kaynak listesi, uygun yer yok, deste bitti). Eksik kaynak hesabı yalnızca bir açıklamadır (eldeki ve maliyet), kural değildir. **Takas düğmesi ana fazda herkese açıktır** (rakibin açık teklifini kabul etmek için sayfa açılabilmeli); teklif vermek yalnızca sırası gelende açıktır.
- **Gelişim kartları:** "oyna" yalnızca `legal.devPlays` izin verirse açık; kapalıyken neden (bu tur alındı, turda bir kart sınırı, zafer puanı kartı oynanmaz, sıra sende değil) kartın altında yazar. Bolluk yılı ve tekel için kaynak seçimi, şövalye ve yol inşası için tahta akışı.
- **Asker ele geçirmesi:** yetenek varsa düğme görünür (rol verisindeki `capture` aksiyonundan, istemcide rol adı yok). Hedefler rakiplerin tüm parçaları; sunucunun yasal saydıkları vurgulu, diğerleri soluk ama dokunulabilir. Dokununca `game:preview` ile maliyet ve puan değişimi (ya da çekirdeğin reddi, nedeniyle) gösterilir; onay yalnızca önizleme başarılıysa açık.
- **Alt sayfalar** modal diyalog: odak içeri girer, Tab içeride kalır, Escape ve dışına dokunma kapatır, odak geri döner; atma ve kurban seçimi zorunlu (kapatılamaz).
- **Oyun sonu:** kazanan, tüm puanlar (gizli kartlar artık açık), host için "Lobiye dön". Sayfa kapatılabilir, "Puanlar" düğmesiyle yeniden açılır.
- **Düzen:** ≤ 899 px dikey (oyuncu şeridi, son olay ve zar, tahta, el + eylemler); ≥ 900 px sağda yan panel (şerit, el, eylemler, günlük). Dokunma hedefleri en az 44 px (testle denetlenen `--tap`), güvenli alan boşlukları `env(safe-area-inset-*)`, `prefers-reduced-motion`.

### İstemci: ekran görüntüleriyle bulunan ve düzeltilen sorunlar (`docs/screenshots/`, commit'te değil)
- Tahta kontrol düğmeleri (+, −, sığdır) sağ altta bir liman rozetini örtüyordu → sol alta, yatay sıraya taşındı.
- "Turu bitir" düğmesi içeriği kadar dardı → satırı doldurur.
- Takas teklifi formu 10 satırlık uzun bir listeydi → kaynak başına tek satırda "vereceğin | istediğin" ızgarası (yarı yükseklik).
- Günlükte sıra numaraları gürültüydü ve sonda boş bir numara vardı → düz satırlar.
- Kurulumda seçilen köşede tahta ölçeğinde dev bir odak halkası çiziliyordu → kapatıldı (yukarıda).
- Parçalar ve liman rozetleri 390 px genişlikte küçüktü → yerleşim, şehir ve rozetler büyütüldü.
- Türkçe harfler (ı, İ, ş, Ş, ğ, Ğ, ç, Ç, ö, Ö, ü, Ü) hem başlıkta hem gövdede kendi yazı tipleriyle çiziliyor: Chromium'un kullandığı yazı tipi listesi (`CSS.getPlatformFontsForNode`) yalnızca özel yazı tiplerini gösteriyor, yedek yazı tipi yok (Playwright testi).

### İstemci: test altyapısı
- **Vitest (82 test):** i18n tamlığı (olay, hata, hata gerekçesi, sunucu anahtarı, rol, kaynak, kart), yer tutucu eşitliği, her olay türünün iki dilde cümleye çevrilmesi, reducer, depolama hataları, yazı tipi kapsamı, tahta geometrisi ve çizimi (üç harita), kontroller (kurulum, zar, ana faz, atma, haydut, çalma, ele geçirme, gelişim kartları, takas), PWA dosyaları, sürüm uyuşmazlığı (gerçek sunucuya karşı gerçek `Connection`).
- **Playwright (`npm run e2e`):** iki sunucu: `play` (gerçek hedef puan) ve `finish` (`ADA_TEST_VP=3`, yalnızca `NODE_ENV=test`). Testler: oda kur/katıl/rol, kısa modda başlat, kurulum, zar, yol kurma, takas teklifi ve kabulü, sayfa yenileme, rakip eli, bağlantı kopması ve dönüşü, oyunun sonuna kadar (mobil ve masaüstü) ve lobiye dönüş, üç haritanın tamamen çizildiği, yazı tipleri, beş renk. Ekran gezisi 390x844 ve 1280x800'de tüm ekranları kaydeder.
- **Deterministik oyun için** `ADA_TEST_SEED` (yalnızca `NODE_ENV=test`). Arayüz botu kaynak yetmezse bankayla takas ederek ilerler (takas ekranının da gerçek kullanımı).
- **Bilinen sınır:** Asker'in ele geçirmesinin arayüz akışı (mod, hedef seçme, önizleme, onay) bileşen ve kontrol testleriyle denenir; Playwright'ta ele geçirme karşılanabilir olana kadar oynamak tohuma bağlı ve güvenilir değil (ele geçirme turların yalnızca ~%3'ünde karşılanabiliyor, bkz. Asker ölçümü). Sunucudaki `game:preview` ve çekirdekteki ele geçirme ayrıca uçtan uca denenmiş durumda.

## 2026-10-20: Aşama 4 (oyun hissi ve takas ekranı)

### Zar ve üretim
- **Çekirdekte tek değişiklik (karar):** `diceRolled` olayına `hitTiles` (sayısı tutan, haydutsuz, en az bir yapısı olan bölgeler) ve `robbedTile` (sayısı tutan ve haydudun durduğu bölge ya da `null`) eklendi; istemci "hangi bölge üretti" hesabını kendi yazmasın diye. İkisi de herkese açık tahta bilgisidir. Çekirdek testi, fuzz botu (her zarda herkese açık tahtadan yeniden hesaplanıp karşılaştırılır; yedide boş olmalı; üreten her oyuncunun bir `hitTiles` bölgesinde yapısı olmalı) ve sunucu sızıntı testi (olayda yalnızca bu iki ek alan var, ikisi de istemcinin kendi görünümünden türetilebilir) buna dokunur. Alan eklemek protokolü bozmadığı için `PROTOCOL_VERSION` değişmedi.
- **Varsayım:** bankada kaynak yetmediği için üretimin engellenmesi bölge vurgusunu değiştirmez (bölge yine vuruldu sayılır); neyin eksik kaldığı `productionBlocked` olayıyla günlükte yazılıdır.
- **Zar zaman çizelgesi:** 800 ms yuvarlanma, 500 ms ortada, 200 ms köşeye (toplam 1,5 s). Yuvarlanırken görünen yüzler sonuçtan bağımsız sabit bir dizidir (1, 4, 2, 6, 3, 5); toplam ve duyuru yuvarlanma bitene kadar sayfada hiç yoktur (testle sabit: iki farklı atış yuvarlanırken birebir aynı sayfayı verir). Ortadaki büyük zar `pointer-events: none`; tahtaya dokunmak ya da daha yeni herhangi bir güncelleme zarı hemen köşeye ve durağan duruma getirir, animasyon oyunu hiç bekletmez.
- **Yenileme, geç katılma, yeniden bağlanma:** yalnızca `game:update` içindeki `diceRolled` animasyon başlatır; `snapshot` başlatmaz. O durumda zarlar `view.dice` değerinden köşede durağan çizilir. `view.dice` her tur başında sıfırlandığından zarlar sonraki atışa değil, tur sonuna kadar görünür (varsayım).
- **Sonuç saklama yalnızca görseldir:** yuvarlanırken günlük ve son olay satırı o atışa ait girdileri göstermez, el ve rakip kart sayıları kazanılan kadar geride gösterilir. Düğmeler, yasal hamleler, kontroller ve alt sayfalar hep gerçek duruma göre çalışır; tek istisna, yedi sonrası kendiliğinden açılan kart atma ve çalma hedefi sayfalarının zar durana kadar (en çok 800 ms) beklemesidir (istenen davranış).
- **Üretim vurgusu** büyük zarlar ortadan çekildikten sonra başlar (aksi halde üreten bölgelerin üstünü örterlerdi; Playwright ekran görüntüsünde fark edildi) ve yaklaşık 1,1 s sürer. Tahtaya dokunarak zar atlanırsa vurgu o andan başlar. "+n" yalnızca kendi kazancındır (`produced` ve `roleBonus` olaylarından, `player === me`). Reduced-motion'da zar yuvarlanmaz, vurgu ve "+n" animasyonsuz kısa süre görünür. GDD'deki "eline kısa bir uçuş" bu aşamada yapılmadı, yerine "+n" var (GDD'ye dokunulmadı).
- **Köşe konumu:** tahta ekrana oturtulurken üstten 52 px boş bırakılır (`fitCamera` `topInset`); zar köşesi ve yakınlaştırma düğmeleri bu boş şeritte durur. İlk denemede (sabit köşe) classic19'da 390 ve 360 px genişlikte bir liman, bir yapı ve bir yolu örttüğü ölçüldü; düzeltmeden sonra üç haritada (classic19, large30, short14) ve üç ekranda (390x844, 360x640, 1280x800) jeton, liman, yapı, yol ve haydudu örtmediği Playwright ile denetlenir (`corner.spec.ts`). Yakınlaştırılmış tahtada zar yine üstte kalır; dokunmayı engellemez.
- **Kısa telefon (360x640):** alt panel tahtanın yerini çok yiyordu ve yakınlaştırma düğmeleri haritanın altını örtüyordu. Düğmeler üst şeride taşındı; `max-height: 700px` ekranlarda yapı düğmelerinin ikinci satırı (eksik kaynak) gizlenir (dokununca ipucu satırı söylüyor) ve boşluklar daraltıldı. 30 bölgeli harita bu ekranda hâlâ küçüktür (iki parmakla büyütülür); bilinen sınır.
- Ayrıca bulundu ve düzeltildi: günlüğün sonundaki kaydırma çapası numaralı boş bir satır gibi görünüyordu.

### Takas ekranı
- **Yeni yerleşim:** iki sekme (Bankayla, Oyuncuyla); kaynaklar arazi renginde ve desenli büyük parçacıklar (ad yazılı, renk tek ipucu değil); sekmeler başlığın altında sabit (küçük telefonda kayan içerikle birlikte kayıp tıklanamaz hâle geliyordu, ekran görüntüsüyle ve Playwright'ın tıklama hatasıyla bulundu), eylem çubuğu (özet cümle + büyük düğme) altta sabit, yalnızca ortası kayar. Alt sayfa `92dvh`. Pasif birincil düğme soluk değil ayrı bir renkte (pasif olduğu bir bakışta anlaşılsın).
- **Oranlar** `view.mine.bankRatios`'tan (liman ve rol dahil çekirdek hesabı), neyin yapılabildiği `legal.bankTrades`'ten gelir; istemcide kural yok. Pasiflik nedenleri ("N eksik", "Bankada yok", "Aynı kaynak", "Elinde yok", "Veriyorsun/İstiyorsun", "Sıra sende değil") yalnızca açıklamadır. `tradeView.ts` bunları saf fonksiyonlarla verir; çekirdekle tutarlılığı testlidir.
- **Teklif:** bir kaynak hem verilip hem istenemez (çekirdeğin `invalidTrade` kuralı; ekran karşı parçacığı pasif yapıp nedenini yazar). Kaynağa dokunmak bir artırır, parçacıktaki "−" bir azaltır (44 px dokunma alanı). "Yeni teklif eskisinin yerine geçer" bilgisi çubukta durur. Sıra sende değilken teklif kurma blokları gizlenir.
- **Gelen teklif** (teklifler herkese açıktır): teklif eden oyuncunun rengi ve baş harfi, "Verir → İster" çipleri; "Kabul et" altta sabit çubukta, elinde yetmiyorsa pasif ve eksik kaynak yazılı. Ana ekranda dock'un üstünde "X bir teklif verdi · Gör" bandı çıkar (sayfa kendiliğinden açılmaz, teklif kalkınca kaybolur). Sayfa, açık teklif varsa (gelen ya da kendi teklifin) Oyuncuyla sekmesinde açılır; kendi açık teklifin özet ve "İptal et" ile en üstte durur.
- Kullanılmayan eski stiller, `MiniStepper` ve eski çeviri anahtarları silindi.

### Asker'i elle denemek için (test seçenekleri)
- **`ADA_TEST_RESOURCES`** (yalnızca `NODE_ENV=test`, 1-19 tam sayı; yoksa ya da başka ortamda `null`; geçersiz değer hata verir): oyun başında her oyuncuya her kaynaktan o kadar kart, bankadan düşerek. Banka yetmezse kartlar turlar halinde dağıtılır ve ilk dağıtılan oyuncu kaynağa göre döner (`dealTestHands`, çekirdekte `state.ts`; çekirdek bayrağı bilmez, sunucu yalnızca bu yardımcıyı çağırır). Böylece son koltuk eksik kalmaz: 5 oyuncu, kısa mod (banka 19), 5'er kart istenince her oyuncu tam 19 kart alır (testle kanıtlı). Kaynak toplamı değişmezi korunur. Üretimde yok sayıldığı sunucu testiyle kanıtlandı (`ADA_TEST_VP` ve `ADA_TEST_SEED` gibi).
- **Playwright ele geçirme senaryosu** (`capture.spec.ts`, üçüncü sunucu, `ADA_TEST_RESOURCES=6`): ele geçirme modu, hedef seçme, önizleme (maliyet ve iki oyuncunun puan değişimi), onay ve iki ekranda aynı sonuç (yapının sahibi, puanlar, günlük, Asker'in eli), sonraki turda rakibin son yerleşiminin nedenle reddedilmesi. **Kapsam dışı kalan:** "korumalı" nedeni. Korumayı yalnızca ele geçirme koyar ve roller benzersiz olduğundan tek Asker'li oyunda ele geçirilmiş parçaya başka Asker dokunamaz; bu neden arayüzde yalnızca bileşen testiyle denenir (`controls.test.tsx`).
- Bu senaryo gerçek bir sorunu ortaya çıkardı: hedef seçilince tahtada dev bir odak halkası (siyah-beyaz disk) çiziliyordu; `.board-svg` içinde odak çizgisi `!important` ile kapatıldı, seçili nokta yine kendi beyaz halkasıyla gösterilir.

### Testler ve test dokunuşları (not)
- **Bilinçli test değişiklikleri:** `defaultTab` artık kendi açık teklifin olduğunda da Oyuncuyla sekmesini seçer (iptal etmek için); `controls.test.tsx` takas testi yeni çeviri anahtarlarına göre güncellendi; ekranda kaynak sayıları yuvarlanma süresince geride gösterildiğinden Playwright testleri elleri zar durduktan sonra okur.
- Birim: istemci 114 (zar bileşeni durağan/yuvarlanan/reduced-motion, durum makinesi ve kesintiler, `snapshot` ile yeniden yükleme animasyon başlatmaz, takas mantığı), çekirdek 155, sunucu 91. Playwright 36 senaryo (üç sunucu); ekran görüntüleri `docs/screenshots/` içinde, commit'te değil.
- **Yeni bağımlılık yok.**

## Aşama 5

### Adım 0: iki hata (22 Ekim 2026)

**(a) Takas teklifi diğer oyuncuda görünmedi: kök neden.**
- Yeniden üretim (`e2e/offer-visibility.spec.ts`, iki bağlam; alıcı masaüstü, 390x844 ve 360x640; `ADA_TEST_RESOURCES` açık ve kapalı iki sunucu; alıcının ekranı boşta, zar dönerken, zar bittikten sonra, Takas sayfası açıkken, Maliyetler sayfası açıkken): 30 hücreden **yalnızca "alıcının Takas sayfası Bankayla sekmesinde açık" başarısız oldu, 6 hücrenin 6'sında**. Zar animasyonu, sunucu türü ve ekran boyutu etkisizdi; zar katmanı `offers`'a hiç dokunmaz (yalnızca günlüğü, kart sayısını ve zarı geride tutar).
- Neden: teklif bandı, `sheet !== 'trade'` koşuluyla gizleniyordu ve Takas sayfası kendi sekmesini yalnızca açılırken seçiyordu (`initialTab`). Alıcı sayfayı Bankayla sekmesinde açık tutarken teklif gelirse ne bant ne kart çıkıyordu; geriye yalnızca sekme başlığındaki küçük nokta kalıyordu. Günlükteki satır ise olayın kendisinden geldiği için göründü. Yani sorun ağda ya da zamanlamada değil, **bildirimin görünürlüğünün o an açık olan yüzeye bağlı olmasındaydı**.
- Düzeltme (genel kural, `game/notices.ts`): bir bildirim (1) olaydan değil o anki görünümden türetilir; (2) oyun ekranını örtebilecek her yüzeyde gösterilir (oyun ekranı ve kapatılabilir her alt sayfa; `Sheet` bildirim çubuğunu `NoticeSlot` bağlamından alır, oyunun zorla açtığı kart atma ve çalma sayfaları bu işin dışındadır); (3) tek istisna, yüzeyin bildirimin içeriğini zaten gösterdiği durumdur (Takas sayfası Oyuncuyla sekmesinde). Sonraki bildirim türleri ("gelen yıkım", "sıra sende") `noticesFor` içine eklenir; ayrı görünürlük kodu yazılmaz. Takas sekmesi artık ekranın durumudur (`tab`/`onTab`), bildirime dokunmak sayfayı Oyuncuyla sekmesinde açar.
- Sekme başlığı: açık gelen teklif varken `(n) Ada`.
- Regresyon: yukarıdaki 30 hücre + "bildirime dokun, kartı gör, kabul et, iki tarafta takas" (31 senaryo geçiyor); birim testleri `notices.test.tsx`.

**(b) Çelişen durum metni.** Neden: `ActionDock` içindeki pasif düğme açıklaması (`blocked`) yalnızca bir inşa düğmesine basılınca temizleniyordu. Düzeltme: açıklama, sorulduğu anla (tur, faz, sıradaki oyuncu, mod) birlikte saklanır ve an değişince görünmez (`blockMoment`, `blockedNow`). Kanıt: `hintline.spec.ts` düzeltme geçici kapatılınca kırmızı ("Received: 1"), açıkken yeşil.
