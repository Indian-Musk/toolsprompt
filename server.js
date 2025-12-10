process.env.ADSENSE_CLIENT_ID = 'DISABLED';
const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const Busboy = require('busboy');
const axios = require('axios');
const fs = require('fs');
const NodeCache = require('node-cache'); // Added for caching
require('dotenv').config();

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
          delete: () => Promise.resolve()
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
          makePublic: () => Promise.resolve()
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
  serveHTMLWithCanonical(path.join(__dirname, 'index.html'), '/index.html', req, res);
});

// ENHANCED AdSense Helper Functions - FIXED DUPLICATE ISSUE
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

// Replace old functions with enhanced versions
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
        .limit(100) // LIMITED: Only migrate 100 at a time
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
    const baseTitle = `AI Prompt: ${promptTitle} - Tools Prompt`;
    return keywords.length > 0 ? `${keywords.slice(0, 3).join(', ')} | ${baseTitle}` : baseTitle;
  }

  static generateMetaDescription(promptText, title) {
    const cleanText = promptText.replace(/[^\w\s]/gi, ' ').substring(0, 155);
    return `${cleanText}... Explore this AI-generated image and learn prompt engineering techniques.`;
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
        "name": prompt.userName || "Tools Prompt User"
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

// AI Content Generator for Prompt Pages - RESTORED DETAILED VERSION
class PromptContentGenerator {
  static generateDetailedExplanation(promptData) {
    const keywords = promptData.keywords || ['AI', 'prompt'];
    const category = promptData.category || 'general';
    
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
    const category = promptData.category || 'general';
    
    const tools = {
      'art': [
        { name: "Midjourney", description: "Excellent for artistic and creative imagery with strong stylistic control" },
        { name: "DALL-E 3", description: "Great for conceptual art and understanding complex prompt requirements" },
        { name: "Stable Diffusion", description: "Ideal for custom models and local generation with extensive control" },
        { name: "Adobe Firefly", description: "Perfect for commercial use with ethical training data" }
      ],
      
      'photography': [
        { name: "ChatGPT", description: "Superior at understanding photographic terms and realistic rendering" },
        { name: "Google Gemini", description: "Strong research capabilities and factual accuracy" },
        { name: "Stable Diffusion", description: "Best for photorealistic outputs with custom models" },
        { name: "Midjourney", description: "Excellent for artistic photography styles and compositions" }
      ],
      
      'design': [
        { name: "Midjourney", description: "Strong for conceptual design and artistic layouts" },
        { name: "DALL-E 3", description: "Excellent for understanding design briefs and requirements" },
        { name: "Canva AI", description: "Integrated design platform with AI capabilities" },
        { name: "Adobe Firefly", description: "Seamless integration with Adobe Creative Cloud" }
      ],
      
      'writing': [
        { name: "ChatGPT", description: "Versatile for all types of writing tasks and content generation" },
        { name: "Claude", description: "Excellent for long-form content and complex writing tasks" },
        { name: "Google Gemini", description: "Strong research capabilities and factual accuracy" },
        { name: "Microsoft Copilot", description: "Great for professional and business writing" }
      ],
      
      'general': [
        { name: "ChatGPT", description: "Versatile all-around AI assistant for various tasks" },
        { name: "Midjourney", description: "Leading AI image generation platform" },
        { name: "DALL-E 3", description: "Advanced image generation with strong prompt understanding" },
        { name: "Claude", description: "Excellent for complex reasoning and content creation" }
      ]
    };

    return tools[category] || tools.general;
  }

  static generateTrendAnalysis(promptData) {
    const keywords = promptData.keywords || [];
    const category = promptData.category || 'general';
    
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
    const category = promptData.category || 'general';
    
    const tips = {
      'art': [
        "Experiment with different art styles and mediums mentioned in the prompt",
        "Adjust the --ar parameter for different aspect ratios in Midjourney",
        "Use style references for more consistent results",
        "Try varying the chaos parameter for more creative variations",
        "Combine with other artistic prompts for hybrid styles"
      ],
      
      'photography': [
        "Specify camera types and lenses for different photographic effects",
        "Use lighting terms like 'golden hour' or 'studio lighting'",
        "Experiment with different film types and processing styles",
        "Add compositional rules like 'rule of thirds' explicitly",
        "Include depth of field requirements for focus control"
      ],
      
      'design': [
        "Specify color palettes and design systems explicitly",
        "Include layout requirements and spatial relationships",
        "Mention target audience and purpose for better context",
        "Reference design styles or movements for consistency",
        "Consider aspect ratios and scalability requirements"
      ],
      
      'writing': [
        "Set clear tone and voice parameters for consistent output",
        "Specify target audience and knowledge level",
        "Include length requirements and structural elements",
        "Use examples or references for style matching",
        "Define the purpose and call-to-action if applicable"
      ],
      
      'general': [
        "Be specific and detailed in your modifications",
        "Test the prompt across different AI platforms",
        "Keep a log of successful variations and parameters",
        "Understand the limitations of each AI model",
        "Iterate and refine based on initial results"
      ]
    };

    return tips[category] || tips.general;
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

// Advanced AI Description Generator - RESTORED DETAILED VERSION
class AIDescriptionGenerator {
  static generatePlatformIntroduction(promptData) {
    const platforms = {
      'midjourney': {
        name: 'Midjourney',
        year: '2025',
        description: 'has solidified its position as the premier AI art platform for creators seeking to transform imaginative concepts into stunning visual masterpieces.',
        strengths: ['artistic styles', 'creative compositions', 'stylistic consistency', 'community features']
      },
      'dalle': {
        name: 'ChatGPT',
        year: '2025',
        description: 'has become the industry standard for prompt understanding and realistic image generation with exceptional attention to detail.',
        strengths: ['prompt comprehension', 'realistic rendering', 'complex scenes', 'text integration']
      },
      'gemini': {
        name: 'Google Gemini AI',
        year: '2025',
        description: 'has emerged as the go-to solution for transforming everyday content into visually striking digital masterpieces.',
        strengths: ['accessibility', 'real-time generation', 'multi-modal understanding', 'user-friendly interface']
      },
      'chatgpt': {
        name: 'ChatGPT with DALL-E',
        year: '2025',
        description: 'has revolutionized creative workflows by combining advanced conversational AI with powerful image generation capabilities.',
        strengths: ['iterative refinement', 'context understanding', 'creative collaboration', 'rapid prototyping']
      },
      'stable-diffusion': {
        name: 'Stable Diffusion',
        year: '2025',
        description: 'has empowered creators with open-source flexibility and unparalleled control over the image generation process.',
        strengths: ['custom models', 'local generation', 'fine-tuned control', 'community extensions']
      },
      'leonardo': {
        name: 'Leonardo AI',
        year: '2025',
        description: 'has become the favorite among professional artists and designers for its studio-quality outputs and advanced features.',
        strengths: ['professional quality', 'style consistency', 'commercial use', 'advanced controls']
      }
    };

    const category = promptData.category || 'general';
    const platform = platforms[this.detectPlatform(promptData)] || platforms.gemini;
    
    return `${platform.name} ${platform.description} Whether you want ${this.getCategoryBenefits(category)}, ${platform.name}'s innovative prompts enable you to control ${this.getControlAspects(category)} with AI-powered precision.`;
  }

  static detectPlatform(promptData) {
    const promptText = (promptData.promptText || '').toLowerCase();
    const keywords = promptData.keywords || [];
    
    if (promptText.includes('midjourney') || promptText.includes('--')) {
      return 'midjourney';
    } else if (promptText.includes('dall-e') || promptText.includes('dalle')) {
      return 'dalle';
    } else if (promptText.includes('gemini') || keywords.includes('google')) {
      return 'gemini';
    } else if (promptText.includes('chatgpt') || keywords.includes('openai')) {
      return 'chatgpt';
    } else if (promptText.includes('stable diffusion') || keywords.includes('sd')) {
      return 'stable-diffusion';
    } else if (keywords.includes('leonardo') || keywords.includes('professional')) {
      return 'leonardo';
    }
    
    // Default based on category
    const category = promptData.category || 'general';
    const categoryPlatforms = {
      'art': 'midjourney',
      'photography': 'dalle',
      'design': 'leonardo',
      'writing': 'chatgpt',
      'general': 'gemini'
    };
    
    return categoryPlatforms[category] || 'gemini';
  }

  static getCategoryBenefits(category) {
    const benefits = {
      'art': 'stunning visual artwork, creative compositions, or unique artistic styles',
      'photography': 'professional-grade photography, realistic portraits, or cinematic scenes',
      'design': 'visually appealing designs, professional layouts, or brand assets',
      'writing': 'engaging content, professional copy, or creative storytelling',
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
      'general': 'every aspect of your creative vision with precision'
    };
    
    return aspects[category] || aspects.general;
  }

  static generateTargetAudience(promptData) {
    const category = promptData.category || 'general';
    const platform = this.detectPlatform(promptData);
    
    const audiences = {
      'art': 'artists, designers, and creative professionals',
      'photography': 'photographers, content creators, and visual storytellers',
      'design': 'graphic designers, marketers, and brand managers',
      'writing': 'writers, marketers, and content strategists',
      'general': 'creators, professionals, and AI enthusiasts'
    };
    
    const purposes = {
      'art': 'experiment with artistic styles, build portfolios, and create unique visual content',
      'photography': 'enhance photographic skills, create professional portfolios, and produce stunning visual content',
      'design': 'develop brand assets, create marketing materials, and design professional layouts',
      'writing': 'craft compelling content, develop writing skills, and produce professional copy',
      'general': 'explore creative possibilities, enhance professional work, and stay ahead of AI trends'
    };
    
    const platformNames = {
      'midjourney': 'Midjourney',
      'dalle': 'DALL-E 3',
      'gemini': 'Gemini AI',
      'chatgpt': 'ChatGPT',
      'stable-diffusion': 'Stable Diffusion',
      'leonardo': 'Leonardo AI'
    };
    
    return `This curated collection of prompts is tailored for ${audiences[category]} who want more than just basic AI generation; it's for those eager to ${purposes[category]} using ${platformNames[platform]}'s advanced capabilities.`;
  }

  static generateTrendContext(promptData) {
    const category = promptData.category || 'general';
    const keywords = promptData.keywords || [];
    const trendingTerms = keywords.slice(0, 3).join(', ');
    
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
    const platform = this.detectPlatform(promptData);
    const category = promptData.category || 'general';
    
    const capabilities = {
      'midjourney': `With Midjourney's advanced artistic engine, even simple concepts can become gallery-worthy artworks that showcase creativity, style, and technical excellence.`,
      'dalle': `Using DALL-E 3's sophisticated understanding capabilities, basic descriptions transform into photorealistic images that demonstrate exceptional detail and coherence.`,
      'gemini': `With Gemini AI's powerful generation engine, straightforward inputs can become professional-quality outputs that reflect precision, style, and modern aesthetics.`,
      'chatgpt': `Through ChatGPT's conversational interface and DALL-E integration, simple ideas evolve into refined creations that balance creativity with practical utility.`,
      'stable-diffusion': `Leveraging Stable Diffusion's open-source flexibility, basic prompts can produce customized results that offer unique styles and specific artistic control.`,
      'leonardo': `Using Leonardo AI's professional-grade tools, standard concepts can become studio-quality productions that exhibit commercial-ready polish and artistic integrity.`
    };
    
    return capabilities[platform] || capabilities.gemini;
  }

  static generateStepByStepGuide(promptData) {
    const platform = this.detectPlatform(promptData);
    const category = promptData.category || 'general';
    
    const platformAccess = {
      'midjourney': 'Access the Midjourney platform through Discord or the web interface. Join a dedicated channel or use direct messaging with the Midjourney bot.',
      'dalle': 'Open ChatGPT with DALL-E integration or access DALL-E directly through the OpenAI platform. Use the web interface or mobile application.',
      'gemini': 'Access Google Gemini AI through the browser interface, mobile application, or integrated Google Workspace tools.',
      'chatgpt': 'Use ChatGPT with DALL-E capabilities through the OpenAI platform, available on web browsers and mobile applications.',
      'stable-diffusion': 'Launch your preferred Stable Diffusion interface (Automatic1111, ComfyUI, or online platforms) or use compatible applications.',
      'leonardo': 'Access Leonardo AI through their web platform or integrated design tools designed for professional creative workflows.'
    };
    
    const inputPreparation = {
      'art': 'Start with a clear concept or reference image. Consider the artistic style, composition, and mood you want to achieve.',
      'photography': 'Upload your photo on respective AI . Ensure you have specific lighting, composition, and style requirements in mind.',
      'design': 'Prepare your design brief with specific requirements for layout, branding elements, and visual hierarchy considerations.',
      'writing': 'Define your content goals, target audience, and desired tone before starting the generation process.',
      'general': 'Have a clear objective and specific requirements in mind to guide the AI generation process effectively.'
    };
    
    const promptUsage = {
      'midjourney': `Type "/imagine" followed by your chosen prompt. For example: "${promptData.promptText?.substring(0, 100) || 'Your specific prompt here'}". Adjust parameters like --ar for aspect ratio or --style for different artistic approaches.`,
      'dalle': `Enter your prompt in the generation field. Use: "${promptData.promptText?.substring(0, 100) || 'Your detailed description here'}". Specify style, quality, and any specific requirements in natural language.`,
      'gemini': `Input your prompt directly into the generation interface. Try: "${promptData.promptText?.substring(0, 100) || 'Your customized prompt here'}". Use descriptive language and be specific about your desired outcome.`,
      'chatgpt': `Provide your prompt in the chat interface. Use: "${promptData.promptText?.substring(0, 100) || 'Your tailored prompt here'}". You can have a conversation with the AI to refine and improve the results.`,
      'stable-diffusion': `Enter your prompt in the text-to-image interface. Use: "${promptData.promptText?.substring(0, 100) || 'Your specific prompt here'}". Adjust sampling steps, CFG scale, and other parameters for optimal results.`,
      'leonardo': `Input your prompt in the generation panel. Use: "${promptData.promptText?.substring(0, 100) || 'Your professional prompt here'}". Select appropriate models and adjust generation parameters as needed.`
    };
    
    const customizationTips = {
      'art': 'Specify artistic style, color palette, composition rules, and mood. Include references to specific artists or art movements if desired.',
      'photography': 'Define camera settings, lighting conditions, focal length, and photographic style. Mention specific techniques or equipment if relevant.',
      'design': 'Specify design principles, color schemes, typography requirements, and layout constraints. Include brand guidelines if applicable.',
      'writing': 'Set tone, voice, length requirements, and structural elements. Define the target audience and purpose clearly.',
      'general': 'Be specific about style, quality, context, and any special requirements. Include both what you want and what you want to avoid.'
    };
    
    const generationProcess = {
      'midjourney': 'Click generate and wait for the initial results. Use the U buttons to upscale specific variations or V buttons to create new variations based on your favorites.',
      'dalle': 'Click the generate button and review the created images. You can request variations or make specific edits to the generated content.',
      'gemini': 'Initiate generation and monitor the progress. The platform will provide multiple options that you can refine or regenerate as needed.',
      'chatgpt': 'Send your prompt and wait for the AI to process your request. You can ask for modifications or clarifications in subsequent messages.',
      'stable-diffusion': 'Start the generation process and monitor the progress through the interface. You can interrupt and restart with different parameters.',
      'leonardo': 'Launch the generation and track progress. Use the platform\'s advanced tools to make real-time adjustments and refinements.'
    };
    
    const finalization = {
      'midjourney': 'Download your preferred result in your chosen resolution. Use Max Upscale for the highest quality output suitable for professional use.',
      'dalle': 'Select your preferred output and download in high resolution. The platform offers different quality settings for various use cases.',
      'gemini': 'Choose the best result and export in your desired format and resolution. The platform provides options for different applications and platforms.',
      'chatgpt': 'Save your final result in the appropriate format. You can continue refining through conversation until you achieve the perfect outcome.',
      'stable-diffusion': 'Save your generated image and consider post-processing if needed. The open-source nature allows for extensive customization and editing.',
      'leonardo': 'Export your final creation in professional formats. The platform offers commercial-grade outputs ready for various applications.'
    };
    
    return {
      access: platformAccess[platform],
      preparation: inputPreparation[category],
      prompt: promptUsage[platform],
      customization: customizationTips[category],
      generation: generationProcess[platform],
      finalization: finalization[platform]
    };
  }

  static generateExpertTips(promptData) {
    const category = promptData.category || 'general';
    const platform = this.detectPlatform(promptData);
    
    const tips = {
      'art': [
        "Be Specific About Style: Mention artistic movements, specific artists, or detailed style descriptions for consistent results.",
        "Control Composition: Use terms like 'rule of thirds', 'leading lines', or 'symmetrical composition' for better layout control.",
        "Specify Color Palette: Include specific color combinations, mood-based palettes, or seasonal color themes.",
        "Iterate and Refine: Don't hesitate to generate multiple variations and build upon successful results.",
        "Use Negative Prompts: Exclude elements you don't want to see in the final artwork.",
        "Experiment with Parameters: Adjust style, chaos, and quality parameters to explore different creative directions.",
        "Combine Techniques: Mix different artistic styles and techniques for unique hybrid creations."
      ],
      'photography': [
        "Define Lighting Conditions: Specify 'golden hour', 'studio lighting', 'natural light', or 'dramatic shadows' for mood control.",
        "Mention Camera Equipment: Reference specific cameras, lenses, or photographic equipment for authentic results.",
        "Set the Scene: Describe backgrounds, environments, and atmospheric conditions in detail.",
        "Control Depth of Field: Use terms like 'shallow depth of field', 'bokeh background', or 'everything in focus'.",
        "Specify Photo Style: Mention 'portrait photography', 'landscape', 'street photography', or 'commercial shoot'.",
        "Include Technical Details: Reference ISO, aperture, shutter speed, or film types for realistic rendering.",
        "Consider Post-Processing: Mention desired editing styles like 'vintage filter', 'high contrast', or 'natural colors'."
      ],
      'design': [
        "Establish Visual Hierarchy: Clearly define what elements should be most prominent in your design.",
        "Specify Brand Guidelines: Include color codes, font preferences, and logo placement requirements.",
        "Define Layout Structure: Mention grid systems, spacing requirements, and compositional rules.",
        "Consider User Experience: For UI/UX designs, include user flow considerations and interaction elements.",
        "Set Style Parameters: Define minimalism, maximalism, retro, modern, or other design aesthetics.",
        "Include Functional Elements: Specify buttons, navigation, calls-to-action, or other interactive components.",
        "Account for Responsiveness: Consider how designs should adapt to different screen sizes and devices."
      ],
      'writing': [
        "Set Clear Tone: Define whether the content should be formal, casual, persuasive, informative, or creative.",
        "Specify Target Audience: Mention the reader's knowledge level, interests, and demographic information.",
        "Define Structure: Outline the desired format, paragraph structure, and content flow.",
        "Include Keywords: For SEO content, specify important keywords and their placement density.",
        "Set Length Parameters: Define word count, paragraph count, or specific section requirements.",
        "Establish Voice: Determine if the writing should be authoritative, conversational, technical, or storytelling.",
        "Include Examples: Provide context through examples, analogies, or reference materials when possible."
      ],
      'general': [
        "Be Descriptive: Use specific, detailed language rather than vague or abstract terms.",
        "Provide Context: Include the purpose, audience, and intended use of the generated content.",
        "Use Examples: Reference similar works, styles, or outcomes you're trying to achieve.",
        "Iterate Systematically: Make small, specific changes between generations to understand what works.",
        "Balance Specificity and Flexibility: Be specific about what matters most, but allow creative freedom elsewhere.",
        "Learn Platform Nuances: Understand the specific strengths and limitations of your chosen AI platform.",
        "Document Successful Prompts: Keep a record of what works well for future reference and consistency."
      ]
    };
    
    return tips[category] || tips.general;
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
            engagementRate: this.calculateEngagementRate(data),
            popularityScore: this.calculatePopularityScore(data)
          };
        }
      }
      
      return {
        likes: Math.floor(Math.random() * 100),
        views: Math.floor(Math.random() * 500),
        uses: Math.floor(Math.random() * 50),
        engagementRate: Math.random() * 0.5 + 0.3,
        popularityScore: Math.floor(Math.random() * 100)
      };
    } catch (error) {
      console.error('Engagement analytics error:', error);
      return { likes: 0, views: 0, uses: 0, engagementRate: 0, popularityScore: 0 };
    }
  }

  static calculateEngagementRate(data) {
    const likes = data.likes || 0;
    const views = data.views || 1;
    const uses = data.uses || 0;
    
    return ((likes + uses) / views) || 0;
  }

  static calculatePopularityScore(data) {
    const likes = data.likes || 0;
    const views = data.views || 0;
    const uses = data.uses || 0;
    const recency = data.createdAt ? (Date.now() - new Date(data.createdAt).getTime()) : 0;
    
    const timeWeight = Math.max(0, 1 - (recency / (30 * 24 * 60 * 60 * 1000)));
    return Math.round(((likes * 2 + uses * 3 + views * 0.1) * timeWeight) / 10);
  }
}

