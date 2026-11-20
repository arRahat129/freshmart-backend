const express = require('express');
const router = express.Router();
const {
    searchBranchProductsBySku,
    createCheckout,
    getReceiptById,
    getAllReceipts
} = require('../controllers/checkout.controller');
const { populateSession, requireCashierAccess, requireReceiptReadAccess } = require('../middleware/requireAuth');

router.use(populateSession);

router.get('/products/sku', requireCashierAccess, searchBranchProductsBySku);
router.post('/', requireCashierAccess, createCheckout);
router.get('/receipts', requireReceiptReadAccess, getAllReceipts);
router.get('/receipts/:receiptId', requireReceiptReadAccess,  getReceiptById);

module.exports = router;