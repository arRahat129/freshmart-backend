const express = require('express');
const router = express.Router();
const {
    requestBranchStock,
    getAllBranchStockDemands,
    getBranchStockDemandById,
    updateBranchStockDemand,
    deleteBranchStockDemand,
    reviewStockDemand,
    requestBranchCustomProduct,
    getAllBranchCustomProductRequests,
    getBranchCustomProductRequestById,
    reviewBranchCustomProductRequest,
    getBranchExplicitProducts,
    updateBranchCustomProductRequest,
    deleteBranchCustomProductRequest,
    getAllBranchProducts,
    getBranchProductById,
    returnBranchStockToMain,
    deleteBranchProduct
} = require('../controllers/branchCustomProduct.controller');
const { populateSession, requireManagerAccess } = require('../middleware/requireAuth');

router.use(populateSession);

router.get('/branch-products', getAllBranchProducts);
router.get('/branch-products/:id', getBranchProductById);
router.post('/branch-products/return', requireManagerAccess, returnBranchStockToMain);
router.delete('/branch-products/:id', requireManagerAccess, deleteBranchProduct);

router.get('/demand', getAllBranchStockDemands);
router.get('/demand/:demandId', getBranchStockDemandById);
router.post('/demand', requireManagerAccess, requestBranchStock);
router.put('/demand/:demandId', requireManagerAccess, updateBranchStockDemand);
router.delete('/demand/:demandId', requireManagerAccess, deleteBranchStockDemand);
router.patch('/demand/:demandId/review', reviewStockDemand);


router.get('/requests', getAllBranchCustomProductRequests);
router.get('/requests/:requestId', getBranchCustomProductRequestById);
router.post('/requests', requireManagerAccess, requestBranchCustomProduct);
router.put('/requests/:requestId', requireManagerAccess, updateBranchCustomProductRequest);
router.delete('/requests/:requestId', requireManagerAccess, deleteBranchCustomProductRequest);
router.patch('/requests/:requestId/review', reviewBranchCustomProductRequest);

router.get('/inventory/:branchId', getBranchExplicitProducts);

module.exports = router;