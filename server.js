// =====================================================================
// server.js – Fully corrected with working social feed toggle
// =====================================================================

const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const Busboy = require('busboy');
const axios = require('axios');
const fs = require('fs');
const NodeCache = require('node-cache');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const Razorpay = require('razorpay');
require('dotenv').config();

// ========== NEW: OpenAI for AI Image Generation ==========
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========== NEW: S3 Client for Cloudflare R2 (zero egress) ==========
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g., https://pub-xxxx.r2.dev

// ========== Helper: upload file to R2 ==========
async function uploadToR2(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return `${R2_PUBLIC_URL}/${key}`;
}

// Add this helper function at the top of server.js
function sanitizeFirestoreData(data) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        // Skip undefined values
        if (value === undefined) {
            continue;
        }
        // Handle null values
        if (value === null) {
            sanitized[key] = null;
            continue;
        }
        // Handle objects recursively
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
            sanitized[key] = sanitizeFirestoreData(value);
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}

// ========== CREDIT SYSTEM ==========
async function getUserCredits(userId) {
  if (!db) return { credits: 5, freeLimit: 5, isFree: true };
  const doc = await db.collection('credits').doc(userId).get();
  if (!doc.exists) {
    const now = new Date().toISOString().split('T')[0];
    await db.collection('credits').doc(userId).set({
      credits: 5,
      freeLimit: 5,
      lastResetDate: now,
      totalPurchased: 0,
      totalUsed: 0,
      updatedAt: new Date().toISOString()
    });
    return { credits: 5, freeLimit: 5, isFree: true };
  }
  const data = doc.data();
  const today = new Date().toISOString().split('T')[0];
  if (data.lastResetDate !== today) {
    await db.collection('credits').doc(userId).update({
      credits: data.freeLimit || 5,
      lastResetDate: today,
      updatedAt: new Date().toISOString()
    });
    return { credits: data.freeLimit || 5, freeLimit: data.freeLimit || 5, isFree: true };
  }
  return { credits: data.credits || 0, freeLimit: data.freeLimit || 5, isFree: data.credits <= (data.freeLimit || 5) };
}

async function deductCredit(userId) {
  if (!db) return true; // mock
  const doc = await db.collection('credits').doc(userId).get();
  if (!doc.exists) {
    const now = new Date().toISOString().split('T')[0];
    await db.collection('credits').doc(userId).set({
      credits: 4,
      freeLimit: 5,
      lastResetDate: now,
      totalPurchased: 0,
      totalUsed: 1,
      updatedAt: new Date().toISOString()
    });
    return true;
  }
  const data = doc.data();
  if (data.credits <= 0) return false;
  const newCredits = data.credits - 1;
  await db.collection('credits').doc(userId).update({
    credits: newCredits,
    totalUsed: (data.totalUsed || 0) + 1,
    updatedAt: new Date().toISOString()
  });
  return true;
}

async function addCredits(userId, amount) {
  if (!db) return;
  const doc = await db.collection('credits').doc(userId).get();
  if (!doc.exists) {
    const now = new Date().toISOString().split('T')[0];
    await db.collection('credits').doc(userId).set({
      credits: amount,
      freeLimit: 5,
      lastResetDate: now,
      totalPurchased: amount,
      totalUsed: 0,
      updatedAt: new Date().toISOString()
    });
    return;
  }
  const data = doc.data();
  await db.collection('credits').doc(userId).update({
    credits: (data.credits || 0) + amount,
    totalPurchased: (data.totalPurchased || 0) + amount,
    updatedAt: new Date().toISOString()
  });
}

// Initialize Razorpay
let razorpay = null;
let razorpayKeyId = null;

try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    console.log('✅ Razorpay initialized successfully');
  } else {
    console.log('⚠️ Razorpay not configured - running in demo mode');
    razorpayKeyId = 'rzp_live_SXMEZ6fYLjDmzD';
  }
} catch (error) {
  console.error('❌ Razorpay initialization failed:', error);
  razorpayKeyId = 'rzp_live_SXMEZ6fYLjDmzD';
}

// Initialize Firebase Admin (Auth + Firestore ONLY, NO Storage)
let adminInitialized = false;
try {
  const serviceAccount = process.env.FIREBASE_ADMIN_PRIVATE_KEY ? {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  } : null;

  if (serviceAccount && serviceAccount.privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // storageBucket is REMOVED – we use R2 instead
    });
    adminInitialized = true;
    console.log('✅ Firebase Admin initialized (Auth + Firestore)');
  } else {
    console.log('⚠️ Firebase Admin not configured - running in demo mode');
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error);
}

// Create mock admin object for development if not initialized (storage mock removed)
let adminMock = null;
if (!adminInitialized) {
  adminMock = {
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({ exists: false, data: () => null }),
          set: () => Promise.resolve(),
          update: () => Promise.resolve(),
          delete: () => Promise.resolve(),
          collection: () => ({
            add: () => Promise.resolve({ id: 'mock-comment-id' }),
            get: () => Promise.resolve({ docs: [] }),
            orderBy: () => ({
              limit: () => ({
                get: () => Promise.resolve({ docs: [] })
              })
            }),
            count: () => ({ get: () => Promise.resolve({ data: () => ({ count: 0 }) }) })
          })
        }),
        add: () => Promise.resolve({ id: 'mock-id' }),
        get: () => Promise.resolve({ docs: [], forEach: () => {} }),
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              get: () => Promise.resolve({ docs: [] })
            })
          })
        }),
        orderBy: () => ({
          startAfter: () => ({
            limit: () => ({
              get: () => Promise.resolve({ docs: [] })
            })
          })
        }),
        limit: () => ({ get: () => Promise.resolve({ docs: [] }) }),
        count: () => ({ get: () => Promise.resolve({ data: () => ({ count: 0 }) }) })
      })
    }),
    auth: () => ({ verifyIdToken: () => Promise.resolve({}) })
  };
}

const app = express();
const port = process.env.PORT || 3000;

// Initialize cache with 5 minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const db = adminInitialized ? admin.firestore() : (adminMock ? adminMock.firestore() : null);
// No bucket variable – we use s3Client directly

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Basic middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Raw body for Razorpay webhook
app.use('/api/razorpay-webhook', express.json());

// ==================== ADS.TXT REDIRECT ====================
app.get('/ads.txt', (req, res) => {
    const adsTxtUrl = 'https://srv.adstxtmanager.com/19390/toolsprompt.com';
    console.log(`🔄 Redirecting /ads.txt to ${adsTxtUrl}`);
    res.redirect(301, adsTxtUrl);
});
// Serve static files from current directory
app.use(express.static(__dirname));


// Helper function for safe date conversion
function safeDateToString(dateValue) {
  if (!dateValue) {
    return new Date().toISOString();
  }
  
  try {
    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
      return dateValue.toDate().toISOString();
    } else if (typeof dateValue === 'string') {
      const testDate = new Date(dateValue);
      return isNaN(testDate.getTime()) ? new Date().toISOString() : dateValue;
    } else if (dateValue instanceof Date) {
      return dateValue.toISOString();
    } else {
      return new Date().toISOString();
    }
  } catch (error) {
    console.error('Date conversion error:', error);
    return new Date().toISOString();
  }
}

// ==================== ADSTERRA AD HELPER FUNCTIONS ====================

/**
 * Generates Adsterra Native Banner Ad code
 */
function generateAdsterraNativeAd() {
    return `
        <!-- Adsterra Native Banner Ad -->
        <div class="ad-container">
            <div class="ad-label">Advertisement</div>
            <div id="container-aca55beb03e2d8b514ae3f122920bdf0"></div>
            <script async="async" data-cfasync="false" src="https://pl29189858.profitablecpmratenetwork.com/aca55beb03e2d8b514ae3f122920bdf0/invoke.js"></script>
        </div>
    `;
}

/**
 * Generates Adsterra Banner Ad for Desktop (300x250)
 */
function generateAdsterraDesktopBanner() {
    return `
        <!-- Adsterra Banner Ad - Desktop 300x250 -->
        <div class="ad-container ad-banner-desktop">
            <div class="ad-label">Advertisement</div>
            <script>
              atOptions = {
                'key' : '8719e4636a7c41462203d84e956177c4',
                'format' : 'iframe',
                'height' : 250,
                'width' : 300,
                'params' : {}
              };
            </script>
            <script src="https://www.highperformanceformat.com/8719e4636a7c41462203d84e956177c4/invoke.js"></script>
        </div>
    `;
}

/**
 * Generates Adsterra Banner Ad for Mobile (320x50)
 */
function generateAdsterraMobileBanner() {
    return `
        <!-- Adsterra Banner Ad - Mobile 320x50 -->
        <div class="ad-container ad-banner-mobile">
            <div class="ad-label">Advertisement</div>
            <script>
              atOptions = {
                'key' : '37e3a123e9b664f6f0b0efed6c7ee71f',
                'format' : 'iframe',
                'height' : 50,
                'width' : 320,
                'params' : {}
              };
            </script>
            <script src="https://www.highperformanceformat.com/37e3a123e9b664f6f0b0efed6c7ee71f/invoke.js"></script>
        </div>
    `;
}

/**
 * Generates all Adsterra ads combined (Native + Desktop + Mobile)
 * Desktop and Mobile are shown/hidden via CSS media queries
 */
function generateAllAdsterraAds() {
    return `
        ${generateAdsterraNativeAd()}
        ${generateAdsterraDesktopBanner()}
        ${generateAdsterraMobileBanner()}
    `;
}

// ==================== DOWNLOAD APP BUTTON FUNCTIONS ====================

// Floating Download App Button CSS
const downloadAppCSS = `
/* Floating Download App Button */
.floating-download-btn {
 display: none !important;
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%);
    color: white;
    border: none;
    border-radius: 50px;
    padding: 14px 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    z-index: 10000;
    font-size: 1rem;
    font-weight: bold;
    box-shadow: 0 8px 25px rgba(78, 84, 200, 0.4);
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
    background: rgba(78, 84, 200, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.2);
    font-family: 'Segoe UI', sans-serif;
}

.floating-download-btn:hover {
    transform: translateX(-50%) scale(1.05);
    box-shadow: 0 12px 35px rgba(78, 84, 200, 0.6);
    background: linear-gradient(135deg, #3b41b5 0%, #7c82f0 100%);
}

.floating-download-btn:active {
    transform: translateX(-50%) scale(0.98);
}

.floating-download-btn i {
    font-size: 1.2rem;
    animation: bounce 2s infinite;
}

.floating-download-btn .btn-text {
    letter-spacing: 0.5px;
}

.floating-download-btn .btn-badge {
    background: #ff6b6b;
    color: white;
    border-radius: 20px;
    padding: 2px 8px;
    font-size: 0.7rem;
    margin-left: 8px;
    font-weight: normal;
}

@keyframes bounce {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-3px);
    }
}

/* Slide up animation for button */
@keyframes slideUpFade {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(30px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

.floating-download-btn {
    animation: slideUpFade 0.5s ease-out;
}

@media (max-width: 768px) {
    .floating-download-btn {
        padding: 12px 20px;
        font-size: 0.85rem;
        gap: 8px;
        bottom: 20px;
    }
    
    .floating-download-btn i {
        font-size: 1rem;
    }
}

@media (max-width: 480px) {
    .floating-download-btn {
        padding: 10px 16px;
        font-size: 0.75rem;
        gap: 6px;
        bottom: 15px;
    }
    
    .floating-download-btn i {
        font-size: 0.9rem;
    }
}

/* Hide on certain pages if needed */
.floating-download-btn.hidden {
    display: none;
}

@keyframes pulse {
    0% { transform: translateX(-50%) scale(1); box-shadow: 0 8px 25px rgba(78, 84, 200, 0.4); }
    50% { transform: translateX(-50%) scale(1.08); box-shadow: 0 12px 35px rgba(78, 84, 200, 0.7); }
    100% { transform: translateX(-50%) scale(1); box-shadow: 0 8px 25px rgba(78, 84, 200, 0.4); }
}
`;

// Floating Download App Button HTML
const downloadAppButtonHTML = `
<!-- Floating Download App Button -->
<button class="floating-download-btn" id="downloadAppBtn" onclick="downloadApp()">
    <i class="fas fa-download"></i>
    <span class="btn-text">Download App</span>
    <span class="btn-badge">FREE</span>
</button>
`;

// Track app download clicks endpoint
app.post('/api/track-download', async (req, res) => {
    try {
        const { promptId, promptTitle, userAgent } = req.body;
        
        console.log(`📱 App download tracked - Prompt: ${promptTitle} (${promptId})`);
        console.log(`   User Agent: ${userAgent}`);
        console.log(`   Time: ${new Date().toISOString()}`);
        
        // Optional: Store in database if needed (keep this as it's a separate feature)
        if (db && db.collection) {
            await db.collection('downloads').add({
                promptId: promptId || null,
                promptTitle: promptTitle || null,
                userAgent: userAgent || null,
                timestamp: new Date().toISOString(),
                source: 'prompt_page'
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Download tracking error:', error);
        res.json({ success: false });
    }
});

// ==================== RAZORPAY ENDPOINTS ====================

// Get Razorpay key
app.get('/api/razorpay-key', (req, res) => {
    res.json({ 
        keyId: razorpayKeyId,
        isDemo: !razorpay 
    });
});

// Alternative - let Razorpay generate receipt automatically
app.post('/api/create-order', async (req, res) => {
    try {
        const { promptId, price, userId, userEmail, customerName, customerPhone } = req.body;
        
        console.log('Creating order for:', { promptId, price, userId });
        
        // Check if Razorpay is configured
        if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
            console.log('Razorpay not configured, using demo mode');
            const demoOrderId = 'order_demo_' + Date.now();
            
            return res.json({
                success: true,
                orderId: demoOrderId,
                amount: Math.round(price * 100),
                currency: 'INR',
                isDemo: true,
                keyId: razorpayKeyId || 'rzp_live_SXMEZ6fYLjDmzD'
            });
        }
        
        const amount = Math.round(price * 100);
        
        // Remove receipt completely - let Razorpay generate it
        const options = {
            amount: amount,
            currency: 'INR',
            notes: {
                promptId: promptId,
                userId: userId
            },
            payment_capture: 1
        };
        
        console.log('Sending order request to Razorpay (no receipt)...');
        const order = await razorpay.orders.create(options);
        
        console.log('Order created successfully:', order.id);
        
        res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            isDemo: false,
            keyId: razorpayKeyId
        });
        
    } catch (error) {
        console.error('Razorpay order creation error:', error);
        
        // Fallback to demo mode
        console.log('Falling back to demo mode due to error');
        res.json({
            success: true,
            orderId: 'order_demo_' + Date.now(),
            amount: Math.round(req.body.price * 100),
            currency: 'INR',
            isDemo: true,
            keyId: razorpayKeyId || 'rzp_live_SXMEZ6fYLjDmzD'
        });
    }
});

// Fix for /api/verify-payment endpoint
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { orderId, paymentId, signature, promptId, userId, userEmail, amount } = req.body;
        
        // Use razorpay variable (not razorpay)
        if (!razorpay) {
            // Demo mode
            const purchaseResult = await completePurchaseHelper(promptId, userId, userEmail, amount, paymentId);
            return res.json(purchaseResult);
        }
        
        // Verify signature using the secret from env
        const crypto = require('crypto');
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)  // Use env variable
            .update(orderId + '|' + paymentId)
            .digest('hex');
        
        if (generatedSignature !== signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        
        // Payment verified
        const purchaseResult = await completePurchaseHelper(promptId, userId, userEmail, amount, paymentId);
        res.json(purchaseResult);
        
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Failed to verify payment', details: error.message });
    }
});


// Helper function to complete purchase
async function completePurchaseHelper(promptId, userId, userEmail, amount, paymentId) {
    // Get prompt details
    let promptData;
    if (db && db.collection) {
        const promptDoc = await db.collection('uploads').doc(promptId).get();
        if (!promptDoc.exists) {
            throw new Error('Prompt not found');
        }
        promptData = promptDoc.data();
    } else {
        // Mock data fallback
        const mockPrompts = [
            {
                id: 'demo-1',
                title: 'Fantasy Landscape with Mountains',
                promptText: 'Create a fantasy landscape with majestic mountains, floating islands, and a mystical waterfall, digital art, highly detailed, epic composition',
                userName: 'Demo User',
                userId: 'anonymous',
                imageUrl: 'https://via.placeholder.com/800x400/4e54c8/white?text=Fantasy+Landscape',
                thumbnailUrl: null,
                price: 0,
                salesCount: 0,
                totalEarnings: 0,
                purchasedBy: []
            },
            {
                id: 'demo-2',
                title: 'Cyberpunk City Street',
                promptText: 'Cyberpunk city street at night, neon signs, rainy pavement, futuristic vehicles, Blade Runner style, cinematic lighting',
                userName: 'Demo User',
                userId: 'anonymous',
                imageUrl: 'https://via.placeholder.com/800x400/8f94fb/white?text=Cyberpunk+City',
                thumbnailUrl: null,
                price: 50,
                salesCount: 0,
                totalEarnings: 0,
                purchasedBy: []
            },
            {
                id: 'demo-3',
                title: 'Professional Portrait Photography',
                promptText: 'Professional portrait photography, natural lighting, soft shadows, high detail, 85mm lens, studio quality, professional model',
                userName: 'Demo User',
                userId: 'anonymous',
                imageUrl: 'https://via.placeholder.com/800x400/20bf6b/white?text=Portrait+Photo',
                thumbnailUrl: null,
                price: 30,
                salesCount: 0,
                totalEarnings: 0,
                purchasedBy: []
            }
        ];
        promptData = mockPrompts.find(p => p.id === promptId);
        if (!promptData) {
            throw new Error('Prompt not found');
        }
    }
    
    // Check if already purchased
    const purchasedBy = promptData.purchasedBy || [];
    if (purchasedBy.includes(userId)) {
        return {
            success: true,
            message: 'Already purchased',
            promptText: promptData.promptText
        };
    }
    
    // Get proper image URL
    const imageUrl = promptData.thumbnailUrl || promptData.imageUrl || 
                    (promptData.fileType === 'video' ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : 
                     'https://via.placeholder.com/800x400/4e54c8/ffffff?text=AI+Prompt');
    
    // Create purchase record
    const purchaseData = sanitizeFirestoreData({
        promptId: promptId,
        promptTitle: promptData.title || 'Untitled Prompt',
        promptText: promptData.promptText || 'No prompt text available.',
        imageUrl: imageUrl,
        thumbnailUrl: promptData.thumbnailUrl || null,
        fileType: promptData.fileType || 'image',
        buyerId: userId,
        buyerEmail: userEmail || null,
        buyerName: userEmail ? userEmail.split('@')[0] : (promptData.buyerName || 'User'),
        sellerId: promptData.userId || 'anonymous',
        sellerName: promptData.userName || 'Anonymous',
        amount: amount || promptData.price || 0,
        razorpayOrderId: null,
        razorpayPaymentId: paymentId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        paymentStatus: 'completed'
    });
    
    // Create sale record
    const saleData = sanitizeFirestoreData({
        promptId: promptId,
        promptTitle: promptData.title || 'Untitled Prompt',
        promptText: promptData.promptText || '',
        buyerId: userId,
        buyerName: userEmail ? userEmail.split('@')[0] : 'User',
        buyerEmail: userEmail || null,
        sellerId: promptData.userId || 'anonymous',
        sellerName: promptData.userName || 'Anonymous',
        amount: amount || promptData.price || 0,
        sellerEarnings: Math.round((amount || promptData.price || 0) * 0.8),
        platformFee: Math.round((amount || promptData.price || 0) * 0.2),
        razorpayOrderId: null,
        razorpayPaymentId: paymentId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        paymentStatus: 'completed'
    });
    
    // Store in database
    if (db && db.collection) {
        await db.collection('purchases').add(purchaseData);
        console.log('✅ Purchase record saved for user:', userId, 'prompt:', promptId);
        
        await db.collection('sales').add(saleData);
        console.log('✅ Sale record saved for seller:', promptData.userId);
        
        const promptRef = db.collection('uploads').doc(promptId);
        const currentSalesCount = promptData.salesCount || 0;
        const currentEarnings = promptData.totalEarnings || 0;
        const updatedPurchasedBy = [...(promptData.purchasedBy || []), userId];
        
        await promptRef.update(sanitizeFirestoreData({
            salesCount: currentSalesCount + 1,
            totalEarnings: currentEarnings + (amount || promptData.price || 0),
            purchasedBy: updatedPurchasedBy,
            updatedAt: new Date().toISOString()
        }));
        console.log('✅ Prompt updated with new sale');
    } else {
        console.log('Purchase recorded (demo mode):', purchaseData);
        console.log('Sale recorded (demo mode):', saleData);
        
        promptData.salesCount = (promptData.salesCount || 0) + 1;
        promptData.totalEarnings = (promptData.totalEarnings || 0) + (amount || promptData.price || 0);
        promptData.purchasedBy = [...(promptData.purchasedBy || []), userId];
    }
    
    return {
        success: true,
        message: 'Purchase completed successfully',
        promptText: promptData.promptText
    };
}

// Razorpay Webhook endpoint
app.post('/api/razorpay-webhook', async (req, res) => {
    if (!razorpay) return res.json({ received: true });
    
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;  // ← Use env variable
    const signature = req.headers['x-razorpay-signature'];
    
    if (secret && signature) {
        const crypto = require('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(req.body))
            .digest('hex');
        
        if (expectedSignature !== signature) {
            console.error('Invalid webhook signature');
            return res.status(400).send('Invalid signature');
        }
    }
    
    const event = req.body;
    
    switch (event.event) {
        case 'payment.captured':
            const payment = event.payload.payment.entity;
            console.log('Payment captured:', payment.id);
            
            const { promptId, userId, userEmail } = payment.notes || {};
            const amount = payment.amount / 100;
            
            if (promptId && userId) {
                try {
                    await completePurchaseHelper(promptId, userId, userEmail, amount, payment.id);
                } catch (error) {
                    console.error('Webhook purchase completion error:', error);
                }
            }
            break;
            
        case 'payment.failed':
            console.log('Payment failed:', event.payload.payment.entity.id);
            break;
    }
    
    res.json({ received: true });
});

// Enhanced HTML serving with canonical support
function serveHTMLWithCanonical(filePath, requestedPath, req, res) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('Error reading HTML file:', err);
      return res.status(500).send('Error loading page');
    }
    
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    let canonicalUrl = baseUrl + requestedPath;
    
    if (requestedPath === '/index.html') {
      canonicalUrl = baseUrl + '/';
    }
    
    const canonicalTag = `<link rel="canonical" href="${canonicalUrl}" />`;
    const modifiedHTML = html.replace('</head>', `${canonicalTag}</head>`);
    
    res.set('Content-Type', 'text/html');
    res.send(modifiedHTML);
  });
}

// Serve main page with canonical support
app.get('/', (req, res) => {
  serveHTMLWithCanonical(path.join(__dirname, 'index.html'), '/', req, res);
});

// Serve index.html as separate page with proper canonical
app.get('/index.html', (req, res) => {
    if (req.get('host').includes('toolsprompt.com') || process.env.NODE_ENV === 'production') {
        const baseUrl = process.env.BASE_URL || `https://${req.get('host').replace('index.html', '')}`;
        return res.redirect(301, baseUrl.replace('/index.html', '/'));
    }
    
    serveHTMLWithCanonical(path.join(__dirname, 'index.html'), '/index.html', req, res);
});

// ENHANCED AdSense Helper Functions
class AdSenseManager {
  static generateAutoAdsCode() {
    const clientId = process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724';
    
    return `
      <!-- Google AdSense Auto Ads -->
      <script>
        (function() {
          if (window.adsbygoogle && window.adsbygoogle.loaded) {
            console.log('AdSense already loaded, skipping...');
            return;
          }
          
          window.adsbygoogle = window.adsbygoogle || [];
          window.adsbygoogle.loaded = true;
          
          var script = document.createElement('script');
          script.async = true;
          script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}';
          script.crossOrigin = 'anonymous';
          script.onload = function() {
            if (!window.adsbygoogle.initialized) {
              window.adsbygoogle.push({
                google_ad_client: "${clientId}",
                enable_page_level_ads: true,
                overlays: {bottom: true}
              });
              window.adsbygoogle.initialized = true;
            }
          };
          document.head.appendChild(script);
        })();
      </script>
    `;
  }

  static generateManualAd(adSlot = 'default') {
    const clientId = process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724';
    
    return `
      <!-- Manual Ad Placement -->
      <div class="ad-container">
        <div class="ad-label">Advertisement</div>
        <ins class="adsbygoogle"
            style="display:block"
            data-ad-client="${clientId}"
            data-ad-slot="${adSlot}"
            data-ad-format="auto"
            data-full-width-responsive="true"></ins>
        <script>
          (function() {
            function initAd() {
              if (window.adsbygoogle && !window.adsbygoogle.pushed) {
                (adsbygoogle = window.adsbygoogle || []).push({});
                window.adsbygoogle.pushed = true;
              } else {
                setTimeout(initAd, 100);
              }
            }
            initAd();
          })();
        </script>
      </div>
    `;
  }

  static generatePromptPageAds() {
    const clientId = process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724';
    
    return `
      <!-- Manual Ad Placement for Prompt Pages -->
      <div class="ad-container">
        <div class="ad-label">Advertisement</div>
        <ins class="adsbygoogle"
            style="display:block"
            data-ad-client="${clientId}"
            data-ad-slot="3256783957"
            data-ad-format="auto"
            data-full-width-responsive="true"></ins>
        <script>
          (adsbygoogle = window.adsbygoogle || []).push({});
        </script>
      </div>
    `;
  }
}

function generateAdSenseCode() {
  return AdSenseManager.generateAutoAdsCode();
}

function generateManualAdPlacement(adUnit = 'default') {
  return AdSenseManager.generateManualAd(adUnit);
}

function generatePromptAdPlacement() {
  return AdSenseManager.generatePromptPageAds();
}

// Migration function for existing prompts
async function migrateExistingPromptsForAdSense() {
  try {
    console.log('🔄 Starting AdSense migration for existing prompts...');
    
    if (db && db.collection) {
      const snapshot = await db.collection('uploads')
        .limit(500)
        .get();
      
      let migratedCount = 0;
      
      for (const doc of snapshot.docs) {
        const promptData = doc.data();
        
        if (!promptData.adsenseMigrated) {
          await db.collection('uploads').doc(doc.id).update({
            adsenseMigrated: true,
            migratedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          
          migratedCount++;
          console.log(`✅ Migrated prompt: ${doc.id}`);
        }
      }
      
      console.log(`🎉 AdSense migration completed! Migrated ${migratedCount} prompts.`);
      return migratedCount;
    } else {
      console.log('🎭 Development mode: Mock prompts will use new AdSense templates');
      return mockPrompts.length;
    }
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

// SEO Optimization Class
class SEOOptimizer {
  static generateSEOTitle(promptTitle) {
    const keywords = this.extractKeywords(promptTitle);
    const baseTitle = `AI Prompt: ${promptTitle} - tools prompt`;
    return keywords.length > 0 ? `${keywords.slice(0, 3).join(', ')} | ${baseTitle}` : baseTitle;
  }

  static generateMetaDescription(promptText, title) {
    const cleanText = promptText.replace(/[^\w\s]/gi, ' ').substring(0, 155);
    return `${cleanText}... Explore this AI-generated content and learn prompt engineering techniques.`;
  }

  static extractKeywords(text) {
    if (!text) return [];
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word));
    
    return [...new Set(words)];
  }

  static generateSlug(title) {
    if (!title) return 'untitled-prompt';
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 60);
  }

  static generateStructuredData(prompt) {
    return {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "name": prompt.title || 'Untitled Prompt',
      "description": prompt.metaDescription || 'AI-generated prompt',
      "image": prompt.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=AI+Image',
      "author": {
        "@type": "Person",
        "name": prompt.userName || "tools prompt User"
      },
      "datePublished": prompt.createdAt || new Date().toISOString(),
      "keywords": (prompt.keywords || ['AI', 'prompt']).join(', '),
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": `https://www.toolsprompt.com/prompt/${prompt.id || 'unknown'}`
      }
    };
  }
}

// ========== 25+ AI PHOTO EDITING MODELS ==========
const AI_PHOTO_MODELS = {
  'google-imagen': {
    name: 'Google Imagen 3',
    description: 'Google\'s most advanced text-to-image model with photorealistic quality',
    strengths: ['photorealistic', 'detailed rendering', 'text integration'],
    bestFor: 'Photorealistic images, product visualization',
    price: 'Free/Paid tiers',
    releaseDate: '2025',
    category: 'professional'
  },
  'gemini-image': {
    name: 'Gemini Image Generation',
    description: 'Google Gemini\'s integrated image generation with multimodal understanding',
    strengths: ['multimodal', 'contextual understanding', 'fast generation'],
    bestFor: 'Concept art, rapid prototyping',
    price: 'Free/Paid tiers',
    releaseDate: '2025',
    category: 'versatile'
  },
  'dalle-3': {
    name: 'DALL-E 3',
    description: 'OpenAI\'s leading image generation model with exceptional prompt comprehension',
    strengths: ['prompt accuracy', 'creative composition', 'detail'],
    bestFor: 'Artistic creations, marketing visuals',
    price: 'Credits system',
    releaseDate: '2025',
    category: 'professional'
  },
  'dalle-2': {
    name: 'DALL-E 2',
    description: 'Advanced image generation with inpainting and variations',
    strengths: ['inpainting', 'variations', 'editing'],
    bestFor: 'Image editing, variations',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'versatile'
  },
  'midjourney-v6': {
    name: 'Midjourney V6',
    description: 'Premium artistic image generation with unparalleled style control',
    strengths: ['artistic styles', 'composition', 'community'],
    bestFor: 'Digital art, concept art, fantasy',
    price: 'Paid subscription',
    releaseDate: '2025',
    category: 'artistic'
  },
  'midjourney-niji': {
    name: 'Midjourney Niji',
    description: 'Anime and illustration-focused version of Midjourney',
    strengths: ['anime', 'illustration', 'stylized'],
    bestFor: 'Anime art, manga, illustrations',
    price: 'Paid subscription',
    releaseDate: '2025',
    category: 'artistic'
  },
  'stable-diffusion-3': {
    name: 'Stable Diffusion 3',
    description: 'Latest open-source image generation with improved quality and control',
    strengths: ['open-source', 'fine-tuning', 'control'],
    bestFor: 'Custom models, research, local generation',
    price: 'Free/Paid',
    releaseDate: '2025',
    category: 'open-source'
  },
  'stable-diffusion-xl': {
    name: 'Stable Diffusion XL',
    description: 'High-quality image generation with base/refiner models',
    strengths: ['high resolution', 'refiner', 'control'],
    bestFor: 'Professional projects, high-res images',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'professional'
  },
  'sd-xl-turbo': {
    name: 'SDXL Turbo',
    description: 'Real-time image generation with reduced steps',
    strengths: ['real-time', 'fast', 'efficient'],
    bestFor: 'Rapid prototyping, real-time applications',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'real-time'
  },
  'adobe-firefly-image': {
    name: 'Adobe Firefly Image',
    description: 'Adobe\'s commercial-safe image generation with Creative Cloud integration',
    strengths: ['commercial safe', 'Adobe integration', 'professional'],
    bestFor: 'Commercial projects, design work',
    price: 'Adobe subscription',
    releaseDate: '2025',
    category: 'professional'
  },
  'photoshop-generative': {
    name: 'Photoshop Generative Fill',
    description: 'AI-powered image editing directly in Photoshop',
    strengths: ['generative fill', 'inpainting', 'editing'],
    bestFor: 'Photo editing, retouching',
    price: 'Adobe subscription',
    releaseDate: '2025',
    category: 'editing'
  },
  'canva-ai': {
    name: 'Canva AI',
    description: 'Integrated AI image generation for design projects',
    strengths: ['templates', 'design integration', 'easy'],
    bestFor: 'Social media graphics, presentations',
    price: 'Free/Pro',
    releaseDate: '2025',
    category: 'design'
  },
  'canva-magic-media': {
    name: 'Canva Magic Media',
    description: 'Text-to-image and text-to-video in Canva',
    strengths: ['versatile', 'templates', 'integration'],
    bestFor: 'Design projects, marketing',
    price: 'Free/Pro',
    releaseDate: '2025',
    category: 'design'
  },
  'leonardo-creative': {
    name: 'Leonardo Creative',
    description: 'Professional art generation with style consistency',
    strengths: ['style consistency', 'professional', 'commercial'],
    bestFor: 'Professional art, commercial projects',
    price: 'Token system',
    releaseDate: '2025',
    category: 'professional'
  },
  'leonardo-phoenix': {
    name: 'Leonardo Phoenix',
    description: 'Latest Leonardo model with enhanced quality',
    strengths: ['quality', 'speed', 'control'],
    bestFor: 'High-quality art, illustrations',
    price: 'Token system',
    releaseDate: '2025',
    category: 'professional'
  },
  'ideogram-2': {
    name: 'Ideogram 2.0',
    description: 'AI image generation with exceptional typography',
    strengths: ['typography', 'text rendering', 'design'],
    bestFor: 'Graphic design, text-heavy images',
    price: 'Free/Paid',
    releaseDate: '2025',
    category: 'design'
  },
  'playground-v2': {
    name: 'Playground AI V2',
    description: 'Versatile image generation with fine-tuning options',
    strengths: ['fine-tuning', 'style mixing', 'easy'],
    bestFor: 'Creative exploration, experimentation',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'creative'
  },
  'clipdrop-replace': {
    name: 'ClipDrop Replace',
    description: 'AI image editing with object replacement',
    strengths: ['object replacement', 'background removal', 'practical'],
    bestFor: 'Product photography, e-commerce',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'editing'
  },
  'runway-image': {
    name: 'Runway Image Generation',
    description: 'Integrated image generation in Runway platform',
    strengths: ['integration', 'video synergy', 'professional'],
    bestFor: 'Multi-modal projects, video+image',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'professional'
  },
  'nightcafe-creator': {
    name: 'NightCafe Creator',
    description: 'Multiple AI algorithms in one platform',
    strengths: ['multiple algorithms', 'community', 'styles'],
    bestFor: 'Artistic exploration, community engagement',
    price: 'Credit system',
    releaseDate: '2025',
    category: 'artistic'
  },
  'wombo-dream': {
    name: 'Wombo Dream',
    description: 'Mobile-first AI art generation',
    strengths: ['mobile', 'artistic styles', 'quick'],
    bestFor: 'Mobile creation, quick art',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'mobile'
  },
  'starryai': {
    name: 'StarryAI',
    description: 'NFT-focused AI art generation',
    strengths: ['NFT', 'ownership rights', 'mobile'],
    bestFor: 'NFT creation, digital collectibles',
    price: 'Token system',
    releaseDate: '2024',
    category: 'nft'
  },
  'deepai': {
    name: 'DeepAI',
    description: 'Classic AI image generation with various models',
    strengths: ['multiple models', 'API access', 'simple'],
    bestFor: 'Quick generation, API integration',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'versatile'
  },
  'craiyon-v3': {
    name: 'Craiyon V3',
    description: 'Free AI image generation with improved quality',
    strengths: ['completely free', 'simple', 'no signup'],
    bestFor: 'Quick testing, casual use',
    price: 'Free',
    releaseDate: '2025',
    category: 'free'
  },
  'bing-creator': {
    name: 'Bing Image Creator',
    description: 'Free DALL-E powered image generation',
    strengths: ['free DALL-E', 'Microsoft integration', 'daily credits'],
    bestFor: 'Free generation, quick results',
    price: 'Free',
    releaseDate: '2025',
    category: 'free'
  },
  'getty-generative': {
    name: 'Getty Generative AI',
    description: 'Commercial-safe AI images with legal protection',
    strengths: ['legal protection', 'commercial safe', 'royalty-free'],
    bestFor: 'Commercial use, licensed content',
    price: 'Paid',
    releaseDate: '2024',
    category: 'commercial'
  },
  'shutterstock-ai': {
    name: 'Shutterstock AI',
    description: 'AI image generation with stock library integration',
    strengths: ['stock integration', 'commercial', 'variety'],
    bestFor: 'Stock content, commercial projects',
    price: 'Paid',
    releaseDate: '2024',
    category: 'commercial'
  },
  'picsart-ai': {
    name: 'Picsart AI',
    description: 'AI image generation with editing tools',
    strengths: ['editing tools', 'social features', 'filters'],
    bestFor: 'Social media content, quick edits',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'editing'
  },
  'fotor-ai': {
    name: 'Fotor AI',
    description: 'AI image generation with photo editing',
    strengths: ['photo editing', 'templates', 'easy'],
    bestFor: 'Photo enhancement, quick edits',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'editing'
  },
  'bluewillow-v4': {
    name: 'BlueWillow V4',
    description: 'Free Discord-based AI art generation',
    strengths: ['free', 'Discord community', 'rapid'],
    bestFor: 'Community art, free generation',
    price: 'Free',
    releaseDate: '2024',
    category: 'free'
  },
  'tensorart': {
    name: 'TensorArt',
    description: 'Free AI image generation with multiple models',
    strengths: ['multiple models', 'free credits', 'community'],
    bestFor: 'Model experimentation, free generation',
    price: 'Free/Paid',
    releaseDate: '2025',
    category: 'versatile'
  },
  'seaart': {
    name: 'SeaArt',
    description: 'AI art platform with various styles',
    strengths: ['style variety', 'community', 'easy'],
    bestFor: 'Style exploration, community art',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'artistic'
  }
};

