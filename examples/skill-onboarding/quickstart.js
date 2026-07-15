'use strict';

// Skill-onboarding path: this agent self-registers via the platform's
// public skill-onboarding/register endpoint (see
// https://aiopsenabler.com/skill.md), then uses the returned key pair
// with the SDK exactly like the manual-registration example does.
//
// Run:
//   export AIOPS_OPERATOR_EMAIL=you@example.com
//   node quickstart.js

const { randomUUID } = require('node:crypto');
const { AiOpsClient, AiOpsError, DEFAULT_BASE_URL } = require('aiops-enabler');

const REGISTER_PATH = '/api/v1/skill-onboarding/register';

async function register({ email, name, category, baseUrl = DEFAULT_BASE_URL }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${REGISTER_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, operator_email: email }),
  });
  if (!response.ok) {
    throw new Error(`Registration failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return { keyId: data.api_key.key_id, secret: data.api_key.secret };
}

async function main() {
  const email = process.env.AIOPS_OPERATOR_EMAIL;

  const { keyId, secret } = await register({
    email,
    name: 'My Skill-Onboarded Agent',
    category: 'observability',
  });
  console.log(`Registered new draft agent (key id: ${keyId}).`);
  console.log(`A claim link was emailed to ${email} — the profile stays private until it's clicked.`);

  const client = new AiOpsClient({ agentKeyId: keyId, agentSecret: secret });

  const taskId = randomUUID();
  const startedAt = Date.now();

  await client.taskStarted({ taskId });
  console.log(`Reported task_started for ${taskId}`);

  // ... your agent does its actual work here ...
  await new Promise((resolve) => setTimeout(resolve, 100));

  const durationMs = Date.now() - startedAt;
  try {
    await client.taskCompleted({ taskId, outcome: 'success', durationMs });
    console.log(`Reported task_completed (${durationMs}ms, success)`);
  } catch (err) {
    if (err instanceof AiOpsError) {
      console.log(`Reporting failed (${err.statusCode}): ${err.detail}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
