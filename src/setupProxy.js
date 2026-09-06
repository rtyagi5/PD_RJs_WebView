// ---------------------------------------------
// setupProxy.js
// CRA loads this automatically for `react-scripts start` and NEVER includes it
// in a production build, so everything here is dev-only by construction.
//
// Why it exists: the pose app is tested inside the Android WebView over
// `adb reverse tcp:3000 tcp:3000`. A browser download from that page lands on
// the PHONE, which is precisely where a keypoint capture is useless. The phone's
// localhost:3000 IS this dev server, so posting the file here puts it on the
// laptop next to the code, with no backend involved.
// ---------------------------------------------

const fs = require('fs');
const path = require('path');

const CAPTURE_DIR = path.join(__dirname, '..', 'captures');
const MAX_BYTES = 32 * 1024 * 1024; // a 60s session is ~2-4MB; this is generous

// Reject anything that is not a plain .jsonl basename. This route writes to
// disk, and it is reachable from the phone, so the filename never gets to
// influence the path.
function safeName(name) {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name) return null;
  if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(base)) return null;
  return base;
}

module.exports = function (app) {
  app.post('/__dev/keypoints', (req, res) => {
    let body = '';
    let tooBig = false;

    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BYTES) {
        tooBig = true;
        res.status(413).json({ error: 'capture too large' });
        req.destroy();
      }
    });

    req.on('end', () => {
      if (tooBig) return;
      try {
        const { filename, jsonl } = JSON.parse(body);
        const name = safeName(filename);
        if (!name) return res.status(400).json({ error: 'bad filename' });
        if (typeof jsonl !== 'string' || !jsonl.length) {
          return res.status(400).json({ error: 'empty capture' });
        }

        fs.mkdirSync(CAPTURE_DIR, { recursive: true });
        const dest = path.join(CAPTURE_DIR, name);
        fs.writeFileSync(dest, jsonl, 'utf8');

        const lines = jsonl.trimEnd().split('\n').length;
        console.log(`[dev-capture] wrote ${dest} (${lines} lines, ${jsonl.length} bytes)`);
        res.json({ ok: true, path: dest, lines });
      } catch (e) {
        console.warn('[dev-capture] failed:', e.message);
        res.status(500).json({ error: String(e.message) });
      }
    });
  });
};
