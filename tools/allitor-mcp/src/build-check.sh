#!/usr/bin/env bash
# allitor-build-check: run a build command with bounded retries on transient failures, then self-check.
# Usage: allitor-build-check [--retries N] [--expect FILE]... -- <command...>
# Own implementation (MIT). Only known-transient failures are retried; real compile errors fail fast
# and the first error lines are summarised so the agent can fix the code instead of looping.
set -u
retries=2; expects=()
while [ $# -gt 0 ]; do
  case "$1" in
    --retries) retries="${2:-}"; shift 2;;
    --expect) expects+=("${2:-}"); shift 2;;
    --version) echo "allitor-build-check 0.1.0"; exit 0;;
    --) shift; break;;
    *) break;;
  esac
done
[ $# -gt 0 ] || { echo "usage: allitor-build-check [--retries N] [--expect FILE]... -- command..." >&2; exit 64; }
[[ "$retries" =~ ^[0-9]+$ ]] || { echo "bad --retries" >&2; exit 64; }
(( retries > 5 )) && retries=5
log="$(mktemp "${TMPDIR:-/tmp}/allitor-build-check.XXXXXX")"; trap 'rm -f "$log"' EXIT
transient='Could not resolve host|Connection (reset|refused|timed out)|Read timed out|Temporary failure in name resolution|Gradle build daemon disappeared|daemon .*(crashed|disappeared)|OutOfMemoryError|^Killed|Could not GET|ETIMEDOUT|ECONNRESET|EAI_AGAIN|Timeout waiting to lock'
attempt=0
while :; do
  attempt=$((attempt + 1))
  echo "== allitor-build-check: attempt $attempt/$((retries + 1)): $*" >&2
  "$@" 2>&1 | tee "$log"; rc=${PIPESTATUS[0]}
  (( rc == 0 )) && break
  if (( attempt <= retries )) && grep -Eq "$transient" "$log"; then
    wait=$(( attempt * 5 )); echo "== transient failure (rc=$rc), retrying in ${wait}s" >&2; sleep "$wait"; continue
  fi
  echo "== FAILED rc=$rc after $attempt attempt(s). First errors:" >&2
  grep -En '(^|[^a-z])(error|e:|FAILED|fatal)[: ]' "$log" | head -n 15 >&2
  exit "$rc"
done
bad=0
for f in "${expects[@]}"; do
  if [ -s "$f" ]; then echo "== self-check ok: $f ($(wc -c < "$f") bytes)" >&2
  else echo "== self-check FAILED: expected output missing or empty: $f" >&2; bad=1; fi
done
(( bad == 0 )) || exit 65
echo "== allitor-build-check: success after $attempt attempt(s)" >&2
