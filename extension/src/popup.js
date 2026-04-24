const descriptionEl = document.getElementById("description");
const statusEl = document.getElementById("status");
const apiBaseEl = document.getElementById("apiBase");
const extractBtn = document.getElementById("extractBtn");
const extractFactsBtn = document.getElementById("extractFactsBtn");
const sendBtn = document.getElementById("sendBtn");
const saveApiBtn = document.getElementById("saveApi");
const themeToggleEl = document.getElementById("themeToggle");
const charCountEl = document.getElementById("charCount");
const recentJobsListEl = document.getElementById("recentJobsList");
const refreshRecentBtn = document.getElementById("refreshRecentBtn");
const factsPanelEl = document.getElementById("factsPanel");
const factJobTitleEl = document.getElementById("factJobTitle");
const factCompanyEl = document.getElementById("factCompany");
const factSalaryEl = document.getElementById("factSalary");
const factLocationEl = document.getElementById("factLocation");

let lastPayload = null;
let lastExtractedFacts = null;
const THEME_KEY = "popupThemePreference";

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function updateCharCount() {
  const count = (descriptionEl.value || "").trim().length;
  charCountEl.textContent = `${count} chars`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeFacts(facts) {
  if (Array.isArray(facts) && facts.length) {
    return normalizeFacts(facts[0]);
  }
  const raw = facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {};
  const byKey = {};
  for (const [key, value] of Object.entries(raw)) {
    const nk = String(key)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    byKey[nk] = value;
  }
  function first(...keys) {
    for (const k of keys) {
      const v = byKey[k];
      const s = normalizeText(v == null ? "" : String(v));
      if (s) {
        return s;
      }
    }
    return "";
  }
  return {
    job_title: first("job_title", "title", "position", "role", "jobtitle"),
    company: first("company", "employer", "company_name", "organization", "organisation"),
    salary: first("salary", "compensation", "pay", "pay_range", "wage"),
    location: first("location", "work_location", "office_location", "city", "site")
  };
}

function renderFacts(facts) {
  const normalized = normalizeFacts(facts || {});
  factsPanelEl.style.display = "block";
  factJobTitleEl.textContent = normalized.job_title || "Not found";
  factCompanyEl.textContent = normalized.company || "Not found";
  factSalaryEl.textContent = normalized.salary || "Not found";
  factLocationEl.textContent = normalized.location || "Not found";
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

async function extractFactsWithChatGpt() {
  console.log("extractFactsWithChatGpt");
  const tabId = await getActiveTabId();
  const jobDescription = normalizeText(descriptionEl.value);
  if (!jobDescription) {
    throw new Error("Extract job description first.");
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "EXTRACT_JOB_FACTS_WITH_CHATGPT",
        tabId,
        jobDescription
      },
      (response) => {
        const lastError = chrome.runtime.lastError?.message;
        if (lastError) {
          reject(new Error(lastError));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Failed to extract facts from ChatGPT."));
          return;
        }
        resolve(normalizeFacts(response.facts || {}));
      }
    );
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

async function fetchRecentJobs(limit = 5) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_RECENT_JOBS", limit }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to load recent jobs."));
        return;
      }
      resolve(response.result?.items || []);
    });
  });
}

function renderRecentJobs(items) {
  if (!items.length) {
    recentJobsListEl.classList.add("muted");
    recentJobsListEl.textContent = "No recent jobs yet.";
    return;
  }

  recentJobsListEl.classList.remove("muted");
  recentJobsListEl.innerHTML = "";
  items.forEach((item) => {
    const jobBtn = document.createElement("button");
    jobBtn.className = "btn recent-job-item";
    jobBtn.type = "button";
    jobBtn.innerHTML = `
      <span class="recent-job-title">${item.page_title || "Untitled job"}</span>
      <span class="recent-job-meta">${item.source_site || "unknown site"}</span>
    `;
    jobBtn.addEventListener("click", () => {
      const sourceUrl = item.source_url || "";
      if (sourceUrl) {
        chrome.tabs.create({ url: sourceUrl });
      }
    });
    recentJobsListEl.appendChild(jobBtn);
  });
}

async function loadRecentJobs() {
  const items = await fetchRecentJobs(5);
  renderRecentJobs(items);
}

extractBtn.addEventListener("click", async () => {
  try {
    setStatus("Extracting...", "info");
    await extractDescription();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

extractFactsBtn.addEventListener("click", async () => {
  console.log("Button clicked");
  try {
    setStatus("Running ChatGPT extraction...", "info");
    const facts = await extractFactsWithChatGpt();
    lastExtractedFacts = facts;
    renderFacts(facts);
    setStatus("ChatGPT extraction complete.", "success");
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
    await loadRecentJobs();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

refreshRecentBtn.addEventListener("click", async () => {
  try {
    await loadRecentJobs();
    setStatus("Recent jobs refreshed.", "success");
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
renderFacts(lastExtractedFacts);

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
    lastExtractedFacts = normalizeFacts(payload.extracted_facts || {});
    updateCharCount();
    renderFacts(lastExtractedFacts);
    setStatus("Auto-detected job post and prefilled description.", "success");
  })
  .catch((error) => setStatus(error.message, "error"));

loadRecentJobs().catch((error) => setStatus(error.message, "error"));
