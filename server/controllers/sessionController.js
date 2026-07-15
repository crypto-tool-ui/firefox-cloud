const logger = require('../utils/logger');

function createSessionController(sessionManager) {
  return {
    async list(req, res) {
      const { status } = req.query;
      const sessions = status ? sessionManager.listSessions(status) : sessionManager.listSessions();
      const stats = sessionManager.getStats();
      res.json({ sessions, stats });
    },

    async create(req, res) {
      try {
        const { width, height } = req.body || {};
        const owner = req.headers['x-api-token'] || 'anonymous';
        const session = await sessionManager.createSession({ width, height, owner });
        res.status(201).json({ session: session.toJSON() });
      } catch (err) {
        logger.error('api', `Session creation failed: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    },

    async get(req, res) {
      const session = sessionManager.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'session not found' });
      res.json({ session: session.toJSON() });
    },

    async destroy(req, res) {
      try {
        await sessionManager.destroySession(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(404).json({ error: err.message });
      }
    },

    async start(req, res) {
      try {
        const session = sessionManager.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: 'session not found' });
        if (session.status === 'running') {
          return res.json({ ok: true, alreadyRunning: true });
        }
        if (session.status === 'suspended') {
          await sessionManager.resumeSession(req.params.id);
          return res.json({ ok: true });
        }
        await sessionManager.restartSession(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    async stop(req, res) {
      try {
        await sessionManager.stopSession(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(404).json({ error: err.message });
      }
    },

    async restart(req, res) {
      try {
        await sessionManager.restartSession(req.params.id);
        const session = sessionManager.getSession(req.params.id);
        res.json({ session: session.toJSON() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    async reconnect(req, res) {
      try {
        const session = sessionManager.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: 'session not found' });
        if (session.status === 'suspended') {
          await sessionManager.resumeSession(req.params.id);
        } else if (session.status !== 'running') {
          await sessionManager.restartSession(req.params.id);
        }
        const updated = sessionManager.getSession(req.params.id);
        res.json({ session: updated.toJSON() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  };
}

module.exports = { createSessionController };
