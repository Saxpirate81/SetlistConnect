#!/bin/bash
# Setlist Connect — one-click setup
# Double-click this file to run it in Terminal automatically.

set -e
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setlist Connect — Supabase Setup       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

PROJECT_REF="dhwvyvqfrtbbvxuztqld"

echo "▶ Step 1/3 — Pushing database migrations..."
supabase db push --project-ref "$PROJECT_REF"
echo "✓ Migrations done"
echo ""

echo "▶ Step 2/3 — Deploying search-youtube function..."
supabase functions deploy search-youtube --project-ref "$PROJECT_REF"
echo "✓ search-youtube deployed"
echo ""

echo "▶ Step 3/3 — Deploying enrich-song-metadata function..."
supabase functions deploy enrich-song-metadata --project-ref "$PROJECT_REF"
echo "✓ enrich-song-metadata deployed"
echo ""

echo "╔══════════════════════════════════════════╗"
echo "║   ✅  All done! You can close this.      ║"
echo "╚══════════════════════════════════════════╝"
echo ""
read -p "Press Enter to close..."