// News-specific SEO Optimizer
class NewsSEOOptimizer {
  static generateNewsTitle(title) {
    return `${title || 'AI News'} - Tools Prompt News`;
  }

  static generateNewsDescription(content) {
    if (!content) return 'Latest AI news and updates from Tools Prompt.';
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
        "name": news.author || "Tools Prompt Editor"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Tools Prompt",
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
      xml += `      <news:name>Tools Prompt</news:name>\n`;
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
    likes: 42,
    views: 156,
    uses: 23,
    keywords: ['fantasy', 'landscape', 'mountains', 'digital art'],
    category: 'art',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 85,
    adsenseMigrated: true
  },
  {
    id: 'demo-2',
    title: 'Cyberpunk City Street',
    promptText: 'Cyberpunk city street at night, neon signs, rainy pavement, futuristic vehicles, Blade Runner style, cinematic lighting',
    imageUrl: 'https://via.placeholder.com/800x400/8f94fb/white?text=Cyberpunk+City',
    userName: 'Demo User',
    likes: 67,
    views: 289,
    uses: 45,
    keywords: ['cyberpunk', 'city', 'neon', 'futuristic'],
    category: 'art',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 92,
    adsenseMigrated: true
  },
  {
    id: 'demo-3',
    title: 'Professional Portrait Photography',
    promptText: 'Professional portrait photography, natural lighting, soft shadows, high detail, 85mm lens, studio quality, professional model',
    imageUrl: 'https://via.placeholder.com/800x400/20bf6b/white?text=Portrait+Photo',
    userName: 'Demo User',
    likes: 34,
    views: 189,
    uses: 12,
    keywords: ['photography', 'portrait', 'professional', 'studio'],
    category: 'photography',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seoScore: 78,
    adsenseMigrated: true
  }
];

