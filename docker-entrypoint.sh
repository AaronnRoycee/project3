#!/bin/sh
set -e

mkdir -p /var/run/mysqld
chown mysql:mysql /var/run/mysqld

export PORT="${PORT:-8080}"
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
nginx -t

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
