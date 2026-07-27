require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const merchantRoutes = require('./routes/merchants');
const adsRoutes = require('./routes/ads');
const ordersRoutes = require('./routes/orders');
const chatRoutes = require('./routes/chat');
const auditRoutes = require('./routes/audit');
const registryRoutes = require('./routes/registry');
const autoreplyRoutes = require('./routes/autoreply');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const configPath = path.join(dataDir, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    appPassword: '$2a$10$defaultHashedPasswordChangeMe',
    merchants: []
  }, null, 2));
}

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:5173'] }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/autoreply', autoreplyRoutes);

// Single source of truth for "what is actually running". Shown in Settings and
// printed at boot, so a stale build can be spotted in seconds instead of by
// grepping source files on the server.
const APP_VERSION = 'v47';
app.get('/health', (req, res) => res.json({ status: 'ok', version: APP_VERSION, timestamp: Date.now() }));

// Optionally serve the built frontend (frontend/dist) from this same process,
// so production deploys (VPS) can run ONE process on ONE origin — no CORS,
// no separate web server needed. No-op locally if dist/ hasn't been built.
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
const distIndex = path.join(distDir, 'index.html');
if (fs.existsSync(distIndex)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/health).*/, (req, res) => res.sendFile(distIndex)); // SPA fallback for client-side routing
  console.log('Serving built frontend from', distDir);
}

// Bind address is configurable via HOST env var. Defaults to 127.0.0.1
// (localhost-only — never exposed to the LAN/internet) for local/dev use.
// On a VPS behind Tailscale/WireGuard, set HOST=0.0.0.0 and let the OS
// firewall (ufw) restrict inbound access to the VPN's subnet only.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`MEXC Dashboard Backend ${APP_VERSION} running on http://${HOST}:${PORT}`);
  // 24/7 read-only capture (FTD snapshots + buyer log) — runs server-side so
  // event data stays complete even with every browser closed. CAPTURE_WORKER=0 to disable.
  require('./utils/captureWorker').start();
  // Auto-reply now runs here instead of in the browser: one sender, always on,
  // unaffected by a phone tab going to sleep. AUTO_REPLY_WORKER=0 to disable.
  require('./utils/autoReplyWorker').start();
});
