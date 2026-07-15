require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { SessionManager } = require('./sessions/SessionManager');
const { VncProxyManager } = require('./websocket/vncProxy');
const { setupSecurity } = require('./middleware/security');
const { basicAuth } = require('./middleware/basicAuth');
const { createSessionRoutes } = require('./routes/sessionRoutes');
const { createSystemRoutes } = require('./routes/systemRoutes');
const logger = require('./utils/logger');

const PORT = Number(process.env.PORT || 3000);

const sessionManager = new SessionManager();
const vncProxyManager = new VncProxyManager(sessionManager);

const app = express();

// app.use(basicAuth);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

setupSecurity(app);

app.use('/api/sessions', createSessionRoutes(sessionManager));
app.use('/api/system', createSystemRoutes(sessionManager));

app.get('/api/session/status', (req, res) => {
  const stats = sessionManager.getStats();
  res.json({ running: stats.running > 0, stats });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);

vncProxyManager.attachToServer(server);

sessionManager.onSessionEvent((event, data) => {
  if (event === 'session:started' || event === 'session:resumed') {
    const session = sessionManager.getSession(data.id);
    if (session) {
      vncProxyManager.connectSession(data.id, session.vncPort);
    }
  }
  if (event === 'session:stopped' || event === 'session:suspended') {
    vncProxyManager.disconnectSession(data.id);
  }
});

server.listen(PORT, () => {
  logger.info('app', `Server listening on http://localhost:${PORT}`);
  logger.info('app', `API: http://localhost:${PORT}/api/sessions`);
});

process.on('SIGINT', async () => {
  logger.info('app', 'SIGINT received, shutting down...');
  vncProxyManager.cleanup();
  await sessionManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('app', 'SIGTERM received, shutting down...');
  vncProxyManager.cleanup();
  await sessionManager.cleanup();
  process.exit(0);
});

module.exports = { app, server, sessionManager, vncProxyManager };
