const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

function createSystemRoutes(sessionManager) {
  const router = Router();
  const controller = require('../controllers/systemController').createSystemController(sessionManager);

  router.get('/status', requireAuth, controller.status);
  router.get('/stats', requireAuth, controller.stats);

  return router;
}

module.exports = { createSystemRoutes };
