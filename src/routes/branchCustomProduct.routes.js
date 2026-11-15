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
    getBranchExplicitProducts,
    updateBranchCustomProductRequest,
    deleteBranchCustomProductRequest
} = require('../controllers/branchCustomProduct.controller');

router.post('/demand', requestBranchStock);
router.get('/demand', getAllBranchCustomProductRequests ? getAllBranchStockDemands : getAllBranchStockDemands);
router.get('/demand/:demandId', getBranchStockDemandById);
router.put('/demand/:demandId', updateBranchStockDemand);
router.delete('/demand/:demandId', deleteBranchStockDemand);
router.patch('/demand/:demandId/review', reviewStockDemand);

router.post('/return', returnStockToMain);

router.post('/requests', requestBranchCustomProduct);
router.get('/requests', getAllBranchCustomProductRequests);
router.get('/requests/:requestId', getBranchCustomProductRequestById);
router.patch('/requests/:requestId/review', reviewBranchCustomProductRequest);
router.put('/requests/:requestId', updateBranchCustomProductRequest);
router.delete('/requests/:requestId', deleteBranchCustomProductRequest);

router.get('/inventory/:branchId', getBranchExplicitProducts);

module.exports = router;