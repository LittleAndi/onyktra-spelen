#!/usr/bin/env bash
# Skapar ett GitHub-issue per "## "-rubrik i docs/ISSUES.md. Kräver GitHub CLI (gh auth login).
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
awk -v dir="$tmp" '
  /^## / { n++; title=substr($0,4); file=sprintf("%s/%02d", dir, n); print title > (file ".title"); next }
  n>0 && !/^---$/ { print > (file ".body") }
' docs/ISSUES.md
for t in "$tmp"/*.title; do
  base="${t%.title}"
  gh issue create --title "$(cat "$t")" --body-file "$base.body"
done
rm -rf "$tmp"
