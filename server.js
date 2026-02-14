﻿﻿const express = require('express');
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
    // Redirect /index.html to / (canonical URL)
    if (req.get('host').includes('toolsprompt.com') || process.env.NODE_ENV === 'production') {
        const baseUrl = process.env.BASE_URL || `https://${req.get('host').replace('index.html', '')}`;
        return res.redirect(301, baseUrl.replace('/index.html', '/'));
    }
    
    // Only serve index.html directly in development
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

// ENHANCED AI Description Generator with 20+ MODELS
class AIDescriptionGenerator {
  static generatePlatformIntroduction(promptData) {
    const platforms = {
      'midjourney': {
        name: 'Midjourney',
        year: '2025',
        description: 'remains the leading platform for artistic and creative AI image generation with unparalleled stylistic control.',
        strengths: ['artistic styles', 'creative compositions', 'stylistic consistency', 'community features']
      },
      'dalle': {
        name: 'DALL-E 3',
        year: '2025',
        description: 'excels at understanding complex prompts and generating detailed, coherent images with excellent text integration.',
        strengths: ['prompt comprehension', 'realistic rendering', 'complex scenes', 'text integration']
      },
      'gemini': {
        name: 'Google Gemini AI',
        year: '2025',
        description: 'offers powerful multimodal capabilities with excellent understanding of contextual prompts.',
        strengths: ['accessibility', 'real-time generation', 'multi-modal understanding', 'user-friendly interface']
      },
      'chatgpt': {
        name: 'ChatGPT with DALL-E',
        year: '2025',
        description: 'combines conversational AI with image generation for iterative creative workflows.',
        strengths: ['iterative refinement', 'context understanding', 'creative collaboration', 'rapid prototyping']
      },
      'stable-diffusion': {
        name: 'Stable Diffusion',
        year: '2025',
        description: 'provides open-source flexibility with extensive customization options and local generation.',
        strengths: ['custom models', 'local generation', 'fine-tuned control', 'community extensions']
      },
      'leonardo': {
        name: 'Leonardo AI',
        year: '2025',
        description: 'specializes in professional-grade art generation with studio-quality outputs.',
        strengths: ['professional quality', 'style consistency', 'commercial use', 'advanced controls']
      },
      'adobe-firefly': {
        name: 'Adobe Firefly',
        year: '2025',
        description: 'integrates seamlessly with Creative Cloud for professional designers and artists.',
        strengths: ['commercial safety', 'Adobe integration', 'professional tools', 'ethical generation']
      },
      'runway-ml': {
        name: 'Runway ML',
        year: '2025',
        description: 'offers cutting-edge video and image generation tools for creative professionals.',
        strengths: ['video generation', 'advanced editing', 'professional workflows', 'real-time generation']
      },
      'bluewillow': {
        name: 'BlueWillow',
        year: '2025',
        description: 'provides free, accessible AI art generation with Discord integration.',
        strengths: ['free access', 'Discord community', 'easy to use', 'rapid generation']
      },
      'playground-ai': {
        name: 'Playground AI',
        year: '2025',
        description: 'offers intuitive controls and fine-tuning for creative exploration.',
        strengths: ['fine-tuning', 'style mixing', 'intuitive interface', 'creative exploration']
      },
      'nightcafe': {
        name: 'NightCafe Studio',
        year: '2025',
        description: 'features multiple AI algorithms and artistic styles in one platform.',
        strengths: ['multiple algorithms', 'artistic styles', 'community features', 'daily challenges']
      },
      'clipdrop': {
        name: 'ClipDrop',
        year: '2025',
        description: 'specializes in real-world integration and practical AI image tools.',
        strengths: ['real-world integration', 'practical tools', 'mobile support', 'AR features']
      },
      'craiyon': {
        name: 'Craiyon',
        year: '2025',
        description: 'provides free, accessible AI image generation with a simple interface.',
        strengths: ['completely free', 'simple interface', 'no signup required', 'quick results']
      },
      'dreamstudio': {
        name: 'DreamStudio',
        year: '2025',
        description: 'offers Stable Diffusion with professional controls and fine-tuning.',
        strengths: ['professional controls', 'fine-tuning', 'API access', 'commercial use']
      },
      'getimg-ai': {
        name: 'GetImg.ai',
        year: '2025',
        description: 'provides multiple AI models and inpainting/outpainting capabilities.',
        strengths: ['multiple models', 'inpainting', 'outpainting', 'custom training']
      },
      'bing-image-creator': {
        name: 'Bing Image Creator',
        year: '2025',
        description: 'integrates DALL-E with Microsoft ecosystem for accessible generation.',
        strengths: ['free credits', 'Microsoft integration', 'easy access', 'daily boosts']
      },
      'wombo-dream': {
        name: 'Wombo Dream',
        year: '2025',
        description: 'offers mobile-first AI art generation with artistic style filters.',
        strengths: ['mobile app', 'style filters', 'quick generation', 'social sharing']
      },
      'starryai': {
        name: 'StarryAI',
        year: '2025',
        description: 'provides NFT-focused AI art generation with ownership rights.',
        strengths: ['NFT focused', 'ownership rights', 'art styles', 'mobile app']
      },
      'fotor': {
        name: 'Fotor AI',
        year: '2025',
        description: 'combines AI image generation with photo editing tools.',
        strengths: ['photo editing', 'AI tools', 'templates', 'easy to use']
      },
      'picsart': {
        name: 'Picsart AI',
        year: '2025',
        description: 'integrates AI generation with comprehensive editing tools.',
        strengths: ['editing tools', 'social features', 'filters', 'collage maker']
      }
    };

    const category = promptData.category || 'general';
    const platform = platforms[this.detectPlatform(promptData)] || platforms.gemini;
    
    return `${platform.name} ${platform.description} Whether you want ${this.getCategoryBenefits(category)}, ${platform.name}'s innovative prompts enable you to control ${this.getControlAspects(category)} with AI-powered precision.`;
  }

