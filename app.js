import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Your Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyB2QDt-ucVu8KMX-FoTeStRhKRVpjWQNA0",
  authDomain: "navorapad.firebaseapp.com",
  projectId: "navorapad",
  storageBucket: "navorapad.firebasestorage.app",
  messagingSenderId: "569249322482",
  appId: "1:569249322482:web:2cb0d416ff89487592476b",
  measurementId: "G-0LBDT3JTHX"
};

const app = initializeApp(firebaseConfig);
const dbCloud = getFirestore(app);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function getPadId(secretCode) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode("navorapad_id_" + secretCode));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(dataObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(dataObj)));
  return { salt: bufToBase64(salt), iv: bufToBase64(iv), cipher: bufToBase64(new Uint8Array(cipherBuffer)) };
}

async function decryptData(encryptedPack, password) {
  const salt = base64ToBuf(encryptedPack.salt);
  const iv = base64ToBuf(encryptedPack.iv);
  const cipher = base64ToBuf(encryptedPack.cipher);
  const key = await deriveKey(password, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return JSON.parse(decoder.decode(plainBuffer));
}

function bufToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Local IndexedDB Cache
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("NavorapadDB", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("pads", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function localGetPad(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction("pads", "readonly").objectStore("pads").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function localSavePad(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pads", "readwrite");
    tx.objectStore("pads").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function localDeletePad(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pads", "readwrite");
    tx.objectStore("pads").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Hybrid Cloud + Local Fetch
async function fetchPad(id) {
  try {
    const snap = await getDoc(doc(dbCloud, "pads", id));
    if (snap.exists()) {
      const cloudData = snap.data();
      await localSavePad(cloudData);
      return cloudData;
    }
  } catch (err) {
    console.warn("Cloud fetch unavailable, checking local cache:", err);
  }
  return await localGetPad(id);
}

async function savePadRecord(record) {
  await localSavePad(record);
  try {
    await setDoc(doc(dbCloud, "pads", record.id), record);
  } catch (err) {
    console.warn("Cloud save warning:", err);
  }
}

async function removePadRecord(id) {
  await localDeletePad(id);
  try {
    await deleteDoc(doc(dbCloud, "pads", id));
  } catch (err) {
    console.warn("Cloud delete warning:", err);
  }
}

// Sleek Non-Blocking Toast Helper
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

let currentState = {
  padId: null,
  primaryCode: "",
  secondCode: "",
  pendingEncryptedRecord: null,
  attachments: [],
  history: [],
  selfDestructAt: null
};

const entryScreen = document.getElementById("entry-screen");
const secondLockScreen = document.getElementById("second-lock-screen");
const workspaceScreen = document.getElementById("workspace-screen");
const secretCodeInput = document.getElementById("secret-code-input");
const openPadBtn = document.getElementById("open-pad-btn");
const entryStatus = document.getElementById("entry-status");
const padTextarea = document.getElementById("pad-textarea");
const lineNumbersEl = document.getElementById("line-numbers");
const charCounter = document.getElementById("char-counter");
const saveIndicator = document.getElementById("save-indicator");

// Universal Eye Icon Toggle for ALL Password Fields
document.querySelectorAll(".eye-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.getAttribute("data-target"));
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    btn.querySelector(".eye-open").classList.toggle("hidden", isPassword);
    btn.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
  });
});

function resetAllPasswordFields() {
  document.querySelectorAll(".password-wrapper input").forEach(inp => {
    inp.value = "";
    inp.type = "password";
  });
  document.querySelectorAll(".eye-open").forEach(el => el.classList.remove("hidden"));
  document.querySelectorAll(".eye-closed").forEach(el => el.classList.add("hidden"));
}

secretCodeInput.addEventListener("keydown", e => {
  if (e.key === "Enter") openPadBtn.click();
});

document.getElementById("second-code-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("unlock-second-btn").click();
});

openPadBtn.addEventListener("click", async () => {
  const code = secretCodeInput.value.trim();
  if (!code) {
    entryStatus.textContent = "Please enter a secret code first.";
    return;
  }

  entryStatus.textContent = "Connecting to vault & deriving keys...";
  const padId = await getPadId(code);
  const existing = await fetchPad(padId);

  currentState.padId = padId;
  currentState.primaryCode = code;
  currentState.secondCode = "";

  if (existing) {
    if (existing.selfDestructAt && Date.now() > existing.selfDestructAt) {
      await removePadRecord(padId);
      entryStatus.textContent = "💥 This pad expired and self-destructed. Opening a fresh pad...";
      setTimeout(() => loadWorkspace({ text: "", attachments: [], history: [], selfDestructAt: null }), 1200);
      return;
    }

    if (existing.hasSecondLock) {
      currentState.pendingEncryptedRecord = existing;
      resetAllPasswordFields();
      entryScreen.classList.add("hidden");
      secondLockScreen.classList.remove("hidden");
      entryStatus.textContent = "";
      return;
    }

    try {
      const decrypted = await decryptData(existing.payload, code);
      loadWorkspace(decrypted);
    } catch (err) {
      entryStatus.textContent = "Decryption error. Data may be corrupted.";
    }
  } else {
    loadWorkspace({ text: "", attachments: [], history: [], selfDestructAt: null });
  }
});

document.getElementById("unlock-second-btn").addEventListener("click", async () => {
  const secondCode = document.getElementById("second-code-input").value.trim();
  const errorEl = document.getElementById("second-lock-error");
  if (!secondCode) return;

  try {
    const outerDecrypted = await decryptData(currentState.pendingEncryptedRecord.payload, secondCode);
    const innerDecrypted = await decryptData(outerDecrypted, currentState.primaryCode);

    currentState.secondCode = secondCode;
    errorEl.textContent = "";
    loadWorkspace(innerDecrypted);
  } catch (err) {
    errorEl.textContent = "❌ Incorrect second code. Cannot decrypt.";
  }
});

document.getElementById("back-to-entry-btn").addEventListener("click", () => {
  resetAllPasswordFields();
  secondLockScreen.classList.add("hidden");
  entryScreen.classList.remove("hidden");
});

function updateSettingsBadges() {
  const destructBadge = document.getElementById("destruct-status");
  if (currentState.selfDestructAt) {
    destructBadge.textContent = "ON (" + new Date(currentState.selfDestructAt).toLocaleString() + ")";
    destructBadge.className = "pill-on";
  } else {
    destructBadge.textContent = "OFF";
    destructBadge.className = "pill-off";
  }

  const lockBadge = document.getElementById("second-lock-status");
  const removeBtn = document.getElementById("remove-second-code-btn");
  if (currentState.secondCode) {
    lockBadge.textContent = "ON";
    lockBadge.className = "pill-on";
    removeBtn.classList.remove("hidden");
  } else {
    lockBadge.textContent = "OFF";
    lockBadge.className = "pill-off";
    removeBtn.classList.add("hidden");
  }
}

function loadWorkspace(data) {
  entryStatus.textContent = "";
  resetAllPasswordFields();

  entryScreen.classList.add("hidden");
  secondLockScreen.classList.add("hidden");
  workspaceScreen.classList.remove("hidden");

  padTextarea.value = data.text || "";
  currentState.attachments = data.attachments || [];
  currentState.history = data.history || [];
  currentState.selfDestructAt = data.selfDestructAt || null;

  document.getElementById("self-destruct-input").value = currentState.selfDestructAt
    ? new Date(currentState.selfDestructAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";

  updateEditorStats();
  updateSettingsBadges();
  renderAllMedia();
  renderHistory();
  saveIndicator.textContent = "☁️ Cloud Synced";
}

// Reusable Encrypt & Save Function (Syncs to Cloud + Local)
async function persistPad(addHistorySnapshot = true) {
  saveIndicator.textContent = "Encrypting & Syncing...";

  const text = padTextarea.value;
  if (addHistorySnapshot) {
    const snapshot = {
      timestamp: new Date().toLocaleString(),
      text,
      attachments: [...currentState.attachments]
    };
    currentState.history.unshift(snapshot);
    if (currentState.history.length > 5) currentState.history.pop();
  }

  const plainPayload = {
    text,
    attachments: currentState.attachments,
    history: currentState.history,
    selfDestructAt: currentState.selfDestructAt
  };

  let finalPayload = await encryptData(plainPayload, currentState.primaryCode);
  let hasSecondLock = false;

  if (currentState.secondCode) {
    finalPayload = await encryptData(finalPayload, currentState.secondCode);
    hasSecondLock = true;
  }

  await savePadRecord({
    id: currentState.padId,
    payload: finalPayload,
    hasSecondLock,
    selfDestructAt: currentState.selfDestructAt,
    updatedAt: Date.now()
  });

  renderAllMedia();
  renderHistory();
  saveIndicator.textContent = "✅ Synced to Cloud";
}

document.getElementById("save-pad-btn").addEventListener("click", async () => {
  await persistPad(true);
  showToast("✅ Pad encrypted and synced to cloud!");
});

document.getElementById("close-pad-btn").addEventListener("click", () => {
  currentState = { padId: null, primaryCode: "", secondCode: "", pendingEncryptedRecord: null, attachments: [], history: [], selfDestructAt: null };
  padTextarea.value = "";
  resetAllPasswordFields();
  workspaceScreen.classList.add("hidden");
  entryScreen.classList.remove("hidden");
});

// Main Mode Tabs
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

    btn.classList.add("active");
    const target = btn.getAttribute("data-tab");
    document.getElementById(target).classList.remove("hidden");

    if (target === "read-tab") {
      document.getElementById("reading-text").textContent = padTextarea.value || "(Empty pad)";
      renderAllMedia();
    }
  });
});

