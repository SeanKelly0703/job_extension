# Supported Sites (Initial)

The extension includes selector-based extraction for:

- `linkedin.com`
- `indeed.com`
- `greenhouse.io`

If no site selector matches or a selector fails, the extension falls back to a heuristic parser that selects the longest meaningful text block from common container nodes (`main`, `article`, `section`, `div`).

## Notes

- DOM structures vary frequently; selectors may need maintenance.
- Extraction quality should be validated manually on target pages.
- Add or update selectors in `extension/src/contentScript.js`.
