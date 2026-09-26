import { initSaveManagerModal } from "./save-manager.js";
import { initModManager } from "./mod-manager.js";
import { initGameTools } from "./game-tools.js";
import { installUserViceCityCheats } from "./vc-cheats-user.js";

const ASSET_RELEASE_URL = import.meta.env.VITE_ASSET_URL || "https://gta-proxy.editingking-2977.workers.dev/";

const BASE = import.meta.env.BASE_URL;

const PWA_PROMO_DELAY_MS = 5500;
const PWA_PROMO_VISIBLE_MS = 5000;
let deferredPwaInstallPrompt = null;
let pwaInstallShowTimer = null;
let pwaInstallHideTimer = null;
let pwaInstallPromoShownThisSession = false;
let pwaInstallDelayElapsed = false;

function isStandalonePwa() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator.standalone === true
  );
}

function clearPwaInstallTimers() {
  if (pwaInstallShowTimer) {
    window.clearTimeout(pwaInstallShowTimer);
    pwaInstallShowTimer = null;
  }
  if (pwaInstallHideTimer) {
    window.clearTimeout(pwaInstallHideTimer);
    pwaInstallHideTimer = null;
  }
}

function hidePwaInstallPromo() {
  const promo = document.getElementById("pwa-install-promo");
  if (!promo) return;
  promo.classList.remove("is-visible");
  promo.setAttribute("aria-hidden", "true");
  if (pwaInstallHideTimer) {
    window.clearTimeout(pwaInstallHideTimer);
    pwaInstallHideTimer = null;
  }
}

function updatePwaInstallPromoAction() {
  const button = document.getElementById("pwa-install-button");
  if (!button) return;
  button.textContent = "INSTALL";
  button.disabled = false;
  button.dataset.installReady = deferredPwaInstallPrompt ? "1" : "0";
  button.setAttribute(
    "aria-label",
    deferredPwaInstallPrompt
      ? "Install GTA Browser"
      : "Install GTA Browser when browser installation is available"
  );
}

function showPwaInstallPromo() {
  if (
    !pwaInstallDelayElapsed ||
    isStandalonePwa() ||
    document.body.classList.contains("vc-game-shell-active") ||
    document.body.classList.contains("gameIsStarted")
  ) {
    return;
  }

  const promo = document.getElementById("pwa-install-promo");
  if (!promo) return;

  pwaInstallPromoShownThisSession = true;
  updatePwaInstallPromoAction();
  promo.classList.add("is-visible");
  promo.setAttribute("aria-hidden", "false");

  if (pwaInstallHideTimer) window.clearTimeout(pwaInstallHideTimer);
  pwaInstallHideTimer = window.setTimeout(() => {
    hidePwaInstallPromo();
  }, PWA_PROMO_VISIBLE_MS);
}

function schedulePwaInstallPromo() {
  if (pwaInstallPromoShownThisSession || isStandalonePwa() || pwaInstallShowTimer) {
    return;
  }

  pwaInstallShowTimer = window.setTimeout(() => {
    pwaInstallShowTimer = null;
    pwaInstallDelayElapsed = true;
    showPwaInstallPromo();
  }, PWA_PROMO_DELAY_MS);
}

function cancelPwaInstallPromo({ hide = false } = {}) {
  if (pwaInstallShowTimer) {
    window.clearTimeout(pwaInstallShowTimer);
    pwaInstallShowTimer = null;
  }
  if (hide) hidePwaInstallPromo();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPwaInstallPrompt = event;
  updatePwaInstallPromoAction();

  if (pwaInstallDelayElapsed && !pwaInstallPromoShownThisSession) {
    showPwaInstallPromo();
  }
});