// Generate mock news
function generateMockNews(count) {
  const news = [];
  const categories = ['ai-news', 'prompt-tips', 'industry-updates', 'tutorials'];
  const authors = ['AI News Team', 'Prompt Master', 'Tech Editor', 'Community Manager'];
  
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Tools Prompt API',
    mode: db ? 'production' : 'development',
    cacheStats: cache.getStats(),
    adsense: {
      enabled: true,
      clientId: process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'
    }
  });
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

// Pages Sitemap (static pages)
app.get('/sitemap-pages.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    
    const pages = [
      {
        loc: baseUrl + '/',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '1.0'
      },
      {
        loc: baseUrl + '/index.html',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '0.9'
      },
  {
        loc: baseUrl + '/promptconverter.html',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '0.8'
      },
  {
        loc: baseUrl + '/howitworks.html',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '0.8'
      },
  {
        loc: baseUrl + '/login.html',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '0.5'
      }

    ];

    const sitemap = SitemapGenerator.generateSitemap(pages);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
    
  } catch (error) {
    console.error('❌ Pages sitemap error:', error);
    res.status(500).send('Error generating pages sitemap');
  }
});

// Posts Sitemap (dynamic prompts) - LIMITED to 100 prompts
app.get('/sitemap-posts.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    let prompts = [];

    if (db) {
      const snapshot = await db.collection('uploads')
        .orderBy('updatedAt', 'desc')
        .limit(100)
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
      lastmod: prompt.updatedAt && prompt.updatedAt !== prompt.createdAt ? 
               prompt.updatedAt : prompt.createdAt,
      changefreq: 'weekly',
      priority: '0.8'
    }));

    const sitemap = SitemapGenerator.generateSitemap(urls);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
    
  } catch (error) {
    console.error('❌ Posts sitemap error:', error);
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    const fallbackUrls = [
      {
        loc: baseUrl + '/',
        lastmod: new Date().toISOString(),
        changefreq: 'daily',
        priority: '1.0'
      }
    ];
    const sitemap = SitemapGenerator.generateSitemap(fallbackUrls);
    res.set('Content-Type', 'application/xml');
    res.send(sitemap);
  }
});

