const { ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const { getDB } = require('../config/db');
const { getAuth } = require('../lib/auth');

const createUser = async (req, res) => {
    try {
        const db = getDB();
        const { name, email, password, role, phone, address, image, branchId, employeeId, createdBy } = req.body;

        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User with this email already exists.' });
        }

        if (employeeId) {
            const existingEmpId = await db.collection('users').findOne({ employeeId });
            if (existingEmpId) {
                return res.status(400).json({ success: false, message: 'Employee ID already exists.' });
            }
        }

        let parsedBranchId = branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : null;
        const assignedRole = role || 'employee';

        if (assignedRole === 'manager' && parsedBranchId) {
            const branch = await db.collection('branches').findOne({ _id: parsedBranchId });
            if (branch && branch.manager) {
                return res.status(400).json({ success: false, message: 'This branch already has a manager assigned.' });
            }
        }

        const auth = getAuth();

        const authResult = await auth.api.signUpEmail({
            body: {
                email,
                password,
                name: name || '',
            }
        });

        const newUserId = new ObjectId(authResult.user.id);

        const additionalFields = {
            role: assignedRole,
            phone: Array.isArray(phone) ? phone : [phone].filter(Boolean),
            address: address || '',
            image: image || '',
            branchId: parsedBranchId,
            employeeId: employeeId || '',
            status: 'Active',
            createdBy: createdBy || 'System',
            updatedAt: new Date()
        };

        await db.collection('users').updateOne(
            { _id: newUserId },
            { $set: additionalFields }
        );

        const finalUser = await db.collection('users').findOne({ _id: newUserId });

        if (assignedRole === 'manager' && parsedBranchId) {
            await db.collection('branches').updateOne(
                { _id: parsedBranchId },
                { $set: { manager: newUserId, updatedAt: new Date() } }
            );
        }

        const { password: _, ...userWithoutPassword } = finalUser;

        return res.status(201).json({ success: true, data: userWithoutPassword });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const db = getDB();
        const users = await db.collection('users').find().toArray();
        return res.status(200).json({ success: true, data: users });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getUserById = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
        }

        const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        return res.status(200).json({ success: true, data: user });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateUser = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
        }

        const currentUser = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const { name, email, password, phone, address, image, branchId, status, updatedBy } = req.body;

        let parsedBranchId = currentUser.branchId;
        if (branchId !== undefined) {
            parsedBranchId = branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : null;
        }

        const updates = { updatedAt: new Date() };
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;

        if (password !== undefined && password.trim() !== '') {
            const saltRounds = 10;
            updates.password = await bcrypt.hash(password, saltRounds);
        }

        if (phone !== undefined) updates.phone = Array.isArray(phone) ? phone : [phone].filter(Boolean);
        if (address !== undefined) updates.address = address;
        if (image !== undefined) updates.image = image;
        if (branchId !== undefined) updates.branchId = parsedBranchId;
        if (status !== undefined) updates.status = status;
        if (updatedBy !== undefined) updates.updatedBy = updatedBy;

        const result = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updates },
            { returnDocument: 'after' }
        );

        const updatedUser = result.value || result;

        if (currentUser.role === 'manager' && (parsedBranchId === null || String(parsedBranchId) !== String(currentUser.branchId))) {
            await db.collection('branches').updateMany(
                { manager: new ObjectId(id) },
                { $set: { manager: null, updatedAt: new Date() } }
            );
        }

        if (currentUser.role === 'manager' && parsedBranchId && String(parsedBranchId) !== String(currentUser.branchId)) {
            await db.collection('branches').updateOne(
                { _id: parsedBranchId },
                { $set: { manager: new ObjectId(id), updatedAt: new Date() } }
            );
        }

        return res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateUserRole = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
        }

        const currentUser = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const { role, updatedBy } = req.body;

        const updates = {
            updatedAt: new Date()
        };
        if (role !== undefined) updates.role = role;
        if (updatedBy !== undefined) updates.updatedBy = updatedBy;

        const result = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updates },
            { returnDocument: 'after' }
        );

        const updatedUser = result.value || result;

        if (currentUser.role === 'manager' && role && role !== 'manager') {
            await db.collection('branches').updateMany(
                { manager: new ObjectId(id) },
                { $set: { manager: null, updatedAt: new Date() } }
            );
        }

        if (role === 'manager' && currentUser.branchId) {
            await db.collection('branches').updateOne(
                { _id: new ObjectId(currentUser.branchId) },
                { $set: { manager: new ObjectId(id), updatedAt: new Date() } }
            );
        }

        return res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteUser = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;
        const { deletedBy } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
        }

        const userToDelete = await db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!userToDelete) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const deletedRecord = {
            ...userToDelete,
            deletedAt: new Date(),
            deletedBy: deletedBy || 'System'
        };

        await db.collection('deleted_users').insertOne(deletedRecord);
        await db.collection('users').deleteOne({ _id: new ObjectId(id) });

        await db.collection('branches').updateMany(
            { manager: new ObjectId(id) },
            { $set: { manager: null, updatedAt: new Date() } }
        );

        return res.status(200).json({ success: true, message: 'User deleted and archived successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    updateUserRole,
    deleteUser
};