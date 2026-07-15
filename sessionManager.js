const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Quản lý vòng đời 1 phiên Firefox chạy trên virtual display (Xvfb)
 * và phát GUI ra qua x11vnc để Node server proxy tiếp sang WebSocket.
 */
class FirefoxSession {
  constructor({
    display = ':99',
    profilePath,
    width = 1280,
    height = 800,
    rfbPort = 5900,
    useWindowManager = true,
  } = {}) {
    if (!profilePath) throw new Error('profilePath is required');
    this.display = display;
    this.profilePath = profilePath;
    this.width = width;
    this.height = height;
    this.rfbPort = rfbPort;
    this.useWindowManager = useWindowManager;
    this.procs = {};
    this.running = false;
  }

  get displayNumber() {
    return this.display.replace(':', '').split('.')[0];
  }

  async start() {
    if (this.running) return;
    fs.mkdirSync(this.profilePath, { recursive: true });

    // 1. Virtual display
    this.procs.xvfb = spawn('Xvfb', [
      this.display,
      '-screen', '0', `${this.width}x${this.height}x24`,
      '-nolisten', 'tcp',
    ]);
    this._logProc('xvfb', this.procs.xvfb);
    await this._waitForX();

    // 2. (tuỳ chọn) window manager để có viền cửa sổ, taskbar
    if (this.useWindowManager) {
      this.procs.wm = spawn('fluxbox', [], {
        env: { ...process.env, DISPLAY: this.display },
      });
      this._logProc('fluxbox', this.procs.wm);
    }

    // 3. Firefox với profile riêng
    this.procs.firefox = spawn(
      'firefox',
      [
        '-profile', this.profilePath,
        '-no-remote',
        '-no-first-run',
        '-width', String(this.width),
        '-height', String(this.height),
      ],
      { env: { ...process.env, DISPLAY: this.display } }
    );
    this._logProc('firefox', this.procs.firefox);

    // 4. x11vnc phát display ra giao thức VNC, CHỈ bind localhost
    this.procs.x11vnc = spawn('x11vnc', [
      '-display', this.display,
      '-rfbport', String(this.rfbPort),
      '-localhost',
      '-forever',
      '-shared',
      '-noxdamage',
      '-quiet',
    ]);
    this._logProc('x11vnc', this.procs.x11vnc);

    this.running = true;

    // Nếu 1 tiến trình quan trọng chết bất ngờ, tự dọn dẹp toàn bộ session
    for (const key of ['xvfb', 'firefox', 'x11vnc']) {
      this.procs[key].once('exit', (code) => {
        if (this.running) {
          console.warn(`[session] ${key} exited unexpectedly (code ${code}), stopping session`);
          this.stop();
        }
      });
    }
  }

  stop() {
    this.running = false;
    for (const key of Object.keys(this.procs)) {
      try { this.procs[key].kill(); } catch (_) {}
    }
    this.procs = {};
  }

  _logProc(name, proc) {
    proc.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
    proc.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  }

  _waitForX(timeoutMs = 8000) {
    const sockPath = path.join('/tmp/.X11-unix', `X${this.displayNumber}`);
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (fs.existsSync(sockPath)) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Xvfb khong khoi dong kip trong thoi gian cho'));
        setTimeout(check, 100);
      };
      check();
    });
  }
}

module.exports = { FirefoxSession };
