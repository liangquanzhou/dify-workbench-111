<!-- Modified for Dify Workbench 1.11.1 on 2026-09-30; see NOTICE and MODIFICATIONS.md. -->
# Contributing

This repository is the Dify 1.11.1 adaptation of the pinned upstream dify-mcp project. See README.md and NOTICE for provenance and scope.

## Development

The intended repository is `liangquanzhou/dify-workbench-111`; its availability depends on the publication step.

```sh
git clone https://github.com/liangquanzhou/dify-workbench-111.git
cd dify-workbench-111
npm ci --ignore-scripts
npm run check
npm run smoke:mcp:upstream
npm run smoke:mcp:http:upstream
```

Node.js >=23.6 is required. The current adapter targets Dify 1.11.1 / DSL 0.5.0. Native TypeScript runs without a build step.

## Changes

- Legacy-profile behavior lives in `src/legacy/` and is covered by `test/legacy-*.test.ts`
- Keep compiler/build adapters separate from the Console transport
- Preserve target binding, old-baseline conflict detection, secret/resource safeguards, uncertain-outcome handling, and independent publish gating
- Do not broaden the legacy capability list without target-version contract evidence and tests
- Existing upstream tools remain an explicit compatibility profile, not a claim of 1.11.1 support
- Use only synthetic fixtures and mocks by default; real deployment verification requires permission and an isolated app

## Issues and pull requests

Use the repository issue templates and include the profile, tool version, Dify version, sanitized error code, and a minimal synthetic reproduction. Never attach session cookies, tokens, passwords, company domains, internal paths, production DSL, real cases, or raw business logs. A workflow DSL may contain sensitive data even if credential fields are empty.

Run `npm run check` and `git diff --check` before submitting. State exactly what was tested, what failed, and what was not run. Do not describe mocks as real Dify integration tests.
