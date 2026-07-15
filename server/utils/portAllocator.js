const VNC_PORT_START = 5900;

let _nextPort = VNC_PORT_START;
const _released = [];

function allocate() {
  if (_released.length > 0) {
    return _released.sort((a, b) => a - b).shift();
  }
  const port = _nextPort;
  _nextPort += 1;
  return port;
}

function release(port) {
  if (!_released.includes(port)) {
    _released.push(port);
  }
}

function reset() {
  _nextPort = VNC_PORT_START;
  _released.length = 0;
}

module.exports = { allocate, release, reset };