// ========== 25+ AI VIDEO EDITING MODELS ==========
const AI_VIDEO_MODELS = {
  'google-veo-2': {
    name: 'Google Veo 2',
    description: 'Google\'s most advanced video generation model with 4K quality',
    strengths: ['4K video', 'prompt consistency', 'professional quality'],
    bestFor: 'Professional video creation, marketing content',
    price: 'Free (Limited) / Paid',
    releaseDate: '2025',
    category: 'professional'
  },
  'google-flow': {
    name: 'Google Flow',
    description: 'Google\'s real-time video editing AI with intelligent scene analysis',
    strengths: ['real-time editing', 'scene detection', 'smart transitions'],
    bestFor: 'Real-time video editing, live content',
    price: 'Included with Workspace',
    releaseDate: '2025',
    category: 'real-time'
  },
  'gemini-video': {
    name: 'Gemini 2.0 Video',
    description: 'Google Gemini\'s multimodal video understanding and generation',
    strengths: ['multimodal understanding', 'video analysis', 'script-to-video'],
    bestFor: 'Content analysis, automated editing',
    price: 'API pricing',
    releaseDate: '2025',
    category: 'analysis'
  },
  'video-poet': {
    name: 'VideoPoet',
    description: 'Google\'s large language model for video generation',
    strengths: ['zero-shot', 'video stylization', 'audio generation'],
    bestFor: 'Experimental video, creative projects',
    price: 'Research preview',
    releaseDate: '2024',
    category: 'experimental'
  },
  'openai-sora': {
    name: 'OpenAI Sora',
    description: 'State-of-the-art text-to-video with photorealistic quality',
    strengths: ['photorealistic', 'complex scenes', 'natural motion'],
    bestFor: 'High-end video production, cinematic projects',
    price: 'Not publicly available',
    releaseDate: '2025',
    category: 'professional'
  },
  'chatgpt-4o-video': {
    name: 'ChatGPT-4o Video',
    description: 'GPT-4o\'s integrated video understanding and generation',
    strengths: ['real-time editing', 'multimodal', 'conversational'],
    bestFor: 'Interactive video editing, content creation',
    price: 'ChatGPT Plus',
    releaseDate: '2025',
    category: 'interactive'
  },
  'dalle-video': {
    name: 'DALL-E Video',
    description: 'Video generation based on DALL-E\'s prompt understanding',
    strengths: ['prompt accuracy', 'artistic styles', 'creative control'],
    bestFor: 'Artistic video creation, experimental',
    price: 'Credits system',
    releaseDate: '2025',
    category: 'artistic'
  },
  'meta-movie-gen': {
    name: 'Meta Movie Gen',
    description: 'Meta\'s advanced video generation with audio synthesis',
    strengths: ['audio generation', 'long-form video', 'character consistency'],
    bestFor: 'Long-form content, character animation',
    price: 'Research preview',
    releaseDate: '2025',
    category: 'long-form'
  },
  'make-a-video': {
    name: 'Make-A-Video',
    description: 'Meta\'s text-to-video model with motion understanding',
    strengths: ['motion understanding', 'style transfer', 'quick generation'],
    bestFor: 'Rapid prototyping, motion experiments',
    price: 'Research preview',
    releaseDate: '2024',
    category: 'rapid'
  },
  'emu-video': {
    name: 'Emu Video',
    description: 'Meta\'s video generation model based on Emu',
    strengths: ['quality', 'style control', 'factorized diffusion'],
    bestFor: 'Factorized video generation, style control',
    price: 'Research preview',
    releaseDate: '2024',
    category: 'experimental'
  },
  'runway-gen-3': {
    name: 'Runway Gen-3',
    description: 'Latest Runway video generation with advanced controls',
    strengths: ['multi-shot', 'inpainting', 'professional tools'],
    bestFor: 'Professional video editing, post-production',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'professional'
  },
  'runway-gen-2': {
    name: 'Runway Gen-2',
    description: 'Text-to-video and video-to-video generation',
    strengths: ['style transfer', 'motion brush', 'real-time preview'],
    bestFor: 'Creative experimentation, style transfer',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'creative'
  },
  'runway-frame-interpolation': {
    name: 'Runway Frame Interpolation',
    description: 'Smooth slow-motion and frame interpolation',
    strengths: ['slow motion', 'smooth transitions', 'frame generation'],
    bestFor: 'Smooth motion, slow-motion effects',
    price: 'Subscription',
    releaseDate: '2024',
    category: 'effects'
  },
  'pika-2-0': {
    name: 'Pika 2.0',
    description: 'Advanced video generation with lip sync and character animation',
    strengths: ['lip sync', 'character animation', 'style consistency'],
    bestFor: 'Character animation, dialogue scenes',
    price: 'Free/Paid tiers',
    releaseDate: '2025',
    category: 'animation'
  },
  'pika-effects': {
    name: 'Pika Effects',
    description: 'Specialized video effects and transitions',
    strengths: ['visual effects', 'transitions', 'stylization'],
    bestFor: 'Effect-heavy content, stylized videos',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'effects'
  },
  'pika-1-0': {
    name: 'Pika 1.0',
    description: 'Original Pika video generation platform',
    strengths: ['easy to use', 'quick generation', 'social optimized'],
    bestFor: 'Quick videos, social media content',
    price: 'Free/Paid',
    releaseDate: '2024',
    category: 'social'
  },
  'stable-video-diffusion': {
    name: 'Stable Video Diffusion',
    description: 'Open-source video generation with fine-tuning',
    strengths: ['open source', 'custom training', 'local generation'],
    bestFor: 'Custom models, research, local use',
    price: 'Free',
    releaseDate: '2024',
    category: 'open-source'
  },
  'svd-xt': {
    name: 'SVD-XT',
    description: 'Extended Stable Video Diffusion with higher quality',
    strengths: ['4K support', 'longer videos', 'better motion'],
    bestFor: 'High-quality projects, extended videos',
    price: 'API access',
    releaseDate: '2025',
    category: 'professional'
  },
  'svd-frame-interpolation': {
    name: 'SVD Frame Interpolation',
    description: 'Frame interpolation for smoother video',
    strengths: ['smooth motion', 'frame generation', 'upscaling'],
    bestFor: 'Smooth slow-motion, frame generation',
    price: 'Free',
    releaseDate: '2024',
    category: 'open-source'
  },
  'adobe-firefly-video': {
    name: 'Adobe Firefly Video',
    description: 'Adobe\'s generative AI for video in Premiere Pro',
    strengths: ['Adobe integration', 'professional workflow', 'commercial safe'],
    bestFor: 'Professional editors, post-production',
    price: 'Creative Cloud',
    releaseDate: '2025',
    category: 'professional'
  },
  'premiere-pro-ai': {
    name: 'Premiere Pro AI',
    description: 'AI-powered editing tools in Premiere Pro',
    strengths: ['auto-reframe', 'scene detection', 'color matching'],
    bestFor: 'Post-production, automated editing',
    price: 'Creative Cloud',
    releaseDate: '2025',
    category: 'professional'
  },
  'after-effects-ai': {
    name: 'After Effects AI',
    description: 'AI-powered motion graphics and effects',
    strengths: ['motion graphics', 'effects', 'rotoscoping'],
    bestFor: 'Motion graphics, visual effects',
    price: 'Creative Cloud',
    releaseDate: '2025',
    category: 'effects'
  },
  'capcut-pro-ai': {
    name: 'CapCut Pro AI',
    description: 'ByteDance\'s AI-powered video editing suite',
    strengths: ['auto-captions', 'auto-cut', 'templates'],
    bestFor: 'Social media content, quick edits',
    price: 'Free/Pro',
    releaseDate: '2025',
    category: 'social'
  },
  'capcut-text-to-video': {
    name: 'CapCut Text-to-Video',
    description: 'AI video generation from text descriptions',
    strengths: ['quick generation', 'templates', 'music sync'],
    bestFor: 'Quick content creation, social media',
    price: 'Free/Pro',
    releaseDate: '2025',
    category: 'social'
  },
  'capcut-auto-cut': {
    name: 'CapCut Auto Cut',
    description: 'AI-powered automatic video editing',
    strengths: ['auto-editing', 'beat sync', 'highlights'],
    bestFor: 'Highlight reels, automated edits',
    price: 'Free/Pro',
    releaseDate: '2024',
    category: 'editing'
  },
  'invideo-ai': {
    name: 'InVideo AI',
    description: 'AI-powered video creation for marketing',
    strengths: ['script to video', 'stock footage', 'voiceover'],
    bestFor: 'Marketing videos, promotional content',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'marketing'
  },
  'invideo-studio': {
    name: 'InVideo Studio',
    description: 'Advanced video editing with AI assistance',
    strengths: ['AI editing', 'templates', 'collaboration'],
    bestFor: 'Team projects, collaborative editing',
    price: 'Subscription',
    releaseDate: '2024',
    category: 'collaboration'
  },
  'synthesia-2-0': {
    name: 'Synthesia 2.0',
    description: 'AI video generation with realistic avatars',
    strengths: ['avatar videos', 'multilingual', 'custom avatars'],
    bestFor: 'Corporate training, presentations, e-learning',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'avatar'
  },
  'synthesia-avatars': {
    name: 'Synthesia Avatars',
    description: 'Custom AI avatar creation and video',
    strengths: ['custom avatars', 'cloning', 'expressions'],
    bestFor: 'Personalized videos, branding',
    price: 'Enterprise',
    releaseDate: '2024',
    category: 'avatar'
  },
  'heygen-2-0': {
    name: 'HeyGen 2.0',
    description: 'AI video generation with avatar and voice cloning',
    strengths: ['avatar cloning', 'voice cloning', 'translation'],
    bestFor: 'Personalized videos, multilingual content',
    price: 'Credits system',
    releaseDate: '2025',
    category: 'avatar'
  },
  'heygen-interactive': {
    name: 'HeyGen Interactive',
    description: 'Interactive AI avatar videos',
    strengths: ['interactive avatars', 'real-time', 'chat'],
    bestFor: 'Interactive content, customer service',
    price: 'Enterprise',
    releaseDate: '2025',
    category: 'interactive'
  },
  'elevenlabs-video': {
    name: 'ElevenLabs Video',
    description: 'AI video with advanced voice synthesis and lip sync',
    strengths: ['voice quality', 'lip sync', 'emotion'],
    bestFor: 'Narrated content, voice-first videos',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'voice'
  },
  'kling-1-6': {
    name: 'Kling 1.6',
    description: 'Advanced video generation from Kuaishou',
    strengths: ['high quality', 'fast generation', 'Chinese support'],
    bestFor: 'Chinese market content, high-quality video',
    price: 'Credits system',
    releaseDate: '2025',
    category: 'professional'
  },
  'kling-1-5': {
    name: 'Kling 1.5',
    description: 'Previous generation with good quality/speed balance',
    strengths: ['balanced', 'reliable', 'consistent'],
    bestFor: 'General video creation',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'versatile'
  },
  'luma-dream-machine': {
    name: 'Luma Dream Machine',
    description: 'High-quality video generation with cinematic quality',
    strengths: ['cinematic', 'motion quality', 'resolution'],
    bestFor: 'Cinematic projects, high-end content',
    price: 'Credits system',
    releaseDate: '2025',
    category: 'cinematic'
  },
  'luma-ray': {
    name: 'Luma Ray',
    description: 'AI-powered 3D video and NeRF technology',
    strengths: ['3D video', 'NeRF', 'real-world capture'],
    bestFor: '3D content, real-world capture',
    price: 'Credits system',
    releaseDate: '2024',
    category: '3d'
  },
  'haiper-2-0': {
    name: 'Haiper 2.0',
    description: 'Video generation with enhanced motion understanding',
    strengths: ['motion physics', 'object interaction', 'extensions'],
    bestFor: 'Complex motion scenes, physics-based animation',
    price: 'Free/Paid',
    releaseDate: '2025',
    category: 'motion'
  },
  'haiper-1-0': {
    name: 'Haiper 1.0',
    description: 'Original Haiper video generation platform',
    strengths: ['easy to use', 'quick', 'versatile'],
    bestFor: 'Quick video generation',
    price: 'Free',
    releaseDate: '2024',
    category: 'free'
  },
  'minimax-video': {
    name: 'Minimax Video',
    description: 'Chinese video generation model with high-quality output',
    strengths: ['quality', 'speed', 'Chinese optimization'],
    bestFor: 'Asian market content, high-quality video',
    price: 'API access',
    releaseDate: '2025',
    category: 'professional'
  },
  'minimax-hailuo': {
    name: 'Minimax Hailuo',
    description: 'Advanced video generation with emotional understanding',
    strengths: ['emotional', 'expressive', 'character-driven'],
    bestFor: 'Character-driven content, emotional scenes',
    price: 'API access',
    releaseDate: '2025',
    category: 'expressive'
  },
  'kaiber-2-0': {
    name: 'Kaiber 2.0',
    description: 'Artistic video generation with style transfer',
    strengths: ['artistic styles', 'music visualization', 'creative'],
    bestFor: 'Music videos, artistic content',
    price: 'Subscription',
    releaseDate: '2025',
    category: 'artistic'
  },
  'kaiber-motion': {
    name: 'Kaiber Motion',
    description: 'Motion-aware artistic video generation',
    strengths: ['motion control', 'style transfer', 'fluid animation'],
    bestFor: 'Artistic motion graphics',
    price: 'Subscription',
    releaseDate: '2024',
    category: 'artistic'
  },
  'cogvideo-x': {
    name: 'CogVideoX',
    description: 'Open-source video generation from THUDM',
    strengths: ['open source', 'Chinese/English', 'fine-tuning'],
    bestFor: 'Custom training, research, open-source projects',
    price: 'Free',
    releaseDate: '2025',
    category: 'open-source'
  },
  'cogvideo-x-5b': {
    name: 'CogVideoX-5B',
    description: '5B parameter version for higher quality',
    strengths: ['high quality', 'more parameters', 'better results'],
    bestFor: 'High-quality open-source generation',
    price: 'Free',
    releaseDate: '2025',
    category: 'open-source'
  },
  'animatediff': {
    name: 'AnimateDiff',
    description: 'Motion module for Stable Diffusion animation',
    strengths: ['animation', 'motion modules', 'ControlNet support'],
    bestFor: 'Animated sequences, motion modules',
    price: 'Free',
    releaseDate: '2024',
    category: 'open-source'
  },
  'animatediff-v2': {
    name: 'AnimateDiff V2',
    description: 'Improved motion module with better quality',
    strengths: ['better motion', 'quality', 'control'],
    bestFor: 'High-quality animation',
    price: 'Free',
    releaseDate: '2025',
    category: 'open-source'
  },
  'moonvalley': {
    name: 'Moonvalley',
    description: 'Free AI video generation with Discord bot',
    strengths: ['free', 'Discord', 'community'],
    bestFor: 'Free video generation, community art',
    price: 'Free',
    releaseDate: '2024',
    category: 'free'
  },
  'deforum': {
    name: 'Deforum',
    description: 'Animation toolkit for Stable Diffusion',
    strengths: ['animation', 'parameter control', '3D camera'],
    bestFor: 'Complex animations, camera movements',
    price: 'Free',
    releaseDate: '2024',
    category: 'open-source'
  },
  'morph-studio': {
    name: 'Morph Studio',
    description: 'AI video generation platform with style control',
    strengths: ['style control', 'quality', 'easy'],
    bestFor: 'Style-consistent video generation',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'versatile'
  },
  'pixverse': {
    name: 'Pixverse',
    description: 'Free AI video generation platform',
    strengths: ['free', 'web-based', 'fast'],
    bestFor: 'Free video generation, quick tests',
    price: 'Free',
    releaseDate: '2024',
    category: 'free'
  },
  'videocom': {
    name: 'VideoCom',
    description: 'AI video generation with character consistency',
    strengths: ['character consistency', 'storytelling', 'long-form'],
    bestFor: 'Story-driven videos, character animation',
    price: 'Credits system',
    releaseDate: '2024',
    category: 'storytelling'
  },
  'ltx-studio': {
    name: 'LTX Studio',
    description: 'AI film production platform',
    strengths: ['film production', 'scene planning', 'multi-shot'],
    bestFor: 'Film production, multi-scene videos',
    price: 'Paid',
    releaseDate: '2025',
    category: 'professional'
  }
};

// ========== AI MODEL MANAGER ==========
class AIModelManager {
  static detectPlatform(promptData) {
    const promptText = (promptData.promptText || '').toLowerCase();
    const title = (promptData.title || '').toLowerCase();
    const keywords = promptData.keywords || [];
    const category = promptData.category || 'general';
    const fileType = promptData.fileType || 'image';
    
    const isVideo = fileType === 'video' || promptData.videoUrl || category === 'video';
    
    if (isVideo) {
      return this.detectVideoPlatform(promptText, keywords, category);
    }
    
    return this.detectPhotoPlatform(promptText, keywords, category);
  }
  
  static detectPhotoPlatform(promptText, keywords, category) {
    if (promptText.includes('imagen') || keywords.includes('imagen')) return 'google-imagen';
    if (promptText.includes('gemini image')) return 'gemini-image';
    if (promptText.includes('dalle-3') || promptText.includes('dall-e 3')) return 'dalle-3';
    if (promptText.includes('dalle-2') || promptText.includes('dall-e 2')) return 'dalle-2';
    if (promptText.includes('midjourney v6') || promptText.includes('midjourney 6')) return 'midjourney-v6';
    if (promptText.includes('niji') || promptText.includes('anime')) return 'midjourney-niji';
    if (promptText.includes('midjourney')) return 'midjourney-v6';
    if (promptText.includes('stable diffusion 3') || promptText.includes('sd3')) return 'stable-diffusion-3';
    if (promptText.includes('stable diffusion xl') || promptText.includes('sdxl')) return 'stable-diffusion-xl';
    if (promptText.includes('adobe firefly')) return 'adobe-firefly-image';
    if (promptText.includes('photoshop')) return 'photoshop-generative';
    if (promptText.includes('canva ai') || promptText.includes('canva magic')) return 'canva-ai';
    if (promptText.includes('leonardo')) return 'leonardo-creative';
    if (promptText.includes('ideogram')) return 'ideogram-2';
    if (promptText.includes('playground ai')) return 'playground-v2';
    if (promptText.includes('clipdrop')) return 'clipdrop-replace';
    if (promptText.includes('runway')) return 'runway-image';
    if (promptText.includes('nightcafe')) return 'nightcafe-creator';
    if (promptText.includes('wombo')) return 'wombo-dream';
    if (promptText.includes('starryai')) return 'starryai';
    if (promptText.includes('deepai')) return 'deepai';
    if (promptText.includes('craiyon')) return 'craiyon-v3';
    if (promptText.includes('bing')) return 'bing-creator';
    
    const categoryPlatforms = {
      'art': 'midjourney-v6',
      'photography': 'google-imagen',
      'design': 'adobe-firefly-image',
      'professional': 'leonardo-creative',
      'free': 'craiyon-v3',
      'general': 'dalle-3'
    };
    
    return categoryPlatforms[category] || 'dalle-3';
  }
  
  static detectVideoPlatform(promptText, keywords, category) {
    if (promptText.includes('veo') || keywords.includes('veo')) return 'google-veo-2';
    if (promptText.includes('sora') || keywords.includes('sora')) return 'openai-sora';
    if (promptText.includes('runway gen-3') || promptText.includes('gen-3')) return 'runway-gen-3';
    if (promptText.includes('pika 2.0') || promptText.includes('pika 2')) return 'pika-2-0';
    if (promptText.includes('pika')) return 'pika-2-0';
    if (promptText.includes('stable video diffusion') || promptText.includes('svd')) return 'stable-video-diffusion';
    if (promptText.includes('adobe firefly video')) return 'adobe-firefly-video';
    if (promptText.includes('capcut')) return 'capcut-pro-ai';
    if (promptText.includes('synthesia')) return 'synthesia-2-0';
    if (promptText.includes('heygen')) return 'heygen-2-0';
    if (promptText.includes('kling')) return 'kling-1-6';
    if (promptText.includes('luma dream machine')) return 'luma-dream-machine';
    if (promptText.includes('haiper')) return 'haiper-2-0';
    if (promptText.includes('kaiber')) return 'kaiber-2-0';
    
    const categoryPlatforms = {
      'professional': 'runway-gen-3',
      'animation': 'pika-2-0',
      'social': 'capcut-pro-ai',
      'avatar': 'synthesia-2-0',
      'cinematic': 'luma-dream-machine',
      'free': 'pixverse',
      'video': 'runway-gen-3',
      'general': 'pika-2-0'
    };
    
    return categoryPlatforms[category] || 'pika-2-0';
  }
  
  static getPhotoModelInfo(modelId) {
    return AI_PHOTO_MODELS[modelId] || AI_PHOTO_MODELS['dalle-3'];
  }
  
  static getVideoModelInfo(modelId) {
    return AI_VIDEO_MODELS[modelId] || AI_VIDEO_MODELS['pika-2-0'];
  }
  
  static getAllPhotoModels() {
    return Object.values(AI_PHOTO_MODELS);
  }
  
  static getAllVideoModels() {
    return Object.values(AI_VIDEO_MODELS);
  }
  
  static getPhotoModelCount() {
    return Object.keys(AI_PHOTO_MODELS).length;
  }
  
  static getVideoModelCount() {
    return Object.keys(AI_VIDEO_MODELS).length;
  }
}

// ========== AI PLATFORM CONTENT GENERATOR ==========
class AIPlatformContentGenerator {
  static generatePlatformIntroduction(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    const platformId = AIModelManager.detectPlatform(promptData);
    
    if (isVideo) {
      const platform = AIModelManager.getVideoModelInfo(platformId);
      return `${platform.name} ${platform.description}. With cutting-edge capabilities including ${platform.strengths.join(', ')}, this AI video tool helps you create professional-quality content with minimal effort.`;
    } else {
      const platform = AIModelManager.getPhotoModelInfo(platformId);
      return `${platform.name} ${platform.description}. Whether you need ${platform.strengths.join(', ')}, this platform delivers exceptional results for your creative projects.`;
    }
  }
  
  static generatePlatformComparison(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    const primaryPlatformId = AIModelManager.detectPlatform(promptData);
    
    if (isVideo) {
      const topVideoPlatforms = [
        'google-veo-2', 'openai-sora', 'runway-gen-3', 'pika-2-0', 'adobe-firefly-video',
        'meta-movie-gen', 'capcut-pro-ai', 'synthesia-2-0', 'luma-dream-machine', 'kaiber-2-0',
        'stable-video-diffusion', 'haiper-2-0', 'minimax-video', 'cogvideo-x', 'elevenlabs-video'
      ];
      
      const comparisonRows = topVideoPlatforms.map(platformId => {
        const platform = AIModelManager.getVideoModelInfo(platformId);
        const isPrimary = platformId === primaryPlatformId;
        
        return `
          <tr class="${isPrimary ? 'primary-platform' : ''}">
            <td><strong>${platform.name}</strong>${isPrimary ? ' <span class="primary-badge">Recommended</span>' : ''}</td>
            <td>${platform.bestFor}</td>
            <td><span class="price-tag ${platform.price?.includes('Free') ? 'price-free' : 'price-paid'}">${platform.price}</span></td>
            <td><span class="category-badge category-${platform.category}">${platform.category}</span></td>
            <td>${platform.strengths[0]}</td>
          </tr>
        `;
      }).join('');
      
      return `
        <div class="platform-comparison">
          <h3><i class="fas fa-video"></i> AI Video Platform Comparison (${AIModelManager.getVideoModelCount()}+ Models)</h3>
          <p>Choose from over ${AIModelManager.getVideoModelCount()} leading AI video platforms. Compare features, pricing, and best use cases:</p>
          <div class="comparison-table-container">
            <table class="platform-comparison-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Best For</th>
                  <th>Pricing</th>
                  <th>Category</th>
                  <th>Key Strength</th>
                </tr>
              </thead>
              <tbody>
                ${comparisonRows}
              </tbody>
            </table>
          </div>
          <div class="comparison-tips">
            <p><strong>Quick recommendations:</strong></p>
            <ul>
              <li><strong>For professionals:</strong> Google Veo 2, OpenAI Sora, Runway Gen-3</li>
              <li><strong>For social media:</strong> CapCut Pro AI, Pika 2.0, InVideo AI</li>
              <li><strong>For avatars:</strong> Synthesia 2.0, HeyGen 2.0, ElevenLabs Video</li>
              <li><strong>For open source:</strong> Stable Video Diffusion, CogVideoX, AnimateDiff</li>
              <li><strong>For cinematic:</strong> Luma Dream Machine, Meta Movie Gen, Kling 1.6</li>
            </ul>
          </div>
        </div>
      `;
    } else {
      const topPhotoPlatforms = [
        'google-imagen', 'dalle-3', 'midjourney-v6', 'stable-diffusion-3', 'adobe-firefly-image',
        'leonardo-creative', 'ideogram-2', 'canva-ai', 'playground-v2', 'runway-image',
        'nightcafe-creator', 'wombo-dream', 'getty-generative', 'craiyon-v3', 'bing-creator'
      ];
      
      const comparisonRows = topPhotoPlatforms.map(platformId => {
        const platform = AIModelManager.getPhotoModelInfo(platformId);
        const isPrimary = platformId === primaryPlatformId;
        
        return `
          <tr class="${isPrimary ? 'primary-platform' : ''}">
            <td><strong>${platform.name}</strong>${isPrimary ? ' <span class="primary-badge">Recommended</span>' : ''}</td>
            <td>${platform.bestFor}</td>
            <td><span class="price-tag ${platform.price?.includes('Free') ? 'price-free' : 'price-paid'}">${platform.price}</span></td>
            <td><span class="category-badge category-${platform.category}">${platform.category}</span></td>
            <td>${platform.strengths[0]}</td>
          </tr>
        `;
      }).join('');
      
      return `
        <div class="platform-comparison">
          <h3><i class="fas fa-camera"></i> AI Photo Platform Comparison (${AIModelManager.getPhotoModelCount()}+ Models)</h3>
          <p>Choose from over ${AIModelManager.getPhotoModelCount()} leading AI image platforms. Compare features, pricing, and best use cases:</p>
          <div class="comparison-table-container">
            <table class="platform-comparison-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Best For</th>
                  <th>Pricing</th>
                  <th>Category</th>
                  <th>Key Strength</th>
                </tr>
              </thead>
              <tbody>
                ${comparisonRows}
              </tbody>
            </table>
          </div>
          <div class="comparison-tips">
            <p><strong>Quick recommendations:</strong></p>
            <ul>
              <li><strong>For professionals:</strong> Google Imagen 3, DALL-E 3, Midjourney V6</li>
              <li><strong>For designers:</strong> Adobe Firefly, Canva AI, Leonardo Creative</li>
              <li><strong>For commercial use:</strong> Getty Generative, Shutterstock AI, Adobe Firefly</li>
              <li><strong>For open source:</strong> Stable Diffusion 3, SDXL, SDXL Turbo</li>
              <li><strong>For free:</strong> Craiyon V3, Bing Creator, BlueWillow V4</li>
              <li><strong>For mobile:</strong> Wombo Dream, StarryAI, Picsart AI</li>
            </ul>
          </div>
        </div>
      `;
    }
  }
  
  static generateBestAITools(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    const primaryPlatformId = AIModelManager.detectPlatform(promptData);
    
    if (isVideo) {
      const featuredPlatforms = [
        'google-veo-2', 'openai-sora', 'runway-gen-3', 'pika-2-0', 'adobe-firefly-video',
        'capcut-pro-ai', 'synthesia-2-0', 'luma-dream-machine', 'kaiber-2-0', 'stable-video-diffusion'
      ];
      
      return featuredPlatforms.slice(0, 6).map(platformId => {
        const platform = AIModelManager.getVideoModelInfo(platformId);
        return {
          name: platform.name,
          description: platform.description,
          strengths: platform.strengths,
          bestFor: platform.bestFor,
          price: platform.price,
          category: platform.category,
          isPrimary: platformId === primaryPlatformId
        };
      });
    } else {
      const featuredPlatforms = [
        'google-imagen', 'dalle-3', 'midjourney-v6', 'stable-diffusion-3', 'adobe-firefly-image',
        'leonardo-creative', 'ideogram-2', 'canva-ai', 'playground-v2', 'getty-generative'
      ];
      
      return featuredPlatforms.slice(0, 6).map(platformId => {
        const platform = AIModelManager.getPhotoModelInfo(platformId);
        return {
          name: platform.name,
          description: platform.description,
          strengths: platform.strengths,
          bestFor: platform.bestFor,
          price: platform.price,
          category: platform.category,
          rating: platform.category === 'professional' ? 5 : 4,
          isPrimary: platformId === primaryPlatformId
        };
      });
    }
  }
  
  static generateExpertTips(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    
    if (isVideo) {
      return [
        'Start with detailed scene descriptions including camera angles, lighting, and mood',
        'Specify exact duration (3-15 seconds) for optimal social media performance',
        'Include camera movements: "smooth zoom", "pan left", "dolly in", "tracking shot"',
        'Describe transitions between scenes for multi-shot videos',
        'Use motion keywords like "fluid", "dynamic", "cinematic", "slow motion"',
        'Specify aspect ratio: 9:16 for Reels/Shorts, 16:9 for YouTube, 1:1 for Instagram',
        'Include lighting changes and mood progression throughout the video',
        'For character animation, describe expressions and actions precisely',
        'Use negative prompts to exclude unwanted elements or artifacts',
        'Generate multiple variations and combine the best parts using video editing software'
      ];
    } else {
      return [
        'Be descriptive: Use specific, detailed language rather than vague terms',
        'Include artistic references: "in the style of [artist], [art movement]"',
        'Specify lighting and composition: "dramatic lighting, rule of thirds"',
        'Use quality modifiers: "highly detailed, 8k resolution, professional"',
        'Use weighted prompts: "(keyword:1.3)" to emphasize elements',
        'Experiment with different aspect ratios for various platforms',
        'Use negative prompts extensively to exclude unwanted elements',
        'Save successful seeds for consistent style reproduction',
        'Use image prompts with URLs for style reference',
        'Iterate systematically: Make small, specific changes between generations'
      ];
    }
  }
  
  static generateUsageTips(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    
    if (isVideo) {
      return [
        'Keep videos short (3-10 seconds) for optimal social media performance',
        'Use descriptive motion language: "fluid", "dynamic", "cinematic"',
        'Specify transitions between scenes: "fade to", "whip pan", "cross dissolve"',
        'Include camera movement directions: "zoom in on subject", "track left"',
        'Mention pacing: "slow and dreamy", "fast-paced action"',
        'Describe lighting changes throughout the video sequence',
        'Reference popular video styles: "like TikTok transitions", "cinematic film look"',
        'Specify output format: portrait for Reels/Shorts, landscape for YouTube',
        'Include audio suggestions or mood descriptions to pair with visuals',
        'Add music, captions, or effects using video editing tools for enhanced results'
      ];
    } else {
      return [
        'Experiment with different art styles and mediums mentioned in the prompt',
        'Adjust parameters like aspect ratio, style, and quality settings',
        'Use style references for more consistent results',
        'Try varying the chaos/stylize parameters for more creative variations',
        'Combine with other prompts for hybrid styles',
        'Specify camera types and lenses for different photographic effects',
        'Use lighting terms like "golden hour" or "studio lighting"',
        'Include depth of field requirements for focus control',
        'Test the prompt across different AI platforms',
        'Keep a log of successful variations and parameters'
      ];
    }
  }
  
  static generateStepByStepGuide(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    const platformId = AIModelManager.detectPlatform(promptData);
    
    if (isVideo) {
      const platform = AIModelManager.getVideoModelInfo(platformId);
      
      return {
        access: `Access ${platform.name} through ${this.getVideoAccessMethod(platformId)}. Create an account if needed and familiarize yourself with the interface.`,
        preparation: 'Define your video concept including duration, style, mood, and key scenes. Write a detailed description of what you want to create.',
        prompt: `Use this prompt as your starting point: "${promptData.promptText || 'Enter your video generation prompt here'}"`,
        customization: this.getVideoParameterTips(platformId),
        generation: 'Generate your video and review the results. Most platforms allow you to regenerate or refine based on initial output.',
        finalization: 'Export your video in the desired format. Optimize for your target platform (9:16 for Reels/Shorts, 16:9 for YouTube).'
      };
    } else {
      const platform = AIModelManager.getPhotoModelInfo(platformId);
      
      return {
        access: `Access ${platform.name} through ${this.getPhotoAccessMethod(platformId)}.`,
        preparation: 'Start with a clear concept. Consider the style, composition, and mood you want to achieve.',
        prompt: `Use this prompt: "${promptData.promptText || 'Enter your prompt here'}"`,
        customization: this.getPhotoParameterTips(platformId),
        generation: 'Generate and review results. Request variations or make specific edits as needed.',
        finalization: 'Download your preferred result in your chosen resolution.'
      };
    }
  }
  
  static getPhotoAccessMethod(platformId) {
    const methods = {
      'google-imagen': 'Google AI Studio or Vertex AI platform',
      'gemini-image': 'Google AI Studio or Gemini API',
      'dalle-3': 'ChatGPT Plus subscription or OpenAI platform',
      'dalle-2': 'OpenAI platform',
      'midjourney-v6': 'Discord (join Midjourney server) or web interface',
      'midjourney-niji': 'Discord with --niji parameter',
      'stable-diffusion-3': 'Stability AI platform or Hugging Face',
      'stable-diffusion-xl': 'DreamStudio, Automatic1111 WebUI, or local install',
      'sd-xl-turbo': 'Replicate API or Hugging Face',
      'adobe-firefly-image': 'firefly.adobe.com with Adobe account',
      'photoshop-generative': 'Adobe Photoshop with Creative Cloud subscription',
      'canva-ai': 'Canva platform with account',
      'canva-magic-media': 'Canva Pro subscription',
      'leonardo-creative': 'leonardo.ai web platform',
      'leonardo-phoenix': 'leonardo.ai with model selection',
      'ideogram-2': 'ideogram.ai web platform',
      'playground-v2': 'playgroundai.com with account',
      'clipdrop-replace': 'clipdrop.co website or mobile apps',
      'runway-image': 'runwayml.com with account',
      'nightcafe-creator': 'nightcafe.studio with account',
      'wombo-dream': 'Wombo Dream app or web',
      'starryai': 'StarryAI app',
      'deepai': 'deepai.org API',
      'craiyon-v3': 'craiyon.com directly - no account required',
      'bing-creator': 'bing.com/create with Microsoft account',
      'getty-generative': 'Getty Images platform',
      'shutterstock-ai': 'Shutterstock platform',
      'picsart-ai': 'picsart.com or Picsart app',
      'fotor-ai': 'fotor.com or Fotor app',
      'bluewillow-v4': 'BlueWillow Discord server',
      'tensorart': 'tensor.art platform',
      'seaart': 'seaart.ai platform'
    };
    
    return methods[platformId] || 'the platform\'s official website or app';
  }
  
  static getVideoAccessMethod(platformId) {
    const methods = {
      'google-veo-2': 'Google AI Studio or Vertex AI platform',
      'google-flow': 'Google Workspace or Google Cloud Console',
      'gemini-video': 'Google AI Studio or Gemini API',
      'video-poet': 'Google research preview',
      'openai-sora': 'OpenAI API (limited preview)',
      'chatgpt-4o-video': 'ChatGPT Plus subscription or OpenAI API',
      'dalle-video': 'OpenAI platform',
      'meta-movie-gen': 'Meta AI research preview',
      'make-a-video': 'Meta AI research preview',
      'emu-video': 'Meta AI research preview',
      'runway-gen-3': 'runwayml.com with subscription',
      'runway-gen-2': 'runwayml.com with credits',
      'runway-frame-interpolation': 'runwayml.com with subscription',
      'pika-2-0': 'pika.art website or Discord',
      'pika-effects': 'pika.art with effects',
      'pika-1-0': 'pika.art',
      'stable-video-diffusion': 'Hugging Face or local install',
      'svd-xt': 'Stability AI API',
      'svd-frame-interpolation': 'Hugging Face',
      'adobe-firefly-video': 'Adobe Creative Cloud subscription',
      'premiere-pro-ai': 'Adobe Premiere Pro',
      'after-effects-ai': 'Adobe After Effects',
      'capcut-pro-ai': 'CapCut mobile app or desktop version',
      'capcut-text-to-video': 'CapCut with AI features',
      'capcut-auto-cut': 'CapCut app',
      'invideo-ai': 'invideo.io with subscription',
      'invideo-studio': 'invideo.io',
      'synthesia-2-0': 'synthesia.io with subscription',
      'synthesia-avatars': 'synthesia.io enterprise',
      'heygen-2-0': 'heygen.com with credits',
      'heygen-interactive': 'heygen.com enterprise',
      'elevenlabs-video': 'elevenlabs.io with subscription',
      'kling-1-6': 'Kuaishou platform (Chinese)',
      'kling-1-5': 'Kuaishou platform',
      'luma-dream-machine': 'lumalabs.ai',
      'luma-ray': 'lumalabs.ai',
      'haiper-2-0': 'haiper.ai',
      'haiper-1-0': 'haiper.ai',
      'minimax-video': 'Minimax API',
      'minimax-hailuo': 'Minimax API',
      'kaiber-2-0': 'kaiber.ai with subscription',
      'kaiber-motion': 'kaiber.ai',
      'cogvideo-x': 'GitHub or Hugging Face',
      'cogvideo-x-5b': 'GitHub or Hugging Face',
      'animatediff': 'GitHub',
      'animatediff-v2': 'GitHub',
      'moonvalley': 'Moonvalley Discord',
      'deforum': 'GitHub or Colab',
      'morph-studio': 'morphstudio.com',
      'pixverse': 'pixverse.ai',
      'videocom': 'videocom.ai',
      'ltx-studio': 'ltx.studio'
    };
    
    return methods[platformId] || 'the platform\'s official website or app';
  }
  
