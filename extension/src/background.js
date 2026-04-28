const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const MAX_DESCRIPTION_LEN = 20000;
const CACHE_KEY = "detectedJobsByTab";
const CHATGPT_TAB_PATTERNS = ["*://chatgpt.com/*", "*://*.chatgpt.com/*"];
const MAX_RAG_CHUNKS = 8;
const MAX_PRIORITY_TERMS = 24;
const DEFAULT_TARGET_ATS_SCORE = 95;
const DEFAULT_MAX_ITERATIONS = 5;
const LOW_SIGNAL_TERMS = new Set([
  "program",
  "software",
  "methods",
  "language",
  "technologies",
  "frameworks",
  "project",
  "application",
  "developer"
]);
const ATS_TERM_VARIANTS = {
  "ci/cd": ["ci cd", "continuous integration", "continuous delivery", "release management"],
  "e2e": ["end to end", "end-to-end", "integration testing"],
  "scrum": ["agile", "sprint planning", "daily standup", "retrospective"],
  "kanban": ["agile", "workflow management"],
  "postman": ["api testing", "rest client"],
  "sonar": ["sonarqube", "code quality"],
  "jpa": ["hibernate", "orm"],
  "jaxb": ["xml binding"],
  "application developer": ["software developer", "application engineering"],
  "release management": ["release process", "deployment pipeline", "versioning"],
  "versioning": ["git", "version control"],
  "troubleshoot": ["debug", "incident response", "problem solving"],
  "analyze": ["analysis", "investigate"],
  "lead": ["led", "ownership", "mentored", "coordinated"]
};

function normalizePayload(payload) {
  const description = (payload?.job_description || "").replace(/\s+/g, " ").trim();
  const title = (payload?.title || payload?.job_title || "").trim();
  const company = (payload?.company || "").trim();
  const salary = (payload?.salary || "").trim();
  const location = (payload?.location || "").trim();
  const normalized = {
    source_url: payload?.source_url || "https://unknown.local/job",
    page_title: payload?.page_title || title || "",
    source_site: payload?.source_site || "manual",
    title,
    company,
    salary,
    location,
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

async function createJob(payload) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const response = await fetch(`${apiBase}/api/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail || "Failed to create job.");
  }
  return data;
}

async function updateJob(jobId, payload) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const response = await fetch(`${apiBase}/api/v1/jobs/${jobId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail || "Failed to update job.");
  }
  return data;
}

async function deleteJob(jobId) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const response = await fetch(`${apiBase}/api/v1/jobs/${jobId}`, { method: "DELETE" });
  if (!response.ok) {
    let detail = "Failed to delete job.";
    try {
      const data = await response.json();
      detail = data?.detail || detail;
    } catch (_error) {
      // ignore parse failures
    }
    throw new Error(detail);
  }
}

async function fetchRecentJobs(limit = 5, options = {}) {
  const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (options.search) {
    params.set("search", String(options.search));
  }
  if (options.company) {
    params.set("company", String(options.company));
  }
  if (options.sort_by) {
    params.set("sort_by", String(options.sort_by));
  }
  if (options.sort_order) {
    params.set("sort_order", String(options.sort_order));
  }
  const response = await fetch(`${apiBase}/api/v1/jobs?${params.toString()}`);
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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length >= 2);
}

function unique(array) {
  return Array.from(new Set(array));
}

function normalizeTerm(value) {
  return cleanText(value).toLowerCase();
}

function simplifyTerm(value) {
  return normalizeTerm(value).replace(/[^a-z0-9+#.\s/]/g, "").replace(/\s+/g, " ").trim();
}

function shouldKeepKeyword(term) {
  const normalized = simplifyTerm(term);
  if (!normalized) {
    return false;
  }
  if (normalized.includes(" ")) {
    return true;
  }
  return normalized.length > 2 && !LOW_SIGNAL_TERMS.has(normalized);
}

function parseFeedbackTerms(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => cleanText(item)).filter(Boolean);
  }
  if (typeof raw === "object") {
    return Object.values(raw).flatMap((value) => parseFeedbackTerms(value));
  }
  const text = String(raw);
  return text
    .split(/[\n,;|]/g)
    .map((item) => item.replace(/\(\d+\)/g, " "))
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseFeedbackTermEntries(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || ""))
      .map((item) => {
        const term = cleanText(item.replace(/\(\d+\)/g, " "));
        const countMatch = String(item).match(/\((\d+)\)/);
        const count = countMatch ? Math.max(1, Number(countMatch[1]) || 1) : 1;
        return { term, count };
      })
      .filter((item) => item.term);
  }
  if (typeof raw === "object") {
    return Object.values(raw).flatMap((value) => parseFeedbackTermEntries(value));
  }
  const text = String(raw);
  return text
    .split(/[\n,;|]/g)
    .map((item) => String(item || ""))
    .map((item) => {
      const term = cleanText(item.replace(/\(\d+\)/g, " "));
      const countMatch = item.match(/\((\d+)\)/);
      const count = countMatch ? Math.max(1, Number(countMatch[1]) || 1) : 1;
      return { term, count };
    })
    .filter((item) => item.term);
}

function buildTermVariants(term) {
  const normalized = simplifyTerm(term);
  const variants = new Set([normalized, normalized.replace(/[/-]/g, " ")]);
  const mapped = ATS_TERM_VARIANTS[normalized];
  if (Array.isArray(mapped)) {
    mapped.forEach((value) => variants.add(simplifyTerm(value)));
  }
  return Array.from(variants).filter(Boolean);
}

function countTermMentionsInText(text, variants) {
  const normalized = ` ${normalizeTerm(text || "").replace(/[^\w+#./\s-]/g, " ")} `;
  let total = 0;
  (variants || []).forEach((variant) => {
    const v = simplifyTerm(variant);
    if (!v) {
      return;
    }
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi");
    const matches = normalized.match(re);
    total += matches ? matches.length : 0;
  });
  return total;
}

