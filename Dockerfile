FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=8080

RUN printf 'exit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gettext-base nginx mysql-server redis-server supervisor \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default

COPY mysql/conf.d/zz-course.cnf /etc/mysql/mysql.conf.d/zz-course.cnf
COPY mysql/init/ /tmp/init/

RUN mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld \
 && if [ ! -d /var/lib/mysql/mysql ]; then \
        mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql; \
    fi \
 && mysqld --user=mysql --daemonize --skip-networking \
 && for i in $(seq 1 60); do mysqladmin ping --silent && break; sleep 1; done \
 && mysql -u root < /tmp/init/01-classicmodels.sql \
 && mysql -u root < /tmp/init/02-shift-dates.sql \
 && mysql -u root < /tmp/init/03-users.sql \
 && mysqladmin -u root shutdown \
 && rm -rf /tmp/init

COPY app/package.json app/package-lock.json /opt/app/
RUN cd /opt/app && npm ci --omit=dev && npm cache clean --force

COPY app/ /opt/app/
RUN mkdir -p /var/www/html && cp -r /opt/app/public/. /var/www/html/

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
