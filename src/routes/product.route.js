const express = require('express');
const router = express.Router();
const {
    createMainProduct,
    getAllMainProducts,
    getMainProductById,
    updateMainProduct,
    deleteMainProduct,
    requestBranchStock,
    getAllBranchStockDemands,
    getBranchStockDemandById,
    updateBranchStockDemand,
    deleteBranchStockDemand,
    reviewStockDemand,
    returnStockToMain
} = require('../controllers/product.controller');

router.post('/main', createMainProduct);
router.get('/main', getAllMainProducts);
router.get('/main/:id', getMainProductById);
router.put('/main/:id', updateMainProduct);
router.delete('/main/:id', deleteMainProduct);

router.post('/demand', requestBranchStock);
router.get('/demand', getAllBranchStockDemands);
router.get('/demand/:demandId', getBranchStockDemandById);
router.put('/demand/:demandId', updateBranchStockDemand);
router.delete('/demand/:demandId', deleteBranchStockDemand);
router.patch('/demand/:demandId/review', reviewStockDemand);

router.post('/return', returnStockToMain);

module.exports = router;