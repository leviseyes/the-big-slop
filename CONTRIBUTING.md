# Contributing

Thanks for helping turn scripts into films. Start with a small issue and explain the user-visible outcome. Use Discussions for ideas, issues for reproducible bugs, and pull requests for focused changes.

## Setup and checks

Use Node 24, `npm ci`, `npm run setup`, `npm run db:migrate`. Use a disposable local studio with no production data. `npm run dev` starts the UI. Before a PR, run:

```sh
npm test
npm run typecheck
npm run build
npm run test:workers
```

With a local server running, run `npm run test:api`. `TEST_BASE_URL` can point to a different loopback port. Do not point tests at a real remote studio. Additional `tests/*smoke.mjs` integration scripts read/write the local D1 database and create synthetic fixtures; use a disposable database. The worker smoke suite intercepts every external request and uses real FFmpeg, with no provider spend.

Changes to paid submissions, approval gates, identity/reference scoping or checkpoint recovery need targeted regression tests. Never auto-resubmit an uncertain request, silently discard reference identity, weaken provider safeguards or mark stale storyboard versions approved.

Keep PRs free of credentials and generated/private media. New sample content must be original or licensed for inclusion. Describe changed behavior, validation and limitations in the PR. Contributions are accepted under the repository's Apache 2.0 license; preserve third-party notices.

## Useful first contributions

- Improve accessible keyboard and mobile review flows.
- Add fixtures for provider pricing schema changes.
- Improve installer diagnostics without making paid test calls.
- Add continuity evaluation fixtures with original reusable media.
- Improve the self-hosting guide after a clean install on a different OS.

The inherited `npm run lint` configuration currently reports existing dynamic-typing and React compiler lint debt. It is not a clean release gate yet. CI gates use the tests, TypeScript check, build, production dependency audit, release scan, and standalone/Docker smoke checks. Tightening lint without weakening behavior is welcome.