function derivePriorityTerms({ jobDescription, targetJobTitle, checkerFeedback }) {
  const feedbackEntries = parseFeedbackTermEntries(checkerFeedback).filter((item) => shouldKeepKeyword(item.term));
  const feedbackTerms = feedbackEntries.map((item) => item.term);
  const jdKeywords = extractJobKeywords(jobDescription).filter(shouldKeepKeyword).slice(0, 40);
  const jdText = cleanText(jobDescription);
  const ordered = [];
  function pushTerm(term, source, priority) {
    const normalized = simplifyTerm(term);
    if (!normalized || ordered.some((item) => item.term === normalized)) {
      return;
    }
    const variants = buildTermVariants(normalized);
    const feedbackCount = feedbackEntries
      .filter((item) => simplifyTerm(item.term) === normalized)
      .reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const jdCount = countTermMentionsInText(jdText, variants);
    const targetMentions = Math.max(1, feedbackCount || jdCount || 1);
    ordered.push({
      term: normalized,
      source,
      priority,
      variants,
      target_mentions: targetMentions
    });
  }
  if (targetJobTitle && shouldKeepKeyword(targetJobTitle)) {
    pushTerm(targetJobTitle, "job_title", 100);
  }
  feedbackTerms.forEach((term, index) => pushTerm(term, "checker_feedback", 90 - index));
  jdKeywords.forEach((term, index) => pushTerm(term, "job_description", 60 - index));
  return ordered.slice(0, MAX_PRIORITY_TERMS);
}

function buildResumeChunks(resumeProfile) {
  const chunks = [];
  const sections = resumeProfile?.sections || {};
  Object.entries(sections).forEach(([sectionName, items]) => {
    if (!Array.isArray(items)) {
      return;
    }
    items.forEach((item, index) => {
      const text = cleanText(item);
      if (!text) {
        return;
      }
      chunks.push({
        id: `${sectionName}_${index}`,
        section: sectionName,
        text,
        tokens: tokenize(text)
      });
    });
  });
  if (!chunks.length && resumeProfile?.raw_text) {
    const sentences = cleanText(resumeProfile.raw_text).split(/(?<=[.!?])\s+/);
    sentences.forEach((sentence, index) => {
      const text = cleanText(sentence);
      if (text.length < 30) {
        return;
      }
      chunks.push({
        id: `raw_${index}`,
        section: "experience",
        text,
        tokens: tokenize(text)
      });
    });
  }
  return chunks;
}

function extractJobKeywords(jobDescription) {
  const tokens = tokenize(jobDescription).filter(
    (token) => token.length > 3 && !["with", "from", "that", "this", "will", "have", "your"].includes(token)
  );
  return unique(tokens).slice(0, 80);
}

function rankResumeChunks(chunks, jobKeywords, feedbackKeywords = []) {
  const focusTerms = new Set([...jobKeywords, ...feedbackKeywords].map((token) => token.toLowerCase()));
  return chunks
    .map((chunk) => {
      const overlap = chunk.tokens.filter((token) => focusTerms.has(token)).length;
      const sectionBonus =
        chunk.section === "experience" || chunk.section === "projects" ? 2 : chunk.section === "skills" ? 1 : 0;
      return {
        ...chunk,
        score: overlap * 3 + sectionBonus
      };
    })
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length)
    .slice(0, MAX_RAG_CHUNKS);
}

function resumeToSectionText(resume) {
  const value = resume && typeof resume === "object" ? resume : {};
  return {
    headline: cleanText(value.headline || ""),
    summary: cleanText(value.summary || ""),
    skills: cleanText((Array.isArray(value.skills) ? value.skills : []).join(" | ")),
    soft_skills: cleanText((Array.isArray(value.soft_skills) ? value.soft_skills : []).join(" | ")),
    languages: cleanText((Array.isArray(value.languages) ? value.languages : []).join(" | ")),
    web_presence: cleanText((Array.isArray(value.web_presence) ? value.web_presence : []).join(" | ")),
    certifications: cleanText((Array.isArray(value.certifications) ? value.certifications : []).join(" | ")),
    experience: cleanText(
      (Array.isArray(value.experience) ? value.experience : [])
        .flatMap((item) => [item?.company, item?.title, item?.location, item?.dates, ...(item?.bullets || [])])
        .join(" | ")
    ),
    projects: cleanText(
      (Array.isArray(value.projects) ? value.projects : [])
        .flatMap((item) => [item?.name, item?.dates, ...(item?.bullets || [])])
        .join(" | ")
    ),
    education: cleanText(
      (Array.isArray(value.education) ? value.education : [])
        .flatMap((item) => [item?.school, item?.degree, item?.dates, item?.details])
        .join(" | ")
    )
  };
}

function evaluateKeywordCoverage(resume, priorityTerms) {
  const sectionText = resumeToSectionText(resume);
  const sections = Object.entries(sectionText).map(([section, text]) => ({ section, text: normalizeTerm(text) }));
  const coverage = priorityTerms.map((term) => {
    const matches = [];
    let mentionCount = 0;
    sections.forEach(({ section, text }) => {
      const sectionMentions = countTermMentionsInText(text, term.variants);
      if (sectionMentions > 0) {
        matches.push(section);
        mentionCount += sectionMentions;
      }
    });
    return {
      term: term.term,
      source: term.source,
      priority: term.priority,
      matched_sections: matches,
      target_mentions: Math.max(1, Number(term.target_mentions) || 1),
      resume_mentions: mentionCount
    };
  });
  const present = coverage.filter((item) => item.matched_sections.length > 0);
  const missing = coverage.filter((item) => item.matched_sections.length === 0);
  const lowFrequency = coverage.filter(
    (item) => item.matched_sections.length > 0 && item.resume_mentions < item.target_mentions
  );
  return {
    present,
    missing,
    low_frequency: lowFrequency,
    coverage
  };
}

function shouldRunCoverageRefinement(report) {
  const highPriorityMissing = report.missing.filter((item) => item.priority >= 70).length;
  const highPriorityLowFrequency = (report.low_frequency || []).filter((item) => item.priority >= 70).length;
  return highPriorityMissing >= 2 || report.missing.length >= 6 || highPriorityLowFrequency >= 2;
}

function normalizeDateRange(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  const normalized = text
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const normalizePart = (part) => {
    const valuePart = cleanText(part).replace(/\./g, "");
    if (!valuePart) {
      return "";
    }
    if (/^(present|current|now)$/i.test(valuePart)) {
      return "Present";
    }
    const monthYear = valuePart.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
    if (monthYear) {
      const month = monthYear[1].slice(0, 3);
      return `${month.charAt(0).toUpperCase()}${month.slice(1).toLowerCase()} ${monthYear[2]}`;
    }
    const slashYear = valuePart.match(/^(\d{1,2})[\/-](\d{4})$/);
    if (slashYear) {
      const monthIndex = Number(slashYear[1]) - 1;
      if (monthIndex >= 0 && monthIndex < monthNames.length) {
        return `${monthNames[monthIndex]} ${slashYear[2]}`;
      }
    }
    const yearOnly = valuePart.match(/^(\d{4})$/);
    if (yearOnly) {
      return yearOnly[1];
    }
    return valuePart;
  };
  const rangeParts = normalized.split(" - ").map((part) => normalizePart(part)).filter(Boolean);
  if (!rangeParts.length) {
    return normalized;
  }
  return rangeParts.join(" - ");
}

