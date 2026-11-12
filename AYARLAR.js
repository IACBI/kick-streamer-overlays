/* ============================================================
   KICK OVERLAY PACK — AYARLAR / SETTINGS
   ------------------------------------------------------------
   Edit only the values in this file, save, then right-click the
   source in OBS and choose Refresh.
   Secrets (Kick app credentials) do NOT go here: use AYARLAR.local.js.
   Every setting is described in docs/settings.md. The original Turkish names
   (kanal, stil, ...) still work, and win if a file gives both.
   ============================================================ */
window.KICK_OVERLAY_AYARLAR = {

  // Kick channel name, as in kick.com/NAME
  channel: "",

  // Theme: glass | vivid | soft | cinema | neon | minimal | pastel | terminal |
  //        aurora | holo | ember | paper | retro
  theme: "glass",

  // Corner shape: pill | rounded | square
  shape: "pill",

  // Font: inter | poppins | nunito | mono
  font: "inter",

  // Labels: tr | en | both | es | pt | de | ar  (both = "Takipçi / Follower"; ar is right to left)
  language: "both",

  // Motion: normal | low | off
  motion: "normal",

  // Accent color (hex). Used by every theme except pastel's fills.
  accent: "#53fc18",

  // Label shown next to YOUR name in chat
  streamerLabel: "Streamer",

  // Follower goal and fallback count (used when Kick can't be reached)
  followerGoal: 1000,
  followerFallback: 0,

  // Subscriber goal
  subscriberGoal: 100,

  // Subscriber count used when no Kick app is set in AYARLAR.local.js.
  // With the app set, the live total from Kick is used instead.
  subscriberCount: 0,

  // Show "+N this stream" next to the subscriber count
  showSessionGain: true,

  // Show the percentage of the goal
  showPercent: false,

  // Goal bars: pulse at 25 / 50 / 75 % and mark the bar when the goal is reached
  goalCelebration: true,

  // Show the small error / status note on screen (e.g. "Kick unreachable"). Hide it for a clean stream
  statusNote: true,

  // Info panel (info-panel.html): show the stream title on the panel's bottom edge
  infoShowTitle: false,

  // Refresh interval in seconds (10–600)
  refreshSeconds: 30,

  // Maximum chat messages on screen (3–20)
  chatMaxMessages: 8,

  // Hide chat messages that start with "!" (bot commands)
  chatHideCommands: false,

  // Usernames hidden from chat, separated by commas (not case-sensitive). Example: "nightbot, moobot"
  chatHiddenUsers: "",

  // Fade chat messages out after this many seconds. 0 = they stay until pushed out (0–600)
  chatFadeSeconds: 0,

  // Countdown (countdown.html): minutes to count down from when the page loads
  countdownMinutes: 5,

  // Countdown target as a clock time, 24h HH:MM (e.g. "20:30"). Overrides countdownMinutes.
  // If that time has already passed today, it counts down to tomorrow. Empty = use countdownMinutes
  countdownTime: "",

  // Countdown title. Empty = "Starting soon" in your label language
  countdownTitle: "",

  // Announcement bar (ticker.html): lines separated by |  (up to 12)
  // Example: "Follow for more | !discord | New video every Friday"
  announcements: "",

  // Seconds each announcement stays on screen (3–60)
  announcementSeconds: 6,

  // Alerts (alerts.html): seconds each alert stays on screen (3–30)
  alertSeconds: 6,

  // Which alerts to show: new followers, subscriptions, gifted subscriptions, Kicks
  alertFollows: true,
  alertSubs: true,
  alertGifts: true,
  alertKicks: true,
  // Channel point rewards (needs the "Read Channel points rewards" scope in your Kick app)
  alertRewards: true,

  // Play a short sound with each alert, and its volume (0–100).
  // A file in alerts/ (follow.mp3, sub.mp3, gift.mp3, kicks.mp3, reward.mp3) replaces the built-in sound; see alerts/OKU-README.txt.
  alertSound: true,
  alertVolume: 60,

  // Only needed if you changed the relay's port (see relay/). Default: "http://127.0.0.1:8790"
  // The relay's access key is read from AYARLAR.relay.js automatically; nothing to set here.
  // relayAddress: "http://127.0.0.1:8790",

};
