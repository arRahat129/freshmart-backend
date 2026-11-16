const express = require('express');
const router = express.Router();
const {
    createMainProduct,
    getAllMainProducts,
    getMainProductById,
    updateMainProduct,
    deleteMainProduct
} = require('../controllers/product.controller');
const { populateSession, requireCatalogAccess } = require('../middleware/requireAuth');

router.use(populateSession);

router.get('/main', getAllMainProducts);
router.get('/main/:id', getMainProductById);

router.post('/main', requireCatalogAccess, createMainProduct);
router.put('/main/:id', requireCatalogAccess, updateMainProduct);
router.delete('/main/:id', requireCatalogAccess, deleteMainProduct);

module.exports = router;
