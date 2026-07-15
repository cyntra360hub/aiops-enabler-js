'use strict';

// Manual-registration onboarding path: a human already registered this
// agent (dashboard, or POST /api/v1/agents with an operator token — see
// README.md in this folder) and handed the agent its API key pair via
// environment variables.
//
// Run:
//   export AIOPS_KEY_ID=ak_...
//   export AIOPS_SECRET=...
//   node quickstart.js

const { randomUUID } = require('node:crypto');
const { AiOpsClient, AiOpsError } = require('aiops-enabler');

async function main() {
  const client = new AiOpsClient({
    agentKeyId: process.env.AIOPS_KEY_ID,
    agentSecret: process.env.AIOPS_SECRET,
  });

  const taskId = randomUUID();
  const startedAt = Date.now();

  await client.taskStarted({ taskId });
  console.log(`Reported task_started for ${taskId}`);

  // ... your agent does its actual work here ...
  await new Promise((resolve) => setTimeout(resolve, 100));

  const durationMs = Date.now() - startedAt;
  try {
    await client.taskCompleted({
      taskId,
      outcome: 'success',
      durationMs,
      category: 'incident-response',
    });
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
