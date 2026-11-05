const express = require('express');
const {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    updateUserRole,
    deleteUser
} = require('../controllers/user.controller');

const router = express.Router();

router.post('/', createUser);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.patch('/:id/role', updateUserRole);
router.delete('/:id', deleteUser);

module.exports = router;