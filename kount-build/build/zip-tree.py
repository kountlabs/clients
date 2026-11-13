"""build/zip-tree.py SRC_DIR OUT_ZIP — the package upstream's scripts/compress.sh makes (`zip -r` of build/), written
reproducibly: entries in byte order of their paths, one fixed timestamp, plain 0644 files, zlib's default level.
A symlink anywhere (file or directory) is refused, never followed or skipped. Run inside build.sh's container with
`python3 -I` (the Node image has no `zip`)."""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
paths = []
for base, dirs, files in os.walk(src):
    dirs.sort()
    for name in dirs:
        if os.path.islink(os.path.join(base, name)):
            sys.exit(f"ZIP_FAIL reason=symlink {os.path.join(base, name)}")
    for name in files:
        full = os.path.join(base, name)
        if os.path.islink(full):
            sys.exit(f"ZIP_FAIL reason=symlink {full}")
        paths.append(os.path.relpath(full, src))
paths.sort(key=lambda p: p.encode())
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for rel in paths:
        info = zipfile.ZipInfo(rel.replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(os.path.join(src, rel), "rb") as f:
            z.writestr(info, f.read())
print(f"ZIP_OK files={len(paths)} out={out}")
