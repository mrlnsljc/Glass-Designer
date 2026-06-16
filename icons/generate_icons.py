#!/usr/bin/env python3
"""
Dependency-free PNG icon generator for the Glass Railing Designer.

No PIL / cairosvg here, so we draw into an RGBA buffer and encode a PNG with the
stdlib only (zlib + struct). Supersampled 3x then box-downsampled for smooth AA.

Design: dark navy app tile + three translucent "glass panels" sitting on a base
rail — evokes a frameless glass railing.

Run:  python3 generate_icons.py
"""
import struct, zlib, math

BG       = (15, 23, 42)     # #0f172a navy app shell
BG_MASK_A = (18, 28, 50)
BG_MASK_B = (11, 17, 33)
GLASS_HI = (191, 219, 254)  # #bfdbfe light glass top
GLASS_LO = (96, 165, 250)   # #60a5fa glass bottom
RAIL     = (203, 213, 225)  # #cbd5e1 aluminium base rail


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size, maskable=False):
    ss = 3
    S = size * ss
    buf = bytearray(S * S * 4)
    cx = cy = S / 2.0

    def put(x, y, rgb, a=1.0):
        i = (y * S + x) * 4
        if a >= 1.0:
            buf[i:i+4] = bytes((rgb[0], rgb[1], rgb[2], 255)); return
        br, bg, bb, ba = buf[i], buf[i+1], buf[i+2], buf[i+3]
        na = a + (ba / 255.0) * (1 - a)
        if na <= 0: return
        out = []
        for k in range(3):
            out.append(round((rgb[k] * a + (br, bg, bb)[k] * (ba / 255.0) * (1 - a)) / na))
        buf[i:i+4] = bytes((out[0], out[1], out[2], round(na * 255)))

    # panel geometry (in 0..1 of canvas)
    pad = 0.18 if not maskable else 0.10
    top = 0.22 if not maskable else 0.16
    bot = 0.78 if not maskable else 0.84
    rail_y = bot
    gap = 0.06
    n = 3
    span = (1 - pad * 2 - gap * (n - 1)) / n

    def in_panel(u, v):
        if v < top or v > bot: return -1
        for i in range(n):
            x0 = pad + i * (span + gap)
            x1 = x0 + span
            if x0 <= u <= x1:
                # rounded top corners
                r = span * 0.22
                if v < top + r:
                    if u < x0 + r and (u - (x0 + r))**2 + (v - (top + r))**2 > r * r: continue
                    if u > x1 - r and (u - (x1 - r))**2 + (v - (top + r))**2 > r * r: continue
                return i
        return -1

    for y in range(S):
        for x in range(S):
            px, py = x + 0.5, y + 0.5
            u, v = px / S, py / S
            # ---- background tile ----
            if maskable:
                put(x, y, lerp(BG_MASK_A, BG_MASK_B, v), 1.0)
            else:
                r = S * 0.22
                qx = abs(px - cx) - (S / 2 - r)
                qy = abs(py - cy) - (S / 2 - r)
                outside = math.hypot(max(qx, 0), max(qy, 0)) - r
                if outside <= 0: cov = 1.0
                elif outside < ss: cov = max(0.0, 1.0 - outside / ss)
                else: cov = 0.0
                if cov <= 0: continue
                put(x, y, BG, cov)

            # ---- glass panels ----
            if in_panel(u, v) >= 0:
                t = (v - top) / (bot - top)
                # vertical sheen + translucency
                a = 0.78 - 0.18 * math.sin(t * math.pi)
                put(x, y, lerp(GLASS_HI, GLASS_LO, t), a)

            # ---- base rail ----
            if rail_y <= v <= rail_y + 0.055 and pad - 0.02 <= u <= 1 - pad + 0.02:
                put(x, y, RAIL, 1.0)

    # box downsample
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for j in range(ss):
                for i in range(ss):
                    idx = ((y * ss + j) * S + (x * ss + i)) * 4
                    r += buf[idx]; g += buf[idx+1]; b += buf[idx+2]; a += buf[idx+3]
            o = (y * size + x) * 4; nme = ss * ss
            out[o] = r // nme; out[o+1] = g // nme; out[o+2] = b // nme; out[o+3] = a // nme
    return out


def write_png(path, size, rgba):
    raw = bytearray(); stride = size * 4
    for y in range(size):
        raw.append(0); raw.extend(rgba[y * stride:(y + 1) * stride])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, size, "x", size)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    write_png(os.path.join(here, "icon-512.png"), 512, render(512))
    write_png(os.path.join(here, "icon-192.png"), 192, render(192))
    write_png(os.path.join(here, "icon-180.png"), 180, render(180))
    write_png(os.path.join(here, "icon-maskable-512.png"), 512, render(512, maskable=True))
    print("done")
