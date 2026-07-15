import RFB from '../novnc/core/rfb.js';

const API_TOKEN = localStorage.getItem('api_token') || '';

let sessions = [];
let currentSessionId = null;
let rfb = null;
let pollTimer = null;
let statsTimer = null;
let vncGen = 0;

const $ = (id) => document.getElementById(id);

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['X-Api-Token'] = API_TOKEN;
  return fetch(path, { ...opts, headers }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  });
}

function showLoading(text) {
  $('loadingText').textContent = text;
  $('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const colors = { info: 'bg-indigo-600', success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-yellow-600' };
  const el = document.createElement('div');
  el.className = `toast ${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-lg text-sm flex items-center gap-2`;
  el.innerHTML = `<span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function view(name) {
  ['dashboardView', 'workspaceView'].forEach((v) => {
    $(v).classList.toggle('hidden', v !== name + 'View');
  });
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    sessions = data.sessions || [];
    renderSessions();
    updateStats(data.stats);
    updateSidebar();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

async function loadSystemInfo() {
  try {
    const data = await api('/api/system/status');
    const cpu = data.cpu ? data.cpu.load[0].toFixed(1) : '-';
    const mem = data.memory ? data.memory.percentUsed + '%' : '-';
    $('cpuDisplay').textContent = cpu;
    $('ramDisplay').textContent = mem;
  } catch (_) {}
}

function updateStats(stats) {
  if (!stats) return;
  $('statRunning').textContent = stats.running || 0;
  $('statSuspended').textContent = stats.suspended || 0;
  $('statStopped').textContent = stats.stopped || 0;
  $('statTotal').textContent = stats.total || 0;
}

function sessionCard(s) {
  const statusColor = { running: 'running', suspended: 'suspended', stopped: 'stopped', error: 'error', starting: 'starting', created: 'starting' }[s.status] || 'stopped';
  const isRunning = s.status === 'running';
  const isSuspended = s.status === 'suspended';

  return `
    <div class="glass rounded-xl p-5 card-hover cursor-pointer" data-session-id="${s.id}">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="status-dot ${statusColor}"></span>
          <span class="text-surface-100 font-medium text-sm">Session ${s.id}</span>
        </div>
        <span class="text-xs font-mono text-surface-500 bg-surface-800/50 px-2 py-1 rounded">${s.status}</span>
      </div>
      <div class="grid grid-cols-2 gap-3 text-xs mb-4">
        <div>
          <span class="text-surface-500 block">Resolution</span>
          <span class="text-surface-300">${s.width}x${s.height}</span>
        </div>
        <div>
          <span class="text-surface-500 block">Running</span>
          <span class="text-surface-300">${formatDuration(s.runningTime)}</span>
        </div>
        <div>
          <span class="text-surface-500 block">Idle</span>
          <span class="text-surface-300">${formatDuration(s.idleTime)}</span>
        </div>
        <div>
          <span class="text-surface-500 block">Owner</span>
          <span class="text-surface-300">${s.owner || 'default'}</span>
        </div>
      </div>
      <div class="flex gap-2">
        ${(isRunning || isSuspended) ? `<button class="open-btn flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors">Open</button>` : ''}
        ${isRunning ? `<button class="stop-btn px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded-lg transition-colors">Stop</button>` : ''}
        ${!isRunning ? `<button class="start-btn flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors">Start</button>` : ''}
        <button class="delete-btn px-3 py-1.5 bg-surface-800 hover:bg-surface-700 text-surface-400 text-xs font-medium rounded-lg transition-colors">Delete</button>
      </div>
    </div>
  `;
}

function renderSessions() {
  const grid = $('sessionGrid');
  const empty = $('emptyState');

  if (sessions.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = sessions.map(sessionCard).join('');

  grid.querySelectorAll('[data-session-id]').forEach((card) => {
    const sid = card.dataset.sessionId;
    card.querySelector('.open-btn')?.addEventListener('click', (e) => { e.stopPropagation(); openWorkspace(sid); });
    card.querySelector('.start-btn')?.addEventListener('click', (e) => { e.stopPropagation(); startSession(sid); });
    card.querySelector('.stop-btn')?.addEventListener('click', (e) => { e.stopPropagation(); stopSession(sid); });
    card.querySelector('.delete-btn')?.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(sid); });
    card.addEventListener('click', () => {
      const s = sessions.find((x) => x.id === sid);
      if (s && (s.status === 'running' || s.status === 'suspended')) openWorkspace(sid);
    });
  });
}

function updateSidebar() {
  const list = $('sidebarList');
  if (!list) return;
  list.innerHTML = sessions.map((s) => {
    const active = s.id === currentSessionId ? 'active' : '';
    const statusColor = { running: 'running', suspended: 'suspended', stopped: 'stopped', error: 'error' }[s.status] || 'stopped';
    return `
      <div class="sidebar-item rounded-lg px-3 py-2 cursor-pointer border border-transparent ${active}" data-sid="${s.id}">
        <div class="flex items-center gap-2">
          <span class="status-dot ${statusColor}"></span>
          <span class="text-xs font-medium text-surface-200 truncate">Session ${s.id.slice(0, 8)}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-sid]').forEach((el) => {
    el.addEventListener('click', () => {
      const sid = el.dataset.sid;
      if (sid !== currentSessionId) openWorkspace(sid);
    });
  });
}

