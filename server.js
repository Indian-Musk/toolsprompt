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

// Initialize Firebase Admin
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
      storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET
    });
    adminInitialized = true;
    console.log('✅ Firebase Admin initialized successfully');
  } else {
    console.log('⚠️ Firebase Admin not configured - running in demo mode');
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error);
}

// Create mock admin object for development if not initialized
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
    storage: () => ({ 
      bucket: () => ({
        file: () => ({
          save: (buffer, options) => {
            console.log('Mock saving file with size:', buffer.length);
            return Promise.resolve();
          },
          makePublic: () => Promise.resolve(),
          createReadStream: () => require('stream').Readable.from([])
        })
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
const bucket = adminInitialized ? admin.storage().bucket() : (adminMock ? adminMock.storage().bucket() : null);

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
            // receipt: undefined, // No receipt - Razorpay will generate one
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

// Enhanced Engagement Analytics Class
class EngagementAnalytics {
  static async getPromptEngagement(promptId, db) {
    try {
      if (db && db.collection) {
        const doc = await db.collection('uploads').doc(promptId).get();
        if (doc.exists) {
          const data = doc.data();
          return {
            likes: data.likes || 0,
            views: data.views || 0,
            uses: data.uses || 0,
            copies: data.copies || 0,
            comments: data.commentCount || 0,
            engagementRate: this.calculateEngagementRate(data),
            popularityScore: this.calculatePopularityScore(data)
          };
        }
      }
      
      return {
        likes: Math.floor(Math.random() * 100),
        views: Math.floor(Math.random() * 500),
        uses: Math.floor(Math.random() * 50),
        copies: Math.floor(Math.random() * 25),
        comments: Math.floor(Math.random() * 15),
        engagementRate: Math.random() * 0.5 + 0.3,
        popularityScore: Math.floor(Math.random() * 100)
      };
    } catch (error) {
      console.error('Engagement analytics error:', error);
      return { likes: 0, views: 0, uses: 0, copies: 0, comments: 0, engagementRate: 0, popularityScore: 0 };
    }
  }

  static calculateEngagementRate(data) {
    const likes = data.likes || 0;
    const views = data.views || 1;
    const uses = data.uses || 0;
    const copies = data.copies || 0;
    const comments = data.commentCount || 0;
    
    return ((likes + uses + copies + comments) / views) || 0;
  }

  static calculatePopularityScore(data) {
    const likes = data.likes || 0;
    const views = data.views || 0;
    const uses = data.uses || 0;
    const copies = data.copies || 0;
    const comments = data.commentCount || 0;
    const recency = data.createdAt ? (Date.now() - new Date(data.createdAt).getTime()) : 0;
    
    const timeWeight = Math.max(0, 1 - (recency / (30 * 24 * 60 * 60 * 1000)));
    return Math.round(((likes * 2 + uses * 3 + copies * 2 + comments * 2 + views * 0.1) * timeWeight) / 10);
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
    cacheStats: cache.getStats(),
    adsense: {
      enabled: true,
      clientId: process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'
    },
    features: {
      comments: true,
      news: true,
      caching: true,
      miniBrowser: true,
      videoUploads: true,
      youtubeShorts: true,
      customThumbnails: true,
      marketplace: true
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

// Video streaming endpoint
app.get('/api/video/:videoId', async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const range = req.headers.range;
    
    const cacheKey = `video-${videoId}`;
    const cached = cache.get(cacheKey);
    
    if (cached && !range) {
      return res.redirect(cached);
    }
    
    if (db && db.collection) {
      const doc = await db.collection('uploads').doc(videoId).get();
      if (doc.exists) {
        const data = doc.data();
        const videoUrl = data.videoUrl || data.mediaUrl;
        
        if (videoUrl && videoUrl.startsWith('https://storage.googleapis.com/')) {
          if (bucket) {
            const fileName = videoUrl.split('/').pop();
            const file = bucket.file(`videos/${fileName}`);
            
            if (range) {
              const [metadata] = await file.getMetadata();
              const fileSize = metadata.size;
              
              const CHUNK_SIZE = 10 ** 6;
              const start = Number(range.replace(/\D/g, ''));
              const end = Math.min(start + CHUNK_SIZE, fileSize - 1);
              
              const contentLength = end - start + 1;
              
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': contentLength,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'public, max-age=3600'
              });
              
              const stream = file.createReadStream({ start, end });
              stream.pipe(res);
            } else {
              res.redirect(videoUrl);
            }
          } else {
            res.redirect(videoUrl);
          }
        } else {
          res.status(404).send('Video not found');
        }
      } else {
        res.status(404).send('Video not found');
      }
    } else {
      const mockVideoUrl = 'https://storage.googleapis.com/your-bucket/sample-video.mp4';
      res.redirect(mockVideoUrl);
    }
  } catch (error) {
    console.error('Video streaming error:', error);
    res.status(500).send('Error streaming video');
  }
});

// Thumbnail endpoint
app.get('/api/thumbnail/:promptId', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    
    if (db && db.collection) {
      const doc = await db.collection('uploads').doc(promptId).get();
      if (doc.exists) {
        const data = doc.data();
        const thumbnailUrl = data.thumbnailUrl || data.imageUrl;
        
        if (thumbnailUrl) {
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
        .limit(500)
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

// ==================== UPLOAD ENDPOINT ====================
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

      let mediaUrl, thumbnailUrl = null;
      if (bucket) {
        const timestamp = Date.now();
        const uniqueId = uuidv4();
        const mediaExtension = uploadedMediaFileName.split('.').pop();
        const mediaFolder = isVideo ? 'videos' : 'prompts';
        const storageMediaFileName = `${mediaFolder}/${timestamp}-${uniqueId}.${mediaExtension}`;
        const mediaFile = bucket.file(storageMediaFileName);
        await mediaFile.save(mediaBuffer, {
          metadata: {
            contentType: mediaFileType,
            metadata: {
              uploadedBy: fields.userName || 'anonymous',
              uploadedAt: new Date().toISOString(),
              fileType: isVideo ? 'video' : 'image',
              originalName: uploadedMediaFileName,
              hasThumbnail: !!thumbnailBuffer
            }
          }
        });
        await mediaFile.makePublic();
        mediaUrl = `https://storage.googleapis.com/${bucket.name}/${storageMediaFileName}`;
        if (thumbnailBuffer) {
          const thumbExtension = uploadedThumbnailFileName.split('.').pop();
          const thumbFileName = `thumbnails/${timestamp}-${uniqueId}.${thumbExtension}`;
          const thumbFile = bucket.file(thumbFileName);
          await thumbFile.save(thumbnailBuffer, {
            metadata: {
              contentType: thumbnailFileType,
              metadata: {
                uploadedBy: fields.userName || 'anonymous',
                uploadedAt: new Date().toISOString(),
                originalVideoId: uniqueId
              }
            }
          });
          await thumbFile.makePublic();
          thumbnailUrl = `https://storage.googleapis.com/${bucket.name}/${thumbFileName}`;
        }
      } else {
        if (isVideo) {
          mediaUrl = `https://storage.googleapis.com/mock-bucket/videos/sample-${Date.now()}.mp4`;
          thumbnailUrl = thumbnailBuffer ? `https://storage.googleapis.com/mock-bucket/thumbnails/sample-${Date.now()}.jpg` : 'https://via.placeholder.com/300x400/ff6b6b/ffffff?text=Video+Reel';
        } else {
          mediaUrl = 'https://via.placeholder.com/800x400/4e54c8/ffffff?text=Uploaded+Image';
        }
      }

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

    cache.set(cacheKey, result, 300);
    
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
    
    cache.set(cacheKey, html, 600);
    
    res.set('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('❌ Error serving news page:', error);
    sendNewsErrorPage(res, error);
  }
});

// COMMENT SYSTEM API ENDPOINTS

// Get comments for a prompt
app.get('/api/prompt/:id/comments', async (req, res) => {
  try {
    const promptId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const cacheKey = `comments-${promptId}-${page}-${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    let comments = [];
    let totalCount = 0;
    
    if (db && db.collection) {
      const countSnapshot = await db.collection('uploads').doc(promptId)
        .collection('comments')
        .count()
        .get();
      
      totalCount = countSnapshot.data().count || 0;
      
      const startIndex = (page - 1) * limit;
      const snapshot = await db.collection('uploads').doc(promptId)
        .collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      comments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: safeDateToString(doc.data().createdAt)
      }));
    } else {
      comments = generateMockComments(limit);
      totalCount = 25;
    }
    
    const result = {
      comments,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      hasMore: page * limit < totalCount
    };
    
    cache.set(cacheKey, result, 300);
    
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Post a new comment
app.post('/api/prompt/:id/comments', async (req, res) => {
  try {
    const promptId = req.params.id;
    const { content, authorName, authorEmail } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Comment is too long (max 1000 characters)' });
    }
    
    const commentData = {
      content: content.trim(),
      authorName: authorName?.trim() || 'Anonymous',
      authorEmail: authorEmail?.trim() || null,
      promptId: promptId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,
      isApproved: true
    };
    
    let commentRef;
    
    if (db && db.collection) {
      commentRef = await db.collection('uploads').doc(promptId)
        .collection('comments')
        .add(commentData);
      
      const promptRef = db.collection('uploads').doc(promptId);
      const promptDoc = await promptRef.get();
      
      if (promptDoc.exists) {
        const currentComments = promptDoc.data().commentCount || 0;
        await promptRef.update({
          commentCount: currentComments + 1,
          updatedAt: new Date().toISOString()
        });
      }
    } else {
      commentRef = { id: 'comment-' + Date.now() };
      console.log('Mock comment added:', commentData);
    }
    
    cache.keys().forEach(key => {
      if (key.startsWith(`comments-${promptId}-`)) {
        cache.del(key);
      }
    });
    
    cache.del(`prompt-${promptId}`);
    
    const responseData = {
      id: commentRef.id,
      ...commentData,
      message: 'Comment posted successfully!'
    };
    
    res.json({
      success: true,
      comment: responseData
    });
    
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// Like a comment
app.post('/api/comment/:commentId/like', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { promptId } = req.body;
    
    if (!promptId) {
      return res.status(400).json({ error: 'Prompt ID is required' });
    }
    
    if (db && db.collection) {
      const commentRef = db.collection('uploads').doc(promptId)
        .collection('comments')
        .doc(commentId);
      
      const commentDoc = await commentRef.get();
      
      if (commentDoc.exists) {
        const currentLikes = commentDoc.data().likes || 0;
        await commentRef.update({
          likes: currentLikes + 1,
          updatedAt: new Date().toISOString()
        });
      }
    }
    
    cache.keys().forEach(key => {
      if (key.startsWith(`comments-${promptId}-`)) {
        cache.del(key);
      }
    });
    
    res.json({ success: true, message: 'Comment liked' });
    
  } catch (error) {
    console.error('Error liking comment:', error);
    res.status(500).json({ error: 'Failed to like comment' });
  }
});

// Engagement API Endpoints

// Track view count
app.post('/api/prompt/:id/view', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    const shouldUpdate = Math.random() < 0.1;
    
    if (shouldUpdate && db && db.collection) {
      const promptRef = db.collection('uploads').doc(promptId);
      const promptDoc = await promptRef.get();
      
      if (promptDoc.exists) {
        const currentViews = promptDoc.data().views || 0;
        await promptRef.update({
          views: currentViews + 10
        });
      }
    }
    
    res.json({ success: true, message: 'View counted' });
  } catch (error) {
    console.error('Error counting view:', error);
    res.status(500).json({ error: 'Failed to count view' });
  }
});

// Like/Unlike prompt
app.post('/api/prompt/:id/like', async (req, res) => {
  try {
    const promptId = req.params.id;
    const { userId, action } = req.body;
    
    if (db && db.collection) {
      const promptRef = db.collection('uploads').doc(promptId);
      const promptDoc = await promptRef.get();
      
      if (promptDoc.exists) {
        const currentLikes = promptDoc.data().likes || 0;
        
        if (action === 'like') {
          await promptRef.update({
            likes: currentLikes + 1,
            updatedAt: new Date().toISOString()
          });
        } else {
          await promptRef.update({
            likes: Math.max(0, currentLikes - 1),
            updatedAt: new Date().toISOString()
          });
        }
      }
    } else {
      const prompt = mockPrompts.find(p => p.id === promptId);
      if (prompt) {
        if (action === 'like') {
          prompt.likes = (prompt.likes || 0) + 1;
        } else {
          prompt.likes = Math.max(0, (prompt.likes || 1) - 1);
        }
        prompt.updatedAt = new Date().toISOString();
      }
    }
    
    cache.del(`prompt-${promptId}`);
    
    res.json({ success: true, action });
  } catch (error) {
    console.error('Error updating like:', error);
    res.status(500).json({ error: 'Failed to update like' });
  }
});

// Track prompt use
app.post('/api/prompt/:id/use', async (req, res) => {
  try {
    const promptId = req.params.id;
    const { userId } = req.body;
    
    if (db && db.collection) {
      const promptRef = db.collection('uploads').doc(promptId);
      const promptDoc = await promptRef.get();
      
      if (promptDoc.exists) {
        const currentUses = promptDoc.data().uses || 0;
        await promptRef.update({
          uses: currentUses + 1,
          updatedAt: new Date().toISOString()
        });
      }
    } else {
      const prompt = mockPrompts.find(p => p.id === promptId);
      if (prompt) {
        prompt.uses = (prompt.uses || 0) + 1;
        prompt.updatedAt = new Date().toISOString();
      }
    }
    
    cache.del(`prompt-${promptId}`);
    
    res.json({ success: true, message: 'Use counted' });
  } catch (error) {
    console.error('Error counting use:', error);
    res.status(500).json({ error: 'Failed to count use' });
  }
});

// Track prompt copy actions
app.post('/api/prompt/:id/copy', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    const shouldUpdate = Math.random() < 0.3;
    
    if (shouldUpdate && db && db.collection) {
      const promptRef = db.collection('uploads').doc(promptId);
      const promptDoc = await promptRef.get();
      
      if (promptDoc.exists) {
        const currentCopies = promptDoc.data().copies || 0;
        await promptRef.update({
          copies: currentCopies + 1,
          lastCopiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Copy tracked',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error tracking copy:', error);
    res.json({ success: false, error: 'Failed to track copy' });
  }
});

// Get user engagement status
app.get('/api/prompt/:id/user-engagement', async (req, res) => {
  try {
    res.json({ userLiked: false, userUsed: false, userCopied: false });
  } catch (error) {
    res.json({ userLiked: false, userUsed: false, userCopied: false });
  }
});

// Engagement Analytics API Endpoint
app.get('/api/prompt/:id/engagement', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    const cacheKey = `engagement-${promptId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const engagement = await EngagementAnalytics.getPromptEngagement(promptId, db);
    
    cache.set(cacheKey, engagement, 120);
    
    res.json(engagement);
  } catch (error) {
    console.error('Engagement API error:', error);
    res.status(500).json({ error: 'Failed to fetch engagement data' });
  }
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
    
    cache.set(cacheKey, result, 180);
    
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

    cache.set(cacheKey, result, 120);
    
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
      const shouldUpdateView = Math.random() < 0.2;
      if (shouldUpdateView) {
        await db.collection('uploads').doc(promptId).update({
          views: (prompt.views || 0) + 5,
          updatedAt: new Date().toISOString()
        });
      }
    } else {
      const mockPrompt = mockPrompts.find(p => p.id === promptId) || mockPrompts[0];
      hasPurchased = false;
      promptData = createPromptData(mockPrompt, promptId, hasPurchased);
    }

    const html = generateEnhancedPromptHTML(promptData);
    cache.set(cacheKey, html, 300);
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
    
    cache.set(cacheKey, html, 600);
    
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

// Helper functions
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

.video-container {
    position: relative;
    width: 100%;
    background: #000;
    border-radius: 12px;
    overflow: hidden;
    margin: 1rem 0;
    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
}

.video-player {
    width: 100%;
    max-height: 600px;
    display: block;
    background: #000;
    aspect-ratio: 16/9;
    object-fit: contain;
}

.video-info {
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: rgba(78, 84, 200, 0.1);
    border-radius: 8px;
    flex-wrap: wrap;
    align-items: center;
}

.video-info-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #4e54c8;
    font-size: 0.9rem;
}

.video-info-item i {
    font-size: 1rem;
}

.video-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #ff6b6b;
    color: white;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 5;
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

@media (max-width: 768px) {
    .platform-comparison {
        padding: 1.5rem;
    }
    
    .comparison-table-container {
        padding: 0.75rem;
    }
    
    .platform-comparison-table th,
    .platform-comparison-table td {
        padding: 0.75rem;
    }
    
    .model-tips-grid {
        grid-template-columns: 1fr;
    }
    
    .tools-grid-enhanced {
        grid-template-columns: 1fr;
    }
    
    .copy-prompt-btn {
        padding: 6px 12px;
        font-size: 0.8rem;
    }
}

@media (max-width: 480px) {
    .platform-comparison {
        padding: 1rem;
    }
    
    .platform-comparison-table {
        font-size: 0.9rem;
    }
    
    .platform-comparison-table th,
    .platform-comparison-table td {
        padding: 0.5rem;
    }
    
    .price-tag,
    .category-badge {
        font-size: 0.7rem;
        padding: 2px 8px;
    }
    
    .price-badge {
        font-size: 0.7rem;
        padding: 3px 8px;
    }
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

function generateEnhancedPromptHTML(promptData) {
  // Add this line
  const prompt = promptData;
  
  const promptAdHTML = generatePromptAdPlacement();
  const baseUrl = 'https://www.toolsprompt.com';
  const promptUrl = baseUrl + '/prompt/' + promptData.id;
  const gaId = process.env.GOOGLE_ANALYTICS_ID || 'G-K4KXR4FZCP';
  const isVideo = promptData.fileType === 'video' || promptData.videoUrl || promptData.category === 'video';
  
  const platformInfo = promptData.platformInfo || { name: 'AI Platform', strengths: [] };
  const detectedPlatform = promptData.detectedPlatform || 'general';
  
  const googleAnalyticsCode = `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}');
    </script>
  `;

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

  return `<!DOCTYPE html>
<html lang="en">
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
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f5f7fa; line-height: 1.6; color: #2d334a; }
        
        ${miniBrowserCSS}
        ${platformComparisonCSS}
        ${commentSystemCSS}
        
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
            
            .shorts-video-container {
                height: 400px;
            }
        }

        @media (max-width: 480px) {
            .content-grid {
                grid-template-columns: 1fr;
            }
            
            .shorts-video-container {
                height: 350px;
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
        
        .ad-container {
            margin: 1.5rem 0;
            text-align: center;
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        .ad-label {
            font-size: 0.8rem;
            color: #6c757d;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 1px;
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
    </style>
</head>
<body>
    <header class="site-header">
        <div class="header-container">
            <a href="https://www.toolsprompt.com" class="logo">
                <img src="https://www.toolsprompt.com/logo.png" alt="tools prompt Logo">
                <span>tools prompt</span>
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

            ${promptAdHTML}
            
            ${mediaDisplay}

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

                ${promptAdHTML}

                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-info-circle"></i> About This ${isVideo ? 'AI Video' : 'AI Prompt'}</h2>
                    <div class="platform-intro">
                        <p>${promptData.detailedExplanation}</p>
                    </div>
                </section>

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

            ${promptAdHTML}
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
                </ul>
            </div>
        </div>
        <div class="copyright">
            <p>&copy; 2026 toolsprompt.com All rights reserved. | AI Prompt Marketplace - Buy and Sell AI Prompts</p>
        </div>
    </footer>

    ${miniBrowserHTML}


    <script>
        console.log('Initializing tools prompt page with marketplace features');
        
        const isVideo = ${isVideo};
        const promptId = '${promptData.id}';
        const promptText = document.getElementById('promptText')?.textContent || '';
        const promptPrice = ${promptData.price};
        const isPaid = ${promptData.isPaid};
        const photoModelCount = ${AIModelManager.getPhotoModelCount()};
        const videoModelCount = ${AIModelManager.getVideoModelCount()};
        const totalModelCount = photoModelCount + videoModelCount;

        if (!document.querySelector('link[href*="font-awesome"]')) {
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(faLink);
        }

        async function updateEngagementStats() {
            try {
                const response = await fetch('/api/prompt/${promptData.id}/engagement');
                if (response.ok) {
                    const data = await response.json();
                }
            } catch (error) {
                console.error('Error updating engagement stats:', error);
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadRelatedPrompts('${promptData.id}', '${(promptData.keywords || ['AI'])[0]}');
            
            if (isVideo) {
                const video = document.querySelector('video');
                if (video) {
                    video.addEventListener('loadedmetadata', function() {
                        console.log('Video loaded, duration:', video.duration);
                    });
                }
            }
        });

        async function loadRelatedPrompts(currentId, keyword) {
            try {
                const response = await fetch('/api/search?q=' + encodeURIComponent(keyword) + '&limit=6');
                
                if (!response.ok) throw new Error('API error');
                
                const data = await response.json();
                const relatedContainer = document.getElementById('relatedPrompts');
                
                if (!relatedContainer) return;
                
                if (data.prompts && data.prompts.length > 0) {
                    let html = '';
                    let count = 0;
                    
                    for (let i = 0; i < data.prompts.length && count < 3; i++) {
                        const prompt = data.prompts[i];
                        if (prompt && prompt.id && prompt.id !== currentId) {
                            const promptImage = prompt.thumbnailUrl || prompt.imageUrl || 'https://via.placeholder.com/300x200/4e54c8/ffffff?text=Prompt';
                            const isVideoPrompt = prompt.fileType === 'video' || prompt.category === 'video';
                            const promptPrice = prompt.price || 0;
                            const isPaidPrompt = promptPrice > 0;
                            
                            html += '<div class="related-prompt-card">' +
                                '<img src="' + promptImage + '" class="related-prompt-image">' +
                                '<div class="price-badge ' + (isPaidPrompt ? '' : 'free') + '" style="position: absolute; top: 10px; left: 10px; font-size: 0.7rem; padding: 2px 8px;">' + 
                                    (isPaidPrompt ? '₹' + promptPrice : 'Free') + 
                                '</div>' +
                                (isVideoPrompt ? '<span class="video-badge"><i class="fas fa-video"></i> Reel</span>' : '') +
                                '<div class="related-prompt-content">' +
                                    '<h4>' + (prompt.title || 'Untitled').substring(0, 50) + '</h4>' +
                                    '<a href="/prompt/' + prompt.id + '" class="engagement-btn">' + (isVideoPrompt ? 'Watch Reel' : (isPaidPrompt ? 'Buy for ₹' + promptPrice : 'View Prompt')) + '</a>' +
                                '</div>' +
                            '</div>';
                            count++;
                        }
                    }
                    
                    relatedContainer.innerHTML = html || '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #666;">No related prompts found</div>';
                } else {
                    relatedContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #666;">No prompts available</div>';
                }
            } catch (error) {
                console.error('Error:', error);
                const container = document.getElementById('relatedPrompts');
                if (container) {
                    container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #666;">Error loading related prompts</div>';
                }
            }
        }

        let copyTimeout = null;
        let isCopied = false;

        async function copyPromptToClipboard() {
            const copyBtn = document.getElementById('copyPromptBtn');
            
            if (isPaid) {
                const user = await getCurrentUser();
                const purchased = await checkPurchaseStatus(promptId);
                
                if (purchased) {
                    const promptElement = document.getElementById('promptText');
                    const promptContent = promptElement.textContent || promptElement.innerText;
                    await navigator.clipboard.writeText(promptContent);
                    handleCopySuccess(copyBtn);
                    trackCopyAction(promptId);
                } else {
                    showBuyPromptModal({
                        id: promptId,
                        title: '${promptData.title.replace(/'/g, "\\'")}',
                        promptText: promptText,
                        imageUrl: '${promptData.imageUrl}',
                        price: promptPrice,
                        userName: '${promptData.userName}'
                    });
                }
            } else {
                const promptElement = document.getElementById('promptText');
                const promptContent = promptElement.textContent || promptElement.innerText;
                await navigator.clipboard.writeText(promptContent);
                handleCopySuccess(copyBtn);
                trackCopyAction(promptId);
            }
        }

        async function checkPurchaseStatus(promptId) {
            try {
                const user = await getCurrentUser();
                if (!user) return false;
                const response = await fetch('/api/check-purchase/' + promptId + '?userId=' + user.uid);
                const data = await response.json();
                return data.purchased;
            } catch (error) {
                console.error('Error checking purchase:', error);
                return false;
            }
        }

        function handleCopySuccess(copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            copyBtn.classList.add('copied');
            copyBtn.disabled = true;
            
            showCopyNotification('Prompt copied!', 'success');
            trackCopyAction(promptId);
            
            if (copyTimeout) clearTimeout(copyTimeout);
            copyTimeout = setTimeout(() => {
                copyBtn.innerHTML = '<i class="far fa-copy"></i> ' + (isPaid ? 'Copy Prompt' : 'Copy Prompt');
                copyBtn.classList.remove('copied');
                copyBtn.disabled = false;
                isCopied = false;
            }, 3000);
            
            isCopied = true;
        }

        function showCopyNotification(message, type = 'success') {
            const existingNotifications = document.querySelectorAll('.copy-notification');
            existingNotifications.forEach(notification => notification.remove());
            
            const notification = document.createElement('div');
            notification.className = \`copy-notification \${type}\`;
            notification.style.cssText = \`
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: \${type === 'success' ? '#20bf6b' : '#ff6b6b'};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                z-index: 10001;
                animation: slideIn 0.3s ease;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            \`;
            notification.innerHTML = \`
                <i class="fas fa-\${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
                <span>\${message}</span>
            \`;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }

        function handlePromptClick(event) {
            if (event.target.closest('.copy-prompt-btn')) return;
            copyPromptToClipboard();
        }

        function handlePromptContextMenu(event) {
            event.preventDefault();
            copyPromptToClipboard();
            return false;
        }

        function trackCopyAction(promptId) {
            fetch('/api/prompt/' + promptId + '/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ promptId, action: 'copy', timestamp: new Date().toISOString() })
            }).catch(err => console.log('Analytics error:', err));
        }

        async function handleLike(promptId) {
            try {
                const likeBtn = document.querySelector('.like-btn');
                const isLiked = likeBtn.classList.contains('liked');
                const action = isLiked ? 'unlike' : 'like';
                
                const response = await fetch('/api/prompt/' + promptId + '/like', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: 'anonymous', action })
                });
                
                if (response.ok) {
                    if (action === 'like') {
                        likeBtn.innerHTML = '<i class="fas fa-heart"></i> Liked';
                        likeBtn.classList.add('liked');
                    } else {
                        likeBtn.innerHTML = '<i class="far fa-heart"></i> Like Prompt';
                        likeBtn.classList.remove('liked');
                    }
                }
            } catch (error) {
                console.error('Like error:', error);
            }
        }
        
        async function handleUse(promptId) {
            try {
                const useBtn = document.querySelector('.use-btn');
                const response = await fetch('/api/prompt/' + promptId + '/use', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: 'anonymous' })
                });
                
                if (response.ok) {
                    useBtn.innerHTML = '<i class="fas fa-check"></i> Used!';
                    useBtn.classList.add('used');
                    setTimeout(() => {
                        useBtn.innerHTML = '<i class="fas fa-download"></i> Mark as Used';
                        useBtn.classList.remove('used');
                    }, 3000);
                }
            } catch (error) {
                console.error('Use error:', error);
            }
        }
        
        function handleShare(promptId) {
            const promptUrl = window.location.href;
            
            if (navigator.share) {
                navigator.share({
                    title: document.title,
                    text: 'Check out this AI ' + (isVideo ? 'video' : 'prompt') + ' on tools prompt',
                    url: promptUrl
                }).catch(() => {
                    navigator.clipboard.writeText(promptUrl).then(() => {
                        alert('Link copied to clipboard!');
                    });
                });
            } else {
                navigator.clipboard.writeText(promptUrl).then(() => {
                    alert('Link copied to clipboard!');
                });
            }
        }

        async function getCurrentUser() {
            return new Promise((resolve) => {
                if (typeof firebase !== 'undefined' && firebase.auth) {
                    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                        unsubscribe();
                        resolve(user);
                    });
                } else {
                    resolve(null);
                }
            });
        }

        function showBuyPromptModal(prompt) {
            const modalHTML = \`
                <div class="buy-modal-overlay" id="buyPromptModal">
                    <div class="buy-modal">
                        <div class="modal-header">
                            <h2><i class="fas fa-shopping-cart"></i> Purchase Prompt</h2>
                            <button class="close-modal" onclick="closeBuyModal()">&times;</button>
                        </div>
                        <div class="buy-modal-content">
                            <div class="prompt-preview">
                                <img src="\${prompt.imageUrl}" alt="\${prompt.title}" class="buy-prompt-image">
                                <h3>\${prompt.title}</h3>
                                <p class="prompt-price-large">₹\${prompt.price}</p>
                                <p class="prompt-creator">By: \${prompt.userName}</p>
                            </div>
                            <div class="payment-form">
                                <h3>Payment Details</h3>
                                <div class="payment-info" style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                                    <p style="margin: 0; font-size: 0.9rem; color: #666;">
                                        <i class="fas fa-shield-alt"></i> Secure payment powered by Razorpay
                                    </p>
                                    <p style="margin: 5px 0 0; font-size: 0.8rem; color: #888;">
                                        Supports UPI, Credit/Debit Cards, Net Banking, and Wallets
                                    </p>
                                </div>
                                <button class="buy-now-btn" id="buyNowBtn">
                                    <i class="fas fa-rupee-sign"></i> Pay ₹\${prompt.price}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            \`;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            document.body.style.overflow = 'hidden';
            
            const buyBtn = document.getElementById('buyNowBtn');
            if (buyBtn) {
                buyBtn.addEventListener('click', async () => {
                    await processPaymentWithRazorpay(prompt);
                });
            }
        }
        
        function closeBuyModal() {
            const modal = document.getElementById('buyPromptModal');
            if (modal) {
                modal.remove();
                document.body.style.overflow = '';
            }
        }
        
        async function processPaymentWithRazorpay(prompt) {
            const buyBtn = document.getElementById('buyNowBtn');
            const originalText = buyBtn.innerHTML;
            buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating order...';
            buyBtn.disabled = true;
            
            try {
                const user = await getCurrentUser();
                if (!user) {
                    showCopyNotification('Please login to purchase prompts', 'error');
                    window.location.href = '/login.html?returnUrl=' + encodeURIComponent(window.location.href);
                    return;
                }
                
                const response = await fetch('/api/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        promptId: prompt.id,
                        price: prompt.price,
                        userId: user.uid,
                        userEmail: user.email
                    })
                });
                
                const data = await response.json();
                
                if (data.isDemo) {
                    buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
                    await completePurchase(prompt, user, null);
                    closeBuyModal();
                    return;
                }
                
                // Load Razorpay script if needed
                if (typeof Razorpay === 'undefined') {
                    await new Promise((resolve) => {
                        const script = document.createElement('script');
                        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
                        script.onload = resolve;
                        document.head.appendChild(script);
                    });
                }
                
                const options = {
                    key: data.keyId,
                    amount: data.amount,
                    currency: data.currency,
                    name: 'tools prompt',
                    description: 'Purchase: ${prompt.title}',
                    order_id: data.orderId,
                    handler: async function(response) {
                        buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying payment...';
                        
                        try {
                            const verifyResponse = await fetch('/api/verify-payment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    orderId: response.razorpay_order_id,
                                    paymentId: response.razorpay_payment_id,
                                    signature: response.razorpay_signature,
                                    promptId: prompt.id,
                                    userId: user.uid,
                                    userEmail: user.email,
                                    amount: prompt.price
                                })
                            });
                            
                            const verifyData = await verifyResponse.json();
                            
                            if (verifyData.success) {
                                showCopyNotification('Payment successful! Prompt copied to clipboard.', 'success');
                                await navigator.clipboard.writeText(prompt.promptText);
                                closeBuyModal();
                                
                                if (window.location.pathname.includes('dashboard.html')) {
                                    location.reload();
                                }
                            } else {
                                throw new Error(verifyData.error || 'Payment verification failed');
                            }
                        } catch (error) {
                            console.error('Verification error:', error);
                            showCopyNotification('Payment recorded but verification failed. Contact support.', 'error');
                        }
                    },
                    modal: {
                        ondismiss: function() {
                            showCopyNotification('Payment cancelled', 'info');
                        }
                    },
                    theme: {
                        color: '#4e54c8'
                    }
                };
                
                const razorpayInstance = new Razorpay(options);
                razorpayInstance.open();
                
            } catch (error) {
                console.error('Payment error:', error);
                showCopyNotification(error.message || 'Payment failed. Please try again.', 'error');
            } finally {
                buyBtn.innerHTML = originalText;
                buyBtn.disabled = false;
            }
        }
        
        async function completePurchase(prompt, user, paymentId) {
            try {
                const response = await fetch('/api/complete-purchase', {
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

                const data = await response.json();

                if (data.success) {
                    try {
                        closeBuyModal();
                    } catch (e) {
                        const modal = document.getElementById('buyPromptModal');
                        if (modal) modal.remove();
                        document.body.style.overflow = '';
                    }

                    showCopyNotification('Purchase successful! Prompt copied to clipboard.', 'success');
                    await navigator.clipboard.writeText(prompt.promptText);

                    if (window.location.pathname.includes('dashboard.html')) {
                        location.reload();
                    }
                } else {
                    throw new Error(data.error || 'Purchase completion failed');
                }
            } catch (error) {
                console.error('Purchase completion error:', error);
                showCopyNotification('Purchase recorded but prompt copy failed. Check your dashboard.', 'error');
            }
        }

        ${miniBrowserJS}
        ${generateCommentSystemJS(promptData)}
    </script>
</body>
</html>`;
}

function generateCategoryHTML(category, baseUrl) {
  const categoryNames = {
    'art': 'AI Art', 'photography': 'AI Photography', 'design': 'AI Design',
    'writing': 'AI Writing', 'video': 'AI Video Reels', 'other': 'Other AI Creations'
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
  
  console.log(`🤖 AI MODELS ENHANCED: ${totalCount} TOTAL AI PLATFORMS SUPPORTED!`);
  console.log(`   📸 PHOTO MODELS (${photoCount})`);
  console.log(`   🎬 VIDEO MODELS (${videoCount})`);
  console.log(`💰 MARKETPLACE ACTIVE: Buy and sell prompts!`);
  console.log(`💳 PAYMENT GATEWAY: Razorpay (India)`);
});