  static getPhotoParameterTips(platformId) {
    const tips = {
      'midjourney-v6': 'Use --ar for aspect ratios, --style for artistic approaches, --chaos for variation, --stylize for artistic interpretation',
      'dalle-3': 'Use natural language, specify style and quality, include artistic references',
      'stable-diffusion-3': 'Adjust CFG scale (7-12), steps (20-50), use negative prompts, try different samplers',
      'google-imagen': 'Use detailed descriptions, include lighting and composition terms',
      'adobe-firefly-image': 'Use content type filters, style presets, commercial-safe prompts',
      'leonardo-creative': 'Adjust guidance scale, use element weights, select appropriate model',
      'default': 'Adjust quality settings, aspect ratio, and style parameters based on your needs'
    };
    
    return tips[platformId] || tips.default;
  }
  
  static getVideoParameterTips(platformId) {
    const tips = {
      'google-veo-2': 'Adjust resolution, duration, and aspect ratio. Use negative prompts to avoid unwanted elements.',
      'openai-sora': 'Specify camera angles, lighting, and motion style. Use detailed scene descriptions.',
      'runway-gen-3': 'Use motion brush for specific movements, adjust frame consistency for smoother results.',
      'pika-2-0': 'Use -neg for negative prompts, -ar for aspect ratio, -seed for consistency, -motion for intensity.',
      'adobe-firefly-video': 'Use generative extend for longer videos, apply style presets for consistent look.',
      'capcut-pro-ai': 'Use auto-captions, smart cut, and AI effects. Adjust speed and transitions.',
      'default': 'Adjust quality settings, duration, and style parameters based on your needs.'
    };
    
    return tips[platformId] || tips.default;
  }
  
  static generateModelSpecificTips() {
    return `
    <div class="model-specific-tips">
      <h4><i class="fas fa-microchip"></i> Model-Specific Optimization</h4>
      <div class="model-tips-grid">
        <div class="model-tip">
          <h5><i class="fab fa-discord"></i> Midjourney</h5>
          <ul>
            <li>Use <code>--ar 16:9</code> for widescreen, <code>--ar 9:16</code> for mobile</li>
            <li><code>--style raw</code> for less opinionated, <code>--style expressive</code> for artistic</li>
            <li><code>--chaos 0-100</code> controls variation (higher = more diverse)</li>
            <li><code>--stylize 100-1000</code> adjusts artistic interpretation</li>
          </ul>
        </div>
        <div class="model-tip">
          <h5><i class="fas fa-robot"></i> Stable Diffusion</h5>
          <ul>
            <li>CFG Scale: 7-12 (balance between creativity and prompt adherence)</li>
            <li>Sampling Steps: 20-50 (higher = more detailed but slower)</li>
            <li>Negative prompts: Essential for removing unwanted elements</li>
            <li>Use <code>(keyword:1.3)</code> for emphasis, <code>[keyword]</code> for de-emphasis</li>
          </ul>
        </div>
        <div class="model-tip">
          <h5><i class="fab fa-google"></i> Google Gemini/Imagen</h5>
          <ul>
            <li>Use natural, conversational language</li>
            <li>Include context and background information</li>
            <li>Ask for multiple variations in one request</li>
            <li>Use follow-up questions for refinements</li>
          </ul>
        </div>
        <div class="model-tip">
          <h5><i class="fab fa-adobe"></i> Adobe Firefly</h5>
          <ul>
            <li>Specify commercial-safe content requirements</li>
            <li>Use Adobe Stock references for consistency</li>
            <li>Integrate with Creative Cloud workflows</li>
            <li>Use style presets for quick professional results</li>
          </ul>
        </div>
        <div class="model-tip">
          <h5><i class="fas fa-video"></i> Runway ML / Pika</h5>
          <ul>
            <li>Specify exact duration (3-10 seconds) for optimal results</li>
            <li>Describe camera movements: "smooth zoom", "pan left", "dolly in"</li>
            <li>Include motion descriptors: "fluid", "dynamic", "cinematic"</li>
            <li>Mention transitions between scenes for complex videos</li>
          </ul>
        </div>
        <div class="model-tip">
          <h5><i class="fas fa-film"></i> CapCut / InVideo</h5>
          <ul>
            <li>Use templates as starting points for faster production</li>
            <li>Combine AI generation with stock footage for variety</li>
            <li>Add AI voiceovers for narration and storytelling</li>
            <li>Export in platform-specific formats (9:16 for Reels/Shorts)</li>
          </ul>
        </div>
      </div>
    </div>
    `;
  }
}

// AI Content Generator for Prompt Pages
class PromptContentGenerator {
  static generateDetailedExplanation(promptData) {
    const keywords = promptData.keywords || ['AI', 'prompt'];
    const category = promptData.category || 'general';
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || category === 'video';
    
    if (isVideo) {
      return AIPlatformContentGenerator.generatePlatformIntroduction(promptData);
    }
    
    const explanations = {
      'art': `This ${keywords[0] || 'creative'} prompt generates stunning visual artwork through AI image generation. The prompt carefully combines specific stylistic elements, composition techniques, and artistic references to produce unique digital creations that showcase the power of modern AI art tools.`,
      'photography': `This photography-style prompt creates realistic images that mimic professional photographic techniques. The AI interprets lighting conditions, camera settings, and compositional rules to generate images that appear to be captured with high-end photographic equipment and expert technique.`,
      'design': `This design-focused prompt produces visually appealing compositions suitable for various applications. The AI understands design principles, color theory, and layout requirements to create professional-grade visual assets that can be used in digital and print media.`,
      'writing': `This writing prompt generates textual content using advanced language models. The AI analyzes the prompt structure, tone requirements, and content specifications to produce coherent, engaging written material that meets specific creative or professional needs.`,
      'general': `This AI prompt leverages advanced machine learning algorithms to interpret and execute creative instructions. The system analyzes the prompt's semantic structure, contextual cues, and stylistic requirements to generate high-quality output that aligns with the specified parameters.`
    };

    return explanations[category] || explanations.general;
  }

  static generateStepByStepInstructions(promptData) {
    const category = promptData.category || 'general';
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || category === 'video';
    
    if (isVideo) {
      const steps = AIPlatformContentGenerator.generateStepByStepGuide(promptData);
      return [
        `Step 1: ${steps.access}`,
        `Step 2: ${steps.preparation}`,
        `Step 3: ${steps.prompt}`,
        `Step 4: ${steps.customization}`,
        `Step 5: ${steps.generation}`,
        `Step 6: ${steps.finalization}`
      ];
    }
    
    const steps = {
      'art': [
        "Copy the exact prompt text provided below",
        "Paste into your preferred AI image generator (Midjourney, DALL-E, Stable Diffusion)",
        "Adjust parameters like aspect ratio, style, and quality settings if needed",
        "Generate multiple variations to explore different interpretations",
        "Select the best result and refine if necessary"
      ],
      'photography': [
        "Use the prompt in AI photography tools or image generators",
        "Set appropriate resolution and quality settings for your needs",
        "Consider adjusting lighting and composition parameters",
        "Generate several versions to capture different perspectives",
        "Post-process if needed using image editing software"
      ],
      'design': [
        "Input the prompt into your AI design tool of choice",
        "Specify output format and dimensions for your project",
        "Generate multiple design variations for comparison",
        "Select the most suitable design for your application",
        "Customize further with additional design elements if required"
      ],
      'writing': [
        "Copy the prompt into your AI writing assistant",
        "Set the desired tone, style, and length parameters",
        "Generate the initial content draft",
        "Review and refine the output for coherence and accuracy",
        "Edit and polish the final text as needed"
      ],
      'general': [
        "Copy the complete prompt text",
        "Paste into your chosen AI platform or tool",
        "Configure any additional settings or parameters",
        "Generate the output and review results",
        "Iterate with modifications if necessary"
      ]
    };

    return steps[category] || steps.general;
  }

  static generateBestAITools(promptData) {
    return AIPlatformContentGenerator.generateBestAITools(promptData);
  }

  static generateTrendAnalysis(promptData) {
    const keywords = promptData.keywords || [];
    const category = promptData.category || 'general';
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || category === 'video';
    
    if (isVideo) {
      return `AI video generation is exploding in popularity with short-form content dominating social media. Trends show increased demand for ${keywords[0] || 'dynamic'} video reels, seamless transitions, and cinematic motion sequences. AI tools are now capable of creating professional-grade video content from simple text prompts, revolutionizing content creation for platforms like TikTok, Instagram Reels, and YouTube Shorts. The latest models like Google Veo 2 and OpenAI Sora are pushing the boundaries of what's possible with AI-generated video.`;
    }
    
    const trends = {
      'art': `The AI art landscape is rapidly evolving with trends leaning towards ${keywords.slice(0, 2).join(' and ') || 'mixed-media styles'}. Current movements emphasize hybrid techniques, surreal compositions, and the integration of traditional art principles with digital innovation. Prompt engineering has become crucial for achieving specific artistic visions.`,
      'photography': `AI photography is revolutionizing how we create visual content. Trends show increased demand for ${keywords[0] || 'professional'} styles that mimic real-world photography while offering impossible perspectives and lighting conditions. The focus is on achieving photographic realism with creative freedom beyond physical constraints.`,
      'design': `Design trends in AI are shifting towards ${keywords[0] || 'minimalist'} approaches that balance aesthetics with functionality. There's growing emphasis on creating designs that are both visually appealing and practically implementable across various platforms and media types.`,
      'writing': `AI writing trends emphasize ${keywords[0] || 'engaging'} content that maintains human-like quality while optimizing for specific audiences. The focus is on creating coherent, context-aware text that serves practical purposes across different domains and use cases.`,
      'general': `The AI prompt engineering field is experiencing rapid growth with trends focusing on more specific, detailed instructions that yield predictable, high-quality results. There's increasing emphasis on understanding how different AI models interpret various prompt structures and stylistic elements.`
    };

    return trends[category] || trends.general;
  }

  static generateUsageTips(promptData) {
    return AIPlatformContentGenerator.generateUsageTips(promptData);
  }

  static generateSEOTips(promptData) {
    return [
      `Use specific, descriptive language in your prompts for better AI understanding`,
      `Include relevant keywords like '${(promptData.keywords || []).slice(0, 2).join("', '")}' for targeted results`,
      `Experiment with different parameter combinations to optimize outputs`,
      `Save successful prompt variations for future reference and refinement`,
      `Stay updated with the latest AI model capabilities and limitations`
    ];
  }
}

// ENHANCED AI Description Generator
class AIDescriptionGenerator {
  static generatePlatformIntroduction(promptData) {
    return AIPlatformContentGenerator.generatePlatformIntroduction(promptData);
  }

  static detectPlatform(promptData) {
    return AIModelManager.detectPlatform(promptData);
  }

  static getCategoryBenefits(category) {
    const benefits = {
      'art': 'stunning visual artwork, creative compositions, or unique artistic styles',
      'photography': 'professional-grade photography, realistic portraits, or cinematic scenes',
      'design': 'visually appealing designs, professional layouts, or brand assets',
      'writing': 'engaging content, professional copy, or creative storytelling',
      'video': 'viral-worthy video reels, dynamic motion graphics, or cinematic sequences',
      'general': 'high-quality outputs, creative solutions, or professional results'
    };
    
    return benefits[category] || benefits.general;
  }

  static getControlAspects(category) {
    const aspects = {
      'art': 'style, composition, color palette, and artistic elements',
      'photography': 'lighting, composition, camera settings, and mood',
      'design': 'layout, color theory, typography, and visual hierarchy',
      'writing': 'tone, style, structure, and content flow',
      'video': 'motion, pacing, transitions, camera movements, and duration',
      'general': 'every aspect of your creative vision with precision'
    };
    
    return aspects[category] || aspects.general;
  }

  static generateTargetAudience(promptData) {
    const category = promptData.category || 'general';
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || category === 'video';
    const platformId = this.detectPlatform(promptData);
    
    if (isVideo) {
      const platform = AIModelManager.getVideoModelInfo(platformId);
      return `This video creation prompt is tailored for content creators, social media managers, videographers, and digital marketers who want to leverage ${platform.name}'s ${platform.strengths[0] || 'advanced'} capabilities to create stunning video content efficiently.`;
    } else {
      const platform = AIModelManager.getPhotoModelInfo(platformId);
      return `This curated collection of prompts is tailored for ${this.getAudienceForCategory(category)} who want to leverage ${platform.name}'s ${platform.strengths[0] || 'powerful'} capabilities.`;
    }
  }
  
  static getAudienceForCategory(category) {
    const audiences = {
      'art': 'artists, designers, and creative professionals',
      'photography': 'photographers, content creators, and visual storytellers',
      'design': 'graphic designers, marketers, and brand managers',
      'writing': 'writers, marketers, and content strategists',
      'video': 'content creators, social media managers, and videographers',
      'general': 'creators, professionals, and AI enthusiasts'
    };
    
    return audiences[category] || audiences.general;
  }

  static generateTrendContext(promptData) {
    const category = promptData.category || 'general';
    const keywords = promptData.keywords || [];
    const trendingTerms = keywords.slice(0, 3).join(', ');
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || category === 'video';
    
    if (isVideo) {
      return `These video prompts leverage the latest short-form content trends like ${trendingTerms || 'dynamic transitions and viral effects'}, optimized for platforms like TikTok, Instagram Reels, and YouTube Shorts.`;
    }
    
    const trends = {
      'art': `Each prompt combines trending aesthetics like ${trendingTerms || 'contemporary digital art styles'}, from innovative artistic movements to classic techniques reimagined for the digital age.`,
      'photography': `Every prompt incorporates current visual trends including ${trendingTerms || 'modern photographic techniques'}, blending professional photography principles with AI-enhanced creativity.`,
      'design': `These prompts integrate design trends such as ${trendingTerms || 'modern layout principles'}, combining aesthetic appeal with functional design requirements.`,
      'writing': `Each writing prompt leverages contemporary styles including ${trendingTerms || 'modern communication techniques'}, merging engaging storytelling with practical content creation.`,
      'general': `Every prompt features cutting-edge approaches like ${trendingTerms || 'advanced AI techniques'}, making it easy to consistently produce high-quality, trend-aware content.`
    };
    
    return trends[category] || trends.general;
  }

  static generatePlatformCapabilities(promptData) {
    const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
    const platformId = this.detectPlatform(promptData);
    
    if (isVideo) {
      const platform = AIModelManager.getVideoModelInfo(platformId);
      return `${platform.name}'s ${platform.category} capabilities deliver ${platform.strengths.join(', ')} for professional-quality video content.`;
    } else {
      const platform = AIModelManager.getPhotoModelInfo(platformId);
      return `${platform.name}'s ${platform.category} engine creates ${platform.strengths.join(', ')} outputs with exceptional quality and consistency.`;
    }
  }

  static generatePlatformComparison(promptData) {
    return AIPlatformContentGenerator.generatePlatformComparison(promptData);
  }

  static generateBestAITools(promptData) {
    return AIPlatformContentGenerator.generateBestAITools(promptData);
  }

  static generateModelSpecificTips() {
    return AIPlatformContentGenerator.generateModelSpecificTips();
  }

  static generateStepByStepGuide(promptData) {
    return AIPlatformContentGenerator.generateStepByStepGuide(promptData);
  }

  static generateExpertTips(promptData) {
    return AIPlatformContentGenerator.generateExpertTips(promptData);
  }

  static generateComprehensiveDescription(promptData) {
    const platformIntro = this.generatePlatformIntroduction(promptData);
    const targetAudience = this.generateTargetAudience(promptData);
    const trendContext = this.generateTrendContext(promptData);
    const capabilities = this.generatePlatformCapabilities(promptData);
    
    const steps = this.generateStepByStepGuide(promptData);
    const expertTips = this.generateExpertTips(promptData);
    
    return {
      introduction: `${platformIntro} ${targetAudience} ${trendContext} ${capabilities}`,
      stepByStep: steps,
      tips: expertTips
    };
  }
}

// Enhanced Engagement Analytics Class - Mock only, no Firestore
class EngagementAnalytics {
  static async getPromptEngagement(promptId, db) {
    // Return mock data without any Firestore operations
    return {
      likes: Math.floor(Math.random() * 100),
      views: Math.floor(Math.random() * 500),
      uses: Math.floor(Math.random() * 50),
      copies: Math.floor(Math.random() * 25),
      comments: Math.floor(Math.random() * 15),
      engagementRate: Math.random() * 0.5 + 0.3,
      popularityScore: Math.floor(Math.random() * 100)
    };
  }
}

// News-specific SEO Optimizer
class NewsSEOOptimizer {
  static generateNewsTitle(title) {
    return `${title || 'AI News'} - tools prompt News`;
  }

  static generateNewsDescription(content) {
    if (!content) return 'Latest AI news and updates from tools prompt.';
    const cleanContent = content.replace(/[^\w\s]/gi, ' ').substring(0, 150);
    return `${cleanContent}... Read more AI prompt news and updates.`;
  }

  static generateNewsSlug(title) {
    const baseSlug = (title || 'ai-news').toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 60);
    return baseSlug + '-' + Date.now();
  }

  static generateNewsStructuredData(news) {
    return {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": news.title || 'AI News',
      "description": news.metaDescription || 'Latest AI news and updates',
      "image": news.imageUrl || 'https://www.toolsprompt.com/logo.png',
      "datePublished": news.createdAt || new Date().toISOString(),
      "dateModified": news.updatedAt || new Date().toISOString(),
      "author": {
        "@type": "Person",
        "name": news.author || "tools prompt Editor"
      },
      "publisher": {
        "@type": "Organization",
        "name": "tools prompt",
        "logo": {
          "@type": "ImageObject",
          "url": "https://www.toolsprompt.com/logo.png"
        }
      },
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": `https://www.toolsprompt.com/news/${news.id || 'unknown'}`
      }
    };
  }
}

// Sitemap Generator Class
class SitemapGenerator {
  static generateSitemap(urls) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    
    urls.forEach(url => {
      xml += `<url>\n`;
      xml += `  <loc>${this.escapeXml(url.loc)}</loc>\n`;
      if (url.lastmod) xml += `  <lastmod>${url.lastmod}</lastmod>\n`;
      if (url.changefreq) xml += `  <changefreq>${url.changefreq}</changefreq>\n`;
      if (url.priority) xml += `  <priority>${url.priority}</priority>\n`;
      xml += `</url>\n`;
    });
    
    xml += `</urlset>`;
    return xml;
  }

  static generateNewsSitemap(newsUrls) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
    xml += `        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n`;
    
    newsUrls.forEach(url => {
      xml += `<url>\n`;
      xml += `  <loc>${this.escapeXml(url.loc)}</loc>\n`;
      xml += `  <news:news>\n`;
      xml += `    <news:publication>\n`;
      xml += `      <news:name>tools prompt</news:name>\n`;
      xml += `      <news:language>en</news:language>\n`;
      xml += `    </news:publication>\n`;
      xml += `    <news:publication_date>${new Date(url.lastmod).toISOString().split('T')[0]}</news:publication_date>\n`;
      xml += `    <news:title>${this.escapeXml(url.title || 'AI News')}</news:title>\n`;
      xml += `  </news:news>\n`;
      xml += `</url>\n`;
    });
    
    xml += `</urlset>`;
    return xml;
  }

  static escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}

// Mock data for development
const mockPrompts = [
  {
    id: 'demo-1',
    title: 'Fantasy Landscape with Mountains',
    promptText: 'Create a fantasy landscape with majestic mountains, floating islands, and a mystical waterfall, digital art, highly detailed, epic composition',
    imageUrl: 'https://via.placeholder.com/800x400/4e54c8/white?text=Fantasy+Landscape',
    userName: 'Demo User',
    userId: 'anonymous',
    likes: 42,
    views: 156,
    uses: 23,
    copies: 12,
    commentCount: 5,
    keywords: ['fantasy', 'landscape', 'mountains', 'digital art'],
    category: 'art',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 85,
    adsenseMigrated: true,
    fileType: 'image',
    price: 0,
    isPaid: false,
    salesCount: 0,
    totalEarnings: 0,
    purchasedBy: []
  },
  {
    id: 'demo-2',
    title: 'Cyberpunk City Street',
    promptText: 'Cyberpunk city street at night, neon signs, rainy pavement, futuristic vehicles, Blade Runner style, cinematic lighting',
    imageUrl: 'https://via.placeholder.com/800x400/8f94fb/white?text=Cyberpunk+City',
    userName: 'Demo User',
    userId: 'anonymous',
    likes: 67,
    views: 289,
    uses: 45,
    copies: 28,
    commentCount: 8,
    keywords: ['cyberpunk', 'city', 'neon', 'futuristic'],
    category: 'art',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 92,
    adsenseMigrated: true,
    fileType: 'image',
    price: 50,
    isPaid: true,
    salesCount: 3,
    totalEarnings: 150,
    purchasedBy: []
  },
  {
    id: 'demo-3',
    title: 'Professional Portrait Photography',
    promptText: 'Professional portrait photography, natural lighting, soft shadows, high detail, 85mm lens, studio quality, professional model',
    imageUrl: 'https://via.placeholder.com/800x400/20bf6b/white?text=Portrait+Photo',
    userName: 'Demo User',
    userId: 'anonymous',
    likes: 34,
    views: 189,
    uses: 12,
    copies: 8,
    commentCount: 3,
    keywords: ['photography', 'portrait', 'professional', 'studio'],
    category: 'photography',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 78,
    adsenseMigrated: true,
    fileType: 'image',
    price: 30,
    isPaid: true,
    salesCount: 1,
    totalEarnings: 30,
    purchasedBy: []
  },
  {
    id: 'demo-video-1',
    title: 'Cinematic Drone Shot Over Mountains',
    promptText: 'Cinematic drone shot flying over majestic mountains at sunrise, golden light, clouds below, smooth motion, 4k quality, epic scale, 10-second video',
    imageUrl: 'https://via.placeholder.com/300x400/ff6b6b/white?text=Video+Reel',
    thumbnailUrl: 'https://via.placeholder.com/300x400/ff6b6b/white?text=Custom+Thumbnail',
    videoUrl: 'https://storage.googleapis.com/mock-bucket/videos/sample-drone.mp4',
    mediaUrl: 'https://storage.googleapis.com/mock-bucket/videos/sample-drone.mp4',
    userName: 'Demo Video Creator',
    userId: 'anonymous',
    likes: 89,
    views: 567,
    uses: 34,
    copies: 21,
    commentCount: 12,
    keywords: ['drone', 'cinematic', 'mountains', 'sunrise', 'video'],
    category: 'video',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 95,
    adsenseMigrated: true,
    fileType: 'video',
    videoDuration: 10,
    videoFormat: 'mp4',
    hasCustomThumbnail: true,
    price: 0,
    isPaid: false,
    salesCount: 0,
    totalEarnings: 0,
    purchasedBy: []
  }
];

// Generate mock news
function generateMockNews(count) {
  const news = [];
  const categories = ['ai-news', 'prompt-tips', 'industry-updates', 'tutorials', 'video-news'];
  const authors = ['AI News Team', 'Prompt Master', 'Tech Editor', 'Community Manager', 'Video Creator'];
  
  for (let i = 1; i <= count; i++) {
    const category = categories[Math.floor(Math.random() * categories.length)];
    const author = authors[Math.floor(Math.random() * authors.length)];
    
    news.push({
      id: `news-${i}`,
      title: `Breaking: New AI Prompt Technique Revolutionizes ${category.replace('-', ' ')}`,
      content: `This is a detailed news article about the latest developments in AI prompt engineering. The content discusses new techniques, tools, and best practices that are transforming how we interact with artificial intelligence. This breakthrough promises to make AI more accessible and effective for creators worldwide.`,
      excerpt: `Discover the latest breakthrough in AI prompt engineering that's changing how creators interact with artificial intelligence...`,
      imageUrl: `https://picsum.photos/800/400?random=${i}`,
      author: author,
      category: category,
      tags: ['ai', 'prompts', 'innovation', 'technology'],
      views: Math.floor(Math.random() * 1000),
      likes: Math.floor(Math.random() * 100),
      shares: Math.floor(Math.random() * 50),
      isBreaking: i <= 3,
      isFeatured: i <= 2,
      createdAt: new Date(Date.now() - i * 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date(Date.now() - i * 3600000).toISOString()
    });
  }
  
  return news;
}

// Initialize global mock news
global.mockNews = generateMockNews(5);

// Helper function for mock comments
function generateMockComments(count) {
  const names = ['Alex Johnson', 'Sam Wilson', 'Taylor Smith', 'Jordan Lee', 'Casey Brown'];
  const comments = [
    'Great prompt! It worked perfectly with Midjourney.',
    'Thanks for sharing this. Got some amazing results.',
    'Anyone tried this with Stable Diffusion?',
    'This prompt is a game-changer for my art projects.',
    'Perfect for creating concept art!',
    'The AI understood this prompt really well.',
    'Can we get more prompts like this?',
    'The image quality is outstanding with this prompt.',
    'Helped me create my portfolio pieces.',
    'Works great with DALL-E 3 too!',
    'Tried this with Pika for video - amazing results!',
    'Perfect for creating Instagram Reels content.',
    'The custom thumbnail looks great!'
  ];
  
  const mockComments = [];
  for (let i = 0; i < count; i++) {
    mockComments.push({
      id: `mock-comment-${i}`,
      content: comments[Math.floor(Math.random() * comments.length)],
      authorName: names[Math.floor(Math.random() * names.length)],
      promptId: 'demo-prompt',
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      likes: Math.floor(Math.random() * 20),
      isApproved: true
    });
  }
  
  return mockComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ==================== MARKETPLACE API ENDPOINTS ====================

// Get user's prompts - WITHOUT orderBy to avoid index requirement
app.get('/api/user/:userId/prompts', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (db && db.collection) {
      const snapshot = await db.collection('uploads')
        .where('userId', '==', userId)
        .limit(100)
        .get();
      
      const prompts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: safeDateToString(doc.data().createdAt)
      }));
      
      prompts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      res.json({ success: true, prompts });
    } else {
      const userPrompts = mockPrompts.filter(p => p.userId === userId || p.userName === 'Demo User');
      res.json({ success: true, prompts: userPrompts });
    }
  } catch (error) {
    console.error('Error fetching user prompts:', error);
    res.status(500).json({ error: 'Failed to fetch prompts' });
  }
});

// Get user's sales
app.get('/api/user/:userId/sales', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (db && db.collection) {
      const snapshot = await db.collection('sales')
        .where('sellerId', '==', userId)
        .limit(100)
        .get();
      
      const sales = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          promptId: data.promptId,
          promptTitle: data.promptTitle || 'Untitled Prompt',
          buyerId: data.buyerId,
          buyerName: data.buyerName || 'Anonymous',
          buyerEmail: data.buyerEmail || null,
          amount: data.amount || 0,
          sellerEarnings: data.sellerEarnings || Math.round((data.amount || 0) * 0.8),
          platformFee: data.platformFee || Math.round((data.amount || 0) * 0.2),
          date: safeDateToString(data.createdAt),
          createdAt: safeDateToString(data.createdAt),
          paymentStatus: data.paymentStatus || 'completed'
        };
      });
      
      sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      res.json({ success: true, sales });
    } else {
      const mockSales = [
        {
          promptTitle: 'Fantasy Landscape with Mountains',
          buyerName: 'Anonymous User',
          amount: 50,
          sellerEarnings: 40,
          date: new Date().toISOString()
        }
      ];
      res.json({ success: true, sales: mockSales });
    }
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Get user's purchases
app.get('/api/user/:userId/purchases', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (db && db.collection) {
      const snapshot = await db.collection('purchases')
        .where('buyerId', '==', userId)
        .limit(100)
        .get();
      
      const purchases = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          promptId: data.promptId,
          promptTitle: data.promptTitle || 'Untitled Prompt',
          promptText: data.promptText || 'No prompt text available.',
          imageUrl: data.imageUrl || 'https://via.placeholder.com/300x160/4f46e5/ffffff?text=AI+Prompt',
          thumbnailUrl: data.thumbnailUrl || null,
          fileType: data.fileType || 'image',
          amount: data.amount || 0,
          buyerName: data.buyerName || 'User',
          sellerName: data.sellerName || 'Anonymous',
          date: safeDateToString(data.createdAt),
          createdAt: safeDateToString(data.createdAt),
          paymentStatus: data.paymentStatus || 'completed'
        };
      });
      
      purchases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      res.json({ success: true, purchases });
    } else {
      const mockPurchases = [
        {
          id: 'purchase-demo-1',
          promptId: 'demo-2',
          promptTitle: 'Cyberpunk City Street',
          promptText: 'Cyberpunk city street at night, neon signs, rainy pavement, futuristic vehicles, Blade Runner style, cinematic lighting',
          imageUrl: 'https://via.placeholder.com/800x400/8f94fb/white?text=Cyberpunk+City',
          amount: 50,
          buyerName: 'You',
          sellerName: 'Demo User',
          date: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          paymentStatus: 'completed'
        },
        {
          id: 'purchase-demo-2',
          promptId: 'demo-3',
          promptTitle: 'Professional Portrait Photography',
          promptText: 'Professional portrait photography, natural lighting, soft shadows, high detail, 85mm lens, studio quality, professional model',
          imageUrl: 'https://via.placeholder.com/800x400/20bf6b/white?text=Portrait+Photo',
          amount: 30,
          buyerName: 'You',
          sellerName: 'Demo User',
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          paymentStatus: 'completed'
        }
      ];
      res.json({ success: true, purchases: mockPurchases });
    }
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ error: 'Failed to fetch purchases' });
  }
});

// Get user's earnings
app.get('/api/user/:userId/earnings', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (db && db.collection) {
      const salesSnapshot = await db.collection('sales')
        .where('sellerId', '==', userId)
        .get();
      
      const earnings = salesSnapshot.docs.map(doc => ({
        promptTitle: doc.data().promptTitle,
        buyerName: doc.data().buyerName,
        amount: doc.data().amount,
        date: safeDateToString(doc.data().createdAt)
      }));
      
      const totalEarnings = earnings.reduce((sum, e) => sum + Math.round(e.amount * 0.8), 0);
      const totalSales = earnings.length;
      
      const promptsSnapshot = await db.collection('uploads')
        .where('userId', '==', userId)
        .get();
      const totalPrompts = promptsSnapshot.size;
      
      const purchasesSnapshot = await db.collection('purchases')
        .where('buyerId', '==', userId)
        .get();
      const totalPurchases = purchasesSnapshot.size;
      
      res.json({
        success: true,
        earnings,
        totalEarnings,
        totalSales,
        totalPrompts,
        totalPurchases
      });
    } else {
      const mockEarnings = [
        {
          promptTitle: 'Fantasy Landscape with Mountains',
          buyerName: 'Anonymous User',
          amount: 50,
          date: new Date().toISOString()
        }
      ];
      res.json({
        success: true,
        earnings: mockEarnings,
        totalEarnings: 40,
        totalSales: 1,
        totalPrompts: 3,
        totalPurchases: 1
      });
    }
  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ error: 'Failed to fetch earnings' });
  }
});

// Check if user has purchased a prompt
app.get('/api/check-purchase/:promptId', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    const userId = req.query.userId;
    
    if (!userId) {
      return res.json({ purchased: false });
    }
    
    if (db && db.collection) {
      const purchaseSnapshot = await db.collection('purchases')
        .where('promptId', '==', promptId)
        .where('buyerId', '==', userId)
        .limit(1)
        .get();
      
      res.json({ purchased: !purchaseSnapshot.empty });
    } else {
      res.json({ purchased: false });
    }
  } catch (error) {
    console.error('Error checking purchase:', error);
    res.json({ purchased: false });
  }
});

// Complete purchase after successful payment
app.post('/api/complete-purchase', async (req, res) => {
    try {
        const { promptId, userId, userEmail, amount, paymentId } = req.body;
        
        if (!promptId || !userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const result = await completePurchaseHelper(promptId, userId, userEmail, amount, paymentId);
        res.json(result);
        
    } catch (error) {
        console.error('Purchase completion error:', error);
        res.status(500).json({ 
            error: 'Failed to complete purchase',
            details: error.message 
        });
    }
});

// ==================== ADMIN CONFIGURATION ====================
const ADMIN_EMAILS = ['shaikhmujahid771@gmail.com', 'mujjuchatbot@gmail.com'];

// ==================== OWNER / ADMIN ENDPOINTS ====================

// Middleware to check if user is admin
async function isAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No token provided for admin check');
      return res.status(401).json({ error: 'No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!adminInitialized || !admin.auth) {
      console.log('Firebase Admin not initialized, using mock admin');
      if (process.env.NODE_ENV === 'development') {
        req.user = { email: 'shaikhmujahid771@gmail.com', uid: 'test-user' };
        return next();
      }
      return res.status(403).json({ error: 'Admin authentication not configured' });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    console.log('Admin check for email:', email);
    
    if (ADMIN_EMAILS.includes(email)) {
      req.user = decodedToken;
      console.log('Admin access granted for:', email);
      next();
    } else {
      console.log('Admin access denied for:', email);
      res.status(403).json({ error: 'Unauthorized - Admin access required' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(401).json({ error: 'Authentication failed: ' + error.message });
  }
}

// Get all sellers with their info and earnings
app.get('/api/owner/sellers', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    if (!adminInitialized || !admin.auth) {
      throw new Error('Admin not initialized');
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
  
  try {
    let sellers = [];

    if (db && db.collection) {
      const sellersSnapshot = await db.collection('sellerInfo').get();
      for (const doc of sellersSnapshot.docs) {
        const sellerData = doc.data();
        const userId = doc.id;

        let totalEarnings = 0;
        const salesSnapshot = await db.collection('sales').where('sellerId', '==', userId).get();
        totalEarnings = salesSnapshot.docs.reduce((sum, d) => sum + (d.data().sellerEarnings || 0), 0);

        let totalPaidOut = 0;
        const payoutsSnapshot = await db.collection('payouts').where('sellerId', '==', userId).get();
        totalPaidOut = payoutsSnapshot.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

        sellers.push({
          userId,
          ...sellerData,
          totalEarnings,
          totalPaidOut,
          availableBalance: totalEarnings - totalPaidOut
        });
      }
    } else {
      sellers = [
        {
          userId: 'demo-seller-1',
          name: 'Demo Seller',
          email: 'seller@example.com',
          upiId: 'seller@okhdfcbank',
          bankAccount: '1234567890',
          bankIfsc: 'HDFC0001234',
          bankName: 'HDFC Bank',
          status: 'approved',
          totalEarnings: 800,
          totalPaidOut: 500,
          availableBalance: 300,
          createdAt: new Date().toISOString()
        }
      ];
    }

    res.json({ success: true, sellers });
  } catch (error) {
    console.error('Error fetching sellers:', error);
    res.status(500).json({ error: 'Failed to fetch sellers: ' + error.message });
  }
});

// Get all sales
app.get('/api/owner/sales', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    if (!adminInitialized || !admin.auth) {
      throw new Error('Admin not initialized');
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
  
  try {
    let sales = [];

    if (db && db.collection) {
      const snapshot = await db.collection('sales')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      sales = [
        {
          id: 'sale-1',
          promptTitle: 'Fantasy Landscape',
          buyerName: 'User1',
          sellerName: 'Demo Seller',
          amount: 50,
          sellerEarnings: 40,
          createdAt: new Date().toISOString()
        }
      ];
    }

    res.json({ success: true, sales });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales: ' + error.message });
  }
});

// Get all purchases
app.get('/api/owner/purchases', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    if (!adminInitialized || !admin.auth) {
      throw new Error('Admin not initialized');
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
  
  try {
    let purchases = [];

    if (db && db.collection) {
      const snapshot = await db.collection('purchases')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();
      purchases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      purchases = [
        {
          id: 'purchase-1',
          promptTitle: 'Cyberpunk City',
          buyerName: 'User2',
          sellerName: 'Demo Seller',
          amount: 50,
          createdAt: new Date().toISOString()
        }
      ];
    }

    res.json({ success: true, purchases });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ error: 'Failed to fetch purchases: ' + error.message });
  }
});

// Get all pending payouts
app.get('/api/owner/pending-payouts', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    if (!adminInitialized || !admin.auth) {
      throw new Error('Admin not initialized');
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
  
  try {
    let payouts = [];

    if (db && db.collection) {
      const snapshot = await db.collection('payouts')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .get();
      payouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`Found ${payouts.length} pending payouts`);
    } else {
      payouts = (global.payouts || []).filter(p => p.status === 'pending');
    }

    res.json({ success: true, payouts });
  } catch (error) {
    console.error('Error fetching pending payouts:', error);
    res.status(500).json({ error: 'Failed to fetch pending payouts: ' + error.message });
  }
});

// Mark payout as paid
app.post('/api/owner/payout/:payoutId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    if (!adminInitialized || !admin.auth) {
      throw new Error('Admin not initialized');
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
  
  try {
    const payoutId = req.params.payoutId;
    const { transactionId, notes } = req.body;

    if (db && db.collection) {
      await db.collection('payouts').doc(payoutId).update({
        status: 'paid',
        paidAt: new Date().toISOString(),
        transactionId: transactionId || null,
        notes: notes || null,
        updatedAt: new Date().toISOString()
      });
      console.log(`Payout ${payoutId} marked as paid`);
    } else {
      const payout = global.payouts?.find(p => p.id === payoutId);
      if (payout) {
        payout.status = 'paid';
        payout.paidAt = new Date().toISOString();
        payout.transactionId = transactionId;
        console.log(`Demo: Payout ${payoutId} marked as paid`);
      }
    }

    res.json({ success: true, message: 'Payout marked as paid' });
  } catch (error) {
    console.error('Error updating payout:', error);
    res.status(500).json({ error: 'Failed to update payout: ' + error.message });
  }
});