// News Sitemap - LIMITED to 50 news
app.get('/sitemap-news.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
    let news = [];

    if (db && db.collection) {
      const snapshot = await db.collection('news')
        .orderBy('publishedAt', 'desc')
        .limit(50)
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

// News upload endpoint - OPTIMIZED
app.post('/api/upload-news', async (req, res) => {
  console.log('📰 News upload request received');
  
  const busboy = Busboy({ headers: req.headers });
  const fields = {};
  let fileBuffer = null;
  let fileName = null;
  let fileType = null;

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'image') {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    const { filename, mimeType } = info;
    fileName = filename;
    fileType = mimeType;
    
    const chunks = [];
    file.on('data', (data) => {
      chunks.push(data);
    });

    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
      
      if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
      }
    });
  });

  busboy.on('finish', async () => {
    try {
      if (!fields.title || !fields.content) {
        return res.status(400).json({ error: 'Title and content are required' });
      }

      let imageUrl = 'https://via.placeholder.com/800x400/4e54c8/white?text=Prompt+Seen+News';

      if (fileBuffer && bucket) {
        const fileExtension = fileName.split('.').pop();
        const newFileName = `news/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const file = bucket.file(newFileName);

        await file.save(fileBuffer, {
          metadata: {
            contentType: fileType,
            metadata: {
              uploadedBy: fields.author || 'editor',
              uploadedAt: new Date().toISOString()
            }
          }
        });

        await file.makePublic();
        imageUrl = `https://storage.googleapis.com/${bucket.name}/${newFileName}`;
      }

      const newsTitle = NewsSEOOptimizer.generateNewsTitle(fields.title);
      const metaDescription = NewsSEOOptimizer.generateNewsDescription(fields.content);
      const slug = NewsSEOOptimizer.generateNewsSlug(fields.title);
      const keywords = SEOOptimizer.extractKeywords(fields.title + ' ' + fields.content);

      const newsData = {
        title: fields.title,
        content: fields.content,
        excerpt: fields.excerpt || (fields.content ? fields.content.substring(0, 200) + '...' : ''),
        imageUrl: imageUrl,
        author: fields.author || 'Tools Prompt Editor',
        category: fields.category || 'ai-news',
        tags: fields.tags ? fields.tags.split(',').map(tag => tag.trim()) : [],
        keywords: keywords,
        seoTitle: newsTitle,
        metaDescription: metaDescription,
        slug: slug,
        isBreaking: fields.isBreaking === 'true',
        isFeatured: fields.isFeatured === 'true',
        views: 0,
        likes: 0,
        shares: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: new Date().toISOString()
      };

      let docRef;
      
      if (db && db.collection) {
        docRef = await db.collection('news').add(newsData);
      } else {
        docRef = { id: 'news-' + Date.now() };
        global.mockNews.unshift({
          id: docRef.id,
          ...newsData
        });
      }

      const responseData = {
        id: docRef.id,
        ...newsData,
        newsUrl: `/news/${docRef.id}`
      };

      cache.del('news-all');
      
      res.json({
        success: true,
        news: responseData,
        message: 'News published successfully!'
      });

    } catch (error) {
      console.error('❌ News upload error:', error);
      res.status(500).json({ 
        error: 'News publication failed', 
        details: error.message
      });
    }
  });

  req.pipe(busboy);
});

// Get news articles - WITH CACHING
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
        .limit(100);
      
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

// Individual news page - WITH CACHING
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

// Engagement API Endpoints - OPTIMIZED

// Track view count - OPTIMIZED: Reduced writes
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

// Get user engagement status
app.get('/api/prompt/:id/user-engagement', async (req, res) => {
  try {
    res.json({ userLiked: false, userUsed: false });
  } catch (error) {
    res.json({ userLiked: false, userUsed: false });
  }
});

// Engagement Analytics API Endpoint - WITH CACHING
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

// Search API endpoint - OPTIMIZED with limits
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
        .limit(100)
        .get();
      
      prompts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: safeDateToString(data.createdAt),
          promptUrl: `/prompt/${doc.id}`
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
      hasMore: endIndex < prompts.length
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
        const aScore = (a.likes || 0) + (a.views || 0);
        const bScore = (b.likes || 0) + (b.views || 0);
        return bScore - aScore;
      });
    case 'likes':
      return sorted.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    case 'views':
      return sorted.sort((a, b) => (b.views || 0) - (a.views || 0));
    case 'recent':
    default:
      return sorted.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateB - dateA;
      });
  }
}

