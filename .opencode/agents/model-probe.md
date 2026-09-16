---
description: Minimal tool-call health probe.
mode: primary
model: opencode/mimo-v2.5-free
temperature: 0
permission:
  edit: deny
  bash:
    "*": deny
    "cat .factory-probe-target": allow
  task: deny
  webfetch: deny
  websearch: deny
---
Use the bash tool exactly as requested by the probe. Do not guess file contents.
