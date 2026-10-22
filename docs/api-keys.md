# Connect your own API accounts

The software is free. Provider generation is paid and requires model access. A ChatGPT subscription and OpenAI API billing are separate. Use a dedicated project/account budget and start small.

## OpenAI

1. Sign in to [OpenAI Platform](https://platform.openai.com/).
2. Create or select a project for this studio. Set up API billing and review usage limits in that project.
3. Check that your project has access to `gpt-6-astra` or `gpt-5.6-sol` and `gpt-image-2.5-sunburst`. Model names are configured for this application; access is not guaranteed. If you do not see the required models, resolve provider access before starting production.
4. Open [API keys](https://platform.openai.com/api-keys), create a server-side secret key, and save it in your password manager. Grant only the required Responses, image generation/editing and file capabilities.
5. In the private `.env` and `.dev.vars` files created by setup, set `OPENAI_API_KEY` to your key. Never paste it into a GitHub issue, a browser-side environment variable, or a public demo.
6. Choose `ORCHESTRATOR_MODEL=gpt-6-astra` or `gpt-5.6-sol` in both files and restart the studio and worker.

The background director saves Responses request IDs for recovery. Some planning/continuity requests use the provider's stored background response capability. Relevant scripts, prompts and reference images are sent to the provider. Review its data controls before using confidential material.

## Higgsfield

1. Sign in to the [Higgsfield API console](https://open.higgsfield.ai/).
2. Open **API keys** and create server credentials. Save both the key ID and secret securely.
3. Open Billing and add sufficient API funds. Confirm API access to [Seedance 2.5 reference-to-video](https://open.higgsfield.ai/models/bytedance/seedance-2.5/reference-to-video/api-reference).
4. Combine the two values with one colon: `KEY_ID:KEY_SECRET`.
5. Set `HF_KEY` to that combined value in `.env` and `.dev.vars`. Restart both processes.

The app supplies authentication as `Authorization: Key KEY_ID:KEY_SECRET`, following the [Higgsfield documentation](https://docs.higgsfield.ai/docs). Reference images are uploaded to provider storage so Seedance can fetch them. Generated results are copied back to your studio storage.

## Verify without immediately buying a film

1. Start the studio and worker; open **Studio setup**.
2. The indicator confirms that key values are configured and the worker has checked in. **It is not a model-access or balance check.**
3. Use the included short sample. “Plan & Build” sends a paid planning request. Review its runtime before approving reference generation.
4. Review references, then storyboards. Review the video estimate before committing to video generation.
5. Check usage in both provider dashboards. Image edits, reference images, planning, storyboards and retries can incur separate charges; the video estimate is not an all-in project budget.

No Stripe credentials are needed. Never enable payment flags to work around an API billing error. If a provider rejects a request or a required model is unavailable, follow [troubleshooting](troubleshooting.md).
