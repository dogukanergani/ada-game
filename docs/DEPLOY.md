# Ada: Fly.io'ya yayın

Bu belge, Ada'yı Fly.io'da yayınlamak için gereken adımları anlatır. `fly auth login` ve `fly deploy` komutlarını **siz** çalıştırırsınız; bu depodaki hiçbir script Fly hesabınıza dokunmaz.

İlgili dosyalar: kök dizindeki `Dockerfile`, `.dockerignore` ve `fly.toml`. Mimari arka plan: `docs/GDD.md`, "Platform ve teknik yön".

## Önce bilmeniz gereken: oda bilgisi bellekte

Sunucu, oda ve oyun durumunu yalnızca bellekte tutar (kalıcı veritabanı yok). Bu yüzden `fly.toml`'da **tek makine her zaman açık** tutulur (`auto_stop_machines = false`, `min_machines_running = 1`). Makine yeniden başlarsa (deploy, çökme, Fly'ın bakımı) açık oyunlar kaybolur — bu bilinen bir sınırlama, GDD'de de yazılı.

## 1. Fly CLI kurulumu ve giriş

```bash
# kurulum: https://fly.io/docs/flyctl/install/
fly auth login
```

## 2. Uygulamayı oluşturma

`fly.toml` zaten depoda var, `app = "ada-game"` bir yer tutucudur (muhtemelen alınmıştır — değiştirin).

```bash
fly launch --no-deploy --copy-config
```

- `--copy-config`: depodaki `fly.toml`'ı kullanır, üstüne yazmasını istemezsiniz.
- `--no-deploy`: önce secrets'ı ayarlayın (adım 3), sonra deploy edin (adım 5).
- Sorarsa: uygulama adını (`ada-game` yerine kendi adınızı) ve bölgeyi (`fra`, zaten `fly.toml`'da yazılı) onaylayın. PostgreSQL/Redis gibi ek kaynak **istemeyin**, gerekmiyor.

Eğer `fly launch` adı sizin için değiştirirse, `fly.toml`'daki `app = "..."` satırını ve `CORS_ORIGINS`'teki placeholder domaini de güncelleyin (adım 4).

## 3. Ortam değişkenleri: secrets vs. `fly.toml`

| Değişken | Nereye | Neden |
| --- | --- | --- |
| `SERVER_SECRET` | **`fly secrets set`** | Oyuncu kimliklerini imzalayan gizli anahtar. Asla dosyaya, asla `fly.toml`'a yazılmaz. |
| `PORT` | `fly.toml` → `[env]` (zaten yazılı: `3001`) | Gizli değil, `internal_port` ile eşleşmeli. |
| `CORS_ORIGINS` | `fly.toml` → `[env]` (placeholder yazılı) | Gizli değil, ama **gerçek domaininizle güncelleyin** (bkz. adım 4); asla `*` olmasın. |

`SERVER_SECRET` ayarlamadan deploy ederseniz sunucu her başlangıçta rastgele bir anahtar üretir ve her yeniden başlatmada (makine tek olduğu için nadir ama olur) tüm oyuncu kimlikleri geçersiz kalır — kimse odasına geri dönemez. Uzun, rastgele bir değer üretip ayarlayın:

```bash
# örnek: 48 baytlık rastgele bir değer
openssl rand -hex 48

fly secrets set SERVER_SECRET="<yukarıdaki değer>"
```

`fly secrets set`, uygulamayı otomatik olarak yeniden başlatır; bu normaldir, sorun değildir.

## 4. `fly.toml`'da domaini güncelleme

`fly launch` size `https://<uygulama-adınız>.fly.dev` adresini verir. `fly.toml` içinde:

```toml
CORS_ORIGINS = "https://ada-game.fly.dev"
```

satırını gerçek adresinizle (ve varsa özel domaininizle, virgülle ayırarak) değiştirin, örneğin:

```toml
CORS_ORIGINS = "https://ada.sizin-domaininiz.com,https://ada-game.fly.dev"
```

Bu bir secret değil, dosyada kalabilir; ama `*` asla kullanmayın (CORS kontrolü devre dışı kalır).

## 5. Deploy

```bash
fly deploy
```

İlk deploy birkaç dakika sürer (Docker imajı derlenir). `fly.toml`'daki health check (`/healthz`, 15 sn aralık) geçene kadar Fly eski makineyi ayakta tutar; yeni makine sağlıklı olunca trafiği devralır.

## 6. Deploy sonrası doğrulama

Sırayla:

1. **Health check:** `curl https://<uygulama-adınız>.fly.dev/healthz` → gövdede `ok`, durum kodu `200`.
2. **Ana sayfa:** Tarayıcıda `https://<uygulama-adınız>.fly.dev/` açın → giriş ekranı (isim, "Oda kur" / "Katıl") görünmeli, konsol hatası olmamalı.
3. **Gerçek oda:** "Oda kur" ile bir oda açın, farklı bir tarayıcıda (ya da gizli sekmede) 4 harfli kodla katılın; iki taraf da lobide birbirini görmeli.
4. **Yeniden bağlanma:** Oyunu başlatıp sayfayı yenileyin; aynı oyuncu olarak geri dönmelisiniz (bu, `SERVER_SECRET`'ın doğru ayarlandığının kanıtıdır — adım 3'ü atladıysanız ya da yanlış yaptıysanız burada görünür).
5. **Fly panosu:** `fly status` ile tek makinenin `started` durumunda ve `min_machines_running = 1` gereği hiç durmadığını kontrol edin.

```bash
fly status
fly logs
```

## Bilinen sınırlamalar

- Bu depo Docker'ın kurulu olmadığı bir ortamda hazırlandı: `Dockerfile` ve `fly.toml` elle, katman katman simüle edilerek (bkz. `docs/DECISIONS.md`, "Fly.io yayın hazırlığı") doğrulandı — sunucu gerçekten ayağa kalkıp `/healthz`, ana sayfa ve SPA yollarına doğru yanıt verdi. Ama gerçek `docker build` / `fly deploy` ilk kez burada, sizin tarafınızda denenecek. Bir sorun çıkarsa önce `fly logs` ile hata iletisine bakın.
- Rooms bellekte: yeniden başlatma, açık oyunları siler (yukarıda anlatıldı).
- Rate limit değerleri (oda açma, aksiyon gönderme) yük altında ölçülmedi.