function deriveDateParts(value) {
  const normalized = normalizeDateRange(value);
  const parts = normalized.split(" - ").map((item) => cleanText(item)).filter(Boolean);
  if (!parts.length) {
    return { dates: "", start_month: "", end_month: "" };
  }
  if (parts.length === 1) {
    return { dates: normalized, start_month: parts[0], end_month: "" };
  }
  return {
    dates: normalized,
    start_month: parts[0],
    end_month: parts[1]
  };
}

function deriveSoftSkillsFromEvidence(text) {
  const source = normalizeTerm(text);
  const mapping = [
    { label: "Leadership", patterns: ["led", "lead", "ownership", "owned", "mentored"] },
    { label: "Collaboration", patterns: ["collaborated", "partnered", "cross-functional", "stakeholder"] },
    { label: "Communication", patterns: ["presented", "communicated", "documentation", "documented"] },
    { label: "Problem Solving", patterns: ["troubleshoot", "resolved", "debug", "incident"] },
    { label: "Analytical Thinking", patterns: ["analyze", "analysis", "investigate", "optimization"] },
    { label: "Time Management", patterns: ["delivery", "deadline", "release cycle"] },
    { label: "Coordination", patterns: ["coordinated", "orchestrated", "facilitated"] },
    { label: "Adaptability", patterns: ["agile", "iterative", "dynamic"] }
  ];
  return mapping
    .filter((item) => item.patterns.some((pattern) => source.includes(pattern)))
    .map((item) => item.label)
    .slice(0, 10);
}

function deriveLanguagesFromEvidence(resume, resumeProfile) {
  const explicit = Array.isArray(resume?.languages) ? resume.languages.map((item) => cleanText(item)).filter(Boolean) : [];
  if (explicit.length) {
    return explicit;
  }
  const profileLanguages = Array.isArray(resumeProfile?.languages)
    ? resumeProfile.languages.map((item) => cleanText(item)).filter(Boolean)
    : [];
  if (profileLanguages.length) {
    return profileLanguages;
  }
  const known = [
    "Java",
    "Python",
    "JavaScript",
    "TypeScript",
    "Go",
    "C#",
    "C++",
    "SQL",
    "Bash",
    "Rust",
    "Scala"
  ];
  const text = normalizeTerm(
    [resume?.summary || "", ...(Array.isArray(resume?.skills) ? resume.skills : []), resumeProfile?.raw_text || ""].join(" ")
  );
  return known.filter((name) => text.includes(name.toLowerCase())).slice(0, 8);
}

function deriveWebPresenceFromEvidence(resumeProfile) {
  const profile = resumeProfile && typeof resumeProfile === "object" ? resumeProfile : {};
  const links = [];
  const contact = profile.contact || {};
  const candidates = [
    contact.linkedin,
    contact.github,
    contact.portfolio,
    profile.github,
    profile.github_url,
    profile.portfolio,
    profile.portfolio_url,
    profile.website
  ];
  candidates.forEach((item) => {
    const value = cleanText(item);
    if (!value) {
      return;
    }
    if (!links.includes(value)) {
      links.push(value);
    }
  });
  return links.slice(0, 6);
}

function enforceTargetTitleAlignment(resume, targetJobTitle) {
  const normalizedTitle = cleanText(targetJobTitle);
  if (!normalizedTitle) {
    return resume;
  }
  const value = resume && typeof resume === "object" ? { ...resume } : {};
  const headline = cleanText(value.headline || "");
  const summary = cleanText(value.summary || "");
  if (!normalizeTerm(headline).includes(normalizeTerm(normalizedTitle))) {
    value.headline = headline ? `${headline} | ${normalizedTitle}` : normalizedTitle;
  }
  if (summary && !normalizeTerm(summary).includes(normalizeTerm(normalizedTitle))) {
    value.summary = `Target Role: ${normalizedTitle}. ${summary}`;
  } else if (!summary) {
    value.summary = `Target Role: ${normalizedTitle}.`;
  }
  return value;
}