window.addEventListener("appinstalled", () => {
  deferredPwaInstallPrompt = null;
  clearPwaInstallTimers();
  hidePwaInstallPromo();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", schedulePwaInstallPromo, { once: true });
} else {
  schedulePwaInstallPromo();
}


const LEGACY_SCRIPT_SOURCES = [
  `${BASE}GamepadEmulator.js`,
  `${BASE}jsdos-cloud-sdk.js`,
  `${BASE}idbfs.js`,
  `${BASE}game.js`,
];

function isLocalDevEnvironment() {
  return (
    window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

async function clearDevelopmentServiceWorkers() {
  if (!("serviceWorker" in navigator) || !isLocalDevEnvironment()) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error(`Failed to load script: ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load script: ${src}`)),
      { once: true },
    );
    document.body.appendChild(script);
  });
}

async function loadLegacyScripts() {
  for (const src of LEGACY_SCRIPT_SOURCES) {
    await loadScript(src);
  }
}

// Returns null if OK, or a string describing the failure reason.
async function checkReady() {
  try {
    const root = await navigator.storage.getDirectory();

    let markerFile;
    try {
      const fh = await root.getFileHandle("_game_ready");
      markerFile = await fh.getFile();
    } catch {
      return "OPFS marker '_game_ready' not found";
    }

    const version = await markerFile.text();
    if (version !== "v4") {
      return `OPFS marker version mismatch: got "${version}", expected "v4"`;
    }

    const requiredFiles = [
      ["vcbr", "vc-sky-en-v6.data", 100 * 1024 * 1024],
      ["vcbr", "vc-sky-en-v6.wasm", 0],
      ["vcsky", "sha256sums.txt", 0],
    ];

    for (const [directoryName, fileName, minSize] of requiredFiles) {
      let dir;
      try {
        dir = await root.getDirectoryHandle(directoryName);
      } catch {
        return `OPFS directory not found: ${directoryName}/`;
      }
      let fh;
      try {
        fh = await dir.getFileHandle(fileName);
      } catch {
        return `OPFS file not found: ${directoryName}/${fileName}`;
      }
      if (minSize > 0) {
        const f = await fh.getFile();
        if (f.size < minSize) {
          return `OPFS file too small: ${directoryName}/${fileName} is ${(f.size / 1024 / 1024).toFixed(1)} MB, need > ${minSize / 1024 / 1024} MB`;
        }
      }
    }

    return null;
  } catch (err) {
    return `checkReady error: ${err.message}`;
  }
}

// Returns null if OK, or a string describing the failure reason.
async function verifyGameServing() {
  const requiredUrls = [
    "/vcbr/vc-sky-en-v6.data",
    "/vcbr/vc-sky-en-v6.wasm",
    "/vcsky/sha256sums.txt",
  ];

  try {
    for (const url of requiredUrls) {
      let response;
      try {
        response = await fetch(url, { method: "HEAD", cache: "no-store" });
      } catch (err) {
        return `fetch failed for ${url}: ${err.message}`;
      }
      if (!response.ok) {
        return `SW served ${response.status} for ${url}`;
      }
    }

    return null;
  } catch (err) {
    return `verifyGameServing error: ${err.message}`;
  }
}

async function waitForGameReady(retries = 6, delayMs = 400) {
  let lastReason = "unknown";
  for (let attempt = 0; attempt < retries; attempt++) {
    const opfsReason = await checkReady();
    if (opfsReason !== null) {
      lastReason = opfsReason;
      console.warn(`[waitForGameReady] attempt ${attempt + 1}: ${opfsReason}`);
    } else {
      const servingReason = await verifyGameServing();
      if (servingReason !== null) {
        lastReason = servingReason;
        console.warn(`[waitForGameReady] attempt ${attempt + 1}: ${servingReason}`);
      } else {
        return { ready: true, reason: null };
      }
    }

    if (attempt < retries - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { ready: false, reason: lastReason };
}


async function warmOfflineShell() {
  if (!navigator.serviceWorker?.controller) return false;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 10000);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      resolve(event.data?.ready === true);
    };

    try {
      navigator.serviceWorker.controller.postMessage(
        { type: "WARM_OFFLINE_SHELL" },
        [channel.port2],
      );
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
}

async function resetGameData() {
  // Clear OPFS: delete all known directories and the marker file
  try {
    const root = await navigator.storage.getDirectory();
    for (const name of ["vcbr", "vcsky", "_game_ready", "_dl_tmp"]) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch {
        // entry may not exist
      }
    }
  } catch (err) {
    console.warn("[reset] OPFS clear failed:", err);
  }

  // Clear IndexedDB databases used by Emscripten IDBFS
  try {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = resolve;
            req.onerror = resolve;
            req.onblocked = resolve;
          }),
      ),
    );
  } catch (err) {
    console.warn("[reset] IndexedDB clear failed:", err);
  }
}

