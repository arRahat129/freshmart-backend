const express = require('express');
const router = express.Router();
const {
    getTopDashboardStats,
    getManagerDashboardStats,
    getCashierDashboardStats
} = require('../controllers/dashboard.controller');
const {
    populateSession,
    requireTopDashboardAccess,
    requireManagerAccess,
    requireCashierAccess
} = require('../middleware/requireAuth');

router.get('/top-stats', populateSession, requireTopDashboardAccess, getTopDashboardStats);
router.get('/manager-stats', populateSession, requireManagerAccess, getManagerDashboardStats);
router.get('/cashier-stats', populateSession, requireCashierAccess, getCashierDashboardStats);

module.exports = router;