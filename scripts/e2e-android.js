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

const ADB_TIMEOUT_MS = 45_000;
const ADB_INSTALL_TIMEOUT_MS = 180_000;
let adbReconnectCount = 0;

// ── Dump cache ──────────────────────────────────────────────────
// Each uiautomator dump takes 30-60s on API 35 x86_64 under React
// Native cold-start load.  Multiple rapid calls (e.g. findVisible
// scroll loop, sequential waitFor calls, assertAbsent batches) each
// trigger a fresh dump without caching, easily exceeding the step
// timeout.  Cache the last successful dump result for 30s so rapid
// successive calls on the same screen share one dump.
//
// The cache is invalidated on screen-transition triggers (tap, swipe)
// so that post-transition calls always get a fresh dump of the new
// screen state.  This avoids both redundant 30-60s dumps AND stale
// cache hits across screen transitions.
let _dumpCache = null;
let _dumpCacheTime = 0;
const DUMP_CACHE_TTL_MS = 30_000;

function adbReconnect() {
  // Kill and restart the adb SERVER PROCESS to recover from degraded state.
  // API 35 x86_64 emulators on GitHub Actions develop a broken adb server
  // after React Native Hermes cold start — 'adb reconnect' only resets the
  // transport layer but the server process remains in a degraded state where
  // 'adb shell cat' consistently times out.  kill-server + start-server
  // fully restarts the server process, which automatically rediscovers the
  // running emulator via its broadcast channel.
  adbReconnectCount++;
  console.log(`  adb reconnect #${adbReconnectCount} — killing and restarting adb server`);
  try { execFileSync('adb', ['kill-server'], { timeout: 10_000, stdio: 'ignore' }); } catch (_) {}
  sleep(3000);
  try { execFileSync('adb', ['start-server'], { timeout: 10_000, stdio: 'pipe' }); } catch (_) {}
  sleep(2000);
  try { execFileSync('adb', ['wait-for-device'], { timeout: 30_000, stdio: 'ignore' }); } catch (_) {}
  sleep(1500);
  // Verify the server is healthy after restart
  try {
    const state = execFileSync('adb', ['get-state'], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(`  adb server restarted — device state: ${state}`);
  } catch (_) {
    console.log('  adb server restarted — state check failed (proceeding)');
  }
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

function shell(...args) {
  // Allow a trailing { timeoutMs, retries } options object to override the
  // defaults.  Used by dumpUi to reduce retries and let waitFor() handle
  // retries at a higher level within its own deadline.
  let opts = {};
  if (args.length > 0 && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1]) && (args[args.length - 1].timeoutMs !== undefined || args[args.length - 1].retries !== undefined)) {
    opts = args.pop();
  }
  return adb(['shell', ...args], {
    timeoutMs: opts.timeoutMs ?? 30_000,
    ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
  });
}

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
  // ── Cache hit ──────────────────────────────────────────────────
  // Reuse a recent dump when rapid successive calls occur (e.g.
  // assertAbsent batches, screenshot + findVisible on same screen,
  // sequential waitFor calls after a screen has settled).  The 30s
  // TTL covers same-screen rapid calls (each dump takes 30-60s on
  // slow emulators, so the cache is always fresh for the next call).
  // The cache is invalidated on tap/swipe (screen transitions) so
  // post-transition calls always get a fresh dump of the new screen.
  const now = Date.now();
  if (_dumpCache && (now - _dumpCacheTime) < DUMP_CACHE_TTL_MS) {
    return { xml: _dumpCache.xml, nodes: _dumpCache.nodes, fromCache: true };
  }

  // Delete any previous dump file so that a failed dump always yields
  // empty nodes instead of stale XML from a prior screen state.
  try { shell('rm', '-f', '/sdcard/chorescore-window.xml'); } catch (_) {}
  try {
    // uiautomator dump can take 30-60s on a loaded API 35 x86_64 emulator
    // under React Native cold-start load.  Use a 60s timeout with 1 retry:
    // fail fast so that waitFor() can retry at a higher level within its
    // own deadline.  Previous 3-retry approach wasted up to 180s per dump,
    // blowing past the 240s Demarrer window.  60s (up from 45s) gives
    // additional headroom for the worst-case dump on degraded emulators.
    shell('uiautomator', 'dump', '/sdcard/chorescore-window.xml', { timeoutMs: 60_000, retries: 1 });
  } catch (err) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: uiautomator dump failed (${dumpFailures} total): ${err.message?.slice(0, 120) || err}`);
      // Diagnostic fallback: capture the top activity so the next cycle
      // can see what was on screen even when uiautomator dump fails.
      try {
        const activityInfo = adb(['shell', 'dumpsys', 'activity', 'top'], { timeoutMs: 15_000 });
        const topLines = activityInfo.split('\n').filter(l => l.includes('ACTIVITY') || l.includes('mResumed') || l.includes('mFocused')).slice(0, 10);
        if (topLines.length > 0) {
          console.log(`  dumpUi: diagnostic top activity: ${topLines.join(' | ')}`);
        }
      } catch (_) {}
    }
    return { xml: '', nodes: [], fromCache: false };
  }
  let xml = '';
  try {
    // Use 'shell cat' instead of 'exec-out cat' — exec-out consistently
    // ETIMEDOUT on API 35 x86_64 under React Native cold-start load.
    // shell transport is more resilient on slow emulators.
    // Use 1 retry to fail fast and let waitFor() handle retries.
    xml = adb(['shell', 'cat', '/sdcard/chorescore-window.xml'], { timeoutMs: 30_000, retries: 1 });
    // adb shell may append \r\n; strip trailing whitespace
    xml = xml.replace(/[\r\n]+$/, '');
  } catch (err) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: cat dump file failed (${dumpFailures} total): ${err.message?.slice(0, 120) || err}`);
    }
    // On cat failure, try one adb reconnect and retry once (no extra retries)
    try {
      adbReconnect();
      xml = adb(['shell', 'cat', '/sdcard/chorescore-window.xml'], { timeoutMs: 30_000, retries: 1 });
      xml = xml.replace(/[\r\n]+$/, '');
      if (xml && xml.includes('<node')) {
        dumpFailures--; // successful retry — undo the increment
      }
    } catch (_) {
      return { xml: '', nodes: [], fromCache: false };
    }
  }
  if (!xml || !xml.includes('<node')) {
    dumpFailures++;
    if (dumpFailures <= 3 || dumpFailures % 10 === 0) {
      console.log(`  dumpUi: dump returned empty/invalid XML (${dumpFailures} total), length=${xml?.length || 0}`);
    }
    return { xml: xml || '', nodes: [], fromCache: false };
  }
  // Successful dump — reset consecutive failure counter
  dumpFailures = 0;
  const nodes = parseNodesFromXml(xml);
  // Successful dump — cache for rapid successive callers
  const result = { xml, nodes };
  _dumpCache = result;
  _dumpCacheTime = Date.now();
  return { xml, nodes, fromCache: false };
}

