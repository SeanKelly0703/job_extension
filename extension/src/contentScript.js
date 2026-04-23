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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_JOB_DESCRIPTION") {
      const payload = extractJobDescription();
      sendResponse({
        ok: Boolean(payload.job_description),
        payload
      });
    }
    return true;
  });

  runAutoDetectionWithRetries();
})();