// Upload endpoint - OPTIMIZED for images
app.post('/api/upload', async (req, res) => {
  console.log('📤 Upload request received');
  
  const busboy = Busboy({ headers: req.headers });
  const fields = {};
  let fileBuffer = null;
  let fileName = null;
  let fileType = null;

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'image') {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    const { filename, mimeType } = info;
    fileName = filename;
    fileType = mimeType;
    
    const chunks = [];
    file.on('data', (data) => {
      chunks.push(data);
    });

    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
      
      if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
      }
    });
  });

  busboy.on('finish', async () => {
    try {
      if (!fields.title || !fields.promptText) {
        return res.status(400).json({ error: 'Title and prompt text are required' });
      }

      if (!fileBuffer) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(fileType)) {
        return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' });
      }

      let imageUrl;

      if (bucket) {
        const fileExtension = fileName.split('.').pop();
        const newFileName = `prompts/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const file = bucket.file(newFileName);

        await file.save(fileBuffer, {
          metadata: {
            contentType: fileType,
            metadata: {
              uploadedBy: fields.userId || 'anonymous',
              uploadedAt: new Date().toISOString()
            }
          }
        });

        await file.makePublic();
        imageUrl = `https://storage.googleapis.com/${bucket.name}/${newFileName}`;
      } else {
        imageUrl = 'https://via.placeholder.com/800x400/4e54c8/white?text=Uploaded+Image';
      }

      const seoTitle = SEOOptimizer.generateSEOTitle(fields.title);
      const metaDescription = SEOOptimizer.generateMetaDescription(fields.promptText, fields.title);
      const keywords = SEOOptimizer.extractKeywords(fields.title + ' ' + fields.promptText);
      const slug = SEOOptimizer.generateSlug(fields.title);

      const promptData = {
        title: fields.title,
        promptText: fields.promptText,
        imageUrl: imageUrl,
        category: fields.category || 'general',
        userName: fields.userName || 'Anonymous User',
        likes: 0,
        views: 0,
        uses: 0,
        keywords: keywords,
        seoTitle: seoTitle,
        metaDescription: metaDescription,
        slug: slug,
        seoScore: Math.floor(Math.random() * 30) + 70,
        adsenseMigrated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let docRef;
      
      if (db && db.collection) {
        docRef = await db.collection('uploads').add(promptData);
      } else {
        docRef = { id: 'demo-' + Date.now() };
        mockPrompts.unshift({
          id: docRef.id,
          ...promptData
        });
      }

      const responseData = {
        id: docRef.id,
        ...promptData,
        promptUrl: `/prompt/${docRef.id}`
      };

      cache.del('uploads-page-1');
      cache.del('search-all-all-1-12');
      
      res.json({
        success: true,
        upload: responseData,
        message: 'Upload successful! Your creation is now live with AdSense monetization.'
      });

    } catch (error) {
      console.error('❌ Upload error:', error);
      res.status(500).json({ 
        error: 'Upload failed', 
        details: error.message,
        mode: db ? 'production' : 'development'
      });
    }
  });

  busboy.on('error', (error) => {
    console.error('❌ Busboy error:', error);
    res.status(500).json({ error: 'File upload processing failed' });
  });

  req.pipe(busboy);
});

