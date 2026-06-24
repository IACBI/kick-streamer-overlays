/* ============================================================
   KICK YAYINCI OVERLAY PAKETİ — TEK AYAR DOSYASI
   KICK STREAMER OVERLAY PACK  — SINGLE SETTINGS FILE
   ------------------------------------------------------------
   TR: SADECE BU DOSYAYI düzenlemen yeterli. Kanal adını yaz,
       kaydet, bitti. Diğer .html dosyalarını açman/düzenlemen
       GEREKMEZ. Değişiklikten sonra OBS'de kaynağa sağ tık >
       "Refresh" (Yenile) demeyi unutma.
   EN: You only need to edit THIS file. Type your channel name,
       save, done. You do NOT need to open/edit the .html files.
       After changing it, right-click the source in OBS > "Refresh".
   ============================================================ */
window.KICK_OVERLAY_AYARLAR = {

  // TR: Kick kanal adın — yayın adresindeki ad.  Örnek: kick.com/xqc  ->  "xqc"
  // EN: Your Kick channel name — as it appears in your URL.  Example: kick.com/xqc -> "xqc"
  kanal: "",

  // TR: Görünüm stili / EN: Visual style:  "glass" | "vivid" | "soft" | "cinema"
  stil: "glass",

  // TR: Vurgu rengi (hex). Varsayılan: Kick yeşili.
  // EN: Accent color (hex). Default: Kick green.
  renk: "#53fc18",

  // TR: Chat'te SENİN (kanal sahibi) isminin yanında görünecek gökkuşağı yazı.
  //     Dilediğin kelimeyi yaz: "Yayıncı", "Streamer", "Host" vb.
  // EN: The rainbow label shown next to YOUR (channel owner) name in chat.
  //     Use any word you like: "Streamer", "Host", "Broadcaster", etc.
  yayinciYazisi: "Streamer",

  // TR: Takipçi hedefi (takipçi barında sağda görünen sayı).
  // EN: Follower goal (the number shown on the right of the follower bar).
  takipciHedefi: 1000,

  // TR: Kick'ten takipçi sayısı çekilemezse gösterilecek yedek değer.
  // EN: Fallback value shown if the follower count cannot be fetched from Kick.
  takipciYedek: 0,

  // TR: Abone hedefi. NOT: Abone sayacı CANLIDIR ve 0'dan başlar
  //     (Kick "toplam abone sayısı" vermediği için yayın boyunca sayar).
  // EN: Subscriber goal. NOTE: the subscriber counter is LIVE and starts at 0
  //     (Kick provides no "total subscriber count", so it counts during the stream).
  aboneHedefi: 100,

  // TR: Takipçi/izleyici bilgisi kaç saniyede bir yenilensin.
  // EN: How often (in seconds) to refresh follower/viewer info.
  yenilemeSn: 30

};
