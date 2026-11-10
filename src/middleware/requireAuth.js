const { getAuth } = require('../lib/auth');
const { READ_ROLES, CUD_ROLES } = require('../lib/roleHierarchy');

const populateSession = async (req, res, next) => {
    try {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: req.headers });
        req.sessionUser = session?.user ?? null;
    } catch {
        req.sessionUser = null;
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

module.exports = { populateSession, requireReadAccess, requireCUDAccess };
