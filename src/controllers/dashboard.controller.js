const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const TOP_DASHBOARD_ROLES = new Set(['owner', 'superadmin', 'admin']);

const toIdString = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val.trim();
    if (val instanceof ObjectId) return val.toHexString();
    if (typeof val === 'object') {
        const raw = val._id || val.id || val.branchId || '';
        return raw ? toIdString(raw) : '';
    }
    return String(val).trim();
};

const toObjectIdOrNull = (val) => {
    const str = toIdString(val);
    return str && ObjectId.isValid(str) ? new ObjectId(str) : null;
};

const buildIdMatchValues = (idVal) => {
    const oid = toObjectIdOrNull(idVal);
    const str = toIdString(idVal);
    const values = [];
    if (oid) values.push(oid, oid.toHexString());
    if (str && !values.includes(str)) values.push(str);
    return values;
};

const roundMoney = (num) => Number((Number(num) || 0).toFixed(2));

const getStartOfToday = (now = new Date()) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

const getStartOfMonth = (now = new Date()) =>
    new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

const getStartOfDaysAgo = (days, now = new Date()) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
};

const formatDateKey = (dateVal) => {
    const d = new Date(dateVal);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const resolveSessionUserBranchId = async (db, sessionUser) => {
    const userObjId = toObjectIdOrNull(sessionUser?.id || sessionUser?._id);
    let userDoc = null;

    if (userObjId) {
        userDoc = await db.collection('users').findOne({ _id: userObjId });
    } else if (sessionUser?.email) {
        userDoc = await db.collection('users').findOne({ email: String(sessionUser.email).trim() });
    }

    return toObjectIdOrNull(userDoc?.branchId) || toObjectIdOrNull(sessionUser?.branchId);
};

const getTopDashboardStats = async (req, res) => {
    try {
        const sessionUser = req.sessionUser;
        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const role = String(sessionUser.role || '').toLowerCase();
        if (!TOP_DASHBOARD_ROLES.has(role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only owner, superadmin, and admin can access executive dashboard stats.'
            });
        }

        const db = getDB();
        const now = new Date();
        const startOfToday = getStartOfToday(now);
        const startOfMonth = getStartOfMonth(now);
        const startOf7Days = getStartOfDaysAgo(7, now);

        const [
            branches,
            monthReceipts,
            mainProducts,
            customProducts,
            standardDemands,
            customDemands
        ] = await Promise.all([
            db.collection('branches').find({}).toArray(),
            db.collection('pos_receipts')
                .find({ createdAt: { $gte: startOfMonth } })
                .sort({ createdAt: -1 })
                .toArray(),
            db.collection('main_products').find({}).toArray(),
            db.collection('branch_explicit_products').find({}).toArray(),
            db.collection('branch_stock_demands')
                .find({})
                .sort({ createdAt: -1 })
                .limit(15)
                .toArray(),
            db.collection('branch_custom_product_requests')
                .find({})
                .sort({ createdAt: -1 })
                .limit(15)
                .toArray()
        ]);

        const branchNameById = new Map();
        for (const b of branches) {
            const idStr = toIdString(b._id);
            if (idStr) {
                branchNameById.set(idStr, b.name || b.branchName || 'Branch');
            }
        }

        const mainProductById = new Map();
        const mainProductBySku = new Map();
        for (const p of mainProducts) {
            const idStr = toIdString(p._id);
            if (idStr) mainProductById.set(idStr, p);
            if (p.sku) mainProductBySku.set(String(p.sku).trim().toLowerCase(), p);
        }

        const customCostById = new Map();
        const customCostByBranchSku = new Map();
        for (const cp of customProducts) {
            const idStr = toIdString(cp._id);
            const cost = Number(cp.costPrice || 0);
            if (idStr) customCostById.set(idStr, cost);
            const bStr = toIdString(cp.branchId);
            const skuStr = String(cp.variantSku || '').trim().toLowerCase();
            if (bStr && skuStr) {
                customCostByBranchSku.set(`${bStr}::${skuStr}`, cost);
            }
        }

        const resolveItemCostPrice = (item, branchIdStr) => {
            if (item?.productType === 'custom') {
                const byId = customCostById.get(toIdString(item?.productId || item?.recordId));
                if (typeof byId === 'number' && byId > 0) return byId;
                const skuKey = `${branchIdStr}::${String(item?.variantSku || '').trim().toLowerCase()}`;
                return Number(customCostByBranchSku.get(skuKey) || 0);
            }

            const prodById = mainProductById.get(toIdString(item?.productId));
            if (prodById) return Number(prodById.costPrice || 0);

            const skuStr = String(item?.variantSku || '').trim().toLowerCase();
            if (skuStr) {
                for (const [sku, prod] of mainProductBySku.entries()) {
                    if (skuStr.startsWith(sku)) return Number(prod.costPrice || 0);
                }
            }
            return 0;
        };

        let dailySell = 0;
        let dailyReceiptsCount = 0;
        let monthlySell = 0;
        let monthlyReceiptsCount = monthReceipts.length;
        let monthlyCostTotal = 0;
        let monthlyProfit = 0;
        let dailyCostTotal = 0;
        let dailyProfit = 0;

        const branchRevenueMap = new Map();
        for (const b of branches) {
            const bId = toIdString(b._id);
            if (bId) {
                branchRevenueMap.set(bId, {
                    branchId: bId,
                    branchName: b.name || b.branchName || 'Branch',
                    regularRevenue: 0,
                    weeklyRevenue: 0,
                    monthlyRevenue: 0,
                    receiptCount: 0
                });
            }
        }

        const dailyTrendMap = new Map();
        const productEffectivenessMap = new Map();

        for (const receipt of monthReceipts) {
            const createdAt = new Date(receipt.createdAt);
            const isToday = !Number.isNaN(createdAt.getTime()) && createdAt >= startOfToday;
            const isWeekly = !Number.isNaN(createdAt.getTime()) && createdAt >= startOf7Days;
            const dayKey = formatDateKey(createdAt);

            const billAmount = Number(receipt.totalBill ?? receipt.subtotal ?? 0);
            monthlySell += billAmount;

            if (isToday) {
                dailySell += billAmount;
                dailyReceiptsCount += 1;
            }

            const bId = toIdString(receipt.branchId) || 'unassigned';
            const bName = receipt.branchName || branchNameById.get(bId) || 'Branch';

            if (!branchRevenueMap.has(bId)) {
                branchRevenueMap.set(bId, {
                    branchId: bId,
                    branchName: bName,
                    regularRevenue: 0,
                    weeklyRevenue: 0,
                    monthlyRevenue: 0,
                    receiptCount: 0
                });
            }

            const bEntry = branchRevenueMap.get(bId);
            bEntry.monthlyRevenue += billAmount;
            bEntry.receiptCount += 1;
            if (isWeekly) bEntry.weeklyRevenue += billAmount;
            if (isToday) bEntry.regularRevenue += billAmount;

            if (dayKey) {
                if (!dailyTrendMap.has(dayKey)) {
                    dailyTrendMap.set(dayKey, {
                        date: dayKey,
                        sell: 0,
                        cost: 0,
                        profit: 0,
                        receipts: 0
                    });
                }
                const dayEntry = dailyTrendMap.get(dayKey);
                dayEntry.sell += billAmount;
                dayEntry.receipts += 1;
            }

            const items = Array.isArray(receipt.items) ? receipt.items : [];
            const seenProductsInReceipt = new Set();

            for (const item of items) {
                const qty = Number(item?.quantity || 0);
                const unitPrice = Number(item?.unitPrice ?? item?.pricePerPiece ?? 0);
                const itemSell = Number(item?.lineTotal ?? unitPrice * qty);
                const unitCost = resolveItemCostPrice(item, bId);
                const itemCost = unitCost * qty;
                const itemProfit = itemSell - itemCost;

                monthlyCostTotal += itemCost;
                monthlyProfit += itemProfit;

                if (isToday) {
                    dailyCostTotal += itemCost;
                    dailyProfit += itemProfit;
                }

                if (dayKey && dailyTrendMap.has(dayKey)) {
                    const dayEntry = dailyTrendMap.get(dayKey);
                    dayEntry.cost += itemCost;
                    dayEntry.profit += itemProfit;
                }

                const prodKey = toIdString(item?.productId) || String(item?.variantSku || item?.productName || '').trim();
                const prodName = item?.productName || 'Unknown Product';
                const prodSku = item?.variantSku || mainProductById.get(toIdString(item?.productId))?.sku || '';

                if (prodKey) {
                    if (!productEffectivenessMap.has(prodKey)) {
                        productEffectivenessMap.set(prodKey, {
                            productId: prodKey,
                            productName: prodName,
                            productType: item?.productType || 'standard',
                            sku: prodSku,
                            quantitySold: 0,
                            revenue: 0,
                            costTotal: 0,
                            profit: 0,
                            receiptsCount: 0
                        });
                    }

                    const pEntry = productEffectivenessMap.get(prodKey);
                    pEntry.quantitySold += qty;
                    pEntry.revenue += itemSell;
                    pEntry.costTotal += itemCost;
                    pEntry.profit += itemProfit;
                    if (!seenProductsInReceipt.has(prodKey)) {
                        pEntry.receiptsCount += 1;
                        seenProductsInReceipt.add(prodKey);
                    }
                }
            }
        }

        const effectiveProducts = Array.from(productEffectivenessMap.values())
            .map((p) => ({
                ...p,
                revenue: roundMoney(p.revenue),
                costTotal: roundMoney(p.costTotal),
                profit: roundMoney(p.profit)
            }))
            .sort((a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold);

        const mainProductLowStock = mainProducts
            .map((prod) => {
                const threshold = Number(prod.lowStockThreshold ?? 5);
                const stock = Number(prod.totalStock ?? 0);
                return {
                    _id: prod._id,
                    name: prod.name || prod.title || 'Unnamed Product',
                    sku: prod.sku || '',
                    totalStock: stock,
                    lowStockThreshold: threshold,
                    isStockDepleted: stock === 0 || Boolean(prod.isStockDepleted),
                    pieceValue: roundMoney(prod.pieceValue || 0),
                    costPrice: roundMoney(prod.costPrice || 0),
                    images: Array.isArray(prod.images) ? prod.images : []
                };
            })
            .filter((prod) => prod.totalStock <= prod.lowStockThreshold)
            .sort((a, b) => a.totalStock - b.totalStock);

        const normalizedStandardRequests = standardDemands.map((d) => {
            const bId = toIdString(d.branchId);
            const totalQty = (Array.isArray(d.requestedVariants) ? d.requestedVariants : [])
                .reduce((sum, v) => sum + Number(v.quantity || 0), 0);

            return {
                _id: d._id,
                requestType: 'standard',
                requestLabel: 'Stock Demand',
                branchId: d.branchId,
                branchName: d.branchName || branchNameById.get(bId) || 'Branch',
                productId: d.productId,
                productName: d.productName || 'Main Warehouse Product',
                managerId: d.managerId,
                managerName: d.requestedBy || d.managerName || 'Manager',
                managerEmail: d.managerEmail || '',
                totalQuantity: totalQty,
                variantsCount: Array.isArray(d.requestedVariants) ? d.requestedVariants.length : 0,
                status: d.status || 'Pending',
                managerNote: d.managerNote || '',
                createdAt: d.createdAt
            };
        });

        const normalizedCustomRequests = customDemands.map((d) => {
            const bId = toIdString(d.branchId);
            const totalQty = (Array.isArray(d.variants) ? d.variants : [])
                .reduce((sum, v) => sum + Number(v.requestedStock ?? v.quantity ?? 0), 0);

            return {
                _id: d._id,
                requestType: 'custom',
                requestLabel: 'Custom Product',
                branchId: d.branchId,
                branchName: d.branchName || branchNameById.get(bId) || 'Branch',
                productId: d._id,
                productName: d.productName || 'Custom Product',
                managerId: d.managerId,
                managerName: d.managerName || 'Manager',
                managerEmail: d.managerEmail || '',
                totalQuantity: totalQty,
                variantsCount: Array.isArray(d.variants) ? d.variants.length : 0,
                status: d.status || 'Pending',
                managerNote: d.managerNote || '',
                createdAt: d.createdAt
            };
        });

        const recentManagerRequests = [...normalizedStandardRequests, ...normalizedCustomRequests]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 10);

        const branchRevenue = Array.from(branchRevenueMap.values())
            .map((b) => ({
                ...b,
                regularRevenue: roundMoney(b.regularRevenue),
                weeklyRevenue: roundMoney(b.weeklyRevenue),
                monthlyRevenue: roundMoney(b.monthlyRevenue)
            }))
            .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);

        const dailySeries = Array.from(dailyTrendMap.values())
            .map((d) => ({
                ...d,
                sell: roundMoney(d.sell),
                cost: roundMoney(d.cost),
                profit: roundMoney(d.profit)
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return res.status(200).json({
            success: true,
            data: {
                role,
                period: {
                    todayDate: formatDateKey(startOfToday),
                    monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                },
                sales: {
                    dailySell: roundMoney(dailySell),
                    dailyReceiptsCount,
                    monthlySell: roundMoney(monthlySell),
                    monthlyReceiptsCount
                },
                profit: {
                    monthlySellTotal: roundMoney(monthlySell),
                    monthlyCostTotal: roundMoney(monthlyCostTotal),
                    monthlyProfit: roundMoney(monthlyProfit),
                    dailySellTotal: roundMoney(dailySell),
                    dailyCostTotal: roundMoney(dailyCostTotal),
                    dailyProfit: roundMoney(dailyProfit)
                },
                branchRevenue,
                dailySeries,
                effectiveProducts: effectiveProducts.slice(0, 10),
                mainProductLowStock,
                recentManagerRequests
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const buildBranchAnalyticsPayload = async ({ db, branchId, now, scopeLabel }) => {
    const branchIdStr = toIdString(branchId);
    const branchMatchValues = buildIdMatchValues(branchId);
    const startOfToday = getStartOfToday(now);
    const startOfMonth = getStartOfMonth(now);
    const startOf7Days = getStartOfDaysAgo(7, now);

    const branchQuery = { branchId: { $in: branchMatchValues } };

    const [
        branchDoc,
        monthReceipts,
        branchInventories,
        branchCustomProducts,
        mainProducts,
        standardDemands,
        customDemands
    ] = await Promise.all([
        db.collection('branches').findOne({ _id: branchId }),
        db.collection('pos_receipts')
            .find({ ...branchQuery, createdAt: { $gte: startOfMonth } })
            .sort({ createdAt: -1 })
            .toArray(),
        db.collection('branch_inventories').find(branchQuery).toArray(),
        db.collection('branch_explicit_products').find(branchQuery).toArray(),
        db.collection('main_products').find({}).toArray(),
        db.collection('branch_stock_demands')
            .find(branchQuery)
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray(),
        db.collection('branch_custom_product_requests')
            .find(branchQuery)
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray()
    ]);

    const branchName = branchDoc?.name || branchDoc?.branchName || 'Assigned Branch';

    const mainProductById = new Map();
    const mainProductBySku = new Map();
    for (const p of mainProducts) {
        const idStr = toIdString(p._id);
        if (idStr) mainProductById.set(idStr, p);
        if (p.sku) mainProductBySku.set(String(p.sku).trim().toLowerCase(), p);
    }

    const customCostById = new Map();
    const customCostBySku = new Map();
    for (const cp of branchCustomProducts) {
        const idStr = toIdString(cp._id);
        const cost = Number(cp.costPrice || 0);
        if (idStr) customCostById.set(idStr, cost);
        const skuStr = String(cp.variantSku || '').trim().toLowerCase();
        if (skuStr) customCostBySku.set(skuStr, cost);
    }

    const resolveItemCostPrice = (item) => {
        if (item?.productType === 'custom') {
            const byId = customCostById.get(toIdString(item?.productId || item?.recordId));
            if (typeof byId === 'number' && byId > 0) return byId;
            const skuStr = String(item?.variantSku || '').trim().toLowerCase();
            return Number(customCostBySku.get(skuStr) || 0);
        }

        const prodById = mainProductById.get(toIdString(item?.productId));
        if (prodById) return Number(prodById.costPrice || 0);

        const skuStr = String(item?.variantSku || '').trim().toLowerCase();
        if (skuStr) {
            for (const [sku, prod] of mainProductBySku.entries()) {
                if (skuStr.startsWith(sku)) return Number(prod.costPrice || 0);
            }
        }
        return 0;
    };

    let dailySell = 0;
    let dailyReceiptsCount = 0;
    let weeklySell = 0;
    let weeklyReceiptsCount = 0;
    let monthlySell = 0;
    let monthlyReceiptsCount = monthReceipts.length;
    let monthlyCostTotal = 0;
    let monthlyProfit = 0;
    let dailyCostTotal = 0;
    let dailyProfit = 0;

    const dailyTrendMap = new Map();
    const productEffectivenessMap = new Map();
    const cashierPerfMap = new Map();

    for (const receipt of monthReceipts) {
        const createdAt = new Date(receipt.createdAt);
        const isToday = !Number.isNaN(createdAt.getTime()) && createdAt >= startOfToday;
        const isWeekly = !Number.isNaN(createdAt.getTime()) && createdAt >= startOf7Days;
        const dayKey = formatDateKey(createdAt);

        const billAmount = Number(receipt.totalBill ?? receipt.subtotal ?? 0);
        monthlySell += billAmount;

        if (isWeekly) {
            weeklySell += billAmount;
            weeklyReceiptsCount += 1;
        }

        if (isToday) {
            dailySell += billAmount;
            dailyReceiptsCount += 1;
        }

        if (dayKey) {
            if (!dailyTrendMap.has(dayKey)) {
                dailyTrendMap.set(dayKey, {
                    date: dayKey,
                    sell: 0,
                    cost: 0,
                    profit: 0,
                    receipts: 0
                });
            }
            const dayEntry = dailyTrendMap.get(dayKey);
            dayEntry.sell += billAmount;
            dayEntry.receipts += 1;
        }

        const cashierKey =
            toIdString(receipt.cashierId) ||
            String(receipt.cashierEmail || receipt.cashierName || 'unknown').trim().toLowerCase();
        const cashierName = receipt.cashierName || receipt.cashierEmail || 'Cashier';

        if (!cashierPerfMap.has(cashierKey)) {
            cashierPerfMap.set(cashierKey, {
                cashierId: cashierKey,
                cashierName,
                cashierEmail: receipt.cashierEmail || '',
                employeeId: receipt.cashierEmployeeId || '',
                revenue: 0,
                dailyRevenue: 0,
                weeklyRevenue: 0,
                unitsSold: 0,
                receiptsCount: 0,
                profit: 0
            });
        }

        const cEntry = cashierPerfMap.get(cashierKey);
        cEntry.revenue += billAmount;
        cEntry.receiptsCount += 1;
        if (isWeekly) cEntry.weeklyRevenue += billAmount;
        if (isToday) cEntry.dailyRevenue += billAmount;

        const items = Array.isArray(receipt.items) ? receipt.items : [];
        const seenProductsInReceipt = new Set();

        for (const item of items) {
            const qty = Number(item?.quantity || 0);
            const unitPrice = Number(item?.unitPrice ?? item?.pricePerPiece ?? 0);
            const itemSell = Number(item?.lineTotal ?? unitPrice * qty);
            const unitCost = resolveItemCostPrice(item);
            const itemCost = unitCost * qty;
            const itemProfit = itemSell - itemCost;

            monthlyCostTotal += itemCost;
            monthlyProfit += itemProfit;
            cEntry.unitsSold += qty;
            cEntry.profit += itemProfit;

            if (isToday) {
                dailyCostTotal += itemCost;
                dailyProfit += itemProfit;
            }

            if (dayKey && dailyTrendMap.has(dayKey)) {
                const dayEntry = dailyTrendMap.get(dayKey);
                dayEntry.cost += itemCost;
                dayEntry.profit += itemProfit;
            }

            const prodKey = toIdString(item?.productId) || String(item?.variantSku || item?.productName || '').trim();
            const prodName = item?.productName || 'Unknown Product';
            const prodSku = item?.variantSku || mainProductById.get(toIdString(item?.productId))?.sku || '';

            if (prodKey) {
                if (!productEffectivenessMap.has(prodKey)) {
                    productEffectivenessMap.set(prodKey, {
                        productId: prodKey,
                        productName: prodName,
                        productType: item?.productType || 'standard',
                        sku: prodSku,
                        quantitySold: 0,
                        revenue: 0,
                        costTotal: 0,
                        profit: 0,
                        receiptsCount: 0
                    });
                }

                const pEntry = productEffectivenessMap.get(prodKey);
                pEntry.quantitySold += qty;
                pEntry.revenue += itemSell;
                pEntry.costTotal += itemCost;
                pEntry.profit += itemProfit;
                if (!seenProductsInReceipt.has(prodKey)) {
                    pEntry.receiptsCount += 1;
                    seenProductsInReceipt.add(prodKey);
                }
            }
        }
    }

    const cashierPerformance = Array.from(cashierPerfMap.values())
        .map((c) => ({
            ...c,
            revenue: roundMoney(c.revenue),
            dailyRevenue: roundMoney(c.dailyRevenue),
            weeklyRevenue: roundMoney(c.weeklyRevenue),
            profit: roundMoney(c.profit)
        }))
        .sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold);

    const effectiveProducts = Array.from(productEffectivenessMap.values())
        .map((p) => ({
            ...p,
            revenue: roundMoney(p.revenue),
            costTotal: roundMoney(p.costTotal),
            profit: roundMoney(p.profit)
        }))
        .sort((a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold);

    const branchLowStock = [];

    for (const inv of branchInventories) {
        const stock = Number(inv.stock ?? 0);
        const mainProd = mainProductById.get(toIdString(inv.productId));
        const threshold = Number(inv.lowStockThreshold ?? mainProd?.lowStockThreshold ?? 5);
        if (stock <= threshold) {
            branchLowStock.push({
                _id: inv._id,
                productType: 'standard',
                productId: inv.productId,
                name: inv.productName || mainProd?.name || mainProd?.title || 'Warehouse Product',
                sku: inv.variantSku || mainProd?.sku || '',
                stock,
                lowStockThreshold: threshold,
                isStockDepleted: stock === 0,
                pricePerPiece: roundMoney(inv.pricePerPiece ?? mainProd?.pieceValue ?? 0),
                images: Array.isArray(inv.images) && inv.images.length > 0 ? inv.images : (mainProd?.images || [])
            });
        }
    }

    for (const cp of branchCustomProducts) {
        const stock = Number(cp.stock ?? 0);
        const threshold = Number(cp.lowStockThreshold ?? 5);
        if (stock <= threshold) {
            branchLowStock.push({
                _id: cp._id,
                productType: 'custom',
                productId: cp._id,
                name: cp.productName || 'Custom Product',
                sku: cp.variantSku || '',
                stock,
                lowStockThreshold: threshold,
                isStockDepleted: stock === 0,
                pricePerPiece: roundMoney(cp.pricePerPiece || 0),
                images: Array.isArray(cp.images) ? cp.images : []
            });
        }
    }

    branchLowStock.sort((a, b) => a.stock - b.stock);

    const normalizedStandardRequests = standardDemands.map((d) => {
        const totalQty = (Array.isArray(d.requestedVariants) ? d.requestedVariants : [])
            .reduce((sum, v) => sum + Number(v.quantity || 0), 0);

        return {
            _id: d._id,
            requestType: 'standard',
            requestLabel: 'Stock Demand',
            branchId: d.branchId,
            branchName: d.branchName || branchName,
            productId: d.productId,
            productName: d.productName || 'Main Warehouse Product',
            managerId: d.managerId,
            managerName: d.requestedBy || d.managerName || 'Manager',
            managerEmail: d.managerEmail || '',
            totalQuantity: totalQty,
            variantsCount: Array.isArray(d.requestedVariants) ? d.requestedVariants.length : 0,
            status: d.status || 'Pending',
            managerNote: d.managerNote || '',
            createdAt: d.createdAt
        };
    });

    const normalizedCustomRequests = customDemands.map((d) => {
        const totalQty = (Array.isArray(d.variants) ? d.variants : [])
            .reduce((sum, v) => sum + Number(v.requestedStock ?? v.quantity ?? 0), 0);

        return {
            _id: d._id,
            requestType: 'custom',
            requestLabel: 'Custom Product',
            branchId: d.branchId,
            branchName: d.branchName || branchName,
            productId: d._id,
            productName: d.productName || 'Custom Product',
            managerId: d.managerId,
            managerName: d.managerName || 'Manager',
            managerEmail: d.managerEmail || '',
            totalQuantity: totalQty,
            variantsCount: Array.isArray(d.variants) ? d.variants.length : 0,
            status: d.status || 'Pending',
            managerNote: d.managerNote || '',
            createdAt: d.createdAt
        };
    });

    const recentBranchRequests = [...normalizedStandardRequests, ...normalizedCustomRequests]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 10);

    const dailySeries = Array.from(dailyTrendMap.values())
        .map((d) => ({
            ...d,
            sell: roundMoney(d.sell),
            cost: roundMoney(d.cost),
            profit: roundMoney(d.profit)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        scope: scopeLabel,
        branch: {
            branchId: branchIdStr,
            branchName,
            code: branchDoc?.code || ''
        },
        period: {
            todayDate: formatDateKey(startOfToday),
            monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        },
        sales: {
            dailySell: roundMoney(dailySell),
            dailyReceiptsCount,
            weeklySell: roundMoney(weeklySell),
            weeklyReceiptsCount,
            monthlySell: roundMoney(monthlySell),
            monthlyReceiptsCount
        },
        profit: {
            monthlySellTotal: roundMoney(monthlySell),
            monthlyCostTotal: roundMoney(monthlyCostTotal),
            monthlyProfit: roundMoney(monthlyProfit),
            dailySellTotal: roundMoney(dailySell),
            dailyCostTotal: roundMoney(dailyCostTotal),
            dailyProfit: roundMoney(dailyProfit)
        },
        dailySeries,
        cashierPerformance,
        effectiveProducts: effectiveProducts.slice(0, 10),
        branchLowStock,
        recentBranchRequests
    };
};

const getManagerDashboardStats = async (req, res) => {
    try {
        const sessionUser = req.sessionUser;
        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const role = String(sessionUser.role || '').toLowerCase();
        if (role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only branch managers can access manager dashboard stats.'
            });
        }

        const db = getDB();
        const branchId = await resolveSessionUserBranchId(db, sessionUser);
        if (!branchId) {
            return res.status(403).json({
                success: false,
                message: 'Manager is not assigned to any branch.'
            });
        }

        const payload = await buildBranchAnalyticsPayload({
            db,
            branchId,
            now: new Date(),
            scopeLabel: 'manager'
        });

        return res.status(200).json({
            success: true,
            data: {
                role,
                ...payload
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getCashierDashboardStats = async (req, res) => {
    try {
        const sessionUser = req.sessionUser;
        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        const role = String(sessionUser.role || '').toLowerCase();
        if (role !== 'cashier') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only cashiers can access cashier dashboard stats.'
            });
        }

        const db = getDB();
        const branchId = await resolveSessionUserBranchId(db, sessionUser);
        if (!branchId) {
            return res.status(403).json({
                success: false,
                message: 'Cashier is not assigned to any branch.'
            });
        }

        const payload = await buildBranchAnalyticsPayload({
            db,
            branchId,
            now: new Date(),
            scopeLabel: 'cashier'
        });

        return res.status(200).json({
            success: true,
            data: {
                role,
                ...payload
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getTopDashboardStats,
    getManagerDashboardStats,
    getCashierDashboardStats
};