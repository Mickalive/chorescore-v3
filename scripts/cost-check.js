#!/usr/bin/env node
'use strict';

/**
 * ChoreScore V3 — Cost regression gate check
 *
 * Runs the V3-08 cost gate tests to verify that no cost regression
 * has been introduced. Covers:
 * - 50k entries don't cause 50k reads
 * - Tab switching doesn't reload objects
 * - Sync of deltas doesn't reload full history
 * - Writes are bounded
 * - Classification cache prevents duplicate AI calls
 * - Privacy gate passes for clean data products
 * - Cost budgets are defined and enforceable
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log('Running V3-08 cost regression gate tests...');

const result = spawnSync(
  npx,
  [
    '--no-install',
    'jest',
    '--passWithNoTests',
    '--testPathPattern=cost-gates-v3-08',
    '--runInBand',
  ],
  { cwd: root, stdio: 'inherit', env: process.env }
);

if (result.status !== 0) {
  console.error(`Cost gate tests failed with exit code ${result.status}`);
  process.exit(result.status || 1);
}

console.log('Cost regression gate: PASS');