  static detectPlatform(promptData) {
    const promptText = (promptData.promptText || '').toLowerCase();
    const keywords = promptData.keywords || [];
    const category = promptData.category || 'general';
    
    // Check for platform-specific keywords in prompt
    if (promptText.includes('midjourney') || promptText.includes('--')) {
      return 'midjourney';
    } else if (promptText.includes('dall-e') || promptText.includes('dalle') || promptText.includes('openai')) {
      return 'dalle';
    } else if (promptText.includes('gemini') || keywords.includes('google') || promptText.includes('bard')) {
      return 'gemini';
    } else if (promptText.includes('chatgpt') || promptText.includes('gpt-4')) {
      return 'chatgpt';
    } else if (promptText.includes('stable diffusion') || promptText.includes('sd') || promptText.includes('huggingface')) {
      return 'stable-diffusion';
    } else if (promptText.includes('leonardo') || keywords.includes('leonardo') || category === 'professional-art') {
      return 'leonardo';
    } else if (promptText.includes('adobe') || promptText.includes('firefly') || keywords.includes('photoshop')) {
      return 'adobe-firefly';
    } else if (promptText.includes('runway') || keywords.includes('runway') || promptText.includes('gen-2')) {
      return 'runway-ml';
    } else if (promptText.includes('bluewillow') || keywords.includes('bluewillow')) {
      return 'bluewillow';
    } else if (promptText.includes('playground') || keywords.includes('playground')) {
      return 'playground-ai';
    } else if (promptText.includes('nightcafe') || keywords.includes('nightcafe')) {
      return 'nightcafe';
    } else if (promptText.includes('clipdrop') || keywords.includes('clipdrop')) {
      return 'clipdrop';
    } else if (promptText.includes('craiyon') || keywords.includes('craiyon') || promptText.includes('dall-e mini')) {
      return 'craiyon';
    } else if (promptText.includes('dreamstudio') || keywords.includes('dreamstudio')) {
      return 'dreamstudio';
    } else if (promptText.includes('getimg') || keywords.includes('getimg')) {
      return 'getimg-ai';
    } else if (promptText.includes('bing') || keywords.includes('microsoft')) {
      return 'bing-image-creator';
    } else if (promptText.includes('wombo') || keywords.includes('wombo')) {
      return 'wombo-dream';
    } else if (promptText.includes('starryai') || keywords.includes('starryai')) {
      return 'starryai';
    } else if (promptText.includes('fotor') || keywords.includes('fotor')) {
      return 'fotor';
    } else if (promptText.includes('picsart') || keywords.includes('picsart')) {
      return 'picsart';
    }
    
    // Default based on category
    const categoryPlatforms = {
      'art': 'midjourney',
      'photography': 'dalle',
      'design': 'adobe-firefly',
      'writing': 'chatgpt',
      'professional': 'leonardo',
      'video': 'runway-ml',
      'mobile': 'wombo-dream',
      'free': 'craiyon',
      'commercial': 'adobe-firefly',
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
      'leonardo': 'Leonardo AI',
      'adobe-firefly': 'Adobe Firefly',
      'runway-ml': 'Runway ML',
      'bluewillow': 'BlueWillow',
      'playground-ai': 'Playground AI',
      'nightcafe': 'NightCafe Studio',
      'clipdrop': 'ClipDrop',
      'craiyon': 'Craiyon',
      'dreamstudio': 'DreamStudio',
      'getimg-ai': 'GetImg.ai',
      'bing-image-creator': 'Bing Image Creator',
      'wombo-dream': 'Wombo Dream',
      'starryai': 'StarryAI',
      'fotor': 'Fotor AI',
      'picsart': 'Picsart AI'
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
      'midjourney': `Midjourney's artistic engine transforms concepts into gallery-worthy artworks with exceptional creativity, style, and technical excellence.`,
      'dalle': `DALL-E 3's sophisticated understanding capabilities turn descriptions into photorealistic images with exceptional detail and coherence.`,
      'gemini': `Gemini AI's powerful multimodal engine creates professional-quality outputs that reflect precision, style, and modern aesthetics.`,
      'stable-diffusion': `Stable Diffusion's open-source flexibility allows for customized results with unique styles and specific artistic control.`,
      'leonardo': `Leonardo AI's professional-grade tools transform concepts into studio-quality productions with commercial-ready polish.`,
      'adobe-firefly': `Adobe Firefly's ethical training and Creative Cloud integration provide safe, professional tools for commercial work.`,
      'runway-ml': `Runway ML's advanced video and image generation tools enable cutting-edge creative workflows for professionals.`,
      'bluewillow': `BlueWillow's Discord-based platform offers accessible, community-driven AI art generation for everyone.`,
      'playground-ai': `Playground AI's intuitive interface allows for fine-tuning and creative exploration with multiple models.`,
      'nightcafe': `NightCafe Studio combines multiple AI algorithms with artistic styles for diverse creative possibilities.`,
      'clipdrop': `ClipDrop's practical tools integrate AI with real-world applications for mobile and desktop use.`,
      'craiyon': `Craiyon provides completely free, accessible AI image generation with a simple, no-signup interface.`,
      'dreamstudio': `DreamStudio offers professional Stable Diffusion controls with API access for developers.`,
      'getimg-ai': `GetImg.ai provides multiple AI models with advanced features like inpainting and custom training.`,
      'bing-image-creator': `Bing Image Creator brings DALL-E capabilities to the Microsoft ecosystem with free daily credits.`,
      'wombo-dream': `Wombo Dream delivers mobile-first AI art generation with artistic filters and social sharing.`,
      'starryai': `StarryAI focuses on NFT creation with ownership rights and mobile accessibility.`,
      'fotor': `Fotor AI combines generation with comprehensive photo editing tools for complete workflows.`,
      'picsart': `Picsart AI integrates generation with social media editing tools for content creators.`
    };

    return capabilities[platform] || capabilities.gemini;
  }

  static generatePlatformComparison(promptData) {
    const primaryPlatform = this.detectPlatform(promptData);
    const category = promptData.category || 'general';
    
    const allPlatforms = {
      'midjourney': { bestFor: 'Artistic creations, fantasy art, creative exploration', price: 'Paid subscription', complexity: 'Medium', quality: 'Excellent' },
      'dalle': { bestFor: 'Realistic images, detailed scenes, text integration', price: 'Credits system', complexity: 'Low', quality: 'Excellent' },
      'gemini': { bestFor: 'Research-based images, contextual understanding, free access', price: 'Free/Paid tiers', complexity: 'Low', quality: 'Very Good' },
      'stable-diffusion': { bestFor: 'Custom models, local generation, advanced control', price: 'Free/Paid', complexity: 'High', quality: 'Good to Excellent' },
      'leonardo': { bestFor: 'Professional art, commercial projects, style consistency', price: 'Token system', complexity: 'Medium', quality: 'Excellent' },
      'adobe-firefly': { bestFor: 'Commercial work, Adobe integration, ethical generation', price: 'Adobe subscription', complexity: 'Medium', quality: 'Excellent' },
      'runway-ml': { bestFor: 'Video generation, professional workflows, advanced editing', price: 'Subscription', complexity: 'Medium-High', quality: 'Excellent' },
      'bluewillow': { bestFor: 'Free art generation, Discord community, rapid testing', price: 'Free', complexity: 'Low', quality: 'Good' },
      'playground-ai': { bestFor: 'Fine-tuning, style mixing, creative exploration', price: 'Free/Paid', complexity: 'Medium', quality: 'Very Good' },
      'nightcafe': { bestFor: 'Artistic styles, community challenges, multiple algorithms', price: 'Credit system', complexity: 'Low', quality: 'Good' },
      'clipdrop': { bestFor: 'Real-world integration, practical tools, mobile use', price: 'Free/Paid', complexity: 'Low', quality: 'Good' },
      'craiyon': { bestFor: 'Quick testing, free access, simple prompts', price: 'Free', complexity: 'Very Low', quality: 'Basic' },
      'dreamstudio': { bestFor: 'Stable Diffusion with controls, API access', price: 'Credit system', complexity: 'Medium', quality: 'Very Good' },
      'getimg-ai': { bestFor: 'Multiple models, inpainting, custom training', price: 'Credit system', complexity: 'Medium', quality: 'Very Good' },
      'bing-image-creator': { bestFor: 'Free DALL-E access, Microsoft ecosystem', price: 'Free with limits', complexity: 'Low', quality: 'Very Good' },
      'wombo-dream': { bestFor: 'Mobile generation, artistic filters, social sharing', price: 'Free/Paid', complexity: 'Low', quality: 'Good' },
      'starryai': { bestFor: 'NFT creation, ownership rights, mobile app', price: 'Token system', complexity: 'Low', quality: 'Good' },
      'fotor': { bestFor: 'Photo editing with AI, templates, easy workflow', price: 'Free/Paid', complexity: 'Low', quality: 'Good' },
      'picsart': { bestFor: 'Social media content, editing tools, AI filters', price: 'Free/Paired', complexity: 'Low', quality: 'Good' }
    };

    // Get top 5 platforms for this category
    const categoryPlatforms = {
      'art': ['midjourney', 'leonardo', 'stable-diffusion', 'nightcafe', 'playground-ai'],
      'photography': ['dalle', 'adobe-firefly', 'stable-diffusion', 'clipdrop', 'fotor'],
      'design': ['adobe-firefly', 'midjourney', 'runway-ml', 'getimg-ai', 'picsart'],
      'professional': ['leonardo', 'adobe-firefly', 'runway-ml', 'stable-diffusion', 'dreamstudio'],
      'free': ['craiyon', 'bluewillow', 'bing-image-creator', 'playground-ai', 'getimg-ai'],
      'mobile': ['wombo-dream', 'starryai', 'picsart', 'clipdrop', 'fotor'],
      'video': ['runway-ml', 'picsart', 'stable-diffusion', 'getimg-ai'],
      'general': ['gemini', 'dalle', 'midjourney', 'stable-diffusion', 'playground-ai']
    };

    const platformsToCompare = categoryPlatforms[category] || categoryPlatforms.general;
    
    const comparisonHTML = platformsToCompare.map(platformId => {
      const platform = allPlatforms[platformId];
      if (!platform) return '';
      
      const isPrimary = platformId === primaryPlatform;
      return `
        <tr class="${isPrimary ? 'primary-platform' : ''}">
          <td><strong>${platformId.charAt(0).toUpperCase() + platformId.slice(1)}</strong>${isPrimary ? ' <span class="primary-badge">Recommended</span>' : ''}</td>
          <td>${platform.bestFor}</td>
          <td><span class="price-tag ${platform.price === 'Free' ? 'price-free' : 'price-paid'}">${platform.price}</span></td>
          <td><span class="complexity ${platform.complexity.toLowerCase()}">${platform.complexity}</span></td>
          <td><span class="quality ${platform.quality.toLowerCase().replace(' ', '-')}">${platform.quality}</span></td>
        </tr>
      `;
    }).join('');

    return `
    <div class="platform-comparison">
      <h3><i class="fas fa-balance-scale"></i> AI Platform Comparison</h3>
      <p>Different AI image generators excel at different tasks. Here's how the top platforms compare for ${category} generation:</p>
      <div class="comparison-table-container">
        <table class="platform-comparison-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Best For</th>
              <th>Price</th>
              <th>Complexity</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            ${comparisonHTML}
          </tbody>
        </table>
      </div>
      <div class="comparison-tips">
        <p><strong>Tips for choosing:</strong></p>
        <ul>
          <li><strong>For beginners:</strong> Try Craiyon, BlueWillow, or Bing Image Creator</li>
          <li><strong>For professionals:</strong> Consider Leonardo AI, Adobe Firefly, or Runway ML</li>
          <li><strong>For custom work:</strong> Stable Diffusion offers the most control</li>
          <li><strong>For mobile:</strong> Wombo Dream and StarryAI have excellent apps</li>
        </ul>
      </div>
    </div>
    `;
  }

