# Early alpha limitations

- Single-owner authentication; no multi-user SaaS, public onboarding, wallet, payment service, referrals, ad insertion or payouts.
- Self-hosted control plane and renderer; generation still depends on paid third-party APIs and exact model access.
- Tested workflows use 30-second sequences, 1K source images, 16:9 storyboard panels and 480p/720p video. Other aspect ratios and 1080p require additional product work and validation.
- AI output may have wrong voices, unreadable text, continuity mistakes, failed requests, unsafe suggestions or missing story details. Review it before sharing.
- A video quote does not include every prior planning/image/edit charge. Provider rates can change. Unrecognized pricing stops quoting for review.
- The local server uses development emulation and should remain bound to localhost. Use the documented Cloudflare deployment for remote access; that does not make the alpha a hardened multi-user service.
- Vinext and upstream provider interfaces evolve. Keep the pinned lockfile, read release notes and test upgrades.
- Long productions may take many hours and significant disk/API budget. Progress estimates are approximate, not service guarantees.
- Ambiguous provider submissions can require an operator. Automatic retries are intentionally bounded.
- Backup, disaster recovery, load testing and independent security review remain the operator's responsibility. The project does not promise production SLAs.

See [ROADMAP.md](../ROADMAP.md) for next work. Report reproducible issues without private media or credentials.

## Dependency audit notes

The release upgrades the web framework, React server components, Vite/Cloudflare tooling, ZIP library and image-processing dependency to address known critical/high advisories. The production dependency audit still reports a moderate `sprintf-js` advisory through Mammoth’s CLI argument parser; the studio uses Mammoth’s browser DOCX conversion bundle, not its CLI. Upstream has no patched sprintf-js release at this audit. Development tooling also reports unpatched brace/glob parsing advisories and older Drizzle tooling dependencies. Do not run development servers publicly or build untrusted forks with secrets. CI blocks high/critical production dependency findings and Dependabot tracks upstream updates. This is not an independent security certification.
