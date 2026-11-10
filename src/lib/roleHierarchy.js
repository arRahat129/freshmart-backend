
const ROLE_RANK = {
    owner: 1,
    superadmin: 2,
    admin: 3,
    manager: 4,
    cashier: 5,
    staff: 6,
};

const READ_ROLES = new Set(['owner', 'superadmin', 'admin', 'manager']);

const CUD_ROLES = new Set(['owner', 'superadmin', 'admin']);


function getRank(role) {
    return ROLE_RANK[role] ?? 99;
}

function canManage(actorRole, targetRole) {
    return getRank(actorRole) < getRank(targetRole);
}

function assignableRoles(actorRole) {
    const actorRank = getRank(actorRole);
    return Object.entries(ROLE_RANK)
        .filter(([, rank]) => rank > actorRank)
        .map(([role]) => role);
}

module.exports = { ROLE_RANK, READ_ROLES, CUD_ROLES, getRank, canManage, assignableRoles };
