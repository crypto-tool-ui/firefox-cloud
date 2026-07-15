const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { allocate: allocDisplay, release: releaseDisplay } = require('../utils/displayAllocator');
const { allocate: allocPort, release: releasePort } = require('../utils/portAllocator');
const logger = require('../utils/logger');

const BASE_PROFILE_DIR = path.resolve(process.env.PROFILE_DIR || path.join(__dirname, '..', '..', 'profiles'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', '..', 'db.json'));
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 30 * 60 * 1000);
const DEFAULT_WIDTH = Number(process.env.SESSION_WIDTH || 1280);
const DEFAULT_HEIGHT = Number(process.env.SESSION_HEIGHT || 800);
const USE_WM = process.env.USE_WINDOW_MANAGER !== 'false';

class Session {
  constructor(id, opts = {}) {
    this.id = id;
    this.display = opts.display || ':99';
    this.vncPort = opts.vncPort || 5900;
    this.width = opts.width || DEFAULT_WIDTH;
    this.height = opts.height || DEFAULT_HEIGHT;
    this.profilePath = opts.profilePath || path.join(BASE_PROFILE_DIR, id);
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.owner = opts.owner || 'default';
    this.status = 'created';
    this.error = null;
    this.procs = {};
    this.idleTimer = null;
    this.metadata = {};
    this._onStatusChange = null;
  }

  get displayNumber() {
    return this.display.replace(':', '').split('.')[0];
  }

  get runningTime() {
    return Date.now() - this.createdAt;
  }

  get idleTime() {
    return Date.now() - this.lastActivity;
  }

  touch() {
    this.lastActivity = Date.now();
    this._resetIdleTimer();
  }

  _resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _startIdleTimer(onTimeout) {
    this._resetIdleTimer();
    if (IDLE_TIMEOUT_MS > 0) {
      this.idleTimer = setTimeout(() => {
        logger.info('session', `Session ${this.id} idle timeout (${IDLE_TIMEOUT_MS}ms)`);
        if (onTimeout) onTimeout(this.id);
      }, IDLE_TIMEOUT_MS);
    }
  }

  setStatus(status, error) {
    this.status = status;
    this.error = error || null;
    if (this._onStatusChange) {
      this._onStatusChange(this.id, status, error);
    }
  }

  toJSON() {
    return {
      id: this.id,
      display: this.display,
      vncPort: this.vncPort,
      width: this.width,
      height: this.height,
      profilePath: this.profilePath,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      owner: this.owner,
      status: this.status,
      error: this.error,
      runningTime: this.runningTime,
      idleTime: this.idleTime,
      metadata: this.metadata,
    };
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this._onSessionEvent = null;
    this._loadDb();
  }

  onSessionEvent(callback) {
    this._onSessionEvent = callback;
  }

  _dbPath() {
    return DB_PATH;
  }

  _loadDb() {
    try {
      if (!fs.existsSync(DB_PATH)) return;
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      for (const item of data) {
        if (!item.id) continue;
        const session = new Session(item.id, item);
        session.status = 'stopped';
        session.error = null;
        session.procs = {};
        session.idleTimer = null;
        this.sessions.set(item.id, session);
      }
      logger.info('session', `Loaded ${this.sessions.size} sessions from db.json`);
    } catch (err) {
      logger.error('session', `Failed to load db.json: ${err.message}`);
    }
  }

  _saveDb() {
    try {
      const data = Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        display: s.display,
        vncPort: s.vncPort,
        width: s.width,
        height: s.height,
        profilePath: s.profilePath,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        owner: s.owner,
        status: s.status,
        error: s.error,
        metadata: s.metadata,
      }));
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('session', `Failed to save db.json: ${err.message}`);
    }
  }

  _emit(event, data) {
    if (this._onSessionEvent) {
      this._onSessionEvent(event, data);
    }
  }

  async createSession(opts = {}) {
    const id = uuidv4().slice(0, 8);
    const displayNumber = allocDisplay();
    const vncPort = allocPort();
    const profilePath = path.join(BASE_PROFILE_DIR, id);
    const width = opts.width || DEFAULT_WIDTH;
    const height = opts.height || DEFAULT_HEIGHT;
    const owner = opts.owner || 'default';

    const session = new Session(id, {
      display: `:${displayNumber}`,
      vncPort,
      width,
      height,
      profilePath,
      owner,
    });

    this.sessions.set(id, session);
    this._saveDb();
    this._emit('session:created', { id, session: session.toJSON() });

    try {
      await this._startSession(session);
    } catch (err) {
      logger.error('session', `Session ${id} failed to start: ${err.message}`);
      session.setStatus('error', err.message);
      this._emit('session:error', { id, error: err.message });
      throw err;
    }

    return session;
  }

  async _startSession(session) {
    session.setStatus('starting');
    fs.mkdirSync(session.profilePath, { recursive: true });

    await this._spawnXvfb(session);
    await this._waitForX(session);

    if (USE_WM) {
      await this._spawnWindowManager(session);
    }

    await this._spawnFirefox(session);
    await this._positionFirefox(session);
    await this._spawnX11vnc(session);
    await this._waitForVncPort(session);

    session.setStatus('running');
    session._startIdleTimer((sid) => {
      this.suspendSession(sid).catch((err) => {
        logger.error('session', `Idle suspend failed for ${sid}: ${err.message}`);
      });
    });

    this._emit('session:started', { id: session.id, session: session.toJSON() });
    logger.info('session', `Session ${session.id} started (display=${session.display}, vncPort=${session.vncPort})`);
  }

  async _spawnXvfb(session) {
    return new Promise((resolve, reject) => {
      const proc = spawn('Xvfb', [
        session.display,
        '-screen', '0', `${session.width}x${session.height}x24`,
        '-nolisten', 'tcp',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      session.procs.xvfb = proc;
      this._logProc(session, 'xvfb', proc);

      proc.on('error', (err) => {
        reject(new Error(`Xvfb failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (session.status === 'starting' || session.status === 'running') {
          logger.warn('session', `Xvfb exited (code ${code}) for session ${session.id}`);
          this._handleProcessDeath(session, 'xvfb');
        }
      });

      resolve();
    });
  }

  async _waitForX(session, timeoutMs = 10000) {
    const sockPath = path.join('/tmp/.X11-unix', `X${session.displayNumber}`);
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (fs.existsSync(sockPath)) return resolve();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('Xvfb did not start in time'));
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  async _waitForVncPort(session, timeoutMs = 10000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const sock = net.connect(session.vncPort, '127.0.0.1');
        sock.on('connect', () => {
          sock.end();
          resolve();
        });
        sock.on('error', () => {
          sock.destroy();
          if (Date.now() - start > timeoutMs) {
            return reject(new Error('VNC port did not become ready in time'));
          }
          setTimeout(check, 200);
        });
      };
      check();
    });
  }

  async _spawnWindowManager(session) {
    return new Promise((resolve, reject) => {
      const proc = spawn('fluxbox', [], {
        env: { ...process.env, DISPLAY: session.display },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      session.procs.wm = proc;
      this._logProc(session, 'fluxbox', proc);

      proc.on('error', (err) => {
        reject(new Error(`fluxbox failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (session.status === 'running') {
          logger.warn('session', `fluxbox exited (code ${code}) for session ${session.id}`);
        }
      });

      resolve();
    });
  }

  async _spawnFirefox(session) {
    return new Promise((resolve, reject) => {
      const firefoxDir = path.resolve(__dirname, '..', '..', 'firefox');
      const firefoxBin = path.join(firefoxDir, 'firefox');
      logger.info('session', `Starting Firefox: ${firefoxBin} for session ${session.id}`);
      const proc = spawn(firefoxBin, [
        '-profile', session.profilePath,
        '-no-remote',
        '-no-first-run',
        '-width', String(session.width),
        '-height', String(session.height),
        'about:blank',
      ], {
        env: {
          ...process.env,
          DISPLAY: session.display,
          LD_LIBRARY_PATH: firefoxDir + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''),
          MOZ_WEBRENDER: '0',
          MOZ_ACCELERATED: '0',
          MOZ_DISABLE_CONTENT_SANDBOX: '1',
          LIBGL_ALWAYS_SOFTWARE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      session.procs.firefox = proc;
      this._logProc(session, 'firefox', proc);

      let settled = false;

      proc.on('error', (err) => {
        settled = true;
        reject(new Error(`Firefox failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Firefox exited immediately (code ${code})`));
          return;
        }
        if (session.status === 'running' || session.status === 'starting') {
          logger.warn('session', `Firefox exited (code ${code}) for session ${session.id}`);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 2000);
    });
  }

  async _positionFirefox(session) {
    const display = session.display;
    const start = Date.now();
    const timeout = 10000;

    const search = (args) => new Promise((resolve) => {
      try {
        const proc = spawn('xdotool', args, {
          env: { ...process.env, DISPLAY: display },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
        proc.on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });

    const getWindow = async () => {
      const candidates = [
        ['search', '--class', 'Firefox'],
        ['search', '--pid', String(session.procs.firefox.pid)],
        ['search', '--class', 'firefox'],
        ['search', '--name', 'Mozilla Firefox'],
        ['search', '--name', 'Firefox'],
      ];
      for (const args of candidates) {
        const result = await search(args);
        if (result) {
          const lines = result.split('\n');
          logger.info('session', `xdotool found window(s) with ${args.join(' ')}: ${lines.join(', ')}`);
          return lines[0];
        }
      }
      return null;
    };

    let wid = null;
    while (Date.now() - start < timeout) {
      wid = await getWindow();
      if (wid) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!wid) {
      logger.warn('session', `Could not find Firefox window for session ${session.id}`);
      return;
    }

    const moveResult = await search(['windowmove', wid, '0', '0']);
    if (moveResult !== null) {
      logger.info('session', `Moved Firefox window ${wid} to (0,0) for session ${session.id}`);
    } else {
      logger.warn('session', `xdotool windowmove failed for window ${wid} (session ${session.id})`);
    }

    const resizeResult = await search(['windowsize', wid, String(session.width), String(session.height)]);
    if (resizeResult !== null) {
      logger.info('session', `Resized Firefox window ${wid} to ${session.width}x${session.height}`);
    } else {
      logger.warn('session', `xdotool windowsize failed for window ${wid}`);
    }
  }

  async _spawnX11vnc(session) {
    return new Promise((resolve, reject) => {
      const proc = spawn('x11vnc', [
        '-display', session.display,
        '-rfbport', String(session.vncPort),
        '-localhost',
        '-forever',
        '-shared',
        '-noxdamage',
        '-quiet',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      session.procs.x11vnc = proc;
      this._logProc(session, 'x11vnc', proc);

      proc.on('error', (err) => {
        reject(new Error(`x11vnc failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (session.status === 'running') {
          logger.warn('session', `x11vnc exited (code ${code}) for session ${session.id}`);
          this._handleProcessDeath(session, 'x11vnc');
        }
      });

      resolve();
    });
  }

  _handleProcessDeath(session, procName) {
    if (session.status !== 'running') return;
    logger.warn('session', `Session ${session.id} lost ${procName}, stopping`);
    this.stopSession(session.id).catch((err) => {
      logger.error('session', `Cleanup failed for ${session.id}: ${err.message}`);
    });
  }

  async stopSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'stopped' || session.status === 'suspended') return;

    session.setStatus('stopping');
    session._resetIdleTimer();

    const keys = ['x11vnc', 'firefox', 'wm', 'xvfb'];
    for (const key of keys) {
      if (session.procs[key]) {
        try {
          session.procs[key].kill('SIGTERM');
        } catch (_) {}
      }
    }

    await new Promise((r) => setTimeout(r, 500));

    for (const key of keys) {
      if (session.procs[key]) {
        try {
          session.procs[key].kill('SIGKILL');
        } catch (_) {}
      }
    }

    session.procs = {};
    releaseDisplay(Number(session.displayNumber));
    releasePort(session.vncPort);
    session.setStatus('stopped');
    this._saveDb();

    this._emit('session:stopped', { id, session: session.toJSON() });
    logger.info('session', `Session ${id} stopped`);
  }

  async destroySession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    if (session.status === 'running' || session.status === 'starting') {
      await this.stopSession(id);
    }

    this.sessions.delete(id);
    this._saveDb();
    this._emit('session:destroyed', { id });
    logger.info('session', `Session ${id} destroyed`);
  }

  async restartSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    const wasRunning = session.status === 'running';
    if (wasRunning) {
      await this.stopSession(id);
    }

    session.display = `:${allocDisplay()}`;
    session.vncPort = allocPort();

    await this._startSession(session);
    return session;
  }

  async suspendSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status !== 'running') return;

    session.setStatus('suspending');
    session._resetIdleTimer();

    if (session.procs.x11vnc) {
      try { session.procs.x11vnc.kill('SIGTERM'); } catch (_) {}
    }
    if (session.procs.wm) {
      try { session.procs.wm.kill('SIGSTOP'); } catch (_) {}
    }

    delete session.procs.x11vnc;
    delete session.procs.wm;

    session.setStatus('suspended');
    this._saveDb();
    this._emit('session:suspended', { id, session: session.toJSON() });
    logger.info('session', `Session ${id} suspended`);
  }

  async resumeSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status !== 'suspended') return;

    session.display = `:${allocDisplay()}`;
    session.vncPort = allocPort();

    session.setStatus('starting');

    try {
      if (session.procs.wm) {
        try { session.procs.wm.kill('SIGCONT'); } catch (_) {}
      }
      await this._spawnX11vnc(session);
      session.setStatus('running');
      session._startIdleTimer((sid) => {
        this.suspendSession(sid).catch((err) => {
          logger.error('session', `Idle suspend failed for ${sid}: ${err.message}`);
        });
      });
      this._saveDb();
      this._emit('session:resumed', { id, session: session.toJSON() });
      logger.info('session', `Session ${id} resumed`);
    } catch (err) {
      session.setStatus('error', err.message);
      throw err;
    }
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  listSessions(filter) {
    const all = Array.from(this.sessions.values());
    if (!filter) return all.map((s) => s.toJSON());
    return all.filter((s) => s.status === filter).map((s) => s.toJSON());
  }

  getStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      running: sessions.filter((s) => s.status === 'running').length,
      suspended: sessions.filter((s) => s.status === 'suspended').length,
      stopped: sessions.filter((s) => s.status === 'stopped' || s.status === 'error').length,
    };
  }

  getSystemInfo() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || 'unknown',
        load: os.loadavg(),
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        percentUsed: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      sessions: this.getStats(),
    };
  }

  _logProc(session, name, proc) {
    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) logger.debug('session', `[${session.id}:${name}] ${line}`);
    });
    proc.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) logger.warn('session', `[${session.id}:${name}] ${line}`);
    });
  }

  async cleanup() {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      try {
        await this.destroySession(id);
      } catch (err) {
        logger.error('session', `Cleanup error for ${id}: ${err.message}`);
      }
    }
  }
}

module.exports = { SessionManager, Session };
