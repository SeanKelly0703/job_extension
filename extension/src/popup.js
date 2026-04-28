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
const tailorExportBtn = document.getElementById("tailorExportBtn");
const exportPreviewBtn = document.getElementById("exportPreviewBtn");
const tailorResultEl = document.getElementById("tailorResult");
const tailorPreviewEl = document.getElementById("tailorPreview");
const tailorPreviewFrameEl = document.getElementById("tailorPreviewFrame");
const jobsSearchInputEl = document.getElementById("jobsSearchInput");
const jobsCompanyFilterInputEl = document.getElementById("jobsCompanyFilterInput");
const jobsSortByEl = document.getElementById("jobsSortBy");
const jobsSortOrderEl = document.getElementById("jobsSortOrder");
const jobsFilterBtnEl = document.getElementById("jobsFilterBtn");
const jobsResetBtnEl = document.getElementById("jobsResetBtn");
const jobsAddBtnEl = document.getElementById("jobsAddBtn");
const jobTitleInputEl = document.getElementById("jobTitleInput");
const jobCompanyInputEl = document.getElementById("jobCompanyInput");
const jobLocationInputEl = document.getElementById("jobLocationInput");
const jobSalaryInputEl = document.getElementById("jobSalaryInput");
const jobsTableBodyEl = document.getElementById("jobsTableBody");
const jobsPrevPageBtnEl = document.getElementById("jobsPrevPageBtn");
const jobsNextPageBtnEl = document.getElementById("jobsNextPageBtn");
const jobsPageInfoEl = document.getElementById("jobsPageInfo");

let lastPayload = null;
let lastExtractedFacts = null;
let lastTailorResult = null;
let lastTailorTemplate = null;
let lastPreviewHtml = "";
let lastTemplateHtml = "";
let lastTemplateFallbackContact = {};
const THEME_KEY = "popupThemePreference";
const TEMPLATE_CANDIDATE_PATHS = [
  "template/template.html",
  "src/template/template.html"
];
const RESUME_STYLE_TUNING = {
  pagePadding: "8mm 10mm",
  bodyFontSizePx: 10,
  bodyLineHeight: 1.3,
  nameFontSizePx: 23,
  sectionHeaderFontSizePx: 14,
  sectionHeaderTopMarginPx: 12,
  sectionHeaderBottomMarginPx: 6,
  sectionDividerThicknessPx: 1,
  headlineFontSizePx: 17,
  headlineTopMarginPx: 4,
  headlineBottomMarginPx: 4,
  contactGapPx: 11,
  contactIconFontSizePx: 10,
  contactAddressBottomMarginPx: 7,
  entryBottomMarginPx: 9,
  entryTitleFontSizePx: 11,
  entryMetaFontSizePx: 10,
  bulletIndentPx: 9
};

