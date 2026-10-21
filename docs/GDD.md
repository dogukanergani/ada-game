# Ada: Oyun Tasarım Dokümanı (GDD) v0.4

22 Ekim 2026

## Vizyon

Ada, 2-5 arkadaşın bir oda koduyla birlikte oynadığı, tur tabanlı bir ada kurma oyunudur. Kural çekirdeği bilinen ada kurma mekaniklerinden esinlenir; Ada'yı ayıran şey, her oyuncunun oyuna **bir rolle** başlamasıdır. Roller kuralları bozmaz, her oyuncuya kendi oyun tarzını verir.

**Dört tasarım sütunu**

1. **Hızlı katılım:** Link ve 4 harfli kod yeter, hesap ya da kurulum gerekmez.
2. **Roller:** Asimetrik yetenekler (çoğu pasif, Asker aktif); kimse aynı rolü iki kez seçemez.
3. **Adil oyun:** Zar, deste ve tüm doğrulama sunucudadır; rakibin eli asla ekrana gelmez.
4. **Her cihazda rahat:** Telefonda tek elle oynanabilir, masaüstünde yan panel açılır.

**Marka notu:** Oyunun adı Ada'dır ve bu ad kalıcıdır. Oyun kendi adını ve kendi görsellerini kullanır. Mekanikler fikir olarak serbesttir, ama "Catan" adı ve görselleri ticari markadır; bu GDD'deki hiçbir isim ya da görsel ondan alınmaz.

## Hedef kitle ve oyun anı

Oyun, birlikte oynamayı seven küçük arkadaş grupları içindir: herkes kendi cihazında, aynı anda, sesli ya da yüz yüze sohbet ederek oynar.

| Konu | Hedef |
| --- | --- |
| Oyuncu sayısı | 2-5 (test için 2 yeterli) |
| Oyun süresi | Standart oyun 60-90 dakika, kısa oyun daha kısa (hedefler testlerle doğrulanacak) |
| Cihaz | Telefon, tablet, bilgisayar; karışık olabilir |
| Katılım | Link + 4 harfli oda kodu; hesapsız (misafir) ya da hesaplı |
| Kesinti | Sayfa yenilense ya da bağlantı kopsa oyuncu yerine geri döner |
| Dil | Türkçe ve İngilizce |

## Platform ve teknik yön

Ada tek bir web kod tabanı olarak yazılır: tarayıcıda linkle açılır, aynı kod Capacitor ile iOS ve Android uygulamasına sarılır. Görsel yön 2D olduğu için oyun motoruna gerek yoktur.

| Seçenek | Linkle giriş | Uygulama | 2D tahta için | Karar |
| --- | --- | --- | --- | --- |
| Web + Capacitor | Doğal, anında | Aynı kodla | Yeterli, SVG ile çizilir | **Seçildi** |
| Unity (WebGL + mobil) | Mümkün ama daha ağır, geç açılır | Evet | Fazla güçlü, getirisi az | Elendi |
| Unity istemci + Node sunucu | WebGL'e bağlı | Evet | Fazla güçlü | Elendi |

**Mimari ilkeler**

- **Otoriter sunucu:** İstemci yalnızca aksiyon gönderir, sunucu doğrular ve uygular.
- **Saf kural çekirdeği:** Kurallar ağdan ve arayüzden bağımsız bir TypeScript paketidir: `(state, oyuncu, aksiyon, rng) → yeni state ya da hata`. State düz JSON kalır.
- **Gizli bilgi:** İstemciye yalnızca o oyuncunun görmesi gereken görünüm gider; rakiplerin eli ve deste sırası asla gitmez.
- **Roller hook ile:** Çekirdek rol adına bakmaz, rol yetenekleri belirli noktalarda çağrılan küçük fonksiyonlardır. Aktif yetenekler (ör. Asker rolü) için roller kendi aksiyonlarını da tanımlayabilir.
- **Rastgelelik tek yerden:** Zar ve deste yalnızca sunucuda, `rng` parametresiyle üretilir; bu testleri tekrarlanabilir yapar.

**Yığın:** TypeScript, Node + Socket.IO, React + Vite, SVG harita; uygulama için Capacitor. Geliştirme VS Code'da Claude Code ile yapılır, arayüz testi Playwright ile yapılır (iki ayrı mobil tarayıcı bağlamı).

**Mevcut prototip:** Ada v0 kural referansı olarak kalır; yeni kod bu GDD'ye göre baştan kuruldu (çekirdek, sunucu, istemci); ayrıntılı uygulama kararları depodaki docs/DECISIONS.md dosyasındadır.

**Çok dillilik:** Türkçe ve İngilizce ilk sürümden itibaren desteklenir. v0'da çekirdek Türkçe metin üretiyordu; yeni sürümde çekirdek metin değil, anahtar ve değerlerden oluşan yapılandırılmış olay üretir (ör. yol kuruldu: oyuncu, kenar), metne çevirmek istemcinin işidir. Kural açıklamaları, rol adları ve rol açıklamaları da çeviri dosyalarında tutulur.

