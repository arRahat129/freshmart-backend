const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("@better-auth/mongo-adapter");
const { getDB } = require("../config/db");

function getAuth() {
    const db = getDB();

    return betterAuth({
        database: mongodbAdapter(db),
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