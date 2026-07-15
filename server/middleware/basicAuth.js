const BASIC_USER = process.env.BASIC_USER || '';
const BASIC_PASS = process.env.BASIC_PASS || '';

function basicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();

  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Firefox Remote Control"');
    return res.status(401).end();
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user !== BASIC_USER || pass !== BASIC_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Firefox Remote Control"');
    return res.status(401).end();
  }

  next();
}

module.exports = { basicAuth };
