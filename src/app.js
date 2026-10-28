const express = require('express');
const cors = require('cors');
const { toNodeHandler } = require("better-auth/node");
const { getAuth } = require('./lib/auth');

const app = express();

app.use(cors({
    origin: 'http://localhost:3000',
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