============================================================
BİLDİRİM SES VE GÖRSELLERİ (İSTEĞE BAĞLI)
ALERT SOUNDS AND ART (OPTIONAL)
============================================================

TR -----------------------------------------------------------
Bu klasör İSTEĞE BAĞLIDIR. alerts.html her bildirim türü için
kendi kısa sesini çalar ve çizili bir simge gösterir. Bu klasör
BOŞ olsa bile her şey çalışır.

İstersen kendi dosyalarını buraya şu adlarla koyabilirsin:

    follow   sub   gift   kicks

SES   -> follow.mp3, sub.ogg, ... (.mp3 .ogg .wav)
         Dosya varsa yerleşik ses yerine o çalar.
GÖRSEL -> follow.png, gift.webm, ... (.webm .png .gif .webp)
         Simgenin yerinde 96x96 alanda gösterilir.
         .webm video sessiz ve döngüde oynar; sesi ayrı dosyadan gelir.

Aynı türden birden çok dosya varsa sıradaki ilki kullanılır:
ses için mp3, ogg, wav; görsel için webm, png, gif, webp.
Dosya ekledikten sonra OBS'te kaynağı yenile.

OBS'te sesin yayına gitmesi için kaynağın ayarlarında
"Sesi OBS ile kontrol et" seçeneğini aç.

Güvenlik: overlay yalnızca bu klasördeki bu sabit adları açar,
internetten hiçbir ses ya da görsel indirmez.

EN -----------------------------------------------------------
This folder is OPTIONAL. alerts.html plays its own short sound
and shows a drawn icon for each alert kind. Everything works even
if this folder is EMPTY.

If you like, drop your own files here using these names:

    follow   sub   gift   kicks

SOUND -> follow.mp3, sub.ogg, ... (.mp3 .ogg .wav)
         If the file exists it plays instead of the built-in sound.
ART   -> follow.png, gift.webm, ... (.webm .png .gif .webp)
         Shown in a 96x96 box where the icon would be.
         A .webm video plays muted and looped; sound comes from the sound file.

With several files for one kind, the first in this order wins:
mp3, ogg, wav for sound; webm, png, gif, webp for art.
Refresh the source in OBS after adding a file.

For the sound to reach your stream, turn on "Control audio via OBS"
in the source's properties.

Security: the overlay only opens these fixed names in this folder
and never downloads a sound or image from the internet.
