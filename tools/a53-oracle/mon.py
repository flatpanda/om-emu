import socket, sys, time
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.settimeout(3)
def rd():
    out = b''
    try:
        while True:
            d = s.recv(65536)
            if not d: break
            out += d
            if out.endswith(b'(qemu) '): break
    except Exception: pass
    return out.decode('latin1')
rd()
for cmd in sys.argv[2:]:
    s.sendall((cmd + '\n').encode()); time.sleep(0.5); sys.stdout.write(rd())
