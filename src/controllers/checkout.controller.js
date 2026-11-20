const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const FALLBACK_IMAGE_URL = "https://i.ibb.co.com/JwgTBWgB/freshmart-logo.jpg";
const TOP_RECEIPT_ROLES = new Set(['owner', 'superadmin', 'admin']);
const BRANCH_RECEIPT_ROLES = new Set(['manager', 'cashier']);

const extractIdString = (val) => {
    if (!val) return '';
    if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '[object Object]' ? '' : trimmed;
    }
    if (typeof val === 'object') {
        if (val instanceof ObjectId) return val.toString();
        const raw = val._id || val.id || val.branchId || '';
        return raw ? extractIdString(raw) : '';
    }
    return String(val).trim();
};

const toObjectIdOrNull = (val) => {
    const idStr = extractIdString(val);
    return idStr && ObjectId.isValid(idStr) ? new ObjectId(idStr) : null;
};

const normalizeVariantData = (source = {}) => {
    const rawAttributes =
        Array.isArray(source?.variantAttributes) && source.variantAttributes.length > 0
            ? source.variantAttributes
            : Array.isArray(source?.attributes)
                ? source.attributes
                : [];

    const variantAttributes = rawAttributes
        .map((attr) => {
            const variantName = String(attr?.variantName ?? attr?.attributeType ?? '').trim();
            const variantValue = String(attr?.variantValue ?? attr?.attributeValue ?? '').trim();
            if (!variantName && !variantValue) return null;
            return { variantName, variantValue };
        })
        .filter(Boolean);

    const variantLabel =
        String(source?.variantLabel || source?.variantValue || '').trim() ||
        variantAttributes.map((a) => a.variantValue).filter(Boolean).join(' • ');

    return {
        variantAttributes,
        variantLabel
    };
};

const resolveBranchDoc = async (db, branchId) => {
    const branchObjId = toObjectIdOrNull(branchId);
    if (!branchObjId) return null;
    return db.collection('branches').findOne({ _id: branchObjId });
};

const resolveBranchId = async (db, userId, explicitBranchId, userEmail = '') => {
    const explicitObjId = toObjectIdOrNull(explicitBranchId);
    if (explicitObjId) {
        return explicitObjId;
    }

    const userConditions = [];
    const userObjId = toObjectIdOrNull(userId);
    if (userObjId) {
        userConditions.push({ _id: userObjId });
    }
    const cleanEmail = String(userEmail || '').trim();
    if (cleanEmail) {
        userConditions.push({ email: cleanEmail });
    }

    if (userConditions.length > 0) {
        const userDoc = await db.collection('users').findOne({ $or: userConditions });
        const userBranchObjId = toObjectIdOrNull(userDoc?.branchId);
        if (userBranchObjId) {
            return userBranchObjId;
        }
    }

    return null;
};

const resolveUserBranchId = async (db, sessionUser) => {
    const userObjId = toObjectIdOrNull(sessionUser?.id || sessionUser?._id);
    let userDoc = null;
    if (userObjId) {
        userDoc = await db.collection('users').findOne({ _id: userObjId });
    } else if (sessionUser?.email) {
        userDoc = await db.collection('users').findOne({ email: String(sessionUser.email).trim() });
    }
    return toObjectIdOrNull(userDoc?.branchId) || toObjectIdOrNull(sessionUser?.branchId);
};

const buildBranchIdMatchValues = (branchIds = []) => {
    const values = [];
    const seen = new Set();

    for (const id of branchIds) {
        const oid = toObjectIdOrNull(id);
        if (oid) {
            const hex = oid.toHexString();
            if (!seen.has(hex)) {
                seen.add(hex);
                values.push(oid, hex);
            }
        } else {
            const str = extractIdString(id);
            if (str && !seen.has(`raw:${str}`)) {
                seen.add(`raw:${str}`);
                values.push(str);
            }
        }
    }

    return values;
};

