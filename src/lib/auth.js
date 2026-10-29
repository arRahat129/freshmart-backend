const { betterAuth } = require("better-auth");
const dotenv = require('dotenv');
const { mongodbAdapter } = require("@better-auth/mongo-adapter");
dotenv.config();
const { getDB } = require("../config/db");

function getAuth() {
    const db = getDB();

    return betterAuth({
        database: mongodbAdapter(db),
        baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
        trustedOrigins: [
            process.env.FRONTEND_URL || "http://localhost:3000",
        ],
        emailAndPassword: {
            enabled: true,
        },
        user: {
            additionalFields: {
                role: {
                    type: "string",
                    required: true,
                    defaultValue: "cashier",
                },
                branchId: {
                    type: "string",
                    required: false,
                    defaultValue: null,
                },
                phone: {
                    type: "string",
                    required: false,
                },
                address: {
                    type: "string",
                    required: false,
                },
                status: {
                    type: "string",
                    required: false,
                    defaultValue: "active",
                },
            },
        },
    });
}

module.exports = { getAuth };