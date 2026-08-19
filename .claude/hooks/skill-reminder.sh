#!/usr/bin/env bash
# PreToolUse hook: maps the file about to be written to the skill that governs it,
# and injects a reminder into the model's context. Silent for unmapped paths.
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

case "$file" in
  */node_modules/*) exit 0 ;;
esac

case "$file" in
  */tests/*)                          skill="writing-tests" ;;
  */package.json|*/package-lock.json|*/CHANGELOG.md)
                                      skill="bumping-cli-version" ;;
  */lib/*|*/bin/*)                    skill="adding-methods" ;;
  *)                                  exit 0 ;;
esac

jq -n --arg s "$skill" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: ("This file is governed by the \"" + $s +
      "\" skill. If you have not already read .claude/skills/" + $s +
      "/SKILL.md this session, read it now and follow it for this edit.")
  }
}'
