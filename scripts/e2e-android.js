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

/**
 * Resolve the APK path when installation is needed.
 * Priority: CHORESCORE_APK_PATH env var > auto-locate under build outputs.
 * Returns null when no APK is found (caller decides whether to throw).
 */
function resolveApkPath() {
  const envPath = process.env.CHORESCORE_APK_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Auto-locate under standard build output directory
  const buildDir = path.resolve('android', 'app', 'build', 'outputs', 'apk', 'release');
  try {
    const entries = fs.readdirSync(buildDir);
    const apk = entries.find((f) => f.endsWith('.apk'));
    if (apk) return path.join(buildDir, apk);
  } catch (_) {
    // build directory may not exist
  }

  return null;
}

const outputDir = process.env.CHORESCORE_E2E_OUTPUT || path.resolve('audit/android-e2e');
const resultPath = path.join(outputDir, 'result.json');
const checkpoints = [];
const startedAt = new Date().toISOString();
fs.mkdirSync(outputDir, { recursive: true });

const ADB_TIMEOUT_MS = 60_000;
const ADB_INSTALL_TIMEOUT_MS = 180_000;
let adbReconnectCount = 0;

function adbReconnect() {
  // Kill and restart the adb server to recover from flaky connections.
  // API 35 x86_64 emulators on GitHub Actions often develop ETIMEDOUT on
  // exec-out after React Native cold start.  A reconnect resets the
  // transport layer without rebooting the emulator.
  adbReconnectCount++;
  console.log(`  adb reconnect #${adbReconnectCount} — resetting transport`);
  try { execFileSync('adb', ['reconnect'], { timeout: 10_000, stdio: 'ignore' }); } catch (_) {}
  sleep(2000);
  try { execFileSync('adb', ['wait-for-device'], { timeout: 15_000, stdio: 'ignore' }); } catch (_) {}
  sleep(1000);
}

function adb(args, { binary = false, retries = 3, timeoutMs, allowReconnect = true } = {}) {
  const effectiveTimeout = timeoutMs ?? (args[0] === 'install' ? ADB_INSTALL_TIMEOUT_MS : ADB_TIMEOUT_MS);
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return execFileSync('adb', args, {
        encoding: binary ? null : 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: effectiveTimeout,
      });
    } catch (err) {
      lastError = err;
      const signal = err.killed ? ' (TIMEOUT — killed)' : '';
      const isTimeout = err.killed || /ETIMEDOUT|TIMEOUT/i.test(err.message || '');
      console.log(`  adb ${args[0]} failed (attempt ${attempt}/${retries})${signal}: ${err.message?.slice(0, 200) || err}`);
      // On timeout, try reconnecting adb transport before next attempt
      if (isTimeout && allowReconnect && attempt < retries) {
        try { adbReconnect(); } catch (_) {}
      } else if (attempt < retries) {
        sleep(2000);
      }
    }
  }
  throw lastError;
}

function shell(...args) { return adb(['shell', ...args], { timeoutMs: 30_000 }); }

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

let dumpFailures = 0;