## Temel oyun döngüsü

Bir tur zar atmakla başlar ve ana fazla biter. Oyuncunun asıl kararları ana fazda verilir: neyi inşa edeceği, kimle takas yapacağı, gelişim kartı alıp almayacağı.

**Tur akışı** (çizimin metin hali):

1. **Zar at.** Şövalye kartı zardan önce de oynanabilir.
2. **Yedi mi?**
   - Hayır: **Üretim** (eşleşen bölgeler kaynak verir), sonra Ana faz.
   - Evet: **Kart at, haydutu taşı, kart çal**, sonra Ana faz.
3. **Ana faz:** inşa ve takas, gelişim kartı.
4. **Hedef puana ulaştı mı?**
   - Evet: **Oyun biter.**
   - Hayır: sıra sonraki oyuncuya geçer, 1. adıma dönülür.

Yedi gelmezse eşleşen bölgeler kaynak verir; yedi gelirse kart atma, haydut ve kart çalma işlenir. İki yol da ana fazda birleşir. Puan kontrolü yalnızca sırası gelen oyuncu için yapılır; ulaşan kazanır, aksi halde sıra geçer. Şövalye zardan önce oynandıysa haydut işi bitince oyuncu zar fazına geri döner.

## Harita ve kaynaklar

Ada 19 altıgenden oluşur (yarıçap 2); toplam 54 köşe (yerleşim noktası) ve 72 kenar (yol noktası) vardır. Her oyunda bölgeler ve sayı jetonları rastgele dizilir.

| Arazi | Verdiği kaynak | Adet |
| --- | --- | --- |
| Orman | Odun | 4 |
| Otlak | Koyun | 4 |
| Tarla | Buğday | 4 |
| Tepe | Tuğla | 3 |
| Dağ | Cevher | 3 |
| Çöl | Yok (haydut burada başlar) | 1 |

- **Sayı jetonları:** Çöl dışındaki 18 bölgeye 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12 dağıtılır. 7 jeton değildir, 7 haydut zarıdır.
- **Adil dizilim:** 6 ve 8 jetonları yan yana gelemez.
- **Olasılık noktaları:** Jetonun altındaki noktalar sayının zarda gelme ihtimalini gösterir (6 ve 8 beş nokta, kırmızı).
- **Haydut:** Üstündeki bölge kaynak üretmez. Çölde başlar.
- **Okunabilirlik:** Her arazi hem renkle hem harita sembolü desenle ayırt edilir (orman üçgenleri, tuğla örgüsü, buğday çizgileri, dağ tepeleri, otlak noktaları).

**Oyuncu sayısına göre harita:** 2-4 oyuncuda 19 bölgelik harita kullanılır. 5 oyunculu standart oyunda 30 bölgeli büyük harita, kısa oyunda 14 bölgeli küçük harita kullanılır (aşağıdaki tablo). Mimari, haritayı ve banka stoğunu oyuncu sayısından türetecek şekilde kurulur.

**Haritalar**

| Harita | Ne zaman kullanılır | Bölge | Köşe / kenar | Arazi dağılımı | Jeton | Liman |
| --- | --- | --- | --- | --- | --- | --- |
| Klasik (classic19) | 2-4 oyuncu, standart oyun; ayrıca kısa oyunda 5 oyuncu | 19 | 54 / 72 | 4 odun, 4 koyun, 4 buğday, 3 tuğla, 3 cevher, 1 çöl | 18 | 9 (4 genel, 5 özel) |
| Büyük (large30) | 5 oyuncu, standart oyun | 30 (3-4-5-6-5-4-3 satırlar) | 80 / 109 | 6 odun, 6 koyun, 6 buğday, 5 tuğla, 5 cevher, 2 çöl | 28 (2 ve 12 ikişer, diğerleri üçer) | 11 (6 genel, 5 özel) |
| Kısa (short14) | 2-4 oyuncu, kısa oyun | 14 (2-3-4-3-2 elmas) | 42 / 55 | 3 odun, 3 koyun, 3 buğday, 2 tuğla, 2 cevher, 1 çöl | 13 | 7 (2 genel, 5 özel) |

**Banka stoğu ve hedef puan:** Her kaynaktan standart oyunda 19 kart (5 oyuncuda 24), kısa oyunda 14 kart (kısa oyunda 5 oyuncu klasik haritada oynadığı için 19) vardır. Gelişim destesi her yerde 25 karttır. Hedef puan standart oyunda 10, kısa oyunda 7'dir. Kısa oyunda 5 oyuncu 14 bölgeye sığmadığı için klasik haritada oynar.

**Harita çeşitleri:** İlk sürümde yalnızca klasik harita vardır (rastgele dizilimli); kısa oyunda aynı kurallarla daha küçük bir harita kullanılır. Özel haritalar sonraki sürümde eklenecek; bu yüzden harita çekirdekte veri olarak tanımlanır: bölge yerleşimi, arazi ve jeton dağılımı, liman konumları.

## Kurallar