const VC_TIPS = [
  // Fun facts
  "Vice City is set in 1986 Miami — 109 licensed songs across 9 radio stations.",
  "Tommy Vercetti is voiced by Ray Liotta.",
  "The map has two main islands connected by three bridges.",
  "Vice City's map is nearly twice the size of GTA III's Liberty City.",
  "The game features over 35 hours of story missions.",
  "The Malibu Club mission 'The Job' is the longest in the entire game.",
  "Vice City sold over 17.5 million copies on PS2 alone.",
  "The radio DJ Lazlow appears in every GTA game since Vice City.",
  "You can find a secret Easter egg on the roof of the VCPD building.",
  "Ken Rosenberg is inspired by the movie Scarface's sidekick character.",
  // Gameplay tips
  "You can buy businesses like the Malibu Club, Boatyard and Print Works to earn passive income.",
  "The Infernus is one of the fastest cars — look for it in Vice Point.",
  "The Hunter military helicopter has missiles AND a minigun. Find it at Fort Baxter Air Base.",
  "Use the Rhino tank for almost anything — it's nearly indestructible.",
  "Tap the sprint button repeatedly instead of holding it to run faster.",
  "You can avoid a 2-star wanted level by simply driving far away from the crime scene.",
  "Saving your game removes your wanted level — use the Ocean View Hotel early on.",
  "Motorcycles are faster than cars in the city but much harder to control at high speed.",
  "Right-click (or L2) to lock on to enemies — then strafe sideways to avoid their fire.",
  "PCJ-600 motorcycle is great for time-critical missions — it spawns near the hotel.",
  "You can skip the Pay 'n' Spray if you drive far enough from police before they see your car.",
  "Swimming too long drains your health in Vice City — Tommy can't swim well.",
  "Holding a weapon while entering a car lets you shoot from vehicle windows.",
  // Cheats
  "Cheat: ASPIRINE restores your health to full at any time.",
  "Cheat: PRECIOUSPROTECTION gives you full armour instantly.",
  "Cheat: BIGBANG blows up every nearby vehicle — useful in a pinch.",
  "Cheat: FANNYMAGNET attracts pedestrians — great for chaos.",
  "Cheat: LEAVEMEALONE removes your wanted level immediately.",
  "Cheat: COMEFLYWITHME makes all vehicles able to fly.",
  "Cheat: SEAWAYS lets boats drive on land — a classic favourite.",
  "Cheat: PANZER spawns a Rhino tank right next to you.",
  "Cheat: ROCKANDROLLMAN spawns a Sanchez dirt bike.",
  // Loading info
  "Fast Start streams missing game assets and saves successful downloads in OPFS.",
  "Files already cached in your browser load locally on future visits.",
  "If streaming is unavailable, the full resumable installer remains available as a fallback.",
  "The game uses WebAssembly to run the original engine at near-native speed.",
  "Your save files stay in your browser — use the Save Manager to back them up.",
];

