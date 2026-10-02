"""Chromium's mandatory proxy: public HTTP(S) only, with DNS answers pinned per connection.

This is a browser policy boundary, not a replacement for a VM against hostile code.
"""
import ipaddress
import select
import socket
import socketserver
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit


def public_address(address):
    ip = ipaddress.ip_address(address)
    if ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo):
        return False
    return ip.is_global and not ip.is_multicast


def connect_public(host, port):
    if port not in (80, 443):
        raise ValueError('Port blocked')
    answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not answers or any(not public_address(item[4][0]) for item in answers):
        raise ValueError('Private destination blocked')
    for family, kind, proto, _, address in answers:
        remote = socket.socket(family, kind, proto)
        remote.settimeout(15)
        try:
            remote.connect(address)  # The validated IP, never another DNS lookup.
            return remote
        except OSError:
            remote.close()
    raise OSError('Destination unavailable')


def relay(client, remote):
    while True:
        ready, _, _ = select.select([client, remote], [], [], 60)
        if not ready:
            return
        for source in ready:
            data = source.recv(65536)
            if not data:
                return
            (remote if source is client else client).sendall(data)


class Proxy(BaseHTTPRequestHandler):
    rbufsize = 0
    timeout = 30

    def log_message(self, *_):
        pass  # Do not record users' browsing history in the host logs.

    def do_CONNECT(self):
        established = False
        try:
            url = urlsplit('https://' + self.path)
            if url.username or url.password or url.path or url.query or url.fragment:
                raise ValueError('Invalid tunnel')
            with connect_public(url.hostname, url.port or 443) as remote:
                self.send_response(200, 'Connection Established')
                self.end_headers()
                established = True
                relay(self.connection, remote)
        except (OSError, ValueError):
            if not established:
                self.send_error(403, 'Destination unavailable or not public')
        finally:
            self.close_connection = True

    def forward(self):
        started = False
        try:
            url = urlsplit(self.path)
            if url.scheme != 'http' or not url.hostname or url.username or url.password or url.fragment:
                raise ValueError('Invalid HTTP destination')
            with connect_public(url.hostname, url.port or 80) as remote:
                route = (url.path or '/') + ('?' + url.query if url.query else '')
                headers = [f'{self.command} {route} HTTP/1.1', f'Host: {url.netloc}', 'Connection: close']
                for name, value in self.headers.items():
                    if name.lower() not in ('host', 'connection', 'proxy-authorization', 'proxy-connection'):
                        headers.append(f'{name}: {value}')
                remote.sendall(('\r\n'.join(headers) + '\r\n\r\n').encode('latin-1'))
                started = True
                relay(self.connection, remote)
        except (OSError, ValueError):
            if not started:
                self.send_error(403, 'Destination unavailable or not public')
        finally:
            self.close_connection = True

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = forward


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('127.0.0.1', 8888), Proxy) as server:
        server.serve_forever()