function dumpUi() {
  // Delete any previous dump file so that a failed dump always yields
  // empty nodes instead of stale XML from a prior screen state.
  try { shell('rm', '-f', '/sdcard/chorescore-window.xml'); } catch (_) {}
  try {
    shell('uiautomator', 'dump', '/sdcard/chorescore-window.xml');
  } catch (err) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: uiautomator dump failed (${dumpFailures} total): ${err.message?.slice(0, 120) || err}`);
    }
    return { xml: '', nodes: [] };
  }
  let xml = '';
  try {
    // Use 'shell cat' instead of 'exec-out cat' — exec-out consistently
    // ETIMEDOUT on API 35 x86_64 under React Native cold-start load.
    // shell transport is more resilient on slow emulators.
    xml = adb(['shell', 'cat', '/sdcard/chorescore-window.xml'], { timeoutMs: 30_000 });
    // adb shell may append \r\n; strip trailing whitespace
    xml = xml.replace(/[\r\n]+$/, '');
  } catch (err) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: cat dump file failed (${dumpFailures} total): ${err.message?.slice(0, 120) || err}`);
    }
    // On cat failure, try one adb reconnect and retry once
    try {
      adbReconnect();
      xml = adb(['shell', 'cat', '/sdcard/chorescore-window.xml'], { timeoutMs: 30_000 });
      xml = xml.replace(/[\r\n]+$/, '');
      if (xml && xml.includes('<node')) {
        dumpFailures--; // successful retry — undo the increment
      }
    } catch (_) {
      return { xml: '', nodes: [] };
    }
  }
  if (!xml || !xml.includes('<node')) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: dump returned empty/invalid XML (${dumpFailures} total), length=${xml?.length || 0}`);
    }
    return { xml: xml || '', nodes: [] };
  }
  // Successful dump — reset consecutive failure counter
  dumpFailures = 0;
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
    try { shell('input', 'swipe', '540', '600', '540', '1900', '250'); } catch (_) {}
    sleep(150);
  }
}

function findVisible(label, { exact = false, scroll = true, last = false } = {}) {
  const attempts = scroll ? 7 : 1;
  for (let i = 0; i < attempts; i += 1) {
    const matches = findNodes(label, exact);
    if (matches.length) return last ? matches[matches.length - 1] : matches[0];
    if (scroll) {
      try { swipeUp(); } catch (_) {
        // Swipe failed (emulator busy/transient) — retry dump next iteration
      }
    }
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
  let previousDumpFailures = dumpFailures;
  let consecutiveDumpFails = 0;
  while (Date.now() < until) {
    if (findNodes(label).length) return;
    // Detect if the dump that just ran inside findNodes failed
    if (dumpFailures > previousDumpFailures) {
      consecutiveDumpFails += dumpFailures - previousDumpFailures;
      if (consecutiveDumpFails >= 3 && consecutiveDumpFails % 3 === 0) {
        console.log(`  WARN: ${consecutiveDumpFails} consecutive UI dump failures while waiting for "${label}" — attempting adb reconnect`);
        try { adbReconnect(); } catch (_) {}
      }
    } else {
      consecutiveDumpFails = 0;
    }
    previousDumpFailures = dumpFailures;
    sleep(500);
  }
  // On timeout, dump logcat for post-mortem diagnosis
  try {
    const logcat = adb(['logcat', '-d', '-t', '80'], { timeoutMs: 10_000 });
    const logcatPath = path.join(outputDir, `logcat-wait-${label.replace(/\s+/g, '_')}.txt`);
    fs.writeFileSync(logcatPath, logcat);
    console.log(`  Logcat on timeout saved to ${logcatPath}`);
  } catch (_) {
    console.log('  Could not capture logcat on timeout');
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function assertAbsent(label) {
  if (findNodes(label).length) throw new Error(`Expected ${label} to be absent`);
}

function screenshot(name) {
  const prefix = `${String(checkpoints.length + 1).padStart(2, '0')}-${name}`;
  const file = path.join(outputDir, `${prefix}.png`);
  // Try exec-out screencap first; on ETIMEDOUT fall back to shell-based approach
  try {
    fs.writeFileSync(file, adb(['exec-out', 'screencap', '-p'], { binary: true, timeoutMs: 30_000 }));
  } catch (_) {
    // Fallback: write screencap to device, pull it via shell cat (binary-unreliable but better than nothing)
    try {
      shell('screencap', '-p', '/sdcard/chorescore-e2e-screen.png');
      const data = adb(['exec-out', 'cat', '/sdcard/chorescore-e2e-screen.png'], { binary: true, timeoutMs: 30_000 });
      fs.writeFileSync(file, data);
    } catch (_) {
      // Screencap failed completely — record checkpoint without file
    }
  }
  let uiDump = null;
  try {
    const dump = dumpUi();
    const uiFile = path.join(outputDir, `${prefix}.xml`);
    fs.writeFileSync(uiFile, dump.xml);
    uiDump = path.basename(uiFile);
  } catch (_) {}
  checkpoints.push({ name, screenshot: fs.existsSync(file) ? path.basename(file) : null, uiDump, at: new Date().toISOString() });
}

function writeResult(status, error = null) {
  fs.writeFileSync(resultPath, JSON.stringify({
    schemaVersion: 1,
    status,
    packageName,
    apkPath: process.env.CHORESCORE_APK_PATH || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    checkpoints,
    error: error ? String(error.stack || error) : null,
  }, null, 2));
}

function launch() {
  try { shell('am', 'force-stop', packageName); } catch (_) {}
  sleep(1000);
  // Clear any previous logcat to get clean logs for this launch
  try { adb(['logcat', '-c']); } catch (_) {}
  try { shell('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'); } catch (_) {}
  // Wait for React Native cold start on emulator — API 35 x86_64 can be slow.
  // 30s gives Hermes time to initialize on slow GitHub Actions runners.
  sleep(30000);
  // Ensure adb transport is healthy after the heavy cold-start phase
  try { adb(['wait-for-device'], { timeoutMs: 10_000, allowReconnect: false }); } catch (_) {}
  // Verify the process is alive after launch attempt
  try {
    const pid = shell('pidof', packageName).trim();
    if (pid) {
      console.log(`App process alive (pid ${pid})`);
    } else {
      console.log('WARN: App process not found after launch — may still be starting');
      // One more wait and check
      sleep(10000);
      try {
        const pid2 = shell('pidof', packageName).trim();
        if (pid2) {
          console.log(`App process alive after extended wait (pid ${pid2})`);
        } else {
          console.log('WARN: App process still not found after 40s — capture logcat for diagnosis');
          try {
            const logcat = adb(['logcat', '-d', '-t', '50'], { timeoutMs: 10_000 });
            console.error('--- Post-launch logcat (last 50 lines) ---');
            console.error(logcat);
            console.error('--- end logcat ---');
          } catch (_) {}
        }
      } catch (_) {}
    }
  } catch (_) {
    console.log('WARN: Could not check app process state');
  }
}

// ══════════════════════════════════════════════════════════════
// V3 Golden Path
// ══════════════════════════════════════════════════════════════

try {
  if (!/device/.test(adb(['get-state']))) throw new Error('No adb device/emulator');
  console.log('adb device connected');

  // Check if the package is already installed; only install when needed
  const alreadyInstalled = shell('pm', 'list', 'packages', packageName).includes(packageName);
  console.log(`Package ${packageName} installed: ${alreadyInstalled}`);
  if (!alreadyInstalled) {
    const apkPath = resolveApkPath();
    if (!apkPath) {
      throw new Error(
        'Package not installed and no APK found. Set CHORESCORE_APK_PATH or build the release APK first.'
      );
    }
    console.log(`Installing APK: ${apkPath}`);
    adb(['install', '-r', apkPath]);
    console.log('APK installed successfully');
  }

  // Re-enable network in case a previous test disabled it
  try { shell('svc', 'wifi', 'enable'); } catch (_) {}
  try { shell('svc', 'data', 'enable'); } catch (_) {}
  sleep(1000);

  // 1. Launch and sign in
  console.log('Launching app...');
  launch();
  // Diagnostic screenshot to capture the screen state after launch
  screenshot('diagnostic-post-launch');
  console.log('Waiting for Demarrer button...');
  // API 35 x86_64 cold start can be very slow — 240s timeout.
  // Each UI dump takes 10-30s on a loaded emulator, so we need enough
  // headroom for several successful dumps after the cold start completes.
  waitFor('Demarrer', 240000);
  screenshot('01-login');
  tapLabel('Demarrer', { exact: false });
  console.log('Waiting for Appartement group...');
  waitFor('Appartement', 60000);
  screenshot('02-groups');

  // Verify no premium/plan badges
  assertAbsent('Premium');
  assertAbsent('Essai');
  assertAbsent('Standard');
  assertAbsent('Pro');
  assertAbsent('Gratuit');

  // 2. Open demo household
  console.log('Opening Appartement group...');
  tapLabel('Appartement', { exact: true });
  console.log('Waiting for tabs (Ajouter, Balances, A faire)...');
  waitFor('Ajouter', 30000);
  waitFor('Balances', 30000);
  waitFor('A faire', 30000);
  screenshot('03-tabs');

  // Verify three tabs are present
  const tabNodes = findNodes('Ajouter');
  if (tabNodes.length < 1) throw new Error('Ajouter tab not found');
  console.log('Tabs verified: Ajouter, Balances, A faire');

  // 3. Verify existing demo contribution is visible
  console.log('Waiting for demo contribution "Vaisselle du soir"...');
  waitFor('Vaisselle du soir', 15000);
  screenshot('04-add-tab');

  // 4. Verify contribution form fields exist (V3: no chrono!)
  assertAbsent('Chrono');
  assertAbsent('Chronometre');
  assertAbsent('Duree reelle');

  // 5. Switch to Balances tab
  console.log('Switching to Balances tab...');
  tapLabel('Balances', { exact: true });
  waitFor('Alex', 15000);
  waitFor('Sam', 15000);
  screenshot('05-balances');

  // 6. Verify dual ledger sections
  console.log('Verifying Contribution section...');
  waitFor('Contribution', 15000);
  screenshot('06-balances-detail');

  // 7. Switch to A faire tab
  console.log('Switching to A faire tab...');
  tapLabel('A faire', { exact: true });
  console.log('Waiting for demo todo "Sortir les poubelles"...');
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
  console.error(`V3 Android golden path FAIL: ${error.message}`);
  // Capture logcat for post-mortem diagnosis
  try {
    const logcat = adb(['logcat', '-d', '-t', '200'], { timeoutMs: 10_000 });
    fs.writeFileSync(path.join(outputDir, 'logcat-failure.txt'), logcat);
    console.log('  Logcat saved to logcat-failure.txt');
  } catch (_) {
    console.log('  Could not capture logcat on failure');
  }
  // Capture dumpstate for deeper diagnosis
  try {
    const dumpsys = adb(['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 15_000 });
    fs.writeFileSync(path.join(outputDir, 'dumpsys-activities-failure.txt'), dumpsys);
  } catch (_) {}
  try { screenshot('failure'); } catch (_) {}
  writeResult('fail', error);
  // Echo result.json to stderr so the step logs contain structured diagnostic data
  // even when the audit/android-e2e/ directory is not uploaded as an artifact.
  try {
    const resultContent = fs.readFileSync(resultPath, 'utf8');
    console.error('--- result.json (structured diagnostic) ---');
    console.error(resultContent);
    console.error('--- end result.json ---');
  } catch (_) {}
  console.error(error.stack || error);
  process.exit(1);
}