async function createSession() {
  showLoading('Creating session...');
  try {
    const data = await api('/api/sessions', { method: 'POST', body: '{}' });
    showToast(`Session ${data.session.id} created`, 'success');
    await loadSessions();
    openWorkspace(data.session.id);
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

async function startSession(id) {
  try {
    await api(`/api/sessions/${id}/start`, { method: 'POST' });
    showToast(`Session ${id} started`, 'success');
    await loadSessions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function stopSession(id) {
  try {
    await api(`/api/sessions/${id}/stop`, { method: 'POST' });
    showToast(`Session ${id} stopped`);
    await loadSessions();
    if (currentSessionId === id) disconnectVnc();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteSession(id) {
  showLoading('Deleting session...');
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    hideLoading();
    showToast(`Session ${id} deleted`);
    if (currentSessionId === id) {
      disconnectVnc();
      view('dashboard');
      history.replaceState(null, '', '/');
    }
    await loadSessions();
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

async function restartSession(id) {
  try {
    await api(`/api/sessions/${id}/restart`, { method: 'POST' });
    showToast(`Session ${id} restarted`, 'success');
    await loadSessions();
    connectVnc(id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reconnectSession(id) {
  try {
    await api(`/api/sessions/${id}/reconnect`, { method: 'POST' });
    showToast(`Session ${id} reconnected`, 'success');
    await loadSessions();
    connectVnc(id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function fitVncCanvas() {
  const container = $('vncCanvas');
  const canvas = container?.querySelector('canvas');
  if (!container || !canvas) return;

  const rect = container.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  canvas.style.maxWidth = '100%';
  canvas.style.maxHeight = '100%';
  canvas.style.width = 'auto';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
}

function disconnectVnc() {
  if (rfb) {
    try { rfb.disconnect(); } catch (_) {}
    rfb = null;
  }
  $('vncControls').classList.remove('visible');
  $('workspaceVncStatus').textContent = 'Disconnected';
}

$('vncCtrlAltDel').addEventListener('click', () => {
  if (rfb) rfb.sendCtrlAltDel();
});

$('vncFullscreen').addEventListener('click', () => {
  const container = document.getElementById('vncContainer');
  if (!document.fullscreenElement) {
    container.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

$('vncDisconnect').addEventListener('click', () => {
  disconnectVnc();
});

function connectVnc(sessionId) {
  if (rfb) {
    try { rfb.disconnect(); } catch (_) {}
    rfb = null;
  }
  showLoading('Connecting to session...');
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) { hideLoading(); return; }

  const canvas = $('vncCanvas');
  canvas.innerHTML = '';
  $('vncOverlay').classList.add('hidden');

  const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = protocol + location.host + '/vnc?session=' + sessionId;

  try {
    const gen = ++vncGen;
    rfb = new RFB(canvas, url);
    rfb.viewOnly = false;
    rfb.scaleViewport = true;
    rfb.clipViewport = true;
    rfb.resizeSession = false;

    rfb.addEventListener('connect', () => {
      if (gen !== vncGen) return;
      requestAnimationFrame(() => {
        rfb.scaleViewport = true;
        rfb.clipViewport = true;
        fitVncCanvas();
      });
      hideLoading();
      $('workspaceVncStatus').textContent = 'Connected';
      $('vncOverlay').classList.add('hidden');
      $('vncControls').classList.add('visible');
      showToast('VNC connected', 'success');
    });

    rfb.addEventListener('disconnect', () => {
      if (gen !== vncGen) return;
      hideLoading();
      $('workspaceVncStatus').textContent = 'Disconnected';
      $('vncOverlay').classList.remove('hidden');
    });

    rfb.addEventListener('credentialsrequired', () => {
      showToast('VNC credentials required', 'warning');
    });

    $('workspaceResolution').textContent = `${session.width}x${session.height}`;
    window.addEventListener('resize', fitVncCanvas);
  } catch (err) {
    hideLoading();
    showToast('VNC connection failed: ' + err.message, 'error');
  }
}

async function openWorkspace(sessionId, sessionData) {
  showLoading('Opening session...');
  let session = sessionData || sessions.find((s) => s.id === sessionId);
  if (!session) {
    try {
      const data = await api(`/api/sessions/${sessionId}`);
      session = data.session;
    } catch (_) {}
  }
  if (!session) {
    session = { id: sessionId, status: 'created', width: 1280, height: 800 };
  }

  if (session.status === 'stopped' || session.status === 'created') {
    try {
      await api(`/api/sessions/${sessionId}/start`, { method: 'POST' });
      await loadSessions();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  hideLoading();
  currentSessionId = sessionId;
  history.pushState(null, '', '/' + sessionId);
  $('workspaceSessionId').textContent = sessionId;
  $('workspaceResolution').textContent = `${session.width}x${session.height}`;

  view('workspace');
  updateSidebar();
  connectVnc(sessionId);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadSessions();
    const updated = sessions.find((s) => s.id === currentSessionId);
    if (updated) {
      $('workspaceResolution').textContent = `${updated.width}x${updated.height}`;
      if (updated.status === 'stopped' || updated.status === 'error') {
        disconnectVnc();
      }
    }
  }, 5000);
}

$('createSessionBtn').addEventListener('click', createSession);
$('emptyCreateBtn').addEventListener('click', createSession);

$('backToDashboard').addEventListener('click', () => {
  disconnectVnc();
  if (pollTimer) clearInterval(pollTimer);
  currentSessionId = null;
  history.replaceState(null, '', '/');
  view('dashboard');
  loadSessions();
});

$('toolbarReconnect').addEventListener('click', () => {
  if (currentSessionId) reconnectSession(currentSessionId);
});

$('toolbarRestart').addEventListener('click', () => {
  if (currentSessionId) restartSession(currentSessionId);
});

$('toolbarStop').addEventListener('click', () => {
  if (currentSessionId) stopSession(currentSessionId);
});

window.addEventListener('popstate', () => {
  const path = window.location.pathname.replace(/^\//, '');
  if (path && path.length > 0) {
    const s = sessions.find((x) => x.id === path);
    if (s) openWorkspace(path);
  } else {
    $('backToDashboard').click();
  }
});

view('dashboard');
loadSessions().then(() => {
  const path = window.location.pathname.replace(/^\//, '');
  if (path && path.length > 0) {
    const s = sessions.find((x) => x.id === path);
    if (s) {
      openWorkspace(path);
    } else {
      showLoading('Starting session...');
      api(`/api/sessions/${path}`).then((data) => {
        if (data.session) {
          sessions.push(data.session);
          hideLoading();
          openWorkspace(path);
        } else {
          hideLoading();
          createSessionForPath(path);
        }
      }).catch(() => {
        hideLoading();
        createSessionForPath(path);
      });
    }
  }
});

async function createSessionForPath(path) {
  showLoading('Creating session...');
  try {
    const data = await api('/api/sessions', { method: 'POST', body: '{}' });
    hideLoading();
    showToast(`Session ${data.session.id} created`, 'success');
    history.replaceState(null, '', '/' + data.session.id);
    await loadSessions();
    openWorkspace(data.session.id);
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

if (statsTimer) clearInterval(statsTimer);
statsTimer = setInterval(loadSystemInfo, 5000);
loadSystemInfo();