function buildTailorPrompt({
  jobDescription,
  resumeProfile,
  ragChunks,
  useChatGptFileMode,
  templateGuide,
  targetJobTitle,
  priorityTerms,
  targetScore
}) {
  const templateHints = resumeProfile?.template || {};
  const sectionOrder = Array.isArray(templateGuide?.section_order) && templateGuide.section_order.length
    ? templateGuide.section_order
    : Array.isArray(templateHints.section_order)
    ? templateHints.section_order
    : ["summary", "experience", "projects", "skills", "education"];
  const hasSummary = typeof templateGuide?.has_summary === "boolean"
    ? templateGuide.has_summary
    : Boolean(templateHints.has_summary);
  const templateExcerpt = cleanText(templateGuide?.template_excerpt || "").slice(0, 2500);
  const compactProfile = useChatGptFileMode
    ? null
    : {
        full_name: cleanText(resumeProfile?.full_name || ""),
        headline: cleanText(resumeProfile?.headline || ""),
        contact: resumeProfile?.contact || {},
        sections: resumeProfile?.sections || {},
        experience_records: resumeProfile?.experience_records || [],
        education_records: resumeProfile?.education_records || [],
        web_presence: resumeProfile?.web_presence || [],
        certifications: resumeProfile?.certifications || [],
        template: {
          section_order: sectionOrder,
          has_summary: hasSummary,
          font_family: templateHints.font_family || "Segoe UI"
        }
      };
  const compactRag = ragChunks.map((chunk) => ({
    section: chunk.section,
    text: chunk.text
  }));
  const prioritySummary = priorityTerms.map((item) => ({
    term: item.term,
    source: item.source,
    priority: item.priority,
    target_mentions: item.target_mentions || 1
  }));
  const prompt = [
    "You are a senior ATS resume strategist and recruiter.",
    "Tailor the resume to the job description in a SINGLE PASS using best-practice ATS optimization.",
    `Primary objective: maximize ATS relevance toward a target score of ${Math.round(Number(targetScore) || DEFAULT_TARGET_ATS_SCORE)} while remaining fully truthful.`,
    "Use this workflow internally before writing:",
    "1) Extract required/preferred keywords, tools, responsibilities, and outcome signals from the job description.",
    "2) Map those requirements to candidate evidence from resume profile and RAG snippets.",
    "3) Rewrite summary, skills, and bullets to maximize truthful keyword alignment and measurable impact.",
    "4) Run an ATS gap check and close high-impact keyword gaps using truthful phrasing from candidate evidence.",
    "ATS gap checklist to prioritize when the JD asks for these areas:",
    "- Cloud depth: name concrete services (e.g., AWS EC2/EKS/ECS/Lambda/S3/RDS/IAM/VPC/CloudWatch, or Azure/GCP equivalents) instead of generic 'cloud'.",
    "- Infrastructure as Code: explicitly include Terraform/CloudFormation/Bicep/Ansible if evidence exists.",
    "- Agile delivery: include Scrum/Kanban ceremonies and cross-functional rituals where truthful.",
    "- Leadership scope: mention mentoring, ownership, technical leadership, stakeholder collaboration, and team impact where evidenced.",
    "- Testing breadth: include integration, E2E, API, contract, load/performance, and test automation tools where evidenced.",
    "- DevOps/SRE practices: include CI/CD, GitOps, observability, monitoring/alerting, incident response, and reliability practices where evidenced.",
    "- Service mesh and distributed networking: include Istio/Linkerd/service-to-service traffic/security/retries when supported by evidence.",
    "- Database depth: include query tuning, indexing strategy, execution plan optimization, partitioning, caching, replication, or transaction tuning when evidenced.",
    "Rewrite quality rules:",
    "- Prefer specific named tools/services over broad buzzwords.",
    "- Keep bullets achievement-first with clear scope and outcome.",
    "- Start bullets with strong action verbs (e.g., led, architected, delivered, optimized, automated, mentored, coordinated, launched, resolved).",
    "- Avoid weak phrasing like `responsible for`, `worked on`, or `helped with`; rewrite into clear action + result statements.",
    "- Match action verbs to role intent (technical leadership, delivery, optimization, collaboration, incident response) and vary them across bullets.",
    "- Prioritize quantified impact: include concrete metrics where evidence exists (%, time, cost, revenue, latency, throughput, user count, volume).",
    "- Target quantification density: at least one quantified bullet per role/project, and most bullets should indicate measurable scope or result.",
    "- If exact numbers are unavailable, use truthful scale signals (e.g., multi-team, enterprise-wide, high-volume, millions of events/day) instead of vague claims.",
    "- Ensure each major JD requirement is represented in summary, experience, projects, or skills when truthful.",
    "- Avoid repetitive language: do not reuse the same opening verb or phrase across consecutive bullets.",
    "- Limit repeated keyword echoing; vary sentence construction while preserving ATS-relevant terms.",
    "- Keep natural lexical variety (synonyms and alternate phrasing) so text does not read templated.",
    "Coverage policy:",
    "- Ensure each priority keyword appears at least once across summary, experience, projects, or skills when truthful.",
    "- Balance skill mention frequency: cover critical JD skills enough times to reflect role emphasis, but avoid unnatural keyword stuffing.",
    "- Put role-title alignment in headline/summary when possible.",
    "- Include an explicit Soft Skills section (`soft_skills`) derived from demonstrated behaviors in experience bullets.",
    "- Include an explicit Languages section (`languages`) for spoken and/or programming languages supported by evidence.",
    "- Include an explicit Certifications section (`certifications`) if source evidence contains certifications.",
    "- Include a `web_presence` section with professional URLs (LinkedIn, GitHub, portfolio) when available.",
    "- Use `Phone Number` wording where contact phone appears.",
    "- Spell out abbreviations consistently (e.g., use `RESTful APIs` consistently).",
    "- Add concise education details/bullets when available (coursework, projects, or focus areas).",
    "- Keep URLs valid: include LinkedIn/profile URLs only when known, otherwise omit empty placeholders.",
    "- Use one consistent date format across experience/projects/education: `MMM YYYY - MMM YYYY` or `MMM YYYY - Present`.",
    "- Populate `start_month` and `end_month` for each experience/project/education entry when date evidence is available.",
    "Hard constraints:",
    "- Never fabricate employers, dates, titles, degrees, certifications, tools, or metrics.",
    "- If a requirement is missing, do not invent it; emphasize adjacent transferable evidence instead.",
    "- Keep bullets concise (1-2 lines), action-led, and outcome-oriented.",
    "- Mirror exact JD phrasing where truthful (for ATS match), but avoid keyword stuffing.",
    "- Keep structure compatible with template guidance section order and plain ATS-readable format.",
    useChatGptFileMode
      ? "Use the resume PDF file already uploaded in this ChatGPT conversation as the source of truth."
      : "Use the provided resume profile and retrieved snippets as source context.",
    "Return ONLY valid JSON with this schema (no markdown, no commentary):",
    '{"full_name":"","headline":"","summary":"","experience":[{"company":"","title":"","dates":"","start_month":"","end_month":"","location":"","bullets":[""]}],"projects":[{"name":"","dates":"","start_month":"","end_month":"","bullets":[""]}],"skills":[""],"soft_skills":[""],"languages":[""],"web_presence":[""],"education":[{"school":"","degree":"","dates":"","start_month":"","end_month":"","details":""}],"certifications":[""]}',
    "",
    useChatGptFileMode ? "Original resume profile JSON: (not provided; read attached file in chat context)." : "Original resume profile JSON:",
    useChatGptFileMode ? "" : JSON.stringify(compactProfile, null, 2),
    "",
    useChatGptFileMode ? "Retrieved context snippets: (not provided in ChatGPT file mode)." : "Retrieved context snippets (RAG top matches):",
    useChatGptFileMode ? "" : JSON.stringify(compactRag, null, 2),
    "",
    "Priority keyword targets JSON:",
    JSON.stringify(prioritySummary, null, 2),
    "",
    "Target job title:",
    cleanText(targetJobTitle || ""),
    "",
    "Template guidance JSON:",
    JSON.stringify(
      {
        section_order: sectionOrder,
        has_summary: hasSummary,
        template_excerpt: templateExcerpt
      },
      null,
      2
    ),
    "",
    "Job description:",
    jobDescription
  ].join("\n");
  return prompt;
}

