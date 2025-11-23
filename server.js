import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

// ------------------- RATE LIMIT -------------------
// Limiter cho route /api/account: 100 request / 1 phút
const accountLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account creations, please wait a minute.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many account creations, please wait a minute.' });
  }
});

// Limiter cho các route khác: 200 request / 1 phút
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please wait a minute.' },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please wait a minute.' });
  }
});
// --------------------------------------------------

const MAILTM_API = 'https://api.mail.tm';

const randString = (len = 10) => Math.random().toString(36).slice(2, 2 + len);

// Healthcheck endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Get available domains
app.get('/api/domains', generalLimiter, async (req, res) => {
  try {
    const { data } = await axios.get(`${MAILTM_API}/domains`);
    res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: 'Failed to fetch domains',
      details: err?.response?.data || err.message
    });
  }
});

// Create account and return token
app.post('/api/account', accountLimiter, async (req, res) => {
  try {
    const { localPart } = req.body;

    // Fetch domains
    const { data: domains } = await axios.get(`${MAILTM_API}/domains`);
    const domainList = domains['hydra:member'] || [];
    if (!domainList.length) {
      return res.status(502).json({ error: 'No domains available' }); // 502 thay vì 500 để phân biệt upstream
    }

    const domain = domainList[0].domain;

    const address = `${localPart || randString(8)}@${domain}`;
    const password = randString(16);

    // Create account
    await axios.post(`${MAILTM_API}/accounts`, { address, password });

    // Get token
    const { data: tokenResp } = await axios.post(`${MAILTM_API}/token`, { address, password });

    res.json({ address, token: tokenResp.token });
  } catch (err) {
    const status = err?.response?.status || 500;
    console.error('api/account exception Account creation failed:', err?.response?.data || err.message);
    res.status(status).json({
      error: 'Account creation failed',
      details: err?.response?.data || err.message
    });
  }
});

// List messages (requires Bearer token)
app.get('/api/messages', generalLimiter, async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });

    const { data } = await axios.get(`${MAILTM_API}/messages`, {
      headers: { Authorization: auth }
    });
    res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: 'Failed to fetch messages',
      details: err?.response?.data || err.message
    });
  }
});

// Get a single message by id
app.get('/api/messages/:id', generalLimiter, async (req, res) => {
  try {
    const auth = req.headers.authorization;
    const { id } = req.params;
    if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });

    const { data } = await axios.get(`${MAILTM_API}/messages/${id}`, {
      headers: { Authorization: auth }
    });
    res.json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: 'Failed to fetch message',
      details: err?.response?.data || err.message
    });
  }
});

// Optional: delete a message
app.delete('/api/messages/:id', generalLimiter, async (req, res) => {
  try {
    const auth = req.headers.authorization;
    const { id } = req.params;
    if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });

    await axios.delete(`${MAILTM_API}/messages/${id}`, {
      headers: { Authorization: auth }
    });
    res.json({ ok: true });
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: 'Failed to delete message',
      details: err?.response?.data || err.message
    });
  }
});

// ------------------- ERROR HANDLER -------------------
app.use((err, req, res, next) => {
  // express-rate-limit v6 dùng statusCode
  if (err?.statusCode === 429) {
    return res.status(429).json(
      typeof err.message === 'object'
        ? err.message
        : { error: err.message || 'Too many requests' }
    );
  }
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});
// -----------------------------------------------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