// Check if current user is admin
app.get('/api/check-admin', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.json({ isAdmin: false });
        }
        
        if (!adminInitialized || !admin.auth) {
            return res.json({ isAdmin: true });
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email;
        const isAdmin = ADMIN_EMAILS.includes(email);
        res.json({ isAdmin });
    } catch (error) {
        console.error('Admin check error:', error);
        res.json({ isAdmin: false });
    }
});

// ==================== AFFILIATE PROGRAM (PER-USER) ====================

// Get all affiliates (public) or filtered by userId
app.get('/api/affiliates', async (req, res) => {
  try {
    const userId = req.query.userId;
    let affiliates = [];
    
    if (db && db.collection) {
      let query = db.collection('affiliates').orderBy('addedAt', 'desc');
      if (userId) {
        query = query.where('userId', '==', userId);
      }
      const snapshot = await query.get();
      affiliates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      affiliates = global.affiliates || [];
      if (userId) {
        affiliates = affiliates.filter(a => a.userId === userId);
      }
    }
    res.json({ success: true, affiliates });
  } catch (error) {
    console.error('Error fetching affiliates:', error);
    res.status(500).json({ error: 'Failed to fetch affiliates' });
  }
});

// Add affiliate (any logged-in user)
app.post('/api/affiliates', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    let userId;
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (e) {
      // In development, allow mock user
      if (!adminInitialized) {
        userId = 'mock-user-' + Date.now();
      } else {
        throw e;
      }
    }
    
    const { url, title, image, description } = req.body;
    if (!url || !title) {
      return res.status(400).json({ error: 'URL and title are required' });
    }
    
    const affiliateData = {
      userId,
      url,
      title,
      image: image || '',
      description: description || '',
      addedAt: new Date().toISOString()
    };
    let id;
    if (db && db.collection) {
      const docRef = await db.collection('affiliates').add(affiliateData);
      id = docRef.id;
    } else {
      if (!global.affiliates) global.affiliates = [];
      const newAffiliate = { id: 'aff-' + Date.now(), ...affiliateData };
      global.affiliates.push(newAffiliate);
      id = newAffiliate.id;
    }
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error adding affiliate:', error);
    res.status(500).json({ error: 'Failed to add affiliate: ' + error.message });
  }
});

// Delete affiliate (only if it belongs to the logged-in user or admin)
app.delete('/api/affiliates/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    let userId;
    let isAdminUser = false;
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
      isAdminUser = ADMIN_EMAILS.includes(decodedToken.email);
    } catch (e) {
      if (!adminInitialized) {
        userId = 'mock-user';
      } else {
        throw e;
      }
    }
    
    const id = req.params.id;
    let affiliate;
    if (db && db.collection) {
      const doc = await db.collection('affiliates').doc(id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Affiliate not found' });
      affiliate = doc.data();
    } else {
      affiliate = (global.affiliates || []).find(a => a.id === id);
      if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });
    }
    
    if (affiliate.userId !== userId && !isAdminUser) {
      return res.status(403).json({ error: 'You can only delete your own affiliates' });
    }
    
    if (db && db.collection) {
      await db.collection('affiliates').doc(id).delete();
    } else {
      global.affiliates = (global.affiliates || []).filter(a => a.id !== id);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting affiliate:', error);
    res.status(500).json({ error: 'Failed to delete affiliate: ' + error.message });
  }
});

// 🔥 FIXED: Helper to get affiliates for a specific user (shuffled)
async function getAffiliatesByUser(userId, count = 3) {
  // ✅ Return early if userId is missing
  if (!userId) {
    return [];
  }

  let affiliates = [];
  if (db && db.collection) {
    const snapshot = await db.collection('affiliates')
      .where('userId', '==', userId)
      .get();
    affiliates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } else {
    affiliates = (global.affiliates || []).filter(a => a.userId === userId);
  }
  // Shuffle and return requested count
  const shuffled = affiliates.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// ==================== SELLER INFO & PAYOUT ENDPOINTS ====================

// Save seller information
app.post('/api/seller-info', async (req, res) => {
  try {
    const { userId, name, email, upiId, bankAccount, bankIfsc, bankName, pan } = req.body;
    if (!userId || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const sellerData = sanitizeFirestoreData({
      userId,
      name,
      email,
      upiId: upiId || null,
      bankAccount: bankAccount || null,
      bankIfsc: bankIfsc || null,
      bankName: bankName || null,
      pan: pan || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (db && db.collection) {
      await db.collection('sellerInfo').doc(userId).set(sellerData, { merge: true });
      console.log(`✅ Seller info saved for user: ${userId}`);
      res.json({ success: true, message: 'Seller info submitted successfully' });
    } else {
      if (!global.sellerInfo) global.sellerInfo = {};
      global.sellerInfo[userId] = sellerData;
      res.json({ success: true, message: 'Seller info saved (demo)' });
    }
  } catch (error) {
    console.error('Error saving seller info:', error);
    res.status(500).json({ error: 'Failed to save seller info' });
  }
});

// Get seller info for a user
app.get('/api/seller-info/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    let sellerInfo = null;

    if (db && db.collection) {
      const doc = await db.collection('sellerInfo').doc(userId).get();
      if (doc.exists) sellerInfo = doc.data();
    } else {
      sellerInfo = global.sellerInfo?.[userId] || null;
    }

    res.json({ success: true, sellerInfo });
  } catch (error) {
    console.error('Error fetching seller info:', error);
    res.status(500).json({ error: 'Failed to fetch seller info' });
  }
});

// Request a payout
app.post('/api/request-payout', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount || amount < 100) {
      return res.status(400).json({ error: 'Invalid payout request' });
    }

    let sellerInfo = null;
    if (db && db.collection) {
      const doc = await db.collection('sellerInfo').doc(userId).get();
      if (doc.exists) sellerInfo = doc.data();
    } else {
      sellerInfo = global.sellerInfo?.[userId] || null;
    }
    if (!sellerInfo) {
      return res.status(400).json({ error: 'Please complete seller information first' });
    }

    let totalEarnings = 0;
    let totalPaidOut = 0;

    if (db && db.collection) {
      const salesSnapshot = await db.collection('sales').where('sellerId', '==', userId).get();
      totalEarnings = salesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().sellerEarnings || 0), 0);

      const payoutsSnapshot = await db.collection('payouts').where('sellerId', '==', userId).get();
      totalPaidOut = payoutsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
    } else {
      totalEarnings = 500;
      totalPaidOut = 0;
    }

    const available = totalEarnings - totalPaidOut;
    if (available < amount) {
      return res.status(400).json({ error: `Insufficient balance. Available: ₹${available}` });
    }

    const payoutRequest = sanitizeFirestoreData({
      sellerId: userId,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (db && db.collection) {
      await db.collection('payouts').add(payoutRequest);
      console.log(`✅ Payout request created for user ${userId}: ₹${amount}`);
    } else {
      if (!global.payouts) global.payouts = [];
      global.payouts.push({ id: 'mock-' + Date.now(), ...payoutRequest });
    }

    res.json({ success: true, message: 'Payout request submitted' });
  } catch (error) {
    console.error('Error requesting payout:', error);
    res.status(500).json({ error: 'Failed to request payout' });
  }
});

// Get payout history for a user
app.get('/api/user/:userId/payouts', async (req, res) => {
  try {
    const userId = req.params.userId;
    let payouts = [];

    if (db && db.collection) {
      const snapshot = await db.collection('payouts')
        .where('sellerId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      payouts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      payouts = (global.payouts || []).filter(p => p.sellerId === userId);
    }

    res.json({ success: true, payouts });
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// Delete prompt
app.delete('/api/prompt/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (db && db.collection) {
      const promptDoc = await db.collection('uploads').doc(promptId).get();
      
      if (!promptDoc.exists) {
        return res.status(404).json({ error: 'Prompt not found' });
      }
      
      const promptData = promptDoc.data();
      
      if (promptData.userId !== userId && promptData.userId !== 'anonymous') {
        return res.status(403).json({ error: 'You do not have permission to delete this prompt' });
      }
      
      await db.collection('uploads').doc(promptId).delete();
      
      cache.del(`prompt-${promptId}`);
      cache.del(`uploads-page-1`);
      
      res.json({ success: true, message: 'Prompt deleted successfully' });
    } else {
      const index = mockPrompts.findIndex(p => p.id === promptId);
      if (index !== -1) {
        mockPrompts.splice(index, 1);
      }
      res.json({ success: true, message: 'Prompt deleted successfully' });
    }
  } catch (error) {
    console.error('Delete prompt error:', error);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'tools prompt API',
    mode: db ? 'production' : 'development',
    storage: 'Cloudflare R2 (zero egress)',
    cacheStats: cache.getStats(),
    adsense: {
      enabled: true,
      clientId: process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'
    },
    adsterra: {
      enabled: true,
      nativeAd: 'aca55beb03e2d8b514ae3f122920bdf0',
      desktopBanner: '8719e4636a7c41462203d84e956177c4',
      mobileBanner: '37e3a123e9b664f6f0b0efed6c7ee71f'
    },
    features: {
      comments: true,
      news: true,
      caching: true,
      miniBrowser: true,
      videoUploads: true,
      youtubeShorts: true,
      customThumbnails: true,
      marketplace: true,
      downloadAppButton: true,
      affiliateProgram: true,
      socialFeed: true,
      liveChat: true
    },
    uploadLimits: {
      maxFileSize: '100MB',
      allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      allowedVideoTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/ogg'],
      maxVideoDuration: '60 seconds (recommended for reels)',
      thumbnailSupport: true,
      thumbnailMaxSize: '5MB'
    },
    aiModels: {
      photo: AIModelManager.getPhotoModelCount(),
      video: AIModelManager.getVideoModelCount(),
      total: AIModelManager.getPhotoModelCount() + AIModelManager.getVideoModelCount()
    }
  });
});

// Video streaming endpoint - NOW REDIRECTS TO R2
app.get('/api/video/:videoId', async (req, res) => {
  try {
    const videoId = req.params.videoId;
    
    let promptData;
    if (db && db.collection) {
      const doc = await db.collection('uploads').doc(videoId).get();
      if (doc.exists) {
        promptData = doc.data();
      }
    } else {
      promptData = mockPrompts.find(p => p.id === videoId);
    }
    
    if (!promptData) return res.status(404).send('Video not found');

    const videoUrl = promptData.videoUrl || promptData.mediaUrl;
    // If it's an R2 URL, redirect to it (no server streaming)
    if (videoUrl && videoUrl.includes('r2.dev')) {
      return res.redirect(videoUrl);
    }

    // Fallback: if the URL is still Firebase, we can’t stream it via R2,
    // so we return a 404 (or you can keep the old streaming logic for migration)
    // But since we are migrating, we will serve a placeholder.
    res.status(404).send('Video not available on R2. Please re-upload.');
  } catch (error) {
    console.error('Video streaming error:', error);
    res.status(500).send('Error streaming video');
  }
});

// Thumbnail endpoint - REDIRECT TO R2
app.get('/api/thumbnail/:promptId', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    
    if (db && db.collection) {
      const doc = await db.collection('uploads').doc(promptId).get();
      if (doc.exists) {
        const data = doc.data();
        const thumbnailUrl = data.thumbnailUrl || data.imageUrl;
        if (thumbnailUrl && thumbnailUrl.includes('r2.dev')) {
          return res.redirect(thumbnailUrl);
        }
      }
    }
    res.redirect('https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel');
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.redirect('https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel');
  }
});

// AdSense Migration Endpoint
app.get('/admin/migrate-adsense', async (req, res) => {
  try {
    console.log('🚀 Starting AdSense migration via admin endpoint...');
    
    const migratedCount = await migrateExistingPromptsForAdSense();
    
    res.json({
      success: true,
      message: `🎉 Successfully migrated ${migratedCount} prompts for AdSense monetization`,
      migratedCount: migratedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Migration endpoint error:', error);
    res.status(500).json({ 
      error: 'Migration failed', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Dynamic Robots.txt
app.get('/robots.txt', (req, res) => {
  const domain = req.get('host');
  
  let protocol = 'https';
  if (req.secure) {
    protocol = 'https';
  } else if (req.headers['x-forwarded-proto'] === 'https') {
    protocol = 'https';
  } else if (domain.includes('toolsprompt.com')) {
    protocol = 'https';
  } else {
    protocol = req.protocol;
  }
  
  const currentBaseUrl = `${protocol}://${domain}`;
  
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/

Sitemap: https://www.toolsprompt.com/sitemap.xml
Sitemap: https://www.toolsprompt.com/sitemap-posts.xml
Sitemap: https://www.toolsprompt.com/sitemap-news.xml
Sitemap: https://www.toolsprompt.com/sitemap-pages.xml`;

  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(robotsTxt);
});

// Dynamic Sitemap Index
app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-pages.xml</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${baseUrl}/sitemap-posts.xml</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${baseUrl}/sitemap-news.xml</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </sitemap>
</sitemapindex>`;

    res.set('Content-Type', 'application/xml');
    res.send(sitemapIndex);
    
  } catch (error) {
    console.error('❌ Sitemap index error:', error);
    res.status(500).send('Error generating sitemap');
  }
});

// Pages Sitemap
app.get('/sitemap-pages.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    
    const pages = [
      { loc: baseUrl + '/', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '1.0' },
      { loc: baseUrl + '/index.html', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '0.9' },
      { loc: baseUrl + '/promptconverter.html', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '0.8' },
      { loc: baseUrl + '/howitworks.html', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '0.8' },
      { loc: baseUrl + '/login.html', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '0.5' },
      { loc: baseUrl + '/dashboard.html', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '0.7' }
    ];

    const sitemap = SitemapGenerator.generateSitemap(pages);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
    
  } catch (error) {
    console.error('❌ Pages sitemap error:', error);
    res.status(500).send('Error generating pages sitemap');
  }
});

// Posts Sitemap
app.get('/sitemap-posts.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    let prompts = [];

    if (db) {
      const snapshot = await db.collection('uploads')
        .orderBy('updatedAt', 'desc')
        .limit(1500)
        .get();

      prompts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          updatedAt: safeDateToString(data.updatedAt),
          createdAt: safeDateToString(data.createdAt)
        };
      });
    } else {
      prompts = mockPrompts;
    }

    const urls = prompts.map(prompt => ({
      loc: `${baseUrl}/prompt/${prompt.id}`,
      lastmod: prompt.updatedAt && prompt.updatedAt !== prompt.createdAt ? prompt.updatedAt : prompt.createdAt,
      changefreq: 'weekly',
      priority: '0.8'
    }));

    const sitemap = SitemapGenerator.generateSitemap(urls);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
    
  } catch (error) {
    console.error('❌ Posts sitemap error:', error);
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const fallbackUrls = [{ loc: baseUrl + '/', lastmod: new Date().toISOString(), changefreq: 'daily', priority: '1.0' }];
    const sitemap = SitemapGenerator.generateSitemap(fallbackUrls);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
  }
});

// News Sitemap
app.get('/sitemap-news.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    let news = [];

    if (db && db.collection) {
      const snapshot = await db.collection('news')
        .orderBy('publishedAt', 'desc')
        .limit(500)
        .get();

      news = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          updatedAt: safeDateToString(data.updatedAt)
        };
      });
    } else {
      news = global.mockNews;
    }

    const newsUrls = news.map(newsItem => ({
      loc: `${baseUrl}/news/${newsItem.id}`,
      lastmod: newsItem.updatedAt || newsItem.publishedAt || new Date().toISOString(),
      title: newsItem.title
    }));

    const sitemap = SitemapGenerator.generateNewsSitemap(newsUrls);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
    
  } catch (error) {
    console.error('❌ News sitemap error:', error);
    res.status(500).send('Error generating news sitemap');
  }
});

// ==================== UPLOAD ENDPOINT (REWRITTEN FOR R2) ====================
app.post('/api/upload', async (req, res) => {
  console.log('📤 Upload request received');
  const busboy = Busboy({ headers: req.headers, limits: { fileSize: 100 * 1024 * 1024 } });
  const fields = {};
  let mediaBuffer = null, thumbnailBuffer = null;
  let uploadedMediaFileName = null, uploadedThumbnailFileName = null;
  let mediaFileType = null, thumbnailFileType = null;
  let uploadError = null;

  busboy.on('field', (fieldname, val) => { fields[fieldname] = val; });

  busboy.on('file', (fieldname, file, info) => {
    const { filename, mimeType } = info;
    if (fieldname === 'media') {
      uploadedMediaFileName = filename;
      mediaFileType = mimeType;
      const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
      const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];
      if (!allowedTypes.includes(mimeType)) {
        uploadError = new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM');
        return;
      }
      const chunks = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        mediaBuffer = Buffer.concat(chunks);
        if (mediaBuffer.length > 100 * 1024 * 1024) uploadError = new Error('File size exceeds 100MB limit');
      });
    } else if (fieldname === 'thumbnail') {
      uploadedThumbnailFileName = filename;
      thumbnailFileType = mimeType;
      const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedImageTypes.includes(mimeType)) {
        uploadError = new Error('Invalid thumbnail file type. Allowed: JPEG, PNG, WebP');
        return;
      }
      const chunks = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        thumbnailBuffer = Buffer.concat(chunks);
        if (thumbnailBuffer.length > 5 * 1024 * 1024) uploadError = new Error('Thumbnail size exceeds 5MB limit');
      });
    }
  });

  busboy.on('finish', async () => {
    try {
      if (uploadError) return res.status(400).json({ error: uploadError.message });
      if (!fields.title || !fields.promptText) return res.status(400).json({ error: 'Title and prompt text are required' });
      if (!mediaBuffer) return res.status(400).json({ error: 'No media file provided' });

      const isVideo = mediaFileType.startsWith('video/');
      const isImage = mediaFileType.startsWith('image/');
      if (!isVideo && !isImage) return res.status(400).json({ error: 'File must be an image or video' });

      // ===== UPLOAD TO R2 =====
      const timestamp = Date.now();
      const uniqueId = uuidv4();
      const mediaExtension = uploadedMediaFileName.split('.').pop();
      const mediaFolder = isVideo ? 'videos' : 'prompts';
      const mediaKey = `${mediaFolder}/${timestamp}-${uniqueId}.${mediaExtension}`;

      const mediaUrl = await uploadToR2(mediaBuffer, mediaKey, mediaFileType);

      let thumbnailUrl = null;
      if (thumbnailBuffer) {
        const thumbExtension = uploadedThumbnailFileName.split('.').pop();
        const thumbKey = `thumbnails/${timestamp}-${uniqueId}.${thumbExtension}`;
        thumbnailUrl = await uploadToR2(thumbnailBuffer, thumbKey, thumbnailFileType);
      }

      // ===== If no thumbnail, use a placeholder for videos =====
      if (isVideo && !thumbnailUrl) {
        thumbnailUrl = 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel';
      }

      // ===== Save to Firestore (same as before) =====
      let category = fields.category || 'general';
      if (!fields.category) category = isVideo ? 'video' : 'general';

      const seoTitle = SEOOptimizer.generateSEOTitle(fields.title);
      const metaDescription = SEOOptimizer.generateMetaDescription(fields.promptText, fields.title);
      const keywords = SEOOptimizer.extractKeywords(fields.title + ' ' + fields.promptText);
      const slug = SEOOptimizer.generateSlug(fields.title);

      const detectedPlatform = AIModelManager.detectPlatform({
        promptText: fields.promptText,
        title: fields.title,
        keywords: keywords,
        category: category,
        fileType: isVideo ? 'video' : 'image'
      });

      let price = parseFloat(fields.price) || 0;
      if (!price && fields.promptPrice) price = parseFloat(fields.promptPrice) || 0;
      const isPaid = fields.isPaid === 'true' || price > 0;

      const aboutDescription = fields.aboutDescription || '';

      const promptData = {
        title: fields.title,
        promptText: fields.promptText,
        mediaUrl: mediaUrl,
        imageUrl: isImage ? mediaUrl : (thumbnailUrl || 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel'),
        thumbnailUrl: thumbnailUrl,
        videoUrl: isVideo ? mediaUrl : null,
        fileType: isVideo ? 'video' : 'image',
        category: category,
        userName: fields.userName || 'Anonymous User',
        userId: fields.userId || 'anonymous',
        likes: 0,
        views: 0,
        uses: 0,
        copies: 0,
        commentCount: 0,
        keywords: keywords,
        seoTitle: seoTitle,
        metaDescription: metaDescription,
        slug: slug,
        seoScore: Math.floor(Math.random() * 30) + 70,
        adsenseMigrated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        detectedPlatform: detectedPlatform,
        price: price,
        isPaid: isPaid,
        salesCount: 0,
        totalEarnings: 0,
        purchasedBy: [],
        aboutDescription: aboutDescription
      };

      if (isVideo) {
        promptData.videoDuration = null;
        promptData.videoFormat = mediaFileType.split('/')[1];
        promptData.isReel = true;
        promptData.hasCustomThumbnail = !!thumbnailBuffer;
      }

      let docRef;
      if (db && db.collection) {
        docRef = await db.collection('uploads').add(promptData);
      } else {
        docRef = { id: 'demo-' + Date.now() };
        mockPrompts.unshift({ id: docRef.id, ...promptData });
      }

      const priceMessage = isPaid ? ` with price ₹${price}` : ' as free';
      res.json({
        success: true,
        upload: { id: docRef.id, ...promptData },
        message: isVideo ? `🎬 Video reel uploaded successfully${priceMessage}!` : `✅ Image uploaded successfully${priceMessage}!`,
        fileType: isVideo ? 'video' : 'image',
        detectedPlatform: detectedPlatform
      });

      // ==================== ACTIVITY FEED ENTRY ====================
      const activity = {
        id: uuidv4(),
        type: 'upload',
        promptId: docRef.id,
        title: fields.title,
        userName: fields.userName || 'Anonymous',
        timestamp: new Date().toISOString()
      };
      if (db && db.collection) {
        await db.collection('activity_feed').doc(activity.id).set(activity);
        broadcastActivity(activity);
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      res.status(500).json({ error: 'Upload failed', details: error.message });
    }
  });
  req.pipe(busboy);
});

app.get('/api/prompt/:id/text', async (req, res) => {
  try {
    const promptId = req.params.id;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    let promptData;
    if (db && db.collection) {
      const doc = await db.collection('uploads').doc(promptId).get();
      if (!doc.exists) return res.status(404).json({ error: 'Prompt not found' });
      promptData = doc.data();
    } else {
      promptData = mockPrompts.find(p => p.id === promptId);
      if (!promptData) return res.status(404).json({ error: 'Prompt not found' });
    }

    const isPaid = promptData.price > 0;
    if (isPaid) {
      const purchaseQuery = await db.collection('purchases')
        .where('promptId', '==', promptId)
        .where('buyerId', '==', userId)
        .limit(1)
        .get();
      if (purchaseQuery.empty) {
        return res.status(403).json({ error: 'Not purchased' });
      }
    }

    res.json({ promptText: promptData.promptText });
  } catch (error) {
    console.error('Error fetching prompt text:', error);
    res.status(500).json({ error: 'Failed to fetch prompt text' });
  }
});

// Get news articles
app.get('/api/news', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const category = req.query.category;
    
    const cacheKey = `news-${page}-${limit}-${category || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let news = [];

    if (db && db.collection) {
      let query = db.collection('news')
        .orderBy('publishedAt', 'desc')
        .limit(500);
      
      if (category && category !== 'all') {
        query = query.where('category', '==', category);
      }

      const snapshot = await query.get();
      news = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        newsUrl: `/news/${doc.id}`
      }));
    } else {
      news = global.mockNews;
      
      if (category && category !== 'all') {
        news = news.filter(item => item.category === category);
      }
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedNews = news.slice(startIndex, endIndex);

    const result = {
      news: paginatedNews,
      currentPage: page,
      totalPages: Math.ceil(news.length / limit),
      totalCount: news.length,
      hasMore: endIndex < news.length
    };

    cache.set(cacheKey, result, 1200);
    
    res.json(result);

  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Individual news page
app.get('/news/:id', async (req, res) => {
  try {
    const newsId = req.params.id;
    
    const cacheKey = `news-${newsId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.set('Content-Type', 'text/html').send(cached);
    }

    let newsData;

    if (db && db.collection) {
      const doc = await db.collection('news').doc(newsId).get();
      
      if (!doc.exists) {
        return sendNewsNotFound(res, newsId);
      }

      const news = doc.data();
      newsData = createNewsData(news, doc.id);
      
      const shouldUpdateView = Math.random() < 0.3;
      if (shouldUpdateView) {
        await db.collection('news').doc(newsId).update({
          views: (news.views || 0) + 1,
          updatedAt: new Date().toISOString()
        });
      }
    } else {
      const mockNews = global.mockNews.find(n => n.id === newsId) || global.mockNews[0];
      newsData = createNewsData(mockNews, newsId);
    }

    const html = generateNewsHTML(newsData);
    
    cache.set(cacheKey, html, 1200);
    
    res.set('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('❌ Error serving news page:', error);
    sendNewsErrorPage(res, error);
  }
});

// COMMENT SYSTEM API ENDPOINTS - MOCK ONLY, NO FIRESTORE

// Get comments for a prompt (mock)
app.get('/api/prompt/:id/comments', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Return mock empty comments - no Firestore
    res.json({
      comments: [],
      currentPage: page,
      totalPages: 0,
      totalCount: 0,
      hasMore: false
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Post a new comment (mock only)
app.post('/api/prompt/:id/comments', async (req, res) => {
  try {
    const { content, authorName, authorEmail } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Comment is too long (max 1000 characters)' });
    }
    
    // Mock response - no database
    res.json({
      success: true,
      comment: {
        id: 'mock-comment-' + Date.now(),
        content: content.trim(),
        authorName: authorName?.trim() || 'Anonymous',
        authorEmail: authorEmail?.trim() || null,
        createdAt: new Date().toISOString(),
        likes: 0
      },
      message: 'Comment posted successfully (mock)'
    });
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// Like a comment (mock only)
app.post('/api/comment/:commentId/like', async (req, res) => {
  try {
    // Mock response - no database
    res.json({ success: true, message: 'Comment liked (mock)' });
  } catch (error) {
    console.error('Error liking comment:', error);
    res.status(500).json({ error: 'Failed to like comment' });
  }
});

// Engagement API Endpoints - MOCK ONLY, NO FIRESTORE

// Track view count (mock)
app.post('/api/prompt/:id/view', async (req, res) => {
  res.json({ success: true, message: 'View counted (mock)' });
});

// Like/Unlike prompt (mock)
app.post('/api/prompt/:id/like', async (req, res) => {
  const { action } = req.body;
  res.json({ success: true, action });
});

// Track prompt use (mock)
app.post('/api/prompt/:id/use', async (req, res) => {
  res.json({ success: true, message: 'Use counted (mock)' });
});

// Track prompt copy actions (mock)
app.post('/api/prompt/:id/copy', async (req, res) => {
  res.json({ success: true, message: 'Copy tracked (mock)' });
});

// Get user engagement status (mock)
app.get('/api/prompt/:id/user-engagement', async (req, res) => {
  res.json({ userLiked: false, userUsed: false, userCopied: false });
});

// Engagement Analytics API Endpoint (mock)
app.get('/api/prompt/:id/engagement', async (req, res) => {
  const engagement = await EngagementAnalytics.getPromptEngagement(req.params.id, db);
  res.json(engagement);
});

// Search API endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { q: query, category, sort, page = 1, limit = 12 } = req.query;
    
    const cacheKey = `search-${query || 'all'}-${category || 'all'}-${page}-${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    let prompts = [];

    if (db && db.collection) {
      const snapshot = await db.collection('uploads')
        .limit(500)
        .get();
      
      prompts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: safeDateToString(data.createdAt),
          promptUrl: `/prompt/${doc.id}`,
          fileType: data.fileType || 'image',
          isVideo: data.fileType === 'video' || data.videoUrl || data.category === 'video',
          price: data.price || 0,
          isPaid: data.price > 0
        };
      }).filter(prompt => {
        if (!query) return true;
        
        const searchTerm = query.toLowerCase();
        const title = (prompt.title || '').toLowerCase();
        const promptText = (prompt.promptText || '').toLowerCase();
        const keywords = prompt.keywords || [];
        
        return title.includes(searchTerm) ||
               promptText.includes(searchTerm) ||
               keywords.some(keyword => 
                 keyword.toLowerCase().includes(searchTerm)
               );
      });
    } else {
      prompts = mockPrompts.filter(prompt => {
        let matches = true;
        
        if (query) {
          const searchTerm = query.toLowerCase();
          const title = (prompt.title || '').toLowerCase();
          const promptText = (prompt.promptText || '').toLowerCase();
          const keywords = prompt.keywords || [];
          
          matches = matches && (
            title.includes(searchTerm) ||
            promptText.includes(searchTerm) ||
            keywords.some(keyword => keyword.toLowerCase().includes(searchTerm))
          );
        }
        
        if (category && category !== 'all') {
          matches = matches && prompt.category === category;
        }
        
        return matches;
      });
    }
    
    prompts = sortPrompts(prompts, sort);
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedPrompts = prompts.slice(startIndex, endIndex);
    
    const result = {
      prompts: paginatedPrompts,
      totalCount: prompts.length,
      currentPage: parseInt(page),
      totalPages: Math.ceil(prompts.length / limit),
      hasMore: endIndex < prompts.length,
      counts: {
        images: prompts.filter(p => !p.isVideo && p.fileType !== 'video').length,
        videos: prompts.filter(p => p.isVideo || p.fileType === 'video').length
      }
    };
    
    cache.set(cacheKey, result, 1200);
    
    res.json(result);
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed', 
      details: error.message 
    });
  }
});

// Helper function for sorting
function sortPrompts(prompts, sortBy) {
  const sorted = [...prompts];
  
  switch (sortBy) {
    case 'popular':
      return sorted.sort((a, b) => {
        const aScore = (a.likes || 0) + (a.views || 0) + (a.copies || 0) + (a.commentCount || 0);
        const bScore = (b.likes || 0) + (b.views || 0) + (b.copies || 0) + (b.commentCount || 0);
        return bScore - aScore;
      });
    case 'likes':
      return sorted.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    case 'views':
      return sorted.sort((a, b) => (b.views || 0) - (a.views || 0));
    case 'copies':
      return sorted.sort((a, b) => (b.copies || 0) - (a.copies || 0));
    case 'comments':
      return sorted.sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
    case 'recent':
    default:
      return sorted.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateB - dateA;
      });
  }
}

// API Routes - Get uploads with caching and limits
app.get('/api/uploads', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const type = req.query.type;
    
    const cacheKey = `uploads-page-${page}-limit-${limit}-type-${type || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    let allUploads = [];

    if (db && db.collection) {
      const snapshot = await db.collection('uploads')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();

      allUploads = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        allUploads.push({ 
          id: doc.id, 
          ...data,
          createdAt: safeDateToString(data.createdAt),
          updatedAt: safeDateToString(data.updatedAt),
          userLiked: false,
          userUsed: false,
          userCopied: false,
          promptUrl: `/prompt/${doc.id}`,
          imageUrl: data.thumbnailUrl || data.imageUrl || data.mediaUrl || 
                   (data.fileType === 'video' ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : 
                    'https://via.placeholder.com/800x400/4e54c8/ffffff?text=AI+Image'),
          fileType: data.fileType || 'image',
          isVideo: data.fileType === 'video' || data.videoUrl || data.category === 'video',
          price: data.price || 0,
          isPaid: data.price > 0
        });
      });
    } else {
      allUploads = mockPrompts.map(prompt => ({
        ...prompt,
        userLiked: false,
        userUsed: false,
        userCopied: false,
        promptUrl: `/prompt/${prompt.id}`,
        imageUrl: prompt.thumbnailUrl || prompt.imageUrl || prompt.mediaUrl || 
                 (prompt.fileType === 'video' ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : 
                  'https://via.placeholder.com/800x400/4e54c8/ffffff?text=AI+Image'),
        fileType: prompt.fileType || 'image',
        isVideo: prompt.fileType === 'video' || prompt.category === 'video',
        price: prompt.price || 0,
        isPaid: prompt.price > 0
      }));
    }

    if (type && type !== 'all') {
      allUploads = allUploads.filter(upload => upload.fileType === type);
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const uploads = allUploads.slice(startIndex, endIndex);

    const result = {
      uploads,
      currentPage: page,
      totalPages: Math.ceil(allUploads.length / limit),
      totalCount: allUploads.length,
      typeBreakdown: {
        images: allUploads.filter(u => u.fileType === 'image' || !u.fileType || u.fileType !== 'video').length,
        videos: allUploads.filter(u => u.fileType === 'video' || u.isVideo).length,
        videosWithThumbnails: allUploads.filter(u => (u.fileType === 'video' || u.isVideo) && u.hasCustomThumbnail).length
      },
      adsenseInfo: {
        migrated: allUploads.filter(u => u.adsenseMigrated).length,
        total: allUploads.length,
        percentage: Math.round((allUploads.filter(u => u.adsenseMigrated).length / allUploads.length) * 100) || 0
      },
      aiModels: {
        photo: AIModelManager.getPhotoModelCount(),
        video: AIModelManager.getVideoModelCount(),
        total: AIModelManager.getPhotoModelCount() + AIModelManager.getVideoModelCount()
      }
    };

    cache.set(cacheKey, result, 1200);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching uploads:', error);
    const result = {
      uploads: mockPrompts.slice(0, 12).map(prompt => ({
        ...prompt,
        userLiked: false,
        userUsed: false,
        userCopied: false,
        promptUrl: `/prompt/${prompt.id}`,
        imageUrl: prompt.thumbnailUrl || prompt.imageUrl || prompt.mediaUrl || 
                 (prompt.fileType === 'video' ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : 
                  'https://via.placeholder.com/800x400/4e54c8/ffffff?text=AI+Image'),
        fileType: prompt.fileType || 'image',
        isVideo: prompt.fileType === 'video' || prompt.category === 'video',
        price: prompt.price || 0,
        isPaid: prompt.price > 0
      })),
      currentPage: 1,
      totalPages: 1,
      totalCount: mockPrompts.length,
      typeBreakdown: {
        images: mockPrompts.filter(u => u.fileType === 'image' || !u.fileType || u.fileType !== 'video').length,
        videos: mockPrompts.filter(u => u.fileType === 'video' || u.category === 'video').length,
        videosWithThumbnails: mockPrompts.filter(u => (u.fileType === 'video' || u.category === 'video') && u.hasCustomThumbnail).length
      },
      adsenseInfo: {
        migrated: mockPrompts.length,
        total: mockPrompts.length,
        percentage: 100
      },
      aiModels: {
        photo: AIModelManager.getPhotoModelCount(),
        video: AIModelManager.getVideoModelCount(),
        total: AIModelManager.getPhotoModelCount() + AIModelManager.getVideoModelCount()
      }
    };
    
    res.json(result);
  }
});

// API endpoint to get list of blog posts
app.get('/api/blog-posts', (req, res) => {
    const blogDir = path.join(__dirname, 'blog');
    
    if (!fs.existsSync(blogDir)) {
        return res.json({ posts: [] });
    }
    
    try {
        const files = fs.readdirSync(blogDir);
        const htmlFiles = files.filter(file => file.endsWith('.html'));
        
        const posts = htmlFiles.map(filename => {
            const filePath = path.join(blogDir, filename);
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            
            const titleMatch = content.match(/<title>(.*?)<\/title>/);
            const title = titleMatch ? titleMatch[1] : filename.replace('.html', '');
            
            const descMatch = content.match(/<meta name="description" content="(.*?)">/);
            const description = descMatch ? descMatch[1] : 'No description available';
            
            const dateMatch = content.match(/<meta name="date" content="(.*?)">/);
            const date = dateMatch ? dateMatch[1] : stats.birthtime.toISOString().split('T')[0];
            
            const authorMatch = content.match(/<meta name="author" content="(.*?)">/);
            const author = authorMatch ? authorMatch[1] : 'Tools Prompt';
            
            const categoryMatch = content.match(/<meta name="category" content="(.*?)">/);
            const category = categoryMatch ? categoryMatch[1] : 'General';
            
            const excerptMatch = content.match(/<p>(.*?)<\/p>/);
            const excerpt = excerptMatch ? excerptMatch[1] : description;
            
            return {
                filename,
                title,
                description,
                excerpt,
                date,
                author,
                category,
                url: `/blog/${filename}`,
                modified: stats.mtime
            };
        });
        
        posts.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.json({ 
            success: true, 
            posts,
            count: posts.length
        });
        
    } catch (error) {
        console.error('Error reading blog directory:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to read blog posts',
            posts: [] 
        });
    }
});

// Serve individual blog posts
app.use('/blog', express.static(path.join(__dirname, 'blog')));

// ==================== INDIVIDUAL PROMPT PAGE ====================
app.get('/prompt/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const cacheKey = `prompt-${promptId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.set('Content-Type', 'text/html').send(cached);

    let promptData;
    let hasPurchased = false;

    const authHeader = req.headers.authorization;
    let user = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      try {
        user = await admin.auth().verifyIdToken(idToken);
      } catch (err) {
        console.log('Auth token invalid, proceeding as guest');
      }
    }

    if (db && db.collection && promptId !== 'demo-1' && promptId !== 'demo-2' && promptId !== 'demo-3' && promptId !== 'demo-video-1') {
      const doc = await db.collection('uploads').doc(promptId).get();
      if (!doc.exists) return sendPromptNotFound(res, promptId);
      const prompt = doc.data();
      if (user) {
        const purchaseQuery = await db.collection('purchases')
          .where('promptId', '==', promptId)
          .where('buyerId', '==', user.uid)
          .limit(1)
          .get();
        hasPurchased = !purchaseQuery.empty;
      }
      promptData = createPromptData(prompt, doc.id, hasPurchased);
    } else {
      const mockPrompt = mockPrompts.find(p => p.id === promptId) || mockPrompts[0];
      hasPurchased = false;
      promptData = createPromptData(mockPrompt, promptId, hasPurchased);
    }

    // ===== GET AFFILIATES FOR THIS PROMPT'S CREATOR =====
    const creatorId = promptData.userId;
    const affiliates = await getAffiliatesByUser(creatorId, 3);

    const html = generateEnhancedPromptHTML(promptData, affiliates);
    cache.set(cacheKey, html, 1200);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('❌ Error serving prompt page:', error);
    sendErrorPage(res, error);
  }
});

