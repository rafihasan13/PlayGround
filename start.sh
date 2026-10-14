#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p pwd
PORT="${PORT:-3000}"
/usr/bin/time -p test -f dist/index.html
PROJECT_ROOT="$(/usr/bin/time -p pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
/usr/bin/time -p mkdir -p "$WEB_DIR"
/usr/bin/time -p test -d "$DIST_DIR"
/usr/bin/time -p python3 -c "import json; json.dump({'project': '$PROJECT_ROOT', 'directory': '$DIST_DIR'}, open('$WEB_DIR/deployment-output.json','w'))"
/usr/bin/time -p cat "$WEB_DIR/deployment-output.json"
if /usr/bin/time -p test -f package.json; then
  /usr/bin/time -p npm install --no-audit --no-fund
  if /usr/bin/time -p python3 -c "import json; print(json.load(open('package.json')).get('scripts',{}).get('build',''))" | /usr/bin/time -p grep -q .; then
    /usr/bin/time -p npm run build
  fi
fi
echo "Serving $DIST_DIR on port $PORT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIST_DIR"