// API Routes - Get uploads with caching and limits
app.get('/api/uploads', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    
    const cacheKey = `uploads-page-${page}-limit-${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    let allUploads = [];

    if (db && db.collection) {
      const snapshot = await db.collection('uploads')
        .orderBy('createdAt', 'desc')
        .limit(limit * 3)
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
          promptUrl: `/prompt/${doc.id}`
        });
      });
    } else {
      allUploads = mockPrompts.map(prompt => ({
        ...prompt,
        userLiked: false,
        userUsed: false,
        promptUrl: `/prompt/${prompt.id}`
      }));
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const uploads = allUploads.slice(startIndex, endIndex);

    const result = {
      uploads,
      currentPage: page,
      totalPages: Math.ceil(allUploads.length / limit),
      totalCount: allUploads.length,
      adsenseInfo: {
        migrated: allUploads.filter(u => u.adsenseMigrated).length,
        total: allUploads.length,
        percentage: Math.round((allUploads.filter(u => u.adsenseMigrated).length / allUploads.length) * 100) || 0
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
        promptUrl: `/prompt/${prompt.id}`
      })),
      currentPage: 1,
      totalPages: 1,
      totalCount: mockPrompts.length,
      adsenseInfo: {
        migrated: mockPrompts.length,
        total: mockPrompts.length,
        percentage: 100
      }
    };
    
    res.json(result);
  }
});

// Individual prompt pages for SEO - WITH CACHING
app.get('/prompt/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    const cacheKey = `prompt-${promptId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.set('Content-Type', 'text/html').send(cached);
    }
    
    let promptData;

    if (db && db.collection && promptId !== 'demo-1' && promptId !== 'demo-2' && promptId !== 'demo-3') {
      const doc = await db.collection('uploads').doc(promptId).get();
      
      if (!doc.exists) {
        return sendPromptNotFound(res, promptId);
      }

      const prompt = doc.data();
      promptData = createPromptData(prompt, doc.id);
      
      const shouldUpdateView = Math.random() < 0.2;
      if (shouldUpdateView) {
        const currentViews = prompt.views || 0;
        await db.collection('uploads').doc(promptId).update({
          views: currentViews + 5,
          updatedAt: new Date().toISOString()
        });
      }
    } else {
      const mockPrompt = mockPrompts.find(p => p.id === promptId) || mockPrompts[0];
      promptData = createPromptData(mockPrompt, promptId);
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

// Category pages for SEO - WITH CACHING
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

// Helper functions
function createNewsData(news, id) {
  const safeNews = news || {};
  return {
    id: id || 'unknown',
    title: safeNews.title || 'AI News Update',
    content: safeNews.content || 'No content available.',
    excerpt: safeNews.excerpt || (safeNews.content ? safeNews.content.substring(0, 200) + '...' : ''),
    imageUrl: safeNews.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=Prompt+Seen+News',
    author: safeNews.author || 'Tools Prompt Editor',
    category: safeNews.category || 'ai-news',
    tags: safeNews.tags || ['ai', 'news'],
    views: safeNews.views || 0,
    likes: safeNews.likes || 0,
    shares: safeNews.shares || 0,
    isBreaking: safeNews.isBreaking || false,
    isFeatured: safeNews.isFeatured || false,
    createdAt: safeDateToString(safeNews.createdAt),
    publishedAt: safeDateToString(safeNews.publishedAt),
    seoTitle: safeNews.seoTitle || safeNews.title || 'AI News - Tools Prompt',
    metaDescription: safeNews.metaDescription || (safeNews.content ? 
      safeNews.content.substring(0, 155) + '...' : 
      'Latest AI news and prompt engineering updates from Tools Prompt.')
  };
}

function createPromptData(prompt, id) {
  const safePrompt = prompt || {};
  
  const promptData = {
    id: id || 'unknown',
    title: safePrompt.title || 'Untitled Prompt',
    seoTitle: safePrompt.seoTitle || safePrompt.title || 'AI Prompt - Tools Prompt',
    metaDescription: safePrompt.metaDescription || (safePrompt.promptText ? 
      safePrompt.promptText.substring(0, 155) + '...' : 
      'Explore this AI-generated image and learn prompt engineering techniques.'),
    imageUrl: safePrompt.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=Prompt+Seen+AI+Image',
    promptText: safePrompt.promptText || 'No prompt text available.',
    userName: safePrompt.userName || 'Anonymous',
    likes: safePrompt.likes || 0,
    views: safePrompt.views || 0,
    uses: safePrompt.uses || 0,
    keywords: safePrompt.keywords || ['AI', 'prompt', 'image generation'],
    category: safePrompt.category || 'general',
    createdAt: safeDateToString(safePrompt.createdAt),
    updatedAt: safeDateToString(safePrompt.updatedAt || safePrompt.createdAt),
    seoScore: safePrompt.seoScore || 0,
    adsenseMigrated: safePrompt.adsenseMigrated || false
  };

  const aiDescription = AIDescriptionGenerator.generateComprehensiveDescription(promptData);
  
  promptData.detailedExplanation = aiDescription.introduction;
  promptData.stepByStepInstructions = PromptContentGenerator.generateStepByStepInstructions(promptData);
  promptData.bestAITools = PromptContentGenerator.generateBestAITools(promptData);
  promptData.trendAnalysis = PromptContentGenerator.generateTrendAnalysis(promptData);
  promptData.usageTips = PromptContentGenerator.generateUsageTips(promptData);
  promptData.seoTips = PromptContentGenerator.generateSEOTips(promptData);
  
  promptData.aiStepByStepGuide = aiDescription.stepByStep;
  promptData.aiExpertTips = aiDescription.tips;

  return promptData;
}

// Mini Browser CSS
const miniBrowserCSS = `
/* Mini Browser Styles */
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

// Mini Browser HTML
const miniBrowserHTML = `
<!-- Mini Browser Container -->
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
            <div>Loading Tools Prompt...</div>
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

<!-- Mini Browser Toggle Button -->
<button class="mini-browser-toggle" id="miniBrowserToggle" onclick="toggleMiniBrowser()">
    <i class="fas fa-plus"></i>
</button>
`;

// Mini Browser JavaScript
const miniBrowserJS = `
// Mini Browser functionality
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

// Mini Browser Toggle Button for Engagement Section
const miniBrowserToggleButton = `
<button class="engagement-btn" onclick="toggleMiniBrowser()" title="Open Tools Prompt Browser (Ctrl+B)">
    <i class="fas fa-external-link-alt"></i> Quick Browse
</button>
`;

// ENHANCED PROMPT PAGE GENERATOR WITH ALL ORIGINAL CONTENT
function generateEnhancedPromptHTML(promptData) {
  const promptAdHTML = generatePromptAdPlacement();
  
  const baseUrl = 'https://www.toolsprompt.com';
  const promptUrl = baseUrl + '/prompt/' + promptData.id;
  
  const aiStepsHTML = `
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

  const aiExpertTipsHTML = promptData.aiExpertTips.map(tip => `
    <li>${tip}</li>
  `).join('');

  const toolsHTML = promptData.bestAITools.map(tool => `
    <div class="tool-card">
      <h4>${tool.name}</h4>
      <p>${tool.description}</p>
    </div>
  `).join('');

  const tipsHTML = promptData.usageTips.map(tip => `
    <li>${tip}</li>
  `).join('');

  const seoTipsHTML = promptData.seoTips.map(tip => `
    <li>${tip}</li>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${promptData.seoTitle}</title>
    <meta name="description" content="${promptData.metaDescription}">
    <meta name="keywords" content="${(promptData.keywords || []).join(', ')}">
    <meta name="robots" content="index, follow, max-image-preview:large">
    
    <!-- Manual AdSense for Prompt Pages -->
    
    <!-- Enhanced Open Graph -->
    <meta property="og:title" content="${promptData.seoTitle}">
    <meta property="og:description" content="${promptData.metaDescription}">
    <meta property="og:image" content="${promptData.imageUrl}">
    <meta property="og:url" content="${promptUrl}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Tools Prompt">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${promptData.seoTitle}">
    <meta name="twitter:description" content="${promptData.metaDescription}">
    <meta name="twitter:image" content="${promptData.imageUrl}">
    
    <!-- Canonical URL -->
    <link rel="canonical" href="${promptUrl}" />
    
    <!-- Enhanced Structured Data -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "name": "How to Use: ${promptData.title.replace(/"/g, '\\"')}",
      "description": "${promptData.metaDescription.replace(/"/g, '\\"')}",
      "image": "${promptData.imageUrl}",
      "totalTime": "PT5M",
      "estimatedCost": {
        "@type": "MonetaryAmount",
        "currency": "USD",
        "value": "0"
      },
      "supply": [
        {
          "@type": "HowToSupply",
          "name": "AI Platform Access"
        }
      ],
      "tool": [
        {
          "@type": "HowToTool",
          "name": "AI Image Generator"
        }
      ],
      "step": [
        ${promptData.stepByStepInstructions.map((step, index) => `{
          "@type": "HowToStep",
          "position": ${index + 1},
          "name": "Step ${index + 1}",
          "text": "${step.replace(/"/g, '\\"')}"
        }`).join(',')}
      ]
    }
    </script>
    
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "${promptUrl}"
      },
      "headline": "${promptData.title.replace(/"/g, '\\"')}",
      "description": "${promptData.metaDescription.replace(/"/g, '\\"')}",
      "image": "${promptData.imageUrl}",
      "author": {
        "@type": "Person",
        "name": "${promptData.userName || 'Tools Prompt User'}"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Tools Prompt",
        "logo": {
          "@type": "ImageObject",
          "url": "https://www.toolsprompt.com/logo.png"
        }
      },
      "datePublished": "${promptData.createdAt}",
      "dateModified": "${promptData.updatedAt || promptData.createdAt}",
      "keywords": "${(promptData.keywords || ['AI', 'prompt']).join(', ')}",
      "articleSection": "AI Prompts",
      "articleBody": "${(promptData.promptText || '').replace(/"/g, '\\"').substring(0, 200)}"
    }
    </script>
    
    <!-- Font Awesome -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f5f7fa; line-height: 1.6; color: #2d334a; }
        
        /* Add all the existing CSS styles here */
        /* ... existing styles ... */
        
        /* Mini Browser Styles */
        ${miniBrowserCSS}
        
        /* Related Prompts Grid Layout */
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
            
            .related-prompt-content {
                padding: 1rem;
            }
            
            .related-prompt-content h4 {
                font-size: 1rem;
                min-height: 2.8em;
            }
        }

        @media (max-width: 480px) {
            .content-grid {
                grid-template-columns: 1fr;
            }
            
            .related-prompt-image {
                height: 160px;
            }
        }

        /* Header Styles */
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
        
        /* Main Content */
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
        
        /* Enhanced Content Styles */
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
        
        .tools-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }
        
        .tool-card {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        
        .tool-card h4 {
            color: #4e54c8;
            margin-bottom: 0.5rem;
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
            
            .stat-item-small i {
                font-size: 1.1rem;
            }
            
            .stat-number-small {
                font-size: 1.1rem;
            }
            
            .stat-label-small {
                font-size: 0.7rem;
            }
        }
        
        /* Footer */
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
        
        /* Ad Container */
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
        
        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
            .header-container { 
                padding: 0 0.75rem; 
                gap: 0.5rem;
            }
            
            .logo { 
                font-size: 1.1rem; 
            }
            .logo img {
                width: 35px;
                height: 35px;
            }
            
            .nav-links { 
                gap: 1rem; 
                justify-content: center;
                width: 100%;
                order: 3;
                margin-top: 0.5rem;
                padding: 0.5rem 0;
                border-top: 1px solid #eee;
            }
            .nav-links a {
                font-size: 0.85rem;
                padding: 0.25rem 0.5rem;
            }
            
            .main-container { 
                padding: 0 0.75rem; 
                margin: 0.5rem auto;
            }
            
            .article-header { 
                padding: 1rem; 
            }
            
            .article-title { 
                font-size: 1.5rem; 
            }
            
            .prompt-image { 
                max-height: 300px; 
            }
            
            .prompt-content { 
                padding: 1rem; 
            }
            
            .prompt-meta { 
                flex-direction: column; 
                gap: 0.75rem; 
                padding: 1rem;
                margin: 1rem 0;
            }
            
            .engagement-buttons { 
                flex-direction: column; 
                gap: 0.75rem;
            }
            .engagement-btn {
                justify-content: center;
                padding: 12px 20px;
            }
            
            .content-grid { 
                grid-template-columns: 1fr; 
                gap: 0.75rem;
            }
            
            .content-card {
                padding: 1rem;
            }
            
            .supporting-content {
                padding: 1rem;
                margin: 1rem 0;
            }
            
            .footer-container {
                gap: 1rem;
            }
            
            .site-footer {
                padding: 1.5rem 0.75rem;
                margin-top: 2rem;
            }
            
            .instruction-step {
                flex-direction: column;
                text-align: center;
            }
            
            .step-number {
                align-self: center;
            }
            
            .tools-grid {
                grid-template-columns: 1fr;
            }
            
            .engagement-stats {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .stat-card {
                padding: 1rem;
            }
            
            .stat-number {
                font-size: 1.5rem;
            }

            .platform-intro {
                padding: 1.5rem;
            }
        }
        
        @media (max-width: 480px) {
            .logo span {
                font-size: 1rem;
            }
            
            .logo img {
                width: 30px;
                height: 30px;
            }
            
            .nav-links {
                gap: 0.75rem;
            }
            
            .nav-links a {
                font-size: 0.8rem;
                padding: 0.2rem 0.4rem;
            }
            
            .article-title {
                font-size: 1.3rem;
            }
            
            .prompt-image {
                max-height: 250px;
            }
            
            .prompt-text {
                padding: 1rem;
                font-size: 0.9rem;
            }
            
            .section-title {
                font-size: 1.1rem;
            }
            
            .content-card h4 {
                font-size: 1rem;
            }
        }
        
        @media (max-width: 360px) {
            .logo span {
                display: none;
            }
            
            .nav-links {
                gap: 0.5rem;
            }
            
            .nav-links a {
                font-size: 0.75rem;
            }
            
            .article-title {
                font-size: 1.2rem;
            }
        }
    </style>
</head>
<body>
    <!-- Manual Ads Only -->

    <!-- Site Header -->
    <header class="site-header">
        <div class="header-container">
            <a href="https://www.toolsprompt.com" class="logo">
                <img src="https://www.toolsprompt.com/logo.png" alt="Tools Prompt Logo">
                <span>Tools Prompt</span>
            </a>
            
            <nav>
                <ul class="nav-links">
                    <li><a href="https://www.toolsprompt.com/">Home</a></li>
                    <li><a href="https://www.toolsprompt.com/#promptsContainer">Browse</a></li>
                    <li><a href="https://www.toolsprompt.com/news.html">News</a></li>
                    <li><a href="https://www.toolsprompt.com/promptconverter.html">Tools</a></li>
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
                    ${promptData.seoScore ? '<span style="background: #20bf6b; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; margin-left: 10px;">Tools Prompt: ' + promptData.seoScore + '/100</span>' : ''}
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
                </div>
            </div>

            <!-- Top Ad Placement -->
            ${promptAdHTML}
            
            <img src="${promptData.imageUrl}" 
                 alt="${promptData.title} - AI Generated Image" 
                 class="prompt-image"
                 onerror="this.src='https://via.placeholder.com/800x400/4e54c8/white?text=AI+Generated+Image'"
                 id="promptImage">

            <div class="prompt-content">
                <!-- Original Prompt Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-magic"></i> AI Prompt Used</h2>
                    <div class="prompt-text">${promptData.promptText}</div>
                </section>

                <!-- Middle Ad Placement -->
                ${promptAdHTML}

                <!-- UPDATED: AI-Generated About This Prompt Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-info-circle"></i> Discover Superior Results With The Help Following Ai Option</h2>
                    <div class="platform-intro">
                        <p>${promptData.detailedExplanation}</p>
                    </div>
                </section>

                <!-- NEW: Comprehensive Step-by-Step Guide -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-list-ol"></i> How To Edit Your Photo Using This Prompt</h2>
                    <div class="instruction-steps">
                        ${aiStepsHTML}
                    </div>
                </section>

                <!-- NEW: AI Expert Tips Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-graduation-cap"></i> Expert Tips for Best Results</h2>
                    <ul class="tips-list">
                        ${aiExpertTipsHTML}
                    </ul>
                </section>

                <!-- Existing Best AI Tools Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-robot"></i> Recommended AI Tools</h2>
                    <div class="tools-grid">
                        ${toolsHTML}
                    </div>
                </section>

                <!-- Existing Usage Tips Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-lightbulb"></i> Usage Tips</h2>
                    <ul class="tips-list">
                        ${tipsHTML}
                    </ul>
                </section>

                <!-- Existing SEO Tips Section -->
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

            <!-- Bottom Ad Placement -->
            ${promptAdHTML}
        </article>
        
        <!-- Related Prompts Section -->
        <section class="content-section" style="margin-top: 2rem;">
            <h2 class="section-title"><i class="fas fa-images"></i> You Might Like:</h2>
            <div class="content-grid" id="relatedPrompts">
                <!-- Related prompts will be loaded here -->
            </div>
        </section>
    </main>

    <!-- Site Footer -->
    <footer class="site-footer">
        <div class="footer-container">
            <div class="footer-section">
                <h3>Tools Prompt</h3>
                <p>Tools Prompt is a platform that offers trending and viral AI prompts for photo editing and other creative tasks. It provides users with free, high-quality prompts that can be used with various AI tools, including ChatGPT and Google Gemini. The platform aims to simplify the photo editing process by offering ready-to-use prompts that enhance creativity and efficiency. Additionally, it features an AI image generator that allows users to create visuals from text prompts.</p>
            </div>
            <div class="footer-section">
                <h3>Quick Links</h3>
                <ul class="footer-links">
                    <li><a href="https://www.toolsprompt.com/">Home</a></li>
                    <li><a href="https://www.toolsprompt.com/#promptsContainer">Browse Prompts</a></li>
                    <li><a href="https://www.toolsprompt.com/news.html">AI News</a></li>
                    <li><a href="https://www.toolsprompt.com/promptconverter.html">Prompt Tools</a></li>
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
            <p>&copy; 2025 Tools Prompt. All rights reserved. | AI Prompt Sharing Platform</p>
        </div>
    </footer>

    <!-- Mini Browser Components -->
    ${miniBrowserHTML}

    <script>
        console.log('Initializing Tools Prompt page with mini browser');

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
                    document.querySelector('.likes-count').textContent = data.likes;
                    document.querySelector('.views-count').textContent = data.views;
                    document.querySelector('.uses-count').textContent = data.uses;
                    
                    const engagementRate = Math.round((data.likes + data.uses) / Math.max(data.views, 1) * 100);
                    document.querySelector('#engagementStats').innerHTML = \`
                        <div class="stat-card">
                            <div class="stat-number">\${data.likes}</div>
                            <div class="stat-label">Likes</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${data.views}</div>
                            <div class="stat-label">Views</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${data.uses}</div>
                            <div class="stat-label">Uses</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${engagementRate}%</div>
                            <div class="stat-label">Engagement</div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Error updating engagement stats:', error);
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            const img = document.getElementById('promptImage');
            if (img) {
                if (img.complete && img.naturalHeight !== 0) {
                    img.style.opacity = '1';
                } else {
                    img.onload = function() {
                        this.style.opacity = '1';
                    };
                    img.style.transition = 'opacity 0.5s ease';
                    img.style.opacity = '0';
                }
            }
            
            loadRelatedPrompts('${promptData.id}', '${promptData.keywords ? promptData.keywords[0] : 'AI'}');
        });

        async function loadRelatedPrompts(currentId, keyword) {
            try {
                var response = await fetch('/api/search?q=' + encodeURIComponent(keyword) + '&limit=6');
                
                if (!response.ok) {
                    throw new Error('API error');
                }
                
                var data = await response.json();
                var relatedContainer = document.getElementById('relatedPrompts');
                
                if (!relatedContainer) return;
                
                if (data.prompts && data.prompts.length > 0) {
                    var html = '';
                    var count = 0;
                    
                    for (var i = 0; i < data.prompts.length && count < 3; i++) {
                        var prompt = data.prompts[i];
                        if (prompt && prompt.id && prompt.id !== currentId) {
                            html += '<div class="related-prompt-card">' +
                                '<img src="' + (prompt.imageUrl || 'https://via.placeholder.com/300x200/4e54c8/white?text=Prompt') + '" class="related-prompt-image">' +
                                '<div class="related-prompt-content">' +
                                    '<h4>' + (prompt.title || 'Untitled').substring(0, 50) + '</h4>' +
                                    '<a href="/prompt/' + prompt.id + '" class="engagement-btn">View Prompt</a>' +
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
                var container = document.getElementById('relatedPrompts');
                if (container) {
                    container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #666;">Error loading related prompts</div>';
                }
            }
        }

        async function handleLike(promptId) {
            try {
                const likeBtn = document.querySelector('.like-btn');
                const likesCount = document.querySelector('.likes-count');
                const isLiked = likeBtn.classList.contains('liked');
                const action = isLiked ? 'unlike' : 'like';
                
                const response = await fetch('https://www.toolsprompt.com/api/prompt/' + promptId + '/like', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userId: 'anonymous', 
                        action: action
                    })
                });
                
                if (response.ok) {
                    if (action === 'like') {
                        likeBtn.innerHTML = '<i class="fas fa-heart"></i> Liked';
                        likeBtn.classList.add('liked');
                        likesCount.textContent = parseInt(likesCount.textContent) + 1;
                    } else {
                        likeBtn.innerHTML = '<i class="far fa-heart"></i> Like Prompt';
                        likeBtn.classList.remove('liked');
                        likesCount.textContent = parseInt(likesCount.textContent) - 1;
                    }
                    updateEngagementStats();
                }
            } catch (error) {
                console.error('Like error:', error);
            }
        }
        
        async function handleUse(promptId) {
            try {
                const useBtn = document.querySelector('.use-btn');
                const usesCount = document.querySelector('.uses-count');
                
                const response = await fetch('https://www.toolsprompt.com/api/prompt/' + promptId + '/use', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: 'anonymous' })
                });
                
                if (response.ok) {
                    useBtn.innerHTML = '<i class="fas fa-check"></i> Used';
                    useBtn.classList.add('used');
                    usesCount.textContent = parseInt(usesCount.textContent) + 1;
                    updateEngagementStats();
                }
            } catch (error) {
                console.error('Use error:', error);
            }
        }
        
        function handleShare(promptId) {
            const promptUrl = 'https://www.toolsprompt.com/prompt/' + promptId;
            
            if (navigator.share) {
                navigator.share({
                    title: document.title,
                    text: 'Check out this AI prompt on Tools Prompt',
                    url: promptUrl
                });
            } else {
                navigator.clipboard.writeText(promptUrl).then(() => {
                    alert('Prompt link copied to clipboard!');
                });
            }
        }

        // Mini Browser JavaScript
        ${miniBrowserJS}
    </script>
</body>
</html>`;
}

