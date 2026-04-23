const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const MAX_DESCRIPTION_LEN = 20000;
const CACHE_KEY = "detectedJobsByTab";

function normalizePayload(payload) {
  const description = (payload?.job_description || "").replace(/\s+/g, " ").trim();
  const normalized = {
    source_url: payload?.source_url || "",
    page_title: payload?.page_title || "",
    source_site: payload?.source_site || "",
    job_description: description.slice(0, MAX_DESCRIPTION_LEN),
    metadata: {
      truncated: description.length > MAX_DESCRIPTION_LEN,
      captured_at: new Date().toISOString()
    }
  };
  return normalized;
}

async function sendToBackend(payload) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const response = await fetch(`${apiBase}/api/v1/jobs/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail || "Backend request failed.");
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SUBMIT_JOB_DESCRIPTION") {
    const normalized = normalizePayload(message.payload);
    if (!normalized.job_description) {
      sendResponse({ ok: false, error: "No job description detected on this page." });
      return true;
    }
    sendToBackend(normalized)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "SAVE_API_BASE") {
    chrome.storage.sync.set({ apiBase: message.apiBase || DEFAULT_API_BASE })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "GET_API_BASE") {
    chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE })
      .then(({ apiBase }) => sendResponse({ ok: true, apiBase }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "CACHE_DETECTED_JOB_DESCRIPTION") {
    const tabId = _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab context." });
      return true;
    }
    const normalized = normalizePayload(message.payload);
    chrome.storage.local.get({ [CACHE_KEY]: {} })
      .then((store) => {
        const detectedJobsByTab = store[CACHE_KEY] || {};
        detectedJobsByTab[String(tabId)] = normalized;
        return chrome.storage.local.set({ [CACHE_KEY]: detectedJobsByTab });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "GET_CACHED_JOB_FOR_TAB") {
    const tabId = Number(message.tabId);
    chrome.storage.local.get({ [CACHE_KEY]: {} })
      .then((store) => {
        const detectedJobsByTab = store[CACHE_KEY] || {};
        sendResponse({
          ok: true,
          payload: detectedJobsByTab[String(tabId)] || null
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  return true;
});
