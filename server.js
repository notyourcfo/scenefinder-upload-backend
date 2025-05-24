const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  console.log('Root endpoint accessed');
  res.status(200).json({ 
    message: 'SceneFinder backend is running',
    env: process.env.NODE_ENV,
    apiKeySet: !!process.env.OPENAI_API_KEY 
  });
});

// Test API route
app.post('/api/upload', (req, res) => {
  console.log('POST /api/upload accessed');
  res.status(200).json({ 
    message: 'Test upload endpoint',
    received: req.body 
  });
});

// Catch-all route
app.use((req, res) => {
  console.log(`Unhandled request: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Endpoint not found', path: req.url });
});

// Local server
if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });
}

module.exports = app;