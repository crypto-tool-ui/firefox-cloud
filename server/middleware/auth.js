const API_TOKEN = process.env.API_TOKEN || null;

function requireAuth(req, res, next) {
  if (!API_TOKEN) return next();
  const token = req.headers['x-api-token'];
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { requireAuth };
