# The creative workflow

1. **Script or idea.** Choose format, length, language and visual style. The title you enter stays independent from the upload filename. Idea-to-script writing is a paid LLM operation.
2. **Plan.** The director maps the script to thirty-second sequences and a shared continuity guide. Review the planned runtime before image generation. Short runtimes are constrained by sequence sizing.
3. **References.** Generate all required character/location/object images at 1K, then pause. Edit multiple references, upload replacements or add assets and descriptions. The image editor can select supporting references from this production's existing image catalog. Press Done to continue.
4. **Storyboards.** Draw a sequential panel for each planned shot, with camera/action/audio directions. The 1K generated drawings are cropped to a consistent 1024×576 panel for this release. Accept individual shots or use Accept all; approval validates the current image versions. A separate Continue action moves forward. Changing a panel invalidates its old approval.
5. **Estimate.** Stage scene-opening frames and obtain video pricing. Check the estimate and the limits of what it includes. Planning, images and edits have already incurred costs.
6. **Commit and start.** Accept the video estimate to submit video jobs. Provider generation cannot be undone for a refund by refreshing or closing the browser. Approved jobs continue on the worker.
7. **Assembly.** Download finished clips, normalize them with FFmpeg and join them in production order. Watch or download the final film. The app celebrates completion; it does not certify that every generated frame is correct.

## Continuity and recovery

The actual attachment manifest determines Seedance `@imageN` references. Prompts include identities, scene layout, prop states, timed actions, dialogue languages and continuity rules. Continuous shots can start from the preceding video's final frame; explicit cuts use their planned scene frame. Model output can still drift.

Confirmed failures may trigger bounded, recorded retries or safe rewrites. A safety rewrite removes prohibited content and preserves suitable references; it does not evade provider policies. An unsuitable replacement pauses for review. Unknown submission outcomes are not automatically resubmitted. Review preserved request IDs before authorizing a retry.

## Series and library

Organize productions by format and group recurring episodes in a series. Canonical series references can be reused intentionally; unrelated productions remain scoped to their owners/projects. The Slops view presents generated productions. The Pros view supports uploaded media with owner/admin approval. In this single-owner edition these are private library views, not a public streaming service.
