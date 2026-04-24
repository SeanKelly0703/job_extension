const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const MAX_DESCRIPTION_LEN = 20000;
const CACHE_KEY = "detectedJobsByTab";
const CHATGPT_TAB_PATTERNS = ["*://chatgpt.com/*", "*://*.chatgpt.com/*"];

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

async function fetchRecentJobs(limit = 5) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const response = await fetch(`${apiBase}/api/v1/jobs?limit=${limit}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail || "Failed to fetch recent jobs.");
  }
  return data;
}

async function findChatGptTabId() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_TAB_PATTERNS });
  console.log(tabs);
  if (!tabs.length) {
    throw new Error("No chatgpt.com tab found. Open ChatGPT and try again.");
  }
  const tab = tabs.find((item) => item.active) || tabs[0];
  if (!tab?.id) {
    throw new Error("Could not access ChatGPT tab.");
  }
  return tab.id;
}

function isMissingReceiverError(error) {
  const text = String(error?.message || error || "");
  return (
    text.includes("Receiving end does not exist") ||
    text.includes("Could not establish connection")
  );
}

async function pingContentScript(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT_SCRIPT" });
}

async function ensureContentScriptReady(tabId) {
  try {
    const pingResponse = await pingContentScript(tabId);
    if (pingResponse?.ok) {
      return;
    }
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw new Error(`ChatGPT tab is not reachable: ${error.message || String(error)}`);
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/contentScript.js"]
    });
  } catch (error) {
    throw new Error(`Could not inject content script in ChatGPT tab: ${error.message || String(error)}`);
  }

  try {
    const pingAfterInject = await pingContentScript(tabId);
    if (!pingAfterInject?.ok) {
      throw new Error("Ping did not return ok.");
    }
  } catch (error) {
    throw new Error(`ChatGPT tab did not respond after injection: ${error.message || String(error)}`);
  }
}

async function sendMessageWithScriptRecovery(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw new Error(`ChatGPT messaging failed: ${error.message || String(error)}`);
    }
  }

  await ensureContentScriptReady(tabId);

  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    throw new Error(`ChatGPT messaging failed after retry: ${error.message || String(error)}`);
  }
}

async function runChatGptExtraction(jobDescription) {

  const chatGptTabId = await findChatGptTabId();
  console.log(chatGptTabId);
  const response = await sendMessageWithScriptRecovery(chatGptTabId, {
    type: "RUN_CHATGPT_EXTRACTION",
    jobDescription
  });


  if (!response?.ok) {
    throw new Error(response?.error || "ChatGPT extraction failed.");
  }
  if (response.facts == null || typeof response.facts !== "object") {
    throw new Error(response?.error || "ChatGPT returned no facts payload.");
  }
  return response.facts;
}

async function cacheExtractedFacts(tabId, facts) {
  if (!tabId) {
    return;
  }

  const store = await chrome.storage.local.get({ [CACHE_KEY]: {} });
  const detectedJobsByTab = store[CACHE_KEY] || {};
  const existing = detectedJobsByTab[String(tabId)] || {};
  detectedJobsByTab[String(tabId)] = {
    ...existing,
    extracted_facts: {
      job_title: facts?.job_title || "",
      company: facts?.company || "",
      salary: facts?.salary || "",
      location: facts?.location || ""
    }
  };
  await chrome.storage.local.set({ [CACHE_KEY]: detectedJobsByTab });
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
        const existing = detectedJobsByTab[String(tabId)] || {};
        detectedJobsByTab[String(tabId)] = {
          ...normalized,
          extracted_facts: existing.extracted_facts || {}
        };
        return chrome.storage.local.set({ [CACHE_KEY]: detectedJobsByTab });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "EXTRACT_JOB_FACTS_WITH_CHATGPT") {
    console.log("Extracting job facts with ChatGPT");
    const tabId = Number(message.tabId);
    const jobDescription = (message.jobDescription || "").trim();
    if (!jobDescription) {
      sendResponse({ ok: false, error: "Job description is empty." });
      return true;
    }

    runChatGptExtraction(jobDescription)
      .then((facts) => cacheExtractedFacts(tabId, facts).then(() => facts))
      .then((facts) => sendResponse({ ok: true, facts }))
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

  if (message?.type === "GET_RECENT_JOBS") {
    const limit = Number(message.limit) || 5;
    fetchRecentJobs(Math.max(1, Math.min(limit, 20)))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  return true;
});