function setStatus(message, type = "info") {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function updateCharCount() {
  if (!charCountEl) {
    return;
  }
  const count = (descriptionEl.value || "").trim().length;
  charCountEl.textContent = `${count} chars`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPhoneForDisplay(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const digits = text.replace(/[^\d+]/g, "");
  const localMatch = digits.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
  if (localMatch) {
    return `+63 ${localMatch[1]} ${localMatch[2]} ${localMatch[3]}`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (!factsPanelEl || !factJobTitleEl || !factCompanyEl || !factSalaryEl || !factLocationEl) {
    return;
  }
  const normalized = normalizeFacts(facts || {});
  factsPanelEl.style.display = "block";
  factJobTitleEl.textContent = normalized.job_title || "Not found";
  factCompanyEl.textContent = normalized.company || "Not found";
  factSalaryEl.textContent = normalized.salary || "Not found";
  factLocationEl.textContent = normalized.location || "Not found";
}

function normalizeArray(values) {
  return Array.isArray(values) ? values.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function loadResumeProfileFromJsonData(data) {
  const profileLines = normalizeArray(data?.profile);
  const experiences = Array.isArray(data?.["professional experience"]) ? data["professional experience"] : [];
  const experienceItems = experiences.flatMap((entry) => {
    const role = normalizeText(entry?.role);
    const company = normalizeText(entry?.["company name"]);
    const period = normalizeText(entry?.period);
    const header = [role, company, period].filter(Boolean).join(" | ");
    const bullets = normalizeArray(entry?.experience);
    return [header, ...bullets].filter(Boolean);
  });
  const projects = normalizeArray(data?.projects);
  const skillItems = normalizeArray(data?.skills);
  const educationItems = Array.isArray(data?.education)
    ? data.education
        .map((entry) =>
          [normalizeText(entry?.institution), normalizeText(entry?.degree), normalizeText(entry?.period)]
            .filter(Boolean)
            .join(" | ")
        )
        .filter(Boolean)
    : [];
  const certItems = normalizeArray(data?.certificates);
  const experienceRecords = experiences
    .map((entry) => ({
      company: normalizeText(entry?.["company name"]),
      title: normalizeText(entry?.role),
      dates: normalizeText(entry?.period),
      start_month: "",
      end_month: "",
      bullets: normalizeArray(entry?.experience)
    }))
    .filter((entry) => entry.company || entry.title || entry.dates || entry.bullets.length);
  const educationRecords = Array.isArray(data?.education)
    ? data.education
        .map((entry) => ({
          school: normalizeText(entry?.institution),
          degree: normalizeText(entry?.degree),
          dates: normalizeText(entry?.period),
          start_month: "",
          end_month: "",
          details: ""
        }))
        .filter((entry) => entry.school || entry.degree || entry.dates)
    : [];
  const fullName = normalizeText(data?.name || "Candidate");
  const headline = profileLines[0] || "";
  const contact = {
    email: normalizeText(data?.email),
    linkedin: normalizeText(data?.linkedin_address || data?.linkedin),
    github: normalizeText(data?.github || data?.github_url),
    portfolio: normalizeText(data?.portfolio || data?.portfolio_url || data?.website),
    phone: normalizeText(data?.phone || data?.phone_number || data?.mobile || data?.contact_number),
    address: normalizeText(data?.address)
  };
  const webPresence = [contact.linkedin, contact.github, contact.portfolio].filter(Boolean);
  const sections = {
    summary: profileLines,
    experience: experienceItems,
    projects,
    skills: skillItems,
    web_presence: webPresence,
    education: educationItems,
    certifications: certItems
  };
  const rawText = Object.values(sections)
    .flat()
    .filter(Boolean)
    .join("\n");
  return {
    full_name: fullName,
    headline,
    contact,
    raw_text: rawText,
    sections,
    experience_records: experienceRecords,
    education_records: educationRecords,
    web_presence: webPresence,
    certifications: certItems,
    template: {
      section_order: ["summary", "experience", "projects", "skills", "web_presence", "education", "certifications"],
      has_summary: sections.summary.length > 0,
      font_family: "Segoe UI"
    }
  };
}

async function loadResumeProfileFromProjectJson() {
  const url = chrome.runtime.getURL("src/resume.json");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load extension/src/resume.json.");
  }
  const data = await response.json();
  return loadResumeProfileFromJsonData(data);
}

async function loadTemplateHtmlFromExtension() {
  for (const path of TEMPLATE_CANDIDATE_PATHS) {
    try {
      const url = chrome.runtime.getURL(path);
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return await response.text();
      }
    } catch (_error) {
      // Try next path.
    }
  }
  return "";
}

function decodeBasicHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function cleanTemplateToText(templateHtml) {
  const withoutAssets = String(templateHtml || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/data:[^"')\s]+/gi, " ");
  const textOnly = withoutAssets.replace(/<[^>]+>/g, " ");
  return normalizeText(decodeBasicHtmlEntities(textOnly));
}

function deriveSectionOrderFromTemplateText(templateText) {
  const normalized = String(templateText || "").toLowerCase();
  const sectionSignals = [
    { key: "summary", patterns: ["summary", "profile", "professional summary"] },
    { key: "experience", patterns: ["experience", "work experience", "professional experience"] },
    { key: "projects", patterns: ["projects", "project experience"] },
    { key: "skills", patterns: ["skills", "technical skills", "core skills"] },
    { key: "education", patterns: ["education", "academic", "certifications", "certificates"] }
  ];
  const hits = [];
  for (const signal of sectionSignals) {
    let firstIndex = -1;
    for (const pattern of signal.patterns) {
      const idx = normalized.indexOf(pattern);
      if (idx >= 0 && (firstIndex === -1 || idx < firstIndex)) {
        firstIndex = idx;
      }
    }
    if (firstIndex >= 0) {
      hits.push({ key: signal.key, idx: firstIndex });
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  const ordered = hits.map((item) => item.key);
  const fallback = ["summary", "experience", "projects", "skills", "education"];
  fallback.forEach((key) => {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  });
  return ordered;
}

function buildTemplateGuide(templateHtml) {
  const templateText = cleanTemplateToText(templateHtml);
  const sectionOrder = deriveSectionOrderFromTemplateText(templateText);
  return {
    section_order: sectionOrder,
    has_summary: sectionOrder.includes("summary"),
    template_excerpt: templateText.slice(0, 2500)
  };
}

function extractContactFallbackFromTemplate(templateHtml) {
  const html = String(templateHtml || "");
  const emailMatch = html.match(/mailto:([^"'>\s]+)/i);
  const linkedinMatch = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^"'>\s]+/i);
  const phoneMatch = html.match(/tel:([^"'>\s]+)/i);
  return {
    email: normalizeText(emailMatch?.[1] || ""),
    linkedin: normalizeText(linkedinMatch?.[0] || ""),
    phone: normalizeText((phoneMatch?.[1] || "").replace(/\+/g, "+").replace(/%20/g, " ")),
    address: ""
  };
}

async function loadTemplateGuideFromProjectTemplate() {
  const templateHtml = await loadTemplateHtmlFromExtension();
  if (!templateHtml) {
    throw new Error("Template file not found. Put template.html under extension/template/.");
  }
  return buildTemplateGuide(templateHtml);
}

function renderTailorResult(result) {
  if (!tailorResultEl) {
    return;
  }
  if (!result) {
    tailorResultEl.classList.add("muted");
    tailorResultEl.textContent = "No resume tailoring run yet.";
    return;
  }
  tailorResultEl.classList.remove("muted");
  const matched = Array.isArray(result.keyword_focus) ? result.keyword_focus.slice(0, 8) : [];
  const missing = Array.isArray(result.missing_keywords) ? result.missing_keywords.slice(0, 6) : [];
  const bestAtsScore = Number(result.best_ats_score);
  const targetScore = Number(result.target_score);
  const iterationCount = Array.isArray(result.iterations) ? result.iterations.length : 0;
  tailorResultEl.innerHTML = `
    <div class="tailor-kv">
      <strong>Mode</strong><span>${escapeHtml(result.mode || "single_pass")}</span>
      <strong>Prompt</strong><span>${escapeHtml(result.prompt_strategy || "ATS-optimized single prompt")}</span>
    </div>
    <div style="margin-top:6px;"><strong>ATS score:</strong> ${Number.isFinite(bestAtsScore) ? bestAtsScore : "N/A"}${Number.isFinite(targetScore) ? ` / target ${targetScore}` : ""}</div>
    <div style="margin-top:6px;"><strong>Iterations:</strong> ${iterationCount || "1"}</div>
    <div style="margin-top:6px;"><strong>Keyword focus:</strong> ${escapeHtml(matched.join(", ") || "Not available")}</div>
    <div style="margin-top:6px;"><strong>Missing requirements:</strong> ${escapeHtml(missing.join(", ") || "None detected")}</div>
  `;
}

function buildResumeBody(tailoredResume, sourceTemplate) {
  const resume = tailoredResume || {};
  const template = sourceTemplate || {};
  const style = RESUME_STYLE_TUNING;
  const fontFamily = escapeHtml(
    template.font_family || '"Bodoni MT", Didot, "Garamond", "Times New Roman", serif'
  );
  const contact = resume.contact || {};
  const webPresenceValues = Array.isArray(resume.web_presence) ? resume.web_presence : [];
  const normalizedWebPresence = webPresenceValues.map((item) => normalizeText(item)).filter(Boolean);
  const contactItemsHtml = [
    normalizeText(contact.phone)
      ? `<span class="contact-item"><span class="contact-icon">☎</span><span>${escapeHtml(formatPhoneForDisplay(contact.phone))}</span></span>`
      : "",
    normalizeText(contact.email)
      ? `<span class="contact-item"><span class="contact-icon">@</span><span>${escapeHtml(normalizeText(contact.email))}</span></span>`
      : "",
    normalizeText(contact.linkedin)
      ? `<span class="contact-item"><span class="contact-icon">🔗</span><span>${escapeHtml(normalizeText(contact.linkedin))}</span></span>`
      : ""
  ].filter(Boolean).join("");
  const contactAddress = normalizeText(contact.address);
  const expHtml = (resume.experience || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.company || item.title || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", item.location || "")}</div>
        </div>
        ${item.title && item.company ? `<div class="entry-subtitle">${escapeHtml(item.title)}</div>` : ""}
        <ul>${(item.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
  const projectHtml = (resume.projects || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.name || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", "")}</div>
        </div>
        <ul>${(item.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
  const educationHtml = (resume.education || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.school || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", "")}</div>
        </div>
        ${item.degree ? `<div class="entry-subtitle">${escapeHtml(item.degree)}</div>` : ""}
        ${item.details ? `<div>${escapeHtml(item.details)}</div>` : ""}
      </div>`
    )
    .join("");
  const certificationsHtml = (resume.certifications || [])
    .map((item) => `<div class="entry"><div>${escapeHtml(item)}</div></div>`)
    .join("");
  const profileHtml = resume.summary ? `<p>${escapeHtml(resume.summary)}</p>` : "";
  const skillsHtml = (resume.skills || [])
    .map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`)
    .join("");
  const softSkillsHtml = (resume.soft_skills || [])
    .map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`)
    .join("");
  const languagesHtml = (resume.languages || [])
    .map((item) => `<span class="skill">${escapeHtml(item)}</span>`)
    .join("");
  const webPresenceHtml = normalizedWebPresence
    .map((url) => `<div class="entry"><div>${escapeHtml(url)}</div></div>`)
    .join("");
  return `
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: ${fontFamily}; color: #111; margin: 0; font-size: ${style.bodyFontSizePx}px; line-height: ${style.bodyLineHeight}; background: #fff; }
    .resume-root { max-width: 860px; margin: 0 auto; padding: ${style.pagePadding}; }
    h1 { margin: 0; font-size: ${style.nameFontSizePx}px; line-height: 1; font-weight: 700; text-align: left; color: #0c84d7; }
    h2 { margin: ${style.sectionHeaderTopMarginPx}px 0 ${style.sectionHeaderBottomMarginPx}px; font-size: ${style.sectionHeaderFontSizePx}px; font-weight: 700; border-bottom: ${style.sectionDividerThicknessPx}px solid #222; text-transform: uppercase; letter-spacing: 0; line-height: 1.05; }
    .headline { margin: ${style.headlineTopMarginPx}px 0 ${style.headlineBottomMarginPx}px; color: #0c84d7; text-align: left; font-style: normal; font-size: ${style.headlineFontSizePx}px; line-height: 1.1; font-weight: 700; }
    .contact-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 3px; font-size: ${style.bodyFontSizePx}px; line-height: 1.35; }
    .contact-line { margin-bottom: 2px; }
    .contact-item { display: inline-flex; align-items: center; gap: 4px; }
    .contact-icon { color: #0c84d7; font-weight: 700; font-size: ${style.contactIconFontSizePx}px; }
    .contact-address { text-align: left; margin-bottom: ${style.contactAddressBottomMarginPx}px; font-size: ${style.bodyFontSizePx}px; }
    .entry { margin-bottom: ${style.entryBottomMarginPx}px; page-break-inside: avoid; }
    .entry-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .entry-title { font-weight: 700; font-size: ${style.entryTitleFontSizePx}px; line-height: 1.1; color: #0c84d7; }
    .entry-subtitle { font-size: ${style.entryMetaFontSizePx}px; font-weight: 600; color: #202020; margin-top: 1px; }
    .entry-meta { color: #2f2f2f; font-size: ${style.entryMetaFontSizePx}px; white-space: nowrap; line-height: 1.1; display: inline-flex; gap: 10px; }
    .meta-item { display: inline-flex; align-items: center; gap: 3px; }
    .meta-icon { color: #0c84d7; font-size: ${style.entryMetaFontSizePx}px; }
    ul { margin: 4px 0 0 ${style.bulletIndentPx}px; padding: 0; }
    li { margin-bottom: 3px; line-height: 1.28; }
    p { margin: 0 0 5px; line-height: 1.28; }
    .section-block { margin-top: 0; margin-bottom: 4px; }
    .summary-block { line-height: 1.3; margin-bottom: 3px; }
    .skills { display: block; }
    .skill { display: inline; border: 0; border-radius: 0; padding: 0; font-size: 11px; line-height: 1.32; }
    .skill:not(:last-child)::after { content: ", "; }
    #tailored-resume-root p, #tailored-resume-root div, #tailored-resume-root li { text-align: left; }
  </style>
  <div id="tailored-resume-root" class="resume-root">
    <h1>${escapeHtml(resume.full_name || "Candidate Name")}</h1>
    ${resume.headline ? `<div class="headline">${escapeHtml(resume.headline)}</div>` : ""}
    ${contactItemsHtml ? `<div class="contact-row">${contactItemsHtml}</div>` : ""}
    ${contactAddress ? `<div class="contact-address"><span class="contact-icon">📍</span> ${escapeHtml(contactAddress)}</div>` : ""}
    ${resume.summary ? `<h2>Profile</h2><div class="summary-block">${profileHtml}</div>` : ""}
    ${expHtml ? `<h2>Professional Experience</h2><div class="section-block">${expHtml}</div>` : ""}
    ${projectHtml ? `<h2>Projects</h2><div class="section-block">${projectHtml}</div>` : ""}
    ${(resume.skills || []).length ? `<h2>Skills</h2><div class="skills section-block">${skillsHtml}</div>` : ""}
    ${(resume.soft_skills || []).length ? `<h2>Soft Skills</h2><div class="skills section-block">${softSkillsHtml}</div>` : ""}
    ${(resume.languages || []).length ? `<h2>Languages</h2><div class="skills section-block">${languagesHtml}</div>` : ""}
    ${webPresenceHtml ? `<h2>Web Presence</h2><div class="section-block">${webPresenceHtml}</div>` : ""}
    ${educationHtml ? `<h2>Education</h2><div class="section-block">${educationHtml}</div>` : ""}
    ${certificationsHtml ? `<h2>Certifications</h2><div class="section-block">${certificationsHtml}</div>` : ""}
  </div>`;
}

function buildProfileSectionHtml(resume) {
  const summary = normalizeText(resume?.summary);
  return summary ? `<p>${escapeHtml(summary)}</p>` : "";
}

function formatConsistentDateRange(value) {
  const text = normalizeText(value);
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
    const partText = normalizeText(part).replace(/\./g, "");
    if (!partText) {
      return "";
    }
    if (/^(present|current|now)$/i.test(partText)) {
      return "Present";
    }
    const monthYear = partText.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
    if (monthYear) {
      const month = monthYear[1].slice(0, 3);
      return `${month.charAt(0).toUpperCase()}${month.slice(1).toLowerCase()} ${monthYear[2]}`;
    }
    const slashYear = partText.match(/^(\d{1,2})[\/-](\d{4})$/);
    if (slashYear) {
      const monthIndex = Number(slashYear[1]) - 1;
      if (monthIndex >= 0 && monthIndex < monthNames.length) {
        return `${monthNames[monthIndex]} ${slashYear[2]}`;
      }
    }
    const yearOnly = partText.match(/^(\d{4})$/);
    if (yearOnly) {
      return yearOnly[1];
    }
    return partText;
  };
  const parts = normalized.split(" - ").map((part) => normalizePart(part)).filter(Boolean);
  if (!parts.length) {
    return normalized;
  }
  return parts.join(" - ");
}

function buildEntryMetaHtml(dates, location = "") {
  const dateText = formatConsistentDateRange(dates || "");
  const locationText = normalizeText(location || "");
  if (!dateText && !locationText) {
    return "";
  }
  return `
    ${dateText ? `<span class="meta-item"><span class="meta-icon">🗓</span>${escapeHtml(dateText)}</span>` : ""}
    ${locationText ? `<span class="meta-item"><span class="meta-icon">📍</span>${escapeHtml(locationText)}</span>` : ""}
  `;
}

function buildExperienceSectionHtml(resume) {
  return (resume?.experience || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.company || item.title || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", item.location || "")}</div>
        </div>
        ${item.title && item.company ? `<div class="entry-subtitle">${escapeHtml(item.title)}</div>` : ""}
        <ul>${(item.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
}

function buildProjectsSectionHtml(resume) {
  return (resume?.projects || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.name || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", "")}</div>
        </div>
        <ul>${(item.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
}

function buildSkillsSectionHtml(resume) {
  return (resume?.skills || []).map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("");
}

function buildSoftSkillsSectionHtml(resume) {
  const values = Array.isArray(resume?.soft_skills) ? resume.soft_skills : [];
  return values.map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("");
}

function buildLanguagesSectionHtml(resume) {
  const values = Array.isArray(resume?.languages) ? resume.languages : [];
  return values.map((lang) => `<span class="skill">${escapeHtml(lang)}</span>`).join("");
}

function buildWebPresenceSectionHtml(resume) {
  const values = Array.isArray(resume?.web_presence) ? resume.web_presence : [];
  return values.map((item) => `<div class="entry"><div>${escapeHtml(item)}</div></div>`).join("");
}

function buildCertificationsSectionHtml(resume) {
  const values = Array.isArray(resume?.certifications) ? resume.certifications : [];
  return values.map((item) => `<div class="entry"><div>${escapeHtml(item)}</div></div>`).join("");
}

function buildEducationSectionHtml(resume) {
  return (resume?.education || [])
    .map(
      (item) => `
      <div class="entry">
        <div class="entry-head">
          <div class="entry-title">${escapeHtml(item.school || "")}</div>
          <div class="entry-meta">${buildEntryMetaHtml(item.dates || "", "")}</div>
        </div>
        ${item.degree ? `<div class="entry-subtitle">${escapeHtml(item.degree)}</div>` : ""}
        ${item.details ? `<div>${escapeHtml(item.details)}</div>` : ""}
      </div>`
    )
    .join("");
}

function extractTemplateStyleBlocks(templateHtml) {
  const html = String(templateHtml || "");
  const styleBlocks = html.match(/<style[\s\S]*?<\/style>/gi) || [];
  return styleBlocks.join("\n");
}

function normalizeTemplateLine(value) {
  return normalizeText(String(value || "").replace(/\s+/g, " "));
}

function wrapTextLines(text, maxLen = 110) {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLen && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) {
    lines.push(line);
  }
  return lines;
}

function fitLineToCapacity(line, capacity) {
  const text = normalizeTemplateLine(line);
  const cap = Math.max(8, Number(capacity) || 8);
  if (!text) {
    return { fitted: "", rest: "" };
  }
  if (text.length <= cap) {
    return { fitted: text, rest: "" };
  }
  let cut = cap;
  const boundary = text.lastIndexOf(" ", cap);
  if (boundary > Math.floor(cap * 0.82)) {
    cut = boundary;
  }
  return {
    fitted: text.slice(0, cut).trim(),
    rest: text.slice(cut).trim()
  };
}

function compactLineForTemplate(line) {
  let text = normalizeTemplateLine(line);
  if (!text) {
    return "";
  }
  // Keep content compact without dropping useful words.
  text = text
    .replace(/\s{2,}/g, " ")
    .trim();
  return text;
}

function packSourceLinesToTemplateSlots(sourceLines, capacities, safetyFactor = 0.72, minCapacity = 0) {
  const queue = (sourceLines || []).map((line) => compactLineForTemplate(line));
  const out = [];
  for (let i = 0; i < capacities.length; i += 1) {
    const cap = Math.max(8, minCapacity, Math.floor((capacities[i] || 12) * safetyFactor));
    if (!queue.length) {
      out.push("");
      continue;
    }
    if (!queue[0]) {
      out.push("");
      queue.shift();
      continue;
    }
    const { fitted, rest } = fitLineToCapacity(queue[0], cap);
    out.push(fitted);
    if (rest) {
      queue[0] = rest;
    } else {
      queue.shift();
    }
  }
  if (queue.length) {
    // Mark truncation to avoid visual overflow while keeping layout stable.
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i]) {
        const text = out[i].replace(/\s+$/g, "");
        out[i] = text.endsWith("...") ? text : `${text} ...`;
        break;
      }
    }
  }
  return out;
}

function setSectionLines(textNodes, startIdx, endIdx, lines) {
  if (startIdx < 0 || endIdx < startIdx) {
    return;
  }
  let cursor = 0;
  for (let i = startIdx; i <= endIdx; i += 1) {
    textNodes[i].textContent = lines[cursor] || "";
    cursor += 1;
  }
}

function isUsableTemplateSlot(line) {
  const value = normalizeTemplateLine(line);
  if (!value) {
    return false;
  }
  if (/^[•·\-_=+|:;.,()\/\\]+$/.test(value)) {
    return false;
  }
  if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]$/u.test(value)) {
    return false;
  }
  const alphaNumCount = (value.match(/[A-Za-z0-9]/g) || []).length;
  if (alphaNumCount < 2) {
    return false;
  }
  return true;
}

function getXClass(node) {
  const classes = Array.from(node.classList || []);
  return classes.find((cls) => /^x[0-9a-f]+$/i.test(cls)) || "";
}

function clearSectionTextNodes(textNodes, startIdx, endIdx) {
  for (let i = startIdx; i <= endIdx; i += 1) {
    textNodes[i].textContent = "";
  }
}

function fillSectionUsingTemplateSlots({
  textNodes,
  lineValues,
  startIdx,
  endIdx,
  sourceLines,
  safetyFactor,
  preferredXClass = "",
  preferredXClasses = [],
  minCapacity = 0,
  clearBefore = true
}) {
  if (startIdx < 0 || endIdx < startIdx) {
    return;
  }
  if (clearBefore) {
    clearSectionTextNodes(textNodes, startIdx, endIdx);
  }
  const slotIndices = [];
  const capacities = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const xClass = getXClass(textNodes[i]);
    if (preferredXClasses.length) {
      if (!preferredXClasses.includes(xClass)) {
        continue;
      }
    } else if (preferredXClass) {
      if (xClass !== preferredXClass) {
        continue;
      }
    }
    if (!isUsableTemplateSlot(lineValues[i])) {
      continue;
    }
    slotIndices.push(i);
    capacities.push(Math.max(12, lineValues[i].length));
  }
  const packed = packSourceLinesToTemplateSlots(sourceLines, capacities, safetyFactor, minCapacity);
  for (let i = 0; i < slotIndices.length; i += 1) {
    textNodes[slotIndices[i]].textContent = packed[i] || "";
  }
}

function stripTemplateIconResidues(textNodes) {
  textNodes.forEach((node) => {
    const text = String(node.textContent || "");
    const normalized = normalizeTemplateLine(text);
    const hasAlphaNum = /[A-Za-z0-9]/.test(normalized);
    const isTiny = normalized.length <= 3;
    const hasIconLike = /[\u2000-\u2BFF\uE000-\uF8FF]/u.test(text);
    if (isTiny && !hasAlphaNum && hasIconLike) {
      node.textContent = "";
    }
  });
}

function buildExperienceLinesForTemplate(resume) {
  const lines = [];
  const entries = (resume?.experience || []).slice(0, 4);
  entries.forEach((entry) => {
    const roleLine = [normalizeText(entry?.title), normalizeText(entry?.company)].filter(Boolean).join(", ");
    if (roleLine) {
      lines.push(roleLine);
    }
    (entry?.bullets || []).forEach((bullet) => {
      wrapTextLines(`• ${bullet}`, 118).forEach((line) => lines.push(line));
    });
    lines.push("");
  });
  return lines.slice(0, 200);
}

function buildExperienceMetaLinesForTemplate(resume) {
  const lines = [];
  const entries = (resume?.experience || []).slice(0, 4);
  entries.forEach((entry) => {
    const dates = normalizeText(entry?.dates);
    const location = normalizeText(entry?.location);
    const metaLine = [dates, location].filter(Boolean).join(" | ");
    if (metaLine) {
      lines.push(metaLine);
    } else {
      lines.push("");
    }
    // Add spacer lines so subsequent entry meta lands lower.
    lines.push("");
    lines.push("");
    lines.push("");
  });
  return lines.slice(0, 60);
}

function buildSkillsLinesForTemplate(resume) {
  const lines = [];
  (resume?.skills || []).slice(0, 12).forEach((skillLine) => {
    wrapTextLines(skillLine, 108).forEach((line) => lines.push(line));
  });
  return lines.slice(0, 80);
}

function buildEducationLinesForTemplate(resume) {
  const lines = [];
  (resume?.education || []).slice(0, 4).forEach((item) => {
    const top = [normalizeText(item?.school), normalizeText(item?.degree)].filter(Boolean).join(", ");
    const meta = normalizeText(item?.dates);
    const details = normalizeText(item?.details);
    if (top) {
      lines.push(top);
    }
    if (meta) {
      lines.push(meta);
    }
    if (details) {
      wrapTextLines(details, 110).forEach((line) => lines.push(line));
    }
    lines.push("");
  });
  return lines.slice(0, 40);
}

function applyExactTemplateContentSwap(templateHtml, resume) {
  if (!templateHtml) {
    return "";
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(templateHtml, "text/html");
    const textNodes = Array.from(doc.querySelectorAll("#page-container .t"));
    if (!textNodes.length) {
      return "";
    }
    const lineValues = textNodes.map((node) => normalizeTemplateLine(node.textContent));
    const findLineIndex = (needle) =>
      lineValues.findIndex((line) => line.replace(/\s+/g, "").toUpperCase().includes(needle.replace(/\s+/g, "").toUpperCase()));

    const idxProfile = findLineIndex("PROFILE");
    const idxProfessional = findLineIndex("PROFESSIONALEXPERIENCE");
    const idxSkills = findLineIndex("SKILLS");
    const idxEducation = findLineIndex("EDUCATION");
    const idxCertificates = findLineIndex("CERTIFICATES");

    if (idxProfile <= 0) {
      return "";
    }

    const contact = resume?.contact || {};
    const nameNode = textNodes[0];
    const headlineNode = textNodes[1];
    if (nameNode) {
      nameNode.textContent = resume?.full_name || nameNode.textContent;
    }
    if (headlineNode) {
      headlineNode.textContent = resume?.headline || headlineNode.textContent;
    }

    // template1.html header order (pdf2htmlEX) is stable: [name, headline, email, spacer, linkedin, spacer, phone, spacer, address]
    const emailNode = textNodes[2] || null;
    const linkedinNode = textNodes[4] || null;
    const phoneNode = textNodes[6] || null;
    const addressNode = textNodes[8] || null;
    if (emailNode && contact.email) {
      emailNode.textContent = contact.email;
    }
    if (linkedinNode && contact.linkedin) {
      linkedinNode.textContent = contact.linkedin.replace(/^https?:\/\//i, "");
    }
    if (phoneNode && contact.phone) {
      phoneNode.textContent = contact.phone;
    }
    if (addressNode && contact.address) {
      addressNode.textContent = contact.address;
    }

    const mailtoAnchor = doc.querySelector("a[href^='mailto:']");
    if (mailtoAnchor && contact.email) {
      mailtoAnchor.setAttribute("href", `mailto:${contact.email}`);
    }
    const linkedinAnchor = doc.querySelector("a[href*='linkedin.com/in/']");
    if (linkedinAnchor && contact.linkedin) {
      linkedinAnchor.setAttribute("href", contact.linkedin);
    }
    const phoneAnchor = doc.querySelector("a[href^='tel:']");
    if (phoneAnchor && contact.phone) {
      phoneAnchor.setAttribute("href", `tel:${contact.phone}`);
    }

    if (idxProfile >= 0 && idxProfessional > idxProfile) {
      fillSectionUsingTemplateSlots({
        textNodes,
        lineValues,
        startIdx: idxProfile + 1,
        endIdx: idxProfessional - 1,
        sourceLines: wrapTextLines(resume?.summary || "", 200),
        safetyFactor: 0.9,
        preferredXClass: "xb",
        minCapacity: 95
      });
    }
    if (idxProfessional >= 0 && idxSkills > idxProfessional) {
      fillSectionUsingTemplateSlots({
        textNodes,
        lineValues,
        startIdx: idxProfessional + 1,
        endIdx: idxSkills - 1,
        sourceLines: buildExperienceLinesForTemplate(resume),
        safetyFactor: 0.88,
        preferredXClass: "xb",
        minCapacity: 92,
        clearBefore: true
      });
      fillSectionUsingTemplateSlots({
        textNodes,
        lineValues,
        startIdx: idxProfessional + 1,
        endIdx: idxSkills - 1,
        sourceLines: buildExperienceMetaLinesForTemplate(resume),
        safetyFactor: 0.9,
        preferredXClasses: ["xc", "xd", "xe", "xf", "x10", "x11"],
        minCapacity: 28,
        clearBefore: false
      });
    }
    if (idxSkills >= 0 && idxEducation > idxSkills) {
      fillSectionUsingTemplateSlots({
        textNodes,
        lineValues,
        startIdx: idxSkills + 1,
        endIdx: idxEducation - 1,
        sourceLines: buildSkillsLinesForTemplate(resume),
        safetyFactor: 0.86,
        preferredXClass: "xb",
        minCapacity: 88
      });
    }
    if (idxEducation >= 0 && idxCertificates > idxEducation) {
      fillSectionUsingTemplateSlots({
        textNodes,
        lineValues,
        startIdx: idxEducation + 1,
        endIdx: idxCertificates - 1,
        sourceLines: buildEducationLinesForTemplate(resume),
        safetyFactor: 0.88,
        preferredXClass: "xb",
        minCapacity: 90
      });
    }

    stripTemplateIconResidues(textNodes);

    const safeTextStyle = doc.createElement("style");
    safeTextStyle.textContent =
      "#page-container .t.xb.ff3{ text-align: left !important; white-space: pre !important; }";
    doc.head.appendChild(safeTextStyle);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch (_error) {
    return "";
  }
}

function applyOriginalTemplateContentSwap(templateHtml, resume) {
  if (!templateHtml) {
    return "";
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(templateHtml, "text/html");
    if (!doc.querySelector("main.page .resume-header")) {
      return "";
    }
    const fullName = normalizeText(resume?.full_name || "Candidate Name");
    const headline = normalizeText(resume?.headline || "");
    const summary = normalizeText(resume?.summary || "");
    const contact = resume?.contact || {};
    const nameEl = doc.querySelector(".resume-header .name");
    const headlineEl = doc.querySelector(".resume-header .headline");
    if (nameEl) {
      nameEl.textContent = fullName;
    }
    if (headlineEl) {
      headlineEl.textContent = headline;
    }
    const contactList = doc.querySelector(".resume-header .contact-list");
    if (contactList) {
      contactList.innerHTML = "";
      const entries = [
        { icon: "✉", text: normalizeText(contact.email), href: contact.email ? `mailto:${normalizeText(contact.email)}` : "" },
        {
          icon: "in",
          iconClass: "linkedin-icon",
          text: normalizeText(contact.linkedin).replace(/^https?:\/\//i, ""),
          href: normalizeText(contact.linkedin)
        },
        {
          icon: "☎",
          text: formatPhoneForDisplay(contact.phone),
          href: normalizeText(contact.phone) ? `tel:${normalizeText(contact.phone)}` : ""
        },
        { icon: "📍", text: normalizeText(contact.address), href: "" }
      ];
      entries.forEach((entry) => {
        if (!entry.text) {
          return;
        }
        const li = doc.createElement("li");
        const icon = doc.createElement("span");
        icon.className = `contact-icon${entry.iconClass ? ` ${entry.iconClass}` : ""}`;
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = entry.icon;
        li.appendChild(icon);
        if (entry.href) {
          const a = doc.createElement("a");
          a.setAttribute("href", entry.href);
          a.textContent = entry.text;
          li.appendChild(a);
        } else {
          const span = doc.createElement("span");
          span.textContent = entry.text;
          li.appendChild(span);
        }
        contactList.appendChild(li);
      });
    }
    const profileSection = doc.querySelector("section[aria-labelledby='profile-title']");
    if (profileSection) {
      profileSection.querySelectorAll(".profile-text").forEach((node) => node.remove());
      if (summary) {
        const p = doc.createElement("p");
        p.className = "profile-text";
        p.textContent = summary;
        profileSection.appendChild(p);
      }
    }
    const experienceList = doc.querySelector(".experience-list");
    if (experienceList) {
      experienceList.innerHTML = "";
      (resume?.experience || []).forEach((item) => {
        const article = doc.createElement("article");
        article.className = "role";
        const heading = doc.createElement("div");
        heading.className = "role-heading";
        const titleWrap = doc.createElement("div");
        titleWrap.className = "role-title";
        titleWrap.textContent = normalizeText(item?.title || "");
        if (normalizeText(item?.company)) {
          const companyEl = doc.createElement("span");
          companyEl.className = "company";
          companyEl.textContent = `, ${normalizeText(item.company)}`;
          titleWrap.appendChild(companyEl);
        }
        const meta = doc.createElement("div");
        meta.className = "role-meta";
        const metaParts = [formatConsistentDateRange(item?.dates || ""), normalizeText(item?.location || "")].filter(Boolean);
        meta.textContent = metaParts.join(" | ");
        heading.appendChild(titleWrap);
        heading.appendChild(meta);
        article.appendChild(heading);
        const bullets = Array.isArray(item?.bullets) ? item.bullets : [];
        if (bullets.length) {
          const ul = doc.createElement("ul");
          ul.className = "bullet-list";
          bullets.forEach((bullet) => {
            const li = doc.createElement("li");
            li.textContent = normalizeText(bullet);
            ul.appendChild(li);
          });
          article.appendChild(ul);
        }
        experienceList.appendChild(article);
      });
    }
    const skillsList = doc.querySelector(".skills-list");
    if (skillsList) {
      skillsList.innerHTML = "";
      const skillLines = Array.isArray(resume?.skills) ? resume.skills : [];
      skillLines.forEach((line) => {
        const text = normalizeText(line);
        if (!text) {
          return;
        }
        const group = doc.createElement("div");
        group.className = "skill-group";
        const title = doc.createElement("h3");
        title.className = "skill-title";
        const items = doc.createElement("p");
        items.className = "skill-items";
        const splitAt = text.indexOf(":");
        if (splitAt > 0) {
          title.textContent = text.slice(0, splitAt).trim();
          items.textContent = text.slice(splitAt + 1).trim();
        } else {
          title.textContent = "Core Skills";
          items.textContent = text;
        }
        group.appendChild(title);
        group.appendChild(items);
        skillsList.appendChild(group);
      });
    }
    const educationSection = doc.querySelector("section[aria-labelledby='education-title']");
    if (educationSection) {
      educationSection.querySelectorAll(".education-card, .thesis").forEach((node) => node.remove());
      (resume?.education || []).forEach((item, index) => {
        const card = doc.createElement("div");
        card.className = "education-card";
        const left = doc.createElement("div");
        const school = doc.createElement("span");
        school.className = "education-school";
        school.textContent = normalizeText(item?.school || "");
        left.appendChild(school);
        if (normalizeText(item?.degree)) {
          const degree = doc.createElement("span");
          degree.textContent = `, ${normalizeText(item.degree)}`;
          left.appendChild(degree);
        }
        const right = doc.createElement("div");
        right.className = "education-meta";
        right.textContent = formatConsistentDateRange(item?.dates || "");
        card.appendChild(left);
        card.appendChild(right);
        educationSection.appendChild(card);
        if (normalizeText(item?.details) && index === 0) {
          const thesis = doc.createElement("p");
          thesis.className = "thesis";
          thesis.textContent = normalizeText(item.details);
          educationSection.appendChild(thesis);
        }
      });
    }
    const certSection = doc.querySelector("section[aria-labelledby='certificates-title']");
    if (certSection) {
      let certList = certSection.querySelector(".cert-list");
      if (!certList) {
        certList = doc.createElement("ul");
        certList.className = "cert-list";
        certSection.appendChild(certList);
      }
      certList.innerHTML = "";
      (resume?.certifications || []).forEach((item) => {
        const li = doc.createElement("li");
        li.textContent = normalizeText(item);
        certList.appendChild(li);
      });
    }
    const scriptData = doc.getElementById("resume-data");
    if (scriptData) {
      scriptData.textContent = JSON.stringify({ source: "tailored_resume", generated_at: new Date().toISOString() }, null, 2);
    }
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch (_error) {
    return "";
  }
}

function applyTemplateBindings(templateHtml, resume, resumeBodyHtml) {
  const html = String(templateHtml || "");
  if (!html) {
    return "";
  }
  const contact = resume?.contact || {};
  const contactPrimary = [
    contact.email ? `Email: ${normalizeText(contact.email)}` : "",
    contact.phone ? `Phone Number: ${formatPhoneForDisplay(contact.phone)}` : ""
  ].filter(Boolean).join(" | ");
  const contactSecondary = [
    contact.linkedin ? `LinkedIn: ${normalizeText(contact.linkedin)}` : "",
    contact.github ? `GitHub: ${normalizeText(contact.github)}` : "",
    contact.portfolio ? `Portfolio: ${normalizeText(contact.portfolio)}` : ""
  ].filter(Boolean).join(" | ");
  const hasSectionPlaceholders = /\{\{PROFILE\}\}|\{\{EXPERIENCE\}\}|\{\{SKILLS\}\}|\{\{SOFT_SKILLS\}\}|\{\{LANGUAGES\}\}|\{\{WEB_PRESENCE\}\}|\{\{PROJECTS\}\}|\{\{EDUCATION\}\}|\{\{CERTIFICATIONS\}\}/.test(
    html
  );
  let bound = html
    .replace(/\{\{FULL_NAME\}\}/g, escapeHtml(resume?.full_name || "Candidate Name"))
    .replace(/\{\{HEADLINE\}\}/g, escapeHtml(resume?.headline || ""))
    .replace(/\{\{CONTACT_PRIMARY\}\}/g, escapeHtml(contactPrimary))
    .replace(/\{\{CONTACT_SECONDARY\}\}/g, escapeHtml(contactSecondary))
    .replace(/\{\{EMAIL\}\}/g, escapeHtml(contact.email || ""))
    .replace(/\{\{LINKEDIN\}\}/g, escapeHtml(contact.linkedin || ""))
    .replace(/\{\{GITHUB\}\}/g, escapeHtml(contact.github || ""))
    .replace(/\{\{PORTFOLIO\}\}/g, escapeHtml(contact.portfolio || ""))
    .replace(/\{\{PHONE\}\}/g, escapeHtml(formatPhoneForDisplay(contact.phone || "")))
    .replace(/\{\{ADDRESS\}\}/g, escapeHtml(contact.address || ""))
    .replace(/\{\{PROFILE\}\}/g, buildProfileSectionHtml(resume))
    .replace(/\{\{EXPERIENCE\}\}/g, buildExperienceSectionHtml(resume))
    .replace(/\{\{PROJECTS\}\}/g, buildProjectsSectionHtml(resume))
    .replace(/\{\{SKILLS\}\}/g, buildSkillsSectionHtml(resume))
    .replace(/\{\{SOFT_SKILLS\}\}/g, buildSoftSkillsSectionHtml(resume))
    .replace(/\{\{LANGUAGES\}\}/g, buildLanguagesSectionHtml(resume))
    .replace(/\{\{WEB_PRESENCE\}\}/g, buildWebPresenceSectionHtml(resume))
    .replace(/\{\{EDUCATION\}\}/g, buildEducationSectionHtml(resume))
    .replace(/\{\{CERTIFICATIONS\}\}/g, buildCertificationsSectionHtml(resume));
  const collapsibleSections = [
    { id: "profile-section", content: buildProfileSectionHtml(resume) },
    { id: "experience-section", content: buildExperienceSectionHtml(resume) },
    { id: "projects-section", content: buildProjectsSectionHtml(resume) },
    { id: "skills-section", content: buildSkillsSectionHtml(resume) },
    { id: "soft-skills-section", content: buildSoftSkillsSectionHtml(resume) },
    { id: "languages-section", content: buildLanguagesSectionHtml(resume) },
    { id: "web-presence-section", content: buildWebPresenceSectionHtml(resume) },
    { id: "education-section", content: buildEducationSectionHtml(resume) },
    { id: "certifications-section", content: buildCertificationsSectionHtml(resume) }
  ];
  collapsibleSections.forEach((section) => {
    if (normalizeText(section.content)) {
      return;
    }
    const sectionRegex = new RegExp(
      `<section\\s+id=["']${section.id}["'][\\s\\S]*?<\\/section>`,
      "i"
    );
    bound = bound.replace(sectionRegex, "");
  });
  if (hasSectionPlaceholders) {
    return bound;
  }
  if (bound.includes("{{TAILORED_RESUME_HTML}}")) {
    return bound.replace("{{TAILORED_RESUME_HTML}}", resumeBodyHtml);
  }
  if (bound.includes("<!-- TAILORED_RESUME_START -->") && bound.includes("<!-- TAILORED_RESUME_END -->")) {
    bound = bound.replace(
      /<!-- TAILORED_RESUME_START -->[\s\S]*<!-- TAILORED_RESUME_END -->/,
      `<!-- TAILORED_RESUME_START -->\n${resumeBodyHtml}\n<!-- TAILORED_RESUME_END -->`
    );
    return bound;
  }
  const originalTemplateSwap = applyOriginalTemplateContentSwap(html, resume);
  if (originalTemplateSwap) {
    return originalTemplateSwap;
  }
  const fixedTemplateSwap = applyExactTemplateContentSwap(html, resume);
  if (fixedTemplateSwap) {
    return fixedTemplateSwap;
  }
  return "";
}

function detectTemplateFontFamily(templateHtml, fallbackFont) {
  const html = String(templateHtml || "");
  const georgiaLike = /Georgia\s*,\s*Times|Times New Roman/i.test(html);
  const fashionSerifLike = /Bodoni MT|Didot|Garamond/i.test(html);
  if (fashionSerifLike) {
    return '"Bodoni MT", Didot, "Garamond", "Times New Roman", serif';
  }
  if (georgiaLike) {
    return "Georgia, 'Times New Roman', serif";
  }
  return fallbackFont;
}

function buildResumeHtml(tailoredResume, sourceTemplate, templateHtml = "") {
  const visualTemplate = sourceTemplate || {};
  if (templateHtml) {
    visualTemplate.font_family = detectTemplateFontFamily(
      templateHtml,
      visualTemplate.font_family || "Segoe UI"
    );
  }
  const templateStyles = extractTemplateStyleBlocks(templateHtml);
  const resumeBodyHtml = buildResumeBody(tailoredResume, visualTemplate);
  const templateBoundHtml = applyTemplateBindings(templateHtml, tailoredResume || {}, resumeBodyHtml);
  if (templateBoundHtml && templateBoundHtml !== templateHtml) {
    return templateBoundHtml;
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tailored Resume</title>
  ${templateStyles}
</head>
<body>
  ${resumeBodyHtml}
</body>
</html>`;
}

function downloadTailoredResumeHtml(html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "tailored-resume.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function renderTailoredResumePreview(result, sourceTemplate) {
  const html = buildResumeHtml(result?.best_resume, sourceTemplate, lastTemplateHtml);
  lastPreviewHtml = html;
  if (tailorPreviewFrameEl) {
    tailorPreviewFrameEl.srcdoc = html;
  }
  if (tailorPreviewEl) {
    tailorPreviewEl.style.display = "block";
  }
  if (exportPreviewBtn) {
    exportPreviewBtn.disabled = false;
  }
}

function exportTailoredResumeToPdf(html) {
  if (!html) {
    throw new Error("No tailored resume preview found. Run tailoring first.");
  }
  downloadTailoredResumeHtml(html);
  const printWindow = window.open("", "_blank", "width=1000,height=1200");
  if (!printWindow) {
    throw new Error("Pop-up blocked. Allow pop-ups to export PDF.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

async function runResumeTailorFlow() {
  const jobDescription = normalizeText(descriptionEl.value);
  if (!jobDescription) {
    throw new Error("Extract or paste job description first.");
  }
  setStatus("Loading resume.json...", "info");
  const resumeProfile = await loadResumeProfileFromProjectJson();
  setStatus("Loading template file...", "info");
  lastTemplateHtml = await loadTemplateHtmlFromExtension();
  lastTemplateFallbackContact = extractContactFallbackFromTemplate(lastTemplateHtml);
  resumeProfile.contact = {
    email: normalizeText(resumeProfile?.contact?.email || lastTemplateFallbackContact.email),
    linkedin: normalizeText(resumeProfile?.contact?.linkedin || lastTemplateFallbackContact.linkedin),
    github: normalizeText(resumeProfile?.contact?.github),
    portfolio: normalizeText(resumeProfile?.contact?.portfolio),
    phone: normalizeText(resumeProfile?.contact?.phone || lastTemplateFallbackContact.phone),
    address: normalizeText(resumeProfile?.contact?.address || lastTemplateFallbackContact.address)
  };
  const templateGuide = await loadTemplateGuideFromProjectTemplate();
  setStatus("Running iterative ATS tailoring (target: 95)...", "info");
  const normalizedFacts = normalizeFacts(lastExtractedFacts || {});
  const result = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "RUN_RESUME_TAILORING",
        payload: {
          resumeProfile,
          jobDescription,
          templateGuide,
          jobFacts: normalizedFacts,
          targetJobTitle: normalizedFacts.job_title,
          targetScore: 95,
          maxIterations: 5
        }
      },
      (response) => {
        const lastError = chrome.runtime.lastError?.message;
        if (lastError) {
          reject(new Error(lastError));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Resume tailoring failed."));
          return;
        }
        resolve(response.result);
      }
    );
  });
  const fallbackResume = result?.tailored_resume || (
    Array.isArray(result?.iterations) && result.iterations.length
      ? result.iterations[result.iterations.length - 1]?.tailored_resume
      : null
  );
  const effectiveResult = {
    ...result,
    best_resume: result?.best_resume || fallbackResume
  };
  if (!effectiveResult.best_resume) {
    throw new Error("Tailoring finished but no resume output was returned.");
  }
  const profileContact = resumeProfile?.contact || {};
  effectiveResult.best_resume = {
    ...effectiveResult.best_resume,
    contact: {
      email: normalizeText(
        effectiveResult.best_resume?.contact?.email || profileContact.email || lastTemplateFallbackContact.email
      ),
      linkedin: normalizeText(
        effectiveResult.best_resume?.contact?.linkedin || profileContact.linkedin || lastTemplateFallbackContact.linkedin
      ),
      github: normalizeText(
        effectiveResult.best_resume?.contact?.github || profileContact.github
      ),
      portfolio: normalizeText(
        effectiveResult.best_resume?.contact?.portfolio || profileContact.portfolio
      ),
      phone: normalizeText(
        effectiveResult.best_resume?.contact?.phone || profileContact.phone || lastTemplateFallbackContact.phone
      ),
      address: normalizeText(
        effectiveResult.best_resume?.contact?.address || profileContact.address || lastTemplateFallbackContact.address
      )
    },
    web_presence: Array.isArray(effectiveResult.best_resume?.web_presence) && effectiveResult.best_resume.web_presence.length
      ? effectiveResult.best_resume.web_presence.map((item) => normalizeText(item)).filter(Boolean)
      : [profileContact.linkedin, profileContact.github, profileContact.portfolio].map((item) => normalizeText(item)).filter(Boolean)
  };
  lastTailorResult = effectiveResult;
  lastTailorTemplate = resumeProfile.template || {};
  renderTailorResult(effectiveResult);
  renderTailoredResumePreview(effectiveResult, lastTailorTemplate);
  const scored = Number(effectiveResult?.best_ats_score);
  const target = Number(effectiveResult?.target_score);
  const progressText = Number.isFinite(scored)
    ? ` Best ATS score: ${scored}${Number.isFinite(target) ? ` / ${target}` : ""}.`
    : "";
  const baseMessage = `Tailoring complete.${progressText} Preview is ready. Export when you are satisfied.`;
  if (effectiveResult.partial_reason) {
    setStatus(`${baseMessage}\n${effectiveResult.partial_reason}`, "info");
  } else {
    setStatus(baseMessage, "success");
  }
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
  setStatus("Job description extracted.", "success");
}

async function submitDescription() {
  const facts = normalizeFacts(lastExtractedFacts || {});
  const payload = {
    ...(lastPayload || {}),
    job_description: descriptionEl.value,
    title: facts.job_title || "",
    company: facts.company || "",
    salary: facts.salary || "",
    location: facts.location || ""
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

async function fetchRecentJobs(limit = 20, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "GET_RECENT_JOBS",
        limit,
        search: options.search || "",
        company: options.company || "",
        sortBy: options.sortBy || "",
        sortOrder: options.sortOrder || ""
      },
      (response) => {
        if (!response?.ok) {
          reject(new Error(response?.error || "Unable to load recent jobs."));
          return;
        }
        resolve(response.result?.items || []);
      }
    );
  });
}

async function createJob(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CREATE_JOB", payload }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to create job."));
        return;
      }
      resolve(response.result);
    });
  });
}

async function updateJob(jobId, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "UPDATE_JOB", jobId, payload }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to update job."));
        return;
      }
      resolve(response.result);
    });
  });
}

async function deleteJob(jobId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "DELETE_JOB", jobId }, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to delete job."));
        return;
      }
      resolve();
    });
  });
}

let activeJobEditId = "";
let currentJobItems = [];
let currentJobPage = 1;
const JOBS_PAGE_SIZE = 8;

function renderJobsPager(totalItems) {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / JOBS_PAGE_SIZE));
  if (jobsPageInfoEl) {
    jobsPageInfoEl.textContent = `Page ${currentJobPage} / ${totalPages}`;
  }
  if (jobsPrevPageBtnEl) {
    jobsPrevPageBtnEl.disabled = currentJobPage <= 1;
  }
  if (jobsNextPageBtnEl) {
    jobsNextPageBtnEl.disabled = currentJobPage >= totalPages;
  }
}

function renderRecentJobs(items) {
  if (!jobsTableBodyEl) {
    return;
  }
  currentJobItems = Array.isArray(items) ? items : [];
  const totalPages = Math.max(1, Math.ceil(currentJobItems.length / JOBS_PAGE_SIZE));
  if (currentJobPage > totalPages) {
    currentJobPage = totalPages;
  }
  if (currentJobPage < 1) {
    currentJobPage = 1;
  }
  if (!currentJobItems.length) {
    jobsTableBodyEl.innerHTML = '<tr><td colspan="5" style="color:#6b7280;">No jobs found.</td></tr>';
    renderJobsPager(0);
    return;
  }
  const start = (currentJobPage - 1) * JOBS_PAGE_SIZE;
  const pageItems = currentJobItems.slice(start, start + JOBS_PAGE_SIZE);
  jobsTableBodyEl.innerHTML = "";
  pageItems.forEach((item) => {
    const isEditing = activeJobEditId === item.job_id;
    const row = document.createElement("tr");
    if (isEditing) {
      row.innerHTML = `
        <td><input class="job-inline-input" data-field="title" value="${escapeHtml(item.title || item.page_title || "")}" /></td>
        <td><input class="job-inline-input" data-field="company" value="${escapeHtml(item.company || item.source_site || "")}" /></td>
        <td><input class="job-inline-input" data-field="location" value="${escapeHtml(item.location || "")}" /></td>
        <td><input class="job-inline-input" data-field="salary" value="${escapeHtml(item.salary || "")}" /></td>
        <td>
          <button class="tiny-btn" data-action="save">Save</button>
          <button class="tiny-btn" data-action="cancel">Cancel</button>
        </td>
      `;
    } else {
      row.innerHTML = `
        <td>${escapeHtml(item.title || item.page_title || "")}</td>
        <td>${escapeHtml(item.company || item.source_site || "")}</td>
        <td>${escapeHtml(item.location || "")}</td>
        <td>${escapeHtml(item.salary || "")}</td>
        <td>
          <button class="tiny-btn" data-action="edit">Edit</button>
          <button class="tiny-btn" data-action="delete">Delete</button>
        </td>
      `;
    }
    const deleteBtn = row.querySelector('[data-action="delete"]');
    const editBtn = row.querySelector('[data-action="edit"]');
    const saveBtn = row.querySelector('[data-action="save"]');
    const cancelBtn = row.querySelector('[data-action="cancel"]');
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        activeJobEditId = item.job_id;
        renderRecentJobs(currentJobItems);
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        try {
          const nextTitle = normalizeText(row.querySelector('[data-field="title"]')?.value || "");
          const nextCompany = normalizeText(row.querySelector('[data-field="company"]')?.value || "");
          const nextLocation = normalizeText(row.querySelector('[data-field="location"]')?.value || "");
          const nextSalary = normalizeText(row.querySelector('[data-field="salary"]')?.value || "");
          if (!nextTitle || !nextCompany) {
            throw new Error("Title and company are required.");
          }
          await updateJob(item.job_id, {
            title: nextTitle,
            company: nextCompany,
            location: nextLocation,
            salary: nextSalary
          });
          activeJobEditId = "";
          await loadRecentJobs();
          setStatus("Job updated.", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        activeJobEditId = "";
        renderRecentJobs(currentJobItems);
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this job?")) {
          return;
        }
        try {
          await deleteJob(item.job_id);
          await loadRecentJobs();
          setStatus("Job deleted.", "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      });
    }
    jobsTableBodyEl.appendChild(row);
  });
  renderJobsPager(currentJobItems.length);
}

async function loadRecentJobs(options = {}) {
  if (!jobsTableBodyEl) {
    return;
  }
  const items = await fetchRecentJobs(100, {
    search: jobsSearchInputEl?.value || "",
    company: jobsCompanyFilterInputEl?.value || "",
    sortBy: jobsSortByEl?.value || "created_at",
    sortOrder: jobsSortOrderEl?.value || "desc"
  });
  if (!options.preservePage) {
    currentJobPage = 1;
  }
  renderRecentJobs(items);
}

if (extractBtn) {
  extractBtn.addEventListener("click", async () => {
    try {
      setStatus("Extracting job description...", "info");
      await extractDescription();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (extractFactsBtn) {
  extractFactsBtn.addEventListener("click", async () => {
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
}

if (sendBtn) {
  sendBtn.addEventListener("click", async () => {
    try {
      setStatus("Sending job payload to server...", "info");
      const result = await submitDescription();
      const resultLabel = result.was_created ? "Job payload submitted." : "Company already exists. Reused existing job.";
      setStatus(`${resultLabel}\nJob ID: ${result.job_id}\nPipeline: ${result.pipeline_status.state}`, "success");
      await loadRecentJobs();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (jobsFilterBtnEl) {
  jobsFilterBtnEl.addEventListener("click", async () => {
    try {
      await loadRecentJobs({ preservePage: false });
      setStatus("Filters applied.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (jobsResetBtnEl) {
  jobsResetBtnEl.addEventListener("click", async () => {
    if (jobsSearchInputEl) {
      jobsSearchInputEl.value = "";
    }
    if (jobsCompanyFilterInputEl) {
      jobsCompanyFilterInputEl.value = "";
    }
    if (jobsSortByEl) {
      jobsSortByEl.value = "created_at";
    }
    if (jobsSortOrderEl) {
      jobsSortOrderEl.value = "desc";
    }
    try {
      await loadRecentJobs();
      setStatus("Filters reset.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (jobsAddBtnEl) {
  jobsAddBtnEl.addEventListener("click", async () => {
    try {
      const title = normalizeText(jobTitleInputEl?.value || "");
      const company = normalizeText(jobCompanyInputEl?.value || "");
      const location = normalizeText(jobLocationInputEl?.value || "");
      const salary = normalizeText(jobSalaryInputEl?.value || "");
      if (!title || !company) {
        throw new Error("Title and company are required.");
      }
      await createJob({
        title,
        company,
        location,
        salary,
        page_title: title,
        source_site: "manual",
        source_url: "https://unknown.local/job",
        job_description: `${title} role at ${company}.`
      });
      if (jobTitleInputEl) jobTitleInputEl.value = "";
      if (jobCompanyInputEl) jobCompanyInputEl.value = "";
      if (jobLocationInputEl) jobLocationInputEl.value = "";
      if (jobSalaryInputEl) jobSalaryInputEl.value = "";
      await loadRecentJobs({ preservePage: false });
      setStatus("Job added.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (saveApiBtn) {
  saveApiBtn.addEventListener("click", async () => {
    try {
      await saveApiBase();
      setStatus("API URL saved.", "success");
      await loadRecentJobs();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (refreshRecentBtn) {
  refreshRecentBtn.addEventListener("click", async () => {
    try {
      await loadRecentJobs();
      setStatus("Recent jobs refreshed.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (tailorExportBtn) {
  tailorExportBtn.addEventListener("click", async () => {
    try {
      if (exportPreviewBtn) {
        exportPreviewBtn.disabled = true;
      }
      await runResumeTailorFlow();
      if (!lastPreviewHtml && lastTailorResult) {
        lastPreviewHtml = buildResumeHtml(lastTailorResult?.best_resume, lastTailorTemplate || {}, lastTemplateHtml);
      }
      exportTailoredResumeToPdf(lastPreviewHtml);
      setStatus("Tailoring complete. Export started and print dialog opened.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (exportPreviewBtn) {
  exportPreviewBtn.addEventListener("click", () => {
    try {
      if (!lastPreviewHtml && lastTailorResult) {
        lastPreviewHtml = buildResumeHtml(lastTailorResult?.best_resume, lastTailorTemplate || {}, lastTemplateHtml);
      }
      exportTailoredResumeToPdf(lastPreviewHtml);
      setStatus("Export started. HTML downloaded and print dialog opened.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (themeToggleEl) {
  themeToggleEl.addEventListener("click", () => {
    toggleTheme();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) || "auto") === "auto") {
      applyTheme("auto");
    }
  });
  loadThemePreference();
}

if (descriptionEl) {
  descriptionEl.addEventListener("input", () => {
    updateCharCount();
  });
}

updateCharCount();
renderFacts(lastExtractedFacts);
renderTailorResult(lastTailorResult);

if (apiBaseEl) {
  loadApiBase()
    .then((value) => {
      apiBaseEl.value = value;
    })
    .catch((error) => setStatus(error.message, "error"));
}

if (descriptionEl) {
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
}

if (jobsTableBodyEl) {
  loadRecentJobs().catch((error) => setStatus(error.message, "error"));
}

if (jobsPrevPageBtnEl) {
  jobsPrevPageBtnEl.addEventListener("click", () => {
    if (currentJobPage <= 1) {
      return;
    }
    currentJobPage -= 1;
    renderRecentJobs(currentJobItems);
  });
}

if (jobsNextPageBtnEl) {
  jobsNextPageBtnEl.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(currentJobItems.length / JOBS_PAGE_SIZE));
    if (currentJobPage >= totalPages) {
      return;
    }
    currentJobPage += 1;
    renderRecentJobs(currentJobItems);
  });
}

if (jobsSearchInputEl) {
  jobsSearchInputEl.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    try {
      await loadRecentJobs({ preservePage: false });
      setStatus("Filters applied.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

if (jobsCompanyFilterInputEl) {
  jobsCompanyFilterInputEl.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    try {
      await loadRecentJobs({ preservePage: false });
      setStatus("Filters applied.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}
