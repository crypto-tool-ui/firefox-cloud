function validateSessionCreate(req, res, next) {
  const { width, height } = req.body || {};
  if (width !== undefined && (typeof width !== 'number' || width < 640 || width > 3840)) {
    return res.status(400).json({ error: 'width must be between 640 and 3840' });
  }
  if (height !== undefined && (typeof height !== 'number' || height < 480 || height > 2160)) {
    return res.status(400).json({ error: 'height must be between 480 and 2160' });
  }
  next();
}

function validateSessionId(req, res, next) {
  const { id } = req.params;
  if (!id || typeof id !== 'string' || id.length < 1) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  next();
}

module.exports = { validateSessionCreate, validateSessionId };
