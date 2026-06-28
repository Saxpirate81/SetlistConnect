#!/bin/bash
cd "/Users/williamdoss/Setlist Connect"
echo "Pushing to GitHub..."
git add -A
git commit -m "Fix build errors: unused imports, Role type, QuickAddSong props, Deno ts-nocheck" 2>/dev/null || echo "(nothing new to commit)"
git push origin main
echo ""
echo "Deploying to Vercel..."
vercel --prod
echo ""
read -p "Press Enter to close..."