async function initSetupFlow() {
  const overlay = document.getElementById("setup-overlay");
  const fileInput = document.getElementById("game-file-input");
  const progress = document.getElementById("setup-progress");
  const progressBar = document.getElementById("setup-progress-bar");
  const progressLabel = document.getElementById("setup-progress-label");
  const progressPercent = document.getElementById("setup-progress-percent");
  const progressFile = document.getElementById("setup-progress-file");
  const progressTip = document.getElementById("setup-progress-tip");
  const progressTitle = document.getElementById("setup-progress-title");
  const errorBox = document.getElementById("setup-error");
  const storageStatus = document.getElementById("storage-status");
  const selectedFileName = document.getElementById("selected-file-name");
  const clickToPlayButton = document.getElementById("click-to-play-button");
  const resetBtn = document.getElementById("reset-game-btn");
  const pwaInstallPromo = document.getElementById("pwa-install-promo");
  const pwaInstallButton = document.getElementById("pwa-install-button");
  const pwaInstallClose = document.getElementById("pwa-install-close");

  if (
    !overlay ||
    !fileInput ||
    !progress ||
    !progressBar ||
    !progressLabel ||
    !progressPercent ||
    !errorBox ||
    !storageStatus ||
    !selectedFileName ||
    !clickToPlayButton
  ) {
    return;
  }

  if (pwaInstallClose) {
    pwaInstallClose.addEventListener("click", () => {
      clearPwaInstallTimers();
      hidePwaInstallPromo();
    });
  }

  if (pwaInstallButton) {
    pwaInstallButton.addEventListener("click", async () => {
      const message = document.getElementById("pwa-install-message");

      if (!deferredPwaInstallPrompt) {
        if (message) {
          message.textContent =
            "One-time game download required. Your browser has not exposed its install dialog yet; use its Install App or Add to Home Screen option if available.";
        }
        if (pwaInstallHideTimer) window.clearTimeout(pwaInstallHideTimer);
        pwaInstallHideTimer = window.setTimeout(hidePwaInstallPromo, 5000);
        return;
      }

      const promptEvent = deferredPwaInstallPrompt;
      deferredPwaInstallPrompt = null;

      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
      } catch (error) {
        console.warn("[pwa] install prompt failed:", error);
      }

      hidePwaInstallPromo();
    });
  }

  let setupErrorHideTimer = 0;
  const showError = (message, duration = 2400) => {
    errorBox.classList.remove("hidden");
    errorBox.textContent = message;

    if (setupErrorHideTimer) window.clearTimeout(setupErrorHideTimer);
    setupErrorHideTimer = window.setTimeout(() => {
      errorBox.classList.add("hidden");
      errorBox.textContent = "";
      setupErrorHideTimer = 0;
    }, Math.max(1500, Number(duration) || 2400));
  };

  const setStorageStatus = (message, state) => {
    storageStatus.textContent = message;
    storageStatus.dataset.state = state;
  };

  const setPlayAvailability = (enabled) => {
    window.__gtaGameReady = enabled;
    clickToPlayButton.disabled = !enabled;
    clickToPlayButton.classList.toggle("disabled", !enabled);
    if (resetBtn) resetBtn.classList.toggle("hidden", !enabled);
  };

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!confirm("This will delete locally cached game data and browser saves. Streaming assets will be cached again when you play. Continue?")) {
        return;
      }
      resetBtn.disabled = true;
      resetBtn.textContent = "Resetting…";
      await resetGameData();
      window.location.reload();
    });
  }

  const setupInstallButton = (isRetry = false) => {
    clickToPlayButton.disabled = false;
    clickToPlayButton.classList.remove("disabled");
    clickToPlayButton.textContent = isRetry ? "TRY AGAIN" : "PLAY GAME";
    clickToPlayButton.dataset.installMode = "1";
    clickToPlayButton.addEventListener("click", startInstall, { once: true });
  };

  const runImport = async (file, url) => {
    document.body.classList.add("vc-game-shell-active");
    errorBox.classList.add("hidden");
    progress.classList.remove("hidden");
    if (progressTitle) progressTitle.textContent = "LOADING...";
    progressLabel.textContent = "Preparing game files…";
    progressPercent.textContent = "0%";
    progressBar.style.width = "0%";
    if (progressFile) {
      progressFile.textContent = "";
      progressFile.hidden = true;
    }
    setPlayAvailability(false);

    // Rotate tips every 7 seconds while loading
    let tipIndex = Math.floor(Math.random() * VC_TIPS.length);
    let tipInterval = null;
    if (progressTip) {
      const showTip = () => {
        progressTip.style.opacity = "0";
        setTimeout(() => {
          progressTip.textContent = "💡 " + VC_TIPS[tipIndex % VC_TIPS.length];
          tipIndex++;
          progressTip.style.opacity = "1";
        }, 350);
      };
      showTip();
      tipInterval = setInterval(showTip, 7000);
    }

    let downloadStartTime = null;
    let lastPhase = null;
    let displayedProgressPct = 0;
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";

    const onInstallError = (message) => {
      cancelPwaInstallPromo({ hide: true });
      if (tipInterval) clearInterval(tipInterval);
      progress.classList.add("hidden");
      showError(message);
      setStorageStatus("Installation failed — try again", "missing");
      setupInstallButton(true);
    };

    await new Promise((resolve) => {
      const worker = new Worker(`${BASE}extract-worker.js`);
      worker.onerror = (error) => {
        console.error("[worker error]", error);
        onInstallError(`Worker crashed: ${error.message || "unknown error"}. Please try again.`);
        worker.terminate();
        resolve();
      };
      worker.postMessage(url ? { url } : { file });
      worker.onmessage = async (event) => {
        const msg = event.data;

        if (msg.type === "progress") {
          const incomingPct = Number.isFinite(Number(msg.pct)) ? Number(msg.pct) : 0;
          displayedProgressPct = Math.max(displayedProgressPct, Math.min(99, Math.max(0, incomingPct)));
          progressBar.style.width = `${displayedProgressPct}%`;
          progressPercent.textContent = `${Math.round(displayedProgressPct)}%`;

          if (progressTitle) progressTitle.textContent = "LOADING...";
          progressLabel.textContent = "Preparing game files…";
          if (progressFile) {
            progressFile.textContent = "";
            progressFile.hidden = true;
          }

          lastPhase = msg.phase;
          return;
        }

        if (msg.type === "done") {
          cancelPwaInstallPromo({ hide: true });
          if (tipInterval) clearInterval(tipInterval);
          progressBar.style.width = "100%";
          progressPercent.textContent = "100%";
          if (progressTitle) progressTitle.textContent = "LOADING...";
          progressLabel.textContent = "Preparing game files…";
          if (progressFile) {
            progressFile.textContent = "";
            progressFile.hidden = true;
          }
          if (progressTip) progressTip.textContent = "";
          const { ready: isReady, reason } = await waitForGameReady();
          if (isReady) {
            setStorageStatus(
              navigator.onLine ? "Ready to play — offline capable" : "Offline ready — playing from local storage",
              "ready",
            );
            setPlayAvailability(true);
            progress.classList.add("hidden");
            void warmOfflineShell();
          } else {
            onInstallError(`Verification failed: ${reason}. Please reset and try again.`);
          }
          worker.terminate();
          resolve();
          return;
        }

        if (msg.type === "error") {
          const raw = msg.message || "unknown error";
          let friendly = `Install failed: ${raw}`;
          if (raw.includes("QuotaExceeded") || raw.includes("quota")) {
            friendly = "Not enough browser storage space. Free up space or try a different browser, then retry.";
          } else if (raw.includes("NetworkError") || raw.includes("Failed to fetch") || raw.includes("Download failed")) {
            friendly = "Download failed — check your connection and click Retry.";
          }
          onInstallError(friendly);
          worker.terminate();
          resolve();
        }
      };
    });
  };

  setPlayAvailability(false);

  if (
    !("serviceWorker" in navigator) ||
    !("storage" in navigator && navigator.storage.getDirectory)
  ) {
    showError(
      "Your browser does not support the required APIs (OPFS / Service Worker). Please use Chrome, Firefox or Safari 15.2+.",
    );
    return;
  }

  try {
    if (isLocalDevEnvironment()) {
      console.log("[setup] local dev detected, refreshing SW registration");
      await clearDevelopmentServiceWorkers();
    }

    console.log("[setup] registering SW...");
    await navigator.serviceWorker.register(`${BASE}sw.js`, { updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    console.log("[setup] SW ready");

    if (!navigator.serviceWorker.controller) {
      console.log("[setup] SW not yet controlling page — reloading...");
      window.location.reload();
      return;
    }
  } catch (error) {
    showError(`Service Worker error: ${error.message}`);
    return;
  }

  const { ready, reason } = await waitForGameReady(2, 150);
  console.log("[setup] full game ready in OPFS:", ready, reason || "");

  if (ready) {
    window.__gtaStreamingMode = false;
    setStorageStatus(
      navigator.onLine ? "Ready to play — local cache" : "Offline ready — playing from local storage",
      "ready",
    );
    setPlayAvailability(true);
    progress.classList.add("hidden");
    void warmOfflineShell();
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => false);
    }
    return;
  }

  const forceFullInstall = new URLSearchParams(window.location.search).get("full_install") === "1";

  // Hybrid Progressive Streaming: the Service Worker serves local OPFS files
  // first, then streams missing /vcsky and /vcbr assets from the upstream CDN
  // and caches successful full responses back into OPFS.
  if (!forceFullInstall) {
    setStorageStatus("Checking Fast Start…", "checking");
    const streamingReason = await verifyGameServing();

    if (streamingReason === null) {
      window.__gtaStreamingMode = true;
      setStorageStatus("Fast Start ready — assets cache locally as you play", "ready");
      setPlayAvailability(true);
      progress.classList.add("hidden");
      errorBox.classList.add("hidden");
      if (navigator.storage?.persist) {
        navigator.storage.persist().catch(() => false);
      }
      return;
    }

    console.warn("[setup] Fast Start unavailable, using full-install fallback:", streamingReason);
  }

  // Keep the current resumable archive install as the compatibility fallback.
  window.__gtaStreamingMode = false;
  setStorageStatus("Fast Start unavailable — full install fallback (~701 MB)", "missing");

  const downloadUrl = ASSET_RELEASE_URL;

  const startInstall = async () => {
    if (clickToPlayButton.dataset.installMode !== "1") return;
    document.body.classList.add("vc-game-shell-active");
    clickToPlayButton.disabled = true;
    clickToPlayButton.dataset.installMode = "";
    cancelPwaInstallPromo({ hide: true });

    if (downloadUrl) {
      console.log("[setup] user triggered download from:", downloadUrl);
      await runImport(null, downloadUrl);
    } else {
      fileInput.click();
    }
  };

  // Keep the user-facing button labeled PLAY GAME; first-time setup starts behind it when needed
  setupInstallButton(false);

  // File picker fallback (used when no download URL is configured)
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) { selectedFileName.textContent = "No file selected"; return; }
    selectedFileName.textContent = file.name;
    if (!/\.tar\.gz$|\.gz$/i.test(file.name)) {
      showError("Please select the game.tar.gz file.");
      return;
    }
    await runImport(file);
  });
}