// Category pages for SEO
app.get('/category/:category', async (req, res) => {
  try {
    const category = req.params.category;
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    
    const cacheKey = `category-${category}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.set('Content-Type', 'text/html').send(cached);
    }
    
    const html = generateCategoryHTML(category, baseUrl);
    
    cache.set(cacheKey, html, 1200);
    
    res.set('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('❌ Error serving category page:', error);
    sendErrorPage(res, error);
  }
});

// AI Models API Endpoint
app.get('/api/ai-models', (req, res) => {
  try {
    const type = req.query.type;
    
    let response = {
      success: true,
      counts: {
        photo: AIModelManager.getPhotoModelCount(),
        video: AIModelManager.getVideoModelCount(),
        total: AIModelManager.getPhotoModelCount() + AIModelManager.getVideoModelCount()
      }
    };
    
    if (type === 'photo') {
      response.models = AIModelManager.getAllPhotoModels();
    } else if (type === 'video') {
      response.models = AIModelManager.getAllVideoModels();
    } else {
      response.photoModels = AIModelManager.getAllPhotoModels();
      response.videoModels = AIModelManager.getAllVideoModels();
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching AI models:', error);
    res.status(500).json({ error: 'Failed to fetch AI models' });
  }
});

// AI Model Info API Endpoint
app.get('/api/ai-model/:modelId', (req, res) => {
  try {
    const modelId = req.params.modelId;
    const type = req.query.type || 'auto';
    
    let modelInfo = null;
    
    if (type === 'photo' || type === 'auto') {
      modelInfo = AIModelManager.getPhotoModelInfo(modelId);
    }
    
    if (!modelInfo && (type === 'video' || type === 'auto')) {
      modelInfo = AIModelManager.getVideoModelInfo(modelId);
    }
    
    if (modelInfo) {
      res.json({
        success: true,
        model: modelInfo,
        id: modelId
      });
    } else {
      res.status(404).json({ error: 'Model not found' });
    }
  } catch (error) {
    console.error('Error fetching AI model:', error);
    res.status(500).json({ error: 'Failed to fetch AI model' });
  }
});

// ==================== CREDITS & AI GENERATION ====================

// Get user credits
app.get('/api/credits/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const creditInfo = await getUserCredits(userId);
    res.json({ success: true, ...creditInfo });
  } catch (error) {
    console.error('Error fetching credits:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const creditInfo = await getUserCredits(userId);
    if (creditInfo.credits <= 0) {
      return res.status(403).json({ error: 'Insufficient credits. Please upgrade.' });
    }

    const busboy = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
    let prompt = '';
    let imageBuffer = null;
    let imageMimeType = null;

    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'prompt') prompt = val;
    });

    busboy.on('file', (fieldname, file, info) => {
      if (fieldname === 'image') {
        const chunks = [];
        file.on('data', (data) => chunks.push(data));
        file.on('end', () => {
          imageBuffer = Buffer.concat(chunks);
          imageMimeType = info.mimeType;
        });
      }
    });

    busboy.on('finish', async () => {
      try {
        let finalPrompt = prompt.trim();
        if (!finalPrompt) {
          return res.status(400).json({ error: 'Prompt is required' });
        }

        // Optional: Use GPT-4 Vision to describe uploaded image (keep this part)
        let imageDescription = '';
        if (imageBuffer) {
          try {
            const base64Image = imageBuffer.toString('base64');
            const visionResponse = await openai.chat.completions.create({
              model: 'gpt-4-vision-preview',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this image in detail, focusing on style, composition, colors, and content. Keep it under 200 words.' },
                  { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/png'};base64,${base64Image}` } }
                ]
              }],
              max_tokens: 500,
            });
            imageDescription = visionResponse.choices[0].message.content;
            finalPrompt = `Using this image description as reference: "${imageDescription}". Now generate a new image based on this prompt: "${prompt}"`;
          } catch (visionError) {
            console.error('Vision API error:', visionError.message);
            // Continue without description if vision fails
          }
        }

        // ===== Generate image using Pollinations.ai =====
        const encodedPrompt = encodeURIComponent(finalPrompt);
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

        const response = await axios({
          method: 'get',
          url: pollinationsUrl,
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/png';
        const imageUrl = `data:${mimeType};base64,${base64Image}`;

        console.log('✅ Image generated via Pollinations.ai');

        // Deduct credit
        await deductCredit(userId);

        res.json({
          success: true,
          imageUrl,
          remainingCredits: (await getUserCredits(userId)).credits,
          prompt: finalPrompt,
          modelUsed: 'pollinations.ai (flux)'
        });
      } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message || 'Image generation failed' });
      }
    });

    req.pipe(busboy);
  } catch (error) {
    console.error('Generate image error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Top-up credits: create Razorpay order for ₹20 (50 credits)
app.post('/api/top-up-credits', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    if (!razorpay) {
      // Demo mode
      return res.json({
        success: true,
        orderId: 'order_demo_topup_' + Date.now(),
        amount: 2000, // 20 INR in paise
        currency: 'INR',
        isDemo: true,
        keyId: razorpayKeyId || 'rzp_live_SXMEZ6fYLjDmzD'
      });
    }

    const options = {
      amount: 2000, // ₹20
      currency: 'INR',
      notes: {
        userId: userId,
        type: 'credit_topup',
        credits: 50
      },
      payment_capture: 1
    };
    const order = await razorpay.orders.create(options);
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      isDemo: false,
      keyId: razorpayKeyId
    });
  } catch (error) {
    console.error('Top-up order error:', error);
    res.status(500).json({ error: 'Failed to create top-up order' });
  }
});

// Verify top-up payment
app.post('/api/verify-topup', async (req, res) => {
  try {
    const { orderId, paymentId, signature, userId } = req.body;
    if (!razorpay) {
      // Demo mode: add credits
      await addCredits(userId, 50);
      return res.json({ success: true, message: 'Added 50 credits (demo)' });
    }

    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    await addCredits(userId, 50);
    res.json({ success: true, message: 'Added 50 credits' });
  } catch (error) {
    console.error('Top-up verification error:', error);
    res.status(500).json({ error: 'Failed to verify top-up' });
  }
});

// ==================== NEW: SOCIAL FEED / CHAT / ACTIVITY ENDPOINTS ====================

// Store connected SSE clients
let chatClients = [];

// SSE stream endpoint
app.get('/api/chat/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial recent messages (last 50)
  const recentMessages = await getRecentMessages(50);
  res.write(`data: ${JSON.stringify({ type: 'init', messages: recentMessages })}\n\n`);

  // Add client to list
  const clientId = Date.now() + '-' + Math.random();
  chatClients.push({ id: clientId, res });

  // Remove client on close
  req.on('close', () => {
    chatClients = chatClients.filter(c => c.id !== clientId);
  });

  // Keep alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('end', () => clearInterval(keepAlive));
});

// Get chat messages (for initial load)
app.get('/api/chat/messages', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const messages = await getRecentMessages(limit);
  res.json({ messages });
});

// Send a chat message
app.post('/api/chat/send', async (req, res) => {
  const { userId, userName, content, parentId, sticker } = req.body;
  if (!content && !sticker) {
    return res.status(400).json({ error: 'Message content or sticker required' });
  }

  const message = {
    id: uuidv4(),
    userId: userId || 'anonymous',
    userName: userName || 'Anonymous',
    content: content || '',
    parentId: parentId || null, // for replies
    sticker: sticker || null,
    reactions: {},
    timestamp: new Date().toISOString()
  };

  // Save to Firestore
  if (db && db.collection) {
    await db.collection('chat_messages').doc(message.id).set(message);
  } else {
    // demo mode: store in memory
    if (!global.chatMessages) global.chatMessages = [];
    global.chatMessages.push(message);
  }

  // Broadcast to all clients
  broadcastChatMessage(message);

  res.json({ success: true, message });
});

// Add/update a reaction
app.post('/api/chat/react', async (req, res) => {
  const { messageId, userId, emoji } = req.body;
  if (!messageId || !emoji) {
    return res.status(400).json({ error: 'Missing messageId or emoji' });
  }

  // Update Firestore
  if (db && db.collection) {
    const msgRef = db.collection('chat_messages').doc(messageId);
    await msgRef.update({
      [`reactions.${emoji}`]: admin.firestore.FieldValue.arrayUnion(userId || 'anonymous')
    });
    const updated = await msgRef.get();
    // Broadcast updated reactions
    broadcastChatMessage({ type: 'reaction', messageId, reactions: updated.data().reactions });
  } else {
    // demo mode
    const msg = global.chatMessages?.find(m => m.id === messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      if (!msg.reactions[emoji].includes(userId || 'anonymous')) {
        msg.reactions[emoji].push(userId || 'anonymous');
      }
      broadcastChatMessage({ type: 'reaction', messageId, reactions: msg.reactions });
    }
  }

  res.json({ success: true });
});

// Get activity feed
app.get('/api/activity', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const items = await getRecentActivity(limit);
  res.json({ items });
});

// ===== Helper functions for chat & activity =====
async function getRecentMessages(limit = 50) {
  if (db && db.collection) {
    const snapshot = await db.collection('chat_messages')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
  } else {
    const messages = global.chatMessages || [];
    return messages.slice(-limit);
  }
}

async function getRecentActivity(limit = 20) {
  if (db && db.collection) {
    const snapshot = await db.collection('activity_feed')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    const items = global.activityFeed || [];
    return items.slice(-limit);
  }
}

function broadcastChatMessage(message) {
  chatClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify({ type: 'message', message })}\n\n`);
  });
}

function broadcastActivity(activity) {
  chatClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify({ type: 'activity', activity })}\n\n`);
  });
}

// ==================== HELPER FUNCTIONS FOR PROMPT PAGE GENERATION ====================

function createNewsData(news, id) {
  const safeNews = news || {};
  return {
    id: id || 'unknown',
    title: safeNews.title || 'AI News Update',
    content: safeNews.content || 'No content available.',
    excerpt: safeNews.excerpt || (safeNews.content ? safeNews.content.substring(0, 200) + '...' : ''),
    imageUrl: safeNews.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=Prompt+Seen+News',
    author: safeNews.author || 'tools prompt Editor',
    category: safeNews.category || 'ai-news',
    tags: safeNews.tags || ['ai', 'news'],
    views: safeNews.views || 0,
    likes: safeNews.likes || 0,
    shares: safeNews.shares || 0,
    isBreaking: safeNews.isBreaking || false,
    isFeatured: safeNews.isFeatured || false,
    createdAt: safeDateToString(safeNews.createdAt),
    publishedAt: safeDateToString(safeNews.publishedAt),
    seoTitle: safeNews.seoTitle || safeNews.title || 'AI News - tools prompt',
    metaDescription: safeNews.metaDescription || (safeNews.content ? 
      safeNews.content.substring(0, 155) + '...' : 
      'Latest AI news and prompt engineering updates from tools prompt.')
  };
}

function createPromptData(prompt, id, hasPurchased = false) {
  const safePrompt = prompt || {};
  const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl || 
                  (safePrompt.mediaUrl && safePrompt.mediaUrl.includes('video')) ||
                  safePrompt.category === 'video';
  const detectedPlatform = AIModelManager.detectPlatform(safePrompt);
  const platformInfo = isVideo 
    ? AIModelManager.getVideoModelInfo(detectedPlatform)
    : AIModelManager.getPhotoModelInfo(detectedPlatform);
  const thumbnailUrl = safePrompt.thumbnailUrl || 
                      (isVideo ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : null);
  const isPaid = safePrompt.price > 0;
  const fullPromptText = safePrompt.promptText || 'No prompt text available.';
  let promptText = fullPromptText;
  if (isPaid && !hasPurchased) {
    promptText = fullPromptText.length > 100 
      ? fullPromptText.substring(0, 100) + '... [Full prompt text available after purchase]'
      : fullPromptText + ' [Full prompt text available after purchase]';
  }

  const promptData = {
    id: id || 'unknown',
    title: safePrompt.title || 'Untitled Prompt',
    seoTitle: safePrompt.seoTitle || safePrompt.title || (isVideo ? 'AI Video Prompt - tools prompt' : 'AI Prompt - tools prompt'),
    metaDescription: safePrompt.metaDescription || (safePrompt.promptText ? 
      safePrompt.promptText.substring(0, 155) + '...' : 
      (isVideo ? 'Explore this AI-generated video and learn prompt engineering techniques.' : 'Explore this AI-generated content and learn prompt engineering techniques.')),
    imageUrl: safePrompt.thumbnailUrl || safePrompt.imageUrl || safePrompt.mediaUrl || thumbnailUrl ||
              (isVideo ? 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel' : 
               'https://via.placeholder.com/800x400/4e54c8/ffffff?text=Prompt+Seen+AI+Image'),
    videoUrl: safePrompt.videoUrl || (isVideo ? safePrompt.mediaUrl : null),
    mediaUrl: safePrompt.mediaUrl || safePrompt.imageUrl || safePrompt.videoUrl,
    fileType: safePrompt.fileType || (isVideo ? 'video' : 'image'),
    promptText: promptText,
    fullPromptText: fullPromptText,
    userName: safePrompt.userName || 'Anonymous',
userId: safePrompt.userId || 'anonymous', 
    likes: safePrompt.likes || 0,
    views: safePrompt.views || 0,
    uses: safePrompt.uses || 0,
    copies: safePrompt.copies || 0,
    commentCount: safePrompt.commentCount || 0,
    keywords: safePrompt.keywords || (isVideo ? ['AI', 'video', 'reel', 'editing'] : ['AI', 'prompt', 'image generation']),
    category: safePrompt.category || (isVideo ? 'video' : 'general'),
    createdAt: safeDateToString(safePrompt.createdAt),
    updatedAt: safeDateToString(safePrompt.updatedAt || safePrompt.createdAt),
    seoScore: safePrompt.seoScore || 0,
    adsenseMigrated: safePrompt.adsenseMigrated || false,
    videoDuration: safePrompt.videoDuration || null,
    videoFormat: safePrompt.videoFormat || null,
    thumbnailUrl: thumbnailUrl,
    hasCustomThumbnail: !!safePrompt.thumbnailUrl,
    detectedPlatform: detectedPlatform,
    platformInfo: platformInfo,
    price: safePrompt.price || 0,
    isPaid: isPaid,
    hasPurchased: hasPurchased,
    salesCount: safePrompt.salesCount || 0,
    totalEarnings: safePrompt.totalEarnings || 0
  };

  let detailedExplanation = safePrompt.aboutDescription;
  if (!detailedExplanation) {
    detailedExplanation = AIPlatformContentGenerator.generatePlatformIntroduction(promptData);
  }
  promptData.detailedExplanation = detailedExplanation;

  const aiDescription = AIDescriptionGenerator.generateComprehensiveDescription(promptData);
  promptData.stepByStepInstructions = PromptContentGenerator.generateStepByStepInstructions(promptData);
  promptData.bestAITools = AIDescriptionGenerator.generateBestAITools(promptData);
  promptData.trendAnalysis = PromptContentGenerator.generateTrendAnalysis(promptData);
  promptData.usageTips = PromptContentGenerator.generateUsageTips(promptData);
  promptData.seoTips = PromptContentGenerator.generateSEOTips(promptData);
  promptData.aiStepByStepGuide = aiDescription.stepByStep;
  promptData.aiExpertTips = aiDescription.tips;
  promptData.platformComparison = AIDescriptionGenerator.generatePlatformComparison(promptData);
  promptData.modelSpecificTips = AIDescriptionGenerator.generateModelSpecificTips();

  return promptData;
}

// ==================== CSS AND HTML FOR PROMPT PAGE ====================

// Mini Browser CSS
const miniBrowserCSS = `
.mini-browser-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 320px;
    height: 450px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    z-index: 10000;
    display: none;
    flex-direction: column;
    overflow: hidden;
    transition: all 0.3s ease;
    border: 2px solid #4e54c8;
    resize: both;
    min-width: 300px;
    min-height: 400px;
}

.mini-browser-container.expanded {
    width: 90vw !important;
    height: 90vh !important;
    bottom: 5vh !important;
    right: 5vw !important;
    resize: none;
}

.mini-browser-header {
    background: #4e54c8;
    color: white;
    padding: 12px 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    user-select: none;
    flex-shrink: 0;
}

.mini-browser-title {
    font-size: 0.9rem;
    font-weight: 600;
}

.mini-browser-controls {
    display: flex;
    gap: 8px;
}

.mini-browser-btn {
    background: rgba(255,255,255,0.2);
    border: none;
    color: white;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.3s ease;
}

.mini-browser-btn:hover {
    background: rgba(255,255,255,0.3);
    transform: scale(1.1);
}

.mini-browser-content {
    flex: 1;
    background: white;
    position: relative;
    overflow: hidden;
}

.mini-browser-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: white;
}

.mini-browser-toggle {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #4e54c8;
    color: white;
    border: none;
    border-radius: 50%;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(78, 84, 200, 0.4);
    z-index: 9999;
    transition: all 0.3s ease;
    font-size: 1.5rem;
}

.mini-browser-toggle:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(78, 84, 200, 0.6);
}

@media (max-width: 768px) {
    .mini-browser-container {
        width: 280px;
        height: 350px;
        bottom: 10px;
        right: 10px;
        min-width: 250px;
        min-height: 300px;
    }
    
    .mini-browser-container.expanded {
        width: 95vw !important;
        height: 70vh !important;
        bottom: 5vh !important;
        right: 2.5vw !important;
    }
    
    .mini-browser-toggle {
        width: 45px;
        height: 45px;
        bottom: 10px;
        right: 10px;
        font-size: 1.1rem;
    }
}

@media (max-width: 480px) {
    .mini-browser-container {
        width: 250px;
        height: 300px;
        bottom: 8px;
        right: 8px;
        min-width: 220px;
        min-height: 250px;
    }
    
    .mini-browser-container.expanded {
        width: 98vw !important;
        height: 60vh !important;
        bottom: 5vh !important;
        right: 1vw !important;
    }
    
    .mini-browser-toggle {
        width: 40px;
        height: 40px;
        bottom: 8px;
        right: 8px;
        font-size: 1rem;
    }
    
    .title-text {
        display: none;
    }
}

.mini-browser-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #666;
    z-index: 10;
}

.mini-browser-loading .spinner {
    border: 3px solid #f3f3f3;
    border-top: 3px solid #4e54c8;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.mini-browser-iframe {
    opacity: 1;
    transition: opacity 0.3s ease;
}

.mini-browser-iframe[style*="display: none"] {
    opacity: 0;
}
`;

// Platform Comparison CSS
const platformComparisonCSS = `
.platform-comparison {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2rem;
    border-radius: 15px;
    margin: 2rem 0;
    position: relative;
    overflow: hidden;
}

.platform-comparison::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 100%;
    height: 200%;
    background: rgba(255,255,255,0.1);
    transform: rotate(45deg);
}

.platform-comparison h3 {
    position: relative;
    z-index: 1;
    margin-bottom: 1rem;
    font-size: 1.5rem;
    color: white;
}

.platform-comparison p {
    position: relative;
    z-index: 1;
    opacity: 0.9;
    margin-bottom: 1.5rem;
}

.comparison-table-container {
    position: relative;
    z-index: 1;
    overflow-x: auto;
    margin: 1.5rem 0;
    background: rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 1rem;
    backdrop-filter: blur(10px);
}

.platform-comparison-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px;
}

.platform-comparison-table th {
    background: rgba(255,255,255,0.2);
    color: white;
    font-weight: 600;
    text-align: left;
    padding: 1rem;
    border-bottom: 2px solid rgba(255,255,255,0.3);
}

.platform-comparison-table td {
    padding: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.9);
}

.platform-comparison-table tr:hover {
    background: rgba(255,255,255,0.1);
}

.platform-comparison-table tr.primary-platform {
    background: rgba(255,255,255,0.15);
    border-left: 4px solid #4e54c8;
}

.primary-badge {
    background: #4e54c8;
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.7rem;
    margin-left: 8px;
    vertical-align: middle;
}

.price-tag {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
}

.price-free {
    background: #20bf6b;
    color: white;
}

.price-paid {
    background: #ff9f43;
    color: white;
}

.category-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(255,255,255,0.2);
    color: white;
}

.category-professional {
    background: #4e54c8;
}

.category-artistic {
    background: #9b59b6;
}

.category-open-source {
    background: #2c3e50;
}

.category-free {
    background: #20bf6b;
}

.category-commercial {
    background: #2980b9;
}

.category-editing {
    background: #e67e22;
}

.category-design {
    background: #f1c40f;
    color: #333;
}

.category-versatile {
    background: #3498db;
}

.category-mobile {
    background: #e91e63;
}

.category-nft {
    background: #8e44ad;
}

.category-real-time {
    background: #16a085;
}

.category-video {
    background: #ff6b6b;
}

.category-animation {
    background: #f39c12;
}

.category-social {
    background: #00acc1;
}

.category-marketing {
    background: #d35400;
}

.category-avatar {
    background: #c0392b;
}

.category-cinematic {
    background: #1abc9c;
}

.category-motion {
    background: #d35400;
}

.category-3d {
    background: #2ecc71;
}

.category-expressive {
    background: #e74c3c;
}

.category-storytelling {
    background: #9b59b6;
}

.comparison-tips {
    position: relative;
    z-index: 1;
    background: rgba(255,255,255,0.1);
    padding: 1.5rem;
    border-radius: 10px;
    margin-top: 1.5rem;
    backdrop-filter: blur(10px);
}

.comparison-tips ul {
    margin: 0;
    padding-left: 1.5rem;
}

.comparison-tips li {
    margin-bottom: 0.5rem;
    opacity: 0.9;
}

.model-specific-tips {
    background: #f8f9fa;
    padding: 2rem;
    border-radius: 15px;
    margin: 2rem 0;
    border: 2px solid #e9ecef;
}

.model-specific-tips h4 {
    color: #4e54c8;
    margin-bottom: 1.5rem;
    font-size: 1.3rem;
}

.model-tips-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem;
    margin-top: 1rem;
}

.model-tip {
    background: white;
    padding: 1.5rem;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    border-top: 4px solid #4e54c8;
    transition: transform 0.3s ease;
}

.model-tip:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.15);
}

.model-tip h5 {
    color: #4e54c8;
    margin-bottom: 1rem;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.model-tip ul {
    margin: 0;
    padding-left: 1.2rem;
}

.model-tip li {
    margin-bottom: 0.5rem;
    color: #555;
    font-size: 0.9rem;
}

.model-tip code {
    background: #f1f3f9;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    color: #4e54c8;
    font-size: 0.85rem;
}

.tools-grid-enhanced {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-top: 1rem;
}

.tool-card-enhanced {
    background: white;
    padding: 1.5rem;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    border-left: 4px solid #4e54c8;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.tool-card-enhanced:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.15);
}

.tool-card-enhanced.primary-tool {
    border-left: 4px solid #20bf6b;
    background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
}

.tool-card-enhanced.primary-tool::before {
    content: '★ Recommended';
    position: absolute;
    top: 10px;
    right: 10px;
    background: #20bf6b;
    color: white;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 600;
}

.tool-card-enhanced h4 {
    color: #4e54c8;
    margin-bottom: 0.75rem;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.tool-rating {
    display: flex;
    gap: 2px;
}

.tool-rating i {
    color: #ffd700;
    font-size: 0.9rem;
}

.tool-card-enhanced p {
    color: #555;
    margin-bottom: 1rem;
    font-size: 0.95rem;
    line-height: 1.5;
}

.tool-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
}

.tool-tag {
    background: rgba(78, 84, 200, 0.1);
    color: #4e54c8;
    padding: 4px 10px;
    border-radius: 15px;
    font-size: 0.75rem;
    font-weight: 500;
}
`;

// Comment System CSS
const commentSystemCSS = `
.comment-section {
    margin-top: 2rem;
    padding: 1.5rem;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.comment-section h2 {
    color: #4e54c8;
    margin-bottom: 1.5rem;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.comment-form {
    background: #f8f9fa;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
}

.comment-form h3 {
    color: #2d334a;
    margin-bottom: 1rem;
    font-size: 1.2rem;
}

.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.5rem;
    color: #555;
    font-weight: 500;
}

.form-group input,
.form-group textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    transition: all 0.3s ease;
}

.form-group input:focus,
.form-group textarea:focus {
    outline: none;
    border-color: #4e54c8;
    box-shadow: 0 0 0 3px rgba(78, 84, 200, 0.1);
}

.form-group textarea {
    min-height: 120px;
    resize: vertical;
    font-family: inherit;
}

.comment-submit-btn {
    background: linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 8px;
}

.comment-submit-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(78, 84, 200, 0.3);
}

.comments-list {
    margin-top: 2rem;
}

.comment-item {
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 10px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    transition: all 0.3s ease;
}

.comment-item:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-2px);
}

.comment-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 1rem;
}

.comment-author {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.comment-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.1rem;
}

.comment-author-info h4 {
    margin: 0;
    color: #2d334a;
    font-size: 1.1rem;
}

.comment-author-info .comment-date {
    color: #666;
    font-size: 0.85rem;
    margin-top: 0.25rem;
}

.comment-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.like-comment-btn {
    background: none;
    border: 1px solid #e9ecef;
    color: #666;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
}

.like-comment-btn:hover {
    border-color: #4e54c8;
    color: #4e54c8;
}

.like-comment-btn.liked {
    background: #ffeaea;
    border-color: #ff6b6b;
    color: #ff6b6b;
}

.comment-content {
    color: #2d334a;
    line-height: 1.6;
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
}

.comment-stats {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
    color: #666;
    font-size: 0.9rem;
}

.load-more-comments {
    text-align: center;
    margin-top: 2rem;
}

.load-more-btn {
    background: #f8f9fa;
    border: 2px solid #4e54c8;
    color: #4e54c8;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.3s ease;
}

.load-more-btn:hover {
    background: #4e54c8;
    color: white;
}

.no-comments {
    text-align: center;
    padding: 3rem;
    color: #666;
    background: #f8f9fa;
    border-radius: 10px;
    border: 2px dashed #ddd;
}

@media (max-width: 768px) {
    .comment-section {
        padding: 1rem;
    }
    
    .comment-header {
        flex-direction: column;
        gap: 0.75rem;
    }
    
    .comment-author {
        width: 100%;
    }
    
    .comment-actions {
        width: 100%;
        justify-content: flex-end;
    }
    
    .comment-item {
        padding: 1rem;
    }
    
    .comment-form {
        padding: 1rem;
    }
}
`;

// Mini Browser HTML
const miniBrowserHTML = `
<div class="mini-browser-container" id="miniBrowser">
    <div class="mini-browser-header" id="miniBrowserHeader">
        <div class="mini-browser-title">
            <i class="fas fa-compact-disc"></i> <span class="title-text">Quick Unique Best Match</span>
        </div>
        <div class="mini-browser-controls">
            <button class="mini-browser-btn" onclick="refreshMiniBrowser()" title="Refresh">
                <i class="fas fa-redo"></i>
            </button>
            <button class="mini-browser-btn" onclick="toggleMiniBrowserSize()" title="Expand/Collapse">
                <i class="fas fa-expand"></i>
            </button>
            <button class="mini-browser-btn" onclick="closeMiniBrowser()" title="Close">
                <i class="fas fa-times"></i>
            </button>
        </div>
    </div>
    <div class="mini-browser-content">
        <div class="mini-browser-loading" id="miniBrowserLoading">
            <div class="spinner"></div>
            <div>Loading tools prompt...</div>
        </div>
        <iframe 
            src="https://www.toolsprompt.com" 
            class="mini-browser-iframe" 
            id="miniBrowserIframe"
            onload="hideMiniBrowserLoading()"
            allow="fullscreen"
            referrerpolicy="strict-origin-when-cross-origin"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        ></iframe>
    </div>
</div>

<button class="mini-browser-toggle" id="miniBrowserToggle" onclick="toggleMiniBrowser()">
    <i class="fas fa-plus"></i>
</button>
`;

// Mini Browser JavaScript
const miniBrowserJS = `
let isMiniBrowserOpen = false;
let isMiniBrowserExpanded = false;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function autoOpenMiniBrowser() {
    console.log('Auto-opening mini browser...');
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    setTimeout(() => {
        if (!isMobile || window.innerWidth > 480) {
            toggleMiniBrowser();
        } else {
            console.log('Mobile device detected - mini browser auto-open disabled');
            showMobileNotification();
        }
    }, 1500);
}

function showMobileNotification() {
    const notification = document.createElement('div');
    notification.innerHTML = \`
        <div style="
            position: fixed;
            bottom: 60px;
            right: 10px;
            background: #4e54c8;
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 0.8rem;
            z-index: 10001;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            max-width: 150px;
        ">
            <i class="fas fa-compass"></i> Quick Browser Available
            <br>
            <small>Tap the + button</small>
        </div>
    \`;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function toggleMiniBrowser() {
    console.log('Toggle mini browser called');
    const miniBrowser = document.getElementById('miniBrowser');
    const toggleBtn = document.getElementById('miniBrowserToggle');
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (!isMiniBrowserOpen) {
        miniBrowser.style.display = 'flex';
        toggleBtn.innerHTML = '<i class="fas fa-times"></i>';
        toggleBtn.style.background = '#ff6b6b';
        isMiniBrowserOpen = true;
        
        if (isMobile && window.innerWidth <= 480) {
            miniBrowser.style.width = '250px';
            miniBrowser.style.height = '300px';
        }
        
        showMiniBrowserLoading();
        
        const iframe = document.getElementById('miniBrowserIframe');
        iframe.src = 'https://www.toolsprompt.com';
    } else {
        closeMiniBrowser();
    }
}

function closeMiniBrowser() {
    const miniBrowser = document.getElementById('miniBrowser');
    const toggleBtn = document.getElementById('miniBrowserToggle');
    
    miniBrowser.style.display = 'none';
    toggleBtn.innerHTML = '<i class="fas fa-plus"></i>';
    toggleBtn.style.background = '#4e54c8';
    isMiniBrowserOpen = false;
    isMiniBrowserExpanded = false;
    miniBrowser.classList.remove('expanded');
    
    const expandBtn = document.querySelector('.mini-browser-btn .fa-expand, .mini-browser-btn .fa-compress');
    if (expandBtn) {
        expandBtn.className = 'fas fa-expand';
    }
}

function toggleMiniBrowserSize() {
    const miniBrowser = document.getElementById('miniBrowser');
    const expandBtn = document.querySelector('.mini-browser-controls .fa-expand, .mini-browser-controls .fa-compress');
    
    if (!isMiniBrowserExpanded) {
        miniBrowser.classList.add('expanded');
        if (expandBtn) expandBtn.className = 'fas fa-compress';
        isMiniBrowserExpanded = true;
    } else {
        miniBrowser.classList.remove('expanded');
        if (expandBtn) expandBtn.className = 'fas fa-expand';
        isMiniBrowserExpanded = false;
    }
}

function refreshMiniBrowser() {
    const iframe = document.getElementById('miniBrowserIframe');
    showMiniBrowserLoading();
    iframe.src = 'https://www.toolsprompt.com';
}

function showMiniBrowserLoading() {
    const loading = document.getElementById('miniBrowserLoading');
    if (loading) loading.style.display = 'block';
}

function hideMiniBrowserLoading() {
    const loading = document.getElementById('miniBrowserLoading');
    if (loading) loading.style.display = 'none';
}

function initializeDragging() {
    const header = document.getElementById('miniBrowserHeader');
    const browser = document.getElementById('miniBrowser');
    
    if (!header || !browser) return;
    
    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDragTouch);
    
    function startDrag(e) {
        if (isMiniBrowserExpanded) return;
        
        isDragging = true;
        const rect = browser.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        e.preventDefault();
    }
    
    function startDragTouch(e) {
        if (isMiniBrowserExpanded) return;
        
        isDragging = true;
        const touch = e.touches[0];
        const rect = browser.getBoundingClientRect();
        dragOffset.x = touch.clientX - rect.left;
        dragOffset.y = touch.clientY - rect.top;
        
        document.addEventListener('touchmove', onDragTouch);
        document.addEventListener('touchend', stopDrag);
        e.preventDefault();
    }
    
    function onDrag(e) {
        if (!isDragging) return;
        
        browser.style.position = 'fixed';
        browser.style.left = (e.clientX - dragOffset.x) + 'px';
        browser.style.top = (e.clientY - dragOffset.y) + 'px';
        browser.style.right = 'auto';
        browser.style.bottom = 'auto';
    }
    
    function onDragTouch(e) {
        if (!isDragging) return;
        
        const touch = e.touches[0];
        browser.style.position = 'fixed';
        browser.style.left = (touch.clientX - dragOffset.x) + 'px';
        browser.style.top = (touch.clientY - dragOffset.y) + 'px';
        browser.style.right = 'auto';
        browser.style.bottom = 'auto';
    }
    
    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('touchmove', onDragTouch);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchend', stopDrag);
    }
}

document.addEventListener('click', function(e) {
    const miniBrowser = document.getElementById('miniBrowser');
    const toggleBtn = document.getElementById('miniBrowserToggle');
    
    if (isMiniBrowserOpen && !isMiniBrowserExpanded && 
        miniBrowser && !miniBrowser.contains(e.target) && 
        e.target !== toggleBtn) {
        closeMiniBrowser();
    }
});

window.addEventListener('message', function(e) {
    console.log('Message from iframe:', e.data);
});

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing mini browser');
    initializeDragging();
    autoOpenMiniBrowser();
});

document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleMiniBrowser();
    }
    
    if (e.key === 'Escape' && isMiniBrowserOpen) {
        if (isMiniBrowserExpanded) {
            toggleMiniBrowserSize();
        } else {
            closeMiniBrowser();
        }
    }
});
`;

// Mini Browser Toggle Button
const miniBrowserToggleButton = `
<button class="engagement-btn" onclick="toggleMiniBrowser()" title="Open tools prompt Browser (Ctrl+B)">
    <i class="fas fa-external-link-alt"></i> Quick Browse
</button>
`;

