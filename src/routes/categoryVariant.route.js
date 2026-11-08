const express = require('express');
const router = express.Router();
const {
    createCategory,
    getAllCategories,
    deleteCategory,
    createVariantAttribute,
    getAllVariantAttributes,
    deleteVariantAttribute
} = require('../controllers/categoryVariant.controller');

router.post('/categories', createCategory);
router.get('/categories', getAllCategories);
router.delete('/categories/:id', deleteCategory);

router.post('/attributes', createVariantAttribute);
router.get('/attributes', getAllVariantAttributes);
router.delete('/attributes/:id', deleteVariantAttribute);

module.exports = router;