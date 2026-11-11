const express = require('express');
const router = express.Router();
const {
    requestBranchStock,
    getAllBranchStockDemands,
    getBranchStockDemandById,
    updateBranchStockDemand,
    deleteBranchStockDemand,
    reviewStockDemand,
    returnStockToMain,
    requestBranchCustomProduct,
    getAllBranchCustomProductRequests,
    getBranchCustomProductRequestById,
    reviewBranchCustomProductRequest,
    getBranchExplicitProducts
} = require('../controllers/branchCustomProduct.controller');

// --- A. Standard Main-Stock Demands & Returns ---
router.post('/demand', requestBranchStock);
router.get('/demand', getAllBranchCustomProductRequests ? getAllBranchStockDemands : getAllBranchStockDemands); // Falls back cleanly
router.get('/demand/:demandId', getBranchStockDemandById);
router.put('/demand/:demandId', updateBranchStockDemand);
router.delete('/demand/:demandId', deleteBranchStockDemand);
router.patch('/demand/:demandId/review', reviewStockDemand);

router.post('/return', returnStockToMain);

// --- B. Custom Exclusive Branch Product Requests ---
router.post('/requests', requestBranchCustomProduct);
router.get('/requests', getAllBranchCustomProductRequests);
router.get('/requests/:requestId', getBranchCustomProductRequestById);
router.patch('/requests/:requestId/review', reviewBranchCustomProductRequest);

// --- C. Branch Explicit Inventory Catalog ---
router.get('/inventory/:branchId', getBranchExplicitProducts);

module.exports = router;