function buildCoverageRefinementPrompt({
  jobDescription,
  tailoredResume,
  missingTerms,
  lowFrequencyTerms,
  targetJobTitle,
  sectionOrder,
  targetScore
}) {
  const compactResume = {
    full_name: cleanText(tailoredResume?.full_name || ""),
    headline: cleanText(tailoredResume?.headline || ""),
    summary: cleanText(tailoredResume?.summary || ""),
    experience: tailoredResume?.experience || [],
    projects: tailoredResume?.projects || [],
    skills: tailoredResume?.skills || [],
    soft_skills: tailoredResume?.soft_skills || [],
    languages: tailoredResume?.languages || [],
    web_presence: tailoredResume?.web_presence || [],
    education: tailoredResume?.education || [],
    certifications: tailoredResume?.certifications || []
  };
  return [
    "You are an ATS resume optimizer doing a focused refinement pass.",
    "Revise the resume JSON to close missing high-impact ATS terms while preserving truthfulness and readability.",
    `Refinement target: improve toward ATS score ${Math.round(Number(targetScore) || DEFAULT_TARGET_ATS_SCORE)}.`,
    "Rules:",
    "- Keep all employers, dates, titles, education, and certifications truthful (no fabrication).",
    "- Keep bullets concise and action-oriented.",
    "- Rewrite weak duty language into action-verb-first impact bullets.",
    "- Use role-relevant action verbs and avoid repeating the same verb across adjacent bullets.",
    "- Integrate missing terms naturally across summary, skills, and relevant bullets.",
    "- Strengthen quantified outcomes in weak bullets (convert generic claims into metric-backed impact when evidence exists).",
    "- Ensure each experience/project entry contains at least one measurable result line when evidence allows.",
    "- When hard numbers are missing, preserve truth by using explicit scope indicators rather than invented metrics.",
    "- Increase mention count for underrepresented high-priority skills naturally across relevant sections.",
    "- Reduce repetitive wording by varying bullet starters and sentence structure.",
    "- Do not repeat the same multi-word phrase across multiple bullets unless strictly necessary.",
    "- Keep `soft_skills` and `languages` populated from evidence (do not invent unsupported fluency claims).",
    "- Keep `certifications` explicit when evidence exists.",
    "- Keep `web_presence` to real professional URLs only.",
    "- Keep all dates in one format: `MMM YYYY - MMM YYYY` or `MMM YYYY - Present`.",
    "- Populate `start_month` and `end_month` fields when date evidence is available.",
    "- Keep parser-friendly wording and section compatibility.",
    "- Ensure headline/summary reflects the target role phrase when truthful.",
    "Return ONLY valid JSON with this schema (no markdown):",
    '{"full_name":"","headline":"","summary":"","experience":[{"company":"","title":"","dates":"","start_month":"","end_month":"","location":"","bullets":[""]}],"projects":[{"name":"","dates":"","start_month":"","end_month":"","bullets":[""]}],"skills":[""],"soft_skills":[""],"languages":[""],"web_presence":[""],"education":[{"school":"","degree":"","dates":"","start_month":"","end_month":"","details":""}],"certifications":[""]}',
    "",
    "Current tailored resume JSON:",
    JSON.stringify(compactResume, null, 2),
    "",
    "Missing ATS terms to cover:",
    JSON.stringify(missingTerms, null, 2),
    "",
    "Underrepresented ATS terms (increase mention density naturally):",
    JSON.stringify(lowFrequencyTerms || [], null, 2),
    "",
    "Target job title:",
    cleanText(targetJobTitle || ""),
    "",
    "Preferred section order:",
    JSON.stringify(sectionOrder, null, 2),
    "",
    "Job description:",
    jobDescription
  ].join("\n");
}

function buildScorePrompt({ jobDescription, tailoredResume }) {
  const compactResume = {
    full_name: cleanText(tailoredResume?.full_name || ""),
    headline: cleanText(tailoredResume?.headline || ""),
    summary: cleanText(tailoredResume?.summary || ""),
    experience: tailoredResume?.experience || [],
    projects: tailoredResume?.projects || [],
    skills: tailoredResume?.skills || [],
    soft_skills: tailoredResume?.soft_skills || [],
    languages: tailoredResume?.languages || [],
    web_presence: tailoredResume?.web_presence || [],
    education: tailoredResume?.education || [],
    certifications: tailoredResume?.certifications || []
  };
  const prompt = [
    "You are an ATS scoring assistant.",
    "Score this tailored resume against the job description with strict object output.",
    "Return ONLY valid JSON with this schema:",
    '{"ats_score":0,"missing_keywords":[""],"strengths":[""],"improvements":[""],"rationale":""}',
    "ats_score must be an integer 0-100.",
    "",
    "Tailored resume JSON:",
    JSON.stringify(compactResume, null, 2),
    "",
    "Job description:",
    jobDescription
  ].join("\n");
  return prompt;
}

