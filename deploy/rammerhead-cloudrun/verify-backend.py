"""Read the secret from stdin; never print it or place it in a request URL."""
import re
import sys
import urllib.request

base = sys.argv[1]
key = sys.stdin.read().strip()
if not key:
    raise SystemExit("Could not read backend secret")


def command(path):
    request = urllib.request.Request(base + path, headers={"x-novaris-rh-key": key})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(1024).decode().strip()


session = command("/newsession")
if not re.fullmatch("[a-f0-9]{32}", session):
    raise SystemExit("Backend returned an invalid session")
try:
    if command("/editsession?id=" + session + "&enableShuffling=0") != "Success":
        raise SystemExit("Could not configure backend session")
    request = urllib.request.Request(
        base + "/" + session + "/https://example.com/",
        headers={"Accept": "text/html", "Sec-Fetch-Dest": "iframe"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        html = response.read(2 * 1024 * 1024).decode()
        if response.status != 200 or "Example Domain" not in html or "hammerhead.js" not in html:
            raise SystemExit("Backend did not return a rewritten page")
finally:
    command("/deletesession?id=" + session)
print("Live backend check passed.")
