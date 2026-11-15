const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const FALLBACK_IMAGE_URL = "https://i.ibb.co.com/JwgTBWgB/freshmart-logo.jpg";

const requestBranchStock = async (req, res) => {
    try {
        const db = getDB();
        const { productId, requestedVariants, managerId, managerName, managerEmail, employeeId, managerNote } = req.body;

        const parsedManagerId = managerId && ObjectId.isValid(managerId) ? new ObjectId(managerId) : null;
        const parsedProductId = productId && ObjectId.isValid(productId) ? new ObjectId(productId) : null;

        if (!parsedManagerId) {
            return res.status(400).json({ success: false, message: 'Invalid or missing manager ID.' });
        }

        if (!parsedProductId) {
            return res.status(400).json({ success: false, message: 'Invalid or missing product ID.' });
        }

        const userDoc = await db.collection('users').findOne({ _id: parsedManagerId });
        const resolvedBranchId = userDoc?.branchId || userDoc?.branchID;

        if (!userDoc || !resolvedBranchId) {
            return res.status(400).json({ success: false, message: 'Manager is not assigned to any branch.' });
        }

        const branchDoc = await db.collection('branches').findOne({ _id: resolvedBranchId });
        const resolvedBranchName = branchDoc ? branchDoc.name : '';

        const productDoc = await db.collection('main_products').findOne({ _id: parsedProductId });
        const resolvedProductName = productDoc ? (productDoc.name || productDoc.title) : 'Main Warehouse Product';

        if (!requestedVariants || !Array.isArray(requestedVariants) || requestedVariants.length === 0) {
            return res.status(400).json({ success: false, message: 'Requested variants array cannot be empty.' });
        }

        const validatedVariants = [];

        for (const item of requestedVariants) {
            const quantity = Number(item.quantity || 0);
            if (quantity <= 0) continue;

            const variantDoc = await db.collection('product_variants').findOne({
                productId: parsedProductId,
                variantSku: item.variantSku
            });

            if (!variantDoc || variantDoc.variantStock < quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient main stock for variant SKU: ${item.variantSku}`
                });
            }

            const attributes = variantDoc.attributes || [];
            const sizeAttr = attributes.find(a => a.attributeType?.toLowerCase().includes('size'));
            const colorAttr = attributes.find(a => a.attributeType?.toLowerCase().includes('color'));

            validatedVariants.push({
                variantSku: variantDoc.variantSku,
                attributes,
                size: sizeAttr ? sizeAttr.attributeValue : (item.size || 'Standard'),
                color: colorAttr ? colorAttr.attributeValue : (item.color || 'Default'),
                quantity
            });
        }

        if (validatedVariants.length === 0) {
            return res.status(400).json({ success: false, message: 'Please specify a quantity for at least one variant.' });
        }

        const newDemand = {
            branchId: resolvedBranchId,
            branchName: resolvedBranchName,
            productId: parsedProductId,
            productName: resolvedProductName,
            requestedVariants: validatedVariants,
            status: 'Pending',
            managerId: parsedManagerId,
            requestedBy: managerName || userDoc.name || 'Manager',
            managerEmail: managerEmail || userDoc.email || '',
            employeeId: employeeId || userDoc.employeeId || '',
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
        const query = branchId && ObjectId.isValid(branchId) ? { branchId: new ObjectId(branchId) } : {};
        const demands = await db.collection('branch_stock_demands').find(query).toArray();

        for (let demand of demands) {
            if (!demand.productName && demand.productId) {
                const product = await db.collection('main_products').findOne({ _id: demand.productId });
                demand.productName = product ? (product.name || product.title) : 'Main Warehouse Product';
            }
        }

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

        if (!demand.productName && demand.productId) {
            const product = await db.collection('main_products').findOne({ _id: demand.productId });
            demand.productName = product ? (product.name || product.title) : 'Main Warehouse Product';
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
            const validatedVariants = [];
            for (const item of requestedVariants) {
                const quantity = Number(item.quantity || 0);
                if (quantity <= 0) continue;

                const variantDoc = await db.collection('product_variants').findOne({
                    productId: existingDemand.productId,
                    variantSku: item.variantSku
                });

                if (!variantDoc || variantDoc.variantStock < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient main stock for variant SKU: ${item.variantSku}`
                    });
                }

                const attributes = variantDoc.attributes || [];
                const sizeAttr = attributes.find(a => a.attributeType?.toLowerCase().includes('size'));
                const colorAttr = attributes.find(a => a.attributeType?.toLowerCase().includes('color'));

                validatedVariants.push({
                    variantSku: variantDoc.variantSku,
                    attributes,
                    size: sizeAttr ? sizeAttr.attributeValue : (item.size || 'Standard'),
                    color: colorAttr ? colorAttr.attributeValue : (item.color || 'Default'),
                    quantity
                });
            }

            if (validatedVariants.length === 0) {
                return res.status(400).json({ success: false, message: 'Please specify a quantity for at least one variant.' });
            }

            updateFields.requestedVariants = validatedVariants;
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
                        $set: {
                            branchName: demand.branchName || '',
                            size: item.size,
                            color: item.color,
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

        const parsedBranchId = branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : null;
        const parsedProductId = productId && ObjectId.isValid(productId) ? new ObjectId(productId) : null;

        if (!parsedBranchId || !parsedProductId) {
            return res.status(400).json({ success: false, message: 'Invalid Branch ID or Product ID.' });
        }

        if (!returnVariants || !Array.isArray(returnVariants) || returnVariants.length === 0) {
            return res.status(400).json({ success: false, message: 'Return variants array cannot be empty.' });
        }

        let totalItemsReturned = 0;

        for (const item of returnVariants) {
            const branchInv = await db.collection('branch_inventories').findOne({
                branchId: parsedBranchId,
                productId: parsedProductId,
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
                { branchId: parsedBranchId, productId: parsedProductId, variantSku: item.variantSku },
                { $inc: { stock: -Number(item.quantity) }, $set: { updatedAt: new Date() } }
            );

            await db.collection('product_variants').updateOne(
                { productId: parsedProductId, variantSku: item.variantSku },
                { $inc: { variantStock: Number(item.quantity) }, $set: { isVariantDepleted: false, updatedAt: new Date() } }
            );
        }

        await db.collection('main_products').updateOne(
            { _id: parsedProductId },
            { $inc: { totalStock: totalItemsReturned }, $set: { isStockDepleted: false, updatedAt: new Date() } }
        );

        await db.collection('stock_return_logs').insertOne({
            branchId: parsedBranchId,
            productId: parsedProductId,
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

const requestBranchCustomProduct = async (req, res) => {
    try {
        const db = getDB();
        const { managerId, managerName, managerEmail, employeeId, productName, categoryId, description, images, variants, managerNote } = req.body;

        const parsedManagerId = managerId && ObjectId.isValid(managerId) ? new ObjectId(managerId) : null;

        if (!parsedManagerId) {
            return res.status(400).json({ success: false, message: 'Valid Manager ID is required.' });
        }

        const userDoc = await db.collection('users').findOne({ _id: parsedManagerId });
        const resolvedBranchId = userDoc?.branchId || userDoc?.branchID;

        if (!userDoc || !resolvedBranchId) {
            return res.status(400).json({ success: false, message: 'Manager is not assigned to any branch.' });
        }

        const branchDoc = await db.collection('branches').findOne({ _id: resolvedBranchId });
        const resolvedBranchName = branchDoc ? branchDoc.name : '';

        if (!variants || !Array.isArray(variants) || variants.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one variant must be specified.' });
        }

        const productImages = (images && Array.isArray(images) && images.length > 0) ? images : [FALLBACK_IMAGE_URL];

        const newRequest = {
            branchId: resolvedBranchId,
            branchName: resolvedBranchName,
            managerId: parsedManagerId,
            managerName: managerName || userDoc.name || 'Manager',
            managerEmail: managerEmail || userDoc.email || '',
            employeeId: employeeId || userDoc.employeeId || '',
            productName,
            categoryId: categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null,
            description: description || '',
            images: productImages,
            variants: variants.map(v => ({
                variantSku: v.variantSku,
                size: v.size || 'Standard',
                color: v.color || 'Default',
                requestedStock: Number(v.requestedStock || v.quantity || 0),
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
        if (branchId && ObjectId.isValid(branchId)) query.branchId = new ObjectId(branchId);
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
                    branchName: requestDoc.branchName || '',
                    managerId: requestDoc.managerId,
                    productName: requestDoc.productName,
                    categoryId: requestDoc.categoryId,
                    description: requestDoc.description,
                    images: requestDoc.images,
                    variantSku: item.variantSku,
                    size: item.size,
                    color: item.color,
                    stock: item.requestedStock,
                    pricePerPiece: item.pricePerPiece,
                    costPrice: item.costPrice,
                    isStockDepleted: item.requestedStock === 0,
                    originRequestId: requestDoc._id,
                    updatedAt: new Date()
                };

                await db.collection('branch_explicit_products').updateOne(
                    { branchId: requestDoc.branchId, variantSku: item.variantSku },
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

        if (!branchId || !ObjectId.isValid(branchId)) {
            return res.status(400).json({ success: false, message: 'Valid Branch ID is required.' });
        }

        const products = await db.collection('branch_explicit_products').find({ branchId: new ObjectId(branchId) }).toArray();

        return res.status(200).json({ success: true, data: products });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateBranchCustomProductRequest = async (req, res) => {
    try {
        const db = getDB();
        const { requestId } = req.params;
        const { productName, categoryId, description, images, variants, managerNote } = req.body;

        if (!ObjectId.isValid(requestId)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID.' });
        }

        const existingRequest = await db.collection('branch_custom_product_requests').findOne({ _id: new ObjectId(requestId) });
        if (!existingRequest) {
            return res.status(404).json({ success: false, message: 'Custom product request not found.' });
        }

        if (existingRequest.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'Cannot edit a request that has already been reviewed.' });
        }

        const updateFields = { updatedAt: new Date() };
        if (productName !== undefined) updateFields.productName = productName;
        if (categoryId !== undefined) updateFields.categoryId = categoryId && ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null;
        if (description !== undefined) updateFields.description = description;
        if (managerNote !== undefined) updateFields.managerNote = managerNote;
        if (images !== undefined && Array.isArray(images)) {
            updateFields.images = images.length > 0 ? images : existingRequest.images;
        }
        if (variants && Array.isArray(variants)) {
            updateFields.variants = variants.map(v => ({
                variantSku: v.variantSku,
                size: v.size || 'Standard',
                color: v.color || 'Default',
                requestedStock: Number(v.requestedStock || v.quantity || 0),
                pricePerPiece: Number(v.pricePerPiece || 0),
                costPrice: Number(v.costPrice || 0)
            }));
        }

        await db.collection('branch_custom_product_requests').updateOne({ _id: new ObjectId(requestId) }, { $set: updateFields });
        const updatedDoc = await db.collection('branch_custom_product_requests').findOne({ _id: new ObjectId(requestId) });

        return res.status(200).json({ success: true, message: 'Custom product request updated successfully.', data: updatedDoc });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteBranchCustomProductRequest = async (req, res) => {
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

        if (requestDoc.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'Cannot delete a request that has already been processed.' });
        }

        await db.collection('branch_custom_product_requests').deleteOne({ _id: new ObjectId(requestId) });

        return res.status(200).json({ success: true, message: 'Custom product request deleted successfully.' });
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
    getBranchExplicitProducts,
    updateBranchCustomProductRequest,
    deleteBranchCustomProductRequest
};