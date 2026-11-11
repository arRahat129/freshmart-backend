const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const FALLBACK_IMAGE_URL = "https://i.ibb.co.com/JwgTBWgB/freshmart-logo.jpg";

const createMainProduct = async (req, res) => {
    try {
        const db = getDB();
        const { name, categoryId, sku, totalStock, pieceValue, description, images, variants, createdBy } = req.body;

        const existingProduct = await db.collection('main_products').findOne({ sku });
        if (existingProduct) {
            return res.status(400).json({ success: false, message: 'Product SKU already exists in main stock.' });
        }

        const calculatedVariantStockSum = (variants || []).reduce((acc, v) => acc + Number(v.variantStock || 0), 0);
        if (variants && variants.length > 0 && calculatedVariantStockSum !== Number(totalStock)) {
            return res.status(400).json({ success: false, message: 'Sum of all variant stocks must equal the total main stock.' });
        }

        const productImages = (images && Array.isArray(images) && images.length > 0)
            ? images
            : [FALLBACK_IMAGE_URL];

        const newMainProduct = {
            name,
            categoryId: categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null,
            sku,
            totalStock: Number(totalStock),
            pieceValue: Number(pieceValue),
            description: description || '',
            images: productImages,
            lowStockThreshold: Number(req.body.lowStockThreshold || 5),
            isStockDepleted: Number(totalStock) === 0,
            createdBy: createdBy || 'System',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const productResult = await db.collection('main_products').insertOne(newMainProduct);
        const productId = productResult.insertedId;

        if (variants && variants.length > 0) {
            const variantDocuments = variants.map(v => ({
                productId,
                productSku: sku,
                variantSku: v.variantSku,
                size: v.size,
                color: v.color,
                pricePerPiece: Number(v.pricePerPiece),
                variantStock: Number(v.variantStock),
                isVariantDepleted: Number(v.variantStock) === 0,
                createdAt: new Date(),
                updatedAt: new Date()
            }));

            await db.collection('product_variants').insertMany(variantDocuments);
        }

        return res.status(201).json({
            success: true,
            message: 'Main product and variants successfully added to main stock.',
            data: { productId, ...newMainProduct }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllMainProducts = async (req, res) => {
    try {
        const db = getDB();

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const totalProducts = await db.collection('main_products').countDocuments({});

        const products = await db.collection('main_products')
            .find({})
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const productsWithVariants = await Promise.all(products.map(async (prod) => {
            const variants = await db.collection('product_variants').find({ productId: prod._id }).toArray();
            return { ...prod, variants };
        }));

        return res.status(200).json({
            success: true,
            data: productsWithVariants,
            pagination: {
                totalProducts,
                totalPages: Math.ceil(totalProducts / limit),
                currentPage: page,
                limit
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getMainProductById = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID.' });
        }

        const product = await db.collection('main_products').findOne({ _id: new ObjectId(id) });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        const variants = await db.collection('product_variants').find({ productId: product._id }).toArray();

        return res.status(200).json({ success: true, data: { ...product, variants } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateMainProduct = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { name, categoryId, totalStock, pieceValue, description, images, variants, lowStockThreshold, updatedBy } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID.' });
        }

        const existingProduct = await db.collection('main_products').findOne({ _id: new ObjectId(id) });
        if (!existingProduct) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        const targetTotalStock = totalStock !== undefined ? Number(totalStock) : existingProduct.totalStock;
        if (variants && variants.length > 0) {
            const calculatedVariantStockSum = variants.reduce((acc, v) => acc + Number(v.variantStock || 0), 0);
            if (calculatedVariantStockSum !== targetTotalStock) {
                return res.status(400).json({ success: false, message: 'Sum of all variant stocks must equal the total main stock.' });
            }
        }

        const updateFields = {
            updatedAt: new Date(),
            updatedBy: updatedBy || 'System',
            isStockDepleted: targetTotalStock === 0
        };

        if (name !== undefined) updateFields.name = name;
        if (categoryId !== undefined) updateFields.categoryId = categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null;
        if (totalStock !== undefined) updateFields.totalStock = targetTotalStock;
        if (pieceValue !== undefined) updateFields.pieceValue = Number(pieceValue);
        if (description !== undefined) updateFields.description = description;
        if (lowStockThreshold !== undefined) updateFields.lowStockThreshold = Number(lowStockThreshold);

        if (images !== undefined && Array.isArray(images)) {
            updateFields.images = images.length > 0 ? images : [FALLBACK_IMAGE_URL];
        }

        await db.collection('main_products').updateOne({ _id: new ObjectId(id) }, { $set: updateFields });

        if (variants && Array.isArray(variants)) {
            await db.collection('product_variants').deleteMany({ productId: new ObjectId(id) });
            if (variants.length > 0) {
                const variantDocuments = variants.map(v => ({
                    productId: new ObjectId(id),
                    productSku: existingProduct.sku,
                    variantSku: v.variantSku,
                    size: v.size,
                    color: v.color,
                    pricePerPiece: Number(v.pricePerPiece),
                    variantStock: Number(v.variantStock),
                    isVariantDepleted: Number(v.variantStock) === 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }));
                await db.collection('product_variants').insertMany(variantDocuments);
            }
        }

        const updatedProduct = await db.collection('main_products').findOne({ _id: new ObjectId(id) });
        const updatedVariants = await db.collection('product_variants').find({ productId: new ObjectId(id) }).toArray();

        return res.status(200).json({ success: true, message: 'Product successfully updated.', data: { ...updatedProduct, variants: updatedVariants } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteMainProduct = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID.' });
        }

        const product = await db.collection('main_products').findOne({ _id: new ObjectId(id) });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        await db.collection('main_products').deleteOne({ _id: new ObjectId(id) });
        await db.collection('product_variants').deleteMany({ productId: new ObjectId(id) });

        return res.status(200).json({ success: true, message: 'Product and associated variants deleted successfully from main stock.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createMainProduct,
    getAllMainProducts,
    getMainProductById,
    updateMainProduct,
    deleteMainProduct
};