const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const FALLBACK_IMAGE_URL = "https://i.ibb.co.com/JwgTBWgB/freshmart-logo.jpg";

const resolveBranchName = async (db, branchId) => {
    if (!branchId) return '';
    try {
        const queryId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
        const stringId = String(branchId);

        const branchDoc = await db.collection('branches').findOne({
            $or: [
                { _id: queryId },
                { _id: stringId }
            ]
        });
        return branchDoc ? (branchDoc.name || branchDoc.branchName || '') : '';
    } catch {
        return '';
    }
};

const resolveProductName = async (db, productId) => {
    if (!productId) return 'Warehouse Product';
    try {
        const queryId = ObjectId.isValid(productId) ? new ObjectId(productId) : productId;
        const stringId = String(productId);

        const prodDoc = await db.collection('main_products').findOne({
            $or: [
                { _id: queryId },
                { _id: stringId }
            ]
        });
        return prodDoc ? (prodDoc.name || prodDoc.title || '') : 'Warehouse Product';
    } catch {
        return 'Warehouse Product';
    }
};

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

        const resolvedBranchName = await resolveBranchName(db, resolvedBranchId);
        const resolvedProductName = await resolveProductName(db, parsedProductId);

        const productDoc = await db.collection('main_products').findOne({ _id: parsedProductId });
        const resolvedProductImages = (productDoc && Array.isArray(productDoc.images) && productDoc.images.length > 0)
            ? productDoc.images
            : [FALLBACK_IMAGE_URL];

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
            images: resolvedProductImages,
            requestedVariants: validatedVariants,
            status: 'Pending',
            managerId: parsedManagerId,
            requestedBy: managerName || userDoc.name || 'Manager',
            managerEmail: managerEmail || userDoc.email || '',
            employeeId: employeeId || userDoc.employeeId || '',
            managerNote: managerNote || '',
            reviewedBy: null,
            reviewedByName: '',
            adminNote: '',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('branch_stock_demands').insertOne(newDemand);
        return res.status(201).json({
            success: true,
            message: 'Stock demand request submitted successfully.',
            data: { demandId: result.insertedId, ...newDemand }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllBranchStockDemands = async (req, res) => {
    try {
        const db = getDB();
        const { branchId } = req.query;
        const query = branchId && ObjectId.isValid(branchId) ? { branchId: new ObjectId(branchId) } : {};
        const demands = await db.collection('branch_stock_demands').find(query).sort({ createdAt: -1 }).toArray();

        for (let demand of demands) {
            if (!demand.branchName && demand.branchId) {
                demand.branchName = await resolveBranchName(db, demand.branchId);
            }
            if ((!demand.productName || !Array.isArray(demand.images) || demand.images.length === 0) && demand.productId) {
                const product = await db.collection('main_products').findOne({ _id: demand.productId });
                if (!demand.productName) {
                    demand.productName = product ? (product.name || product.title) : 'Main Warehouse Product';
                }
                if (!Array.isArray(demand.images) || demand.images.length === 0) {
                    demand.images = (product && Array.isArray(product.images) && product.images.length > 0)
                        ? product.images
                        : [FALLBACK_IMAGE_URL];
                }
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

        if (!demand.branchName && demand.branchId) {
            demand.branchName = await resolveBranchName(db, demand.branchId);
        }

        if ((!demand.productName || !Array.isArray(demand.images) || demand.images.length === 0) && demand.productId) {
            const product = await db.collection('main_products').findOne({ _id: demand.productId });
            if (!demand.productName) {
                demand.productName = product ? (product.name || product.title) : 'Main Warehouse Product';
            }
            if (!Array.isArray(demand.images) || demand.images.length === 0) {
                demand.images = (product && Array.isArray(product.images) && product.images.length > 0)
                    ? product.images
                    : [FALLBACK_IMAGE_URL];
            }
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

        if (String(existingDemand.status || '').toLowerCase() !== 'pending') {
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
        const reviewedBy = req.body?.reviewedBy || req.query?.reviewedBy;
        const reviewedByName = req.body?.reviewedByName || req.query?.reviewedByName;
        const adminNote = req.body?.adminNote || req.query?.adminNote;
        const isAdminDelete = req.body?.isAdminDelete || req.query?.isAdminDelete;

        if (!ObjectId.isValid(demandId)) {
            return res.status(400).json({ success: false, message: 'Invalid demand ID.' });
        }

        const demand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!demand) {
            return res.status(404).json({ success: false, message: 'Stock demand request not found.' });
        }

        let resolvedBranchName = demand.branchName;
        if (!resolvedBranchName) {
            resolvedBranchName = await resolveBranchName(db, demand.branchId);
        }

        let resolvedProductName = demand.productName;
        if (!resolvedProductName) {
            resolvedProductName = await resolveProductName(db, demand.productId);
        }

        const isPending = String(demand.status || '').toLowerCase() === 'pending';

        if (isPending && isAdminDelete) {
            if (!adminNote || !adminNote.trim()) {
                return res.status(400).json({ success: false, message: 'Rejection reason is required to delete a pending request.' });
            }

            const parsedReviewerId = reviewedBy && ObjectId.isValid(reviewedBy) ? new ObjectId(reviewedBy) : null;

            await db.collection('request_rejections').insertOne({
                requestId: demand._id,
                requestType: 'standard',
                branchId: demand.branchId,
                branchName: resolvedBranchName,
                productId: demand.productId,
                productName: resolvedProductName,
                requestedVariants: demand.requestedVariants,
                requestedByManagerId: demand.managerId,
                requestedByManagerName: demand.requestedBy || 'Manager',
                rejectedBy: parsedReviewerId,
                rejectedByName: reviewedByName || 'Admin',
                reason: adminNote.trim(),
                deletedImmediately: true,
                rejectedAt: new Date()
            });
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
        const { status, reviewedBy, reviewedByName, adminNote } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid review status.' });
        }

        if (!ObjectId.isValid(demandId)) {
            return res.status(400).json({ success: false, message: 'Invalid demand ID.' });
        }

        const demand = await db.collection('branch_stock_demands').findOne({ _id: new ObjectId(demandId) });
        if (!demand) {
            return res.status(404).json({ success: false, message: 'Stock demand record not found.' });
        }

        if (String(demand.status || '').toLowerCase() !== 'pending') {
            return res.status(400).json({ success: false, message: 'This demand request has already been processed.' });
        }

        const parsedReviewerId = reviewedBy && ObjectId.isValid(reviewedBy) ? new ObjectId(reviewedBy) : null;

        let resolvedBranchName = demand.branchName;
        if (!resolvedBranchName) {
            resolvedBranchName = await resolveBranchName(db, demand.branchId);
        }

        let resolvedProductName = demand.productName;
        if (!resolvedProductName) {
            resolvedProductName = await resolveProductName(db, demand.productId);
        }

        if (status === 'Approved') {
            let totalItemsMoved = 0;

            for (const item of demand.requestedVariants) {
                const variantDoc = await db.collection('product_variants').findOne({
                    productId: demand.productId,
                    variantSku: item.variantSku
                });

                if (!variantDoc || variantDoc.variantStock < item.quantity) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient remaining main stock for variant: ${item.variantSku}`
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
                            branchName: resolvedBranchName,
                            size: item.size,
                            color: item.color,
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }

            const mainProductDoc = await db.collection('main_products').findOne({ _id: demand.productId });
            const newTotalMainStock = Math.max(0, (mainProductDoc?.totalStock || 0) - totalItemsMoved);

            await db.collection('main_products').updateOne(
                { _id: demand.productId },
                {
                    $inc: { totalStock: -totalItemsMoved },
                    $set: { isStockDepleted: newTotalMainStock === 0, updatedAt: new Date() }
                }
            );
        } else if (status === 'Rejected') {
            if (!adminNote || !adminNote.trim()) {
                return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
            }

            await db.collection('request_rejections').insertOne({
                requestId: demand._id,
                requestType: 'standard',
                branchId: demand.branchId,
                branchName: resolvedBranchName,
                productId: demand.productId,
                productName: resolvedProductName,
                requestedVariants: demand.requestedVariants,
                requestedByManagerId: demand.managerId,
                requestedByManagerName: demand.requestedBy || 'Manager',
                rejectedBy: parsedReviewerId,
                rejectedByName: reviewedByName || 'Admin',
                reason: adminNote.trim(),
                deletedImmediately: false,
                rejectedAt: new Date()
            });
        }

        await db.collection('branch_stock_demands').updateOne(
            { _id: new ObjectId(demandId) },
            {
                $set: {
                    status: status,
                    reviewedBy: parsedReviewerId,
                    reviewedByName: reviewedByName || 'Admin',
                    adminNote: adminNote || '',
                    branchName: resolvedBranchName,
                    productName: resolvedProductName,
                    updatedAt: new Date()
                }
            }
        );

        return res.status(200).json({ success: true, message: `Stock demand successfully ${status.toLowerCase()}` });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const returnBranchStockToMain = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, productId, variantSku, returnQuantity, returnedBy, returnReason, productType } = req.body;

        const qty = Number(returnQuantity);
        if (!qty || qty <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid return quantity.' });
        }

        const parsedBranchId = branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : null;
        const parsedProductId = productId && ObjectId.isValid(productId) ? new ObjectId(productId) : null;

        if (!parsedBranchId || !variantSku) {
            return res.status(400).json({ success: false, message: 'Missing branch ID or variant SKU.' });
        }

        const resolvedBranchName = await resolveBranchName(db, parsedBranchId);

        if (productType === 'custom') {
            const explicitProd = await db.collection('branch_explicit_products').findOne({
                branchId: parsedBranchId,
                variantSku
            });

            if (!explicitProd || explicitProd.stock < qty) {
                return res.status(400).json({ success: false, message: 'Branch stock is insufficient for return.' });
            }

            const newStock = Math.max(0, explicitProd.stock - qty);
            await db.collection('branch_explicit_products').updateOne(
                { _id: explicitProd._id },
                { $set: { stock: newStock, isStockDepleted: newStock === 0, updatedAt: new Date() } }
            );
        } else {
            const branchInv = await db.collection('branch_inventories').findOne({
                branchId: parsedBranchId,
                productId: parsedProductId,
                variantSku
            });

            if (!branchInv || branchInv.stock < qty) {
                return res.status(400).json({ success: false, message: 'Branch inventory stock is insufficient for return.' });
            }

            const newBranchStock = Math.max(0, branchInv.stock - qty);
            await db.collection('branch_inventories').updateOne(
                { _id: branchInv._id },
                { $set: { stock: newBranchStock, updatedAt: new Date() } }
            );

            if (parsedProductId) {
                const variantDoc = await db.collection('product_variants').findOne({
                    productId: parsedProductId,
                    variantSku
                });
                const newVariantStock = (variantDoc?.variantStock || 0) + qty;

                await db.collection('product_variants').updateOne(
                    { productId: parsedProductId, variantSku },
                    { $inc: { variantStock: qty }, $set: { isVariantDepleted: newVariantStock === 0, updatedAt: new Date() } }
                );

                const mainProductDoc = await db.collection('main_products').findOne({ _id: parsedProductId });
                const newTotalMainStock = (mainProductDoc?.totalStock || 0) + qty;

                await db.collection('main_products').updateOne(
                    { _id: parsedProductId },
                    { $inc: { totalStock: qty }, $set: { isStockDepleted: newTotalMainStock === 0, updatedAt: new Date() } }
                );
            }
        }

        await db.collection('stock_return_logs').insertOne({
            branchId: parsedBranchId,
            branchName: resolvedBranchName,
            productId: parsedProductId,
            variantSku,
            quantityReturned: qty,
            returnedBy: returnedBy || req.user?.name || 'Manager',
            returnReason: returnReason || '',
            createdAt: new Date()
        });

        return res.status(200).json({ success: true, message: 'Stock successfully returned to main warehouse.' });
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

        const resolvedBranchName = await resolveBranchName(db, resolvedBranchId);

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
            reviewedByName: '',
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
        for (let reqDoc of requests) {
            if (!reqDoc.branchName && reqDoc.branchId) {
                reqDoc.branchName = await resolveBranchName(db, reqDoc.branchId);
            }
        }

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

        if (!requestDoc.branchName && requestDoc.branchId) {
            requestDoc.branchName = await resolveBranchName(db, requestDoc.branchId);
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
        const { status, reviewedBy, reviewedByName, adminNote } = req.body;

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

        if (String(requestDoc.status || '').toLowerCase() !== 'pending') {
            return res.status(400).json({ success: false, message: 'This request has already been processed.' });
        }

        const parsedReviewerId = reviewedBy && ObjectId.isValid(reviewedBy) ? new ObjectId(reviewedBy) : null;
        let resolvedBranchName = requestDoc.branchName;
        if (!resolvedBranchName) {
            resolvedBranchName = await resolveBranchName(db, requestDoc.branchId);
        }

        if (status === 'Approved') {
            for (const item of requestDoc.variants) {
                const explicitProductData = {
                    branchId: requestDoc.branchId,
                    branchName: resolvedBranchName,
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
        } else if (status === 'Rejected') {
            if (!adminNote || !adminNote.trim()) {
                return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
            }

            await db.collection('request_rejections').insertOne({
                requestId: requestDoc._id,
                requestType: 'custom',
                branchId: requestDoc.branchId,
                branchName: resolvedBranchName,
                productName: requestDoc.productName || 'Custom Product',
                requestedVariants: requestDoc.variants,
                requestedByManagerId: requestDoc.managerId,
                requestedByManagerName: requestDoc.managerName || 'Manager',
                rejectedBy: parsedReviewerId,
                rejectedByName: reviewedByName || 'Admin',
                reason: adminNote.trim(),
                deletedImmediately: false,
                rejectedAt: new Date()
            });
        }

        await db.collection('branch_custom_product_requests').updateOne(
            { _id: new ObjectId(requestId) },
            {
                $set: {
                    status: status,
                    reviewedBy: parsedReviewerId,
                    reviewedByName: reviewedByName || 'Admin',
                    adminNote: adminNote || '',
                    branchName: resolvedBranchName,
                    updatedAt: new Date()
                }
            }
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

        if (String(existingRequest.status || '').toLowerCase() !== 'pending') {
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
        const reviewedBy = req.body?.reviewedBy || req.query?.reviewedBy;
        const reviewedByName = req.body?.reviewedByName || req.query?.reviewedByName;
        const adminNote = req.body?.adminNote || req.query?.adminNote;
        const isAdminDelete = req.body?.isAdminDelete || req.query?.isAdminDelete;

        if (!ObjectId.isValid(requestId)) {
            return res.status(400).json({ success: false, message: 'Invalid request ID.' });
        }

        const requestDoc = await db.collection('branch_custom_product_requests').findOne({ _id: new ObjectId(requestId) });
        if (!requestDoc) {
            return res.status(404).json({ success: false, message: 'Custom product request not found.' });
        }

        let resolvedBranchName = requestDoc.branchName;
        if (!resolvedBranchName) {
            resolvedBranchName = await resolveBranchName(db, requestDoc.branchId);
        }

        const isPending = String(requestDoc.status || '').toLowerCase() === 'pending';

        if (isPending && isAdminDelete) {
            if (!adminNote || !adminNote.trim()) {
                return res.status(400).json({ success: false, message: 'Rejection reason is required to delete a pending request.' });
            }

            const parsedReviewerId = reviewedBy && ObjectId.isValid(reviewedBy) ? new ObjectId(reviewedBy) : null;

            await db.collection('request_rejections').insertOne({
                requestId: requestDoc._id,
                requestType: 'custom',
                branchId: requestDoc.branchId,
                branchName: resolvedBranchName,
                productName: requestDoc.productName || 'Custom Product',
                requestedVariants: requestDoc.variants,
                requestedByManagerId: requestDoc.managerId,
                requestedByManagerName: requestDoc.managerName || 'Manager',
                rejectedBy: parsedReviewerId,
                rejectedByName: reviewedByName || 'Admin',
                reason: adminNote.trim(),
                deletedImmediately: true,
                rejectedAt: new Date()
            });
        }

        await db.collection('branch_custom_product_requests').deleteOne({ _id: new ObjectId(requestId) });

        return res.status(200).json({ success: true, message: 'Custom product request deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllBranchProducts = async (req, res) => {
    try {
        const db = getDB();
        const { branchId, page = 1, limit = 10, search = '', sort = 'latest', stockFilter = '', categoryId = '' } = req.query;

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const baseQuery = branchId && ObjectId.isValid(branchId) ? { branchId: new ObjectId(branchId) } : {};

        const standardInventory = await db.collection('branch_inventories').find(baseQuery).toArray();
        const groupedStandardMap = new Map();

        for (const item of standardInventory) {
            let productName = item.productName;
            let images = item.images || [];
            let description = item.description || '';
            let pricePerPiece = item.pricePerPiece || 0;
            let catId = item.categoryId || null;

            if (item.productId) {
                const prodQueryId = ObjectId.isValid(item.productId) ? new ObjectId(item.productId) : item.productId;
                const mainProd = await db.collection('main_products').findOne({
                    $or: [{ _id: prodQueryId }, { _id: String(item.productId) }]
                });
                const variantDoc = await db.collection('product_variants').findOne({
                    productId: prodQueryId,
                    variantSku: item.variantSku
                });

                if (mainProd) {
                    productName = productName || mainProd.name || mainProd.title || 'Warehouse Product';
                    images = images.length > 0 ? images : (mainProd.images || [FALLBACK_IMAGE_URL]);
                    description = description || mainProd.description || '';
                    catId = mainProd.categoryId || catId || null;
                    pricePerPiece = pricePerPiece || variantDoc?.price || variantDoc?.pricePerPiece || mainProd.price || mainProd.pricePerPiece || 0;
                }
            }

            const itemStock = Number(item.stock ?? 0);
            const groupKey = `standard_${String(item.productId || item._id)}`;

            const variantEntry = {
                _id: item._id,
                variantSku: item.variantSku,
                size: item.size || 'Standard',
                color: item.color || 'Default',
                stock: itemStock,
                pricePerPiece
            };

            if (!groupedStandardMap.has(groupKey)) {
                groupedStandardMap.set(groupKey, {
                    _id: item._id,
                    groupId: groupKey,
                    branchId: item.branchId,
                    branchName: item.branchName,
                    productId: item.productId,
                    productType: 'standard',
                    productName: productName || 'Warehouse Product',
                    variantSku: item.variantSku,
                    size: item.size || 'Standard',
                    color: item.color || 'Default',
                    images: images.length > 0 ? images : [FALLBACK_IMAGE_URL],
                    description,
                    pricePerPiece,
                    categoryId: catId,
                    variants: [variantEntry],
                    stock: itemStock,
                    totalStock: itemStock,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                });
            } else {
                const existing = groupedStandardMap.get(groupKey);
                existing.variants.push(variantEntry);
                existing.totalStock += itemStock;
                existing.stock = existing.totalStock;
                existing.variantSku = `${existing.variants.length} Variants`;
                if (new Date(item.createdAt || 0) > new Date(existing.createdAt || 0)) {
                    existing.createdAt = item.createdAt;
                }
            }
        }

        const customProducts = await db.collection('branch_explicit_products').find(baseQuery).toArray();
        const groupedCustomMap = new Map();

        for (const p of customProducts) {
            const itemStock = Number(p.stock ?? p.requestedStock ?? 0);
            const normalizedName = (p.productName || '').trim().toLowerCase();
            const groupKey = `custom_${normalizedName}_${String(p.categoryId || '')}`;

            const variantEntry = {
                _id: p._id,
                variantSku: p.variantSku,
                size: p.size || 'Standard',
                color: p.color || 'Default',
                stock: itemStock,
                pricePerPiece: p.pricePerPiece || p.pieceValue || 0
            };

            if (!groupedCustomMap.has(groupKey)) {
                groupedCustomMap.set(groupKey, {
                    ...p,
                    groupId: groupKey,
                    productType: 'custom',
                    categoryId: p.categoryId || null,
                    images: Array.isArray(p.images) && p.images.length > 0 ? p.images : [FALLBACK_IMAGE_URL],
                    variants: [variantEntry],
                    stock: itemStock,
                    totalStock: itemStock
                });
            } else {
                const existing = groupedCustomMap.get(groupKey);
                existing.variants.push(variantEntry);
                existing.totalStock += itemStock;
                existing.stock = existing.totalStock;
                existing.variantSku = `${existing.variants.length} Variants`;
                if (new Date(p.createdAt || 0) > new Date(existing.createdAt || 0)) {
                    existing.createdAt = p.createdAt;
                }
            }
        }

        let combinedProducts = [
            ...Array.from(groupedStandardMap.values()),
            ...Array.from(groupedCustomMap.values())
        ];

        // Stock status filter against total product stock
        if (stockFilter === 'outOfStock') {
            combinedProducts = combinedProducts.filter(p => (p.totalStock ?? p.stock ?? 0) === 0);
        } else if (stockFilter === 'lowStock') {
            combinedProducts = combinedProducts.filter(p => {
                const s = p.totalStock ?? p.stock ?? 0;
                return s > 0 && s <= 5;
            });
        } else if (stockFilter === 'inStock') {
            combinedProducts = combinedProducts.filter(p => (p.totalStock ?? p.stock ?? 0) > 5);
        }

        // Category filter
        if (categoryId) {
            const targetCat = String(categoryId);
            combinedProducts = combinedProducts.filter(p => p.categoryId && String(p.categoryId) === targetCat);
        }

        // Search by product name or any variant SKU
        if (search) {
            const s = search.toLowerCase();
            combinedProducts = combinedProducts.filter(p =>
                (p.productName && p.productName.toLowerCase().includes(s)) ||
                (p.variantSku && p.variantSku.toLowerCase().includes(s)) ||
                (Array.isArray(p.variants) && p.variants.some(v => v.variantSku && v.variantSku.toLowerCase().includes(s)))
            );
        }

        combinedProducts.sort((a, b) => {
            const stockA = a.totalStock ?? a.stock ?? 0;
            const stockB = b.totalStock ?? b.stock ?? 0;
            if (sort === 'stockAsc') return stockA - stockB;
            if (sort === 'stockDesc') return stockB - stockA;
            if (sort === 'nameAsc') return (a.productName || '').localeCompare(b.productName || '');
            if (sort === 'nameDesc') return (b.productName || '').localeCompare(a.productName || '');
            if (sort === 'oldest') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });

        const totalProducts = combinedProducts.length;
        const paginatedProducts = combinedProducts.slice(skip, skip + limitNum);

        let branchInfo = null;
        const targetBranchId = (branchId && ObjectId.isValid(branchId))
            ? new ObjectId(branchId)
            : (paginatedProducts[0]?.branchId && ObjectId.isValid(paginatedProducts[0].branchId)
                ? new ObjectId(paginatedProducts[0].branchId)
                : null);

        if (targetBranchId) {
            const branchDoc = await db.collection('branches').findOne({ _id: targetBranchId });
            if (branchDoc) {
                let managerName = '';
                const managerRef = branchDoc.manager || branchDoc.managerId;

                if (managerRef) {
                    const mgrQueryId = ObjectId.isValid(managerRef) ? new ObjectId(managerRef) : managerRef;
                    const mgr = await db.collection('users').findOne({
                        $or: [{ _id: mgrQueryId }, { _id: String(managerRef) }]
                    });
                    managerName = mgr?.name || mgr?.fullName || '';
                }

                branchInfo = {
                    branchName: branchDoc.name || 'Unknown Branch',
                    managerName: managerName || 'Unassigned'
                };
            }
        }

        return res.status(200).json({
            success: true,
            branchInfo,
            data: paginatedProducts,
            pagination: {
                totalProducts,
                totalPages: Math.ceil(totalProducts / limitNum) || 1,
                currentPage: pageNum,
                limit: limitNum
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getBranchProductById = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID.' });
        }

        const objectId = new ObjectId(id);

        let product = await db.collection('branch_explicit_products').findOne({ _id: objectId });
        if (product) {
            return res.status(200).json({ success: true, data: { ...product, productType: 'custom' } });
        }

        product = await db.collection('branch_inventories').findOne({ _id: objectId });
        if (product) {
            let productName = product.productName;
            let images = product.images || [];
            let description = product.description || '';

            if (product.productId) {
                const mainProd = await db.collection('main_products').findOne({ _id: product.productId });
                if (mainProd) {
                    productName = productName || mainProd.name || mainProd.title || 'Warehouse Product';
                    images = images.length > 0 ? images : (mainProd.images || [FALLBACK_IMAGE_URL]);
                    description = description || mainProd.description || '';
                }
            }

            return res.status(200).json({
                success: true,
                data: {
                    ...product,
                    productType: 'standard',
                    productName,
                    images: images.length > 0 ? images : [FALLBACK_IMAGE_URL],
                    description
                }
            });
        }

        return res.status(404).json({ success: false, message: 'Branch product not found.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteBranchProduct = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { productType } = req.query;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product record ID.' });
        }

        const collectionName = productType === 'custom' ? 'branch_explicit_products' : 'branch_inventories';
        const productRecord = await db.collection(collectionName).findOne({ _id: new ObjectId(id) });

        if (!productRecord) {
            return res.status(404).json({ success: false, message: 'Branch product record not found.' });
        }

        const currentStock = productRecord.stock || productRecord.requestedStock || 0;
        if (currentStock > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete product! Please sell or return all remaining stock before deleting.'
            });
        }

        await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });

        return res.status(200).json({ success: true, message: 'Product successfully deleted from branch.' });
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
    returnBranchStockToMain,
    requestBranchCustomProduct,
    getAllBranchCustomProductRequests,
    getBranchCustomProductRequestById,
    reviewBranchCustomProductRequest,
    getBranchExplicitProducts,
    updateBranchCustomProductRequest,
    deleteBranchCustomProductRequest,
    getAllBranchProducts,
    getBranchProductById,
    deleteBranchProduct
};