// Comment System JavaScript
function generateCommentSystemJS(promptData) {
  return `
let currentPage = 1;
let isLoadingComments = false;
let hasMoreComments = true;

async function loadComments(page = 1) {
    if (isLoadingComments) return;
    
    isLoadingComments = true;
    const promptId = '${promptData.id}';
    const commentsList = document.getElementById('commentsList');
    const noComments = document.getElementById('noComments');
    const loadMoreDiv = document.getElementById('loadMoreComments');
    
    try {
        const response = await fetch('/api/prompt/' + promptId + '/comments?page=' + page + '&limit=10');
        if (!response.ok) throw new Error('Failed to load comments');
        
        const data = await response.json();
        
        if (page === 1) {
            commentsList.innerHTML = '';
            noComments.style.display = 'none';
        }
        
        if (data.comments && data.comments.length > 0) {
            data.comments.forEach(comment => {
                const commentElement = createCommentElement(comment);
                commentsList.appendChild(commentElement);
            });
            
            hasMoreComments = data.hasMore;
            loadMoreDiv.style.display = hasMoreComments ? 'block' : 'none';
            
            if (page === 1 && data.totalCount > 0) {
                const commentCount = document.querySelector('.comment-count');
                if (commentCount) {
                    commentCount.textContent = data.totalCount;
                }
            }
        } else if (page === 1) {
            noComments.style.display = 'block';
            loadMoreDiv.style.display = 'none';
        }
        
        currentPage = page;
    } catch (error) {
        console.error('Error loading comments:', error);
        if (page === 1) {
            noComments.innerHTML = '<p>Error loading comments. Please try again.</p>';
            noComments.style.display = 'block';
        }
    } finally {
        isLoadingComments = false;
    }
}

function createCommentElement(comment) {
    const commentDate = new Date(comment.createdAt);
    const formattedDate = commentDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const avatarLetter = comment.authorName.charAt(0).toUpperCase();
    
    const element = document.createElement('div');
    element.className = 'comment-item';
    element.id = 'comment-' + comment.id;
    element.innerHTML = 
        '<div class="comment-header">' +
            '<div class="comment-author">' +
                '<div class="comment-avatar">' +
                    avatarLetter +
                '</div>' +
                '<div class="comment-author-info">' +
                    '<h4>' + comment.authorName + '</h4>' +
                    '<div class="comment-date">' +
                        '<i class="far fa-clock"></i> ' + formattedDate +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="comment-actions">' +
                '<button class="like-comment-btn" ' +
                        'onclick="likeComment(\\'' + comment.id + '\\')"' +
                        'data-likes="' + (comment.likes || 0) + '">' +
                    '<i class="far fa-heart"></i>' +
                    '<span class="like-count">' + (comment.likes || 0) + '</span>' +
                '</button>' +
            '</div>' +
        '</div>' +
        '<p class="comment-content">' + comment.content + '</p>';
    
    return element;
}

document.getElementById('commentForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const promptId = '${promptData.id}';
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    
    const formData = {
        content: form.content.value.trim(),
        authorName: form.authorName.value.trim() || 'Anonymous',
        authorEmail: form.authorEmail.value.trim() || null
    };
    
    if (!formData.content) {
        alert('Please enter a comment');
        return;
    }
    
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/prompt/' + promptId + '/comments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            form.reset();
            alert('Comment posted successfully!');
            loadComments(1);
            document.getElementById('commentSection').scrollIntoView({ 
                behavior: 'smooth' 
            });
        } else {
            alert(result.error || 'Failed to post comment');
        }
    } catch (error) {
        console.error('Error posting comment:', error);
        alert('Failed to post comment. Please try again.');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
});

async function likeComment(commentId) {
    const promptId = '${promptData.id}';
    const likeBtn = document.querySelector('#comment-' + commentId + ' .like-comment-btn');
    
    if (likeBtn.classList.contains('liked')) {
        return;
    }
    
    try {
        const response = await fetch('/api/comment/' + commentId + '/like', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ promptId })
        });
        
        if (response.ok) {
            likeBtn.classList.add('liked');
            const likeCount = likeBtn.querySelector('.like-count');
            const currentLikes = parseInt(likeCount.textContent);
            likeCount.textContent = currentLikes + 1;
        }
    } catch (error) {
        console.error('Error liking comment:', error);
    }
}

document.getElementById('loadMoreBtn').addEventListener('click', function() {
    if (hasMoreComments && !isLoadingComments) {
        loadComments(currentPage + 1);
    }
});

document.addEventListener('DOMContentLoaded', function() {
    loadComments(1);
    
    const commentTextarea = document.getElementById('commentContent');
    if (commentTextarea) {
        const counter = document.createElement('div');
        counter.style.color = '#666';
        counter.style.fontSize = '0.85rem';
        counter.style.textAlign = 'right';
        counter.style.marginTop = '0.25rem';
        counter.textContent = '0/1000';
        
        commentTextarea.parentNode.appendChild(counter);
        
        commentTextarea.addEventListener('input', function() {
            counter.textContent = this.value.length + '/1000';
            if (this.value.length > 1000) {
                counter.style.color = '#ff6b6b';
            } else {
                counter.style.color = '#666';
            }
        });
    }
});
`;
}

// Helper to generate affiliate HTML
function generateAffiliateHTML(affiliate) {
  if (!affiliate) return '';
  return `
    <div class="affiliate-container">
      <div class="ad-label">🌟 Sponsored</div>
      <a href="${affiliate.url}" target="_blank" rel="noopener sponsored" class="affiliate-link">
        ${affiliate.image ? `<img src="${affiliate.image}" alt="${affiliate.title}" class="affiliate-image" onerror="this.style.display='none'">` : ''}
        <div class="affiliate-info">
          <h4>${affiliate.title}</h4>
          ${affiliate.description ? `<p>${affiliate.description}</p>` : ''}
          <span class="affiliate-cta">View Product →</span>
        </div>
      </a>
    </div>
  `;
}

