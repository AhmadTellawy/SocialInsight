@echo off
echo Starting SocialInsight Backend...
start cmd /k "cd server && npm run dev"

echo Starting SocialInsight Frontend...
start cmd /k "npm run dev"

echo Both servers are starting! You can close this window.
exit
