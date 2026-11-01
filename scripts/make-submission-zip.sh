#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="CSE6332_Project3_AaronPantoja.zip"
out="$root/dist/$name"

mkdir -p "$root/dist"
rm -f "$out"

cd "$root"
zip -r "$out" \
  Dockerfile docker-compose.yaml render.yaml docker-entrypoint.sh supervisord.conf \
  .dockerignore README.md app mysql nginx scripts screenshots \
  -x 'app/node_modules/*' -x '*.DS_Store' >/dev/null

cp "$out" "$HOME/Desktop/$name"

echo "Wrote $out"
echo "Copied to $HOME/Desktop/$name"
echo
unzip -l "$out" | grep -E 'screenshots|files$'
