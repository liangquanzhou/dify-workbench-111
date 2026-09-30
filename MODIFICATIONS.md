# Modifications to pinned upstream

Date: 2026-09-30 UTC. Upstream: alexjiaguo/dify-mcp commit `cfaa2abafaf8807c0914eff1bb7b9909e6599293`, Apache-2.0.

The files below differ from the pinned upstream. New adapter files, synthetic fixtures and documentation are identified in the source manifest. Unmodified upstream LICENSE is preserved.

- `.dockerignore`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/workflows/ci.yml`
- `.gitignore`
- `CONTRIBUTING.md`
- `Dockerfile`
- `README.md`
- `bin/difywf.js`
- `package-lock.json`
- `package.json`
- `test/auth-cookie.test.ts`
- `test/cli.test.ts`
- `test/gaps.test.ts`

Changes introduce the Dify 1.11.1 default profile, profile dispatch, synthetic safety tests, repaired dependency lock, current docs and CI, privacy-focused reporting, and public repository metadata. No upstream attribution is removed. The original README and Dockerfile are retained under docs/ for explicit upstream reference.
