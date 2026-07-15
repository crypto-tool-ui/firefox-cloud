const net = require('net');
const WebSocket = require('ws');

/**
 * Gắn 1 WebSocket endpoint vào httpServer, relay dữ liệu nhị phân
 * hai chiều giữa client (noVNC) và x11vnc (TCP), tương đương websockify.
 */
function attachVncProxy(httpServer, { vncHost = '127.0.0.1', vncPort = 5900, path = '/vnc' } = {}) {
  const wss = new WebSocket.Server({ server: httpServer, path });

  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
    const tcp = net.connect(vncPort, vncHost);

    tcp.on('connect', () => console.log('[vnc-proxy] connected to x11vnc'));

    ws.on('message', (data) => {
      if (!tcp.destroyed) tcp.write(data);
    });

    tcp.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const cleanup = () => {
      tcp.destroy();
      try { ws.close(); } catch (_) {}
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
    tcp.on('close', cleanup);
    tcp.on('error', (err) => {
      console.error('[vnc-proxy] tcp error:', err.message);
      cleanup();
    });
  });

  return wss;
}

module.exports = { attachVncProxy };
