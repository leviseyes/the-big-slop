# Security policy

This is early alpha software. Use a single-owner deployment, keep the local server on loopback, and keep credentials server-side. Do not run a public multi-tenant service from this edition.

## Reporting

Please use GitHub's **Report a vulnerability** option under Security for this repository when it is enabled. Do not publish exploit details, credentials, private scripts or production assets in public issues. If private reporting is unavailable, open a minimal issue asking the maintainer to establish a private reporting channel, with no sensitive details.

Report the release version, affected component, impact, minimal safe reproduction and mitigation if known. There is no guaranteed response SLA or paid bounty. Maintainers will coordinate fixes and public disclosure where possible.

Only the latest alpha release receives fixes. Rotate exposed provider/session/worker credentials promptly. If secrets ever reach Git history, deleting the current file is not enough: revoke/rotate first and clean the affected history.

The threat boundary is one trusted owner and one trusted render worker. Worker bearer credentials grant operator capabilities. The application verifies owner cookies and does not trust caller-supplied identity headers. Provider responses and scripts are untrusted inputs. Keep OS packages, FFmpeg, Node and npm dependencies patched.
