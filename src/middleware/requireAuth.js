const { getAuth } = require('../lib/auth');
const { READ_ROLES, CUD_ROLES } = require('../lib/roleHierarchy');

const TOP_DASHBOARD_ROLES = new Set(['owner', 'superadmin', 'admin']);

const MANAGER_ROLES = new Set(['manager']);

const CASHIER_ROLES = new Set(['cashier']);

const CATALOG_ADMIN_ROLES = new Set(['owner', 'superadmin', 'admin']);

const RECEIPT_READ_ROLES = new Set(['owner', 'superadmin', 'admin', 'manager', 'cashier']);

const populateSession = async (req, res, next) => {
    try {
        const auth = await getAuth();
        const session = await auth.api.getSession({ headers: req.headers });
        req.sessionUser = session?.user ?? null;
        if (req.sessionUser) {
            req.sessionUser = {
                ...req.sessionUser,
                role: String(req.sessionUser.role || '').toLowerCase()
            };
        }
    } catch (err) {
        console.log('[populateSession] error:', err.message);
        req.sessionUser = null;
    }
    next();
};

const requireSession = (req, res, next) => {
    if (!req.sessionUser) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Please sign in with a valid session.'
        });
    }
    next();
};

const requireReadAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !READ_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Insufficient permissions to view users.'
        });
    }
    next();
};

const requireCUDAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !CUD_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to perform this action.'
        });
    }
    next();
};

const requireTopDashboardAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !TOP_DASHBOARD_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Only owner, superadmin, and admin can access executive dashboard stats.'
        });
    }
    next();
};

const requireManagerAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !MANAGER_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Only branch managers can perform this action.'
        });
    }
    next();
};

const requireCashierAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !CASHIER_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Only cashiers can perform checkout operations.'
        });
    }
    next();
};

const requireReceiptReadAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !RECEIPT_READ_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Insufficient permissions to view sales receipts.'
        });
    }
    next();
};

const requireCatalogAccess = (req, res, next) => {
    const role = req.sessionUser?.role;
    if (!role || !CATALOG_ADMIN_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Only owner, superadmin, and admin can modify the catalog.'
        });
    }
    next();
};

module.exports = {
    populateSession,
    requireSession,
    requireReadAccess,
    requireCUDAccess,
    requireTopDashboardAccess,
    requireManagerAccess,
    requireCashierAccess,
    requireReceiptReadAccess,
    requireCatalogAccess
};