// ==================== UPDATED generateEnhancedPromptHTML ====================
function generateEnhancedPromptHTML(promptData, affiliates) {
  const prompt = promptData;
  const baseUrl = 'https://www.toolsprompt.com';
  const promptUrl = baseUrl + '/prompt/' + promptData.id;
  const gaId = process.env.GOOGLE_ANALYTICS_ID || 'G-K4KXR4FZCP';
  const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
  
  const platformInfo = promptData.platformInfo || { name: 'AI Platform', strengths: [] };
  
  const googleAnalyticsCode = `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}');
    </script>
  `;

  // Generate Adsterra ads for prompt pages
  const adsterraAds = generateAllAdsterraAds();

  const mediaDisplay = isVideo ? `
    <div class="shorts-video-container">
      <video 
        src="${promptData.videoUrl || promptData.mediaUrl}" 
        poster="${promptData.imageUrl}"
        class="shorts-image"
        controls
        loop
        playsinline
        preload="metadata"
        onerror="this.style.display='none'; document.getElementById('videoFallback').style.display='flex';"
      ></video>
      <div id="videoFallback" style="display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:#000; color:white; align-items:center; justify-content:center; flex-direction:column;">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:1rem;"></i>
        <p>Video failed to load. Try refreshing.</p>
      </div>
      ${promptData.videoDuration ? `<span class="video-duration">${promptData.videoDuration}s</span>` : ''}
    </div>
  ` : `
    <img src="${promptData.imageUrl}" 
         alt="${promptData.title} - AI Generated Image" 
         class="prompt-image"
         onerror="this.src='https://via.placeholder.com/800x400/4e54c8/ffffff?text=AI+Generated+Image'"
         id="promptImage">
  `;

  const platformBadge = `
    <div class="ai-model-badge">
      <i class="fas fa-${isVideo ? 'video' : 'camera'}"></i> ${platformInfo.name || (isVideo ? 'AI Video' : 'AI Image')}
    </div>
  `;

  const priceBadge = promptData.isPaid ? `
    <div class="price-badge">
      <i class="fas fa-rupee-sign"></i> ${promptData.price}
    </div>
  ` : `
    <div class="price-badge free">
      <i class="fas fa-gift"></i> Free
    </div>
  `;

  const aiStepsHTML = isVideo ? `
    <div class="instruction-step">
      <div class="step-number">1</div>
      <div class="step-content">
        <strong>Access the Platform:</strong> ${promptData.aiStepByStepGuide.access}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">2</div>
      <div class="step-content">
        <strong>Prepare Your Video Concept:</strong> ${promptData.aiStepByStepGuide.preparation}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">3</div>
      <div class="step-content">
        <strong>Use Your Prompt:</strong> ${promptData.aiStepByStepGuide.prompt}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">4</div>
      <div class="step-content">
        <strong>Adjust Parameters:</strong> ${promptData.aiStepByStepGuide.customization}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">5</div>
      <div class="step-content">
        <strong>Generate and Review:</strong> ${promptData.aiStepByStepGuide.generation}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">6</div>
      <div class="step-content">
        <strong>Export and Edit Further:</strong> ${promptData.aiStepByStepGuide.finalization}
      </div>
    </div>
  ` : `
    <div class="instruction-step">
      <div class="step-number">1</div>
      <div class="step-content">
        <strong>Access the Platform:</strong> ${promptData.aiStepByStepGuide.access}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">2</div>
      <div class="step-content">
        <strong>Prepare Your Input:</strong> ${promptData.aiStepByStepGuide.preparation}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">3</div>
      <div class="step-content">
        <strong>Use Your Prompt:</strong> ${promptData.aiStepByStepGuide.prompt}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">4</div>
      <div class="step-content">
        <strong>Customize Details:</strong> ${promptData.aiStepByStepGuide.customization}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">5</div>
      <div class="step-content">
        <strong>Generate and Refine:</strong> ${promptData.aiStepByStepGuide.generation}
      </div>
    </div>
    <div class="instruction-step">
      <div class="step-number">6</div>
      <div class="step-content">
        <strong>Finalize and Export:</strong> ${promptData.aiStepByStepGuide.finalization}
      </div>
    </div>
  `;

  const aiExpertTipsHTML = (promptData.aiExpertTips || []).map(tip => `
    <li>${tip}</li>
  `).join('');

  const toolsHTML = (promptData.bestAITools || []).map(tool => `
    <div class="tool-card-enhanced ${tool.isPrimary ? 'primary-tool' : ''}">
      <h4>
        ${tool.name}
        <div class="tool-rating">
          ${Array(tool.rating || 4).fill('<i class="fas fa-star"></i>').join('')}
          ${Array(5 - (tool.rating || 4)).fill('<i class="far fa-star"></i>').join('')}
        </div>
      </h4>
      <p>${tool.description}</p>
      <div class="tool-tags">
        ${(tool.strengths || tool.category || []).map(tag => `<span class="tool-tag">${tag}</span>`).join('')}
      </div>
    </div>
  `).join('');

  const tipsHTML = (promptData.usageTips || []).map(tip => `
    <li>${tip}</li>
  `).join('');

  const seoTipsHTML = (promptData.seoTips || []).map(tip => `
    <li>${tip}</li>
  `).join('');

  // Add download app button HTML at the end of body
  const downloadAppButtonHTMLWithStyle = `
    <!-- Floating Download App Button -->
    <style>${downloadAppCSS}</style>
    <button class="floating-download-btn" id="downloadAppBtn" onclick="downloadApp()">
        <i class="fas fa-download"></i>
        <span class="btn-text">Download App</span>
        <span class="btn-badge">FREE</span>
    </button>
  `;

  // Download App JavaScript function to be added
  const downloadAppJS = `
    // ==================== DOWNLOAD APP FUNCTION ====================
    
    function downloadApp() {
        const appUrl = 'https://apk.e-droid.net/apk/app4057785-93607p.apk?v=2';
        
        // Track download click for analytics
        try {
            fetch('/api/track-download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    promptId: '${promptData.id}',
                    promptTitle: '${promptData.title.replace(/'/g, "\\'")}',
                    timestamp: new Date().toISOString(),
                    userAgent: navigator.userAgent
                })
            }).catch(err => console.log('Download tracking error:', err));
        } catch(e) {}
        
        // Show download started notification
        showDownloadNotification();
        
        // Open download URL
        window.open(appUrl, '_blank');
    }

    function showDownloadNotification() {
        const notification = document.createElement('div');
        notification.className = 'download-notification';
        notification.innerHTML = \`
            <i class="fas fa-check-circle"></i>
            <span>Download started! Check your browser.</span>
        \`;
        notification.style.cssText = \`
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #20bf6b;
            color: white;
            padding: 10px 20px;
            border-radius: 50px;
            z-index: 10001;
            font-size: 0.9rem;
            font-weight: 500;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            animation: slideUpFade 0.3s ease;
            white-space: nowrap;
        \`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(-50%) translateY(-10px)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Optional: Hide button when user scrolls down (or keep sticky - your choice)
    let lastScrollY = window.scrollY;
    let hideTimeout;

    function handleDownloadButtonVisibility() {
        const downloadBtn = document.getElementById('downloadAppBtn');
        if (!downloadBtn) return;
        
        // Button stays sticky (doesn't move) - just ensure it's visible
        // This keeps it always visible at bottom center
        
        // Optional: Add scroll-based animation
        const currentScrollY = window.scrollY;
        if (Math.abs(currentScrollY - lastScrollY) > 10) {
            downloadBtn.style.opacity = '0.7';
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
                downloadBtn.style.opacity = '1';
            }, 300);
        }
        lastScrollY = currentScrollY;
    }

    window.addEventListener('scroll', handleDownloadButtonVisibility);

    // Add pulse effect on page load
    setTimeout(() => {
        const btn = document.getElementById('downloadAppBtn');
        if (btn) {
            btn.style.animation = 'none';
            setTimeout(() => {
                btn.style.animation = 'slideUpFade 0.5s ease-out, pulse 0.5s ease-in-out 2';
            }, 10);
        }
    }, 500);
  `;

  // ---- AFFILIATE PLACEMENT ----
  const affiliateTop = affiliates[0] ? generateAffiliateHTML(affiliates[0]) : '';
  const affiliateMiddle = affiliates[1] ? generateAffiliateHTML(affiliates[1]) : '';
  const affiliateBottom = affiliates[2] ? generateAffiliateHTML(affiliates[2]) : '';

  // ==================== AI GENERATOR STICKY BAR CSS ====================
  const aiGeneratorCSS = `
/* Sticky AI Generator Bar */
.ai-generator-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(10px);
    border-top: 1px solid #e9ecef;
    padding: 12px 20px;
    display: none;
    align-items: flex-start;
    gap: 12px;
    z-index: 9999;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
    transition: transform 0.3s ease;
}
.ai-generator-bar.active {
    display: flex;
}
.ai-generator-input {
    flex: 1;
    min-height: 44px;
    max-height: 120px;
    padding: 10px 15px;
    border: 2px solid #e9ecef;
    border-radius: 24px;
    font-size: 0.95rem;
    resize: none;
    outline: none;
    transition: border-color 0.3s ease;
    font-family: inherit;
    background: white;
}
.ai-generator-input:focus {
    border-color: #4e54c8;
}
.ai-generator-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.ai-image-upload-btn {
    background: #f1f3f5;
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 1.4rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    color: #495057;
}
.ai-image-upload-btn:hover {
    background: #4e54c8;
    color: white;
    transform: scale(1.05);
}
.ai-generate-btn {
    background: linear-gradient(135deg, #4e54c8, #8f94fb);
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(78,84,200,0.3);
}
.ai-generate-btn:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 20px rgba(78,84,200,0.5);
}
.ai-generate-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}
.ai-credit-display {
    font-size: 0.8rem;
    color: #495057;
    padding: 0 8px;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
}
.ai-credit-display .credits-num {
    font-weight: 700;
    color: #4e54c8;
}
.ai-credit-display .credits-free {
    color: #20bf6b;
}
.ai-credit-display .credits-paid {
    color: #ff6b6b;
}
.ai-file-input {
    display: none;
}
.ai-image-preview {
    display: none;
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    border: 2px solid #4e54c8;
}
.ai-image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.ai-image-preview .remove-image {
    position: absolute;
    top: -6px;
    right: -6px;
    background: #ff6b6b;
    color: white;
    border: none;
    border-radius: 50%;
    width: 18px;
    height: 18px;
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}
/* Generated Image Modal */
.generated-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.85);
    z-index: 99999;
    align-items: center;
    justify-content: center;
    padding: 20px;
}
.generated-modal.active {
    display: flex;
}
.generated-modal-content {
    max-width: 90%;
    max-height: 90%;
    position: relative;
}
.generated-modal-content img {
    max-width: 100%;
    max-height: 90vh;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.generated-modal-close {
    position: absolute;
    top: -40px;
    right: -40px;
    background: white;
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    font-size: 1.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.generated-modal-close:hover {
    background: #ff6b6b;
    color: white;
}
.generated-modal-download {
    position: absolute;
    bottom: -50px;
    left: 50%;
    transform: translateX(-50%);
    background: #4e54c8;
    color: white;
    border: none;
    padding: 10px 24px;
    border-radius: 30px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.3s ease;
}
.generated-modal-download:hover {
    background: #3f44b8;
}
@media (max-width: 768px) {
    .ai-generator-bar {
        padding: 10px 12px;
        gap: 8px;
        flex-wrap: wrap;
    }
    .ai-generator-input {
        font-size: 0.9rem;
        min-height: 38px;
    }
    .ai-generator-actions {
        gap: 4px;
    }
    .ai-image-upload-btn, .ai-generate-btn {
        width: 38px;
        height: 38px;
        font-size: 1rem;
    }
    .ai-credit-display {
        font-size: 0.7rem;
    }
    .generated-modal-close {
        top: 10px;
        right: 10px;
        width: 34px;
        height: 34px;
        font-size: 1.2rem;
    }
    .generated-modal-download {
        bottom: -40px;
        padding: 8px 16px;
        font-size: 0.9rem;
    }
}
  `;

  // ==================== AI GENERATOR STICKY BAR HTML ====================
  const aiGeneratorHTML = `
<!-- AI Generator Sticky Bar -->
<div class="ai-generator-bar" id="aiGeneratorBar">
    <textarea class="ai-generator-input" id="aiPromptInput" placeholder="Describe the image you want to generate..." rows="1"></textarea>
    <div class="ai-generator-actions">
        <div class="ai-image-preview" id="aiImagePreview">
            <img id="aiPreviewImg" src="" alt="Uploaded preview">
            <button class="remove-image" id="aiRemoveImage">&times;</button>
        </div>
        <button class="ai-image-upload-btn" id="aiImageUploadBtn" title="Upload an image for reference">
            <i class="fas fa-plus"></i>
        </button>
        <input type="file" class="ai-file-input" id="aiFileInput" accept="image/*">
        <span class="ai-credit-display" id="aiCreditDisplay">
            <i class="fas fa-coins"></i> <span class="credits-num" id="aiCreditsCount">0</span> credits
        </span>
        <button class="ai-generate-btn" id="aiGenerateBtn" title="Generate Image">
            <i class="fas fa-arrow-right"></i>
        </button>
    </div>
</div>

<!-- Generated Image Modal -->
<div class="generated-modal" id="generatedModal">
    <div class="generated-modal-content">
        <button class="generated-modal-close" id="generatedModalClose">&times;</button>
        <img id="generatedImage" src="" alt="Generated Image">
        <button class="generated-modal-download" id="generatedDownloadBtn">Download Image</button>
    </div>
</div>

<!-- Upgrade Modal (for credits) -->
<div class="buy-modal-overlay" id="upgradeModal" style="display:none;">
    <div class="buy-modal" style="max-width:500px;">
        <div class="modal-header">
            <h2><i class="fas fa-gem"></i> Upgrade Credits</h2>
            <button class="close-modal" id="upgradeModalClose">&times;</button>
        </div>
        <div class="buy-modal-content" style="grid-template-columns:1fr;padding:20px;">
            <div style="text-align:center;">
                <p>You have <strong id="upgradeCurrentCredits">0</strong> credits left.</p>
                <p>Get <strong>50 credits</strong> for just <strong>₹20</strong>!</p>
                <button class="buy-now-btn" id="upgradePayBtn" style="margin-top:20px;">
                    <i class="fas fa-rupee-sign"></i> Pay ₹20 for 50 credits
                </button>
                <p class="secure-payment" style="margin-top:15px;">
                    <i class="fas fa-lock"></i> Secure payment via Razorpay
                </p>
            </div>
        </div>
    </div>
</div>
  `;

  // ==================== AI GENERATOR JAVASCRIPT ====================
  const aiGeneratorJS = `
// ==================== AI GENERATOR STICKY BAR ====================
(function() {
    const bar = document.getElementById('aiGeneratorBar');
    const promptInput = document.getElementById('aiPromptInput');
    const generateBtn = document.getElementById('aiGenerateBtn');
    const uploadBtn = document.getElementById('aiImageUploadBtn');
    const fileInput = document.getElementById('aiFileInput');
    const previewContainer = document.getElementById('aiImagePreview');
    const previewImg = document.getElementById('aiPreviewImg');
    const removeImageBtn = document.getElementById('aiRemoveImage');
    const creditDisplay = document.getElementById('aiCreditsCount');
    const modal = document.getElementById('generatedModal');
    const modalImg = document.getElementById('generatedImage');
    const modalClose = document.getElementById('generatedModalClose');
    const downloadBtn = document.getElementById('generatedDownloadBtn');
    const upgradeModal = document.getElementById('upgradeModal');
    const upgradeClose = document.getElementById('upgradeModalClose');
    const upgradePayBtn = document.getElementById('upgradePayBtn');
    const upgradeCurrent = document.getElementById('upgradeCurrentCredits');

    let currentUserId = null;
    let uploadedImage = null; // base64 or File
    let isGenerating = false;

    // Show bar only on prompt pages
    bar.classList.add('active');

    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Image upload
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function(e) {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(ev) {
                previewImg.src = ev.target.result;
                previewContainer.style.display = 'block';
                uploadedImage = file;
            };
            reader.readAsDataURL(file);
        }
    });
    removeImageBtn.addEventListener('click', function() {
        previewContainer.style.display = 'none';
        previewImg.src = '';
        fileInput.value = '';
        uploadedImage = null;
    });

    // Fetch credits on load
    async function fetchCredits() {
        const user = await getCurrentUser();
        if (!user) {
            creditDisplay.textContent = '0';
            return;
        }
        currentUserId = user.uid;
        try {
            const res = await fetch(\`/api/credits/\${user.uid}\`);
            const data = await res.json();
            if (data.success) {
                creditDisplay.textContent = data.credits;
            }
        } catch(e) {
            console.error('Credit fetch error', e);
        }
    }
    fetchCredits();

    // Generate
    generateBtn.addEventListener('click', async function() {
        if (isGenerating) return;
        const prompt = promptInput.value.trim();
        if (!prompt) {
            showNotification('Please enter a prompt.', 'error');
            return;
        }

        // Check login
        let user = await getCurrentUser();
        if (!user) {
            showNotification('Please login to generate images.', 'error');
            // Redirect to login with return URL
            const returnUrl = encodeURIComponent(window.location.href);
            window.location.href = '/login.html?returnUrl=' + returnUrl;
            return;
        }
        currentUserId = user.uid;

        // Check credits
        const creditInfo = await fetch(\`/api/credits/\${user.uid}\`).then(r => r.json());
        if (!creditInfo.success || creditInfo.credits <= 0) {
            // Show upgrade modal
            upgradeCurrent.textContent = creditInfo.credits || 0;
            upgradeModal.style.display = 'flex';
            return;
        }

        // Proceed with generation
        isGenerating = true;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const formData = new FormData();
            formData.append('prompt', prompt);
            if (uploadedImage) {
                formData.append('image', uploadedImage);
            }

            const idToken = await user.getIdToken();
            const response = await fetch('/api/generate-image', {
                method: 'POST',
                headers: { 'Authorization': \`Bearer \${idToken}\` },
                body: formData
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Generation failed');
            }

            // Show generated image
            modalImg.src = result.imageUrl;
            modal.classList.add('active');
            // Update remaining credits
            creditDisplay.textContent = result.remainingCredits;

            // Clear input and image
            promptInput.value = '';
            promptInput.style.height = 'auto';
            previewContainer.style.display = 'none';
            previewImg.src = '';
            fileInput.value = '';
            uploadedImage = null;

            showNotification('Image generated successfully!', 'success');
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            isGenerating = false;
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-arrow-right"></i>';
        }
    });

    // Modal controls
    modalClose.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });
    downloadBtn.addEventListener('click', function() {
        const link = document.createElement('a');
        link.href = modalImg.src;
        link.download = 'generated-image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // Upgrade modal
    upgradeClose.addEventListener('click', () => upgradeModal.style.display = 'none');
    upgradeModal.addEventListener('click', (e) => {
        if (e.target === upgradeModal) upgradeModal.style.display = 'none';
    });

    upgradePayBtn.addEventListener('click', async function() {
        const user = await getCurrentUser();
        if (!user) {
            showNotification('Please login first.', 'error');
            return;
        }
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating order...';

        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/top-up-credits', {
                method: 'POST',
                headers: { 'Authorization': \`Bearer \${idToken}\` }
            });
            const data = await res.json();
            if (!data.success) throw new Error('Failed to create order');

            if (data.isDemo) {
                // Demo mode: add credits directly
                const verifyRes = await fetch('/api/verify-topup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: data.orderId,
                        paymentId: 'demo_pay_' + Date.now(),
                        signature: 'demo_signature',
                        userId: user.uid
                    })
                });
                const verifyData = await verifyRes.json();
                if (verifyData.success) {
                    showNotification('Added 50 credits (demo)!', 'success');
                    upgradeModal.style.display = 'none';
                    fetchCredits();
                } else {
                    throw new Error('Demo verification failed');
                }
            } else {
                // Real Razorpay checkout
                if (typeof Razorpay === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }
                const options = {
                    key: data.keyId,
                    amount: data.amount,
                    currency: data.currency,
                    name: 'Tools Prompt',
                    description: 'Top-up 50 credits',
                    order_id: data.orderId,
                    handler: async function(response) {
                        try {
                            const verifyRes = await fetch('/api/verify-topup', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    orderId: response.razorpay_order_id,
                                    paymentId: response.razorpay_payment_id,
                                    signature: response.razorpay_signature,
                                    userId: user.uid
                                })
                            });
                            const verifyData = await verifyRes.json();
                            if (verifyData.success) {
                                showNotification('Credits added!', 'success');
                                upgradeModal.style.display = 'none';
                                fetchCredits();
                            } else {
                                throw new Error('Verification failed');
                            }
                        } catch (e) {
                            showNotification('Top-up failed: ' + e.message, 'error');
                        }
                    },
                    modal: {
                        ondismiss: function() {
                            showNotification('Payment cancelled', 'info');
                        }
                    },
                    theme: { color: '#4e54c8' },
                    prefill: {
                        email: user.email,
                        name: user.displayName || user.email
                    }
                };
                const rzp = new Razorpay(options);
                rzp.open();
            }
        } catch (error) {
            showNotification('Upgrade error: ' + error.message, 'error');
        } finally {
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-rupee-sign"></i> Pay ₹20 for 50 credits';
        }
    });

    // Keyboard shortcut: Ctrl+Enter to generate
    promptInput.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            generateBtn.click();
        }
    });

    // Expose fetchCredits for after top-up
    window.refreshCredits = fetchCredits;
})();
  `;

  // ==================== STICKY SOCIAL BADGES (Instagram + YouTube) ====================
const socialBadgesCSS = `
/* Sticky Social Badges Container - Left Side */
.social-badges-container {
    position: fixed;
    left: 20px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 9998;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

/* Toggle button */
.social-badges-toggle {
    background: rgba(255, 255, 255, 0.95);
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    transition: all 0.3s ease;
    color: #4e54c8;
    font-size: 1.2rem;
    margin-bottom: 6px;
    backdrop-filter: blur(5px);
    border: 2px solid rgba(255, 255, 255, 0.3);
}
.social-badges-toggle:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(78, 84, 200, 0.4);
}

/* Each badge */
.social-badge {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 50px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    font-family: 'Segoe UI', sans-serif;
    border: 2px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(5px);
    animation: social-shake 5s ease-in-out infinite;
    transform-origin: center;
    color: white;
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: auto;
}

/* Collapsed state: hide badges with a page‑turn effect */
.social-badges-container.collapsed .social-badge {
    opacity: 0;
    transform: scale(0.5) rotateY(90deg) translateY(-40px);
    pointer-events: none;
    animation: none;
}

.social-badges-container.collapsed .social-badges-toggle i {
    transform: rotate(180deg);
}

.social-badge:hover {
    transform: scale(1.1);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    border-color: rgba(255, 255, 255, 0.5);
    animation: none;
}

.social-badge i {
    font-size: 1.8rem;
    margin-bottom: 4px;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.social-badge .followers-text {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
}

.instagram-badge {
    background: linear-gradient(135deg, #405de6, #5851db, #833ab4, #c13584, #e1306c, #fd1d1d);
    background-size: 200% 200%;
    animation: social-shake 5s ease-in-out infinite, gradient-shift 3s ease infinite;
}

.youtube-badge {
    background: linear-gradient(135deg, #ff0000, #cc0000);
    background-size: 200% 200%;
    animation: social-shake 5s ease-in-out infinite 0.5s, gradient-shift 3s ease infinite 0.5s;
}

.whatsapp-badge {
    background: linear-gradient(135deg, #25d366, #128c7e);
    background-size: 200% 200%;
    animation: social-shake 5s ease-in-out infinite 1s, gradient-shift 3s ease infinite 1s;
}

@keyframes social-shake {
    0%, 88% { transform: scale(1); }
    90% { transform: scale(1.15); }
    92% { transform: scale(0.85); }
    94% { transform: scale(1.05); }
    96% { transform: scale(0.95); }
    98% { transform: scale(1.02); }
    100% { transform: scale(1); }
}

@keyframes gradient-shift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}

@media (max-width: 768px) {
    .social-badges-container {
        left: 10px;
        gap: 6px;
    }
    .social-badges-toggle {
        width: 34px;
        height: 34px;
        font-size: 1rem;
    }
    .social-badge {
        padding: 8px 10px;
        min-width: 38px;
        min-height: 38px;
    }
    .social-badge i {
        font-size: 1.4rem;
    }
    .social-badge .followers-text {
        font-size: 0.5rem;
    }
}

@media (max-width: 480px) {
    .social-badges-container {
        left: 6px;
        gap: 4px;
    }
    .social-badges-toggle {
        width: 28px;
        height: 28px;
        font-size: 0.8rem;
    }
    .social-badge {
        padding: 6px 8px;
        min-width: 32px;
        min-height: 32px;
    }
    .social-badge i {
        font-size: 1.2rem;
    }
    .social-badge .followers-text {
        font-size: 0.45rem;
    }
}
`;
const socialBadgesHTML = `
<!-- Sticky Social Badges with Toggle -->
<div class="social-badges-container" id="socialBadgesContainer">
    <button class="social-badges-toggle" id="socialToggleBtn" aria-label="Toggle social badges">
        <i class="fas fa-chevron-up"></i>
    </button>
    <a href="https://instagram.com/toolsprompt" target="_blank" class="social-badge instagram-badge" rel="noopener noreferrer">
        <i class="fab fa-instagram"></i>
        <span class="followers-text">10K Followers</span>
    </a>
    <a href="https://youtube.com/@toolsprompt" target="_blank" class="social-badge youtube-badge" rel="noopener noreferrer">
        <i class="fab fa-youtube"></i>
        <span class="followers-text">10K Subscribers</span>
    </a>
    <a href="https://wa.me/yourwhatsappnumber" target="_blank" class="social-badge whatsapp-badge" rel="noopener noreferrer">
        <i class="fab fa-whatsapp"></i>
        <span class="followers-text">10K Members</span>
    </a>
</div>
`;

  // ==================== SOCIAL FEED CSS ====================
  const socialFeedCSS = `
/* Social Feed Container - Right Side, Centered */
.social-feed-container {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    direction: rtl; /* panel appears to the left of toggle */
}
.social-feed-toggle {
    background: #4e54c8;
    color: white;
    border: none;
    border-radius: 8px 0 0 8px;
    padding: 12px 8px;
    cursor: pointer;
    font-size: 1.2rem;
    transition: all 0.3s ease;
    box-shadow: -2px 0 10px rgba(0,0,0,0.2);
    touch-action: manipulation;
    z-index: 10000;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
}
.social-feed-toggle:hover {
    background: #3f44b8;
    transform: scale(1.05);
}
.social-feed-toggle:active {
    transform: scale(0.95);
}
.social-feed-panel {
    width: 0;
    height: 0;
    background: white;
    border-radius: 8px 0 0 8px;
    box-shadow: -5px 0 20px rgba(0,0,0,0.15);
    overflow: hidden;
    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    display: flex;
    flex-direction: column;
    opacity: 0;
    direction: ltr; /* reset for content */
}
.social-feed-container.expanded .social-feed-panel {
    width: 400px;
    height: 60vh;
    max-height: 80vh;
    opacity: 1;
}

/* Mobile: keep right side, smaller panel */
@media (max-width: 768px) {
    .social-feed-container {
        top: 50%;
        transform: translateY(-50%);
        right: 0;
        left: auto;
        bottom: auto;
        flex-direction: row;
        align-items: center;
        height: auto;
    }
    .social-feed-toggle {
        border-radius: 8px 0 0 8px;
        padding: 12px 8px;
        position: static;
        bottom: auto;
        right: auto;
        width: auto;
        height: auto;
        box-shadow: -2px 0 10px rgba(0,0,0,0.2);
        font-size: 1.2rem;
        min-width: 44px;
        min-height: 44px;
    }
    .social-feed-container.expanded .social-feed-panel {
        width: 90vw;
        height: 90vh;
        max-height: 90vh;
        right: 0;
        bottom: auto;
        top: auto;
        border-radius: 0;
    }
}
@media (max-width: 480px) {
    .social-feed-container.expanded .social-feed-panel {
       width: 90vw;
        height: 90vh;
        max-height: 90vh;
        border-radius: 0;
    }
}
    .social-feed-panel {
        border-radius: 12px 12px 0 0;
        width: 100%;
        height: 0;
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
}

.feed-header {
    padding: 12px 16px;
    border-bottom: 1px solid #e9ecef;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f8f9fa;
}
.feed-header h3 { margin: 0; font-size: 1.1rem; color: #4e54c8; }
.feed-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #666; }

.feed-tabs {
    display: flex;
    background: #f8f9fa;
    border-bottom: 1px solid #e9ecef;
}
.feed-tab {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.3s ease;
}
.feed-tab.active {
    border-bottom-color: #4e54c8;
    color: #4e54c8;
}
.feed-tab:hover { background: rgba(78,84,200,0.05); }

.feed-content {
    flex: 1;
    overflow: hidden;
    position: relative;
}
.feed-tab-content {
    display: none;
    height: 100%;
    overflow-y: auto;
    padding: 10px;
}
.feed-tab-content.active { display: block; }

/* Make actions visible on hover over the whole message */
.chat-message {
    position: relative;
    transition: background 0.2s ease;
}
.chat-message:hover .msg-actions {
    display: flex;
}
.msg-actions {
    position: absolute;
    right: 5px;
    top: 5px;
    display: none;
    flex-direction: row;
    gap: 4px;
    background: rgba(255,255,255,0.9);
    border-radius: 20px;
    padding: 4px 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.msg-actions button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    padding: 2px 6px;
    border-radius: 12px;
    transition: background 0.2s;
}
.msg-actions button:hover {
    background: #e9ecef;
}
/* Reply context styling */
.msg-reply-context {
    font-size: 0.8rem;
    color: #666;
    background: #f1f3f4;
    padding: 2px 8px;
    border-radius: 8px;
    margin-bottom: 4px;
    border-left: 3px solid #4e54c8;
}
/* Sticker display */
.msg-sticker {
    font-size: 2.5rem;
    line-height: 1.2;
    padding: 4px 0;
}

/* Chat Messages */
.chat-messages {
    height: calc(100% - 80px);
    overflow-y: auto;
    padding: 10px;
}
.chat-message {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 12px;
    background: #f1f3f4;
    max-width: 85%;
    word-wrap: break-word;
    position: relative;
}
.chat-message.own {
    background: #4e54c8;
    color: white;
    margin-left: auto;
}
.chat-message .msg-user { font-size: 0.8rem; font-weight: 600; margin-bottom: 2px; }
.chat-message .msg-time { font-size: 0.7rem; color: #999; float: right; }
.chat-message .msg-content { line-height: 1.4; }
.chat-message .msg-reactions { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; }
.chat-message .msg-reactions span { background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 12px; font-size: 0.8rem; cursor: pointer; }
.chat-message .msg-actions { position: absolute; right: -30px; top: 0; display: none; }
.chat-message:hover .msg-actions { display: flex; flex-direction: column; gap: 4px; }
.chat-message .msg-actions button { background: none; border: none; cursor: pointer; font-size: 0.9rem; color: #666; }

/* Chat Input */
.chat-input-area {
    padding: 8px 10px;
    border-top: 1px solid #e9ecef;
    background: #f8f9fa;
}
.reply-indicator {
    background: #e9ecef;
    padding: 6px 10px;
    border-radius: 8px;
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
}
.chat-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
}
.chat-input-row input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 20px;
    outline: none;
}
.chat-input-row button {
    background: #4e54c8;
    color: white;
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.3s ease;
}
.chat-input-row button:hover { background: #3f44b8; }
.sticker-btn { background: #e9ecef; color: #666; }

/* Sticker Picker */
.sticker-picker {
    display: none;
    position: absolute;
    bottom: 60px;
    left: 0;
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 12px;
    padding: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
}
.sticker-picker.open { display: grid; }
.sticker-picker button {
    background: none;
    border: none;
    font-size: 2rem;
    cursor: pointer;
    transition: transform 0.2s ease;
}
.sticker-picker button:hover { transform: scale(1.2); }

/* Reaction Picker (popup) */
.reaction-picker {
    display: none;
    position: absolute;
    background: white;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    padding: 6px 10px;
    gap: 6px;
    z-index: 10;
}
.reaction-picker.open { display: flex; }
.reaction-picker button {
    background: none;
    border: none;
    font-size: 1.6rem;
    cursor: pointer;
    transition: transform 0.2s ease;
}
.reaction-picker button:hover { transform: scale(1.3); }

/* Activity Feed */
.activity-item {
    padding: 10px;
    border-bottom: 1px solid #e9ecef;
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.activity-item .act-icon { font-size: 1.5rem; color: #4e54c8; }
.activity-item .act-content { flex: 1; }
.activity-item .act-content h4 { margin: 0; font-size: 0.95rem; }
.activity-item .act-content p { margin: 2px 0; font-size: 0.85rem; color: #666; }
.activity-item .act-time { font-size: 0.7rem; color: #999; }

/* Floating Hearts Animation */
.floating-hearts {
    position: fixed;
    pointer-events: none;
    z-index: 99999;
    font-size: 2rem;
    animation: floatUp 1.5s ease-out forwards;
}
@keyframes floatUp {
    0% { opacity: 1; transform: translateY(0) scale(0.8); }
    100% { opacity: 0; transform: translateY(-150px) scale(1.2); }
}
`;

   // ==================== SOCIAL FEED HTML ====================
  const socialFeedHTML = `
<!-- Social Feed – Right Side, Centered -->
<div class="social-feed-container" id="socialFeed">
    <button class="social-feed-toggle" id="feedToggle" onclick="toggleFeed()" aria-label="Toggle community feed">
        <i class="fas fa-chevron-left" id="feedToggleIcon"></i>
    </button>
    <div class="social-feed-panel">
        <div class="feed-header">
            <h3><i class="fas fa-users"></i>Community</h3>
            <button class="feed-close" onclick="toggleFeed()"><i class="fas fa-times"></i></button>
        </div>
        <div class="feed-tabs">
            <button class="feed-tab active" data-tab="chat">💬 Chat</button>
            <button class="feed-tab" data-tab="feed">📢 Feed</button>
            <button class="feed-tab" data-tab="suggest">💡 Suggest</button>
        </div>
        <div class="feed-content">
            <!-- Chat Tab -->
            <div class="feed-tab-content active" id="tab-chat">
                <div class="chat-messages" id="chatMessages"></div>
                <div class="chat-input-area">
                    <div class="reply-indicator" id="replyIndicator" style="display:none;">
                        Replying to <span id="replyUser"></span>: <span id="replyContent"></span>
                        <button onclick="cancelReply()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="chat-input-row">
                        <button class="sticker-btn" onclick="openStickerPicker()"><i class="fas fa-sticky-note"></i></button>
                        <input type="text" id="chatInput" placeholder="Type a message..." />
                        <button onclick="sendChatMessage()"><i class="fas fa-paper-plane"></i></button>
                    </div>
                    <!-- Sticker Picker -->
                    <div class="sticker-picker" id="stickerPicker">
                        <button onclick="sendSticker('😊')">😊</button>
                        <button onclick="sendSticker('😂')">😂</button>
                        <button onclick="sendSticker('❤️')">❤️</button>
                        <button onclick="sendSticker('🔥')">🔥</button>
                        <button onclick="sendSticker('👍')">👍</button>
                        <button onclick="sendSticker('🎉')">🎉</button>
                        <button onclick="sendSticker('💯')">💯</button>
                        <button onclick="sendSticker('🤩')">🤩</button>
                    </div>
                </div>
            </div>
            <!-- Feed Tab -->
            <div class="feed-tab-content" id="tab-feed">
                <div class="activity-feed" id="activityFeed"></div>
            </div>
            <!-- Suggest Tab -->
            <div class="feed-tab-content" id="tab-suggest">
                <div class="suggest-area">
                    <p>Have a prompt idea? Share it with the community!</p>
                    <textarea id="suggestInput" rows="3" placeholder="Describe the prompt you'd like to see..."></textarea>
                    <button onclick="submitSuggestion()">Submit Suggestion</button>
                    <div class="suggest-notes" id="suggestNotes"></div>
                </div>
            </div>
        </div>
    </div>
</div>  `;

  // ==================== SOCIAL FEED JAVASCRIPT (GLOBAL) ====================
const socialFeedJS = `
// -------- GLOBAL SOCIAL FEED FUNCTIONS --------
let feedExpanded = false;
let replyTo = null;
let messageCache = [];
let activityCache = [];
let eventSource = null;
let currentUserId = null, currentUserName = null;

console.log('✅ Social feed JS loaded');

// Toggle feed (called from the toggle button and close button)
window.toggleFeed = function() {
    feedExpanded = !feedExpanded;
    document.getElementById('socialFeed').classList.toggle('expanded', feedExpanded);
    const icon = document.getElementById('feedToggleIcon');
    if (icon) {
        icon.className = feedExpanded ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
    }
    if (feedExpanded) {
        loadMessages();
        loadActivity();
        connectSSE();
    } else {
        if (eventSource) eventSource.close();
    }
};

// Tab switching
document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.feed-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + this.dataset.tab).classList.add('active');
    });
});

// ---- Chat ----
async function loadMessages() {
    try {
        const res = await fetch('/api/chat/messages?limit=50');
        const data = await res.json();
        messageCache = data.messages || [];
        renderMessages();
    } catch(e) { console.error('Load messages error:', e); }
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    messageCache.forEach(msg => {
        const el = createMessageElement(msg);
        container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
}

// -------- FIXED: createMessageElement with sticker & reply support --------
function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = 'chat-message' + (msg.userId === currentUserId ? ' own' : '');
    div.dataset.id = msg.id;
    
    // Check for parent (reply)
    let parentHtml = '';
    if (msg.parentId) {
        const parentMsg = messageCache.find(m => m.id === msg.parentId);
        if (parentMsg) {
            parentHtml = \`<div class="msg-reply-context">↳ Replying to <strong>\${escapeHtml(parentMsg.userName)}</strong>: \${escapeHtml(parentMsg.content || parentMsg.sticker || '')}</div>\`;
        }
    }
    
    // Check for sticker
    let contentHtml = '';
    if (msg.sticker) {
        contentHtml = \`<div class="msg-sticker" style="font-size: 3rem; line-height: 1.2;">\${msg.sticker}</div>\`;
    } else {
        contentHtml = \`<div class="msg-content">\${escapeHtml(msg.content)}</div>\`;
    }
    
    div.innerHTML = \`
        <div class="msg-user">\${escapeHtml(msg.userName)}</div>
        \${parentHtml}
        \${contentHtml}
        <div class="msg-time">\${timeAgo(msg.timestamp)}</div>
        <div class="msg-reactions">\${Object.keys(msg.reactions || {}).map(emoji => 
            \`<span onclick="reactToMessage('\${msg.id}','\${emoji}')">\${emoji} \${msg.reactions[emoji].length}</span>\`
        ).join('')}</div>
        <div class="msg-actions">
            <button onclick="showReactionPicker('\${msg.id}')"><i class="far fa-smile"></i></button>
            <button onclick="replyToMessage('\${msg.id}','\${escapeHtml(msg.userName)}','\${escapeHtml(msg.content || msg.sticker || '')}')"><i class="fas fa-reply"></i></button>
        </div>
    \`;
    return div;
}

// ---- FIXED: sendChatMessage includes parentId ----
window.sendChatMessage = function() {
    const chatInput = document.getElementById('chatInput');
    const content = chatInput.value.trim();
    if (!content && !replyTo) return;
    
    const payload = {
        userId: currentUserId,
        userName: currentUserName || 'Guest',
        content: content || '',
        parentId: replyTo ? replyTo.id : null
    };
    
    fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(() => {
        chatInput.value = '';
        cancelReply();
    }).catch(e => console.error('Send error:', e));
};

// ---- FIXED: sendSticker (now sends as sticker field) ----
window.sendSticker = function(sticker) {
    if (!sticker) return;
    const payload = {
        userId: currentUserId,
        userName: currentUserName || 'Guest',
        sticker: sticker,
        parentId: replyTo ? replyTo.id : null
    };
    fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(() => {
        document.getElementById('stickerPicker').classList.remove('open');
        cancelReply();
    }).catch(e => console.error('Sticker send error:', e));
};

// ---- FIXED: replyToMessage stores the target ----
window.replyToMessage = function(id, userName, content) {
    replyTo = { id, userName, content };
    const indicator = document.getElementById('replyIndicator');
    indicator.style.display = 'flex';
    document.getElementById('replyUser').textContent = userName;
    document.getElementById('replyContent').textContent = (content || 'sticker').substring(0, 40) + ((content || '').length > 40 ? '...' : '');
    document.getElementById('chatInput').focus();
};

// ---- FIXED: cancelReply clears replyTo ----
window.cancelReply = function() {
    replyTo = null;
    document.getElementById('replyIndicator').style.display = 'none';
};

// ---- FIXED: showReactionPicker stays open until selection ----
window.showReactionPicker = function(msgId) {
    const existing = document.querySelector('.reaction-picker');
    if (existing) existing.remove();
    
    const picker = document.createElement('div');
    picker.className = 'reaction-picker open';
    picker.style.position = 'absolute';
    picker.style.top = '0';
    picker.style.right = '0';
    picker.style.zIndex = '20';
    picker.innerHTML = ['❤️','😂','😮','😢','😡','👍'].map(emoji => 
        \`<button onclick="reactToMessage('\${msgId}','\${emoji}'); this.closest('.reaction-picker').remove();">\${emoji}</button>\`
    ).join('');
    
    const msgEl = document.querySelector(\`.chat-message[data-id="\${msgId}"]\`);
    if (msgEl) {
        msgEl.style.position = 'relative';
        msgEl.appendChild(picker);
        // Close picker when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closePicker(e) {
                if (!picker.contains(e.target) && e.target.closest('.chat-message') !== msgEl) {
                    picker.remove();
                    document.removeEventListener('click', closePicker);
                }
            });
        }, 100);
    }
};

// ---- reactToMessage (unchanged) ----
window.reactToMessage = function(msgId, emoji) {
    fetch('/api/chat/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId, userId: currentUserId, emoji })
    }).then(() => {
        if (emoji === '❤️') triggerFloatingHearts();
    }).catch(e => console.error('React error:', e));
};

// ---- Floating hearts (unchanged) ----
window.triggerFloatingHearts = function() {
    for (let i=0; i<10; i++) {
        setTimeout(() => {
            const heart = document.createElement('div');
            heart.className = 'floating-hearts';
            heart.textContent = '❤️';
            heart.style.left = (Math.random() * 60 + 20) + '%';
            heart.style.bottom = (Math.random() * 30 + 10) + 'vh';
            heart.style.fontSize = (Math.random() * 1.5 + 1.5) + 'rem';
            document.body.appendChild(heart);
            setTimeout(() => heart.remove(), 1500);
        }, i * 100);
    }
};

// ---- openStickerPicker (unchanged) ----
window.openStickerPicker = function() {
    const picker = document.getElementById('stickerPicker');
    if (picker) picker.classList.toggle('open');
};

// ---- submitSuggestion (unchanged) ----
window.submitSuggestion = function() {
    const text = document.getElementById('suggestInput').value.trim();
    if (!text) return;
    fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: currentUserId,
            userName: currentUserName || 'Guest',
            content: '💡 Suggestion: ' + text,
            parentId: null
        })
    }).then(() => {
        document.getElementById('suggestInput').value = '';
        document.querySelector('[data-tab="chat"]').click();
    }).catch(e => console.error('Suggestion error:', e));
};

// ---- SSE (unchanged) ----
function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/api/chat/stream');
    eventSource.onmessage = function(e) {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
            messageCache = data.messages || [];
            renderMessages();
        } else if (data.type === 'message') {
            messageCache.push(data.message);
            renderMessages();
            const chatTab = document.getElementById('tab-chat');
            if (chatTab.classList.contains('active')) {
                document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
            }
        } else if (data.type === 'reaction') {
            const msg = messageCache.find(m => m.id === data.messageId);
            if (msg) msg.reactions = data.reactions;
            renderMessages();
        } else if (data.type === 'activity') {
            activityCache.unshift(data.activity);
            renderActivity();
        }
    };
    eventSource.onerror = function() {
        console.log('SSE error, reconnecting...');
        setTimeout(() => connectSSE(), 3000);
    };
}

// ---- Activity Feed (unchanged) ----
async function loadActivity() {
    try {
        const res = await fetch('/api/activity?limit=20');
        const data = await res.json();
        activityCache = data.items || [];
        renderActivity();
    } catch(e) { console.error('Load activity error:', e); }
}

function renderActivity() {
    const container = document.getElementById('activityFeed');
    container.innerHTML = activityCache.map(item => \`
        <div class="activity-item">
            <div class="act-icon">\${item.type === 'upload' ? '📸' : '📢'}</div>
            <div class="act-content">
                <h4>\${item.type === 'upload' ? 'New Prompt Uploaded' : 'Platform Update'}</h4>
                <p>\${item.title || 'Untitled'} by \${item.userName || 'Anonymous'}</p>
                <div class="act-time">\${timeAgo(item.timestamp)}</div>
            </div>
        </div>
    \`).join('');
}

// ---- Helpers (unchanged) ----
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs/24) + 'd';
}

// ---- Current user (unchanged) ----
if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            currentUserId = user.uid;
            currentUserName = user.displayName || user.email || 'User';
        } else {
            currentUserId = 'guest-' + Date.now();
            currentUserName = 'Guest';
        }
    });
} else {
    currentUserId = 'guest-' + Date.now();
    currentUserName = 'Guest';
}
`;
  return `<!DOCTYPE html>
<html lang="en" itemscope itemtype="https://schema.org/Article">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${googleAnalyticsCode}
    <title>${promptData.seoTitle}</title>
    <meta name="description" content="${promptData.metaDescription}">
    <meta name="keywords" content="${(promptData.keywords || []).join(', ')}">
    <meta name="robots" content="index, follow, max-image-preview:large">
    
    <meta property="og:title" content="${promptData.seoTitle}">
    <meta property="og:description" content="${promptData.metaDescription}">
    <meta property="og:image" content="${promptData.imageUrl}">
    <meta property="og:url" content="${promptUrl}">
    <meta property="og:type" content="${isVideo ? 'video.other' : 'article'}">
    ${isVideo ? `<meta property="og:video" content="${promptData.videoUrl || promptData.mediaUrl}">` : ''}
    <meta property="og:site_name" content="tools prompt">
    
    <meta name="twitter:card" content="${isVideo ? 'player' : 'summary_large_image'}">
    <meta name="twitter:title" content="${promptData.seoTitle}">
    <meta name="twitter:description" content="${promptData.metaDescription}">
    <meta name="twitter:image" content="${promptData.imageUrl}">
    ${isVideo ? `<meta name="twitter:player" content="${promptData.videoUrl || promptData.mediaUrl}">` : ''}
    
    <link rel="canonical" href="${promptUrl}" />
    
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "${isVideo ? 'VideoObject' : 'HowTo'}",
      "name": "How to Use: ${promptData.title.replace(/"/g, '\\"')}",
      "description": "${promptData.metaDescription.replace(/"/g, '\\"')}",
      ${isVideo ? `
      "thumbnailUrl": "${promptData.imageUrl}",
      "contentUrl": "${promptData.videoUrl || promptData.mediaUrl}",
      "uploadDate": "${promptData.createdAt}",
      "duration": "PT${promptData.videoDuration || 10}S",
      ` : `
      "image": "${promptData.imageUrl}",
      "totalTime": "PT5M",
      "estimatedCost": {
        "@type": "MonetaryAmount",
        "currency": "USD",
        "value": "0"
      },
      `}
      "step": [
        ${(promptData.stepByStepInstructions || []).map((step, index) => `{
          "@type": "HowToStep",
          "position": ${index + 1},
          "name": "Step ${index + 1}",
          "text": "${step.replace(/"/g, '\\"')}"
        }`).join(',')}
      ]
    }
    </script>
    
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.1/firebase-auth-compat.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f5f7fa; line-height: 1.6; color: #2d334a; }
        
        ${miniBrowserCSS}
        ${platformComparisonCSS}
        ${commentSystemCSS}
        ${downloadAppCSS}
        ${aiGeneratorCSS}
        ${socialBadgesCSS}
        ${socialFeedCSS}
        
        /* Ad Container Styles */
        .ad-container {
            margin: 20px 0;
            text-align: center;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 12px;
            border: 1px solid #e9ecef;
        }
        
        .ad-label {
            font-size: 0.75rem;
            color: #6c757d;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .ad-banner-desktop {
            display: block;
        }
        
        .ad-banner-mobile {
            display: none;
        }
        
        .shorts-video-container {
            width: 100%;
            height: 500px;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }
        
        .shorts-video-container video {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        
        .video-duration {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10;
        }
        
        .ai-model-badge {
            background: #4e54c8;
            color: white;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            margin-left: 10px;
        }
        
        .price-badge {
            position: absolute;
            top: 10px;
            left: 10px;
            background: linear-gradient(135deg, #ff6b6b 0%, #ff8787 100%);
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
            z-index: 15;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        
        .price-badge.free {
            background: linear-gradient(135deg, #20bf6b 0%, #4cd964 100%);
        }
        
        /* Buy Modal Styles */
        .buy-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
            animation: fadeIn 0.3s ease;
        }
        
        .buy-modal {
            background: white;
            border-radius: 15px;
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow-y: auto;
            animation: slideUp 0.3s ease;
        }
        
        .buy-modal-content {
            padding: 20px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
        }
        
        .prompt-preview {
            text-align: center;
        }
        
        .buy-prompt-image {
            width: 100%;
            max-height: 200px;
            object-fit: cover;
            border-radius: 8px;
            margin-bottom: 15px;
        }
        
        .prompt-price-large {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b6b;
            margin: 10px 0;
        }
        
        .prompt-creator {
            color: #666;
            font-size: 0.9rem;
        }
        
        .payment-form {
            padding: 0 15px;
        }
        
        .payment-form h3 {
            margin-bottom: 15px;
            color: #2d334a;
            font-size: 1.1rem;
        }
        
        .payment-form .form-group {
            margin-bottom: 15px;
        }
        
        .payment-form .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #2d334a;
            font-size: 0.9rem;
        }
        
        .payment-form .form-group input,
        .payment-form .form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 0.95rem;
            transition: all 0.3s ease;
        }
        
        .payment-form .form-group input:focus,
        .payment-form .form-group select:focus {
            outline: none;
            border-color: #4e54c8;
            box-shadow: 0 0 0 3px rgba(78, 84, 200, 0.1);
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        
        .buy-now-btn {
            width: 100%;
            background: linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%);
            color: white;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            margin-top: 15px;
            transition: all 0.3s ease;
        }
        
        .buy-now-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(78,84,200,0.3);
        }
        
        .buy-now-btn:disabled {
            opacity: 0.7;
            cursor: not-allowed;
            transform: none;
        }
        
        .secure-payment {
            text-align: center;
            margin-top: 15px;
            font-size: 0.8rem;
            color: #666;
        }
        
        .secure-payment i {
            color: #20bf6b;
            margin-right: 5px;
        }
        
        .payment-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            text-align: center;
        }
        
        .modal-header {
            padding: 20px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            background: white;
            z-index: 1;
        }
        
        .modal-header h2 {
            color: #4e54c8;
            font-size: 1.3rem;
        }
        
        .close-modal {
            background: none;
            border: none;
            font-size: 1.8rem;
            cursor: pointer;
            color: #666;
            transition: color 0.3s ease;
        }
        
        .close-modal:hover {
            color: #ff6b6b;
        }
        
        @media (max-width: 768px) {
            .buy-modal-content {
                grid-template-columns: 1fr;
                gap: 20px;
            }
            
            .form-row {
                grid-template-columns: 1fr;
            }
            
            .shorts-video-container {
                height: 400px;
            }
            
            .ad-banner-desktop {
                display: none;
            }
            
            .ad-banner-mobile {
                display: block;
            }
        }
        
        @media (max-width: 480px) {
            .shorts-video-container {
                height: 350px;
            }
        }
        
        .content-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin-top: 1rem;
        }

        .related-prompt-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            border: 1px solid #e9ecef;
            position: relative;
        }

        .related-prompt-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.15);
        }

        .related-prompt-image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            display: block;
        }

        .related-prompt-content {
            padding: 1.25rem;
        }

        .related-prompt-content h4 {
            color: #2d334a;
            margin-bottom: 1rem;
            font-size: 1.1rem;
            line-height: 1.4;
            min-height: 3em;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        @media (max-width: 768px) {
            .content-grid {
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1rem;
            }
            
            .related-prompt-image {
                height: 180px;
            }
        }

        @media (max-width: 480px) {
            .content-grid {
                grid-template-columns: 1fr;
            }
        }

        .site-header { 
            background: white; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            position: sticky;
            top: 0;
            z-index: 1000;
            padding: 0.5rem 0;
        }
        .header-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
        }
        .logo { 
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 1.25rem; 
            font-weight: bold; 
            color: #4e54c8; 
            text-decoration: none;
            flex-shrink: 0;
        }
        .logo img {
            width: 40px;
            height: 40px;
            border-radius: 8px;
        }
        .nav-links {
            display: flex;
            gap: 1.5rem;
            list-style: none;
            flex-wrap: wrap;
        }
        .nav-links a {
            text-decoration: none;
            color: #333;
            font-weight: 500;
            transition: color 0.3s ease;
            white-space: nowrap;
            font-size: 0.9rem;
        }
        .nav-links a:hover {
            color: #4e54c8;
        }
        
        .main-container { 
            max-width: 1200px; 
            margin: 1rem auto; 
            padding: 0 1rem;
        }
        .prompt-article {
            background: white;
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .article-header {
            padding: 1.5rem;
            border-bottom: 1px solid #eee;
        }
        .user-info { 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            margin-bottom: 15px; 
            color: #666; 
            font-size: 0.9rem; 
            flex-wrap: wrap; 
        }
        .article-title {
            color: #4e54c8; 
            margin-bottom: 1rem; 
            font-size: 1.75rem; 
            line-height: 1.3;
            word-wrap: break-word;
        }
        
        .prompt-image { 
            width: 100%; 
            height: auto; 
            max-height: 500px;
            object-fit: cover; 
            background: #f0f4f8; 
        }
        
        .prompt-content { 
            padding: 1.5rem;
        }
        .content-section {
            margin-bottom: 1.5rem;
            padding: 1.5rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .section-title {
            color: #2d334a;
            margin-bottom: 1rem;
            font-size: 1.3rem;
        }
        .prompt-text { 
            white-space: pre-wrap; 
            font-family: 'Courier New', monospace; 
            background: #f8f9fa; 
            padding: 1.5rem; 
            border-radius: 8px; 
            border-left: 4px solid #4e54c8; 
            font-size: 1rem; 
            line-height: 1.5;
            overflow-x: auto;
            cursor: pointer;
            user-select: text;
        }
        
        .prompt-text-wrapper {
            position: relative;
        }
        
        .copy-hint {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(78, 84, 200, 0.8);
            color: white;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.75rem;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }
        
        .prompt-text-wrapper:hover .copy-hint {
            opacity: 1;
        }
        
        .prompt-meta { 
            display: flex; 
            gap: 1.5rem; 
            margin: 1.5rem 0; 
            padding: 1.5rem; 
            background: #f8f9fa; 
            border-radius: 10px; 
            flex-wrap: wrap; 
        }
        .meta-item { 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            font-size: 0.9rem;
        }
        .meta-item strong { 
            color: #4e54c8; 
            font-weight: 600; 
        }
        
        .engagement-buttons { 
            display: flex; 
            gap: 1rem; 
            margin: 1.5rem 0; 
            flex-wrap: wrap; 
        }
        .engagement-btn { 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            padding: 10px 20px; 
            border: 2px solid #4e54c8; 
            border-radius: 25px; 
            background: white; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-decoration: none; 
            color: inherit; 
            font-weight: 500;
            font-size: 0.9rem;
        }
        .engagement-btn:hover { 
            background: #4e54c8; 
            color: white; 
            transform: translateY(-2px); 
        }
        
        .platform-intro {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 15px;
            margin: 1.5rem 0;
            position: relative;
            overflow: hidden;
        }

        .platform-intro::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -50%;
            width: 100%;
            height: 200%;
            background: rgba(255,255,255,0.1);
            transform: rotate(45deg);
        }

        .platform-intro p {
            position: relative;
            z-index: 1;
            font-size: 1.1rem;
            line-height: 1.7;
            margin: 0;
        }
        
        .instruction-steps {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        
        .instruction-step {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            padding: 1.5rem;
            background: #f8f9fa;
            border-radius: 12px;
            border-left: 5px solid #4e54c8;
            transition: all 0.3s ease;
        }
        
        .instruction-step:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .step-number {
            background: #4e54c8;
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            flex-shrink: 0;
        }
        
        .step-content strong {
            color: #4e54c8;
            display: block;
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
        }
        
        .tips-list {
            list-style: none;
            padding: 0;
        }
        
        .tips-list li {
            padding: 0.5rem 0;
            border-bottom: 1px solid #eee;
            position: relative;
            padding-left: 1.5rem;
        }
        
        .tips-list li:before {
            content: "💡";
            position: absolute;
            left: 0;
        }
        
        .engagement-stats-small {
            display: flex;
            gap: 1.5rem;
            margin: 1rem 0;
            justify-content: center;
            flex-wrap: wrap;
        }

        .stat-item-small {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.25rem;
            padding: 0.75rem;
            background: rgba(78, 84, 200, 0.1);
            border-radius: 8px;
            min-width: 80px;
        }

        .stat-item-small i {
            color: #4e54c8;
            font-size: 1.25rem;
        }

        .stat-number-small {
            font-size: 1.25rem;
            font-weight: bold;
            color: #2d334a;
        }

        .stat-label-small {
            font-size: 0.75rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .copy-prompt-container {
            position: relative;
            margin: 1rem 0;
        }

        .copy-prompt-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%);
            color: white;
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(78, 84, 200, 0.4);
            transition: all 0.3s ease;
            z-index: 10;
        }

        .copy-prompt-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(78, 84, 200, 0.6);
            background: linear-gradient(135deg, #3b41b5 0%, #7c82f0 100%);
        }

        .copy-prompt-btn:active {
            transform: translateY(0);
            box-shadow: 0 2px 10px rgba(78, 84, 200, 0.4);
        }

        .copy-prompt-btn.copied {
            background: linear-gradient(135deg, #20bf6b 0%, #4cd964 100%);
        }

        .copy-prompt-btn.copied i {
            animation: checkmark 0.5s ease;
        }

        @keyframes checkmark {
            0% { transform: scale(0); }
            50% { transform: scale(1.5); }
            100% { transform: scale(1); }
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideUp {
            from { transform: translateY(50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }

        @media (max-width: 768px) {
            .engagement-stats-small {
                gap: 1rem;
            }
            
            .stat-item-small {
                padding: 0.5rem;
                min-width: 70px;
            }
            
            .article-title {
                font-size: 1.5rem;
            }
            
            .shorts-video-container {
                height: 300px;
            }
            
            .prompt-image {
                max-height: 300px;
            }
            
            .instruction-step {
                flex-direction: column;
                text-align: center;
            }
            
            .step-number {
                align-self: center;
            }
            
            .copy-prompt-btn {
                padding: 6px 12px;
                font-size: 0.8rem;
                position: static;
                width: 100%;
                justify-content: center;
                margin-top: 10px;
            }
        }
        
        @media (max-width: 480px) {
            .article-title {
                font-size: 1.3rem;
            }
            
            .shorts-video-container {
                height: 250px;
            }
            
            .prompt-image {
                max-height: 250px;
            }
            
            .prompt-text {
                padding: 1rem;
                font-size: 0.9rem;
            }
        }
        
        .site-footer {
            background: #2d334a;
            color: white;
            padding: 2rem 1rem;
            margin-top: 3rem;
        }
        .footer-container {
            max-width: 1200px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
        }
        .footer-section h3 {
            margin-bottom: 1rem;
            color: #4e54c8;
        }
        .footer-links {
            list-style: none;
        }
        .footer-links li {
            margin-bottom: 0.5rem;
        }
        .footer-links a {
            color: #ccc;
            text-decoration: none;
            transition: color 0.3s ease;
        }
        .footer-links a:hover {
            color: #4e54c8;
        }
        .copyright {
            text-align: center;
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid #444;
            color: #888;
        }
        
        .copy-notification {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10001;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideInRight 0.3s ease;
            font-size: 0.9rem;
        }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes slideUpFade {
            from { opacity: 0; transform: translateX(-50%) translateY(30px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        
        @keyframes pulse {
            0% { transform: translateX(-50%) scale(1); box-shadow: 0 8px 25px rgba(78, 84, 200, 0.4); }
            50% { transform: translateX(-50%) scale(1.08); box-shadow: 0 12px 35px rgba(78, 84, 200, 0.7); }
            100% { transform: translateX(-50%) scale(1); box-shadow: 0 8px 25px rgba(78, 84, 200, 0.4); }
        }
        
        .download-notification {
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #20bf6b;
            color: white;
            padding: 10px 20px;
            border-radius: 50px;
            z-index: 10001;
            font-size: 0.9rem;
            font-weight: 500;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            white-space: nowrap;
        }
        
        /* Affiliate Styles */
        .affiliate-container {
            margin: 20px 0;
            padding: 15px;
            background: #fff;
            border-radius: 12px;
            border: 1px solid #e9ecef;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            transition: transform 0.2s ease;
        }
        .affiliate-container:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.1);
        }
        .affiliate-link {
            display: flex;
            align-items: center;
            gap: 15px;
            text-decoration: none;
            color: inherit;
        }
        .affiliate-image {
            width: 80px;
            height: 80px;
            object-fit: cover;
            border-radius: 8px;
            flex-shrink: 0;
        }
        .affiliate-info {
            flex: 1;
        }
        .affiliate-info h4 {
            margin: 0 0 5px 0;
            color: #2d334a;
            font-size: 1.05rem;
        }
        .affiliate-info p {
            margin: 0;
            color: #666;
            font-size: 0.9rem;
            line-height: 1.4;
        }
        .affiliate-cta {
            background: #4e54c8;
            color: white;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            white-space: nowrap;
            display: inline-block;
            margin-top: 4px;
        }
        @media (max-width: 768px) {
            .affiliate-link {
                flex-direction: column;
                text-align: center;
            }
            .affiliate-image {
                width: 100%;
                height: auto;
                max-height: 150px;
            }

        }

/* ── User Profile & Avatar Styles ── */
.user-profile {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #f8f9fa;
    padding: 5px 15px 5px 10px;
    border-radius: 40px;
    border: 1px solid #e9ecef;
    transition: all 0.3s ease;
}
.user-profile:hover {
    border-color: #4e54c8;
    box-shadow: 0 2px 12px rgba(78,84,200,0.15);
}
.user-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    flex-shrink: 0;
}
.user-profile span {
    font-weight: 500;
    color: #2d334a;
    font-size: 0.95rem;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.logout-btn {
    background: none;
    border: none;
    color: #ff6b6b;
    cursor: pointer;
    font-size: 1rem;
    padding: 6px 8px;
    border-radius: 50%;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
}
.logout-btn:hover {
    background: #ffeaea;
    transform: scale(1.1);
    color: #e03131;
}
.logout-btn i {
    font-size: 1rem;
}

/* Mini version for prompt pages */
.user-profile-mini {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f8f9fa;
    padding: 4px 12px 4px 8px;
    border-radius: 40px;
    border: 1px solid #e9ecef;
    transition: all 0.3s ease;
}
.user-profile-mini:hover {
    border-color: #4e54c8;
}
.user-avatar-mini {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #4e54c8, #8f94fb);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
}
.user-name-mini {
    font-weight: 500;
    color: #2d334a;
    font-size: 0.85rem;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.logout-btn-mini {
    background: none;
    border: none;
    color: #ff6b6b;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 4px 6px;
    border-radius: 50%;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
}
.logout-btn-mini:hover {
    background: #ffeaea;
    transform: scale(1.1);
    color: #e03131;
}
.logout-btn-mini i {
    font-size: 0.85rem;
}

/* Login button in header */
.login-btn-header {
    background: linear-gradient(135deg, #4e54c8, #8f94fb);
    color: #fff;
    padding: 8px 20px;
    border-radius: 30px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9rem;
    transition: all 0.3s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}
.login-btn-header:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(78,84,200,0.35);
    color: #fff;
}

/* Responsive tweaks */
@media (max-width: 768px) {
    .user-profile span {
        max-width: 80px;
        font-size: 0.85rem;
    }
    .user-avatar {
        width: 30px;
        height: 30px;
    }
    .user-profile {
        padding: 4px 10px 4px 6px;
        gap: 8px;
    }
    .logout-btn {
        width: 28px;
        height: 28px;
        font-size: 0.85rem;
    }
    .user-name-mini {
        max-width: 70px;
        font-size: 0.8rem;
    }
    .user-avatar-mini {
        width: 28px;
        height: 28px;
        font-size: 0.8rem;
    }
    .login-btn-header {
        padding: 6px 14px;
        font-size: 0.8rem;
    }
}
@media (max-width: 480px) {
    .user-profile span {
        display: none;
    }
    .user-profile {
        padding: 4px 8px;
        gap: 4px;
    }
    .user-name-mini {
        display: none;
    }
    .user-profile-mini {
        padding: 4px 8px;
        gap: 4px;
    }
}
    </style>
</head>
<body>
    <header class="site-header">
        <div class="header-container">
            <a href="https://www.toolsprompt.com" class="logo">
                <img src="https://www.toolsprompt.com/logo.png" alt="tools prompt Logo">
                <span>Tools prompt</span>
            </a>
            
            <nav>
                <ul class="nav-links">
                    <li><a href="https://www.toolsprompt.com/">Home</a></li>
                    <li><a href="https://www.toolsprompt.com/#promptsContainer">Browse</a></li>
                    <li><a href="https://www.toolsprompt.com/news.html">News</a></li>
                    <li><a href="https://www.toolsprompt.com/ai-detector.html">Tools</a></li>
                    <li><a href="https://www.toolsprompt.com/dashboard.html">Dashboard</a></li>
                </ul>
            </nav>
            
            <div class="auth-section" id="authSection">
                <a href="https://www.toolsprompt.com/login.html" class="login-btn-header">Login / Register</a>
            </div>
        </div>
    </header>

    <main class="main-container">
        <article class="prompt-article">
            <div class="article-header">
                <div class="user-info">
                    <i class="fas fa-user-circle"></i>
                    <span>Created by: ${promptData.userName}</span>
                    ${platformBadge}
                    ${priceBadge}
                    ${promptData.seoScore ? '<span style="background: #20bf6b; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; margin-left: 10px;">tools prompt: ' + promptData.seoScore + '/100</span>' : ''}
                    ${isVideo && promptData.hasCustomThumbnail ? '<span style="background: #20bf6b; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; margin-left: 10px;"><i class="fas fa-image"></i> Custom Thumbnail</span>' : ''}
                </div>
                <h1 class="article-title">${promptData.title}</h1>
                
                <div class="engagement-stats-small" id="engagementStats">
                    <div class="stat-item-small">
                        <i class="fas fa-heart"></i>
                        <span class="stat-number-small">${promptData.likes}</span>
                        <span class="stat-label-small">Likes</span>
                    </div>
                    <div class="stat-item-small">
                        <i class="fas fa-eye"></i>
                        <span class="stat-number-small">${promptData.views}</span>
                        <span class="stat-label-small">Views</span>
                    </div>
                    <div class="stat-item-small">
                        <i class="far fa-comments"></i>
                        <span class="stat-number-small comment-count">${promptData.commentCount || 0}</span>
                        <span class="stat-label-small">Comments</span>
                    </div>
                    ${promptData.isPaid ? `
                    <div class="stat-item-small">
                        <i class="fas fa-shopping-cart"></i>
                        <span class="stat-number-small">${promptData.salesCount || 0}</span>
                        <span class="stat-label-small">Sales</span>
                    </div>
                    ` : ''}
                </div>
            </div>

            <!-- Adsterra Ads - Top of content (high visibility) -->
            <div id="ezoic-pub-ad-placeholder-118"></div>
<script>
    ezstandalone.cmd.push(function () {
        ezstandalone.showAds(118);
    });
</script>
            
            ${mediaDisplay}

            <!-- AFFILIATE: TOP -->
            ${affiliateTop}

            <div class="prompt-content">
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-magic"></i> AI Prompt Used</h2>
                    <div class="copy-prompt-container">
                        <button class="copy-prompt-btn" id="copyPromptBtn" data-price="${promptData.price}" data-is-paid="${promptData.isPaid}" data-prompt-id="${promptData.id}">
                            <i class="far fa-copy"></i> ${promptData.isPaid ? `Buy for ₹${promptData.price}` : 'Copy Prompt'}
                        </button>
                        <div class="prompt-text-wrapper" onclick="handlePromptClick(event)">
                            <div class="prompt-text" id="promptText" oncontextmenu="handlePromptContextMenu(event)">
                                ${promptData.promptText}
                            </div>
                            <div class="copy-hint" id="copyHint">
                                Click or tap to copy
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Adsterra Ads - Middle of content -->
                <div id="ezoic-pub-ad-placeholder-119"></div>
          <script>
         ezstandalone.cmd.push(function () {
        ezstandalone.showAds(119);
               });
          </script>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-info-circle"></i> About This ${isVideo ? 'AI Video' : 'AI Prompt'}</h2>
                    <div class="platform-intro">
                        <p>${promptData.detailedExplanation}</p>
                    </div>
                </section>

                <!-- AFFILIATE: MIDDLE -->
                ${affiliateMiddle}

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-chart-bar"></i> AI Platform Comparison (${isVideo ? AIModelManager.getVideoModelCount() : AIModelManager.getPhotoModelCount()}+ Models)</h2>
                    ${promptData.platformComparison}
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-robot"></i> Top AI ${isVideo ? 'Video Editing' : 'Image Generation'} Tools</h2>
                    <div class="tools-grid-enhanced">
                        ${toolsHTML}
                    </div>
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-cogs"></i> ${isVideo ? 'Video Editing' : 'Model-Specific'} Optimization Tips</h2>
                    ${promptData.modelSpecificTips}
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-list-ol"></i> How To ${isVideo ? 'Create This Video' : 'Use This Prompt'}</h2>
                    <div class="instruction-steps">
                        ${aiStepsHTML}
                    </div>
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-graduation-cap"></i> Expert Tips for Best Results</h2>
                    <ul class="tips-list">
                        ${aiExpertTipsHTML}
                    </ul>
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-lightbulb"></i> Usage Tips</h2>
                    <ul class="tips-list">
                        ${tipsHTML}
                    </ul>
                </section>

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-search"></i> Optimization Tips</h2>
                    <ul class="tips-list">
                        ${seoTipsHTML}
                    </ul>
                </section>

                <div class="engagement-buttons">
                    ${miniBrowserToggleButton}
                    <button class="engagement-btn like-btn" onclick="handleLike('${promptData.id}')">
                        <i class="far fa-heart"></i> Like Prompt
                    </button>
                    <button class="engagement-btn use-btn" onclick="handleUse('${promptData.id}')">
                        <i class="fas fa-download"></i> Mark as Used
                    </button>
                    <button class="engagement-btn share-btn" onclick="handleShare('${promptData.id}')">
                        <i class="fas fa-share"></i> Share Prompt
                    </button>
                    <a href="https://www.toolsprompt.com/" class="engagement-btn">
                        <i class="fas fa-home"></i> More Prompts
                    </a>
                </div>
            </div>

            <!-- Adsterra Ads - Bottom of content -->
            <div id="ezoic-pub-ad-placeholder-120"></div>
<script>
    ezstandalone.cmd.push(function () {
        ezstandalone.showAds(120);
    });
</script>

            <!-- AFFILIATE: BOTTOM -->
            ${affiliateBottom}
        </article>
        
        <section class="content-section" style="margin-top: 2rem;">
            <h2 class="section-title"><i class="fas fa-images"></i> You Might Like:</h2>
            <div class="content-grid" id="relatedPrompts">
            </div>
        </section>

        <section class="comment-section" id="commentSection">
            <h2><i class="far fa-comments"></i> Comments</h2>
            
            <div class="comment-form">
                <h3>Add a Comment</h3>
                <form id="commentForm">
                    <div class="form-group">
                        <label for="commentContent">Your Comment *</label>
                        <textarea 
                            id="commentContent" 
                            name="content" 
                            placeholder="Share your thoughts about this ${isVideo ? 'video' : 'prompt'}..." 
                            maxlength="1000"
                            required></textarea>
                        <small style="color: #666; display: block; margin-top: 0.5rem;">
                            Max 1000 characters. Your comment will be publicly visible.
                        </small>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div class="form-group">
                            <label for="authorName">Name (optional)</label>
                            <input type="text" id="authorName" name="authorName" placeholder="Your name">
                        </div>
                        <div class="form-group">
                            <label for="authorEmail">Email (optional)</label>
                            <input type="email" id="authorEmail" name="authorEmail" placeholder="your@email.com">
                        </div>
                    </div>
                    
                    <div class="comment-form-notice">
                        <strong>Note:</strong> Your email will not be published. It's only used to display your Gravatar if you have one.
                    </div>
                    
                    <button type="submit" class="comment-submit-btn">
                        <i class="far fa-paper-plane"></i> Post Comment
                    </button>
                </form>
            </div>
            
            <div class="comments-list" id="commentsList">
                <div class="no-comments" id="noComments">
                    <i class="far fa-comment" style="font-size: 3rem; color: #ddd; margin-bottom: 1rem;"></i>
                    <p>No comments yet. Be the first to share your thoughts!</p>
                </div>
            </div>
            
            <div class="load-more-comments" id="loadMoreComments" style="display: none;">
                <button class="load-more-btn" id="loadMoreBtn">
                    <i class="fas fa-sync-alt"></i> Load More Comments
                </button>
            </div>
        </section>
    </main>

    <footer class="site-footer">
        <div class="footer-container">
            <div class="footer-section">
                <h3>tools prompt</h3>
                <p>Toolsprompt is the leading AI Prompt Marketplace where you can buy and sell viral AI prompts for photo editing, video creation, and other creative tasks. Join thousands of prompt engineers and start earning today!.</p>
            </div>
            <div class="footer-section">
                <h3>Quick Links</h3>
                <ul class="footer-links">
                    <li><a href="https://www.toolsprompt.com/">Home</a></li>
                    <li><a href="https://www.toolsprompt.com/#promptsContainer">Browse Prompts</a></li>
                    <li><a href="https://www.toolsprompt.com/news.html">AI News</a></li>
                    <li><a href="https://www.toolsprompt.com/ai-detector.html">Prompt Tools</a></li>
                    <li><a href="https://www.toolsprompt.com/dashboard.html">Dashboard</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h3>Resources</h3>
                <ul class="footer-links">
                    <li><a href="https://www.toolsprompt.com/howitworks.html">How It Works</a></li>
                    <li><a href="/sitemap.xml">Sitemap</a></li>
                    <li><a href="/robots.txt">Robots.txt</a></li>
                    <li><a href="/affiliate.html">Affiliate Manager (Admin)</a></li>
                </ul>
            </div>
        </div>
        <div class="copyright">
            <p>&copy; 2026 toolsprompt.com All rights reserved. | AI Prompt Marketplace - Buy and Sell AI Prompts</p>
        </div>
    </footer>

    ${miniBrowserHTML}
    ${socialBadgesHTML}
    ${downloadAppButtonHTMLWithStyle}
    ${aiGeneratorHTML}
    ${socialFeedHTML}

<script>
// ==================== FIREBASE INITIALIZATION ====================
    
    // Firebase configuration
    var firebaseConfig = {
        apiKey: "AIzaSyCgc0xRtijpyPhOovfwg-MzyahsUFh-hiQ",
        authDomain: "toolsprompt-5b07e.firebaseapp.com",
        projectId: "toolsprompt-5b07e",
        storageBucket: "toolsprompt-5b07e.firebasestorage.app",
        messagingSenderId: "402263780942",
        appId: "1:402263780942:web:1013a347dbb72db6b31d1f",
        measurementId: "G-K4KXR4FZCP"
    };
    
    // Initialize Firebase
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log('Firebase initialized on prompt page');
    }
    
    // Auth state listener
    var currentUser = null;
    var authReady = false;
    
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(function(user) {
            currentUser = user;
            authReady = true;
            console.log('Auth state changed:', user ? 'Logged in as ' + user.email : 'Not logged in');
            
            // Update navigation/header if needed
            updateUserUI(user);
            
            // Check for pending purchase after login
            checkPendingPurchase(user);
        });
    }
    
    function updateUserUI(user) {
        var authSection = document.getElementById('authSection');
        if (!authSection) return;
        
        if (user) {
            var displayName = user.displayName || user.email.split('@')[0] || 'User';
            var avatarUrl = user.photoURL || '';
            var initial = displayName.charAt(0).toUpperCase();
            
            authSection.innerHTML = 
                '<div class="user-profile-mini">' +
                    (avatarUrl ? 
                        '<img src="' + avatarUrl + '" class="user-avatar-mini" alt="' + displayName + '">' :
                        '<div class="user-avatar-mini">' + initial + '</div>'
                    ) +
                    '<span class="user-name-mini">' + displayName + '</span>' +
                    '<button class="logout-btn-mini" title="Logout" id="logoutBtn"><i class="fas fa-sign-out-alt"></i></button>' +
                '</div>';
            
            // Add logout handler
            setTimeout(function() {
                var logoutBtn = document.getElementById('logoutBtn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', function() {
                        firebase.auth().signOut().then(function() {
                            window.location.reload();
                        }).catch(function(error) {
                            console.error('Logout error:', error);
                            window.location.reload();
                        });
                    });
                }
            }, 100);
            
        } else {
            authSection.innerHTML = '<a href="https://www.toolsprompt.com/login.html?returnUrl=' + encodeURIComponent(window.location.href) + '" class="login-btn-header">Login / Register</a>';
        }
    }
    
    function checkPendingPurchase(user) {
        if (!user) return;
        
        var pendingPurchase = localStorage.getItem('pendingPurchase');
        if (pendingPurchase) {
            try {
                var purchaseData = JSON.parse(pendingPurchase);
                console.log('Found pending purchase:', purchaseData);
                localStorage.removeItem('pendingPurchase');
                
                // If we're on the same prompt page, trigger the buy modal
                if (purchaseData.promptId === promptId) {
                    setTimeout(function() {
                        showCopyNotification('Login successful! You can now complete your purchase.', 'success');
                    }, 500);
                }
            } catch (e) {
                console.error('Error parsing pending purchase:', e);
                localStorage.removeItem('pendingPurchase');
            }
        }
    }
    
    function getCurrentUser() {
        return new Promise(function(resolve) {
            if (authReady) {
                resolve(currentUser);
            } else if (typeof firebase !== 'undefined' && firebase.auth) {
                var unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
                    unsubscribe();
                    currentUser = user;
                    authReady = true;
                    resolve(user);
                });
            } else {
                resolve(null);
            }
        });
    }

    console.log('Initializing prompt page with marketplace');
    
    var isVideo = ${isVideo};
    var promptId = '${promptData.id}';
    var isPaid = ${promptData.isPaid};
    var promptPrice = ${promptData.price};
    
    // Store prompt data safely
    var currentPromptData = {
        id: '${promptData.id}',
        title: document.querySelector('.article-title') ? document.querySelector('.article-title').textContent : '${promptData.title.replace(/'/g, "\\'")}',
        promptText: document.getElementById('promptText') ? document.getElementById('promptText').textContent : '',
        imageUrl: '${promptData.imageUrl}',
        price: ${promptData.price},
        userName: '${promptData.userName.replace(/'/g, "\\'")}'
    };

    document.addEventListener('DOMContentLoaded', function() {
        // Set current prompt text from the DOM
        var promptTextEl = document.getElementById('promptText');
        if (promptTextEl) {
            currentPromptData.promptText = promptTextEl.textContent || promptTextEl.innerText;
        }
        
        loadRelatedPrompts(promptId, '${(promptData.keywords || ['AI'])[0]}');
        
        // Setup copy/buy button
        var copyBtn = document.getElementById('copyPromptBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleCopyOrBuy();
            });
            
            copyBtn.addEventListener('touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleCopyOrBuy();
            });
        }
    });

    function handleCopyOrBuy() {
        console.log('handleCopyOrBuy called, isPaid:', isPaid);
        
        if (isPaid) {
            // Show buy modal
            showBuyPromptModal(currentPromptData);
        } else {
            // Free prompt - copy directly
            copyPromptToClipboard();
        }
    }

    function copyPromptToClipboard() {
        var text = currentPromptData.promptText;
        if (!text) {
            var el = document.getElementById('promptText');
            if (el) text = el.textContent || el.innerText;
        }
        
        navigator.clipboard.writeText(text).then(function() {
            var btn = document.getElementById('copyPromptBtn');
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.classList.add('copied');
                btn.disabled = true;
                setTimeout(function() {
                    btn.innerHTML = '<i class="far fa-copy"></i> ' + (isPaid ? 'Buy for ₹' + promptPrice : 'Copy Prompt');
                    btn.classList.remove('copied');
                    btn.disabled = false;
                }, 3000);
            }
            showNotification('Prompt copied!', 'success');
            trackCopyAction(promptId);
        }).catch(function() {
            showNotification('Failed to copy', 'error');
        });
    }

    function showNotification(message, type) {
        type = type || 'success';
        var notifs = document.querySelectorAll('.copy-notification');
        notifs.forEach(function(n) { n.remove(); });
        
        var bg = type === 'success' ? '#20bf6b' : (type === 'error' ? '#ff6b6b' : '#4e54c8');
        var icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'exclamation-circle' : 'info-circle');
        
        var div = document.createElement('div');
        div.className = 'copy-notification';
        div.style.cssText = 'position:fixed;bottom:20px;right:20px;background:' + bg + ';color:white;padding:12px 20px;border-radius:8px;z-index:10001;box-shadow:0 2px 10px rgba(0,0,0,0.2);display:flex;align-items:center;gap:10px;font-size:0.9rem;';
        div.innerHTML = '<i class="fas fa-' + icon + '"></i><span>' + message + '</span>';
        document.body.appendChild(div);
        setTimeout(function() { if (div.parentNode) div.parentNode.removeChild(div); }, 3000);
    }

    function trackCopyAction(pid) {
        fetch('/api/prompt/' + pid + '/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptId: pid, timestamp: new Date().toISOString() })
        }).catch(function() {});
    }

    function handlePromptClick(event) {
        if (event.target.closest('.copy-prompt-btn')) return;
        handleCopyOrBuy();
    }

    function handlePromptContextMenu(event) {
        event.preventDefault();
        handleCopyOrBuy();
        return false;
    }

// ==================== SOCIAL BADGES TOGGLE ====================
document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('socialBadgesContainer');
    const toggleBtn = document.getElementById('socialToggleBtn');
    if (container && toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            container.classList.toggle('collapsed');
        });
    }
});

    // ==================== BUY MODAL WITH ALL FIELDS ====================

    function showBuyPromptModal(prompt) {
        console.log('Showing buy modal for:', prompt);
        
        // Remove existing modal
        var existing = document.getElementById('buyPromptModal');
        if (existing) existing.remove();
        
        var html = '';
        html += '<div class="buy-modal-overlay" id="buyPromptModal">';
        html += '<div class="buy-modal">';
        html += '<div class="modal-header">';
        html += '<h2><i class="fas fa-shopping-cart"></i> Purchase Prompt</h2>';
        html += '<button class="close-modal" id="closeBuyModalBtn">&times;</button>';
        html += '</div>';
        html += '<div class="buy-modal-content">';
        
        // Preview section
        html += '<div class="prompt-preview">';
        html += '<img src="' + (prompt.imageUrl || '') + '" alt="" class="buy-prompt-image">';
        html += '<h3>' + (prompt.title || 'Untitled') + '</h3>';
        html += '<p class="prompt-price-large"><i class="fas fa-rupee-sign"></i> ' + (prompt.price || 0) + '</p>';
        html += '<p class="prompt-creator">By: ' + (prompt.userName || 'Anonymous') + '</p>';
        html += '</div>';
        
        // Payment form with ALL fields
        html += '<div class="payment-form">';
        html += '<h3>Customer Information</h3>';
        
        html += '<div class="form-group">';
        html += '<label for="buyerName">Full Name *</label>';
        html += '<input type="text" id="buyerName" required placeholder="As per your ID">';
        html += '</div>';
        
        html += '<div class="form-group">';
        html += '<label for="buyerEmail">Email *</label>';
        html += '<input type="email" id="buyerEmail" required placeholder="your@email.com">';
        html += '</div>';
        
        html += '<div class="form-group">';
        html += '<label for="buyerPhone">Phone (Optional)</label>';
        html += '<input type="tel" id="buyerPhone" placeholder="Mobile number">';
        html += '</div>';
        
        html += '<h3>Billing Address</h3>';
        
        html += '<div class="form-group">';
        html += '<label for="buyerAddress1">Address Line 1 *</label>';
        html += '<input type="text" id="buyerAddress1" required placeholder="Street address">';
        html += '</div>';
        
        html += '<div class="form-group">';
        html += '<label for="buyerAddress2">Address Line 2 (Optional)</label>';
        html += '<input type="text" id="buyerAddress2" placeholder="Apartment, suite, etc.">';
        html += '</div>';
        
        html += '<div class="form-row">';
        html += '<div class="form-group">';
        html += '<label for="buyerCity">City *</label>';
        html += '<input type="text" id="buyerCity" required>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="buyerState">State/Province</label>';
        html += '<input type="text" id="buyerState" placeholder="Optional">';
        html += '</div>';
        html += '</div>';
        
        html += '<div class="form-row">';
        html += '<div class="form-group">';
        html += '<label for="buyerPostal">Postal Code *</label>';
        html += '<input type="text" id="buyerPostal" required>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="buyerCountry">Country *</label>';
        html += '<select id="buyerCountry" required>';
        html += '<option value="IN">India</option>';
        html += '<option value="US">United States</option>';
        html += '<option value="GB">United Kingdom</option>';
        html += '<option value="CA">Canada</option>';
        html += '<option value="AU">Australia</option>';
        html += '</select>';
        html += '</div>';
        html += '</div>';
        
        html += '<div class="payment-info">';
        html += '<p style="margin:0;font-size:0.9rem;color:#666;"><i class="fas fa-shield-alt"></i> Secure payment powered by Razorpay</p>';
        html += '<p style="margin:5px 0 0;font-size:0.8rem;color:#888;">Supports UPI, Credit/Debit Cards, Net Banking</p>';
        html += '</div>';
        
        html += '<button class="buy-now-btn" id="buyNowBtn"><i class="fas fa-rupee-sign"></i> Pay ₹' + (prompt.price || 0) + '</button>';
        html += '<p class="secure-payment"><i class="fas fa-lock"></i> Secure payment powered by Razorpay</p>';
        html += '</div>';
        
        html += '</div>';
        html += '</div>';
        html += '</div>';
        
        document.body.insertAdjacentHTML('beforeend', html);
        document.body.style.overflow = 'hidden';
        
        // Setup close button
        document.getElementById('closeBuyModalBtn').addEventListener('click', closeBuyModal);
        
        // Close on overlay click
        document.getElementById('buyPromptModal').addEventListener('click', function(e) {
            if (e.target === this) closeBuyModal();
        });
        
        // Setup buy button
        document.getElementById('buyNowBtn').addEventListener('click', function() {
            processPurchase(prompt);
        });
        
        // Escape key
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeBuyModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    function closeBuyModal() {
        var modal = document.getElementById('buyPromptModal');
        if (modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
    }

    function processPurchase(prompt) {
        // Get form values
        var name = document.getElementById('buyerName')?.value?.trim() || '';
        var email = document.getElementById('buyerEmail')?.value?.trim() || '';
        var phone = document.getElementById('buyerPhone')?.value?.trim() || '';
        var address1 = document.getElementById('buyerAddress1')?.value?.trim() || '';
        var address2 = document.getElementById('buyerAddress2')?.value?.trim() || '';
        var city = document.getElementById('buyerCity')?.value?.trim() || '';
        var state = document.getElementById('buyerState')?.value?.trim() || '';
        var postal = document.getElementById('buyerPostal')?.value?.trim() || '';
        var country = document.getElementById('buyerCountry')?.value || 'IN';
        
        // Validate required fields
        if (!name) { showNotification('Please enter your full name', 'error'); return; }
        if (!email) { showNotification('Please enter your email', 'error'); return; }
        if (!address1) { showNotification('Please enter your address', 'error'); return; }
        if (!city) { showNotification('Please enter your city', 'error'); return; }
        if (!postal) { showNotification('Please enter postal code', 'error'); return; }
        
        var customerInfo = {
            name: name,
            email: email,
            phone: phone,
            address: {
                line1: address1,
                line2: address2,
                city: city,
                state: state,
                postal_code: postal,
                country: country
            }
        };
        
        console.log('Processing purchase with customer info:', customerInfo);
        
        // Start payment
        initiatePayment(prompt, customerInfo);
    }

    async function initiatePayment(prompt, customerInfo) {
        var buyBtn = document.getElementById('buyNowBtn');
        var originalText = buyBtn.innerHTML;
        buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating order...';
        buyBtn.disabled = true;
        
        try {
            // Wait for auth to be ready
            var user = await getCurrentUser();
            
            if (!user) {
                showNotification('Please login to complete your purchase', 'info');
                
                // Store purchase data for after login
                localStorage.setItem('pendingPurchase', JSON.stringify({
                    promptId: prompt.id,
                    price: prompt.price,
                    title: prompt.title,
                    returnUrl: window.location.href,
                    timestamp: Date.now()
                }));
                
                // Also store customer info temporarily
                localStorage.setItem('pendingCustomerInfo', JSON.stringify(customerInfo));
                
                buyBtn.innerHTML = originalText;
                buyBtn.disabled = false;
                
                // Redirect to login
                setTimeout(function() {
                    window.location.href = '/login.html?returnUrl=' + encodeURIComponent(window.location.href);
                }, 1000);
                return;
            }
            
            // User is logged in, restore customer info if available
            var pendingInfo = localStorage.getItem('pendingCustomerInfo');
            if (pendingInfo) {
                try {
                    customerInfo = JSON.parse(pendingInfo);
                    localStorage.removeItem('pendingCustomerInfo');
                } catch(e) {}
            }
            
            // Create order
            var response = await fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    promptId: prompt.id,
                    price: prompt.price,
                    userId: user.uid,
                    userEmail: user.email || customerInfo.email,
                    customerName: customerInfo.name,
                    customerPhone: customerInfo.phone
                })
            });
            
            if (!response.ok) throw new Error('Server error: ' + response.status);
            
            var data = await response.json();
            console.log('Order created:', data);
            
            if (data.isDemo) {
                buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
                await completePurchase(prompt, user, 'demo_' + Date.now());
                closeBuyModal();
                return;
            }
            
            // Load Razorpay
            if (typeof Razorpay === 'undefined') {
                await new Promise(function(resolve, reject) {
                    var script = document.createElement('script');
                    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
            
            // Open Razorpay checkout
            var options = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency || 'INR',
                name: 'Tools Prompt',
                description: 'Purchase: ' + (prompt.title || 'Prompt'),
                order_id: data.orderId,
                handler: async function(response) {
                    buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
                    
                    try {
                        var verifyRes = await fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                orderId: response.razorpay_order_id,
                                paymentId: response.razorpay_payment_id,
                                signature: response.razorpay_signature,
                                promptId: prompt.id,
                                userId: user.uid,
                                userEmail: user.email || customerInfo.email,
                                amount: prompt.price
                            })
                        });
                        
                        var verifyData = await verifyRes.json();
                        
                        if (verifyData.success) {
                            showNotification('Payment successful! Prompt copied.', 'success');
                            await navigator.clipboard.writeText(prompt.promptText || currentPromptData.promptText);
                            closeBuyModal();
                        } else {
                            showNotification('Verification failed: ' + (verifyData.error || 'Unknown error'), 'error');
                        }
                    } catch (e) {
                        console.error('Verification error:', e);
                        showNotification('Payment recorded. Check your dashboard.', 'info');
                        closeBuyModal();
                    }
                    
                    buyBtn.innerHTML = originalText;
                    buyBtn.disabled = false;
                },
                modal: {
                    ondismiss: function() {
                        showNotification('Payment cancelled', 'info');
                        buyBtn.innerHTML = originalText;
                        buyBtn.disabled = false;
                    }
                },
                theme: { color: '#4e54c8' },
                prefill: {
                    name: customerInfo.name,
                    email: user.email || customerInfo.email,
                    contact: customerInfo.phone
                },
                notes: {
                    promptId: prompt.id,
                    userId: user.uid,
                    promptTitle: prompt.title
                }
            };
            
            var rzp = new Razorpay(options);
            
            rzp.on('payment.failed', function(response) {
                console.error('Payment failed:', response.error);
                showNotification('Payment failed: ' + (response.error?.description || 'Try again'), 'error');
                buyBtn.innerHTML = originalText;
                buyBtn.disabled = false;
            });
            
            rzp.open();
            
        } catch (error) {
            console.error('Payment error:', error);
            showNotification(error.message || 'Payment failed', 'error');
            buyBtn.innerHTML = originalText;
            buyBtn.disabled = false;
        }
    }

    async function completePurchase(prompt, user, paymentId) {
        try {
            var response = await fetch('/api/complete-purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    promptId: prompt.id,
                    userId: user.uid,
                    userEmail: user.email,
                    amount: prompt.price,
                    paymentId: paymentId
                })
            });
            
            var data = await response.json();
            
            if (data.success) {
                showNotification('Purchase successful! Prompt copied.', 'success');
                await navigator.clipboard.writeText(prompt.promptText || currentPromptData.promptText);
            } else {
                showNotification(data.error || 'Purchase failed', 'error');
            }
        } catch (error) {
            console.error('Complete purchase error:', error);
            showNotification('Purchase error', 'error');
        }
    }

    function getCurrentUser() {
        return new Promise(function(resolve) {
            if (typeof firebase !== 'undefined' && firebase.auth) {
                var unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
                    unsubscribe();
                    resolve(user);
                });
            } else {
                resolve(null);
            }
        });
    }

    // Like, Use, Share handlers
    function handleLike(pid) {
        var btn = document.querySelector('.like-btn');
        if (!btn) return;
        var liked = btn.classList.contains('liked');
        fetch('/api/prompt/' + pid + '/like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'anonymous', action: liked ? 'unlike' : 'like' })
        }).then(function(r) {
            if (r.ok) {
                if (liked) {
                    btn.innerHTML = '<i class="far fa-heart"></i> Like Prompt';
                    btn.classList.remove('liked');
                } else {
                    btn.innerHTML = '<i class="fas fa-heart"></i> Liked';
                    btn.classList.add('liked');
                }
            }
        });
    }
    
    function handleUse(pid) {
        var btn = document.querySelector('.use-btn');
        if (!btn) return;
        fetch('/api/prompt/' + pid + '/use', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'anonymous' })
        }).then(function(r) {
            if (r.ok) {
                btn.innerHTML = '<i class="fas fa-check"></i> Used!';
                btn.classList.add('used');
                setTimeout(function() {
                    btn.innerHTML = '<i class="fas fa-download"></i> Mark as Used';
                    btn.classList.remove('used');
                }, 3000);
            }
        });
    }
    
    function handleShare(pid) {
        var url = window.location.href;
        if (navigator.share) {
            navigator.share({ title: document.title, text: 'Check this out!', url: url }).catch(function() {
                copyText(url);
            });
        } else {
            copyText(url);
            showNotification('Link copied!', 'success');
        }
    }

    function copyText(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(function() {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            });
        }
    }

    function loadRelatedPrompts(currentId, keyword) {
        fetch('/api/search?q=' + encodeURIComponent(keyword) + '&limit=6')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var container = document.getElementById('relatedPrompts');
                if (!container || !data.prompts) return;
                var html = '', count = 0;
                for (var i = 0; i < data.prompts.length && count < 3; i++) {
                    var p = data.prompts[i];
                    if (p && p.id && p.id !== currentId) {
                        var img = p.thumbnailUrl || p.imageUrl || 'https://via.placeholder.com/300x200/4e54c8/white?text=Prompt';
                        html += '<div class="related-prompt-card"><img src="' + img + '" class="related-prompt-image">' +
                            '<div class="related-prompt-content"><h4>' + (p.title || '').substring(0, 50) + '</h4>' +
                            '<a href="/prompt/' + p.id + '" class="engagement-btn">View</a></div></div>';
                        count++;
                    }
                }
                container.innerHTML = html || '<div style="text-align:center;padding:2rem;">No related prompts</div>';
            })
            .catch(function() {
                var c = document.getElementById('relatedPrompts');
                if (c) c.innerHTML = '<div style="text-align:center;padding:2rem;">Error loading</div>';
            });
    }

${miniBrowserJS}
${downloadAppJS}
${aiGeneratorJS}
${generateCommentSystemJS(promptData)}
${socialFeedJS}
</script>
</body>
</html>`;
}