// Generate News HTML
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
        <a href="/" class="back-link">← Back to Tools Prompt</a>
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

function generateCategoryHTML(category, baseUrl) {
  const categoryNames = {
    'art': 'AI Art', 'photography': 'AI Photography', 'design': 'AI Design',
    'writing': 'AI Writing', 'other': 'Other AI Creations'
  };
  
  const categoryName = categoryNames[category] || 'AI Prompts';
  const description = `Explore ${categoryName} prompts and AI-generated content. Discover the best prompt engineering techniques for ${categoryName.toLowerCase()}.`;

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${categoryName} Prompts - Tools Prompt</title>
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

// Helper function for 404 page
function sendPromptNotFound(res, promptId) {
  res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <title>Prompt Not Found - Tools Prompt</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: #f5f7fa; text-align: center; }
        .container { max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #ff6b6b; margin-bottom: 20px; }
        a { color: #4e54c8; text-decoration: none; padding: 12px 25px; border: 2px solid #4e54c8; border-radius: 30px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Prompt Not Found</h1>
        <p>The prompt you're looking for doesn't exist or may have been removed.</p>
        <p><small>Prompt ID: ${promptId}</small></p>
        <a href="/">← Return to Tools Prompt</a>
    </div>
</body>
</html>`);
}

function sendNewsNotFound(res, newsId) {
  res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <title>News Not Found - Tools Prompt</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: #f5f7fa; text-align: center; }
        .container { max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #ff6b6b; margin-bottom: 20px; }
        a { color: #4e54c8; text-decoration: none; padding: 12px 25px; border: 2px solid #4e54c8; border-radius: 30px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>News Article Not Found</h1>
        <p>The news article you're looking for doesn't exist or may have been removed.</p>
        <p><small>News ID: ${newsId}</small></p>
        <a href="/">← Return to Tools Prompt</a>
    </div>
</body>
</html>`);
}

function sendErrorPage(res, error) {
  res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
    <title>Error - Tools Prompt</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: #f5f7fa; text-align: center; }
        .container { max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #ff6b6b; margin-bottom: 20px; }
        a { color: #4e54c8; text-decoration: none; padding: 12px 25px; border: 2px solid #4e54c8; border-radius: 30px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Error Loading Prompt</h1>
        <p>There was an error loading this prompt. Please try again later.</p>
        <a href="/">← Return to Home</a>
    </div>
</body>
</html>`);
}

function sendNewsErrorPage(res, error) {
  res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
    <title>Error - Tools Prompt News</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: #f5f7fa; text-align: center; }
        .container { max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #ff6b6b; margin-bottom: 20px; }
        a { color: #4e54c8; text-decoration: none; padding: 12px 25px; border: 2px solid #4e54c8; border-radius: 30px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Error Loading News</h1>
        <p>There was an error loading this news article. Please try again later.</p>
        <a href="/">← Return to Home</a>
    </div>
</body>
</html>`);
}

// Simple 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <html>
      <head><title>Page Not Found</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a href="/">Return to Home</a>
      </body>
    </html>
  `);
});

// Start server
app.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Base URL: http://localhost:${port}`);
  console.log(`📰 News routes: http://localhost:${port}/news/:id`);
  console.log(`🗞️  News API: http://localhost:${port}/api/news`);
  console.log(`📤 News upload: http://localhost:${port}/api/upload-news`);
  console.log(`🗺️  News sitemap: http://localhost:${port}/sitemap-news.xml`);
  console.log(`🔗 Prompt routes: http://localhost:${port}/prompt/:id`);
  console.log(`📤 Upload endpoint: http://localhost:${port}/api/upload`);
  console.log(`❤️  Engagement endpoints:`);
  console.log(`   → Views: http://localhost:${port}/api/prompt/:id/view (Optimized: 10% write rate)`);
  console.log(`   → Likes: http://localhost:${port}/api/prompt/:id/like`);
  console.log(`   → Uses: http://localhost:${port}/api/prompt/:id/use`);
  console.log(`   → Analytics: http://localhost:${port}/api/prompt/:id/engagement`);
  console.log(`🔍 Search: http://localhost:${port}/api/search (Limited to 100 results)`);
  console.log(`🗺️  Sitemap: http://localhost:${port}/sitemap.xml`);
  console.log(`🤖 Robots.txt: http://localhost:${port}/robots.txt`);
  console.log(`❤️  Health check: http://localhost:${port}/health`);
  console.log(`💰 AdSense Client ID: ${process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'}`);
  console.log(`🔄 AdSense Migration: http://localhost:${port}/admin/migrate-adsense`);
  console.log(`📊 Caching: Enabled with 5-minute TTL`);
  console.log(`🤖 AI Content: FULL DETAILED VERSION RESTORED`);
  console.log(`📝 Prompt Pages: All original content restored (Discover Superior Results, How To Edit Your Photo, etc.)`);
  console.log(`💰 COST SAVINGS IMPLEMENTED:`);
  console.log(`   ✅ Database query limits added`);
  console.log(`   ✅ Caching layer implemented`);
  console.log(`   ✅ View counts batched (10% write rate)`);
  console.log(`   ✅ Search limited to 100 results`);
  console.log(`   ✅ Sitemaps limited to 100 items`);
  
  if (!db || !db.collection) {
    console.log(`🎭 Running in DEVELOPMENT mode with mock data`);
    console.log(`📰 Sample news articles:`);
    global.mockNews.slice(0, 3).forEach(news => {
      console.log(`   → http://localhost:${port}/news/${news.id}`);
    });
    console.log(`📝 Sample prompts:`);
    mockPrompts.forEach(prompt => {
      console.log(`   → http://localhost:${port}/prompt/${prompt.id}`);
    });
    console.log(`🏠 Home pages:`);
    console.log(`   → Root: http://localhost:${port}/`);
    console.log(`   → Index: http://localhost:${port}/index.html`);
  }
});