const formatManagerInfo = (managerDoc) => {
    if (!managerDoc) return null;
    return {
        _id: managerDoc._id,
        id: managerDoc.id || (managerDoc._id ? String(managerDoc._id) : ''),
        name: managerDoc.name || '',
        email: managerDoc.email || '',
        image: managerDoc.image || '',
        role: managerDoc.role || 'manager',
        branchId: managerDoc.branchId ?? null,
    };
};

const fetchBranchManagersMap = async (db, branchIds = []) => {
    const matchValues = buildBranchIdMatchValues(branchIds);
    const managerMap = new Map();

    if (matchValues.length === 0) return managerMap;

    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const existing = new Set(collections.map((c) => c.name));
    const userColName = existing.has('users') ? 'users' : existing.has('user') ? 'user' : 'users';

    const managers = await db
        .collection(userColName)
        .find({
            role: { $regex: /^manager$/i },
            $or: [
                { branchId: { $in: matchValues } },
                { branch: { $in: matchValues } },
            ],
        })
        .project({
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            branchId: 1,
            branch: 1,
        })
        .toArray();

    for (const mgr of managers) {
        const rawBranch = mgr.branchId ?? mgr.branch;
        const oid = toObjectIdOrNull(rawBranch);
        const key = oid ? oid.toHexString() : extractIdString(rawBranch);
        if (key && !managerMap.has(key)) {
            managerMap.set(key, formatManagerInfo(mgr));
        }
    }

    return managerMap;
};

