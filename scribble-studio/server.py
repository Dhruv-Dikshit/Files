#!/usr/bin/env python3
"""Scribble Studio local helper.

Serves the app (like `python3 -m http.server`) AND adds pro video exports that a browser
can't make on its own, by handing transparent PNG frames to ffmpeg:

  * ProRes 4444 (.mov) with alpha  - Premiere, Final Cut, Resolve, After Effects
  * HEVC with alpha (.mov)          - macOS only (Apple VideoToolbox), small files for FCP / Apple devices

It also saves exports straight into a folder (default ~/Movies/Scribble Studio) so the
Premiere / After Effects panel can import them automatically.

Usage:
    python3 server.py                 # http://localhost:8000
    python3 server.py --port 8080 --out ~/Desktop/Scribble

Requires ffmpeg for the .mov exports:  brew install ffmpeg
Only listens on 127.0.0.1 (your own computer).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_FRAME_BYTES = 80 * 1024 * 1024
MAX_FRAMES = 20000
JOB_TTL = 60 * 60

FORMATS = {
    # name: (extension, ffmpeg video args, description)
    "prores4444": (
        "mov",
        ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
         "-alpha_bits", "16", "-vendor", "apl0", "-bits_per_mb", "8000"],
        "ProRes 4444 with alpha",
    ),
    "hevc-alpha": (
        "mov",
        ["-c:v", "hevc_videotoolbox", "-allow_sw", "1", "-alpha_quality", "0.85",
         "-b:v", "24M", "-tag:v", "hvc1", "-pix_fmt", "bgra"],
        "HEVC with alpha (Apple VideoToolbox)",
    ),
    "prores422-black": (
        "mov",
        ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0"],
        "ProRes 422 HQ (no alpha) on black",
    ),
}

jobs = {}
jobs_lock = threading.Lock()


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):  # Finder-launched apps lack Homebrew's PATH
        if os.path.exists(p):
            return p
    return None


def ffmpeg_encoders(exe):
    try:
        out = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return set()
    return {line.split()[1] for line in out.splitlines() if line.startswith(" V")}


def safe_name(name, fallback="scribble"):
    name = re.sub(r"[^A-Za-z0-9._ -]+", "-", str(name or "")).strip(" .-")[:80]
    return name or fallback


def unique_path(folder, stem, ext):
    p = folder / f"{stem}.{ext}"
    i = 2
    while p.exists():
        p = folder / f"{stem}-{i}.{ext}"
        i += 1
    return p


def cleanup_jobs():
    now = time.time()
    with jobs_lock:
        for jid in [j for j, v in jobs.items() if now - v["created"] > JOB_TTL]:
            shutil.rmtree(jobs[jid]["dir"], ignore_errors=True)
            jobs.pop(jid, None)


class Handler(SimpleHTTPRequestHandler):
    server_version = "ScribbleStudio/1.0"

    def __init__(self, *a, ffmpeg=None, encoders=frozenset(), out_dir=None, **kw):
        self.ffmpeg, self.encoders, self.out_dir = ffmpeg, encoders, out_dir
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write("[helper] " + (fmt % args) + "\n")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers
    def send_json(self, obj, code=200, cors=False):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if cors:  # read-only status check, used by the Premiere/AE panel (loaded from file://)
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit:
            raise ValueError("bad body size")
        return self.rfile.read(n)

    def same_origin(self):
        # Browsers send Origin on POST; only accept our own page (blocks other websites).
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host", "")
        return origin in (f"http://{host}", "null") or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin)

    # ---- routes
    def do_GET(self):
        if self.path == "/api/status":
            formats = {}
            for k, (ext, args, desc) in FORMATS.items():
                codec = args[args.index("-c:v") + 1]
                formats[k] = {"available": bool(self.ffmpeg) and codec in self.encoders, "ext": ext, "label": desc}
            return self.send_json({
                "helper": True, "ffmpeg": self.ffmpeg, "formats": formats,
                "outDir": str(self.out_dir), "platform": sys.platform,
            }, cors=True)
        m = re.match(r"^/api/job/([a-f0-9]{32})/file$", self.path)
        if m:
            job = jobs.get(m.group(1))
            if not job or not job.get("output"):
                return self.send_json({"error": "not ready"}, 404)
            path = Path(job["output"])
            self.send_response(200)
            self.send_header("Content-Type", "video/quicktime")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        return super().do_GET()

    def do_POST(self):
        if not self.same_origin():
            return self.send_json({"error": "forbidden origin"}, 403)
        try:
            if self.path == "/api/job":
                cleanup_jobs()
                jid = uuid.uuid4().hex
                d = tempfile.mkdtemp(prefix="scribble-")
                with jobs_lock:
                    jobs[jid] = {"dir": d, "created": time.time(), "keys": set()}
                return self.send_json({"id": jid})

            m = re.match(r"^/api/job/([a-f0-9]{32})/frame/([A-Za-z0-9_-]{1,40})$", self.path)
            if m:
                job = jobs.get(m.group(1))
                if not job:
                    return self.send_json({"error": "no such job"}, 404)
                data = self.read_body(MAX_FRAME_BYTES)
                if not data.startswith(b"\x89PNG"):
                    return self.send_json({"error": "frames must be PNG"}, 400)
                with open(os.path.join(job["dir"], f"k_{m.group(2)}.png"), "wb") as f:
                    f.write(data)
                job["keys"].add(m.group(2))
                return self.send_json({"ok": True})

            m = re.match(r"^/api/job/([a-f0-9]{32})/finish$", self.path)
            if m:
                return self.finish(m.group(1))

            m = re.match(r"^/api/save$", self.path)
            if m:  # save a browser-made export (mp4 / zip / gif …) into the export folder
                name = safe_name(self.headers.get("X-Filename"), "scribble.bin")
                data = self.read_body(1024 * 1024 * 1024)
                stem, _, ext = name.rpartition(".")
                path = unique_path(self.out_dir, safe_name(stem), safe_name(ext, "bin"))
                path.write_bytes(data)
                if ext.lower() == "zip":  # PNG sequence: unpack so editors can import it as a numbered sequence
                    folder = unique_path(self.out_dir, safe_name(stem), "frames")
                    folder.mkdir()
                    with zipfile.ZipFile(path) as z:
                        pngs = sorted(n for n in z.namelist() if n.lower().endswith(".png") and ".." not in n)
                        for n in pngs:
                            (folder / Path(n).name).write_bytes(z.read(n))
                    path.unlink()
                    if pngs:
                        return self.send_json({"path": str(folder / Path(pngs[0]).name), "sequence": True})
                return self.send_json({"path": str(path)})
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        return self.send_json({"error": "not found"}, 404)

    def finish(self, jid):
        job = jobs.get(jid)
        if not job:
            return self.send_json({"error": "no such job"}, 404)
        spec = json.loads(self.read_body(4 * 1024 * 1024))
        fmt = spec.get("format")
        if fmt not in FORMATS:
            return self.send_json({"error": "unknown format"}, 400)
        if not self.ffmpeg:
            return self.send_json({"error": "ffmpeg not found — install it with: brew install ffmpeg"}, 500)
        ext, vargs, _ = FORMATS[fmt]
        codec = vargs[vargs.index("-c:v") + 1]
        if codec not in self.encoders:
            return self.send_json({"error": f"this ffmpeg has no {codec} encoder"}, 500)
        order = spec.get("order") or []
        if not order or len(order) > MAX_FRAMES or any(str(k) not in job["keys"] for k in order):
            return self.send_json({"error": "frame list doesn't match uploaded frames"}, 400)
        fps = int(spec.get("fps") or 24)
        if fps not in (24, 25, 30, 50, 60):
            fps = 24

        seq = os.path.join(job["dir"], "seq")
        os.makedirs(seq, exist_ok=True)
        for i, k in enumerate(order):  # hard links: repeated boil frames cost no disk space
            dst = os.path.join(seq, f"f{i:05d}.png")
            src = os.path.join(job["dir"], f"k_{k}.png")
            try:
                os.link(src, dst)
            except OSError:
                shutil.copyfile(src, dst)

        out = unique_path(self.out_dir, safe_name(spec.get("name")), ext)
        cmd = [self.ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-framerate", str(fps),
               "-i", os.path.join(seq, "f%05d.png")]
        if fmt == "prores422-black":
            cmd += ["-f", "lavfi", "-i", "color=black:s=16x16", "-filter_complex",
                    "[1][0]scale2ref[bg][fg];[bg][fg]overlay=shortest=1"]
        cmd += vargs + ["-r", str(fps), str(out)]
        t0 = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return self.send_json({"error": "ffmpeg failed", "detail": proc.stderr[-2000:]}, 500)
        job["output"] = str(out)
        shutil.rmtree(seq, ignore_errors=True)
        return self.send_json({
            "path": str(out), "file": f"/api/job/{jid}/file", "bytes": out.stat().st_size,
            "seconds": round(time.time() - t0, 2),
        })


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--out", default=str(Path.home() / "Movies" / "Scribble Studio"))
    ap.add_argument("--open", action="store_true", help="open the app in a browser window")
    args = ap.parse_args()

    out_dir = Path(os.path.expanduser(args.out))
    out_dir.mkdir(parents=True, exist_ok=True)
    exe = find_ffmpeg()
    enc = ffmpeg_encoders(exe) if exe else set()

    handler = partial(Handler, ffmpeg=exe, encoders=frozenset(enc), out_dir=out_dir)
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = f"http://localhost:{args.port}/"
    print(f"Scribble Studio → {url}")
    print(f"Exports folder  → {out_dir}")
    if exe:
        ok = [k for k, (_, a, _) in FORMATS.items() if a[a.index('-c:v') + 1] in enc]
        print(f"ffmpeg          → {exe}  (pro formats: {', '.join(ok) or 'none'})")
    else:
        print("ffmpeg          → not found. ProRes/HEVC exports need it:  brew install ffmpeg")
    if args.open:
        threading.Timer(0.6, lambda: open_app(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


def open_app(url):
    """Chromeless app window in Chrome/Edge if installed, otherwise the default browser."""
    if sys.platform == "darwin":
        for app in ("Google Chrome", "Microsoft Edge", "Brave Browser"):
            if subprocess.run(["open", "-Ra", app], capture_output=True).returncode == 0:
                subprocess.Popen(["open", "-na", app, "--args", f"--app={url}"])
                return
    import webbrowser
    webbrowser.open(url)


if __name__ == "__main__":
    main()
