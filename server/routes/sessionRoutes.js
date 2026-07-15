const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/security');
const { validateSessionCreate, validateSessionId } = require('../middleware/validate');

function createSessionRoutes(sessionManager) {
  const router = Router();
  const controller = require('../controllers/sessionController').createSessionController(sessionManager);

  router.get('/', requireAuth, controller.list);
  router.post('/', requireAuth, apiLimiter, validateSessionCreate, controller.create);
  router.get('/:id', requireAuth, validateSessionId, controller.get);
  router.delete('/:id', requireAuth, validateSessionId, controller.destroy);
  router.post('/:id/start', requireAuth, validateSessionId, controller.start);
  router.post('/:id/stop', requireAuth, validateSessionId, controller.stop);
  router.post('/:id/restart', requireAuth, validateSessionId, controller.restart);
  router.post('/:id/reconnect', requireAuth, validateSessionId, controller.reconnect);

  return router;
}

module.exports = { createSessionRoutes };