const searchBranchProductsBySku = async (req, res) => {
    try {
        const db = getDB();
        const { sku = '', branchId = '', cashierId = '', cashierEmail = '' } = req.query;
        const cleanSku = String(sku).trim().toLowerCase();

        const resolvedBranchId = await resolveBranchId(db, cashierId, branchId, cashierEmail);
        const branchQuery = resolvedBranchId ? { branchId: resolvedBranchId } : {};

        const standardItems = await db.collection('branch_inventories').find(branchQuery).toArray();
        const results = [];

        for (const item of standardItems) {
            const skuMatch = !cleanSku || String(item.variantSku || '').toLowerCase().includes(cleanSku);
            if (!skuMatch) continue;

            const productObjId = toObjectIdOrNull(item.productId);
            const mainProd = productObjId
                ? await db.collection('main_products').findOne({ _id: productObjId })
                : null;

            const variantDoc = productObjId
                ? await db.collection('product_variants').findOne({
                    productId: productObjId,
                    variantSku: item.variantSku
                })
                : await db.collection('product_variants').findOne({
                    variantSku: item.variantSku
                });

            const { variantAttributes, variantLabel } = normalizeVariantData(variantDoc || item);

            const productName =
                item.productName ||
                mainProd?.name ||
                mainProd?.title ||
                'Warehouse Product';

            const images =
                Array.isArray(item.images) && item.images.length > 0
                    ? item.images
                    : Array.isArray(mainProd?.images) && mainProd.images.length > 0
                        ? mainProd.images
                        : [FALLBACK_IMAGE_URL];

            const pricePerPiece = Number(
                item.pricePerPiece ??
                variantDoc?.pricePerPiece ??
                mainProd?.pieceValue ??
                0
            );

            results.push({
                _id: item._id,
                branchId: toObjectIdOrNull(item.branchId) || item.branchId,
                branchName: item.branchName || '',
                productId: productObjId || item.productId || null,
                productType: 'standard',
                productName,
                variantSku: item.variantSku,
                variantAttributes,
                variantLabel,
                stock: Number(item.stock ?? 0),
                pricePerPiece,
                images,
                description: item.description || mainProd?.description || '',
                categoryId: toObjectIdOrNull(mainProd?.categoryId || item.categoryId)
            });
        }

        const customItems = await db.collection('branch_explicit_products').find(branchQuery).toArray();
        for (const p of customItems) {
            const skuMatch = !cleanSku || String(p.variantSku || '').toLowerCase().includes(cleanSku);
            if (!skuMatch) continue;

            const { variantAttributes, variantLabel } = normalizeVariantData(p);

            results.push({
                _id: p._id,
                branchId: toObjectIdOrNull(p.branchId) || p.branchId,
                branchName: p.branchName || '',
                productId: p._id,
                productType: 'custom',
                productName: p.productName || 'Custom Product',
                variantSku: p.variantSku,
                variantAttributes,
                variantLabel,
                stock: Number(p.stock ?? 0),
                pricePerPiece: Number(p.pricePerPiece ?? 0),
                images: Array.isArray(p.images) && p.images.length > 0 ? p.images : [FALLBACK_IMAGE_URL],
                description: p.description || '',
                categoryId: toObjectIdOrNull(p.categoryId)
            });
        }

        return res.status(200).json({
            success: true,
            data: results
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const createCheckout = async (req, res) => {
    try {
        const db = getDB();
        const sessionUser = req.sessionUser;

        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        if (sessionUser.role !== 'cashier') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only cashiers can create checkouts.'
            });
        }

        const {
            customer,
            items,
            discountPercentage = 0,
            vatPercentage = 0,
            paymentMethod = 'Cash',
            note = ''
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Checkout items cannot be empty.' });
        }

        const sessionUserObjId = toObjectIdOrNull(sessionUser.id || sessionUser._id);
        let cashierDoc = null;
        if (sessionUserObjId) {
            cashierDoc = await db.collection('users').findOne({ _id: sessionUserObjId });
        } else if (sessionUser.email) {
            cashierDoc = await db.collection('users').findOne({ email: String(sessionUser.email).trim() });
        }

        if (!cashierDoc || cashierDoc.role !== 'cashier' || String(cashierDoc.status || '').toLowerCase() !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Active cashier account is required to perform checkout.'
            });
        }

        const resolvedBranchId =
            toObjectIdOrNull(cashierDoc.branchId) ||
            toObjectIdOrNull(sessionUser.branchId);

        if (!resolvedBranchId) {
            return res.status(403).json({
                success: false,
                message: 'Cashier is not assigned to any branch.'
            });
        }

        const branchDoc = await resolveBranchDoc(db, resolvedBranchId);
        const resolvedBranchName = branchDoc?.name || '';

        const processedItems = [];
        const stockOperations = [];

        for (const rawItem of items) {
            const quantity = Number(rawItem.quantity || 0);
            const variantSku = String(rawItem.variantSku || '').trim();
            const productType = rawItem.productType === 'custom' ? 'custom' : 'standard';

            if (!variantSku || quantity <= 0 || !Number.isInteger(quantity)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid variant SKU or quantity for item: ${variantSku || 'unknown'}.`
                });
            }

            if (productType === 'custom') {
                const recordObjId = toObjectIdOrNull(rawItem._id);
                const customQuery = recordObjId
                    ? { branchId: resolvedBranchId, _id: recordObjId }
                    : { branchId: resolvedBranchId, variantSku };

                const customDoc = await db.collection('branch_explicit_products').findOne(customQuery);
                const availableStock = Number(customDoc?.stock ?? 0);

                if (!customDoc || availableStock < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient stock in branch for SKU: ${variantSku}`
                    });
                }

                const { variantAttributes, variantLabel } = normalizeVariantData(customDoc);
                const unitPrice = Number(customDoc.pricePerPiece ?? rawItem.pricePerPiece ?? 0);
                const lineTotal = Number((unitPrice * quantity).toFixed(2));

                processedItems.push({
                    recordId: customDoc._id,
                    productId: customDoc._id,
                    productType: 'custom',
                    productName: customDoc.productName || rawItem.productName || 'Custom Product',
                    variantSku: customDoc.variantSku,
                    variantAttributes,
                    variantLabel,
                    image: (Array.isArray(customDoc.images) && customDoc.images[0]) || rawItem.image || FALLBACK_IMAGE_URL,
                    unitPrice,
                    quantity,
                    lineTotal
                });

                stockOperations.push({
                    collection: 'branch_explicit_products',
                    filter: { _id: customDoc._id },
                    newStock: Math.max(0, availableStock - quantity)
                });
            } else {
                const recordObjId = toObjectIdOrNull(rawItem._id);
                const invQuery = recordObjId
                    ? { branchId: resolvedBranchId, _id: recordObjId }
                    : { branchId: resolvedBranchId, variantSku };

                const invDoc = await db.collection('branch_inventories').findOne(invQuery);
                const availableStock = Number(invDoc?.stock ?? 0);

                if (!invDoc || availableStock < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient stock in branch for SKU: ${variantSku}`
                    });
                }

                const productObjId = toObjectIdOrNull(invDoc.productId);
                const mainProd = productObjId
                    ? await db.collection('main_products').findOne({ _id: productObjId })
                    : null;
                const variantDoc = productObjId
                    ? await db.collection('product_variants').findOne({
                        productId: productObjId,
                        variantSku: invDoc.variantSku
                    })
                    : await db.collection('product_variants').findOne({
                        variantSku: invDoc.variantSku
                    });

                const { variantAttributes, variantLabel } = normalizeVariantData(variantDoc || invDoc);

                const productName =
                    invDoc.productName ||
                    mainProd?.name ||
                    mainProd?.title ||
                    rawItem.productName ||
                    'Warehouse Product';

                const image =
                    (Array.isArray(invDoc.images) && invDoc.images[0]) ||
                    (Array.isArray(mainProd?.images) && mainProd.images[0]) ||
                    rawItem.image ||
                    FALLBACK_IMAGE_URL;

                const unitPrice = Number(
                    invDoc.pricePerPiece ??
                    variantDoc?.pricePerPiece ??
                    mainProd?.pieceValue ??
                    rawItem.pricePerPiece ??
                    0
                );

                const lineTotal = Number((unitPrice * quantity).toFixed(2));

                processedItems.push({
                    recordId: invDoc._id,
                    productId: productObjId || null,
                    productType: 'standard',
                    productName,
                    variantSku: invDoc.variantSku,
                    variantAttributes,
                    variantLabel,
                    image,
                    unitPrice,
                    quantity,
                    lineTotal
                });

                stockOperations.push({
                    collection: 'branch_inventories',
                    filter: { _id: invDoc._id },
                    newStock: Math.max(0, availableStock - quantity)
                });
            }
        }

        for (const op of stockOperations) {
            await db.collection(op.collection).updateOne(
                op.filter,
                {
                    $set: {
                        stock: op.newStock,
                        isStockDepleted: op.newStock === 0,
                        updatedAt: new Date()
                    }
                }
            );
        }

        const parsedDiscountPct = Math.max(0, Number(discountPercentage) || 0);
        const parsedVatPct = Math.max(0, Number(vatPercentage) || 0);

        const subtotal = Number(
            processedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)
        );
        const discountAmount = Number(((subtotal * parsedDiscountPct) / 100).toFixed(2));
        const taxableAmount = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
        const vatAmount = Number(((taxableAmount * parsedVatPct) / 100).toFixed(2));
        const totalBill = Number((taxableAmount + vatAmount).toFixed(2));

        const now = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
        const randomPart = Math.floor(1000 + Math.random() * 9000);
        const receiptNumber = `RCP-${datePart}-${randomPart}`;

        const receiptDoc = {
            receiptNumber,
            branchId: resolvedBranchId,
            branchName: resolvedBranchName,
            branchAddress: branchDoc?.address || '',
            branchCity: branchDoc?.city || '',
            branchPhones: Array.isArray(branchDoc?.phones) ? branchDoc.phones : [],
            cashierId: cashierDoc._id,
            cashierEmployeeId: cashierDoc.employeeId || '',
            cashierName: cashierDoc.name || sessionUser.name || 'Cashier',
            cashierEmail: cashierDoc.email || sessionUser.email || '',
            customer: {
                name: String(customer?.name || '').trim(),
                phone: String(customer?.phone || '').trim(),
                email: String(customer?.email || '').trim(),
                address: String(customer?.address || '').trim()
            },
            items: processedItems,
            subtotal,
            discountPercentage: parsedDiscountPct,
            discountAmount,
            vatPercentage: parsedVatPct,
            vatAmount,
            totalBill,
            paymentMethod: paymentMethod || 'Cash',
            note: String(note || '').trim(),
            createdAt: now,
            updatedAt: now
        };

        const insertResult = await db.collection('pos_receipts').insertOne(receiptDoc);

        return res.status(201).json({
            success: true,
            message: 'Money receipt generated successfully.',
            data: {
                _id: insertResult.insertedId,
                receiptId: insertResult.insertedId,
                ...receiptDoc
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getReceiptById = async (req, res) => {
    try {
        const db = getDB();
        const sessionUser = req.sessionUser;
        const role = String(sessionUser?.role || '').toLowerCase();

        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        if (!TOP_RECEIPT_ROLES.has(role) && !BRANCH_RECEIPT_ROLES.has(role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You do not have permission to view receipts.'
            });
        }

        const { receiptId } = req.params;

        const conditions = [{ receiptNumber: receiptId }];
        const receiptObjId = toObjectIdOrNull(receiptId);
        if (receiptObjId) {
            conditions.push({ _id: receiptObjId });
        }

        const receipt = await db.collection('pos_receipts').findOne({ $or: conditions });
        if (!receipt) {
            return res.status(404).json({ success: false, message: 'Money receipt not found.' });
        }

        if (BRANCH_RECEIPT_ROLES.has(role)) {
            const ownBranchId = await resolveUserBranchId(db, sessionUser);
            if (!ownBranchId || String(receipt.branchId) !== String(ownBranchId)) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You can only view receipts from your own branch.'
                });
            }
        }

        return res.status(200).json({ success: true, data: receipt });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllReceipts = async (req, res) => {
    try {
        const sessionUser = req.sessionUser;
        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const role = String(sessionUser?.role || '').toLowerCase();
        const isTopRole = TOP_RECEIPT_ROLES.has(role);
        const isBranchRole = BRANCH_RECEIPT_ROLES.has(role);

        if (!isTopRole && !isBranchRole) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You do not have permission to view receipts.'
            });
        }

        const db = getDB();
        let query = {};
        let targetBranchIds = [];

        if (isTopRole) {
            const requestedBranchId = toObjectIdOrNull(req.query?.branchId);
            if (requestedBranchId) {
                query = { branchId: requestedBranchId };
                targetBranchIds = [requestedBranchId];
            }
        } else {
            const ownBranchId = await resolveUserBranchId(db, sessionUser);
            if (!ownBranchId) {
                return res.status(403).json({
                    success: false,
                    message: 'User is not assigned to any branch.'
                });
            }
            query = { branchId: ownBranchId };
            targetBranchIds = [ownBranchId];
        }

        const receipts = await db.collection('pos_receipts').find(query).sort({ createdAt: -1 }).toArray();

        if (isTopRole && targetBranchIds.length === 0) {
            targetBranchIds = receipts.map((r) => r.branchId).filter(Boolean);
        }

        const managerMap = await fetchBranchManagersMap(db, targetBranchIds);

        const enrichedReceipts = receipts.map((receipt) => {
            const oid = toObjectIdOrNull(receipt.branchId);
            const key = oid ? oid.toHexString() : extractIdString(receipt.branchId);
            return {
                ...receipt,
                branchManager: key ? (managerMap.get(key) || null) : null
            };
        });

        return res.status(200).json({
            success: true,
            data: enrichedReceipts,
            branchManagersByBranchId: Object.fromEntries(managerMap.entries())
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    searchBranchProductsBySku,
    createCheckout,
    getReceiptById,
    getAllReceipts
};