function initCanvasBindings() {
  const canvas = document.getElementById("canvas");
  if (!canvas) {
    return;
  }

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}

function checkBrowserCompatibility() {
  const missing = [];

  if (!("serviceWorker" in navigator)) missing.push("Service Workers");
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) missing.push("OPFS");
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  if (typeof Worker === "undefined") missing.push("Web Workers");

  return missing;
}

function initHostRedirectGuard() {
  try {
    // const host = window.parent.location.host;
    // console.log("The host:", host);
    // if ((!host.endsWith("dos.zone") || host.endsWith("cdn.dos.zone")) && !host.startsWith("localhost") &&
    //     !host.startsWith("192.168.0.") && !host.startsWith("test.js-dos.com")) {
    //     location.href = "https://dos.zone/grand-theft-auto-vice-city/";
    // }
  } catch {
    // ignore
  }
}

function hasTouchInput() {
  return (
    "ontouchstart" in window ||
    Number(navigator.maxTouchPoints || 0) > 0 ||
    window.matchMedia?.("(pointer: coarse)")?.matches === true
  );
}

async function lockMobileLandscape() {
  if (!hasTouchInput()) return false;
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
      return true;
    }
  } catch (_) {
    // Some browsers/OS versions do not permit orientation locking.
  }
  return false;
}

