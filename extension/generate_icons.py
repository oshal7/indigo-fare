import struct
import zlib
import os

AMBER = (245, 158, 11, 255)
SLATE = (15, 23, 42, 255)
TRANSPARENT = (0, 0, 0, 0)


def sign(p1, p2, p3):
    return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])


def point_in_triangle(pt, v1, v2, v3):
    d1 = sign(pt, v1, v2)
    d2 = sign(pt, v2, v3)
    d3 = sign(pt, v3, v1)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def make_pixels(size):
    cx = cy = size / 2
    radius = size * 0.46
    tip = (size * 0.64, size * 0.5)
    base_top = (size * 0.36, size * 0.28)
    base_bottom = (size * 0.36, size * 0.72)

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dist = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
            if dist > radius:
                row.append(TRANSPARENT)
            elif point_in_triangle((px, py), tip, base_top, base_bottom):
                row.append(SLATE)
            else:
                row.append(AMBER)
        rows.append(row)
    return rows


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size):
    pixels = make_pixels(size)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # no filter
        for (r, g, b, a) in row:
            raw.extend((r, g, b, a))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 48, 128):
        write_png(os.path.join(out_dir, f"icon{size}.png"), size)
        print(f"wrote icon{size}.png")
