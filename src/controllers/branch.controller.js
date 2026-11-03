const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const createBranch = async (req, res) => {
    try {
        const db = getDB();
        const { name, code, address, city, phones, emails, manager, status } = req.body;

        const existing = await db.collection('branches').findOne({ code });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Branch code already exists.' });
        }

        const newBranch = {
            name,
            code: code.toUpperCase(),
            address,
            city,
            phones: Array.isArray(phones) ? phones : [phones].filter(Boolean),
            emails: Array.isArray(emails) ? emails : [emails].filter(Boolean),
            manager: manager || null,
            status: status || 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('branches').insertOne(newBranch);
        return res.status(201).json({ success: true, data: { _id: result.insertedId, ...newBranch } });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getAllBranches = async (req, res) => {
    try {
        const db = getDB();
        const branches = await db.collection('branches').find().toArray();
        return res.status(200).json({ success: true, data: branches });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getBranchById = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid branch ID format.' });
        }

        const branch = await db.collection('branches').findOne({ _id: new ObjectId(id) });
        if (!branch) {
            return res.status(404).json({ success: false, message: 'Branch not found.' });
        }

        return res.status(200).json({ success: true, data: branch });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateBranch = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid branch ID format.' });
        }

        const updates = { ...req.body, updatedAt: new Date() };
        if (updates.code) updates.code = updates.code.toUpperCase();
        if (updates.phones) updates.phones = Array.isArray(updates.phones) ? updates.phones : [updates.phones].filter(Boolean);
        if (updates.emails) updates.emails = Array.isArray(updates.emails) ? updates.emails : [updates.emails].filter(Boolean);

        const result = await db.collection('branches').findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updates },
            { returnDocument: 'after' }
        );

        if (!result.value && !result) {
            return res.status(404).json({ success: false, message: 'Branch not found.' });
        }

        return res.status(200).json({ success: true, data: result.value || result });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteBranch = async (req, res) => {
    try {
        const db = getDB();
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid branch ID format.' });
        }

        const result = await db.collection('branches').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Branch not found.' });
        }

        return res.status(200).json({ success: true, message: 'Branch deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createBranch,
    getAllBranches,
    getBranchById,
    updateBranch,
    deleteBranch
};