/**
 * Parse uiautomator XML into an array of attribute objects.
 * Extracted from dumpUi() so the warm-up dump can populate the cache
 * with real nodes (not an empty array) — without this, findNodes()
 * gets 30s of empty-cache hits before the TTL expires and a real
 * dump runs, wasting critical golden-path time.
 */
function parseNodesFromXml(xml) {
  if (!xml || !xml.includes('<node')) return [];
  const nodes = [];
  for (const nodeMatch of xml.matchAll(/<node\b([^>]*)\/?>(?:<\/node>)?/g)) {
    const attrs = {};
    for (const attr of nodeMatch[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = decode(attr[2]);
    }
    nodes.push(attrs);
  }
  return nodes;
}

function nodeMatches(node, label, exact) {
  return [node['content-desc'] || '', node.text || ''].some(
    (v) => (exact ? v === label : v.includes(label))
  );
}

function findNodes(label, exact = false) {
  const dump = dumpUi();
  const nodes = dump.nodes.filter((n) => nodeMatches(n, label, exact));
  nodes._fromCache = dump.fromCache;
  return nodes;
}

function bounds(node) {
  const m = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds || '');
  if (!m) throw new Error(`Invalid bounds for ${node.text || node['content-desc'] || 'node'}`);
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x1, y1, x2, y2, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

function swipeUp() {
  // Invalidate dump cache so the next findNodes captures post-swipe state.
  _dumpCache = null;
  shell('input', 'swipe', '540', '1850', '540', '650', '350');
  sleep(400);
}

function swipeToTop() {
  for (let i = 0; i < 5; i += 1) {
    try { shell('input', 'swipe', '540', '600', '540', '1900', '250'); } catch (_) {}
    sleep(150);
  }
}

function findVisible(label, { exact = false, scroll = true, last = false } = {}) {
  // 3 scroll attempts (down from 7) — each dump takes 30-60s on slow
  // emulators.  3 attempts × 30s = 90s max per findVisible, vs 7 × 30s
  // = 210s.  The golden path elements are near the top of the screen;
  // 3 scrolls are sufficient.  The dump cache prevents redundant dumps
  // within each scroll iteration.
  const attempts = scroll ? 3 : 1;
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
  // Invalidate dump cache after screen transition so the next dump
  // captures the new screen state rather than reusing stale XML.
  _dumpCache = null;
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

// Cold-start grace period: on API 35 x86_64 emulators under GitHub Actions
// load, React Native cold start can take up to 240 s.  During this window,
// the app process is alive and uiautomator dumps return valid XML with nodes
// — just not the expected label yet because Hermes is still initializing.
// The stuck-app detector must NOT fire during cold start, otherwise it
// force-stops a healthy-but-slow app and the cycle never recovers.
// 300 s (5 min) provides headroom beyond the documented 240 s worst case.
const COLD_START_GRACE_MS = 300_000;

function waitFor(label, timeoutMs = 10000, { graceMs = 0 } = {}) {
  const until = Date.now() + timeoutMs;
  const waitStart = Date.now();
  let previousDumpFailures = dumpFailures;
  let consecutiveDumpFails = 0;
  // Track successful dumps that return nodes but none match the expected label.
  // When the app process is alive but React Native is hung (e.g. Hermes bridge
  // blocked, splash screen stuck, SystemUI ANR), every dump returns valid XML
  // with nodes — just not the ones we need.  The crash detector (pidof) sees a
  // live process and does nothing, so the script burns through the full
  // timeout doing 30-60 s dumps that always miss.  After STUCK_APP_THRESHOLD
  // consecutive empty-match dumps we force-stop + relaunch to recover.
  //
  // HOWEVER: during cold start, 4 consecutive empty-match dumps (2-4 min)
  // can fire BEFORE the documented 240 s cold-start completes, killing a
  // healthy app.  The `graceMs` parameter (typically COLD_START_GRACE_MS)
  // suppresses stuck detection until the grace period has elapsed, giving
  // slow emulators time to finish Hermes initialization.
  let consecutiveEmptyMatchCount = 0;
  const STUCK_APP_THRESHOLD = 4; // ~4 × 30-60 s = 2-4 min before recovery
  let lastAppCheck = 0;
  while (Date.now() < until) {
    // App-alive check every 30s: if the app crashed mid-golden-path,
    // relaunch it immediately instead of burning 600 s on empty dumps.
    // This check is cheap (pidof = 1 adb shell command, < 2 s).
    const now = Date.now();
    if (now - lastAppCheck > 30_000) {
      lastAppCheck = now;
      try {
        const pid = shell('pidof', packageName).trim();
        if (!pid) {
          console.log(`  APP CRASHED while waiting for "${label}" — relaunching...`);
          // Invalidate dump cache so the first dump after relaunch is fresh
          _dumpCache = null;
          try { shell('am', 'force-stop', packageName); } catch (_) {}
          sleep(1000);
          try { shell('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'); } catch (_) {}
          sleep(15000); // Give the relaunched app time to initialize
          consecutiveEmptyMatchCount = 0; // Reset stuck counter after relaunch
          continue; // Re-enter the loop; the next dumpUi() will capture the new screen
        }
      } catch (err) {
        // Distinguish pidof's 'no process' exit (status === 1) from adb
        // transport errors.  Android toybox pidof exits 1 when no process
        // matches — this means the app is dead and must be relaunched.
        // Transport errors (ETIMEDOUT, adb disconnect) mean we cannot
        // determine process state; continue the normal wait and let
        // adbReconnect() handle it on the next dump failure.
        if (err && err.status === 1) {
          console.log(`  APP CRASHED while waiting for "${label}" (pidof exit 1) — relaunching...`);
          _dumpCache = null;
          try { shell('am', 'force-stop', packageName); } catch (_) {}
          sleep(1000);
          try { shell('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'); } catch (_) {}
          sleep(15000);
          consecutiveEmptyMatchCount = 0;
          continue;
        }
        // Transport or other adb error — cannot determine process state;
        // proceed with normal wait (dump failures will trigger reconnect).
      }
    }
    const nodes = findNodes(label);
    if (nodes.length) return;
    // Track successful-but-empty dumps: only count REAL dumps (cache miss)
    // that returned no matching node.  Cache hits must NOT increment the counter
    // — the dump cache returns the same result without touching dumpFailures,
    // so the dumpFailures <= previousDumpFailures condition would be satisfied
    // by cache hits, causing false-positive force-stops during normal cold
    // starts or screen transitions.
    if (!nodes._fromCache && dumpFailures <= previousDumpFailures) {
      // Dump succeeded (no failure increment) but the label wasn't found.
      const elapsedMs = Date.now() - waitStart;
      if (elapsedMs < graceMs) {
        // Still within cold-start grace period.  Successful-but-empty dumps
        // are expected — the app is alive and rendering, just not ready yet.
        // Log periodically so the evidence shows cold-start progress.
        if (consecutiveEmptyMatchCount === 0 || consecutiveEmptyMatchCount % 2 === 0) {
          console.log(`  COLD-START GRACE: ${Math.round(elapsedMs / 1000)}s elapsed (< ${Math.round(graceMs / 1000)}s grace) — ${consecutiveEmptyMatchCount} empty dumps so far for "${label}", app alive`);
        }
      } else {
        // Grace period elapsed — count toward stuck threshold.
        consecutiveEmptyMatchCount += 1;
      }
      if (consecutiveEmptyMatchCount >= STUCK_APP_THRESHOLD) {
        console.log(`  APP STUCK: ${consecutiveEmptyMatchCount} consecutive dumps with no "${label}" match after ${Math.round((Date.now() - waitStart) / 1000)}s — force-stopping and relaunching...`);
        _dumpCache = null;
        try { shell('am', 'force-stop', packageName); } catch (_) {}
        sleep(2000);
        try { shell('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'); } catch (_) {}
        sleep(15000); // Give the relaunched app time to initialize
        consecutiveEmptyMatchCount = 0;
        // Check if relaunch restored the app
        try {
          const pid = shell('pidof', packageName).trim();
          console.log(`  Post-relaunch process state: pid=${pid || 'NOT FOUND'}`);
        } catch (_) {}
        continue;
      }
    }
    // Detect if the dump that just ran inside findNodes failed (uiautomator
    // command error, not just empty result)
    if (dumpFailures > previousDumpFailures) {
      consecutiveDumpFails += dumpFailures - previousDumpFailures;
      consecutiveEmptyMatchCount = 0; // Reset stuck counter on dump failure
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
  // On timeout, capture comprehensive diagnostic evidence for the next cycle
  console.log(`  TIMEOUT: waitFor("${label}") after ${timeoutMs}ms — capturing diagnostic evidence`);
  try {
    const logcat = adb(['logcat', '-d', '-t', '80'], { timeoutMs: 10_000 });
    const logcatPath = path.join(outputDir, `logcat-wait-${label.replace(/\s+/g, '_')}.txt`);
    fs.writeFileSync(logcatPath, logcat);
    console.log(`  Logcat on timeout saved to ${logcatPath}`);
  } catch (_) {
    console.log('  Could not capture logcat on timeout');
  }
  // Capture dumpsys activity for diagnosis — shows what's actually on screen
  try {
    const activityInfo = adb(['shell', 'dumpsys', 'activity', 'top'], { timeoutMs: 15_000 });
    const activityPath = path.join(outputDir, `dumpsys-wait-${label.replace(/\s+/g, '_')}.txt`);
    fs.writeFileSync(activityPath, activityInfo);
    console.log(`  Dumpsys activity on timeout saved to ${activityPath}`);
  } catch (_) {
    console.log('  Could not capture dumpsys activity on timeout');
  }
  // Capture current process state
  try {
    const pid = shell('pidof', packageName).trim();
    console.log(`  App process state at timeout: pid=${pid || 'NOT FOUND'}`);
    if (!pid) {
      console.log('  App process is NOT running — likely crashed during cold start');
    }
  } catch (_) {}
  // Capture the current UI dump content so the next cycle can see exactly
  // what was on screen at timeout.  The dump XML is otherwise only saved to
  // the artifact directory, which is NOT uploaded when the step fails (the
  // upload step has no if: always()), so echoing the text/content-desc nodes
  // here is the only way the evidence survives in the step logs.
  try {
    const dump = dumpUi();
    const visible = dump.nodes
      .filter((n) => n.text || n['content-desc'])
      .map((n) => `text="${n.text || ''}" desc="${n['content-desc'] || ''}" class=${n.class || ''}`)
      .slice(0, 40);
    console.log(`  UI dump at timeout (${dump.nodes.length} nodes):`);
    console.log(`  ${visible.join('\n  ') || '(no text/content-desc nodes found)'}`);
  } catch (_) {
    console.log('  Could not capture UI dump at timeout');
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function assertAbsent(label) {
  if (findNodes(label).length) throw new Error(`Expected ${label} to be absent`);
}

function screenshot(name) {
  const prefix = `${String(checkpoints.length + 1).padStart(2, '0')}-${name}`;
  const file = path.join(outputDir, `${prefix}.png`);
  // screencap via exec-out — same ETIMEDOUT risk as UI dump, so fall back
  // to shell-based pull on failure.  Both paths are best-effort; the E2E
  // result is independent of screenshot success.
  try {
    fs.writeFileSync(file, adb(['exec-out', 'screencap', '-p'], { binary: true, timeoutMs: 30_000 }));
  } catch (_) {
    // Fallback: write screencap to device, pull via shell cat (binary may be
    // corrupt but better than no screenshot for post-mortem diagnosis).
    try {
      shell('screencap', '-p', '/sdcard/chorescore-e2e-screen.png');
      const data = adb(['shell', 'cat', '/sdcard/chorescore-e2e-screen.png'], { binary: true, timeoutMs: 30_000 });
      fs.writeFileSync(file, data);
    } catch (_) {
      // Screencap failed completely — record checkpoint without file
    }
  }
  // Reuse the cached dump when available.  Each uiautomator dump takes
  // 30-60 s on API 35 x86_64; triggering one per screenshot wastes
  // ~30 s when the cache (< 30 s old) still reflects the same screen.
  // Only force a fresh dump when the cache is stale or empty.
  let uiDump = null;
  try {
    const now = Date.now();
    const cacheFresh = _dumpCache && (now - _dumpCacheTime) < DUMP_CACHE_TTL_MS;
    const dump = cacheFresh ? _dumpCache : dumpUi();
    if (dump && dump.xml) {
      const uiFile = path.join(outputDir, `${prefix}.xml`);
      fs.writeFileSync(uiFile, dump.xml);
      uiDump = path.basename(uiFile);
    }
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
  // 30s is sufficient: the process check below catches any crash, and the
  // Demarrer waitFor() window provides additional headroom for Hermes init.
  // Avoid 60s here because the Demarrer window is the real deadline, not
  // this initial sleep.
  sleep(30000);
  // Ensure adb transport is healthy after the cold-start phase.
  // Do NOT call adbReconnect() (kill-server + start-server) here — it
  // disrupts the adb connection right when the uiautomator server needs
  // to initialize, and the adb function's own retry+reconnect logic
  // handles transient transport issues within each call.
  try { adb(['wait-for-device'], { timeoutMs: 10_000, allowReconnect: false }); } catch (_) {}

  // Fast app-readiness check via dumpsys activity (1-2s).  On API 35
  // x86_64 under React Native cold-start load, uiautomator dump is the
  // primary bottleneck.  We:
  // 1. Poll dumpsys activity to confirm the app activity is in foreground
  // 2. Give uiautomator 5s to initialize
  // This is fast and reliable; the real uiautomator warm-up happens at
  // the end of launch() after the app is in foreground.
  console.log('  Checking app readiness via dumpsys activity...');
  let appReady = false;
  for (let i = 0; i < 3; i++) {
    try {
      const topActivity = adb(['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 10_000, retries: 1 });
      if (topActivity.includes(packageName)) {
        console.log(`  App activity found in foreground after ${(i + 1) * 5}s`);
        appReady = true;
        break;
      }
    } catch (_) {}
    sleep(5000);
  }
  if (!appReady) {
    console.log('  WARN: App activity not detected in dumpsys after 15s — proceeding anyway');
  }

  // Brief settle for uiautomator server initialization (5s vs 45s warm-up).
  // The first real dumpUi() call in waitFor() will serve as the actual
  // warm-up; the dump cache prevents redundant calls within rapid sequences.
  sleep(5000);

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

  // Warm up uiautomator server before the golden path begins.
  // On API 35 x86_64 under React Native cold-start load, the uiautomator
  // server can take 30-60s to initialize and often fails on the first dump.
  // A warm-up dump forces the server to initialize, so the first real
  // dumpUi() call in the golden path succeeds immediately instead of
  // burning 30-60s on a cold-start failure that cascades into timeouts.
  // The warm-up result is cached with parsed nodes so the first findNodes()
  // in waitFor() reuses it directly (no 30s dead-spin on empty-cache hits).
  // The warm-up is best-effort: if it fails, the golden path's long
  // waitFor windows (600s Demarrer, 120s others) provide headroom.
  console.log('  Warming up uiautomator server...');
  try {
    shell('rm', '-f', '/sdcard/chorescore-window.xml');
    shell('uiautomator', 'dump', '/sdcard/chorescore-window.xml', { timeoutMs: 60_000, retries: 1 });
    const warmupXml = adb(['shell', 'cat', '/sdcard/chorescore-window.xml'], { timeoutMs: 30_000, retries: 1 });
    if (warmupXml && warmupXml.includes('<node')) {
      const warmupNodes = parseNodesFromXml(warmupXml);
      console.log(`  uiautomator server ready — warm-up dump successful (${warmupNodes.length} nodes)`);
      // Cache the warm-up dump WITH parsed nodes so the first findNodes()
      // in waitFor() can match elements immediately instead of spinning
      // on an empty cache for 30s until the TTL expires.
      _dumpCache = { xml: warmupXml, nodes: warmupNodes };
      _dumpCacheTime = Date.now();
    } else {
      console.log('  WARN: uiautomator warm-up returned empty XML — proceeding anyway');
    }
  } catch (err) {
    console.log(`  WARN: uiautomator warm-up failed — proceeding anyway: ${err.message?.slice(0, 100) || err}`);
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
  // API 35 x86_64 cold start can be very slow — 600s (10 min) timeout.
  // The dump cache (30s TTL, invalidated on tap/swipe) ensures rapid
  // same-screen checks share one dump (~30-60s each on slow emulators),
  // while screen transitions always trigger fresh dumps.  Combined with
  // the reduced dumpsys pre-check (15s vs 60s), the golden path fits
  // within the step timeout even on the slowest API 35 x86_64 runs.
  //
  // graceMs: suppress the stuck-app detector during cold start (first 5 min).
  // On slow emulators, the app process is alive and dumps return valid XML
  // with nodes — just not "Demarrer" yet because Hermes is still initializing.
  // Without grace, 4 consecutive empty dumps (2-4 min) fires before the
  // documented 240s cold start completes, killing a healthy app.
  waitFor('Demarrer', 600000, { graceMs: COLD_START_GRACE_MS });
  screenshot('01-login');
  tapLabel('Demarrer', { exact: false });
  console.log('Waiting for Appartement group...');
  // 120s timeout: after tapping Demarrer, the app completes demo sign-in
  // (which seeds the fixture via SQLite) and renders the groups list.  On
  // a cold API 35 x86_64 emulator, sign-in + fixture seeding can take
  // 30-60s, and the first uiautomator dump adds another 30-60s.  A 60s
  // timeout only fits one dump attempt; 120s gives 2-3 attempts.
  waitFor('Appartement', 120000);
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
  // 120s timeout: a single uiautomator dump takes 30-60s on slow
  // emulators, so 120s gives 2-3 dump attempts per element.
  waitFor('Ajouter', 120000);
  waitFor('Balances', 120000);
  waitFor('A faire', 120000);
  screenshot('03-tabs');

  // Verify three tabs are present
  const tabNodes = findNodes('Ajouter');
  if (tabNodes.length < 1) throw new Error('Ajouter tab not found');
  console.log('Tabs verified: Ajouter, Balances, A faire');

  // 3. Verify existing demo contribution is visible
  console.log('Waiting for demo contribution "Vaisselle du soir"...');
  // 120s: single dump takes 30-60s on slow emulators
  waitFor('Vaisselle du soir', 120000);
  screenshot('04-add-tab');

  // 4. Verify contribution form fields exist (V3: no chrono!)
  assertAbsent('Chrono');
  assertAbsent('Chronometre');
  assertAbsent('Duree reelle');

  // 5. Switch to Balances tab
  console.log('Switching to Balances tab...');
  tapLabel('Balances', { exact: true });
  // 120s: single dump takes 30-60s on slow emulators
  waitFor('Alex', 120000);
  waitFor('Sam', 120000);
  screenshot('05-balances');

  // 6. Verify dual ledger sections
  console.log('Verifying Contribution section...');
  waitFor('Contribution', 120000);
  screenshot('06-balances-detail');

  // 7. Switch to A faire tab
  console.log('Switching to A faire tab...');
  tapLabel('A faire', { exact: true });
  console.log('Waiting for demo todo "Sortir les poubelles"...');
  // 120s: single dump takes 30-60s on slow emulators
  waitFor('Sortir les poubelles', 120000);
  screenshot('07-todos');

  // 8. Switch back to Ajouter to verify tab switching doesn't reload
  tapLabel('Ajouter', { exact: true });
  // 120s: single dump takes 30-60s on slow emulators
  waitFor('Vaisselle du soir', 120000);
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
