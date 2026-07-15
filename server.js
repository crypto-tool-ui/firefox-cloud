require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { FirefoxSession } = require('./sessionManager');
const { attachVncProxy } = require('./wsVncProxy');

const PORT = process.env.PORT || 3000;
const RFB_PORT = Number(process.env.RFB_PORT || 5900);
const PROFILE_PATH = process.env.PROFILE_PATH || path.join(__dirname, 'profiles', 'default');

// TODO: thay bằng cơ chế xác thực thật (JWT / session) trước khi deploy public.
const API_TOKEN = process.env.API_TOKEN || null;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!API_TOKEN) return next(); // chưa cấu hình token -> bỏ qua (chỉ dùng khi test local)
  const token = req.headers['x-api-token'];
  if (token !== API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

const session = new FirefoxSession({
  profilePath: PROFILE_PATH,
  rfbPort: RFB_PORT,
});

app.get('/api/session/status', requireAuth, (req, res) => {
  res.json({ running: session.running });
});

app.post('/api/session/start', requireAuth, async (req, res) => {
  try {
    if (session.running) return res.json({ ok: true, alreadyRunning: true });
    await session.start();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session/stop', requireAuth, (req, res) => {
  session.stop();
  res.json({ ok: true });
});

const server = http.createServer(app);

// WebSocket proxy cho noVNC, path: /vnc
attachVncProxy(server, { vncPort: RFB_PORT, path: '/vnc' });

server.listen(PORT, () => {
  console.log(`Server dang chay tai http://localhost:${PORT}`);
});

// Dọn dẹp tiến trình con khi server tắt
process.on('SIGINT', () => { session.stop(); process.exit(0); });
process.on('SIGTERM', () => { session.stop(); process.exit(0); });
