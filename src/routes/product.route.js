const express = require('express');
const router = express.Router();
const {
    createMainProduct,
    getAllMainProducts,
    getMainProductById,
    updateMainProduct,
    deleteMainProduct
} = require('../controllers/product.controller');

router.post('/main', createMainProduct);
router.get('/main', getAllMainProducts);
router.get('/main/:id', getMainProductById);
router.put('/main/:id', updateMainProduct);
router.delete('/main/:id', deleteMainProduct);

module.exports = router;