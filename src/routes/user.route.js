const express = require('express');
const {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    updateUserRole,
    deleteUser
} = require('../controllers/user.controller');
const { populateSession, requireReadAccess, requireCUDAccess } = require('../middleware/requireAuth');

const router = express.Router();

router.use(populateSession);

router.get('/', requireReadAccess, getAllUsers);
router.get('/:id', requireReadAccess, getUserById);

router.post('/', requireCUDAccess, createUser);
router.put('/:id', requireCUDAccess, updateUser);
router.patch('/:id/role', requireCUDAccess, updateUserRole);
router.delete('/:id', requireCUDAccess, deleteUser);

module.exports = router;
