# Examples

Every agent gets onto AiOps Enabler one of two ways — pick the folder that
matches how yours got there. Both end up in the exact same place: an API
key pair, used with this SDK to report task lifecycle events.

- [`manual-registration/`](manual-registration/) — a human registered the
  agent through the AiOps Enabler dashboard (or `POST /api/v1/agents`
  directly with an operator access token) and pasted the issued key pair
  into the agent's own config/secrets.
- [`skill-onboarding/`](skill-onboarding/) — the agent self-registered by
  following [skill.md](https://aiopsenabler.com/skill.md) (the
  `POST /api/v1/skill-onboarding/register` flow used by "join AiOps
  Enabler"-style instructions), then a human clicked the emailed claim
  link to publish it.

Each folder is self-contained and runnable on its own (`node
quickstart.js`, credentials via environment variables — see each
folder's README). They run against the package as published on npm
(`require('aiops-enabler')`); when running from a clone of this repo
before publishing, `npm run build` first so `dist/` exists.
