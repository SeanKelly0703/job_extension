const detectBtn = document.getElementById('detectBtn');
const resultEl = document.getElementById('result');
const classificationEl = document.getElementById('classification');
const confidencePillEl = document.getElementById('confidencePill');
const reasonSummaryEl = document.getElementById('reasonSummary');
const signalsEl = document.getElementById('signals');
const jdSectionEl = document.getElementById('jdSection');
const jdPreviewEl = document.getElementById('jdPreview');
const copyBtn = document.getElementById('copyBtn');

let latestDescription = '';

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function detectAndExtractOnPage() {
  const url = window.location.href.toLowerCase();
  const bodyText = cleanText(document.body?.innerText || '').toLowerCase();

  const signals = [];
  let score = 0;

  const positiveUrlPatterns = [/\/jobs?\//, /\/careers?\//, /\/positions?\//, /\/job\//, /\/vacanc/];
  if (positiveUrlPatterns.some((pattern) => pattern.test(url))) {
    score += 18;
    signals.push('+ URL resembles a jobs/careers detail page');
  }

  const negativeUrlPatterns = [/search/, /results/, /list/, /category/, /explore/];
  if (negativeUrlPatterns.some((pattern) => pattern.test(url))) {
    score -= 8;
    signals.push('- URL resembles a listing/search page');
  }

  const headingKeywords = [
    'job description',
    'responsibilities',
    'requirements',
    'qualifications',
    'what you will do',
    'about the role',
    'preferred qualifications',
    'minimum qualifications'
  ];
  const headingMatches = headingKeywords.filter((kw) => bodyText.includes(kw)).length;
  if (headingMatches > 0) {
    const headingScore = Math.min(30, headingMatches * 6);
    score += headingScore;
    signals.push(`+ Found ${headingMatches} job-related section keywords`);
  }

  const jdKeywords = [
    'years of experience',
    'equal opportunity employer',
    'benefits',
    'salary',
    'compensation',
    'apply now',
    'full-time',
    'part-time',
    'hybrid',
    'remote'
  ];
  const jdMatches = jdKeywords.filter((kw) => bodyText.includes(kw)).length;
  if (jdMatches > 0) {
    const jdScore = Math.min(20, jdMatches * 4);
    score += jdScore;
    signals.push(`+ Found ${jdMatches} job-context terms`);
  }

  const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  let hasJobPostingSchema = false;
  let schemaDescription = '';

  for (const script of jsonLdScripts) {
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
      const posting = nodes.find((node) => {
        const type = node?.['@type'];
        return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
      });

      if (posting) {
        hasJobPostingSchema = true;
        schemaDescription = cleanText(posting.description || '');
        break;
      }
    } catch (_) {
      // Ignore malformed JSON-LD and continue.
    }
  }

  if (hasJobPostingSchema) {
    score += 38;
    signals.push('+ Detected JobPosting schema (JSON-LD)');
  }

  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount > 450) {
    score += 8;
    signals.push('+ Page has long-form content');
  }

  const sections = Array.from(document.querySelectorAll('section, article, main, div'));
  let bestSectionText = '';
  let bestSectionScore = 0;

  for (const section of sections.slice(0, 400)) {
    const text = cleanText(section.innerText || '');
    if (text.length < 250) continue;

    const lower = text.toLowerCase();
    let localScore = 0;

    if (/responsibilit|requirement|qualification|about the role|what you will do/.test(lower)) {
      localScore += 5;
    }

    const bulletLikeLines = (text.match(/(^|\n)\s*[•\-*]/g) || []).length;
    localScore += Math.min(5, bulletLikeLines);

    localScore += Math.min(10, Math.floor(text.length / 500));

    if (localScore > bestSectionScore) {
      bestSectionScore = localScore;
      bestSectionText = text;
    }
  }

  if (bestSectionText) {
    score += 6;
    signals.push('+ Found dense section likely containing a job description');
  }

  const anchors = Array.from(document.querySelectorAll('a')).length;
  const paragraphs = Array.from(document.querySelectorAll('p')).length;
  if (anchors > 120 && paragraphs < 20) {
    score -= 12;
    signals.push('- Link-heavy layout resembles listings more than a detail page');
  }

  const cappedScore = Math.max(0, Math.min(100, score));
  const isJobPost = cappedScore >= 48;

  if (signals.length === 0) {
    signals.push('No strong job-post signals detected');
  }

  const descriptionSource = schemaDescription || bestSectionText;
  const description = cleanText(descriptionSource).slice(0, 3000);

  return {
    isJobPost,
    confidence: cappedScore,
    signals,
    extractedDescription: description,
    url: window.location.href,
    title: document.title
  };
}

function getConfidenceClass(value) {
  if (value >= 70) return 'high';
  if (value >= 48) return 'mid';
  return 'low';
}

function renderSignals(signals) {
  signalsEl.textContent = '';
  for (const signal of signals) {
    const li = document.createElement('li');
    li.textContent = signal;
    signalsEl.appendChild(li);
  }
}

function renderDescription(description) {
  latestDescription = description || '';
  if (!latestDescription) {
    jdSectionEl.classList.add('hidden');
    jdPreviewEl.textContent = '';
    return;
  }

  jdSectionEl.classList.remove('hidden');
  jdPreviewEl.textContent = latestDescription;
}

function renderResult(payload) {
  resultEl.classList.remove('hidden');

  classificationEl.textContent = payload.isJobPost
    ? 'Likely Job Post ✅'
    : 'Probably Not a Job Post ⚠️';

  confidencePillEl.textContent = `${payload.confidence}% confidence`;
  confidencePillEl.className = `pill ${getConfidenceClass(payload.confidence)}`;

  reasonSummaryEl.textContent = payload.isJobPost
    ? 'This page contains strong signals of a single job detail page.'
    : 'This page does not show enough reliable signals for a job-post classification.';

  renderSignals(payload.signals);
  renderDescription(payload.extractedDescription);
}

async function onDetectClick() {
  detectBtn.disabled = true;
  detectBtn.textContent = 'Detecting...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error('No active tab found.');
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectAndExtractOnPage
    });

    renderResult(result.result);
  } catch (error) {
    resultEl.classList.remove('hidden');
    classificationEl.textContent = 'Detection failed';
    confidencePillEl.textContent = '0% confidence';
    confidencePillEl.className = 'pill low';
    reasonSummaryEl.textContent = error.message || 'Unknown error occurred.';
    renderSignals(['Try reloading the page and running detection again.']);
    renderDescription('');
  } finally {
    detectBtn.disabled = false;
    detectBtn.textContent = 'Detect & Scrape';
  }
}

async function onCopyClick() {
  if (!latestDescription) return;

  try {
    await navigator.clipboard.writeText(latestDescription);
    copyBtn.textContent = 'Copied';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 1200);
  } catch (_) {
    copyBtn.textContent = 'Failed';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 1200);
  }
}

detectBtn.addEventListener('click', onDetectClick);
copyBtn.addEventListener('click', onCopyClick);
