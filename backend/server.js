// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); // Explicitly set path

// --- Import Database Initialization ---
const { initializeDatabase } = require('./database'); // Import the init function

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
// Note: Ensure this path matches your Stripe webhook configuration if it's different
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// --- API Routes ---
// Vercel handles serving static files (index.html, etc.) from the root.
// Express only needs to handle the API endpoints.
app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes); // Prefix generate routes
app.use('/api/library', libraryRoutes);  // Prefix library routes
app.use('/api/stripe', stripeRoutes);    // Add Stripe routes

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

// --- Start Server Function ---
// Wrap in an async function to allow awaiting DB initialization
const startServer = async () => {
  try {
    // Ensure database schema is initialized before starting the server
    await initializeDatabase();
    console.log("Database initialization check complete. Starting server...");

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      // Check for essential env vars after successful start
      if (!process.env.JWT_SECRET || !process.env.OPENAI_API_KEY || !process.env.SUNO_API_KEY) {
          console.warn("⚠️ WARNING: Ensure JWT_SECRET, OPENAI_API_KEY, SUNO_API_KEY (and others) are set in your .env file!");
      }
       if (!process.env.POSTGRES_URL) {
           console.error("❌ FATAL: POSTGRES_URL environment variable is missing!");
       }
    });

  } catch (error) {
    console.error("❌ FATAL: Failed to initialize database or start server:", error);
    process.exit(1); // Exit if critical initialization fails
  }
};

// --- Run the Server ---
startServer();
