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
const { populateSession, requireCatalogAccess } = require('../middleware/requireAuth');

router.use(populateSession);

router.get('/categories', getAllCategories);

router.post('/categories', requireCatalogAccess, createCategory);
router.delete('/categories/:id', requireCatalogAccess, deleteCategory);

router.get('/attributes', getAllVariantAttributes);

router.post('/attributes', requireCatalogAccess, createVariantAttribute);
router.delete('/attributes/:id', requireCatalogAccess, deleteVariantAttribute);

module.exports = router;
