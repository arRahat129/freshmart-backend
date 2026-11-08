const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const createCategory = async (req, res) => {
    try {
        const db = getDB();
        const { name, slug, description, createdBy } = req.body;

        const existingCategory = await db.collection('categories').findOne({ slug });
        if (existingCategory) {
            return res.status(400).json({ success: false, message: 'Category slug already exists.' });
        }

        const newCategory = {
            name,
            slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
            description: description || '',
            createdBy: createdBy || 'System',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('categories').insertOne(newCategory);
        return res.status(201).json({ success: true, message: 'Category created successfully.', data: { categoryId: result.insertedId, ...newCategory } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllCategories = async (req, res) => {
    try {
        const db = getDB();
        const categories = await db.collection('categories').find({}).toArray();
        return res.status(200).json({ success: true, data: categories });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteCategory = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category ID.' });
        }

        await db.collection('categories').deleteOne({ _id: new ObjectId(id) });
        return res.status(200).json({ success: true, message: 'Category deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const createVariantAttribute = async (req, res) => {
    try {
        const db = getDB();
        const { attributeName, values, createdBy } = req.body;

        const existingAttr = await db.collection('variant_attributes').findOne({ attributeName });
        if (existingAttr) {
            return res.status(400).json({ success: false, message: 'Variant attribute name already exists.' });
        }

        const newAttr = {
            attributeName,
            values: values || [],
            createdBy: createdBy || 'System',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('variant_attributes').insertOne(newAttr);
        return res.status(201).json({ success: true, message: 'Variant attribute configured successfully.', data: { attributeId: result.insertedId, ...newAttr } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllVariantAttributes = async (req, res) => {
    try {
        const db = getDB();
        const attributes = await db.collection('variant_attributes').find({}).toArray();
        return res.status(200).json({ success: true, data: attributes });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteVariantAttribute = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid attribute ID.' });
        }

        await db.collection('variant_attributes').deleteOne({ _id: new ObjectId(id) });
        return res.status(200).json({ success: true, message: 'Variant attribute deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCategory,
    getAllCategories,
    deleteCategory,
    createVariantAttribute,
    getAllVariantAttributes,
    deleteVariantAttribute
};