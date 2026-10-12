#!/bin/bash
# Lets 8-bit Voice's release workflow sign the Mac app's updates, once, from
# the Mac that holds pitch.dog's update key (the same key OOO, Backdrop, Deck
# Beat, Drift and Galileo use):
#
#   bash scripts/auto-signing-setup.sh
#
# It makes a `release` environment in bomkino/8bit-Voice that only main may
# use, and puts the key in it as the SPARKLE_PRIVATE_KEY secret. The key goes
# from its file straight to gh, which encrypts it for GitHub; it is never
# printed. Running it again is harmless. See docs/UPDATES.md.
set -euo pipefail
KEY="${SPARKLE_KEY:-$HOME/Library/Application Support/pitch.dog/Release Keys/sparkle-ed25519-private.key}"
REPO=bomkino/8bit-Voice

[ -f "$KEY" ] || { echo "No update key at $KEY"; exit 1; }
command -v gh >/dev/null || { echo "Needs the GitHub CLI: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh isn't signed in: run gh auth login"; exit 1; }

echo "== $REPO"
echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT "repos/$REPO/environments/release" --input - >/dev/null
if ! gh api "repos/$REPO/environments/release/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
  gh api -X POST "repos/$REPO/environments/release/deployment-branch-policies" -f name=main -f type=branch >/dev/null
fi
gh secret set SPARKLE_PRIVATE_KEY --env release -R "$REPO" < "$KEY"
echo
echo "Done. 8-bit Voice's releases now sign their own Mac updates."
