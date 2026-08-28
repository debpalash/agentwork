#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(dirname -- "$script_dir")"
ui_root="$project_root/frontend/src"
ui_entry="$project_root/frontend/index.html"
forbidden='—|–|🚀|✅|🏆|💰|⚡|🏷|📌|⚖|✕|◆|◈|◇|◎|⌘|∞|→|←|↔|✓|✗'

if rg -n "$forbidden" "$ui_root" "$ui_entry"; then
  echo "UI copy contains forbidden decorative glyphs or dash characters." >&2
  exit 1
fi

if rg -n 'tty-terminal|land-hero-terminal|open_problem_protocol|AUTH_ERR|NULL_REFERENCE|AWAITING_SUBCONTRACTOR' "$ui_root"; then
  echo "UI contains deprecated terminal or protocol-theater language." >&2
  exit 1
fi

if find "$ui_root" -type f \( -name '*.js' -o -name '*.jsx' \) -print -quit | grep -q .; then
  echo "Frontend source must remain TypeScript-only." >&2
  exit 1
fi

echo "UI quality checks passed."
