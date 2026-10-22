# Self-hosting and operations

## Supported shape

Version 0.1 is a single-owner studio. Node 24 runs a long-lived render worker with FFmpeg/ffprobe. The web application uses Vinext, Cloudflare D1 and R2 bindings. The local setup and Docker Compose use Wrangler's local emulation; **this is an alpha personal/local deployment, not a hardened public server recommendation**. Use your own Cloudflare account for a remotely accessible studio. Other databases and storage providers need an adapter; a generic VPS-only production backend is not implemented yet.

## Local installation

Follow the README. Setup creates three private files with restrictive filesystem permissions:

- `.env`: Node worker settings and credentials.
- `.dev.vars`: the same server configuration for local Cloudflare emulation.
- `.studio-password`: the random owner sign-in password.

Keep key changes synchronized between `.env` and `.dev.vars`. Authentication uses a salted password hash, signed 12-hour HttpOnly/SameSite cookies and an atomic global rate limit of ten login attempts per five-minute window. There are no public sign-ups or account recovery emails. Rotating `SESSION_SECRET` invalidates all sessions. Treat anyone with the worker secret as a trusted studio operator; its API can read and repair productions.

Keep localhost binding. Do not expose `npm run dev` or Wrangler dev directly to the Internet. Development tooling is not a public production server. The Docker worker starts only with the `generation` profile and resumes previously approved work when started.

## Cloudflare deployment

This creates resources in **your** account and may incur hosting charges. It does not deploy to the project's private studio.

1. Install dependencies and run setup locally. Run `npx wrangler login` to authorize your account.
2. Create resources:
   ```sh
   npx wrangler d1 create the-big-slop
   npx wrangler r2 bucket create the-big-slop-media
   ```
3. Replace the placeholder `database_id` in `wrangler.jsonc` with your new database ID; set unique Worker/database/bucket names if needed. Keep the binding names `DB` and `BUCKET`. Do not commit your deployment identifiers to a public fork.
4. Apply migrations: `npx wrangler d1 migrations apply DB --remote`.
5. Build: `npm run build`. Before deployment, set the generated secret values with `npx wrangler secret put NAME` for each of `SESSION_SECRET`, `STUDIO_PASSWORD_HASH`, `WORKER_SECRET`, `OPENAI_API_KEY`, and `HF_KEY`. Paste values at the CLI prompt; do not put secrets in shell history. Set the same `WORKER_SECRET` in your Node worker's private environment. Set `ADMIN_EMAIL` and the chosen `ORCHESTRATOR_MODEL` as Worker vars if changing defaults. Keep `PAYMENTS_ENABLED=false`.
6. Deploy with `npx wrangler deploy --config dist/server/wrangler.json`. Use the HTTPS URL returned by Wrangler. Bind a custom domain if desired.
7. On your worker machine/container set `WORKER_APP_URL=https://YOUR-STUDIO-HOST` and the provider keys, then run `npm run worker` or build `services/Dockerfile`. Mount persistent storage at `/app/worker-state` for that container. For a remote web studio, run the worker container directly rather than the local Compose service, whose URL targets the local web container.
8. Sign in and verify the worker indicator. Test a short original production with a small provider budget. Do not open a public sign-up service on this edition.

The Cloudflare deployment recipe uses the pinned Wrangler integration. It does not provision accounts, enable provider billing, or generate a film automatically. Pin and test upgrades before using them with important productions.

## Storage and backups

Local Node installs store D1 and R2 in `.wrangler/state`; render checkpoints/media cache live in `worker-state`. Docker uses `studio-data` and `worker-data` named volumes. Back up both plus the private configuration and protect backups like your originals.

For a consistent local backup, stop the worker, wait for in-flight jobs to reach a saved checkpoint, stop the web process, then copy these directories. A killed generation request can have an unknown provider outcome: preserve its request/checkpoint and reconcile it before retrying. Do not simply restart a duplicate generation.

For Cloudflare, export D1 using `wrangler d1 export DB --remote --output=backup.sql`, back up the R2 bucket with your chosen object-storage backup process, and retain worker checkpoints and configuration separately. The application does not implement automated backup/restore.

## Upgrade

1. Preserve a full backup. Read the release notes and stop the render worker before changing versions.
2. Check out the desired release, run `npm ci` and apply local/remote migrations as appropriate.
3. Build and restart the web app, then the worker. With Docker, rebuild and run the `migrate` service before starting the updated studio.
4. Confirm existing productions load, keys are configured and the worker is online. Keep the old backup until you verify the new version. Database rollback is not automatic.

## Costs and network behavior

Planning, images, edits, storyboard panels and video calls can all be billed by providers. Storage, bandwidth and render compute are separate. There is no central usage allowance, wallet or sponsorship system in this release. Set provider-side budgets and verify actual charges. A timeout does not mean a request was free.

The studio sends no application analytics to its maintainers. Provider services and deployment tooling have their own logging and telemetry policies. Private media is authenticated in the studio, but reference uploads sent to generation providers use fetchable provider URLs; treat these as sensitive links.
