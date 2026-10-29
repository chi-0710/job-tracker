# Repository Guidelines

## Project Structure & Module Organization

This repository is a browser-only job-tracking app. `index.html` defines the interface, `style.css` contains presentation rules, and `app.js` owns state, rendering, localStorage persistence, and JSON import/export. `data.js` provides demo records only when browser storage is empty; `data.json` is the matching importable backup, and both are sanitized for public release. `tests/` contains dependency-free Node.js and Python regression tests. The core app has no server or build step; the optional AI screenshot mode is served by `ai_server.py`.

Keep UI behavior and persistence changes in `app.js` and visual changes in `style.css`. Keep the core app server-free: the only service is the optional local AI screenshot proxy (`ai_server.py`), which must stay optional and documented. Keep generated files and personal job data out of source modules and commits.

## Build, Test, and Development Commands

There is no build step or package installation.

- Open `index.html` in a browser for local development and manual testing.
- `node --check app.js` and `node --check data.js` perform quick JavaScript syntax checks when Node.js is available.
- `node tests/app.test.js` runs the data workflow and duplicate-ID regression tests.
- `python -m unittest discover -s tests -p "test_*.py"` runs the optional AI server regression tests without calling Alibaba Cloud.
- `python -m json.tool data.json` validates the persisted JSON before committing data changes.

## Coding Style & Naming Conventions

Use two-space indentation in HTML, CSS, and JavaScript. Follow the existing JavaScript style: `const`/`let`, semicolons, single-quoted strings, `camelCase` functions and variables, and `UPPER_SNAKE_CASE` constants. Use kebab-case for HTML IDs and CSS classes (for example, `btn-add-company`). Preserve UTF-8 encoding and concise Chinese UI text.

## Testing Guidelines

No automated test framework or coverage threshold is configured. For every change, run the syntax and test commands above, then manually verify initial-data loading, adding/editing/deleting companies and positions, status filtering, timeline ordering, JSON import/export, and persistence after refresh. Test direct `index.html` use in a normal browser profile. If adding tests, place them in `tests/` and use descriptive `*.test.js` (or `test_*.py`) names.

## Commit & Pull Request Guidelines

Use short, imperative, scoped commit messages such as `fix: preserve selected position after filter` or `docs: clarify local startup`. Pull requests should explain the user-visible change, list validation performed, link any issue, and include before/after screenshots for interface changes. Call out intentional `data.js`/`data.json` edits because backups can contain personal information.

## Security & Data Handling

The repository ships sanitized demo data. Treat browser storage, `data.js`, `data.json`, exported backups, and `.env` as sensitive. Never commit real applicant, company-contact, or interview details; keep changes to `data.js`/`data.json` generic. Do not test with an incognito profile, because its local data is discarded when the session closes.