function buildIterationTailorPrompt({
  jobDescription,
  currentResume,
  scoreReport,
  targetJobTitle,
  priorityTerms,
  templateGuide,
  targetScore
}) {
  const sectionOrder = Array.isArray(templateGuide?.section_order) && templateGuide.section_order.length
    ? templateGuide.section_order
    : ["summary", "experience", "projects", "skills", "education"];
  return [
    "You are a senior ATS resume strategist running an iterative improvement pass.",
    "Improve the current tailored resume to increase ATS score while keeping all content truthful and evidence-based.",
    `Current pass goal: move resume closer to ATS target score ${Math.round(Number(targetScore) || DEFAULT_TARGET_ATS_SCORE)}.`,
    "Priorities for this pass:",
    "- Close missing keywords and weak requirement matches naturally.",
    "- Improve wording precision and measurable impact.",
    "- Upgrade generic duty statements to strong action-verb-led achievements.",
    "- Increase role-relevant action verb coverage while keeping verb variety.",
    "- Replace weak, generic bullets with quantified impact statements where evidence supports it.",
    "- Increase metric density and vary action verbs to avoid repetitive phrasing.",
    "- Raise mention frequency for critical underrepresented skills without keyword stuffing.",
    "- Remove repetitive wording patterns and diversify phrasing across bullets and summary.",
    "- Keep parser-friendly formatting and section clarity.",
    "- Preserve date consistency: `MMM YYYY - MMM YYYY` or `MMM YYYY - Present`.",
    "- Keep `soft_skills` and `languages` populated from real evidence only.",
    "- Keep `certifications` explicit when evidence exists.",
    "- Populate `start_month` and `end_month` fields for dated entries when evidence is available.",
    "Hard constraints:",
    "- Never fabricate employers, dates, titles, degrees, certifications, tools, or metrics.",
    "- Do not add unsupported technologies or role claims.",
    "- Avoid repeating identical opening words in adjacent bullets.",
    "- Do not use weak openers like `Responsible for` unless quoting source text; prefer direct action verbs.",
    "- Prefer measurable outcomes over generic responsibility statements whenever truthful evidence exists.",
    "",
    "Current ATS score report JSON:",
    JSON.stringify(scoreReport, null, 2),
    "",
    "Target job title:",
    cleanText(targetJobTitle || ""),
    "",
    "Priority keyword targets:",
    JSON.stringify(priorityTerms.map((item) => item.term).slice(0, 18), null, 2),
    "",
    "Preferred section order:",
    JSON.stringify(sectionOrder, null, 2),
    "",
    "Current tailored resume JSON:",
    JSON.stringify(
      {
        full_name: cleanText(currentResume?.full_name || ""),
        headline: cleanText(currentResume?.headline || ""),
        summary: cleanText(currentResume?.summary || ""),
        experience: currentResume?.experience || [],
        projects: currentResume?.projects || [],
        skills: currentResume?.skills || [],
        soft_skills: currentResume?.soft_skills || [],
        languages: currentResume?.languages || [],
        web_presence: currentResume?.web_presence || [],
        education: currentResume?.education || [],
        certifications: currentResume?.certifications || []
      },
      null,
      2
    ),
    "",
    "Job description:",
    jobDescription,
    "",
    "Return ONLY valid JSON with this schema (no markdown, no commentary):",
    '{"full_name":"","headline":"","summary":"","experience":[{"company":"","title":"","dates":"","start_month":"","end_month":"","location":"","bullets":[""]}],"projects":[{"name":"","dates":"","start_month":"","end_month":"","bullets":[""]}],"skills":[""],"soft_skills":[""],"languages":[""],"web_presence":[""],"education":[{"school":"","degree":"","dates":"","start_month":"","end_month":"","details":""}],"certifications":[""]}'
  ].join("\n");
}

function normalizeTailoredResume(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  function normalizeTerminology(input) {
    return String(input || "")
      .replace(/\bHTMLS\b/gi, "HTML")
      .replace(/\bREST\s*API'?S?\b/gi, "RESTful APIs")
      .replace(/\bJavascript\b/g, "JavaScript")
      .replace(/\bTypescript\b/g, "TypeScript");
  }
  function normalizeString(input) {
    return cleanText(normalizeTerminology(input || ""));
  }
  function normalizeStringArray(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => normalizeString(item)).filter(Boolean);
  }
  function normalizeExperience(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => {
      const dateParts = deriveDateParts(item?.dates || [item?.start_month, item?.end_month].filter(Boolean).join(" - "));
      return {
        company: normalizeString(item?.company),
        title: normalizeString(item?.title),
        dates: dateParts.dates,
        start_month: normalizeString(item?.start_month) || dateParts.start_month,
        end_month: normalizeString(item?.end_month) || dateParts.end_month,
        location: normalizeString(item?.location),
        bullets: normalizeStringArray(item?.bullets)
      };
    });
  }
  function normalizeProjects(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => {
      const dateParts = deriveDateParts(item?.dates || [item?.start_month, item?.end_month].filter(Boolean).join(" - "));
      return {
        name: normalizeString(item?.name),
        dates: dateParts.dates,
        start_month: normalizeString(item?.start_month) || dateParts.start_month,
        end_month: normalizeString(item?.end_month) || dateParts.end_month,
        bullets: normalizeStringArray(item?.bullets)
      };
    });
  }
  function normalizeEducation(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => {
      const dateParts = deriveDateParts(item?.dates || [item?.start_month, item?.end_month].filter(Boolean).join(" - "));
      return {
        school: normalizeString(item?.school),
        degree: normalizeString(item?.degree),
        dates: dateParts.dates,
        start_month: normalizeString(item?.start_month) || dateParts.start_month,
        end_month: normalizeString(item?.end_month) || dateParts.end_month,
        details: normalizeString(item?.details)
      };
    });
  }
  return {
    full_name: normalizeString(value.full_name),
    headline: normalizeString(value.headline),
    summary: normalizeString(value.summary),
    experience: normalizeExperience(value.experience).map((item) => ({
      ...item,
      dates: normalizeDateRange(item.dates)
    })),
    projects: normalizeProjects(value.projects),
    skills: normalizeStringArray(value.skills),
    soft_skills: normalizeStringArray(value.soft_skills),
    languages: normalizeStringArray(value.languages),
    web_presence: normalizeStringArray(value.web_presence),
    education: normalizeEducation(value.education),
    certifications: normalizeStringArray(value.certifications)
  };
}

function normalizeScoreReport(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const ats = Number(value.ats_score);
  const clamp = Number.isFinite(ats) ? Math.max(0, Math.min(100, Math.round(ats))) : 0;
  const normalizeList = (items) =>
    Array.isArray(items) ? items.map((item) => cleanText(item)).filter(Boolean).slice(0, 12) : [];
  return {
    ats_score: clamp,
    missing_keywords: normalizeList(value.missing_keywords),
    strengths: normalizeList(value.strengths),
    improvements: normalizeList(value.improvements),
    rationale: cleanText(value.rationale || "")
  };
}

function resumeHasContent(resume) {
  const value = resume && typeof resume === "object" ? resume : {};
  return Boolean(
    cleanText(value.full_name) ||
      cleanText(value.headline) ||
      cleanText(value.summary) ||
      (Array.isArray(value.experience) && value.experience.length) ||
      (Array.isArray(value.projects) && value.projects.length) ||
      (Array.isArray(value.skills) && value.skills.length) ||
      (Array.isArray(value.soft_skills) && value.soft_skills.length) ||
      (Array.isArray(value.languages) && value.languages.length) ||
      (Array.isArray(value.web_presence) && value.web_presence.length) ||
      (Array.isArray(value.certifications) && value.certifications.length) ||
      (Array.isArray(value.education) && value.education.length)
  );
}

