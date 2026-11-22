const dotenv = require('dotenv');
dotenv.config();
const { getDB } = require("../config/db");

let cachedAuth = null;

async function getAuth() {
    if (cachedAuth) return cachedAuth;

    const [{ betterAuth }, { mongodbAdapter }] = await Promise.all([
        import("better-auth"),
        import("@better-auth/mongo-adapter"),
    ]);

    const db = getDB();

    cachedAuth = betterAuth({
        database: mongodbAdapter(db),
        baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
        trustedOrigins: [
            process.env.FRONTEND_URL || "http://localhost:3000",
        ],
        advanced: {
            crossSubdomainCookies: {
                enabled: false,
            },
            defaultCookieAttributes: {
                sameSite: process.env.NODE_ENV === 'production' ? "none" : "lax",
                secure: process.env.NODE_ENV === 'production',
                partitioned: process.env.NODE_ENV === 'production',
            },
        },
        emailAndPassword: {
            enabled: true,
        },
        user: {
            modelName: "users",
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
                image: {
                    type: "string",
                    required: false,
                    defaultValue: "",
                },
                status: {
                    type: "string",
                    required: false,
                    defaultValue: "active",
                },
                employeeId: {
                    type: "string",
                    required: false,
                    defaultValue: "",
                },
            },
        },
        session: {
            additionalFields: ["employeeId", "role"]
        }
    });

    return cachedAuth;
}

module.exports = { getAuth };