**Kurulum.** Oyuncular yılan sırasıyla (1-2-3, sonra 3-2-1) birer yerleşim ve o yerleşime bağlı bir yol koyar. İkinci yerleşim, komşu bölgelerden birer kaynak verir. Koltuk sırası oyun başında rastgele belirlenir; kurulumdan sonra ilk turu ilk koltuktaki oyuncu oynar.

**Zar ve üretim.** Sırası gelen zar atar. Zarla eşleşen bölgenin köşesinde yerleşimi olan 1, şehri olan 2 kaynak alır. Haydutun bulunduğu bölge üretmez.

**Yedi gelirse.** Eli limitten fazla kart tutanlar yarısını atar (limit 7, bazı roller için farklı). Sıradaki oyuncu haydutu başka bir bölgeye taşır ve oraya komşu bir oyuncudan rastgele bir kart çalar. Atma herkesten aynı anda alınır ve atılan kartlar bankaya gider; haydut mutlaka başka bir bölgeye gider, kartı olmayan komşu çalma hedefi sayılmaz.

**Ana faz.** Sıradaki oyuncu istediği kadar inşa eder, takas yapar ve gelişim kartı alır, sonra turu bitirir.

**İnşa kuralları**

- Yerleşim, başka bir yerleşime en az iki kenar uzakta olmalı (mesafe kuralı) ve kendi yoluna bağlanmalı.
- Yol, kendi yapına ya da yoluna bağlanmalı; rakibin yapısının içinden geçilemez.
- Şehir, kendi yerleşiminin yükseltilmesidir.
- Parça limitleri: 15 yol, 5 yerleşim, 4 şehir.

**Takas.** Banka 4'e 1 verir (liman ve bazı roller oranı düşürür). Oyuncular arası takasta yalnızca sıradaki oyuncu teklif verir, diğerleri kabul eder; sırası gelmeyenler birbiriyle takas yapamaz. Aynı anda tek açık teklif bulunur; yeni teklif eskisinin yerine geçer, tur bitince açık teklif silinir.

| Parça | Maliyet | Puan |
| --- | --- | --- |
| Yol | 1 odun, 1 tuğla | Yok (en uzun yol için sayılır) |
| Yerleşim | 1 odun, 1 tuğla, 1 koyun, 1 buğday | 1 |
| Şehir | 2 buğday, 3 cevher | 2 (yerleşimin yerine geçer) |
| Gelişim kartı | 1 koyun, 1 buğday, 1 cevher | Karta bağlı |

Maliyetler rolden etkilenebilir; oyunda her oyuncu kendi rolüne göre hesaplanmış maliyetleri görür.

## Gelişim kartları

Oyunda 25 kartlık tek bir deste vardır; deste oyun başında sunucuda karıştırılır ve sırası hiçbir oyuncuya gösterilmez, yalnızca kalan kart sayısı görünür. Kart almak 1 koyun, 1 buğday ve 1 cevhere mal olur.

| Kart | Adet | Etki |
| --- | --- | --- |
| Şövalye | 14 | Haydutu taşır ve bir oyuncudan kart çalar; oynanan şövalyeler sayılır |
| Zafer puanı | 5 | 1 puan; oynanmaz, gizli kalır |
| Yol inşası | 2 | Bedava 2 yol koyar |
| Bolluk yılı | 2 | Bankadan istediğin 2 kaynağı alırsın (banka ikisini de karşılayabiliyorsa oynanır) |
| Tekel | 2 | Bir kaynak seç; diğer herkes o kaynaktaki tüm kartlarını sana verir |

**Oynama kısıtları**

- Aynı turda satın alınan kart o turda oynanamaz.
- Turda en fazla 1 gelişim kartı oynanır (zafer puanı kartları sayılmaz).
- Şövalye, zar atılmadan önce de oynanabilir; haydut işi bitince oyuncu bulunduğu faza döner.
- Yol inşasında yasal yer ya da yol hakkı kalmadıysa kalan hak otomatik biter, oyuncu kilitlenmez. Hiç yasal yol yeri yokken kart oynanamaz.

**En büyük ordu.** En az 3 şövalye oynayan ve rakiplerden fazla oynamış olan oyuncu 2 puan alır. Beraberlikte mevcut sahip kartı korur.

## Limanlar ve banka

Bankada standart oyunda her kaynaktan 19 kart vardır (5 oyuncuda 24; kısa oyunda 14, kısa oyunda 5 oyuncuda 19); stok sınırlıdır. Limanlar bankayla takas oranını düşürür.

**Limanlar.** Klasik haritada kıyıdaki 30 kenardan 9'una liman konur (büyük haritada 11, kısada 7; her zaman 5 özel, geri kalanı genel). Dört liman her kaynak için 3'e 1, beş liman tek bir kaynak için 2'ye 1 verir; liman türleri oyun başında rastgele dağıtılır. Oyuncu, limanın kenarının uçlarından birinde yerleşimi ya da şehri varsa o limanı kullanır. Bankayla takas oranı: önce oyuncunun limanlarından en iyisi (4, 3 ya da 2), sonra rol hook'u uygulanır; oran 2'nin altına inmez.