  static generateBestAITools(promptData) {
    const category = promptData.category || 'general';
    const primaryPlatform = this.detectPlatform(promptData);
    
    const allTools = {
      'midjourney': { name: "Midjourney", description: "Leading platform for artistic and creative imagery with strong stylistic control", category: ['art', 'creative', 'fantasy'], rating: 5 },
      'dalle': { name: "DALL-E 3", description: "Excellent for realistic images, complex scenes, and text integration", category: ['realistic', 'photography', 'detailed'], rating: 5 },
      'gemini': { name: "Google Gemini AI", description: "Powerful multimodal AI with excellent contextual understanding", category: ['research', 'contextual', 'free'], rating: 4 },
      'stable-diffusion': { name: "Stable Diffusion", description: "Open-source flexibility with extensive customization and local generation", category: ['custom', 'technical', 'open-source'], rating: 4 },
      'leonardo': { name: "Leonardo AI", description: "Professional-grade art generation with studio-quality outputs", category: ['professional', 'art', 'commercial'], rating: 5 },
      'adobe-firefly': { name: "Adobe Firefly", description: "Seamless Creative Cloud integration for professional designers", category: ['commercial', 'design', 'professional'], rating: 5 },
      'runway-ml': { name: "Runway ML", description: "Cutting-edge video and image generation for creative professionals", category: ['video', 'professional', 'advanced'], rating: 5 },
      'bluewillow': { name: "BlueWillow", description: "Free Discord-based AI art generation with community support", category: ['free', 'community', 'discord'], rating: 3 },
      'playground-ai': { name: "Playground AI", description: "Intuitive controls and fine-tuning for creative exploration", category: ['creative', 'fine-tuning', 'easy'], rating: 4 },
      'nightcafe': { name: "NightCafe Studio", description: "Multiple AI algorithms and artistic styles in one platform", category: ['artistic', 'styles', 'community'], rating: 4 },
      'clipdrop': { name: "ClipDrop", description: "Real-world integration and practical AI image tools", category: ['practical', 'mobile', 'real-world'], rating: 4 },
      'craiyon': { name: "Craiyon", description: "Completely free AI image generation with simple interface", category: ['free', 'simple', 'quick'], rating: 3 },
      'dreamstudio': { name: "DreamStudio", description: "Stable Diffusion with professional controls and API access", category: ['professional', 'stable-diffusion', 'api'], rating: 4 },
      'getimg-ai': { name: "GetImg.ai", description: "Multiple AI models with inpainting and custom training", category: ['versatile', 'inpainting', 'custom'], rating: 4 },
      'bing-image-creator': { name: "Bing Image Creator", description: "Free DALL-E access through Microsoft ecosystem", category: ['free', 'microsoft', 'accessible'], rating: 4 },
      'wombo-dream': { name: "Wombo Dream", description: "Mobile-first AI art with artistic style filters", category: ['mobile', 'artistic', 'social'], rating: 4 },
      'starryai': { name: "StarryAI", description: "NFT-focused AI art generation with ownership rights", category: ['nft', 'mobile', 'ownership'], rating: 3 },
      'fotor': { name: "Fotor AI", description: "AI image generation combined with photo editing tools", category: ['editing', 'templates', 'easy'], rating: 4 },
      'picsart': { name: "Picsart AI", description: "Comprehensive editing tools with AI generation features", category: ['social', 'editing', 'filters'], rating: 4 }
    };

    // Get tools relevant to this category
    const categoryTools = {
      'art': ['midjourney', 'leonardo', 'stable-diffusion', 'nightcafe', 'playground-ai', 'wombo-dream'],
      'photography': ['dalle', 'adobe-firefly', 'stable-diffusion', 'clipdrop', 'fotor', 'getimg-ai'],
      'design': ['adobe-firefly', 'midjourney', 'runway-ml', 'getimg-ai', 'picsart', 'playground-ai'],
      'professional': ['leonardo', 'adobe-firefly', 'runway-ml', 'stable-diffusion', 'dreamstudio', 'getimg-ai'],
      'free': ['craiyon', 'bluewillow', 'bing-image-creator', 'playground-ai', 'getimg-ai', 'stable-diffusion'],
      'mobile': ['wombo-dream', 'starryai', 'picsart', 'clipdrop', 'fotor', 'bing-image-creator'],
      'video': ['runway-ml', 'picsart', 'stable-diffusion', 'getimg-ai', 'adobe-firefly'],
      'general': ['gemini', 'dalle', 'midjourney', 'stable-diffusion', 'playground-ai', 'getimg-ai']
    };

    const relevantTools = categoryTools[category] || categoryTools.general;
    
    // Ensure primary platform is included
    if (!relevantTools.includes(primaryPlatform)) {
      relevantTools.unshift(primaryPlatform);
    }

    // Return top 6 tools
    return relevantTools.slice(0, 6).map(toolId => {
      const tool = allTools[toolId];
      if (!tool) return null;
      
      return {
        name: tool.name,
        description: tool.description,
        rating: tool.rating,
        category: tool.category,
        isPrimary: toolId === primaryPlatform
      };
    }).filter(tool => tool !== null);
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
          <h5><i class="fab fa-google"></i> Google Gemini</h5>
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
      </div>
    </div>
    `;
  }

  static generateStepByStepGuide(promptData) {
    const platform = this.detectPlatform(promptData);
    const category = promptData.category || 'general';
    
    const platformAccess = {
      'midjourney': 'Access Midjourney through Discord (join the Midjourney server) or use the web interface at midjourney.com.',
      'dalle': 'Access DALL-E 3 through ChatGPT Plus subscription or directly via the OpenAI platform.',
      'gemini': 'Access Google Gemini AI through gemini.google.com or the Google AI Studio.',
      'stable-diffusion': 'Use web interfaces like DreamStudio, Automatic1111 WebUI, or install locally with Stable Diffusion WebUI.',
      'leonardo': 'Access Leonardo AI through leonardo.ai web platform with account registration.',
      'adobe-firefly': 'Access through Adobe Creative Cloud apps or firefly.adobe.com with Adobe subscription.',
      'runway-ml': 'Use runwayml.com with account registration for both web and desktop applications.',
      'bluewillow': 'Join the BlueWillow Discord server through their official website.',
      'playground-ai': 'Access at playgroundai.com with free account registration.',
      'nightcafe': 'Use nightcafe.studio with account creation for credit-based generation.',
      'clipdrop': 'Access through clipdrop.co website or mobile apps available on iOS and Android.',
      'craiyon': 'Use craiyon.com directly in your browser - no account required.',
      'dreamstudio': 'Access through beta.dreamstudio.ai with Stability AI account.',
      'getimg-ai': 'Use getimg.ai with account registration for multiple AI models.',
      'bing-image-creator': 'Access through bing.com/create with Microsoft account.',
      'wombo-dream': 'Download the Dream app from app stores or use on web at wombo.art.',
      'starryai': 'Download StarryAI app from app stores or use web version.',
      'fotor': 'Use fotor.com or download Fotor app for combined editing and generation.',
      'picsart': 'Use picsart.com or download Picsart app for social media content creation.'
    };
    
    const inputPreparation = {
      'art': 'Start with a clear concept or reference image. Consider the artistic style, composition, and mood you want to achieve.',
      'photography': 'Upload your photo on respective AI . Ensure you have specific lighting, composition, and style requirements in mind.',
      'design': 'Prepare your design brief with specific requirements for layout, branding elements, and visual hierarchy considerations.',
      'writing': 'Define your content goals, target audience, and desired tone before starting the generation process.',
      'general': 'Have a clear objective and specific requirements in mind to guide the AI generation process effectively.'
    };
    
    const promptUsage = {
      'midjourney': `In Discord, type "/imagine" followed by: "${promptData.promptText?.substring(0, 100) || 'your prompt here'}". Add parameters like --ar for aspect ratio or --style for different artistic approaches.`,
      'dalle': `Enter your prompt in the generation field: "${promptData.promptText?.substring(0, 100) || 'your detailed description here'}". Use natural language and be specific about details.`,
      'gemini': `Input directly: "${promptData.promptText?.substring(0, 100) || 'your prompt here'}". Gemini understands context well, so include relevant details.`,
      'stable-diffusion': `Use prompt: "${promptData.promptText?.substring(0, 100) || 'your specific prompt here'}". Add negative prompts and adjust CFG scale, steps for control.`,
      'leonardo': `Input: "${promptData.promptText?.substring(0, 100) || 'your professional prompt here'}". Select appropriate models and adjust generation parameters.`,
      'adobe-firefly': `Use: "${promptData.promptText?.substring(0, 100) || 'your design prompt here'}". Integrate with Photoshop or other Adobe tools for editing.`,
      'runway-ml': `Input: "${promptData.promptText?.substring(0, 100) || 'your creative prompt here'}". Use video generation tools for motion content.`,
      'bluewillow': `In Discord, use: "${promptData.promptText?.substring(0, 100) || 'your prompt here'}". Simple commands with basic parameters.`,
      'playground-ai': `Enter: "${promptData.promptText?.substring(0, 100) || 'your exploration prompt here'}". Use filters and style mixing options.`,
      'nightcafe': `Input: "${promptData.promptText?.substring(0, 100) || 'your artistic prompt here'}". Choose from multiple AI algorithms.`,
      'clipdrop': `Use: "${promptData.promptText?.substring(0, 100) || 'your practical prompt here'}". Great for real-world object generation.`,
      'craiyon': `Simple input: "${promptData.promptText?.substring(0, 100) || 'your basic prompt here'}". No complicated parameters needed.`,
      'dreamstudio': `Enter: "${promptData.promptText?.substring(0, 100) || 'your stable diffusion prompt here'}". Adjust sampler, steps, and guidance.`,
      'getimg-ai': `Use: "${promptData.promptText?.substring(0, 100) || 'your versatile prompt here'}". Switch between different AI models.`,
      'bing-image-creator': `Input: "${promptData.promptText?.substring(0, 100) || 'your DALL-E prompt here'}". Uses daily boost credits for faster generation.`,
      'wombo-dream': `Enter: "${promptData.promptText?.substring(0, 100) || 'your mobile prompt here'}". Choose from artistic style filters.`,
      'starryai': `Use: "${promptData.promptText?.substring(0, 100) || 'your NFT prompt here'}". Specify style and aspect ratio.`,
      'fotor': `Input: "${promptData.promptText?.substring(0, 100) || 'your editing prompt here'}". Combine with photo editing tools.`,
      'picsart': `Enter: "${promptData.promptText?.substring(0, 100) || 'your social media prompt here'}". Use with filters and editing features.`
    };
    
    const customizationTips = {
      'midjourney': 'Use --ar for aspect ratios, --style for different artistic approaches, --chaos for variation, --quality for detail level.',
      'dalle': 'Specify style, quality, and specific details in natural language. Use "in the style of" for artistic references.',
      'gemini': 'Be specific about context and desired outcome. Include relevant details about composition, lighting, and style.',
      'stable-diffusion': 'Use negative prompts to exclude elements, adjust CFG scale (7-12), steps (20-50), and samplers (Euler, DPM).',
      'leonardo': 'Select appropriate model (Leonardo Diffusion, Leonardo Creative), adjust guidance scale, and use element weights.',
      'adobe-firefly': 'Use content type filters, aspect ratio settings, and style presets. Integrate with Adobe Stock references.',
      'runway-ml': 'Use motion brush for video, adjust frame consistency, and apply style transfers for unique looks.',
      'bluewillow': 'Simple parameters like aspect ratio and style. Best for straightforward generation.',
      'playground-ai': 'Mix filters, adjust prompt guidance, and use image-to-image for consistency.',
      'nightcafe': 'Choose between VQGAN, CLIP, Stable Diffusion algorithms. Use style transfers and upscaling.',
      'clipdrop': 'Use background removal, object replacement, and real-world integration tools.',
      'craiyon': 'Keep prompts simple and descriptive. No advanced parameters available.',
      'dreamstudio': 'Adjust sampler settings, use negative prompts, and control image dimensions precisely.',
      'getimg-ai': 'Switch between models, use inpainting/outpainting tools, and train custom models.',
      'bing-image-creator': 'Use natural language, specify artistic styles, and utilize daily boost credits wisely.',
      'wombo-dream': 'Apply artistic filters (Synthwave, Steampunk, etc.), adjust creativity level.',
      'starryai': 'Choose art styles, specify NFT parameters, and adjust generation settings.',
      'fotor': 'Combine with editing tools like cropping, filters, and effects for complete workflow.',
      'picsart': 'Use with social media templates, apply filters, and add text/graphics.'
    };
    
    const generationProcess = {
      'midjourney': 'Click generate and wait for the initial results. Use the U buttons to upscale specific variations or V buttons to create new variations based on your favorites.',
      'dalle': 'Click the generate button and review the created images. You can request variations or make specific edits to the generated content.',
      'gemini': 'Initiate generation and monitor progress. The platform will provide multiple options that you can refine or regenerate as needed.',
      'chatgpt': 'Send your prompt and wait for the AI to process your request. You can ask for modifications or clarifications in subsequent messages.',
      'stable-diffusion': 'Start the generation process and monitor progress through the interface. You can interrupt and restart with different parameters.',
      'leonardo': 'Launch the generation and track progress. Use advanced tools to make real-time adjustments and refinements.',
      'adobe-firefly': 'Generate and refine within Adobe apps. Use generative fill and other tools for seamless integration.',
      'runway-ml': 'Generate and use timeline editing for video. Apply effects and transitions for professional results.',
      'bluewillow': 'Simple generation in Discord. Request variations with basic commands.',
      'playground-ai': 'Generate and use filters. Mix styles and adjust parameters for creative exploration.',
      'nightcafe': 'Generate and participate in community challenges. Use different algorithms for varied results.',
      'clipdrop': 'Generate with practical applications. Use mobile features for on-the-go creation.',
      'craiyon': 'Quick generation with simple interface. No complex controls needed.',
      'dreamstudio': 'Generate with professional controls. Use API for automated workflows.',
      'getimg-ai': 'Generate with multiple models. Use advanced features like inpainting.',
      'bing-image-creator': 'Generate with daily boost credits. Simple interface for quick results.',
      'wombo-dream': 'Generate on mobile with artistic filters. Share directly to social media.',
      'starryai': 'Generate NFT-ready art. Mobile-friendly with ownership features.',
      'fotor': 'Generate and edit in one workflow. Use templates for professional results.',
      'picsart': 'Generate social media content. Edit with comprehensive toolset.'
    };
    
    const finalization = {
      'midjourney': 'Download your preferred result in your chosen resolution. Use Max Upscale for the highest quality output suitable for professional use.',
      'dalle': 'Select your preferred output and download in high resolution. The platform offers different quality settings for various use cases.',
      'gemini': 'Choose the best result and export in your desired format and resolution. The platform provides options for different applications and platforms.',
      'chatgpt': 'Save your final result in the appropriate format. You can continue refining through conversation until you achieve the perfect outcome.',
      'stable-diffusion': 'Save your generated image and consider post-processing if needed. The open-source nature allows for extensive customization and editing.',
      'leonardo': 'Export your final creation in professional formats. The platform offers commercial-grade outputs ready for various applications.',
      'adobe-firefly': 'Export directly to Creative Cloud apps. Use professional formats for commercial work.',
      'runway-ml': 'Export in video formats. Use professional codecs for production work.',
      'bluewillow': 'Download basic formats. Simple export for casual use.',
      'playground-ai': 'Export with editing options. Multiple formats available.',
      'nightcafe': 'Download and share. Community features for engagement.',
      'clipdrop': 'Export for practical use. Mobile-optimized formats.',
      'craiyon': 'Simple download. Basic formats for quick sharing.',
      'dreamstudio': 'Export professional formats. API integration available.',
      'getimg-ai': 'Export with advanced options. Custom training support.',
      'bing-image-creator': 'Download with Microsoft integration. Cloud storage options.',
      'wombo-dream': 'Share directly to social media. Mobile-optimized exports.',
      'starryai': 'Export NFT-ready files. Mobile sharing features.',
      'fotor': 'Export with editing. Professional templates included.',
      'picsart': 'Export for social media. Comprehensive sharing options.'
    };
    
    return {
      access: platformAccess[platform] || platformAccess.gemini,
      preparation: inputPreparation[category],
      prompt: promptUsage[platform] || promptUsage.gemini,
      customization: customizationTips[platform] || customizationTips.general,
      generation: generationProcess[platform] || generationProcess.gemini,
      finalization: finalization[platform] || finalization.gemini
    };
  }

  static generateExpertTips(promptData) {
    const platform = this.detectPlatform(promptData);
    const category = promptData.category || 'general';
    
    const platformSpecificTips = {
      'midjourney': [
        "Use --test and --creative parameters for more experimental results",
        "Combine multiple styles with double colon syntax: 'style1::style2::2'",
        "Use --no parameter to exclude elements: '--no text, watermark'",
        "Experiment with --stylize values (100-1000) for different artistic effects",
        "Save successful seeds for consistent style reproduction",
        "Use image prompts with URLs for style reference",
        "Try different upscalers (Regular, Detailed, Beta) for various results"
      ],
      'dalle': [
        "Use detailed, descriptive language rather than abstract concepts",
        "Include artistic references: 'in the style of [artist], [art movement]'",
        "Specify lighting and composition: 'dramatic lighting, rule of thirds'",
        "Use quality modifiers: 'highly detailed, 8k resolution, professional photography'",
        "Experiment with different aspect ratios for various use cases",
        "Use the 'variations' feature to explore different interpretations",
        "Combine with ChatGPT for iterative prompt refinement"
      ],
      'stable-diffusion': [
        "Use weighted prompts: '(keyword:1.3)' to emphasize elements",
        "Experiment with different samplers: Euler a, DPM++ 2M, DDIM",
        "Adjust CFG scale (Classifier Free Guidance) between 7-12 for optimal results",
        "Use negative prompts extensively to exclude unwanted elements",
        "Try different models (Realistic Vision, DreamShaper, etc.) for different styles",
        "Use LoRAs and textual inversions for specific styles or characters",
        "Experiment with high-res fix and upscalers for better quality"
      ],
      'leonardo': [
        "Use element weights to balance different aspects of your prompt",
        "Experiment with different Leonardo models for various art styles",
        "Use the canvas editor for inpainting and outpainting",
        "Save favorite styles and prompts for quick reuse",
        "Adjust the guidance scale for more or less prompt adherence",
        "Use the 'Alchemy' feature for enhanced artistic results",
        "Experiment with different aspect ratios and resolutions"
      ],
      'adobe-firefly': [
        "Use Adobe Stock references for consistent style generation",
        "Integrate with Photoshop for seamless editing workflows",
        "Use content type filters for appropriate commercial use",
        "Experiment with different style presets and adjustments",
        "Use the 'Generative Fill' feature for smart editing",
        "Combine multiple Firefly generations in single projects",
        "Use text effects and vector generation for design work"
      ],
      'general': [
        "Be descriptive: Use specific, detailed language rather than vague or abstract terms",
        "Provide context: Include the purpose, audience, and intended use of the generated content",
        "Use examples: Reference similar works, styles, or outcomes you're trying to achieve",
        "Iterate systematically: Make small, specific changes between generations to understand what works",
        "Balance specificity and flexibility: Be specific about what matters most, but allow creative freedom elsewhere",
        "Learn platform nuances: Understand the specific strengths and limitations of your chosen AI platform",
        "Document successful prompts: Keep a record of what works well for future reference and consistency"
      ]
    };

    const tips = platformSpecificTips[platform] || platformSpecificTips.general;
    
    return tips;
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
    copies: 12,
    commentCount: 5,
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
    copies: 28,
    commentCount: 8,
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
    copies: 8,
    commentCount: 3,
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
    'Works great with DALL-E 3 too!'
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
    },
    features: {
      comments: true,
      news: true,
      caching: true,
      miniBrowser: true
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
      
      if (fileBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 20MB limit' });
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
      // Get total count
      const countSnapshot = await db.collection('uploads').doc(promptId)
        .collection('comments')
        .count()
        .get();
      
      totalCount = countSnapshot.data().count || 0;
      
      // Get paginated comments
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
      // Mock comments for development
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
    
    cache.set(cacheKey, result, 300); // Cache for 5 minutes
    
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
    
    // Basic spam protection
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
      isApproved: true // Auto-approve for now, can add moderation later
    };
    
    let commentRef;
    
    if (db && db.collection) {
      commentRef = await db.collection('uploads').doc(promptId)
        .collection('comments')
        .add(commentData);
      
      // Increment comment count in prompt
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
    
    // Clear cache for this prompt's comments
    cache.keys().forEach(key => {
      if (key.startsWith(`comments-${promptId}-`)) {
        cache.del(key);
      }
    });
    
    // Also clear the prompt cache
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
    
    // Clear cache
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

// Track prompt copy actions - OPTIMIZED
app.post('/api/prompt/:id/copy', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    // Only update occasionally to reduce writes
    const shouldUpdate = Math.random() < 0.3; // 30% write rate
    
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
      
      if (fileBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 20MB limit' });
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

      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(fileType)) {
        return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF and WebP are allowed' });
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
        copies: 0,
        commentCount: 0,
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
          userCopied: false,
          promptUrl: `/prompt/${doc.id}`
        });
      });
    } else {
      allUploads = mockPrompts.map(prompt => ({
        ...prompt,
        userLiked: false,
        userUsed: false,
        userCopied: false,
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
        userCopied: false,
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
    copies: safePrompt.copies || 0,
    commentCount: safePrompt.commentCount || 0,
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
  promptData.bestAITools = AIDescriptionGenerator.generateBestAITools(promptData);
  promptData.trendAnalysis = PromptContentGenerator.generateTrendAnalysis(promptData);
  promptData.usageTips = PromptContentGenerator.generateUsageTips(promptData);
  promptData.seoTips = PromptContentGenerator.generateSEOTips(promptData);
  
  promptData.aiStepByStepGuide = aiDescription.stepByStep;
  promptData.aiExpertTips = aiDescription.tips;
  
  // NEW: Platform comparison
  promptData.platformComparison = AIDescriptionGenerator.generatePlatformComparison(promptData);
  
  // NEW: Model-specific tips
  promptData.modelSpecificTips = AIDescriptionGenerator.generateModelSpecificTips();

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

// Platform Comparison CSS
const platformComparisonCSS = `
/* Platform Comparison Styles */
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

.complexity {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(255,255,255,0.2);
    color: white;
}

.complexity.low {
    background: #20bf6b;
}

.complexity.medium {
    background: #ff9f43;
}

.complexity.high {
    background: #ff6b6b;
}

.quality {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(255,255,255,0.2);
    color: white;
}

.quality.excellent {
    background: #4e54c8;
}

.quality.very-good {
    background: #20bf6b;
}

.quality.good {
    background: #ff9f43;
}

.quality.basic {
    background: #a4b0be;
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

/* Model Specific Tips */
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

/* Enhanced Tools Grid */
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

/* Copy Button Styles */
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

.copy-prompt-btn.error {
    background: linear-gradient(135deg, #ff6b6b 0%, #ff8787 100%);
}

.copy-prompt-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.copy-prompt-btn i {
    font-size: 1rem;
}

/* Touch-friendly styles for mobile */
@media (max-width: 768px) {
    .copy-prompt-btn {
        padding: 10px 18px;
        font-size: 1rem;
        min-height: 44px;
        min-width: 44px;
    }
    
    .copy-prompt-btn i {
        font-size: 1.1rem;
    }
}

/* Visual feedback for copy action */
@keyframes checkmark {
    0% { transform: scale(0); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
}

/* Hover effect for the entire prompt text area */
.prompt-text {
    position: relative;
    transition: all 0.3s ease;
}

.prompt-text:hover {
    background: #f0f2ff;
    border-left-color: #8f94fb;
}

/* Touch feedback for prompt text on mobile */
.prompt-text:active {
    background: #e6e9ff;
}

/* Copy hint tooltip */
.copy-hint {
    position: absolute;
    top: -35px;
    right: 10px;
    background: #2d334a;
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s ease;
    pointer-events: none;
    white-space: nowrap;
    z-index: 100;
}

.copy-hint:after {
    content: '';
    position: absolute;
    top: 100%;
    right: 20px;
    border-width: 5px;
    border-style: solid;
    border-color: #2d334a transparent transparent transparent;
}

.copy-hint.show {
    opacity: 1;
    transform: translateY(0);
}

/* Success/Error messages */
.copy-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #20bf6b 0%, #4cd964 100%);
    color: white;
    padding: 15px 25px;
    border-radius: 10px;
    box-shadow: 0 5px 15px rgba(32, 191, 107, 0.4);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 10000;
    transform: translateX(150%);
    transition: transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.copy-notification.show {
    transform: translateX(0);
}

.copy-notification.error {
    background: linear-gradient(135deg, #ff6b6b 0%, #ff8787 100%);
    box-shadow: 0 5px 15px rgba(255, 107, 107, 0.4);
}

.copy-notification i {
    font-size: 1.2rem;
}

.copy-notification-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.copy-notification-title {
    font-weight: 600;
    font-size: 1rem;
}

.copy-notification-subtitle {
    font-size: 0.85rem;
    opacity: 0.9;
}

/* Enhanced prompt interaction */
.prompt-text-wrapper {
    position: relative;
    cursor: pointer;
    user-select: text;
}

.prompt-text-wrapper:hover .copy-hint {
    opacity: 1;
    transform: translateY(0);
}

/* Selection styling for better UX */
.prompt-text::selection {
    background: rgba(78, 84, 200, 0.3);
    color: #2d334a;
}

.prompt-text::-moz-selection {
    background: rgba(78, 84, 200, 0.3);
    color: #2d334a;
}

/* Copy count badge */
.copy-count {
    background: rgba(255, 255, 255, 0.3);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: bold;
    margin-left: 8px;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
}

/* Make copy button more prominent on mobile */
@media (max-width: 768px) {
    .copy-prompt-btn {
        position: sticky;
        top: 70px;
        margin: -10px auto 15px auto;
        display: block;
        width: calc(100% - 40px);
        max-width: 300px;
        z-index: 100;
    }
    
    .copy-prompt-container {
        margin-top: 60px;
    }
}

@media (max-width: 480px) {
    .copy-notification {
        top: 10px;
        right: 10px;
        left: 10px;
        transform: translateY(-150%);
    }
    
    .copy-notification.show {
        transform: translateY(0);
    }
    
    .copy-hint {
        display: none;
    }
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
    
    .model-specific-tips {
        padding: 1.5rem;
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
    .complexity,
    .quality {
        font-size: 0.7rem;
        padding: 2px 8px;
    }
}
`;

// Comment System CSS
const commentSystemCSS = `
/* Comment System Styles */
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

.comment-submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
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

.comment-form-notice {
    background: #e8f4fd;
    border-left: 4px solid #4e54c8;
    padding: 1rem;
    margin-top: 1rem;
    border-radius: 6px;
    font-size: 0.9rem;
    color: #555;
}

.comment-form-notice strong {
    color: #4e54c8;
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

// Comment System JavaScript - Make it a function that accepts promptData
function generateCommentSystemJS(promptData) {
  return `
// Comment System Functionality
let currentPage = 1;
let isLoadingComments = false;
let hasMoreComments = true;

// Load comments
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
                // Update comment count in header if needed
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

// Create comment element
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

// Handle comment submission
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
    
    // Validation
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
            // Reset form
            form.reset();
            
            // Show success message
            alert('Comment posted successfully!');
            
            // Reload comments (show new comment at top)
            loadComments(1);
            
            // Scroll to comment section
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

// Like a comment
async function likeComment(commentId) {
    const promptId = '${promptData.id}';
    const likeBtn = document.querySelector('#comment-' + commentId + ' .like-comment-btn');
    
    if (likeBtn.classList.contains('liked')) {
        return; // Already liked
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

// Load more comments
document.getElementById('loadMoreBtn').addEventListener('click', function() {
    if (hasMoreComments && !isLoadingComments) {
        loadComments(currentPage + 1);
    }
});

// Initialize comments on page load
document.addEventListener('DOMContentLoaded', function() {
    loadComments(1);
    
    // Add character counter for comment textarea
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

// ENHANCED PROMPT PAGE GENERATOR WITH 20+ AI MODELS AND COMMENT SYSTEM
function generateEnhancedPromptHTML(promptData) {
  const promptAdHTML = generatePromptAdPlacement();
  
  const baseUrl = 'https://www.toolsprompt.com';
  const promptUrl = baseUrl + '/prompt/' + promptData.id;
  
  // Get GA ID from environment variable
  const gaId = process.env.GOOGLE_ANALYTICS_ID || 'G-K4KXR4FZCP';
  
  // Google Analytics 4 code
  const googleAnalyticsCode = `
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}');
    </script>
  `;

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
    <div class="tool-card-enhanced ${tool.isPrimary ? 'primary-tool' : ''}">
      <h4>
        ${tool.name}
        <div class="tool-rating">
          ${Array(tool.rating).fill('<i class="fas fa-star"></i>').join('')}
          ${Array(5 - tool.rating).fill('<i class="far fa-star"></i>').join('')}
        </div>
      </h4>
      <p>${tool.description}</p>
      <div class="tool-tags">
        ${(tool.category || []).map(cat => `<span class="tool-tag">${cat}</span>`).join('')}
      </div>
    </div>
  `).join('');

  const tipsHTML = promptData.usageTips.map(tip => `
    <li>${tip}</li>
  `).join('');

  const seoTipsHTML = promptData.seoTips.map(tip => `
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
        
        /* Mini Browser Styles */
        ${miniBrowserCSS}
        
        /* Platform Comparison Styles */
        ${platformComparisonCSS}
        
        /* Comment System Styles */
        ${commentSystemCSS}
        
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
                    <div class="stat-item-small">
                        <i class="far fa-comments"></i>
                        <span class="stat-number-small comment-count">${promptData.commentCount || 0}</span>
                        <span class="stat-label-small">Comments</span>
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
                <!-- Original Prompt Section with Copy Button -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-magic"></i> AI Prompt Used</h2>
                    <div class="copy-prompt-container">
                        <button class="copy-prompt-btn" id="copyPromptBtn" onclick="copyPromptToClipboard()">
                            <i class="far fa-copy"></i> Copy Prompt
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

                <!-- Middle Ad Placement -->
                ${promptAdHTML}

                <!-- UPDATED: AI-Generated About This Prompt Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-info-circle"></i> Discover Superior Results With The Help Following Ai Option</h2>
                    <div class="platform-intro">
                        <p>${promptData.detailedExplanation}</p>
                    </div>
                </section>

                <!-- NEW: Platform Comparison Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-chart-bar"></i> AI Platform Comparison</h2>
                    ${promptData.platformComparison}
                </section>

                <!-- Enhanced Best AI Tools Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-robot"></i> Top AI Tools for This Style</h2>
                    <div class="tools-grid-enhanced">
                        ${toolsHTML}
                    </div>
                </section>

                <!-- NEW: Model-Specific Tips Section -->
                <section class="content-section">
                    <h2 class="section-title"><i class="fas fa-cogs"></i> Model-Specific Optimization Tips</h2>
                    ${promptData.modelSpecificTips}
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


        <!-- Comment Section -->
        <section class="comment-section" id="commentSection">
            <h2><i class="far fa-comments"></i> Comments</h2>
            
            <!-- Comment Form -->
            <div class="comment-form">
                <h3>Add a Comment</h3>
                <form id="commentForm">
                    <div class="form-group">
                        <label for="commentContent">Your Comment *</label>
                        <textarea 
                            id="commentContent" 
                            name="content" 
                            placeholder="Share your thoughts about this prompt..." 
                            maxlength="1000"
                            required></textarea>
                        <small style="color: #666; display: block; margin-top: 0.5rem;">
                            Max 1000 characters. Your comment will be publicly visible.
                        </small>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div class="form-group">
                            <label for="authorName">Name (optional)</label>
                            <input 
                                type="text" 
                                id="authorName" 
                                name="authorName" 
                                placeholder="Your name">
                        </div>
                        <div class="form-group">
                            <label for="authorEmail">Email (optional)</label>
                            <input 
                                type="email" 
                                id="authorEmail" 
                                name="authorEmail" 
                                placeholder="your@email.com">
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
            
            <!-- Comments List -->
            <div class="comments-list" id="commentsList">
                <div class="no-comments" id="noComments">
                    <i class="far fa-comment" style="font-size: 3rem; color: #ddd; margin-bottom: 1rem;"></i>
                    <p>No comments yet. Be the first to share your thoughts!</p>
                </div>
                <!-- Comments will be loaded here -->
            </div>
            
            <!-- Load More Button -->
            <div class="load-more-comments" id="loadMoreComments" style="display: none;">
                <button class="load-more-btn" id="loadMoreBtn">
                    <i class="fas fa-sync-alt"></i> Load More Comments
                </button>
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
                    document.querySelector('.comment-count').textContent = data.comments;
                    
                    const engagementRate = Math.round((data.likes + data.uses + data.copies + data.comments) / Math.max(data.views, 1) * 100);
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
                            <div class="stat-number">\${data.copies}</div>
                            <div class="stat-label">Copies</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${data.comments}</div>
                            <div class="stat-label">Comments</div>
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

        // Copy Prompt Functionality
        let copyTimeout = null;
        let isCopied = false;

        function copyPromptToClipboard() {
            const promptText = document.getElementById('promptText');
            const copyBtn = document.getElementById('copyPromptBtn');
            const promptContent = promptText.textContent || promptText.innerText;
            
            if (!promptContent.trim()) {
                showCopyNotification('No prompt text found', 'error');
                return;
            }
            
            // Try using the modern Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(promptContent)
                    .then(() => {
                        handleCopySuccess(copyBtn);
                    })
                    .catch(err => {
                        // Fallback to legacy method
                        fallbackCopyTextToClipboard(promptContent, copyBtn);
                    });
            } else {
                // Use fallback method for older browsers
                fallbackCopyTextToClipboard(promptContent, copyBtn);
            }
        }

        function fallbackCopyTextToClipboard(text, copyBtn) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.top = '0';
            textArea.style.left = '0';
            textArea.style.width = '2em';
            textArea.style.height = '2em';
            textArea.style.padding = '0';
            textArea.style.border = 'none';
            textArea.style.outline = 'none';
            textArea.style.boxShadow = 'none';
            textArea.style.background = 'transparent';
            
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    handleCopySuccess(copyBtn);
                    // Track CTR increase for analytics
                    trackCopyAction();
                } else {
                    showCopyNotification('Copy failed. Please try again.', 'error');
                }
            } catch (err) {
                showCopyNotification('Copy not supported in your browser', 'error');
                console.error('Copy failed:', err);
            }
            
            document.body.removeChild(textArea);
        }

        function handleCopySuccess(copyBtn) {
            // Update button state
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            copyBtn.classList.add('copied');
            copyBtn.disabled = true;
            
            // Show success notification
            showCopyNotification('Prompt copied!', 'success');
            
            // Track successful copy for analytics
            trackCopyAction();
            
            // Reset button after 3 seconds
            if (copyTimeout) clearTimeout(copyTimeout);
            copyTimeout = setTimeout(() => {
                copyBtn.innerHTML = '<i class="far fa-copy"></i> Copy Prompt';
                copyBtn.classList.remove('copied');
                copyBtn.disabled = false;
                isCopied = false;
            }, 3000);
            
            isCopied = true;
        }

        function showCopyNotification(message, type = 'success') {
            // Remove existing notifications
            const existingNotifications = document.querySelectorAll('.copy-notification');
            existingNotifications.forEach(notification => {
                notification.remove();
            });
            
            // Create notification
            const notification = document.createElement('div');
            notification.className = \`copy-notification \${type}\`;
            
            const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
            const title = type === 'success' ? 'Success!' : 'Error!';
            
            notification.innerHTML = \`
                <i class="fas \${icon}"></i>
                <div class="copy-notification-content">
                    <span class="copy-notification-title">\${title}</span>
                    <span class="copy-notification-subtitle">\${message}</span>
                </div>
            \`;
            
            document.body.appendChild(notification);
            
            // Animate in
            setTimeout(() => {
                notification.classList.add('show');
            }, 10);
            
            // Remove after 3 seconds
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 500);
            }, 3000);
        }

        // Handle click on prompt text (for CTR improvement)
        function handlePromptClick(event) {
            // Don't trigger if clicking the copy button
            if (event.target.closest('.copy-prompt-btn')) {
                return;
            }
            
            // If prompt text is clicked directly, copy it
            const promptElement = event.target.closest('.prompt-text');
            if (promptElement && !isCopied) {
                copyPromptToClipboard();
                
                // Visual feedback
                promptElement.style.transform = 'scale(0.99)';
                setTimeout(() => {
                    promptElement.style.transform = 'scale(1)';
                }, 150);
            }
        }

        // Handle right-click/context menu on prompt text
        function handlePromptContextMenu(event) {
            event.preventDefault();
            copyPromptToClipboard();
            
            // Show contextual hint
            const copyHint = document.getElementById('copyHint');
            if (copyHint) {
                copyHint.textContent = 'Copied via right-click!';
                copyHint.classList.add('show');
                
                setTimeout(() => {
                    copyHint.classList.remove('show');
                    copyHint.textContent = 'Click or tap to copy';
                }, 2000);
            }
            
            return false;
        }

        // Track copy action for analytics/CTR improvement
        function trackCopyAction() {
            const promptId = '${promptData.id}';
            const eventData = {
                promptId: promptId,
                action: 'copy',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                referrer: document.referrer
            };
            
            // Send to analytics endpoint if available
            if (window.ga) {
                window.ga('send', 'event', 'Prompt', 'Copy', promptId);
            }
            
            // Send to your analytics endpoint
            fetch('/api/prompt/' + promptId + '/copy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(eventData)
            }).catch(err => console.log('Analytics error:', err));
            
            // Increment local counter for UI
            incrementCopyCounter();
        }

        function incrementCopyCounter() {
            const copyBtn = document.getElementById('copyPromptBtn');
            if (copyBtn) {
                const copyCount = parseInt(copyBtn.dataset.copyCount || '0') + 1;
                copyBtn.dataset.copyCount = copyCount;
                
                // Update button text after first copy to show popularity
                if (copyCount > 1) {
                    const originalText = copyBtn.querySelector('.original-text') || 
                                        document.createElement('span');
                    if (!originalText.classList.contains('original-text')) {
                        originalText.className = 'original-text';
                        originalText.textContent = 'Copy Prompt';
                        copyBtn.innerHTML = '';
                        copyBtn.appendChild(originalText);
                    }
                    
                    const countBadge = copyBtn.querySelector('.copy-count') || 
                                      document.createElement('span');
                    if (!countBadge.classList.contains('copy-count')) {
                        countBadge.className = 'copy-count';
                        countBadge.style.marginLeft = '8px';
                        countBadge.style.background = 'rgba(255,255,255,0.3)';
                        countBadge.style.padding = '2px 6px';
                        countBadge.style.borderRadius = '10px';
                        countBadge.style.fontSize = '0.8rem';
                        copyBtn.appendChild(countBadge);
                    }
                    countBadge.textContent = copyCount + '×';
                }
            }
        }

        // Add hover hint for desktop users
        document.addEventListener('DOMContentLoaded', function() {
            const promptText = document.getElementById('promptText');
            const copyHint = document.getElementById('copyHint');
            
            if (promptText && copyHint) {
                // Show hint on hover for desktop
                promptText.addEventListener('mouseenter', function() {
                    if (window.innerWidth > 768 && !isCopied) {
                        copyHint.classList.add('show');
                    }
                });
                
                promptText.addEventListener('mouseleave', function() {
                    copyHint.classList.remove('show');
                });
                
                // Touch events for mobile
                promptText.addEventListener('touchstart', function() {
                    promptText.style.backgroundColor = '#e6e9ff';
                });
                
                promptText.addEventListener('touchend', function() {
                    setTimeout(() => {
                        promptText.style.backgroundColor = '';
                    }, 200);
                });
            }
            
            // Initialize copy count from localStorage if available
            const promptId = '${promptData.id}';
            const savedCopyCount = localStorage.getItem('prompt_copy_' + promptId);
            if (savedCopyCount) {
                const copyBtn = document.getElementById('copyPromptBtn');
                if (copyBtn) {
                    copyBtn.dataset.copyCount = savedCopyCount;
                }
            }
        });

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

        // Comment System JavaScript
     ${generateCommentSystemJS(promptData)}
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
  
  console.log(`💬 Comment System Endpoints:`);
  console.log(`   → Get comments: http://localhost:${port}/api/prompt/:id/comments`);
  console.log(`   → Post comment: http://localhost:${port}/api/prompt/:id/comments (POST)`);
  console.log(`   → Like comment: http://localhost:${port}/api/comment/:commentId/like (POST)`);
  
  console.log(`📋 Copy tracking: http://localhost:${port}/api/prompt/:id/copy (Optimized: 30% write rate)`);
  console.log(`❤️  Engagement endpoints:`);
  console.log(`   → Views: http://localhost:${port}/api/prompt/:id/view (Optimized: 10% write rate)`);
  console.log(`   → Likes: http://localhost:${port}/api/prompt/:id/like`);
  console.log(`   → Uses: http://localhost:${port}/api/prompt/:id/use`);
  console.log(`   → Copies: http://localhost:${port}/api/prompt/:id/copy`);
  console.log(`   → Analytics: http://localhost:${port}/api/prompt/:id/engagement`);
  console.log(`🔍 Search: http://localhost:${port}/api/search (Limited to 100 results)`);
  console.log(`🗺️  Sitemap: http://localhost:${port}/sitemap.xml`);
  console.log(`🤖 Robots.txt: http://localhost:${port}/robots.txt`);
  console.log(`❤️  Health check: http://localhost:${port}/health`);
  console.log(`💰 AdSense Client ID: ${process.env.ADSENSE_CLIENT_ID || 'ca-pub-5992381116749724'}`);
  console.log(`🔄 AdSense Migration: http://localhost:${port}/admin/migrate-adsense`);
  console.log(`📊 Caching: Enabled with 5-minute TTL`);
  console.log(`🤖 AI Models Enhanced: 20+ AI Image Generator Platforms Supported`);
  console.log(`📊 Platform Comparison: Interactive comparison tables added`);
  console.log(`⭐ Star Ratings: Tool ratings with visual indicators`);
  console.log(`🔧 Model-Specific Tips: Optimization tips for each AI platform`);
  console.log(`📋 NEW: Copy Prompt Button: Enhanced UX with touch/click support`);
  console.log(`📈 NEW: Copy Tracking: Analytics for CTR improvement`);
  console.log(`💬 NEW: Comment System: Public comments with like functionality`);
  console.log(`💰 COST SAVINGS IMPLEMENTED:`);
  console.log(`   ✅ Database query limits added`);
  console.log(`   ✅ Caching layer implemented`);
  console.log(`   ✅ View counts batched (10% write rate)`);
  console.log(`   ✅ Copy tracking batched (30% write rate)`);
  console.log(`   ✅ Search limited to 100 results`);
  console.log(`   ✅ Sitemaps limited to 100 items`);
  
  if (!db || !db.collection) {
    console.log(`🎭 Running in DEVELOPMENT mode with mock data`);
    console.log(`📰 Sample news articles:`);
    global.mockNews.slice(0, 3).forEach(news => {
      console.log(`   → http://localhost:${port}/news/${news.id}`);
    });
    console.log(`💬 Sample comments available on all prompt pages`);
  }
});