function createSystemController(sessionManager) {
  return {
    status(req, res) {
      const info = sessionManager.getSystemInfo();
      res.json(info);
    },

    stats(req, res) {
      const stats = sessionManager.getStats();
      res.json(stats);
    },
  };
}

module.exports = { createSystemController };