function generateCategoryHTML(category, baseUrl) {
  const categoryNames = {
    'art': 'AI Art',
    'photography': 'AI Photography',
    'design': 'AI Design',
    'writing': 'AI Writing',
    'video': 'AI Video Reels',
    'other': 'Other AI Creations'
  };
  
  const categoryName = categoryNames[category] || 'AI Prompts';
  const description = `Explore ${categoryName} prompts and AI-generated content. Discover the best prompt engineering techniques for ${categoryName.toLowerCase()}.`;

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${categoryName} Prompts - tools prompt</title>
    <meta name="description" content="${description}">
    ${generateAdSenseCode()}
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: #f5f7fa; text-align: center; }
        .container { max-width: 800px; margin: 50px auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #4e54c8; margin-bottom: 20px; }
        a { color: #4e54c8; text-decoration: none; padding: 12px 25px; border: 2px solid #4e54c8; border-radius: 30px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${categoryName} Prompts</h1>
        <p>${description}</p>
        <a href="/">← Back to Prompt Showcase</a>
    </div>
</body>
</html>`;
}

function generateNewsHTML(newsData) {
  const adsenseCode = generateAdSenseCode();
  const baseUrl = process.env.NODE_ENV === 'production' ? 'https://www.toolsprompt.com' : '';
  const newsUrl = baseUrl + '/news/' + newsData.id;
  
  const tagsHTML = (newsData.tags || []).map(tag => 
    '<meta property="article:tag" content="' + tag + '">'
  ).join('');
  
  const contentHTML = (newsData.content || '').split('\n').map(paragraph => 
    '<p>' + paragraph + '</p>'
  ).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${newsData.seoTitle}</title>
    <meta name="description" content="${newsData.metaDescription}">
    ${adsenseCode}
    <meta property="og:type" content="article">
    <meta property="og:url" content="${newsUrl}">
    <meta property="article:published_time" content="${newsData.publishedAt}">
    <meta property="article:modified_time" content="${newsData.updatedAt}">
    <meta property="article:author" content="${newsData.author}">
    <meta property="article:section" content="${newsData.category}">
    ${tagsHTML}
    <link rel="canonical" href="${newsUrl}" />
    <meta name="news_keywords" content="${(newsData.tags || []).join(', ')}">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f7fa; padding: 20px; }
        .news-article { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        .news-header { text-align: center; margin-bottom: 30px; }
        .news-title { font-size: 2.5rem; color: #2d334a; margin-bottom: 15px; line-height: 1.3; }
        .news-meta { color: #666; margin-bottom: 20px; font-size: 1rem; }
        .news-image { width: 100%; height: 400px; object-fit: cover; border-radius: 10px; margin-bottom: 30px; }
        .news-content { line-height: 1.8; font-size: 1.1rem; }
        .news-content p { margin-bottom: 20px; }
        .breaking-badge { background: #ff6b6b; color: white; padding: 8px 20px; border-radius: 25px; font-weight: bold; display: inline-block; margin-bottom: 15px; }
        .back-link { display: inline-block; margin-top: 30px; color: #4e54c8; text-decoration: none; font-weight: 600; }
        .back-link:hover { text-decoration: underline; }
        .ad-container { margin: 25px 0; text-align: center; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; }
        .ad-label { font-size: 0.8rem; color: #6c757d; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
        @media (max-width: 768px) {
            body { padding: 10px; } .news-article { padding: 20px; } .news-title { font-size: 1.8rem; } .news-image { height: 250px; }
        }
    </style>
</head>
<body>
    <article class="news-article">
        <header class="news-header">
            ${newsData.isBreaking ? '<span class="breaking-badge">BREAKING NEWS</span>' : ''}
            <h1 class="news-title">${newsData.title}</h1>
            <div class="news-meta">
                By ${newsData.author} | ${new Date(newsData.publishedAt).toLocaleDateString()} | 
                ${newsData.views} views | ${newsData.category}
            </div>
        </header>
        <div class="ad-container"><div class="ad-label">Advertisement</div></div>
        <img src="${newsData.imageUrl}" alt="${newsData.title}" class="news-image">
        <div class="ad-container"><div class="ad-label">Advertisement</div></div>
        <div class="news-content">${contentHTML}</div>
        <div class="ad-container"><div class="ad-label">Advertisement</div></div>
        <a href="/" class="back-link">← Back to tools prompt</a>
    </article>
    <script>
        (function() {
            var currentHost = window.location.hostname;
            if (currentHost === 'toolsprompt.com') {
                var targetUrl = 'https://www.toolsprompt.com' + window.location.pathname + window.location.search + window.location.hash;
                if (window.location.href !== targetUrl) {
                    window.location.replace(targetUrl);
                }
            }
        })();
    </script>
</body>
</html>`;
}

function sendPromptNotFound(res, promptId) {
  res.status(404).send(`<!DOCTYPE html><html><head><title>Prompt Not Found - tools prompt</title></head><body><h1>Prompt Not Found</h1><p>The prompt you're looking for doesn't exist.</p><a href="/">Return Home</a></body></html>`);
}

function sendNewsNotFound(res, newsId) {
  res.status(404).send(`<!DOCTYPE html><html><head><title>News Not Found - tools prompt</title></head><body><h1>News Not Found</h1><p>The news article you're looking for doesn't exist.</p><a href="/">Return Home</a></body></html>`);
}

function sendErrorPage(res, error) {
  res.status(500).send(`<!DOCTYPE html><html><head><title>Error - tools prompt</title></head><body><h1>Error Loading Page</h1><p>There was an error loading this page. Please try again later.</p><a href="/">Return Home</a></body></html>`);
}

function sendNewsErrorPage(res, error) {
  res.status(500).send(`<!DOCTYPE html><html><head><title>Error - tools prompt News</title></head><body><h1>Error Loading News</h1><p>There was an error loading this news article. Please try again later.</p><a href="/">Return Home</a></body></html>`);
}

// Simple 404 handler
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html><html><head><title>Page Not Found</title></head><body><h1>Page Not Found</h1><p>The page you're looking for doesn't exist.</p><a href="/">Return to Home</a></body></html>`);
});

// Start server
app.listen(port, async () => {
  const photoCount = AIModelManager.getPhotoModelCount();
  const videoCount = AIModelManager.getVideoModelCount();
  const totalCount = photoCount + videoCount;
  
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📦 Storage: Cloudflare R2 (ZERO egress fees)`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Base URL: http://localhost:${port}`);
  console.log(`📰 News routes: http://localhost:${port}/news/:id`);
  console.log(`🗞️  News API: http://localhost:${port}/api/news`);
  console.log(`📤 News upload: http://localhost:${port}/api/upload-news`);
  console.log(`🗺️  News sitemap: http://localhost:${port}/sitemap-news.xml`);
  console.log(`🔗 Prompt routes: http://localhost:${port}/prompt/:id`);
  console.log(`📊 Dashboard: http://localhost:${port}/dashboard.html`);
  console.log(`💰 MARKETPLACE FEATURES:`);
  console.log(`   → Buy prompts with Razorpay India integration`);
  console.log(`   → Sell prompts with 80% earnings for sellers`);
  console.log(`   → Dashboard for tracking sales and purchases`);
  console.log(`   → Price badges on prompts (Free/Paid)`);
  console.log(`   → Purchase verification before copying paid prompts`);
  console.log(`   → Sales and earnings tracking`);
  
  console.log(`🎬 YOUTUBE SHORTS PLAYER:`);
  console.log(`   → Full-screen vertical video player`);
  console.log(`   → Swipe up/down navigation (mobile)`);
  console.log(`   → Arrow key navigation (desktop)`);
  console.log(`   → Like, comment, share, copy prompt functionality`);
  
  console.log(`💬 Comment System Endpoints:`);
  console.log(`   → Get comments: http://localhost:${port}/api/prompt/:id/comments`);
  console.log(`   → Post comment: http://localhost:${port}/api/prompt/:id/comments (POST)`);
  console.log(`   → Like comment: http://localhost:${port}/api/comment/:commentId/like (POST)`);
  
  console.log(`🔍 Search: http://localhost:${port}/api/search (Limited to 500 results)`);
  console.log(`🗺️  Sitemap: http://localhost:${port}/sitemap.xml`);
  console.log(`🤖 Robots.txt: http://localhost:${port}/robots.txt`);
  console.log(`❤️  Health check: http://localhost:${port}/health`);
  console.log(`💰 AdSense Client ID: ${process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'}`);
  console.log(`📢 Adsterra Ads Integrated:`);
  console.log(`   → Native Banner: aca55beb03e2d8b514ae3f122920bdf0`);
  console.log(`   → Desktop Banner (300x250): 8719e4636a7c41462203d84e956177c4`);
  console.log(`   → Mobile Banner (320x50): 37e3a123e9b664f6f0b0efed6c7ee71f`);
  
  console.log(`📱 APP DOWNLOAD BUTTON:`);
  console.log(`   → Floating button at bottom center of prompt pages`);
  console.log(`   → Download URL: https://www.appcreator24.com/app4057785-93607p`);
  console.log(`   → Auto-tracks download clicks`);
  console.log(`   → Sticky while scrolling`);
  console.log(`   → Animated with bounce effect`);
  
  console.log(`🤖 AI MODELS ENHANCED: ${totalCount} TOTAL AI PLATFORMS SUPPORTED!`);
  console.log(`   📸 PHOTO MODELS (${photoCount})`);
  console.log(`   🎬 VIDEO MODELS (${videoCount})`);
  console.log(`💰 MARKETPLACE ACTIVE: Buy and sell prompts!`);
  console.log(`💳 PAYMENT GATEWAY: Razorpay (India)`);
  console.log(`💰 NON-FIREBASE SERVICE CHARGES: ELIMINATED (R2 has zero egress fees)`);
  console.log(`🔗 AFFILIATE PROGRAM ACTIVE: Manage affiliate products at /affiliate.html`);
  console.log(`   → Random 3 affiliates shown per prompt page (top, middle, bottom)`);
  
  console.log(`🖼️ AI IMAGE GENERATOR ACTIVE (DALL-E 3 + Vision):`);
  console.log(`   → Sticky bar on prompt pages with credit system`);
  console.log(`   → 5 free credits per user per day`);
  console.log(`   → Top-up: ₹20 for 50 credits via Razorpay`);
  console.log(`   → Upload image for style reference (GPT-4 Vision)`);
  
  console.log(`📸 INSTAGRAM BADGE:`);
  console.log(`   → Sticky left side badge with periodic shake animation every 5 seconds`);
  console.log(`   → Hover pauses the animation, scales up and highlights`);
  console.log(`   → Links to https://instagram.com/toolsprompt`);
  
  console.log(`💬 SOCIAL FEED + CHAT (SSE) ENABLED:`);
  console.log(`   → Real-time chat with replies, reactions (6 emojis), stickers`);
  console.log(`   → Activity feed for new uploads and platform updates`);
  console.log(`   → "Suggest Prompt" feature`);
  console.log(`   → Floating hearts on ❤️ reaction`);
  console.log(`   → Collapsible right-side panel (toggle)`);
});