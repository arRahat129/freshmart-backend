const { MongoClient } = require('mongodb');

let clientInstance = null;
let dbInstance = null;

async function connectDB() {
    if (dbInstance && clientInstance) {
        try {
            await clientInstance.db('admin').command({ ping: 1 });
            return { db: dbInstance, client: clientInstance };
        } catch {
            clientInstance = null;
            dbInstance = null;
        }
    }

    const uri = process.env.MONGO_DB_URI;
    if (!uri) {
        throw new Error('MONGO_DB_URI is missing or undefined in your environment variables.');
    }

    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
    });

    await client.connect();
    clientInstance = client;
    dbInstance = client.db('freshmart-db');

    console.log('Connected to MongoDB Atlas successfully.');
    return { db: dbInstance, client: clientInstance };
}

function getDB() {
    if (!dbInstance) throw new Error('Database not initialized. Call connectDB first.');
    return dbInstance;
}

module.exports = { connectDB, getDB };
