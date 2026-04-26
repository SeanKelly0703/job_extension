const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const MAX_DESCRIPTION_LEN = 20000;
const CACHE_KEY = "detectedJobsByTab";
const CHATGPT_TAB_PATTERNS = ["*://chatgpt.com/*", "*://*.chatgpt.com/*"];
const MAX_RAG_CHUNKS = 8;
const MAX_PRIORITY_TERMS = 24;
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

function buildTermVariants(term) {
  const normalized = simplifyTerm(term);
  const variants = new Set([normalized, normalized.replace(/[/-]/g, " ")]);
  const mapped = ATS_TERM_VARIANTS[normalized];
  if (Array.isArray(mapped)) {
    mapped.forEach((value) => variants.add(simplifyTerm(value)));
  }
  return Array.from(variants).filter(Boolean);
}

function derivePriorityTerms({ jobDescription, targetJobTitle, checkerFeedback }) {
  const feedbackTerms = parseFeedbackTerms(checkerFeedback).filter(shouldKeepKeyword);
  const jdKeywords = extractJobKeywords(jobDescription).filter(shouldKeepKeyword).slice(0, 40);
  const ordered = [];
  function pushTerm(term, source, priority) {
    const normalized = simplifyTerm(term);
    if (!normalized || ordered.some((item) => item.term === normalized)) {
      return;
    }
    ordered.push({
      term: normalized,
      source,
      priority,
      variants: buildTermVariants(normalized)
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
    const matches = sections
      .filter(({ text }) => term.variants.some((variant) => variant && text.includes(variant)))
      .map(({ section }) => section);
    return {
      term: term.term,
      source: term.source,
      priority: term.priority,
      matched_sections: matches
    };
  });
  const present = coverage.filter((item) => item.matched_sections.length > 0);
  const missing = coverage.filter((item) => item.matched_sections.length === 0);
  return {
    present,
    missing,
    coverage
  };
}

function shouldRunCoverageRefinement(report) {
  const highPriorityMissing = report.missing.filter((item) => item.priority >= 70).length;
  return highPriorityMissing >= 2 || report.missing.length >= 6;
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
  priorityTerms
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
        sections: resumeProfile?.sections || {},
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
    priority: item.priority
  }));
  const prompt = [
    "You are a senior ATS resume strategist and recruiter.",
    "Tailor the resume to the job description in a SINGLE PASS using best-practice ATS optimization.",
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
    "- Ensure each major JD requirement is represented in summary, experience, projects, or skills when truthful.",
    "Coverage policy:",
    "- Ensure each priority keyword appears at least once across summary, experience, projects, or skills when truthful.",
    "- Put role-title alignment in headline/summary when possible.",
    "- Include an explicit Soft Skills section (`soft_skills`) derived from demonstrated behaviors in experience bullets.",
    "- Include an explicit Languages section (`languages`) for spoken and/or programming languages supported by evidence.",
    "- Use one consistent date format across experience/projects/education: `MMM YYYY - MMM YYYY` or `MMM YYYY - Present`.",
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
    '{"full_name":"","headline":"","summary":"","experience":[{"company":"","title":"","dates":"","location":"","bullets":[""]}],"projects":[{"name":"","dates":"","bullets":[""]}],"skills":[""],"soft_skills":[""],"languages":[""],"education":[{"school":"","degree":"","dates":"","details":""}]}',
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
  targetJobTitle,
  sectionOrder
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
    education: tailoredResume?.education || []
  };
  return [
    "You are an ATS resume optimizer doing a focused refinement pass.",
    "Revise the resume JSON to close missing high-impact ATS terms while preserving truthfulness and readability.",
    "Rules:",
    "- Keep all employers, dates, titles, education, and certifications truthful (no fabrication).",
    "- Keep bullets concise and action-oriented.",
    "- Integrate missing terms naturally across summary, skills, and relevant bullets.",
    "- Keep `soft_skills` and `languages` populated from evidence (do not invent unsupported fluency claims).",
    "- Keep all dates in one format: `MMM YYYY - MMM YYYY` or `MMM YYYY - Present`.",
    "- Keep parser-friendly wording and section compatibility.",
    "- Ensure headline/summary reflects the target role phrase when truthful.",
    "Return ONLY valid JSON with this schema (no markdown):",
    '{"full_name":"","headline":"","summary":"","experience":[{"company":"","title":"","dates":"","location":"","bullets":[""]}],"projects":[{"name":"","dates":"","bullets":[""]}],"skills":[""],"soft_skills":[""],"languages":[""],"education":[{"school":"","degree":"","dates":"","details":""}]}',
    "",
    "Current tailored resume JSON:",
    JSON.stringify(compactResume, null, 2),
    "",
    "Missing ATS terms to cover:",
    JSON.stringify(missingTerms, null, 2),
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
    education: tailoredResume?.education || []
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

function normalizeTailoredResume(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  function normalizeString(input) {
    return cleanText(input || "");
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
    return items.map((item) => ({
      company: normalizeString(item?.company),
      title: normalizeString(item?.title),
      dates: normalizeString(item?.dates),
      location: normalizeString(item?.location),
      bullets: normalizeStringArray(item?.bullets)
    }));
  }
  function normalizeProjects(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => ({
      name: normalizeString(item?.name),
      dates: normalizeDateRange(normalizeString(item?.dates)),
      bullets: normalizeStringArray(item?.bullets)
    }));
  }
  function normalizeEducation(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => ({
      school: normalizeString(item?.school),
      degree: normalizeString(item?.degree),
      dates: normalizeDateRange(normalizeString(item?.dates)),
      details: normalizeString(item?.details)
    }));
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
    education: normalizeEducation(value.education)
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
      (Array.isArray(value.education) && value.education.length)
  );
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
    priorityTerms
  });
  const tailoredRaw = await runChatGptJsonTask(tailorPrompt, { retries: 1, timeoutMs: 240000 });
  let tailoredResume = enforceTargetTitleAlignment(normalizeTailoredResume(tailoredRaw), targetJobTitle);
  if (!Array.isArray(tailoredResume.soft_skills) || !tailoredResume.soft_skills.length) {
    tailoredResume.soft_skills = deriveSoftSkillsFromEvidence(
      [
        tailoredResume.summary,
        ...(tailoredResume.experience || []).flatMap((item) => item.bullets || []),
        resumeProfile?.raw_text || ""
      ].join(" ")
    );
  }
  if (!Array.isArray(tailoredResume.languages) || !tailoredResume.languages.length) {
    tailoredResume.languages = deriveLanguagesFromEvidence(tailoredResume, resumeProfile);
  }
  if (!resumeHasContent(tailoredResume)) {
    throw new Error("Tailoring completed but returned no usable resume content. Try running again.");
  }
  let coverageReport = evaluateKeywordCoverage(tailoredResume, priorityTerms);
  let refinementApplied = false;
  if (shouldRunCoverageRefinement(coverageReport)) {
    const refinementPrompt = buildCoverageRefinementPrompt({
      jobDescription,
      tailoredResume,
      missingTerms: coverageReport.missing.slice(0, 10).map((item) => item.term),
      targetJobTitle,
      sectionOrder:
        templateGuide?.section_order && Array.isArray(templateGuide.section_order)
          ? templateGuide.section_order
          : resumeProfile?.template?.section_order || ["summary", "experience", "projects", "skills", "education"]
    });
    try {
      const refinedRaw = await runChatGptJsonTask(refinementPrompt, { retries: 0, timeoutMs: 180000 });
      const refinedResume = enforceTargetTitleAlignment(normalizeTailoredResume(refinedRaw), targetJobTitle);
      if (!Array.isArray(refinedResume.soft_skills) || !refinedResume.soft_skills.length) {
        refinedResume.soft_skills = deriveSoftSkillsFromEvidence(
          [refinedResume.summary, ...(refinedResume.experience || []).flatMap((item) => item.bullets || [])].join(" ")
        );
      }
      if (!Array.isArray(refinedResume.languages) || !refinedResume.languages.length) {
        refinedResume.languages = deriveLanguagesFromEvidence(refinedResume, resumeProfile);
      }
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
  const missingKeywords = coverageReport.missing.map((item) => item.term).slice(0, 10);
  const keywordFocus = priorityTerms.map((item) => item.term).slice(0, 12);
  return {
    ok: true,
    mode: "single_pass",
    prompt_strategy: "web-guided-ats-tailoring-v2-coverage",
    keyword_focus: keywordFocus.length ? keywordFocus : jobKeywords.slice(0, 12),
    missing_keywords: missingKeywords,
    coverage_report: {
      present: coverageReport.present.slice(0, 20),
      missing: coverageReport.missing.slice(0, 20)
    },
    refinement_applied: refinementApplied,
    rag_chunks: ragChunks.map((chunk) => ({ section: chunk.section, text: chunk.text, score: chunk.score })),
    tailored_resume: tailoredResume,
    best_resume: tailoredResume
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
    fetchRecentJobs(Math.max(1, Math.min(limit, 20)))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  if (message?.type === "RUN_RESUME_TAILORING") {
    runResumeTailoring(message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
  }

  return true;
});