// Right-Side Media Sub-Tabs
document.querySelectorAll(".subtab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const parentSidebar = btn.closest(".split-right");
    parentSidebar.querySelectorAll(".subtab-btn").forEach(b => b.classList.remove("active"));
    parentSidebar.querySelectorAll(".media-pane").forEach(p => p.classList.add("hidden"));

    btn.classList.add("active");
    const targetId = btn.getAttribute("data-target");
    document.getElementById(targetId).classList.remove("hidden");
  });
});

function switchRightSubtab(sidebarSelector, targetPaneId) {
  const sidebar = document.querySelector(sidebarSelector);
  if (!sidebar) return;
  sidebar.querySelectorAll(".subtab-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-target") === targetPaneId);
  });
  sidebar.querySelectorAll(".media-pane").forEach(p => {
    p.classList.toggle("hidden", p.id !== targetPaneId);
  });
}

function renderAllMedia() {
  const images = currentState.attachments
    .map((item, idx) => ({ ...item, originalIndex: idx }))
    .filter(item => item.type === "image");

  const audios = currentState.attachments
    .map((item, idx) => ({ ...item, originalIndex: idx }))
    .filter(item => item.type === "audio");

  document.getElementById("edit-img-count").textContent = images.length;
  document.getElementById("read-img-count").textContent = images.length;
  document.getElementById("edit-aud-count").textContent = audios.length;
  document.getElementById("read-aud-count").textContent = audios.length;

  renderImageList("edit-images-list", images, true);
  renderImageList("read-images-list", images, false);
  renderAudioList("edit-audio-list", audios, true);
  renderAudioList("read-audio-list", audios, false);
}

