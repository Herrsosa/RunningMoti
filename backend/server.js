// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); // Explicitly set path
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Avoid if possible, better to configure certs

// --- Import Routes ---
const authRoutes = require('./routes/auth');
const generateRoutes = require('./routes/generate');
const libraryRoutes = require('./routes/library');
const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors()); // Consider more restrictive CORS settings for production
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // If using callbacks via form post

// Special handling for Stripe webhooks
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// --- Static Files ---
// Serve frontend files (HTML, CSS, JS, images) from the parent directory
app.use(express.static(path.join(__dirname, '..')));

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes); // Prefix generate routes
app.use('/api/library', libraryRoutes);  // Prefix library routes
app.use('/api/stripe', stripeRoutes);    // Add Stripe routes

// --- Serve index.html for the root path and potentially other frontend routes ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
// Add more frontend routes here if using client-side routing (e.g., React Router)
// app.get('/login', (req, res) => { ... });
// app.get('/library', (req, res) => { ... });


// --- Simple Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// --- Catch-all for 404 API routes ---
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// --- Basic Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack || err);
  // Avoid sending stack trace to client in production
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!process.env.JWT_SECRET || !process.env.OPENAI_API_KEY || !process.env.SUNO_API_KEY) {
      console.warn("⚠️ WARNING: Ensure JWT_SECRET, OPENAI_API_KEY, SUNO_API_KEY (and others) are set in your .env file!");
  }
});
