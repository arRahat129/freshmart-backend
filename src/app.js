const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const { getAuth } = require('./lib/auth');
const { connectDB } = require('./config/db');
const { populateSession, requireSession } = require('./middleware/requireAuth');
const branchRoutes = require('./routes/branch.route');
const userRoutes = require('./routes/user.route');
const productRoutes = require('./routes/product.route');
const categoryVariantRoutes = require('./routes/categoryVariant.route');
const branchCustomProductRoutes = require('./routes/branchCustomProduct.routes');
const checkoutRoutes = require('./routes/checkout.routes');
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();

const frontend = process.env.FRONTEND_URL;

app.use(cors({
    origin: frontend || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('FreshMart POS Backend is running...');
});

app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('DB connection failed:', err.message);
        res.status(503).json({ success: false, message: 'Database unavailable. Please try again.' });
    }
});

app.use("/api/auth", async (req, res, next) => {
    try {
        const { toNodeHandler } = await import("better-auth/node");
        const auth = await getAuth();
        return toNodeHandler(auth)(req, res);
    } catch (err) {
        console.error("Auth handler error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.use(populateSession);
app.use(requireSession);

app.use("/api/branches", branchRoutes);
app.use("/api/users", userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/catalog', categoryVariantRoutes);
app.use('/api/branch-requests', branchCustomProductRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/dashboard', dashboardRoutes);

module.exports = app;