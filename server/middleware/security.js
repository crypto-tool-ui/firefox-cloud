const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Api-Token'],
};

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many API requests' },
});

function setupSecurity(app) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors(corsOptions));
  app.use(limiter);
}

module.exports = { setupSecurity, apiLimiter };
