#!/usr/bin/env bash
# Refuses to let a secret be committed again.
#
# This repository is public, and apps/api/.env.example once carried a working JWT signing secret and a real admin
# password — in a file the README tells every new machine to copy. Nothing noticed for months. This is what notices now.
# It runs in CI (.github/workflows/ci.yml) and is worth running by hand before a commit:
#
#   ./scripts/check-committed-secrets.sh
#
# Deliberately narrow: three rules that can be decided mechanically, with no false positives to train anyone to ignore
# it. It is not a general secret scanner and does not pretend to be one.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { printf '  %s\n' "$1"; fail=1; }

# Values this repository has already published, as sha256 digests so the plaintext is not republished here. The same
# list is enforced at runtime in apps/api/src/config/env.ts, which refuses to start the server on one.
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

burned_digest() {
  case "$1" in
    e0387e785d44c159c2c321d97306e874e0d60efa2f66fe09910d0d21f1a56353) return 0 ;;   # the old JWT_ACCESS_SECRET
    e9001b79ba46aa909783d36f1f8274d498a82da37b3d34c955dd70ff3f2943a1) return 0 ;;   # the old SEED_ADMIN_PASSWORD
    f757709ea42f2f0823bb63b83613f116c77b4215b565786ec8b19c2a662e6c93) return 0 ;;   # the old database password
  esac
  return 1
}

# Keys that hold a credential. Matched by suffix so it cannot drift into durations and counts (ACCESS_TOKEN_TTL_SECONDS,
# REFRESH_TOKEN_TTL_DAYS) that merely contain the word "TOKEN".
is_secret_key() {
  case "$1" in
    *TTL*|*_SECONDS|*_DAYS|*_MINUTES|*_HOURS|*_MS|*_COUNT|*_LIMIT|*_PROVIDER|*_NAME|*_ID) return 1 ;;
    *_SECRET|*_PASSWORD|*_API_KEY|*_PRIVATE_KEY|*_TOKEN|*_CREDENTIALS) return 0 ;;
  esac
  return 1
}

is_placeholder() {
  case "$1" in
    ''|CHANGE_ME|changeme|change-me*|replace-me|TODO|xxx*|'<'*'>'|'${'*) return 0 ;;
  esac
  return 1
}

# ---- rule 1: a real env file must never be tracked. Only *.env.example templates belong in git. --------------------
tracked_env=$(git ls-files | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo "A real env file is tracked by git:"
  while IFS= read -r f; do note "$f"; done <<< "$tracked_env"
fi

# ---- rules 2 and 3: every value in a committed example ---------------------------------------------------------------
while IFS= read -r file; do
  [ -f "$file" ] || continue
  lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in \#*|'') continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    case "$key" in *[!A-Z0-9_]*) continue ;; esac            # not a KEY=value line
    value=${line#*=}
    value=${value%%#*}                                        # drop a trailing comment
    value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")

    # rule 2: never reintroduce a value this repository has already leaked, under ANY key.
    if [ -n "$value" ] && burned_digest "$(printf '%s' "$value" | sha256)"; then
      note "$file:$lineno: $key is a value this repository already published — generate a new one and rotate it"
      continue
    fi

    # rule 3: a key that holds a credential must be left empty for whoever sets it up.
    if is_secret_key "$key" && ! is_placeholder "$value"; then
      note "$file:$lineno: $key carries a value; leave it empty in a committed example"
    fi
  done < "$file"
done < <(git ls-files '*.env.example' '.env.example')

if [ "$fail" -ne 0 ]; then
  echo
  echo "Refusing: this repository is public, so a committed secret is a published secret."
  echo "Leave the value empty in the example, keep the real one in the untracked .env, and ROTATE anything already pushed."
  exit 1
fi
echo "no committed secrets found"
