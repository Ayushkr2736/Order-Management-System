const express = require('express');
const cors = require('cors');
const customerRoutes = require('./routes/customers');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 - catch all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Final error landing spot
app.use((err, req, res, next) => {
  console.error('[System Error]:', err.stack);
  res.status(500).json({ error: 'Internal server failure' });
});

// Start server only if not running as a Vercel function
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
