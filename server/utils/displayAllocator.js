const DISPLAY_START = 99;

let _nextDisplay = DISPLAY_START;
const _released = [];

function allocate() {
  if (_released.length > 0) {
    return _released.sort((a, b) => a - b).shift();
  }
  const display = _nextDisplay;
  _nextDisplay += 1;
  return display;
}

function release(displayNumber) {
  if (!_released.includes(displayNumber)) {
    _released.push(displayNumber);
  }
}

function reset() {
  _nextDisplay = DISPLAY_START;
  _released.length = 0;
}

module.exports = { allocate, release, reset };
