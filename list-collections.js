// list-collections.js
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = {
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function listCollections() {
  console.log(`🔍 Checking project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
  try {
    const collections = await db.listCollections();
    console.log(`📂 Found ${collections.length} collections:`);
    collections.forEach(col => console.log(`   - ${col.id}`));
    
    // Also check if 'prompts' exists and count documents
    if (collections.find(c => c.id === 'prompts')) {
      const snapshot = await db.collection('prompts').limit(5).get();
      console.log(`\n📊 'prompts' has ${snapshot.size} documents (sampled 5)`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listCollections();