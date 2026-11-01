Verifica que `app/js/qr.js` genera QR decodificables (usa OpenCV, no forma parte del build):

    python -m venv .venv && .venv/Scripts/pip install opencv-python-headless numpy
    node tools/qr-check/dump.mjs app/js/qr.js qr.json
    .venv/Scripts/python tools/qr-check/decode.py qr.json
