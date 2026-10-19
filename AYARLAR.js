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

  // Goal bars: pulse at 25 / 50 / 75 % and mark the bar when the goal is reached
  hedefKutlama: true,

  // Show the small error / status note on screen (e.g. "Kick unreachable"). Hide it for a clean stream
  hataNotu: true,

  // Refresh interval in seconds (10–600)
  yenilemeSn: 30,

  // Maximum chat messages on screen (3–20)
  sohbetMaksMesaj: 8,

  // Hide chat messages that start with "!" (bot commands)
  sohbetKomutGizle: false,

  // Usernames hidden from chat, separated by commas (not case-sensitive). Example: "nightbot, moobot"
  sohbetGizliKullanicilar: "",

  // Fade chat messages out after this many seconds. 0 = they stay until pushed out (0–600)
  sohbetSilinmeSn: 0,

  // Countdown (countdown.html): minutes to count down from when the page loads
  geriSayimDk: 5,

  // Countdown target as a clock time, 24h HH:MM (e.g. "20:30"). Overrides geriSayimDk.
  // If that time has already passed today, it counts down to tomorrow. Empty = use geriSayimDk
  geriSayimSaat: "",

  // Countdown title. Empty = "Starting soon" in your label language
  geriSayimBaslik: "",

  // Announcement bar (ticker.html): lines separated by |  (up to 12)
  // Example: "Follow for more | !discord | New video every Friday"
  duyuruMetinleri: "",

  // Seconds each announcement stays on screen (3–60)
  duyuruSn: 6,

  // Only needed if you changed the chat relay's port (see relay/). Default: "http://127.0.0.1:8790"
  // relayAdresi: "http://127.0.0.1:8790",

};