async function enterGameFullscreen(target = document.documentElement) {
  try {
    if (!document.fullscreenElement && target?.requestFullscreen) {
      await target.requestFullscreen();
    }
  } catch (_) {
    // Fullscreen can be denied by the browser; keep the page usable.
  }

  if (document.fullscreenElement) {
    await lockMobileLandscape();
  }

  return Boolean(document.fullscreenElement);
}

async function exitGameFullscreen() {
  try {
    if (screen.orientation?.unlock) screen.orientation.unlock();
  } catch (_) {}

  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (_) {}
  }
}

globalThis.__vcEnterFullscreen = enterGameFullscreen;
globalThis.__vcExitFullscreen = exitGameFullscreen;
globalThis.__vcLockLandscape = lockMobileLandscape;

function initOrientationLock() {
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement && document.body.classList.contains("gameIsStarted")) {
      void lockMobileLandscape();
    } else if (!document.fullscreenElement) {
      try {
        if (screen.orientation?.unlock) screen.orientation.unlock();
      } catch (_) {}
    }
  });

  const observer = new MutationObserver(() => {
    if (document.body.classList.contains("gameIsStarted") && document.fullscreenElement) {
      void lockMobileLandscape();
    }
  });
  observer.observe(document.body, { attributeFilter: ["class"] });
}