**Banka stoku.** Üretimde bir kaynağın stoğu, hak edilen toplamı karşılamıyorsa:

- Birden fazla oyuncu o kaynaktan alacaksa kimse almaz.
- Tek oyuncu alacaksa eldeki stok kadarını alır.
- Rol bonusları (ör. Çiftçi, Madenci) stoğu aşamaz.

İnşaat maliyetleri, atılan kartlar ve takaslar bankaya gider ya da bankadan gelir; her kaynak için banka ve oyuncu ellerinin toplamı daima 19'dur. Bankada olmayan kaynak, bankayla takasta istenemez.

(Not: "19" standart oyunun stoğudur. Kısa oyunda ve 5 oyunculu oyunda stok farklıdır; bkz. "Kazanma ve puanlama" ve "Harita ve kaynaklar". Fuzz testindeki değişmez, o modun toplam stoğuna göre kontrol edilir.)

## Roller

Her oyuncu lobide bir rol seçer, seçmeyene kalan rollerden biri rastgele verilir; aynı rolü iki oyuncu taşıyamaz. İlk sürümde 5 rol vardır; bu sayı en çok oyuncu sayısıyla aynıdır, yani 5 oyunculu oyunda her rol kullanılır. Roller çoğunlukla pasiftir: kuralları değiştirmez, belirli bir anda küçük bir avantaj verir. Asker ise aktif bir yetenek kullanır. Rol listesi kesin değildir ve sonradan değişebilir; v0'daki altı rol (Tüccar, Mimar, Çiftçi, Madenci, Haydut Avcısı, Kâşif) ilk sürüme alınmaz.

| Rol | Tür | Yetenek | Gereken hook | Dikkat edilecek denge |
| --- | --- | --- | --- | --- |
| Asker | Aktif | Belli kaynakları ödeyerek rakibin bir yolunu, yerleşimini ya da şehrini yıkar (şehir yerleşime düşer) | Yıkım aksiyonu (yeni) | Rakibi geriletir, kendine kazanç sağlamaz; oyuncuyu oyundan eleme riski, ayrıntılar aşağıda |
| Bilge | Pasif | Gelişim kartı 1 koyun ucuza gelir | devCardCost (yeni) | Şövalye ve en büyük ordu yolunu hızlandırır |
| Denizci | Pasif | Liman oranından sonra bankayla takas oranı 1 kart daha düşer; oran 2'nin altına inmez | bankRatio | 2'ye 1'in altına inmemeli |
| Diplomat | Pasif | Verdiği takas teklifi kabul edilince bankada stoğu olan kaynaklardan rastgele 1 kaynak alır (turda en fazla 1 kez; seçim yok) | onTradeAccepted (yeni) | Takasları teşvik eder; kötüye kullanıma karşı turda 1 sınırı |
| Hasatçı | Pasif | Kendi zar atışında zar hiçbir yapısına denk gelmezse ve elinde en çok 3 kart varsa, bankada stoğu olan kaynaklardan rastgele 1 kaynak alır | onProduce | Şanssız turları yumuşatır, üretimi fazla artırmamalı |

**Yedek roller.** 5. rol olarak Hasatçı seçildi; eksik kalan üretim tarafını o kapsıyor. v0'dan şu roller ileride havuza eklenebilir:

- **Kâşif (v0'dan):** Yerleşim kurunca komşu bölgelerden birinin kaynağından 1 tane alır. Genişlemeyi hızlandırır.
- **Çiftçi (v0'dan):** Zarla buğday aldığı her turda fazladan 1 buğday alır. Şehir ve gelişim kartı hızını artırır.

**Asker: yıkım (ilk öneri, denge testleriyle ayarlanır).** Asker ana fazda belirli kaynakları ödeyerek bir rakibin bir yapısını yıkar; yıkım Asker'e puan ya da kaynak kazandırmaz, yalnızca rakibi geriletir. Gerçek oyunda ele geçirme fazla güçlü bulunduğu için (22 Ekim) yıkıma çevrildi. Maliyetler tek bir veri tablosunda durur ve gerçek oyun testinden sonra ayarlanabilir. Rol sistemi bu yüzden rollerin kendi aksiyonlarını tanımlayabileceği şekilde tasarlanır.

| Hedef | Maliyet (öneri) | Etkisi |
| --- | --- | --- |
| Yol | 1 cevher, 1 koyun | Yol yıkılır ve sahibinin stoğuna döner; en uzun yol yeniden hesaplanır |
| Yerleşim (köy) | 2 cevher, 1 koyun, 1 buğday | Yerleşim yıkılır ve sahibinin stoğuna döner; sahibi 1 puan kaybeder |
| Şehir | 3 cevher, 2 koyun, 2 buğday | Şehir yerleşime düşer (şehir parçası sahibinin stoğuna döner); sahibi 1 puan kaybeder |

- Turda en fazla 1 yıkım yapılır; yıkım kazanç sağlamadığı için maliyetler eski ele geçirme maliyetlerine göre düşürüldü.
- Yıkılan parça sahibinin stoğuna geri döner, yeniden inşa edebilir. Yıkım yeri boşaltır; mesafe kuralına uyan herkes oraya kurabilir.
- Yıkıma uğrayan oyuncu bir tam tur boyunca (her oyuncu birer kez oynayana dek) yeniden yıkıma uğramaz.
- Yıkımdan sonra en uzun yol yeniden hesaplanır ve puan kontrolü yapılır (rakibin yolu kesilince Asker en uzun yolu alıp hedefe ulaşabilir).
- Rakip oyundan elenmesin diye hedef oyuncunun son yerleşimi ya da şehri yıkılamaz. Ödenen maliyet bankaya gider. Asker'in hem aşırı güçlenmemesi hem de işe yarar olması denge testlerinde izlenir.

**Denge ilkeleri**

1. Her rolün güçlü bir anı ve zayıf bir anı olmalı; hiçbiri her durumda en iyi olmamalı.
2. Roller tek bir hook'la tanımlanabilecek kadar basit kalır; karmaşık yetenekler önce bir rolde denenir.
3. Denge sayıyla ölçülür: botlar her rolle çok sayıda oyun oynar, rol başına kazanma oranı raporlanır (bkz. Denge ve test planı).
4. Yeni bir rol, mevcut hook'lara sığmıyorsa önce hook eklenir, çekirdeğe rol adı yazılmaz.

## Kazanma ve puanlama

Sırası gelen oyuncu hedef puana ulaştığı anda oyunu kazanır. Puan yalnızca kendi turunda kontrol edilir; rakibin turunda hedefe ulaşan oyuncu (ör. yolu kesilince en uzun yolu alan), kendi turu başlar başlamaz kazanır. Oyun modu oda kurulurken seçilir: Standart oyunda hedef 10 puan, Kısa oyunda 7 puandır; kısa oyunda ayrıca kaynak arzı ve haritadaki bölge sayısı azalır (banka stoğu 19 yerine 14, harita 19 yerine 14 bölge).

| Kaynak | Puan |
| --- | --- |
| Yerleşim | 1 |
| Şehir | 2 |
| En uzun yol (en az 5 yol, tek başına en uzun) | 2 |
| En büyük ordu (en az 3 şövalye, en çok oynayan) | 2 |
| Gizli zafer puanı kartı | 1 (her biri) |

- **Gizli puanlar:** Herkese açık puan, gizli kartları içermez; kazanma kontrolü sahibinin kendi turunda gizli puanları da sayar. Oyun bitince tüm kartlar açılır.
- **En uzun yol:** Rakibin yerleşimi yolu keserse uzunluk yeniden hesaplanır. Beraberlikte mevcut sahip korunur; sahip yoksa ve birden çok oyuncu aynı uzunluktaysa kimse almaz.
- **Oyun sonu:** Kazanan ve herkesin puanı gösterilir; oda sahibi aynı odada yeni oyun başlatabilir.

## Çok oyunculu ve oda sistemi

Her oyun bir odada geçer; oda, oda sahibinin kurduğu 4 harfli bir kodla bulunur. Sunucu tek otoritedir: istemciler yalnızca hamle ister, sunucu doğrular ve herkese kendi görünümünü yollar.

| Konu | Karar |
| --- | --- |
| Katılım | Kod + isim (misafir) ya da hesapla giriş. Oyun başladıktan sonra yeni oyuncu giremez; oyundan "ayrılan" oyuncu koduyla geri dönebilir |
| Kimlik | Sunucu imzalı bir kimlik anahtarı verir (istemci kendi kimliğini uyduramaz), tarayıcıda saklanır; aynı kimlikle girince oyuncu yerine döner, ikinci sekme ilkini düşürür; hesaplı oyuncuda kimlik hesaba bağlıdır |
| Lobi | Oyuncular rol seçer; oda sahibi oyun modunu (standart ya da kısa) seçip başlatır. Oda sahibi çıkarsa devir otomatik olur |
| Gizli bilgi | Rakibin eli ve deste içeriği asla istemciye gitmez, yalnızca kart sayısı gider |
| Hile önleme | Zar, deste ve tüm kural kontrolü sunucuda; gelen veri her seferinde doğrulanır; bağlantı başına hız sınırı vardır |
| Kopan oyuncu | Oyun duraklamaz, sırası gelince diğerleri bekler (ilk sürüm). Kopan oyuncu yaklaşık 20 saniyede çevrimdışı görünür; sırası ondaysa bir bant "bağlantısı koptu, bekleniyor" der |
| Oda ömrü | Herkes çıktıktan 3 saat sonra silinir; durum bellekte tutulur |

**Hesaplar:** Hesap isteğe bağlıdır. Hesapsız (misafir) oynayan oyuncu hiçbir kuraldan ya da rolden mahrum kalmaz. Hesaplı oyuncu için hedeflenenler: arkadaş listesi, istatistikler (oynanan oyun, kazanma oranı, rol başına sonuçlar), oyun geçmişi ve aynı hesapla farklı cihazdan devam. Sıralama (rank) sistemi daha sonraki bir aşamada eklenir. Giriş yöntemleri: e-posta ile kayıt, Google ile giriş ve Apple ile giriş. Hesap sistemi yayınlanmadan önce gizlilik politikası ve veri saklama kuralları hazırlanır; yalnızca gerekli veri (e-posta, görünen ad, arkadaş listesi, istatistik) tutulur.

**Online eşleştirme (sonraki sürüm):** Şimdilik oyuna yalnızca oda sahibinin kurduğu odayla girilir. İleride rastgele oyuncularla eşleşme, sıralama (rank) sistemiyle birlikte eklenecek; bunun için oda ve lobi katmanı eşleştirmeden bağımsız tutulur. Eşleştirme ve sıralama için ayrıca hesap sistemi, tur zamanlayıcı ve kopan oyuncu çözümü gerekir.

**Sürüm uyumu:** İstemci ve sunucu bir protokol sürümü paylaşır; uyumsuz sürüm reddedilir ve istemci "uygulama güncel değil, sayfayı yenile" ekranı gösterir. Servis çalışanı (çevrimdışı önbellek) bilerek yazılmadı: sunucu olmadan oyun oynanamaz ve bayat bir önbellek sürüm uyumsuzluğu üretirdi.

**Sonraki sürümler için hedefler**

- Tur zamanlayıcısı ve oda sahibinin kopan oyuncuyu atlatması.
- Oda durumunun kalıcı depolanması (sunucu yeniden başlasa oyun kaybolmaz).
- İstek hız sınırı ve kötüye kullanım korumaları.
- Oyunu izleyici olarak açma ve oyun içi sohbet ya da hazır emoji tepkileri.

## Arayüz ve görsel yön

Tahta bir **deniz haritası** gibi görünür: koyu deniz zemini, ince enlem-boylam ızgarası ve harita sembolü desenli bölgeler. Bu desenler ekranın akılda kalan tek öğesidir, arayüzün geri kalanı sade tutulur.

| Öğe | Karar |
| --- | --- |
| Palet | Deniz #0b2530, panel #10303f, sığlık #174759, metin #e8eef0, vurgu kehribar #ffb347 |
| Arazi renkleri | Orman #2e6b45, tepe #b4572f, otlak #8fb45a, tarla #d8b342, dağ #77808c, çöl #c9b88a |
| Oyuncu renkleri | Turuncu, mor, beyaz, pembe; 5. oyuncu için turkuaz (#2fd4c4). Renkle birlikte parçanın içinde koltuk numarası da görünür |
| Yazı tipi | Bricolage Grotesque (başlık, sayılar), Instrument Sans (gövde) |
| Tahta | SVG; yasal hamleler kehribar nokta (köşe) ve noktalı çizgi (kenar) ile gösterilir; telefonda parmağa en yakın yasal nokta seçilir, tahta yakınlaştırılıp kaydırılabilir ve hamle "Onayla" ile gönderilir |

**Ekranlar**

- **Giriş:** isim, oda kur, kodla katıl.
- **Lobi:** oda kodu, oyuncular, rol kartları.
- **Oyun:** ortada tahta, tahtanın etrafında oyuncu koltukları (avatar, zafer puanı, kart sayısı), üstte son olay, altta el ve eylemler; masaüstünde sağda yan panel ve günlük. Koltuklarda yalnızca toplam kart sayısı görünür, rakibin hangi kaynaklara sahip olduğu gizli kalır.
- **Alt sayfalar:** takas (yan yana: solda verirsin, sağda alırsın), maliyet tablosu, kart atma, kart çalma, günlük, oyun sonu.

**Etkileşim ilkeleri**

- Mobil öncelikli: dokunma hedefleri en az 44 px, tek elle ulaşılabilir eylem düğmeleri.
- Her arazi renkle ve desenle ayırt edilir; renk körlüğüne karşı yalnızca renge güvenilmez.
- Klavye odağı görünür, hareket azaltma ayarına uyulur.
- Hata mesajı ne olduğunu ve ne yapılacağını söyler, özür dilemez.
- Oyuncu rolüne göre hesaplanmış maliyetler her zaman erişilebilir. Pasif düğme dokunulabilir kalır ve neden pasif olduğunu söyler (ör. sıra sende değil, 2 cevher eksik).

## Ses, animasyon ve oyun hissi

Hedef, hareketin yalnızca olanı anlatması: oyuncunun yaptığı eyleme cevap veren kısa animasyonlar olur, kendiliğinden oynayan süs hareketi olmaz. Ses efektleri ve müzik oyunun parçasıdır; çekirdek ve istemci hazır olduktan sonra eklenir.

- **Zar:** tahtada iki zar olarak kısa (yaklaşık bir saniye) yuvarlanır; durana kadar toplam yazılmaz, sonra köşede durağan kalır. Sonucu animasyon değil sunucu belirler; sayfa yenilenince zarlar animasyonsuz gelir (Aşama 4).
- **Üretim:** Sayısı tutan bölgelerin jetonu kısa süre vurgulanır, haydutla engelli bölge işaretlenir; kendi elindeki kaynak çipinde kazanç "+1" olarak belirir. Kimin ne aldığı günlükte yazılır. Eline uçan kaynak animasyonu sonraya kaldı (Aşama 4).
- **İnşa:** Yapı yerine oturur, kısa bir vurgu halkası.
- **Sıra bildirimi:** Sıra sende olduğunda titreşim ve ses (uygulamada Capacitor ile, tarayıcıda sekme başlığı).
- **Ses:** Efektler kısık ve sade kalır, müzik arka planda çalar; ikisi ayrı ayrı kapatılır. Varsayılan olarak ikisi de açıktır.
- **Hareket azaltma:** Sistem ayarı açıksa tüm animasyonlar kapanır.

## Denge ve test planı

Her kural değişikliği, aşağıdaki katmanların hepsinden geçmeden bitmiş sayılmaz. Ada v0'da bu yaklaşım iş görmüştür: botlarla yapılan rastgele oyunlar, elle yazılan testlerin yakalamadığı bir tutarsızlığı (yapı limiti dolunca arayüzün yanlış düğme göstermesi) ortaya çıkardı.

| Katman | Ne sınar | Nasıl |
| --- | --- | --- |
| Birim testleri | Tek tek kurallar: maliyet, mesafe, üretim, haydut, roller, kartlar | Çekirdek pakette, sabit rastgelelikle |
| Rastgele oyun (fuzz) | Değişmezler: kaynak asla negatif değil, banka + eller = 19, deste + oynanan + eldeki = 25, limitler aşılmaz | Botlar yasal hamlelerle yüzlerce oyun oynar |
| Uçtan uca soket testi | Oda, lobi, yeniden bağlanma, gizli bilgi sızıntısı, bozuk istekler | Gerçek WebSocket bağlantısıyla |
| Tarayıcı testi | Dokunma akışları, mobil yerleşim, alt sayfalar | Tarayıcı otomasyonu ile iki oyunculu senaryolar |
| Denge simülasyonu | Rol başına kazanma oranı, ortalama oyun süresi | Botlar her rolü eşit sayıda oynatır |
| Gerçek oyun testi | Eğlence, süre, kafa karışıklığı | Arkadaşlarla oynanan gözlemli oyunlar |

**Bitti sayılma ölçütü:** testler, tip kontrolü ve derleme temiz; yeni kural için hem birim hem fuzz kapsamı eklenmiş; gizli bilgi testi geçiyor. Hedef puanı düşürme (ADA_TEST_VP) ve sabit tohum (ADA_TEST_SEED) gibi test kolaylıkları yalnızca NODE_ENV=test iken açılır; üretimde yok sayıldıkları testle kanıtlanır.

**Denge hedefi (başlangıç):** hiçbir rolün bot simülasyonunda kazanma oranı, eşit paydan 5 puandan fazla sapmamalı. Bu eşik ilk ölçümlerden sonra gözden geçirilir. Ölçüm gürültüsü hücre başına 100-200 oyunda yaklaşık ±4-5 puandır; bu aralıktaki farklar kanıt sayılmaz. 2 oyunculu oyun yalnızca test içindir ve hedef dışıdır (orada Hasatçı eşit paydanın yaklaşık 17-19 puan üstünde kalıyor).

## Yol haritası

Çalışma altı aşamaya bölünür ve üç aşamanın sonunda bir kapı vardır; kapı ölçütü sağlanmadan sonraki aşamaya geçilmez. Henüz tarih verilmemiştir, süreler ilk aşama bitince ölçülen hıza göre konur.

**Aşamalar ve kapılar** (çizimin metin hali):

1. **Çekirdek kurallar:** Kurallar, limanlar, banka, gelişim kartları ve roller; birim ve rastgele oyun testleri.
   - *Kapı:* testler, tip kontrolü ve derleme temiz; gizli bilgi testi geçiyor.
2. **Sunucu:** Odalar, lobi, yeniden bağlanma, gizli bilgi filtresi; uçtan uca soket testleri.
3. **İstemci:** Mobil öncelikli tahta ve ekranlar; tarayıcı otomasyonuyla iki oyunculu senaryolar.
   - *Kapı:* iki oyuncu telefonda baştan sona bir oyun bitirebiliyor.
4. **Kapalı test:** Arkadaşlarla gözlemli oyunlar, botla denge simülasyonu, kural ve rol ayarı.
   - *Kapı:* hiçbir rolün kazanma oranı eşit paydan 5 puandan fazla sapmıyor.
5. **Yayın:** Sunucuya yükleme, HTTPS adres, telefona PWA olarak ekleme.
6. **Mağaza uygulaması:** Capacitor ile iOS ve Android paketi; titreşim ve sıra bildirimi.

Kapılar aşamaları sıraya koyar: çekirdek testlerden geçmeden sunucuya, telefonda oyun bitmeden kapalı teste, roller dengelenmeden yayına geçilmez.

**Durum (22 Ekim 2026):** 1. aşama (çekirdek), 2. aşama (sunucu) ve 3. aşama (istemci) tamamlandı; birinci kapı geçti. İkinci kapı otomatik testlerle (iki mobil tarayıcı bağlamı, kısa oyun baştan sona) geçti; gerçek telefonda iki oyuncuyla kısa oyun denendi, sonuna kadar oynanmadı. Aşama 4 (zar görseli, üretim vurgusu, takas ekranı) tamamlandı; gerçek oyun geri bildirimiyle Aşama 5 (takas düzeni, oyuncu koltukları, Asker yıkımı) başlıyor. Kapalı test için 3 oyunculu ve sonuna kadar oynanan bir gerçek oyun, Asker denemesi ve Bilge ile Asker dengesi bekleniyor.

**Sonraki sürümler (haritada yok):** hesap sistemi (e-posta, Google, Apple; arkadaş listesi ve istatistikler), ses ve müzik, özel haritalar ve sıralamalı online eşleştirme. Çeviri altyapısı ise haritadaki ilk aşamadan itibaren kurulur.

## Riskler ve önlemler

| Risk | Etki | Önlem |
| --- | --- | --- |
| Marka ve telif (ada kurma türünün tanınmış oyunu) | Yayında sorun çıkması | Kendi ad, görsel ve metinler; kurallar fikir olarak kalır; herkese açık yayın öncesi hukuki kontrol |
| Rol dengesi | Bazı roller yenilmez ya da işe yaramaz olur | Bot simülasyonu, gerçek oyun testi, rollerin tek hook'la sınırlı tutulması |
| Kopan oyuncu oyunu kilitler | Arkadaşlar beklemekten sıkılır | Tur zamanlayıcı ve oda sahibinin atlatma yetkisi (sonraki sürüm) |
| Gizli bilgi sızıntısı | Hile, güven kaybı | Tek çıkış noktası olarak filtrelenmiş görünüm, sızıntı testi |
| Gelişim kartı fazları | Oyuncunun kilitlenmesi (ör. yol inşası, şövalyenin zardan önce oynanması) | Açık faz makinesi, her faz için test, fuzz botunda kart hamleleri |
| Bellekte tutulan odalar | Sunucu yeniden başlarsa oyunlar kaybolur | Kalıcı depolama (sonraki sürüm), önce kısa oyun süresi |
| Mağaza süreci | Uygulama yayını gecikir | Önce web ve PWA; Capacitor sonra. Apple geliştirici hesabı yıllık, Google hesabı tek seferlik ücretli |

## Kararlar ve açık sorular

Verilen kararların hepsi işlendi.

**Verilen kararlar**

| Konu | Karar |
| --- | --- |
| Oyun adı | Ada, kalıcı |
| Oyuncu sayısı | 2-5; 5 oyuncuda 30 bölgeli büyük harita |
| Harita | Klasik harita; özel haritalar sonraki sürümde |
| Oyun uzunluğu | Standart (10 puan) ve Kısa (7 puan; kaynak arzı ve bölge sayısı azalır; kısa harita 14 bölge) |
| Roller | İlk sürümde 5 yeni rol (Asker, Bilge, Denizci, Diplomat, Hasatçı); v0 rolleri alınmaz |
| Asker | Belli kaynakları ödeyerek rakibin yolunu, yerleşimini ya da şehrini yıkar (ele geçirme fazla güçlü bulunduğu için yıkıma çevrildi) |
| Bot oyuncular | Şimdilik yok |
| Hesap | Hesapsız (misafir) ve hesaplı oyun; e-posta ile kayıt, Google ve Apple ile giriş; hesaplı oyuncuya arkadaş listesi ve istatistikler, rank sonraki aşamada; hesap sistemi yayınlanmadan önce gizlilik politikası ve veri saklama kuralları hazırlanır, toplanan veri en aza indirilir |
| Ses | Efekt ve müzik; varsayılan açık |
| Dil | Türkçe ve İngilizce |
| Oyun kurma | Şimdilik oda sahibi sistemi; sonra sıralama (rank) sistemiyle birlikte online eşleştirme |

**Açık sorular**

Gerçek oyun testinden sonra karar verilecek maddeler: Bilge iki bot türünde de eşit paydanın üstünde (+4,7 ve +7,7 puan). Asker botlarda eşit paydanın altında ölçüldü (yaklaşık -5,6 puan) ve ele geçirme turların yalnızca yaklaşık %3'ünde karşılanabiliyordu; gerçek oyunda ele geçirme fazla güçlü bulunduğu için yıkıma çevrildi, maliyetler yeniden ölçülecek. 2 oyunculu oyunda Hasatçı eşit paydanın yaklaşık 17-19 puan üstünde (test dışı, kabul edildi). Asker'in yıkım akışı gerçek oyunda denenecek. Takas ekranı yan yana düzene çevrilecek ve oyuncu koltukları tahtanın etrafına alınacak (Aşama 5).
