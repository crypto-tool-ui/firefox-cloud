# Firefox Remote Control — Project Knowledge

## Project Summary

Multi-session remote browser control platform. Spawns Firefox instances on virtual X displays (Xvfb), streams via VNC (x11vnc), proxies VNC over WebSocket to browser-based noVNC canvas. Sessions persist independently of browser tabs.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js |
| Web | Express 5 |
| WS | ws 8.x |
| Frontend | Vanilla HTML/CSS/JS |
| VNC client | @novnc/novnc 1.7 |
| CSS | TailwindCSS (CDN) |
| Sys deps | Xvfb, x11vnc, fluxbox, firefox |
| Testing | Node --test |
| Security | Helmet, express-rate-limit, CORS |
| Deploy | systemd + Nginx |

## Folder Map

- **`server/`** — Backend application code
  - **`app.js`** — Entry point, Express setup, server init
  - **`routes/`** — Express route definitions
    - `sessionRoutes.js` — Session CRUD + actions
    - `systemRoutes.js` — System status/stats
  - **`controllers/`** — Request handlers
    - `sessionController.js` — Session API handlers
    - `systemController.js` — System API handlers
  - **`sessions/`** — Session management
    - `SessionManager.js` — Multi-session lifecycle (create/destroy/suspend/resume/restart)
  - **`websocket/`** — WebSocket handling
    - `vncProxy.js` — Multi-session VNC WebSocket-to-TCP proxy
  - **`middleware/`** — Express middleware
    - `auth.js` — API token authentication
    - `security.js` — Helmet, CORS, rate limiting setup
    - `validate.js` — Request validation
  - **`utils/`** — Utilities
    - `logger.js` — Structured logging
    - `displayAllocator.js` — X display number allocation
    - `portAllocator.js` — VNC port allocation
- **`public/`** — Frontend static files
  - `index.html` — Dashboard + session management UI
  - `js/app.js` — Frontend application logic
  - `novnc/` — Bundled @novnc/novnc library
- **`profiles/`** — Firefox profile directories (created at runtime)
- **`.env.example`** — Environment config template

## Architecture

```
Browser ──HTTP──> Express ──WS(/vnc?session=xxx)──> VncProxy ──TCP──> x11vnc(:display) ──> Xvfb(:display)
                                                              │
                                                              └──> Firefox(--profile)
                                      ┌──── Xvfb(:99)  ── firefox(profile-A)
                                      │
               SessionManager ────────┼──── Xvfb(:100) ── firefox(profile-B)
                                      │
                                      └──── Xvfb(:101) ── firefox(profile-C)
```

Every session owns isolated: display number, VNC port, Xvfb process, Firefox process, Firefox profile, x11vnc process, (optional) fluxbox process.

## API

### Sessions

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/sessions` | X-Api-Token |
| POST | `/api/sessions` | X-Api-Token |
| GET | `/api/sessions/:id` | X-Api-Token |
| DELETE | `/api/sessions/:id` | X-Api-Token |
| POST | `/api/sessions/:id/start` | X-Api-Token |
| POST | `/api/sessions/:id/stop` | X-Api-Token |
| POST | `/api/sessions/:id/restart` | X-Api-Token |
| POST | `/api/sessions/:id/reconnect` | X-Api-Token |

### System

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/system/status` | X-Api-Token |
| GET | `/api/system/stats` | X-Api-Token |

### WebSocket

| Path | Auth | Purpose |
|------|------|---------|
| `/vnc?session=:id` | none | VNC binary frames relay |

Auth bypassed when `API_TOKEN` env var is falsy.

## Session Lifecycle

```
created → starting → running ↔ suspended
                        ↓
                     stopping → stopped → (destroyed)
                        ↓
                      error
```

- Sessions survive browser tab closure (background process)
- Idle timeout auto-suspends sessions (30 min default)
- Reconnect resumes a suspended session (Xvfb + Firefox stay alive, only x11vnc restarts)
- Process death auto-stops the session
- SIGINT/SIGTERM cleans up all sessions

## Database

None. Session metadata stored in-memory Map. ID allocators (display, port) are simple in-memory counters. Architecture ready for SQLite/Postgres/Redis replacement of SessionManager persistence layer.

## Coding Conventions

- **Files**: kebab-case for directories, camelCase for JS files
- **Classes**: PascalCase (`SessionManager`, `VncProxyManager`, `Session`)
- **Functions**: camelCase (`createSession`, `stopSession`, `attachToServer`)
- **Variables**: camelCase (`sessionManager`, `rfbPort`)
- **Modules**: CommonJS (`require`/`module.exports`) on server, ES modules (`import`) on frontend
- **Error handling**: Async/await with try/catch in controllers. Session-level error status tracking.
- **Logging**: Structured `[timestamp] [LEVEL] [tag] message` via logger utility.

## Existing Features

- [x] Multi-session concurrent Firefox instances
- [x] Session create/destroy/stop/restart/reconnect
- [x] Session suspend/resume (idle timeout)
- [x] Isolated Xvfb display per session
- [x] Isolated Firefox profile per session
- [x] Isolated VNC port per session
- [x] Optional window manager per session
- [x] WebSocket-to-TCP VNC proxy with session routing
- [x] REST API with auth token
- [x] Low resource idle (suspend stops x11vnc only)
- [x] Session auto-cleanup on process crash
- [x] SIGINT/SIGTERM graceful shutdown
- [x] Helmet security headers
- [x] Rate limiting on API
- [x] CORS configuration
- [x] Input validation on session creation
- [x] Structured logging
- [x] Port/display number allocation management
- [x] System info endpoint (CPU, memory, uptime)

## Missing Features (not implemented)

- [ ] Postgres/SQLite session persistence
- [ ] File upload/download to/from browser
- [ ] Session live thumbnails
- [ ] Clipboard sync host ↔ browser
- [ ] User accounts/JWT auth
- [ ] Websocket control channel per session
- [ ] Frontend TailwindCSS dashboard
- [ ] Session workspace view
- [ ] Live session logs
- [ ] Audio streaming
- [ ] Dockerfile
- [ ] CI/CD
- [ ] Comprehensive test suite

## Known Issues

1. **Allocator reset** — Display/port allocators are in-memory; server restart resets them
2. **No process group** — Child processes not spawned in a group; edge cases may orphan
3. **Xvfb fs wait** — `_waitForX` polls filesystem every 100ms; no X11 sync protocol
4. **Suspend stops Xvfb** — Suspend currently only stops x11vnc; Xvfb/Firefox consume RAM while suspended
5. **Single commit** — No meaningful git history
6. **No graceful degradation** — Crashes if system deps not installed
7. **Session metadata lost** — All in-memory; server restart wipes sessions

## Important Files

- `server/app.js` — Entry point, route mounting, server lifecycle
- `server/sessions/SessionManager.js` — Core session lifecycle engine
- `server/websocket/vncProxy.js` — VNC WebSocket proxy with session routing
- `server/middleware/auth.js` — API token authentication
- `server/controllers/sessionController.js` — Session API handlers
- `public/index.html` — Frontend dashboard
- `public/js/app.js` — Frontend application logic
- `package.json` — Dependencies and scripts