function postProcessTailoredResume(resume, resumeProfile, targetJobTitle) {
  const processed = enforceTargetTitleAlignment(normalizeTailoredResume(resume), targetJobTitle);
  if (!Array.isArray(processed.soft_skills) || !processed.soft_skills.length) {
    processed.soft_skills = deriveSoftSkillsFromEvidence(
      [
        processed.summary,
        ...(processed.experience || []).flatMap((item) => item.bullets || []),
        resumeProfile?.raw_text || ""
      ].join(" ")
    );
  }
  if (!Array.isArray(processed.languages) || !processed.languages.length) {
    processed.languages = deriveLanguagesFromEvidence(processed, resumeProfile);
  }
  if (!Array.isArray(processed.certifications) || !processed.certifications.length) {
    processed.certifications = Array.isArray(resumeProfile?.certifications)
      ? resumeProfile.certifications.map((item) => cleanText(item)).filter(Boolean)
      : [];
  }
  if (!Array.isArray(processed.web_presence) || !processed.web_presence.length) {
    processed.web_presence = deriveWebPresenceFromEvidence(resumeProfile);
  }
  const profileEducation = Array.isArray(resumeProfile?.education_records) ? resumeProfile.education_records : [];
  processed.education = (processed.education || []).map((entry) => {
    const school = cleanText(entry?.school);
    const degree = cleanText(entry?.degree);
    const fallback = profileEducation.find((item) => {
      const ps = cleanText(item?.school);
      const pd = cleanText(item?.degree);
      return (school && ps && school.toLowerCase() === ps.toLowerCase()) || (degree && pd && degree.toLowerCase() === pd.toLowerCase());
    });
    if (!fallback) {
      return entry;
    }
    const fallbackParts = deriveDateParts(fallback?.dates || [fallback?.start_month, fallback?.end_month].filter(Boolean).join(" - "));
    return {
      ...entry,
      dates: cleanText(entry?.dates) || fallbackParts.dates,
      start_month: cleanText(entry?.start_month) || fallbackParts.start_month,
      end_month: cleanText(entry?.end_month) || fallbackParts.end_month
    };
  });
  return processed;
}

function isChatGptTimeoutError(error) {
  return String(error?.message || error || "").toLowerCase().includes("timed out waiting for chatgpt response");
}

