ARG BASE_IMAGE=ghcr.io/m1k1o/neko/chromium:3
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY configure.py /opt/novaris/configure.py
COPY egress.py /opt/novaris/egress.py
COPY egress.conf /etc/neko/supervisord/novaris-egress.conf
RUN python3 /opt/novaris/configure.py
