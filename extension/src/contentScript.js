(() => {
  const SITE_SELECTORS = {
    "linkedin.com": [
      ".jobs-description-content__text",
      ".description__text",
      ".jobs-box__html-content"
    ],
    "indeed.com": [
      "#jobDescriptionText",
      "[data-testid='jobsearch-jobDescriptionText']"
    ],
    "greenhouse.io": [
      "#content",
      ".content"
    ]
  };
  const JOB_PATH_HINTS = ["/jobs", "/job", "/careers", "/positions", "/opening"];
  const JOB_KEYWORDS = [
    "job description",
    "responsibilities",
    "qualifications",
    "requirements",
    "apply",
    "about the role"
  ];
  let hasAutoScraped = false;

  function getHostname() {
    return window.location.hostname.replace(/^www\./, "");
  }

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function extractBySelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.innerText) {
        return cleanText(node.innerText);
      }
    }
    return "";
  }

  function extractFallback() {
    const candidates = Array.from(document.querySelectorAll("main, article, section, div"))
      .map((node) => node.innerText || "")
      .map(cleanText)
      .filter((text) => text.length > 400)
      .sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  function extractJobDescription() {
    const hostname = getHostname();
    const entry = Object.keys(SITE_SELECTORS).find((site) => hostname.includes(site));
    const selectors = entry ? SITE_SELECTORS[entry] : [];
    const selected = extractBySelectors(selectors);
    const description = selected || extractFallback();
    return {
      source_url: window.location.href,
      page_title: document.title || "",
      job_description: description,
      source_site: hostname
    };
  }

  function isKnownJobSite(hostname) {
    return Object.keys(SITE_SELECTORS).some((site) => hostname.includes(site));
  }

  function hasJobSignals(hostname) {
    const path = window.location.pathname.toLowerCase();
    const title = (document.title || "").toLowerCase();
    const bodyText = (document.body?.innerText || "").toLowerCase();

    const pathLooksLikeJob = JOB_PATH_HINTS.some((hint) => path.includes(hint));
    const keywordCount = JOB_KEYWORDS.reduce((count, keyword) => {
      return count + (bodyText.includes(keyword) || title.includes(keyword) ? 1 : 0);
    }, 0);

    if (isKnownJobSite(hostname) && (pathLooksLikeJob || keywordCount >= 1)) {
      return true;
    }
    return pathLooksLikeJob && keywordCount >= 2;
  }

  function autoDetectAndScrape() {
    if (hasAutoScraped) {
      return;
    }
    const hostname = getHostname();
    if (!hasJobSignals(hostname)) {
      return;
    }
    const payload = extractJobDescription();
    if (!payload.job_description || payload.job_description.length < 250) {
      return;
    }

    hasAutoScraped = true;
    chrome.runtime.sendMessage({
      type: "CACHE_DETECTED_JOB_DESCRIPTION",
      payload
    });
  }

  function runAutoDetectionWithRetries() {
    const retryDelaysMs = [0, 1000, 2500, 5000];
    for (const delay of retryDelaysMs) {
      window.setTimeout(() => {
        autoDetectAndScrape();
      }, delay);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isChatGptPage() {
    return window.location.hostname.includes("chatgpt.com");
  }

  function getChatComposer() {
    const selectors = [
      "textarea#prompt-textarea",
      "textarea[data-testid='prompt-textarea']",
      "div#prompt-textarea[contenteditable='true']",
      "div[contenteditable='true'][data-testid='prompt-textarea']",
      "[data-testid='composer-textarea']",
      "[data-testid='composer'] textarea",
      "form textarea",
      "main textarea"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        return el;
      }
    }
    return document.querySelector("textarea[placeholder]");
  }

  function getAssistantMessages() {
    const primary = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (primary.length) {
      return Array.from(primary);
    }
    const fallback = document.querySelectorAll(
      '[data-role="assistant"], [data-message-author="assistant"], .agent-turn'
    );
    return Array.from(fallback);
  }

  function getAssistantText(node) {
    if (!node) {
      return "";
    }
    const chunkSelectors = [
      "[data-message-content-part]",
      ".whitespace-pre-wrap",
      "[data-message-content='true']",
      "[data-message-content=\"true\"]",
      "[data-message-content]",
      "pre code",
      ".markdown",
      ".prose",
      "[class*='markdown']",
      "[class*='prose']",
      "article"
    ];
    let best = "";
    for (const sel of chunkSelectors) {
      node.querySelectorAll(sel).forEach((el) => {
        const t = cleanText(el.innerText || el.textContent || "");
        if (t.length > best.length) {
          best = t;
        }
      });
    }
    const whole = cleanText(node.innerText || node.textContent || "");
    return best.length >= 40 ? best : whole.length ? whole : best;
  }

  function getCombinedNewAssistantText(messages, baselineCount) {
    return messages
      .slice(baselineCount)
      .map(getAssistantText)
      .filter((t) => t.length > 0)
      .join("\n\n");
  }

  function buildFactsExtractionPrompt(jobDescription) {
    return [
      "Extract job details from this job posting text.",
      "Return ONLY valid JSON (no markdown fences, no explanation).",
      'Keys must be exactly: "job_title", "company", "salary", "location" (snake_case).',
      'Schema: {"job_title":"","company":"","salary":"","location":""}',
      "Use empty string \"\" only when that item is truly absent from the posting.",
      "",
      "Job posting:",
      jobDescription
    ].join("\n");
  }

  function tryParseJsonObject(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function extractJsonFromText(rawText) {
    const trimmed = (rawText || "").trim();
    if (!trimmed) {
      throw new Error("ChatGPT returned an empty response.");
    }

    const direct = tryParseJsonObject(trimmed);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct;
    }

    const braceSlice = (() => {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end <= start) {
        return null;
      }
      return tryParseJsonObject(trimmed.slice(start, end + 1));
    })();
    if (braceSlice && typeof braceSlice === "object" && !Array.isArray(braceSlice)) {
      return braceSlice;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      const inner = fencedMatch[1].trim();
      const fromFence = tryParseJsonObject(inner) || (() => {
        const s = inner.indexOf("{");
        const e = inner.lastIndexOf("}");
        if (s === -1 || e <= s) {
          return null;
        }
        return tryParseJsonObject(inner.slice(s, e + 1));
      })();
      if (fromFence && typeof fromFence === "object" && !Array.isArray(fromFence)) {
        return fromFence;
      }
    }

    const objectMatches = trimmed.match(/\{[\s\S]*\}/g) || [];
    for (let i = objectMatches.length - 1; i >= 0; i -= 1) {
      const candidate = objectMatches[i];
      const parsed = tryParseJsonObject(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    }

    throw new Error("Unable to parse JSON from ChatGPT response.");
  }

  function normalizeFacts(rawFacts) {
    if (Array.isArray(rawFacts) && rawFacts.length) {
      return normalizeFacts(rawFacts[0]);
    }
    const raw =
      rawFacts && typeof rawFacts === "object" && !Array.isArray(rawFacts) ? rawFacts : {};
    const byKey = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = String(key)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      byKey[normalizedKey] = value;
    }
    function firstString(...candidates) {
      for (const c of candidates) {
        if (c == null) {
          continue;
        }
        const s = cleanText(String(c));
        if (s) {
          return s;
        }
      }
      return "";
    }
    return {
      job_title: firstString(
        byKey.job_title,
        byKey.title,
        byKey.position,
        byKey.role,
        byKey.jobtitle,
        raw.job_title
      ),
      company: firstString(
        byKey.company,
        byKey.employer,
        byKey.company_name,
        byKey.organization,
        byKey.organisation,
        raw.company
      ),
      salary: firstString(
        byKey.salary,
        byKey.compensation,
        byKey.pay,
        byKey.pay_range,
        byKey.wage,
        raw.salary
      ),
      location: firstString(
        byKey.location,
        byKey.work_location,
        byKey.office_location,
        byKey.city,
        byKey.site,
        raw.location
      )
    };
  }

  function validateJsonTaskResult(value) {
    return value && typeof value === "object";
  }

  function setComposerValue(composer, value) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const proto =
        composer instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) {
        desc.set.call(composer, value);
      } else {
        composer.value = value;
      }
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const editable = composer;
    editable.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    selection.removeAllRanges();
    selection.addRange(range);
    if (document.execCommand) {
      document.execCommand("insertText", false, value);
    }
    let written = cleanText(editable.innerText || editable.textContent || "");
    if (!written || written.length < Math.min(value.length * 0.25, 80)) {
      editable.textContent = value;
      written = cleanText(editable.innerText || editable.textContent || "");
    }
    editable.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: value
      })
    );
  }

  function getSendButton() {
    return (
      document.querySelector("button[data-testid='send-button']") ||
      document.querySelector("button[data-testid='composer-send-button']") ||
      document.querySelector("button[aria-label='Send prompt']") ||
      document.querySelector("button[aria-label='Send message']") ||
      document.querySelector("button[aria-label='Submit']") ||
      document.querySelector("button[aria-label='submit']")
    );
  }

  function clickSendButton() {
    const sendBtn = getSendButton();
    if (sendBtn?.disabled || sendBtn?.getAttribute("aria-disabled") === "true") {
      return false;
    }
    if (sendBtn) {
      sendBtn.click();
      return true;
    }
    return false;
  }

  async function waitAndClickSendButton(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (clickSendButton()) {
        return true;
      }
      await sleep(120);
    }
    return false;
  }

  async function runChatGptJsonTask(prompt, options = {}) {
    if (!isChatGptPage()) {
      throw new Error("ChatGPT automation must run on chatgpt.com.");
    }

    const composer = getChatComposer();
    if (!composer) {
      throw new Error("Could not find ChatGPT input box. Confirm you're logged in.");
    }

    const normalizedPrompt = cleanText(prompt || "");
    if (!normalizedPrompt) {
      throw new Error("Prompt is empty.");
    }
    const baselineAssistantCount = getAssistantMessages().length;
    setComposerValue(composer, normalizedPrompt);
    await sleep(250);
    const filledLen =
      composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
        ? (composer.value || "").trim().length
        : cleanText(composer.innerText || composer.textContent || "").length;
    if (filledLen < Math.min(120, normalizedPrompt.length * 0.2)) {
      throw new Error(
        "ChatGPT input did not accept the prompt. Click inside the message box on ChatGPT, then try again."
      );
    }

    const sent = await waitAndClickSendButton();
    if (!sent) {
      composer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
      );
    }

    const timeoutMs = Math.max(120000, Number(options.timeoutMs) || 240000);
    const timeoutAt = Date.now() + timeoutMs;
    let prevSnapshot = "";
    let stableTicks = 0;

    while (Date.now() < timeoutAt) {
      const messages = getAssistantMessages();
      if (messages.length > baselineAssistantCount) {
        const combined = getCombinedNewAssistantText(messages, baselineAssistantCount);
        const latest = messages[messages.length - 1];
        const text =
          combined.length >= (getAssistantText(latest)?.length || 0) ? combined : getAssistantText(latest);

        if (text.includes("{") && text.includes("}")) {
          try {
            const parsed = extractJsonFromText(text);
            const validator =
              typeof options.validateResult === "function"
                ? options.validateResult
                : validateJsonTaskResult;
            const normalized =
              typeof options.normalizeResult === "function" ? options.normalizeResult(parsed) : parsed;
            const isValid = validator(normalized);
            if (isValid) {
              return normalized;
            }
            if (text === prevSnapshot) {
              stableTicks += 1;
              if (stableTicks >= 3) {
                return normalized;
              }
            } else {
              stableTicks = 0;
              prevSnapshot = text;
            }
          } catch (_err) {
            stableTicks = 0;
            prevSnapshot = "";
          }
        }
      }

      console.log("Waiting for ChatGPT response...");
      await sleep(450);
    }

    throw new Error(`Timed out waiting for ChatGPT response after ${Math.round(timeoutMs / 1000)}s.`);
  }

  async function runChatGptExtraction(jobDescription) {
    const prompt = buildFactsExtractionPrompt(jobDescription);
    return runChatGptJsonTask(prompt, {
      normalizeResult: normalizeFacts,
      validateResult: (facts) => {
        if (!facts || typeof facts !== "object") {
          return false;
        }
        return Object.values(facts).some((value) => Boolean(cleanText(String(value || ""))));
      }
    });
  }

  if (!window.__JOB_EXTENSION_MESSAGE_LISTENER__) {
    window.__JOB_EXTENSION_MESSAGE_LISTENER__ = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "PING_CONTENT_SCRIPT") {
        sendResponse({ ok: true });
      }
      if (message?.type === "EXTRACT_JOB_DESCRIPTION") {
        const payload = extractJobDescription();
        sendResponse({
          ok: Boolean(payload.job_description),
          payload
        });
      }
      if (message?.type === "RUN_CHATGPT_EXTRACTION") {
        const jobDescription = cleanText(message.jobDescription || "");
        if (!jobDescription) {
          sendResponse({ ok: false, error: "Job description is empty." });
          return true;
        }
        runChatGptExtraction(jobDescription)
          .then((facts) => sendResponse({ ok: true, facts }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
      }
      if (message?.type === "RUN_CHATGPT_JSON_TASK") {
        const prompt = String(message.prompt || "");
        if (!cleanText(prompt)) {
          sendResponse({ ok: false, error: "Prompt is empty." });
          return true;
        }
        runChatGptJsonTask(prompt, { timeoutMs: Number(message.timeoutMs) || undefined })
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
      }
      return true;
    });
    runAutoDetectionWithRetries();
  }
})();
