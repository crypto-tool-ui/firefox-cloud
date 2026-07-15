const net = require('net');
const WebSocket = require('ws');
const logger = require('../utils/logger');

class VncProxyManager {
  constructor(sessionManager) {
    this.proxies = new Map();
    this.sessionManager = sessionManager;
  }

  attachToServer(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/vnc' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const sessionId = url.searchParams.get('session');

      if (!sessionId) {
        ws.close(4000, 'session parameter required');
        return;
      }

      logger.info('vnc', `VNC connection request for session ${sessionId}`);
      this._createProxy(ws, sessionId);
    });

    logger.info('vnc', 'VNC WebSocket proxy attached at /vnc');
  }

  _createProxy(ws, sessionId) {
    const key = `${sessionId}_${Date.now()}`;

    ws.binaryType = 'nodebuffer';

    const cleanup = () => {
      if (this.proxies.has(key)) {
        this.proxies.delete(key);
      }
      try { ws.close(); } catch (_) {}
    };

    this.proxies.set(key, { ws, sessionId, cleanup });

    ws.on('message', (data) => {
      const proxy = this.proxies.get(key);
      if (!proxy || !proxy.tcp || proxy.tcp.destroyed) return;
      proxy.tcp.write(data);
    });

    ws.on('close', () => {
      const proxy = this.proxies.get(key);
      if (proxy && proxy.tcp && !proxy.tcp.destroyed) {
        proxy.tcp.end();
      }
      cleanup();
    });

    ws.on('error', cleanup);

    ws.send(JSON.stringify({ type: 'proxy:waiting', message: 'Waiting for session VNC port' }));

    const session = this.sessionManager?.getSession(sessionId);
    if (session && session.status === 'running') {
      this.connectSession(sessionId, session.vncPort);
    }
  }

  connectSession(sessionId, vncPort, vncHost) {
    const proxies = Array.from(this.proxies.values()).filter((p) => p.sessionId === sessionId);

    for (const proxy of proxies) {
      if (proxy.tcp && !proxy.tcp.destroyed) {
        proxy.tcp.destroy();
      }

      const tcp = net.connect(vncPort, vncHost || '127.0.0.1');

      tcp.on('connect', () => {
        logger.info('vnc', `VNC proxy connected for session ${sessionId}`);
        if (proxy.ws.readyState === WebSocket.OPEN) {
          proxy.ws.send(JSON.stringify({ type: 'proxy:connected', sessionId }));
        }
      });

      tcp.on('data', (data) => {
        if (proxy.ws.readyState === WebSocket.OPEN) {
          proxy.ws.send(data);
        }
      });

      tcp.on('close', () => {
        logger.info('vnc', `VNC proxy disconnected for session ${sessionId}`);
        if (proxy.ws.readyState === WebSocket.OPEN) {
          proxy.ws.send(JSON.stringify({ type: 'proxy:disconnected' }));
        }
      });

      tcp.on('error', (err) => {
        logger.error('vnc', `TCP error for session ${sessionId}: ${err.message}`);
        if (proxy.ws.readyState === WebSocket.OPEN) {
          proxy.ws.send(JSON.stringify({ type: 'proxy:error', message: err.message }));
        }
      });

      proxy.tcp = tcp;
    }
  }

  disconnectSession(sessionId) {
    const proxies = Array.from(this.proxies.values()).filter((p) => p.sessionId === sessionId);
    for (const proxy of proxies) {
      if (proxy.tcp && !proxy.tcp.destroyed) {
        proxy.tcp.destroy();
      }
      try { proxy.ws.close(); } catch (_) {}
      this.proxies.delete(
        Array.from(this.proxies.entries()).find(([, v]) => v === proxy)?.[0]
      );
    }
  }

  cleanup() {
    for (const [, proxy] of this.proxies) {
      if (proxy.tcp && !proxy.tcp.destroyed) proxy.tcp.destroy();
      try { proxy.ws.close(); } catch (_) {}
    }
    this.proxies.clear();
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = { VncProxyManager };