function renderImageList(containerId, images, allowDelete) {
  const container = document.getElementById(containerId);
  if (!images.length) {
    container.innerHTML = `<p class="empty-hint">No images ${allowDelete ? "attached" : "in this pad"} yet.</p>`;
    return;
  }
  container.innerHTML = "";
  images.forEach(item => {
    const card = document.createElement("div");
    card.className = "attachment-item";
    card.innerHTML = `
      ${allowDelete ? `<button class="remove-media-btn" onclick="removeAttachment(${item.originalIndex})">✕</button>` : ""}
      <img src="${item.dataUrl}" alt="${item.name}" onclick="openLightbox(${item.originalIndex})" />
      <p class="img-hint">Click image to enlarge</p>
    `;
    container.appendChild(card);
  });
}

function renderAudioList(containerId, audios, allowDelete) {
  const container = document.getElementById(containerId);
  if (!audios.length) {
    container.innerHTML = `<p class="empty-hint">No audio files ${allowDelete ? "attached" : "in this pad"} yet.</p>`;
    return;
  }
  container.innerHTML = "";
  audios.forEach(item => {
    const card = document.createElement("div");
    card.className = "attachment-item";
    card.innerHTML = `
      ${allowDelete ? `<button class="remove-media-btn" onclick="removeAttachment(${item.originalIndex})">✕</button>` : ""}
      <p class="audio-title">🎵 ${item.name}</p>
      <audio controls src="${item.dataUrl}"></audio>
    `;
    container.appendChild(card);
  });
}

// Lightbox Image Viewer
const lightbox = document.getElementById("image-lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");

window.openLightbox = function(index) {
  const item = currentState.attachments[index];
  if (!item || item.type !== "image") return;
  lightboxImg.src = item.dataUrl;
  lightboxCaption.textContent = item.name;
  lightbox.classList.remove("hidden");
};

