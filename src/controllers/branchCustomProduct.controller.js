const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const FALLBACK_IMAGE_URL = "https://i.ibb.co.com/JwgTBWgB/freshmart-logo.jpg";

// ==========================================
// 1. STANDARD MAIN-STOCK DEMANDS & RETURNS
// ==========================================

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
                        $set: { isVariantDepleted: newVariantStock === 0, updatedAt: new Date() }
                    }
                );

                await db.collection('branch_inventories').updateOne(
                    { branchId: demand.branchId, productId: demand.productId, variantSku: item.variantSku },
                    {
                        $inc: { stock: item.quantity },
                        $set: { size: item.size, color: item.color, branchVariantSku: item.branchVariantSku, updatedAt: new Date() }
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
                    $set: { isStockDepleted: newTotalMainStock === 0, updatedAt: new Date() }
                }
            );
        }

        await db.collection('branch_stock_demands').updateOne(
            { _id: new ObjectId(demandId) },
            { $set: { status, reviewedBy: reviewedBy || 'Admin', adminNote: adminNote || '', updatedAt: new Date() } }
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
                { $inc: { stock: -Number(item.quantity) }, $set: { updatedAt: new Date() } }
            );

            await db.collection('product_variants').updateOne(
                { productId: new ObjectId(productId), variantSku: item.variantSku },
                { $inc: { variantStock: Number(item.quantity) }, $set: { isVariantDepleted: false, updatedAt: new Date() } }
            );
        }

        const mainProductDoc = await db.collection('main_products').findOne({ _id: new ObjectId(productId) });
        const restoredTotalStock = (mainProductDoc ? mainProductDoc.totalStock : 0) + totalItemsReturned;

        await db.collection('main_products').updateOne(
            { _id: new ObjectId(productId) },
            { $inc: { totalStock: totalItemsReturned }, $set: { isStockDepleted: false, updatedAt: new Date() } }
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

// ==========================================
// 2. CUSTOM EXCLUSIVE BRANCH PRODUCT REQUESTS
// ==========================================

const requestBranchCustomProduct = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, managerId, branchSkuPrefix, productName, categoryId, description, images, variants, managerNote } = req.body;

        if (!branchId || !managerId) {
            return res.status(400).json({ success: false, message: 'Branch ID and Manager ID are required.' });
        }

        if (!variants || !Array.isArray(variants) || variants.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one variant must be specified.' });
        }

        const productImages = (images && Array.isArray(images) && images.length > 0) ? images : [FALLBACK_IMAGE_URL];

        const newRequest = {
            branchId: ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId,
            managerId: ObjectId.isValid(managerId) ? new ObjectId(managerId) : managerId,
            branchSkuPrefix: branchSkuPrefix || 'BR-EX',
            productName,
            categoryId: categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null,
            description: description || '',
            images: productImages,
            variants: variants.map(v => ({
                variantSku: v.variantSku,
                branchVariantSku: v.branchVariantSku || `${branchSkuPrefix || 'BR-EX'}-${v.variantSku}`,
                size: v.size || 'Standard',
                color: v.color || 'Default',
                requestedStock: Number(v.requestedStock || 0),
                pricePerPiece: Number(v.pricePerPiece || 0),
                costPrice: Number(v.costPrice || 0)
            })),
            status: 'Pending',
            managerNote: managerNote || '',
            reviewedBy: null,
            adminNote: '',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('branch_custom_product_requests').insertOne(newRequest);
        return res.status(201).json({ success: true, message: 'Custom product request submitted successfully.', data: { requestId: result.insertedId, ...newRequest } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllBranchCustomProductRequests = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, status } = req.query;
        const query = {};
        if (branchId) query.branchId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
        if (status) query.status = status;

        const requests = await db.collection('branch_custom_product_requests').find(query).sort({ createdAt: -1 }).toArray();
        return res.status(200).json({ success: true, data: requests });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getBranchCustomProductRequestById = async (req, res) => {
    try {
        const db = getDB();
        const { requestId } = req.params;

        if (!ObjectId.isValid(requestId)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID.' });
        }

        const requestDoc = await db.collection('branch_custom_product_requests').findOne({ _id: new ObjectId(requestId) });
        if (!requestDoc) {
            return res.status(404).json({ success: false, message: 'Custom product request not found.' });
        }

        return res.status(200).json({ success: true, data: requestDoc });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const reviewBranchCustomProductRequest = async (req, res) => {
    try {
        const db = getDB();
        const { requestId } = req.params;
        const { status, reviewedBy, adminNote } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid review status. Must be Approved or Rejected.' });
        }

        if (!ObjectId.isValid(requestId)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID.' });
        }

        const requestDoc = await db.collection('branch_custom_product_requests').findOne({ _id: new ObjectId(requestId) });
        if (!requestDoc) {
            return res.status(404).json({ success: false, message: 'Custom product request not found.' });
        }

        if (requestDoc.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'This request has already been processed.' });
        }

        if (status === 'Approved') {
            for (const item of requestDoc.variants) {
                const explicitProductData = {
                    branchId: requestDoc.branchId,
                    managerId: requestDoc.managerId,
                    productName: requestDoc.productName,
                    categoryId: requestDoc.categoryId,
                    description: requestDoc.description,
                    images: requestDoc.images,
                    variantSku: item.variantSku,
                    branchVariantSku: item.branchVariantSku,
                    size: item.size,
                    color: item.color,
                    stock: item.requestedStock,
                    pricePerPiece: item.pricePerPiece,
                    costPrice: item.costPrice,
                    isStockDepleted: item.requestedStock === 0,
                    originRequestId: requestDoc._id,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                await db.collection('branch_explicit_products').updateOne(
                    { branchId: requestDoc.branchId, branchVariantSku: item.branchVariantSku },
                    { $set: explicitProductData, $setOnInsert: { createdAt: new Date() } },
                    { upsert: true }
                );
            }
        }

        await db.collection('branch_custom_product_requests').updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status, reviewedBy: reviewedBy || 'Admin', adminNote: adminNote || '', updatedAt: new Date() } }
        );

        return res.status(200).json({ success: true, message: `Custom product request successfully ${status.toLowerCase()}` });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getBranchExplicitProducts = async (req, res) => {
    try {
        const db = getDB();
        const { branchId } = req.params;

        if (!branchId) {
            return res.status(400).json({ success: false, message: 'Branch ID is required.' });
        }

        const queryBranchId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
        const products = await db.collection('branch_explicit_products').find({ branchId: queryBranchId }).toArray();

        return res.status(200).json({ success: true, data: products });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
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
    getBranchExplicitProducts
};