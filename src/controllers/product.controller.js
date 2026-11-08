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

const requestBranchStock = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, branchSkuPrefix, productId, requestedVariants, requestedBy, managerNote } = req.body;

        if (!requestedVariants || !Array.isArray(requestedVariants) || requestedVariants.length === 0) {
            return res.status(400).json({ success: false, message: 'Requested variants array cannot be empty.' });
        }

        for (const item of requestedVariants) {
            const variantDoc = await db.collection('product_variants').findOne({
                productId: new ObjectId(productId),
                variantSku: item.variantSku
            });

            if (!variantDoc || variantDoc.variantStock < Number(item.quantity)) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient main stock for variant SKU: ${item.variantSku}`
                });
            }
        }

        const newDemand = {
            branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId,
            branchSkuPrefix: branchSkuPrefix || 'BR',
            productId: new ObjectId(productId),
            requestedVariants: requestedVariants.map(v => ({
                variantSku: v.variantSku,
                branchVariantSku: v.branchVariantSku || `${branchSkuPrefix || 'BR'}-${v.variantSku}`,
                size: v.size,
                color: v.color,
                quantity: Number(v.quantity)
            })),
            status: 'Pending',
            requestedBy: requestedBy || 'Manager',
            managerNote: managerNote || '',
            reviewedBy: null,
            adminNote: '',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('branch_stock_demands').insertOne(newDemand);
        return res.status(201).json({ success: true, message: 'Stock demand request submitted successfully.', data: { demandId: result.insertedId, ...newDemand } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllBranchStockDemands = async (req, res) => {
    try {
        const db = getDB();
        const { branchId } = req.query;
        const query = branchId ? { branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId } : {};
        const demands = await db.collection('branch_stock_demands').find(query).toArray();

        return res.status(200).json({ success: true, data: demands });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getBranchStockDemandById = async (req, res) => {
    try {
        const db = getDB();
        const { demandId } = req.params;

        if (!ObjectId.isValid(demandId)) {
            return res.status(400).json({ success: false, message: 'Invalid demand ID.' });
        }

        const demand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!demand) {
            return res.status(404).json({ success: false, message: 'Stock demand request not found.' });
        }

        return res.status(200).json({ success: true, data: demand });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateBranchStockDemand = async (req, res) => {
    try {
        const db = getDB();
        const { demandId } = req.params;
        const { requestedVariants, managerNote, updatedBy } = req.body;

        if (!ObjectId.isValid(demandId)) {
            return res.status(400).json({ success: false, message: 'Invalid demand ID.' });
        }

        const existingDemand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!existingDemand) {
            return res.status(404).json({ success: false, message: 'Stock demand request not found.' });
        }

        if (existingDemand.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'Cannot edit a demand request that has already been reviewed.' });
        }

        const updateFields = {
            updatedAt: new Date(),
            updatedBy: updatedBy || existingDemand.requestedBy
        };

        if (managerNote !== undefined) updateFields.managerNote = managerNote;

        if (requestedVariants && Array.isArray(requestedVariants)) {
            for (const item of requestedVariants) {
                const variantDoc = await db.collection('product_variants').findOne({
                    productId: existingDemand.productId,
                    variantSku: item.variantSku
                });

                if (!variantDoc || variantDoc.variantStock < Number(item.quantity)) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient main stock for variant SKU: ${item.variantSku}`
                    });
                }
            }

            updateFields.requestedVariants = requestedVariants.map(v => ({
                variantSku: v.variantSku,
                branchVariantSku: v.branchVariantSku || `${existingDemand.branchSkuPrefix}-${v.variantSku}`,
                size: v.size,
                color: v.color,
                quantity: Number(v.quantity)
            }));
        }

        await db.collection('branch_stock_demands').updateOne({ _id: new ObjectId(demandId) }, { $set: updateFields });
        const updatedDemand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });

        return res.status(200).json({ success: true, message: 'Branch stock demand updated successfully.', data: updatedDemand });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteBranchStockDemand = async (req, res) => {
    try {
        const db = getDB();
        const { demandId } = req.params;

        if (!ObjectId.isValid(demandId)) {
            return res.status(400).json({ success: false, message: 'Invalid demand ID.' });
        }

        const demand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!demand) {
            return res.status(404).json({ success: false, message: 'Stock demand request not found.' });
        }

        if (demand.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'Cannot delete a demand request that has already been processed.' });
        }

        await db.collection('branch_stock_demands').deleteOne({ _id: new ObjectId(demandId) });

        return res.status(200).json({ success: true, message: 'Branch stock demand request deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const reviewStockDemand = async (req, res) => {
    try {
        const db = getDB();
        const { demandId } = req.params;
        const { status, reviewedBy, adminNote } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid review status.' });
        }

        const demand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!demand) {
            return res.status(404).json({ success: false, message: 'Stock demand record not found.' });
        }

        if (demand.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'This demand request has already been processed.' });
        }

        if (status === 'Approved') {
            let totalItemsMoved = 0;

            for (const item of demand.requestedVariants) {
                const variantDoc = await db.collection('product_variants').findOne({
                    productId: demand.productId,
                    variantSku: item.variantSku
                });

                if (!variantDoc || variantDoc.variantStock < item.quantity) {
                    await db.collection('branch_stock_demands').updateOne(
                        { _id: new ObjectId(demandId) },
                        { $set: { status: 'Rejected', reviewedBy: reviewedBy || 'SystemAutoCancel', adminNote: 'Auto-rejected due to insufficient stock conflict.', updatedAt: new Date() } }
                    );
                    return res.status(400).json({
                        success: false,
                        message: `Request automatically cancelled and rejected. Insufficient remaining main stock for variant: ${item.variantSku}`
                    });
                }

                totalItemsMoved += item.quantity;
                const newVariantStock = variantDoc.variantStock - item.quantity;

                await db.collection('product_variants').updateOne(
                    { productId: demand.productId, variantSku: item.variantSku },
                    {
                        $inc: { variantStock: -item.quantity },
                        $set: {
                            isVariantDepleted: newVariantStock === 0,
                            updatedAt: new Date()
                        }
                    }
                );

                await db.collection('branch_inventories').updateOne(
                    { branchId: demand.branchId, productId: demand.productId, variantSku: item.variantSku },
                    {
                        $inc: { stock: item.quantity },
                        $set: {
                            size: item.size,
                            color: item.color,
                            branchVariantSku: item.branchVariantSku,
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }

            const mainProductDoc = await db.collection('main_products').findOne({ _id: demand.productId });
            const newTotalMainStock = mainProductDoc.totalStock - totalItemsMoved;

            await db.collection('main_products').updateOne(
                { _id: demand.productId },
                {
                    $inc: { totalStock: -totalItemsMoved },
                    $set: {
                        isStockDepleted: newTotalMainStock === 0,
                        updatedAt: new Date()
                    }
                }
            );
        }

        await db.collection('branch_stock_demands').updateOne(
            { _id: new ObjectId(demandId) },
            {
                $set: {
                    status,
                    reviewedBy: reviewedBy || 'Admin',
                    adminNote: adminNote || '',
                    updatedAt: new Date()
                }
            }
        );

        return res.status(200).json({ success: true, message: `Stock demand successfully ${status.toLowerCase()}` });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const returnStockToMain = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, productId, returnVariants, returnedBy, returnReason } = req.body;

        if (!returnVariants || !Array.isArray(returnVariants) || returnVariants.length === 0) {
            return res.status(400).json({ success: false, message: 'Return variants array cannot be empty.' });
        }

        let totalItemsReturned = 0;

        for (const item of returnVariants) {
            const branchInv = await db.collection('branch_inventories').findOne({
                branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId,
                productId: new ObjectId(productId),
                variantSku: item.variantSku
            });

            if (!branchInv || branchInv.stock < Number(item.quantity)) {
                return res.status(400).json({
                    success: false,
                    message: `Branch inventory stock is insufficient for returning variant: ${item.variantSku}`
                });
            }

            totalItemsReturned += Number(item.quantity);

            await db.collection('branch_inventories').updateOne(
                { branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId, productId: new ObjectId(productId), variantSku: item.variantSku },
                {
                    $inc: { stock: -Number(item.quantity) },
                    $set: { updatedAt: new Date() }
                }
            );

            const variantDoc = await db.collection('product_variants').findOne({ productId: new ObjectId(productId), variantSku: item.variantSku });

            await db.collection('product_variants').updateOne(
                { productId: new ObjectId(productId), variantSku: item.variantSku },
                {
                    $inc: { variantStock: Number(item.quantity) },
                    $set: {
                        isVariantDepleted: false,
                        updatedAt: new Date()
                    }
                }
            );
        }

        const mainProductDoc = await db.collection('main_products').findOne({ _id: new ObjectId(productId) });
        const restoredTotalStock = (mainProductDoc ? mainProductDoc.totalStock : 0) + totalItemsReturned;

        await db.collection('main_products').updateOne(
            { _id: new ObjectId(productId) },
            {
                $inc: { totalStock: totalItemsReturned },
                $set: {
                    isStockDepleted: false,
                    updatedAt: new Date()
                }
            }
        );

        await db.collection('stock_return_logs').insertOne({
            branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId,
            productId: new ObjectId(productId),
            returnVariants,
            returnedBy: returnedBy || 'Manager',
            returnReason: returnReason || '',
            createdAt: new Date()
        });

        return res.status(200).json({ success: true, message: 'Stock successfully returned from branch to main stock.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
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
};