document.getElementById("close-lightbox-btn").addEventListener("click", () => {
  lightbox.classList.add("hidden");
  lightboxImg.src = "";
});

lightbox.addEventListener("click", e => {
  if (e.target === lightbox) {
    lightbox.classList.add("hidden");
    lightboxImg.src = "";
  }
});

// Media Uploads & Recording
function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

document.getElementById("image-upload").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  currentState.attachments.push({ type: "image", name: file.name, dataUrl });
  renderAllMedia();
  switchRightSubtab("#edit-tab .split-right", "edit-images-pane");
  e.target.value = "";
});

document.getElementById("audio-upload").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  currentState.attachments.push({ type: "audio", name: file.name, dataUrl });
  renderAllMedia();
  switchRightSubtab("#edit-tab .split-right", "edit-audio-pane");
  e.target.value = "";
});

let mediaRecorder = null;
let audioChunks = [];
const recordBtn = document.getElementById("record-audio-btn");

recordBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const dataUrl = await fileToDataUrl(blob);
        currentState.attachments.push({
          type: "audio",
          name: `Voice Note (${new Date().toLocaleTimeString()})`,
          dataUrl
        });
        renderAllMedia();
        switchRightSubtab("#edit-tab .split-right", "edit-audio-pane");
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      recordBtn.textContent = "⏹️ Stop";
      recordBtn.classList.add("recording");
    } catch (err) {
      showToast("⚠️ Microphone permission denied or unavailable.");
    }
  } else {
    mediaRecorder.stop();
    recordBtn.textContent = "🎙️ Record";
    recordBtn.classList.remove("recording");
  }
});

window.removeAttachment = function(index) {
  currentState.attachments.splice(index, 1);
  renderAllMedia();
};

padTextarea.addEventListener("input", updateEditorStats);
padTextarea.addEventListener("scroll", () => {
  lineNumbersEl.scrollTop = padTextarea.scrollTop;
});

function updateEditorStats() {
  const text = padTextarea.value;
  charCounter.textContent = `${text.length.toLocaleString()} / 500,000`;
  const lines = text.split("\n").length;
  lineNumbersEl.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
}

document.getElementById("line-numbers-toggle").addEventListener("change", e => {
  lineNumbersEl.classList.toggle("hidden", !e.target.checked);
});

document.getElementById("self-destruct-input").addEventListener("change", async e => {
  currentState.selfDestructAt = e.target.value ? new Date(e.target.value).getTime() : null;
  updateSettingsBadges();
  await persistPad(false);
  showToast(currentState.selfDestructAt ? "⏳ Self-destruct timer activated & synced!" : "⏳ Self-destruct timer turned OFF & synced.");
});

document.getElementById("clear-destruct-btn").addEventListener("click", async () => {
  currentState.selfDestructAt = null;
  document.getElementById("self-destruct-input").value = "";
  updateSettingsBadges();
  await persistPad(false);
  showToast("⏳ Self-destruct timer turned OFF & synced.");
});

document.getElementById("set-second-code-btn").addEventListener("click", async () => {
  const newCode = document.getElementById("new-second-code").value.trim();
  if (!newCode) {
    showToast("⚠️ Enter a second password first.");
    return;
  }
  currentState.secondCode = newCode;
  resetAllPasswordFields();
  updateSettingsBadges();
  await persistPad(false);
  showToast("🛡️ Double Pad Lock applied & synced!");
});

document.getElementById("remove-second-code-btn").addEventListener("click", async () => {
  currentState.secondCode = "";
  resetAllPasswordFields();
  updateSettingsBadges();
  await persistPad(false);
  showToast("🔓 Second password removed & synced.");
});

function renderHistory() {
  const list = document.getElementById("history-list");
  if (!currentState.history.length) {
    list.textContent = "No saved revisions yet. Click 'Encrypt & Save Pad' in Editing to create your first snapshot.";
    return;
  }
  list.innerHTML = "";
  currentState.history.forEach((snap, idx) => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.innerHTML = `
      <span>Revision #${currentState.history.length - idx} — ${snap.timestamp}</span>
      <button class="tool-btn" onclick="restoreRevision(${idx})">Restore</button>
    `;
    list.appendChild(row);
  });
}

window.restoreRevision = function(idx) {
  const snap = currentState.history[idx];
  padTextarea.value = snap.text;
  currentState.attachments = [...snap.attachments];
  updateEditorStats();
  renderAllMedia();
  showToast("🕒 Revision restored! Switch to Editing to view.");
};