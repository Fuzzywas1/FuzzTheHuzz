import socket
import http.client
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from egress import Proxy, Server, connect_public, public_address


class EgressTests(unittest.TestCase):
    def test_private_destinations_are_blocked(self):
        for address in ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2002:0808:0808::1']:
            self.assertFalse(public_address(address), address)
        self.assertTrue(public_address('8.8.8.8'))
        self.assertTrue(public_address('2606:4700:4700::1111'))

    def test_mixed_public_and_private_dns_answers_fail_closed(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in ['8.8.8.8', '192.168.1.1']]
        with patch('socket.getaddrinfo', return_value=answers), patch('socket.socket') as create:
            with self.assertRaises(ValueError):
                connect_public('mixed.example', 443)
            create.assert_not_called()

    def test_connection_uses_validated_ip_not_hostname(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]
        with patch('socket.getaddrinfo', return_value=answers) as resolve, patch('socket.socket') as create:
            connect_public('public.example', 443)
            resolve.assert_called_once()
            create.return_value.connect.assert_called_once_with(('8.8.8.8', 443))

    def test_non_web_ports_blocked_before_dns(self):
        with patch('socket.getaddrinfo') as resolve:
            with self.assertRaises(ValueError):
                connect_public('public.example', 8092)
            resolve.assert_not_called()

    def test_http_proxy_preserves_post_body_and_strips_proxy_credentials(self):
        observed = []

        class Destination(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                observed.append((self.path, self.headers.get('Proxy-Authorization'), body))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

        destination = ThreadingHTTPServer(('127.0.0.1', 0), Destination)
        proxy = Server(('127.0.0.1', 0), Proxy)
        for server in (destination, proxy):
            threading.Thread(target=lambda s=server: s.serve_forever(poll_interval=0.01), daemon=True).start()
        connection = http.client.HTTPConnection(*proxy.server_address, timeout=3)
        try:
            with patch('egress.connect_public', side_effect=lambda *_: socket.create_connection(destination.server_address)):
                connection.request('POST', 'http://public.example/test?q=1', body=b'body-content', headers={'Proxy-Authorization': 'private'})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b'body-content')
            self.assertEqual(observed, [('/test?q=1', None, b'body-content')])
        finally:
            connection.close()
            for server in (proxy, destination):
                server.shutdown()
                server.server_close()

    def test_connect_tunnel_relays_bytes(self):
        proxy = Server(('127.0.0.1', 0), Proxy)
        threading.Thread(target=lambda: proxy.serve_forever(poll_interval=0.01), daemon=True).start()
        proxy_end, echo_end = socket.socketpair()
        echo_end.settimeout(3)
        client = socket.create_connection(proxy.server_address, timeout=3)
        try:
            with patch('egress.connect_public', return_value=proxy_end):
                client.sendall(b'CONNECT public.example:443 HTTP/1.1\r\nHost: public.example\r\n\r\n')
                reply = b''
                while b'\r\n\r\n' not in reply:
                    reply += client.recv(1024)
                self.assertIn(b'200 Connection Established', reply)
                client.sendall(b'tls-test-bytes')
                self.assertEqual(echo_end.recv(1024), b'tls-test-bytes')
                echo_end.sendall(b'reply-bytes')
                self.assertEqual(client.recv(1024), b'reply-bytes')
        finally:
            client.close()
            echo_end.close()
            proxy.shutdown()
            proxy.server_close()


if __name__ == '__main__':
    unittest.main()
