#!/usr/bin/env node
'use strict';

/**
 * ChoreScore V3 — Privacy release contract check
 *
 * Adapted from V2. Verifies that the V3 analytics/privacy architecture:
 * 1. Required files exist
 * 2. Anonymous interfaces contain NO operational IDs, free text, or join keys
 * 3. Pipeline, gate, taxonomy, cache implementations are present
 * 4. Focused privacy regression tests pass
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/analytics/types.ts',
  'src/analytics/pipeline.ts',
  'src/analytics/gate.ts',
  'src/analytics/taxonomy.ts',
  'src/analytics/classificationCache.ts',
  'src/analytics/consentPolicy.ts',
  'src/analytics/queryBudget.ts',
  'src/analytics/differentialPrivacy.ts',
  'src/analytics/buyerContracts.ts',
  'src/analytics/auditLog.ts',
  'src/infrastructure/local/LocalResearchAnalyticsAdapter.ts',
  'src/domain/services/costInstrumentation.ts',
  'docs/V3_BACKEND_FRUGAL.md',
];

const failures = [];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`missing required privacy file: ${relative}`);
  }
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function extractInterface(source, name) {
  const marker = `export interface ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    failures.push(`missing interface ${name}`);
    return '';
  }
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  failures.push(`unterminated interface ${name}`);
  return '';
}

if (failures.length === 0) {
  const types = read('src/analytics/types.ts');

  const anonymousInterfaces = [
    'AnonymousTaskFact',
    'AnonymousContributionEvent',
    'AnonymousExpenseEvent',
    'AnonymousSettlementEvent',
    'AnonymousUsageEvent',
    'ResearchDataProduct',
    'DataProductProvenance',
  ];

  const forbiddenProperties = [
    'userId', 'accountId', 'memberId', 'householdId', 'membershipId',
    'entryId', 'persistentTaskId', 'todoId',
    'email', 'phone', 'oauthSubject', 'ipAddress', 'deviceId', 'advertisingId',
    'label', 'title', 'notes', 'name', 'displayName', 'householdName', 'memberName',
    'latitude', 'longitude', 'address', 'zipCode',
    'createdAt', 'occurredAt', 'completedAt',
  ];

  for (const interfaceName of anonymousInterfaces) {
    const block = extractInterface(types, interfaceName);
    for (const property of forbiddenProperties) {
      const propertyPattern = new RegExp(`(^|\\n)\\s*${property}\\??\\s*:`, 'm');
      if (propertyPattern.test(block)) {
        failures.push(`${interfaceName} contains forbidden release property ${property}`);
      }
    }
  }

  // ResearchDataProduct must not reference raw operational types
  const product = extractInterface(types, 'ResearchDataProduct');
  const rawOperationalTypes = ['CompletedEntry', 'TodoItem', 'PersistentTask', 'User', 'Member', 'Household'];
  for (const typeName of rawOperationalTypes) {
    if (new RegExp(`\\b${typeName}\\b`).test(product)) {
      failures.push(`ResearchDataProduct references operational type ${typeName}`);
    }
  }

  // Verify key implementations exist
  const pipeline = read('src/analytics/pipeline.ts');
  const gate = read('src/analytics/gate.ts');
  const taxonomy = read('src/analytics/taxonomy.ts');
  const cache = read('src/analytics/classificationCache.ts');

  if (!/PrivacyTransformPipeline/.test(pipeline)) failures.push('PrivacyTransformPipeline implementation missing');
  if (!/PrivacyReleaseGate/.test(gate)) failures.push('PrivacyReleaseGate implementation missing');
  if (!/TaskTaxonomy/.test(taxonomy)) failures.push('Task taxonomy implementation missing');
  if (!/ClassificationCache/.test(cache)) failures.push('ClassificationCache implementation missing');

  // V3-specific: verify cost budgets exist
  const cost = read('src/domain/services/costInstrumentation.ts');
  if (!/COST_BUDGETS/.test(cost)) failures.push('COST_BUDGETS definition missing');
  if (!/open-household/.test(cost)) failures.push('open-household budget missing');
  if (!/tab-switch/.test(cost)) failures.push('tab-switch budget missing');
}

if (failures.length > 0) {
  console.error('Privacy release contract FAILED:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Static privacy release contract: OK');
console.log('Running focused privacy/backend regression tests...');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  npx,
  [
    '--no-install',
    'jest',
    '--passWithNoTests',
    '--testPathPattern=v3-07-analytics-privacy',
    '--runInBand',
  ],
  { cwd: root, stdio: 'inherit', env: process.env }
);

if (result.status !== 0) {
  console.error(`Focused privacy tests failed with exit code ${result.status}`);
  process.exit(result.status || 1);
}

console.log('Privacy release contract: PASS');
