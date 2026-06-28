#!/bin/bash
# Set your Anthropic API key as a Supabase secret.
# Double-click this file to run it in Terminal.

PROJECT_REF="dhwvyvqfrtbbvxuztqld"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Set Anthropic API Key for AI Features   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "You need an Anthropic API key for the year/genre AI enrichment."
echo "Get one at: https://console.anthropic.com"
echo ""
read -p "Paste your Anthropic API key here: " ANTHROPIC_KEY

if [ -z "$ANTHROPIC_KEY" ]; then
  echo "No key entered. Exiting."
  exit 1
fi

supabase secrets set ANTHROPIC_API_KEY="$ANTHROPIC_KEY" --project-ref "$PROJECT_REF"
echo ""
echo "✅  Key saved. AI enrichment is now active."
echo ""
read -p "Press Enter to close..."
