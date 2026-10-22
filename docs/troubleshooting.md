# Troubleshooting

**Sign-in unavailable:** run setup once, migrate the database, and restart. Do not copy secrets from another studio. The generated password is in `.studio-password`. If you lose it, stop the worker, back up data/config, generate a new password hash and session secret with the setup script in a separate directory, then replace only the auth values in your existing environment files. Keep `WORKER_SECRET`, provider keys and existing storage unchanged unless intentionally rotating them.

**Too many sign-in attempts:** wait for the five-minute rate-limit window to expire. Do not disable authentication to fix it.

**Worker offline:** ensure Node 24, FFmpeg and ffprobe are installed; confirm `WORKER_APP_URL` and that both sides have the same `WORKER_SECRET`. A worker requires both provider keys. Never post its full environment to an issue.

**Configured key but generation fails:** presence indicators do not verify model access, billing or remaining provider balance. Check the specific account/project, exact model IDs, provider status and API billing.

**Fetch failed / interrupted generation:** retain the production, request IDs and worker-state files. Restart connectivity and allow saved provider requests to be polled. Do not blindly resubmit a paid request with an unknown outcome.

**Unknown provider pricing:** the app fails closed rather than inventing a quote. Record the provider's public pricing response shape and request an adapter update. Remove private IDs, signatures and tokens first.

**Missing database table:** run migrations against the same local state directory or remote binding used by the web app. Do not point a fresh worker at a different database accidentally.

**Disk full:** stop new work, back up completed outputs and checkpoints, and free space carefully. Removing `worker-state` or storage volumes may destroy the ability to resume an unfinished film.

**Bug report:** include release version, OS, local/Docker/Cloudflare setup, sanitized error, expected behavior and minimal original script. Never attach `.env`, cookies, passwords, authorization headers or private production dumps.
