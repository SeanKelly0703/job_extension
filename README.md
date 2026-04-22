# Job Post Detector Extension

Phase 1 Chrome extension to detect whether the current page is likely a job posting and scrape a preview of the job description.

## Features (Phase 1)
- Clean popup UI
- One-click detect + scrape on active tab
- Confidence score (0-100) with positive and negative signals
- Job description preview with one-click copy
- Heuristic classification tuned to reduce listing/search-page false positives

## Local setup
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder
5. Open a job page and click the extension icon

## Next phases
- Phase 2: extract normalized sections (summary, responsibilities, requirements)
- Phase 3: send extracted data to backend API
- Phase 4: resume tailoring workflow integration