async function runChatGptJsonTask(prompt, options = {}) {
  const retries = Math.max(0, Number(options.retries) || 0);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const chatGptTabId = await findChatGptTabId();
      const response = await sendMessageWithScriptRecovery(chatGptTabId, {
        type: "RUN_CHATGPT_JSON_TASK",
        prompt,
        timeoutMs: options.timeoutMs
      });
      if (!response?.ok) {
        throw new Error(response?.error || "ChatGPT JSON task failed.");
      }
      if (!response?.result || typeof response.result !== "object") {
        throw new Error("ChatGPT returned invalid JSON result.");
      }
      return response.result;
    } catch (error) {
      lastError = error;
      if (!(isChatGptTimeoutError(error) && attempt < retries)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError || new Error("ChatGPT JSON task failed.");
}

async function runResumeTailoring(payload) {
  const jobDescription = cleanText(payload?.jobDescription || "");
  const resumeProfile = payload?.resumeProfile || {};
  const templateGuide = payload?.templateGuide && typeof payload.templateGuide === "object" ? payload.templateGuide : null;
  const useChatGptFileMode = Boolean(payload?.useChatGptFileMode);
  const checkerFeedback = payload?.checkerFeedback || payload?.atsReview || payload?.atsReviewText || [];
  const targetJobTitle = cleanText(payload?.targetJobTitle || payload?.jobFacts?.job_title || "");
  const targetScore = Math.max(60, Math.min(100, Number(payload?.targetScore) || DEFAULT_TARGET_ATS_SCORE));
  const maxIterations = Math.max(1, Math.min(8, Number(payload?.maxIterations) || DEFAULT_MAX_ITERATIONS));
  const isSinglePass = maxIterations <= 1;
  if (!jobDescription) {
    throw new Error("Job description is empty.");
  }
  if (!useChatGptFileMode && (!resumeProfile || typeof resumeProfile !== "object")) {
    throw new Error("Resume profile is required unless ChatGPT file mode is enabled.");
  }
  const chunks = useChatGptFileMode ? [] : buildResumeChunks(resumeProfile);
  if (!useChatGptFileMode && !chunks.length) {
    throw new Error("Could not parse usable resume content from the uploaded PDF.");
  }
  const priorityTerms = derivePriorityTerms({
    jobDescription,
    targetJobTitle,
    checkerFeedback
  });
  const jobKeywords = extractJobKeywords(jobDescription);
  const feedbackRankingTerms = priorityTerms.map((item) => item.term);
  const ragChunks = useChatGptFileMode ? [] : rankResumeChunks(chunks, jobKeywords, feedbackRankingTerms);
  const tailorPrompt = buildTailorPrompt({
    jobDescription,
    resumeProfile,
    ragChunks,
    useChatGptFileMode,
    templateGuide,
    targetJobTitle,
    priorityTerms,
    targetScore
  });
  const tailoredRaw = await runChatGptJsonTask(tailorPrompt, { retries: isSinglePass ? 0 : 1, timeoutMs: 240000 });
  let tailoredResume = postProcessTailoredResume(tailoredRaw, resumeProfile, targetJobTitle);
  if (!resumeHasContent(tailoredResume)) {
    throw new Error("Tailoring completed but returned no usable resume content. Try running again.");
  }
  let coverageReport = evaluateKeywordCoverage(tailoredResume, priorityTerms);
  let refinementApplied = false;
  if (!isSinglePass && shouldRunCoverageRefinement(coverageReport)) {
    const refinementPrompt = buildCoverageRefinementPrompt({
      jobDescription,
      tailoredResume,
      missingTerms: coverageReport.missing.slice(0, 10).map((item) => item.term),
      lowFrequencyTerms: (coverageReport.low_frequency || [])
        .slice(0, 10)
        .map((item) => ({
          term: item.term,
          resume_mentions: item.resume_mentions,
          target_mentions: item.target_mentions
        })),
      targetJobTitle,
      targetScore,
      sectionOrder:
        templateGuide?.section_order && Array.isArray(templateGuide.section_order)
          ? templateGuide.section_order
          : resumeProfile?.template?.section_order || ["summary", "experience", "projects", "skills", "education"]
    });
    try {
      const refinedRaw = await runChatGptJsonTask(refinementPrompt, { retries: 0, timeoutMs: 180000 });
      const refinedResume = postProcessTailoredResume(refinedRaw, resumeProfile, targetJobTitle);
      if (resumeHasContent(refinedResume)) {
        const refinedCoverage = evaluateKeywordCoverage(refinedResume, priorityTerms);
        if (refinedCoverage.missing.length <= coverageReport.missing.length) {
          tailoredResume = refinedResume;
          coverageReport = refinedCoverage;
          refinementApplied = true;
        }
      }
    } catch (_error) {
      // Keep primary tailored resume if refinement fails.
    }
  }
  if (isSinglePass) {
    const keywordFocus = priorityTerms.map((item) => item.term).slice(0, 12);
    const missingKeywords = [
      ...coverageReport.missing.map((item) => item.term),
      ...(coverageReport.low_frequency || []).map((item) => `${item.term} (underrepresented)`)
    ].slice(0, 10);
    return {
      ok: true,
      mode: "single_pass_targeted",
      prompt_strategy: "web-guided-ats-tailoring-v3-single-pass",
      target_score: targetScore,
      max_iterations: maxIterations,
      keyword_focus: keywordFocus.length ? keywordFocus : jobKeywords.slice(0, 12),
      missing_keywords: missingKeywords,
      coverage_report: {
        present: coverageReport.present.slice(0, 20),
        missing: coverageReport.missing.slice(0, 20),
        low_frequency: (coverageReport.low_frequency || []).slice(0, 20)
      },
      refinement_applied: false,
      score_report: null,
      iterations: [],
      rag_chunks: ragChunks.map((chunk) => ({ section: chunk.section, text: chunk.text, score: chunk.score })),
      tailored_resume: tailoredResume,
      best_resume: tailoredResume
    };
  }
  const iterationReports = [];
  let currentResume = tailoredResume;
  let bestResume = tailoredResume;
  let bestScoreReport = {
    ats_score: 0,
    missing_keywords: coverageReport.missing.map((item) => item.term).slice(0, 12),
    strengths: [],
    improvements: [],
    rationale: ""
  };
  for (let index = 0; index < maxIterations; index += 1) {
    let scoreReport = {
      ats_score: 0,
      missing_keywords: [],
      strengths: [],
      improvements: [],
      rationale: ""
    };
    try {
      const scoreRaw = await runChatGptJsonTask(buildScorePrompt({ jobDescription, tailoredResume: currentResume }), {
        retries: 0,
        timeoutMs: 120000
      });
      scoreReport = normalizeScoreReport(scoreRaw);
    } catch (_error) {
      scoreReport = {
        ...scoreReport,
        missing_keywords: coverageReport.missing.map((item) => item.term).slice(0, 12),
        improvements: ["Scoring fallback: prioritize missing coverage terms and ATS clarity."]
      };
    }
    iterationReports.push({
      iteration: index + 1,
      ats_score: scoreReport.ats_score,
      missing_keywords: scoreReport.missing_keywords,
      improvements: scoreReport.improvements,
      strengths: scoreReport.strengths,
      tailored_resume: currentResume
    });
    if (scoreReport.ats_score >= bestScoreReport.ats_score) {
      bestScoreReport = scoreReport;
      bestResume = currentResume;
    }
    if (scoreReport.ats_score >= targetScore || index === maxIterations - 1) {
      break;
    }
    const nextPrompt = buildIterationTailorPrompt({
      jobDescription,
      currentResume,
      scoreReport: {
        ...scoreReport,
        coverage_missing: coverageReport.missing.map((item) => item.term).slice(0, 12),
        coverage_low_frequency: (coverageReport.low_frequency || []).slice(0, 12).map((item) => ({
          term: item.term,
          resume_mentions: item.resume_mentions,
          target_mentions: item.target_mentions
        }))
      },
      targetJobTitle,
      priorityTerms,
      templateGuide,
      targetScore
    });
    try {
      const nextRaw = await runChatGptJsonTask(nextPrompt, { retries: 0, timeoutMs: 200000 });
      const nextResume = postProcessTailoredResume(nextRaw, resumeProfile, targetJobTitle);
      if (resumeHasContent(nextResume)) {
        currentResume = nextResume;
        coverageReport = evaluateKeywordCoverage(currentResume, priorityTerms);
      } else {
        break;
      }
    } catch (_error) {
      break;
    }
  }
  const missingKeywords = bestScoreReport.missing_keywords?.length
    ? bestScoreReport.missing_keywords.slice(0, 10)
    : [
        ...coverageReport.missing.map((item) => item.term),
        ...(coverageReport.low_frequency || []).map((item) => `${item.term} (underrepresented)`)
      ].slice(0, 10);
  const keywordFocus = priorityTerms.map((item) => item.term).slice(0, 12);
  return {
    ok: true,
    mode: maxIterations <= 1 ? "single_pass_targeted" : "iterative",
    prompt_strategy: "web-guided-ats-tailoring-v3-iterative",
    target_score: targetScore,
    max_iterations: maxIterations,
    best_ats_score: bestScoreReport.ats_score || 0,
    target_achieved: (bestScoreReport.ats_score || 0) >= targetScore,
    keyword_focus: keywordFocus.length ? keywordFocus : jobKeywords.slice(0, 12),
    missing_keywords: missingKeywords,
    coverage_report: {
      present: coverageReport.present.slice(0, 20),
      missing: coverageReport.missing.slice(0, 20),
      low_frequency: (coverageReport.low_frequency || []).slice(0, 20)
    },
    refinement_applied: refinementApplied,
    score_report: bestScoreReport,
    iterations: iterationReports,
    rag_chunks: ragChunks.map((chunk) => ({ section: chunk.section, text: chunk.text, score: chunk.score })),
    tailored_resume: bestResume,
    best_resume: bestResume
  };
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
    fetchRecentJobs(Math.max(1, Math.min(limit, 200)), {
      search: message.search || "",
      company: message.company || "",
      sort_by: message.sortBy || "",
      sort_order: message.sortOrder || ""
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "CREATE_JOB") {
    createJob(message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "UPDATE_JOB") {
    updateJob(String(message.jobId || ""), message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "DELETE_JOB") {
    deleteJob(String(message.jobId || ""))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "RUN_RESUME_TAILORING") {
    runResumeTailoring(message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  return true;
});
