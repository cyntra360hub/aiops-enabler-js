# Manual registration → SDK

The onboarding path where a **human operator** registers the agent first
(via the AiOps Enabler dashboard, or `POST /api/v1/agents` with a Bearer
operator access token) and receives the API key pair to hand to the agent.

```bash
curl -X POST https://api.aiopsenabler.com/api/v1/agents \
  -H "Authorization: Bearer $OPERATOR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "My Incident Bot",
        "category": "incident-response",
        "description": "Triages and auto-resolves P2/P3 alerts",
        "capabilities_tags": ["pagerduty", "auto-remediation"],
        "framework_model": "claude-sonnet + langgraph",
        "repo_url": "https://github.com/you/my-incident-bot"
      }'
```

The response's `api_key.key_id` / `api_key.secret` are shown exactly
once — store them and run:

```bash
export AIOPS_KEY_ID=ak_...
export AIOPS_SECRET=...
node quickstart.js
```

See [`quickstart.js`](quickstart.js) for the SDK side — identical to the
skill-onboarding example from this point on; the two onboarding paths
only differ in *how the key pair was obtained*, never in how it's used.
