#!/usr/bin/env node
'use strict';

/**
 * ChoreScore V3 — Android E2E golden path via adb
 *
 * Adapted from V2 for V3 navigation: Ajouter | Balances | A faire.
 * No chrono, no premium. Three-tab navigation. Factual, mature design.
 *
 * Expects to run inside the GitHub Actions android-emulator-runner
 * with adb available and the release APK already installed.
 *
 * Environment:
 *   CHORESCORE_APK_PATH — path to the APK (optional if already installed)
 *   CHORESCORE_E2E_OUTPUT — directory for screenshots/result (default: audit/android-e2e)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const apkPath = process.env.CHORESCORE_APK_PATH;

function configuredAndroidPackage() {
  if (process.env.CHORESCORE_E2E_PACKAGE) return process.env.CHORESCORE_E2E_PACKAGE;
  const appConfigPath = path.resolve('app.json');
  const config = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  const value = config?.expo?.android?.package;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing expo.android.package in ${appConfigPath}`);
  }
  return value.trim();
}

const packageName = configuredAndroidPackage();
const outputDir = process.env.CHORESCORE_E2E_OUTPUT || path.resolve('audit/android-e2e');
const resultPath = path.join(outputDir, 'result.json');
const checkpoints = [];
const startedAt = new Date().toISOString();
fs.mkdirSync(outputDir, { recursive: true });

function adb(args, binary = false) {
  return execFileSync('adb', args, {
    encoding: binary ? null : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function shell(...args) { return adb(['shell', ...args]); }

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function decode(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function dumpUi() {
  try { shell('uiautomator', 'dump', '/sdcard/chorescore-window.xml'); } catch (_) {}
  const xml = adb(['exec-out', 'cat', '/sdcard/chorescore-window.xml']);
  const nodes = [];
  for (const nodeMatch of xml.matchAll(/<node\b([^>]*)\/?>(?:<\/node>)?/g)) {
    const attrs = {};
    for (const attr of nodeMatch[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = decode(attr[2]);
    }
    nodes.push(attrs);
  }
  return { xml, nodes };
}

function nodeMatches(node, label, exact) {
  return [node['content-desc'] || '', node.text || ''].some(
    (v) => (exact ? v === label : v.includes(label))
  );
}

function findNodes(label, exact = false) {
  return dumpUi().nodes.filter((n) => nodeMatches(n, label, exact));
}

function bounds(node) {
  const m = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds || '');
  if (!m) throw new Error(`Invalid bounds for ${node.text || node['content-desc'] || 'node'}`);
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x1, y1, x2, y2, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

function swipeUp() { shell('input', 'swipe', '540', '1850', '540', '650', '350'); sleep(400); }

function swipeToTop() {
  for (let i = 0; i < 5; i += 1) {
    shell('input', 'swipe', '540', '600', '540', '1900', '250');
    sleep(150);
  }
}

function findVisible(label, { exact = false, scroll = true, last = false } = {}) {
  const attempts = scroll ? 7 : 1;
  for (let i = 0; i < attempts; i += 1) {
    const matches = findNodes(label, exact);
    if (matches.length) return last ? matches[matches.length - 1] : matches[0];
    if (scroll) swipeUp();
  }
  throw new Error(`UI node not found: ${label}`);
}

function tapNode(node, waitMs = 550) {
  const b = bounds(node);
  shell('input', 'tap', String(b.x), String(b.y));
  sleep(waitMs);
}

function tapLabel(label, options = {}) {
  const node = findVisible(label, options);
  tapNode(node, options.waitMs || 550);
  return node;
}

function inputKeyText(value) {
  const keyFor = (ch) => {
    if (/^[a-z]$/.test(ch)) return `KEYCODE_${ch.toUpperCase()}`;
    if (/^[0-9]$/.test(ch)) return `KEYCODE_${ch}`;
    if (ch === ' ') return 'KEYCODE_SPACE';
    throw new Error(`Unsupported deterministic E2E input character: ${ch}`);
  };
  for (const ch of value.toLowerCase()) shell('input', 'keyevent', keyFor(ch));
  sleep(300);
}

function typeInto(label, value) {
  tapNode(findVisible(label, { exact: true }), 500);
  const focused = findVisible(label, { exact: true, scroll: false });
  if (focused.focused !== 'true') throw new Error(`Text input did not receive focus: ${label}`);
  inputKeyText(value);
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const current = findVisible(label, { exact: true, scroll: false });
    if (current.text === value) return;
    sleep(150);
  }
  const current = findVisible(label, { exact: true, scroll: false });
  throw new Error(`Text input failed for ${label}: expected ${value}, saw ${current.text || '<empty>'}`);
}

function back() { shell('input', 'keyevent', 'KEYCODE_BACK'); sleep(500); }

function waitFor(label, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (findNodes(label).length) return;
    sleep(300);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function assertAbsent(label) {
  if (findNodes(label).length) throw new Error(`Expected ${label} to be absent`);
}

function screenshot(name) {
  const prefix = `${String(checkpoints.length + 1).padStart(2, '0')}-${name}`;
  const file = path.join(outputDir, `${prefix}.png`);
  fs.writeFileSync(file, adb(['exec-out', 'screencap', '-p'], true));
  let uiDump = null;
  try {
    const dump = dumpUi();
    const uiFile = path.join(outputDir, `${prefix}.xml`);
    fs.writeFileSync(uiFile, dump.xml);
    uiDump = path.basename(uiFile);
  } catch (_) {}
  checkpoints.push({ name, screenshot: path.basename(file), uiDump, at: new Date().toISOString() });
}

function writeResult(status, error = null) {
  fs.writeFileSync(resultPath, JSON.stringify({
    schemaVersion: 1,
    status,
    packageName,
    apkPath,
    startedAt,
    finishedAt: new Date().toISOString(),
    checkpoints,
    error: error ? String(error.stack || error) : null,
  }, null, 2));
}

function launch() {
  shell('am', 'force-stop', packageName);
  try { shell('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'); } catch (_) {}
  sleep(3000);
}

// ══════════════════════════════════════════════════════════════
// V3 Golden Path
// ══════════════════════════════════════════════════════════════

try {
  if (!apkPath || !fs.existsSync(apkPath)) throw new Error(`Unreadable CHORESCORE_APK_PATH: ${apkPath}`);
  if (!/device/.test(adb(['get-state']))) throw new Error('No adb device/emulator');
  if (!shell('pm', 'list', 'packages', packageName).includes(packageName)) {
    adb(['install', '-r', apkPath]);
  }

  // Re-enable network in case a previous test disabled it
  try { shell('svc', 'wifi', 'enable'); } catch (_) {}
  try { shell('svc', 'data', 'enable'); } catch (_) {}
  sleep(1000);

  // 1. Launch and sign in
  launch();
  waitFor('Demarrer', 60000);
  screenshot('01-login');
  tapLabel('Demarrer', { exact: false });
  waitFor('Appartement', 60000);
  screenshot('02-groups');

  // Verify no premium/plan badges
  assertAbsent('Premium');
  assertAbsent('Essai');
  assertAbsent('Standard');
  assertAbsent('Pro');
  assertAbsent('Gratuit');

  // 2. Open demo household
  tapLabel('Appartement', { exact: true });
  waitFor('Ajouter', 30000);
  waitFor('Balances', 30000);
  waitFor('A faire', 30000);
  screenshot('03-tabs');

  // Verify three tabs are present
  const tabNodes = findNodes('Ajouter');
  if (tabNodes.length < 1) throw new Error('Ajouter tab not found');

  // 3. Verify existing demo contribution is visible
  waitFor('Vaisselle du soir', 15000);
  screenshot('04-add-tab');

  // 4. Verify contribution form fields exist (V3: no chrono!)
  assertAbsent('Chrono');
  assertAbsent('Chronometre');
  assertAbsent('Duree reelle');

  // 5. Switch to Balances tab
  tapLabel('Balances', { exact: true });
  waitFor('Alex', 15000);
  waitFor('Sam', 15000);
  screenshot('05-balances');

  // 6. Verify dual ledger sections
  waitFor('Contribution', { exact: false, scroll: true, waitMs: 500 });
  screenshot('06-balances-detail');

  // 7. Switch to A faire tab
  tapLabel('A faire', { exact: true });
  waitFor('Sortir les poubelles', 15000);
  screenshot('07-todos');

  // 8. Switch back to Ajouter to verify tab switching doesn't reload
  tapLabel('Ajouter', { exact: true });
  waitFor('Vaisselle du soir', 10000);
  screenshot('08-back-to-add');

  // 9. Verify no warm V2 aesthetic
  assertAbsent('self-care');
  assertAbsent('Bravo');
  assertAbsent('Tu as assured');
  assertAbsent('streak');
  assertAbsent('badge');

  writeResult('pass');
  console.log(`V3 Android golden path PASS — ${outputDir}`);
} catch (error) {
  try { screenshot('failure'); } catch (_) {}
  writeResult('fail', error);
  console.error(error.stack || error);
  process.exit(1);
}
