const dotenv = require('dotenv');
const { connectDB } = require('../src/config/db');
dotenv.config();
const bcrypt = require('bcrypt');

async function seed() {

    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPassword = process.env.OWNER_PASSWORD;

    if (!ownerEmail || !ownerPassword) {
        console.error('Error: OWNER_EMAIL and OWNER_PASSWORD must be defined in your .env file.');
        process.exit(1);
    }

    try {
        const { db, client } = await connectDB();
        const usersCollection = db.collection('user');

        const existingOwner = await usersCollection.findOne({ role: 'owner' });

        if (existingOwner) {
            console.log('Owner account already exists in database.');
            await client.close();
            process.exit(0);
        }

        const hashedPassword = await bcrypt.hash(ownerPassword, 10);
        const now = new Date();

        await usersCollection.insertOne({
            name: 'System Owner',
            email: ownerEmail,
            emailVerified: true,
            password: hashedPassword,
            role: 'owner',
            branchId: null,
            phone: '+8801800000000',
            status: 'active',
            createdAt: now,
            updatedAt: now
        });

        console.log('Master Owner account seeded successfully!');
        console.log(`Login Email: ${ownerEmail}`);
        await client.close();
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();