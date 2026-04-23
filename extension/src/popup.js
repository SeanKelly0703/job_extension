const descriptionEl = document.getElementById("description");
const statusEl = document.getElementById("status");
const apiBaseEl = document.getElementById("apiBase");
const extractBtn = document.getElementById("extractBtn");
const sendBtn = document.getElementById("sendBtn");
const saveApiBtn = document.getElementById("saveApi");
const themeToggleEl = document.getElementById("themeToggle");
const charCountEl = document.getElementById("charCount");

let lastPayload = null;
const THEME_KEY = "popupThemePreference";

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function updateCharCount() {
  const count = (descriptionEl.value || "").trim().length;
  charCountEl.textContent = `${count} chars`;
}

function applyTheme(theme) {
  const isDark =
    theme === "dark" ||
    (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", isDark);
  themeToggleEl.textContent = isDark ? "Light" : "Dark";
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem(THEME_KEY) || "auto";
  applyTheme(savedTheme);
}

function toggleTheme() {
  const currentlyDark = document.body.classList.contains("dark");
  const nextTheme = currentlyDark ? "light" : "dark";
  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) {
    throw new Error("No active tab found.");
  }
  return tabs[0].id;
}

async function loadApiBase() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_API_BASE" }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Failed to read API URL."));
        return;
      }
      resolve(response.apiBase);
    });
  });
}

async function loadCachedExtraction() {
  const tabId = await getActiveTabId();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_CACHED_JOB_FOR_TAB", tabId }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Failed to load cached extraction."));
        return;
      }
      resolve(response.payload);
    });
  });
}

async function extractDescription() {
  const tabId = await getActiveTabId();
  const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_JOB_DESCRIPTION" });
  if (!response?.ok) {
    throw new Error("Could not extract job description from this page.");
  }
  lastPayload = response.payload;
  descriptionEl.value = lastPayload.job_description;
  updateCharCount();
  setStatus("Extraction successful.", "success");
}

async function submitDescription() {
  const payload = {
    ...(lastPayload || {}),
    job_description: descriptionEl.value
  };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "SUBMIT_JOB_DESCRIPTION", payload }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Submission failed."));
        return;
      }
      resolve(response.result);
    });
  });
}

async function saveApiBase() {
  const apiBase = apiBaseEl.value.trim();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "SAVE_API_BASE", apiBase }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to save API URL."));
        return;
      }
      resolve();
    });
  });
}

extractBtn.addEventListener("click", async () => {
  try {
    setStatus("Extracting...", "info");
    await extractDescription();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

sendBtn.addEventListener("click", async () => {
  try {
    setStatus("Sending...", "info");
    const result = await submitDescription();
    setStatus(`Submitted.\nJob ID: ${result.job_id}\nPipeline: ${result.pipeline_status.state}`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

saveApiBtn.addEventListener("click", async () => {
  try {
    await saveApiBase();
    setStatus("API URL saved.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

themeToggleEl.addEventListener("click", () => {
  toggleTheme();
});

descriptionEl.addEventListener("input", () => {
  updateCharCount();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((localStorage.getItem(THEME_KEY) || "auto") === "auto") {
    applyTheme("auto");
  }
});

loadThemePreference();
updateCharCount();

loadApiBase()
  .then((value) => {
    apiBaseEl.value = value;
  })
  .catch((error) => setStatus(error.message, "error"));

loadCachedExtraction()
  .then((payload) => {
    if (!payload?.job_description) {
      return;
    }
    lastPayload = payload;
    descriptionEl.value = payload.job_description;
    updateCharCount();
    setStatus("Auto-detected job post and prefilled description.", "success");
  })
  .catch((error) => setStatus(error.message, "error"));
