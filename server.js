import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true 
}));

// ------------------- RATE LIMIT -------------------
// Limiter cho route /api/account: 10 request / 1 phút
const accountLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 10,
  message: { error: 'Too many account creations, please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Limiter cho các route khác: 30 request / 1 phút
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 30,
  message: { error: 'Too many requests, please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
})
// --------------------------------------------------

// Mail.tm base API URL
const MAILTM_API = 'https://api.mail.tm';

// Utility: random strings
const randString = (len = 10) =>
  Math.random().toString(36).slice(2, 2 + len);

// Get available domains
app.get('/api/domains', generalLimiter, async (req, res) => {
  try {
    const { data } = await axios.get(`${MAILTM_API}/domains`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch domains', details: err?.response?.data });
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
      return res.status(500).json({ error: 'No domains available' });
    }

    // Correctly extract domain
    const domain = domainList[0].domain;

    const address = `${localPart || randString(8)}@${domain}`;
    const password = randString(16);

    // Create account
    await axios.post(`${MAILTM_API}/accounts`, { address, password });

    // Get token
    const { data: tokenResp } = await axios.post(`${MAILTM_API}/token`, { address, password });

    res.json({ address, token: tokenResp.token });
  } catch (err) {
    console.error("Account creation failed:", err.response?.data || err.message);
    res.status(500).json({ error: 'Account creation failed', details: err.response?.data || err.message });
  }
});


// List messages (requires Bearer token)
app.get('/api/messages', generalLimiter, async (req, res) => {
  try {
    let auth = req.headers.authorization;
    if (!auth && req.cookies.mailtm_token) {
      auth = `Bearer ${req.cookies.mailtm_token}`;
    }
    if (!auth) return res.status(401).json({ error: 'Missing Authorization header or cookie' });

    const { data } = await axios.get(`${MAILTM_API}/messages`, {
      headers: { Authorization: auth }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages', details: err?.response?.data });
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
    res.status(500).json({ error: 'Failed to fetch message', details: err?.response?.data });
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
    res.status(500).json({ error: 'Failed to delete message', details: err?.response?.data });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