function initViceCityAboutSlideshow() {
  const gallery = document.getElementById("vc-about-gallery");
  if (!gallery) return;

  const slides = Array.from(gallery.querySelectorAll(".vc-about-slide"));
  const dots = Array.from(gallery.querySelectorAll("[data-vc-slide]"));
  const prev = gallery.querySelector(".vc-about-prev");
  const next = gallery.querySelector(".vc-about-next");
  if (slides.length < 2) return;

  let index = 0;
  let timer = 0;

  const show = (nextIndex) => {
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
    dots.forEach((dot, i) => {
      const active = i === index;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-selected", active ? "true" : "false");
    });
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const start = () => {
    stop();
    timer = window.setInterval(() => show(index + 1), 4200);
  };

  prev?.addEventListener("click", () => {
    show(index - 1);
    start();
  });
  next?.addEventListener("click", () => {
    show(index + 1);
    start();
  });
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      show(Number(dot.dataset.vcSlide || 0));
      start();
    });
  });

  gallery.addEventListener("mouseenter", stop);
  gallery.addEventListener("mouseleave", start);
  gallery.addEventListener("focusin", stop);
  gallery.addEventListener("focusout", start);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  show(0);
  start();
}

async function boot() {
  initCanvasBindings();
  initHostRedirectGuard();
  initOrientationLock();
  initViceCityAboutSlideshow();

  const missing = checkBrowserCompatibility();
  if (missing.length > 0) {
    const storageStatus = document.getElementById("storage-status");
    const errorBox = document.getElementById("setup-error");
    if (storageStatus) {
      storageStatus.textContent = "Browser not supported";
      storageStatus.dataset.state = "error";
    }
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = `Your browser is missing required features: ${missing.join(", ")}. Please use a current browser.`;
      window.setTimeout(() => {
        errorBox.classList.add("hidden");
        errorBox.textContent = "";
      }, 2600);
    }
    return;
  }

  initSaveManagerModal();
  initModManager();
  initGameTools();
  installUserViceCityCheats();
  await initSetupFlow();
  await loadLegacyScripts();

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void boot();
  });
} else {
  void boot();
}
