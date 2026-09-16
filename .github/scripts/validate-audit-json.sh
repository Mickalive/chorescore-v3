#!/usr/bin/env bash
set -euo pipefail
file="${1:?file}"; cycle="${2:?cycle}"
jq -e --arg cycle "$cycle" '
  .schemaVersion==1 and (.cycle|tostring)==$cycle and .role=="builder" and
  (.decision=="accept" or .decision=="repair" or .decision=="reject") and
  (.summary|type=="string" and length>0) and (.checks|type=="array") and (.findings|type=="array") and
  all(.findings[]?; (.path|type)=="string" and (.problem|type)=="string" and (.evidence|type)=="string" and (.mustFix|type)=="boolean" and (.requiredFix|type)=="string" and (.verification|type)=="string") and
  (if .decision=="accept" then all(.findings[]?;.mustFix==false) else any(.findings[]?;.mustFix==true) end)
' "$file" >/dev/null
