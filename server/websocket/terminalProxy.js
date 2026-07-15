const { spawn } = require('child_process');
const WebSocket = require('ws');
const logger = require('../utils/logger');

class TerminalManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.terminals = new Map();
  }

  attachToServer(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/terminal' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const sessionId = url.searchParams.get('session');

      if (!sessionId) {
        ws.close(4000, 'session parameter required');
        return;
      }

      logger.info('terminal', `Terminal request for session ${sessionId}`);
      this._createTerminal(ws, sessionId);
    });

    logger.info('terminal', 'Terminal WebSocket attached at /terminal');
  }

  _createTerminal(ws, sessionId) {
    const session = this.sessionManager?.getSession(sessionId);
    const display = session ? session.display : ':99';

    const shell = spawn('/bin/bash', [], {
      env: { ...process.env, DISPLAY: display, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const key = `${sessionId}_${Date.now()}`;
    this.terminals.set(key, shell);

    shell.stdout.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString('base64'));
      }
    });

    shell.stderr.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString('base64'));
      }
    });

    ws.on('message', (data) => {
      const decoded = Buffer.from(data.toString(), 'base64');
      shell.stdin.write(decoded);
    });

    ws.on('close', () => {
      shell.kill('SIGTERM');
      setTimeout(() => { try { shell.kill('SIGKILL'); } catch (_) {} }, 1000);
      this.terminals.delete(key);
    });

    ws.on('error', () => {
      shell.kill('SIGTERM');
      this.terminals.delete(key);
    });

    shell.on('exit', (code) => {
      logger.info('terminal', `Shell exited (code ${code}) for session ${sessionId}`);
      try { ws.close(); } catch (_) {}
      this.terminals.delete(key);
    });
  }

  disconnectSession(sessionId) {
    for (const [key, shell] of this.terminals) {
      if (key.startsWith(sessionId)) {
        try { shell.kill('SIGTERM'); } catch (_) {}
        this.terminals.delete(key);
      }
    }
  }

  cleanup() {
    for (const [, shell] of this.terminals) {
      try { shell.kill('SIGTERM'); } catch (_) {}
    }
    this.terminals.clear();
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = { TerminalManager };
