const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const { toNodeHandler } = require("better-auth/node");
const { getAuth } = require('./lib/auth');

const app = express();

const frontend = process.env.FRONTEND_URL;

app.use(cors({
    origin: frontend || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());

app.use("/api/auth", async (req, res) => {
    const auth = getAuth();
    return toNodeHandler(auth)(req, res);
});

app.get('/', (req, res) => {
    res.send('FreshMart POS Backend is running...');
});

module.exports = app;