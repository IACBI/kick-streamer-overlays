/* ============================================================
   KICK OVERLAY PACK — AYARLAR / SETTINGS
   ------------------------------------------------------------
   Edit only the values in this file, save, then right-click the
   source in OBS and choose Refresh.
   Secrets (Kick app credentials) do NOT go here: use AYARLAR.local.js.
   ============================================================ */
window.KICK_OVERLAY_AYARLAR = {

  // Kick channel name, as in kick.com/NAME
  kanal: "",

  // Theme: glass | vivid | soft | cinema | neon | minimal | pastel | terminal |
  //        aurora | holo | ember | paper | retro
  stil: "glass",

  // Corner shape: pill | rounded | square
  sekil: "pill",

  // Font: inter | poppins | nunito | mono
  yaziTipi: "inter",

  // Labels: tr | en | both  (both = "Takipçi / Follower")
  dil: "both",

  // Motion: normal | low | off
  animasyon: "normal",

  // Accent color (hex). Used by every theme except pastel's fills.
  renk: "#53fc18",

  // Label shown next to YOUR name in chat
  yayinciYazisi: "Streamer",

  // Follower goal and fallback count (used when Kick can't be reached)
  takipciHedefi: 1000,
  takipciYedek: 0,

  // Subscriber goal
  aboneHedefi: 100,

  // Subscriber count used when no Kick app is set in AYARLAR.local.js.
  // With the app set, the live total from Kick is used instead.
  aboneSayisi: 0,

  // Show "+N this stream" next to the subscriber count
  oturumFarkiGoster: true,

  // Show the percentage of the goal
  yuzdeGoster: false,

  // Refresh interval in seconds (10–600)
  yenilemeSn: 30,

  // Maximum chat messages on screen (3–20)
  sohbetMaksMesaj: 8,

  // Countdown (countdown.html): minutes to count down from when the page loads
  geriSayimDk: 5,

  // Countdown title. Empty = "Starting soon" in your label language
  geriSayimBaslik: "",

  // Announcement bar (ticker.html): lines separated by |  (up to 12)
  // Example: "Follow for more | !discord | New video every Friday"
  duyuruMetinleri: "",

  // Seconds each announcement stays on screen (3–60)
  duyuruSn: 6

};
