// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCgc0xRtijpyPhOovfwg-MzyahsUFh-hiQ",
  authDomain: "toolsprompt-5b07e.firebaseapp.com",
  projectId: "toolsprompt-5b07e",
  storageBucket: "toolsprompt-5b07e.firebasestorage.app",
  messagingSenderId: "402263780942",
  appId: "1:402263780942:web:1013a347dbb72db6b31d1f",
  measurementId: "G-K4KXR4FZCP"
};

// Global variables for synchronized feeds
let allPrompts = [];
let lastPromptUpdate = 0;
const PROMPT_CACHE_DURATION = 20 * 60 * 1000; // 20 minutes

// Hover autoplay configuration
const hoverConfig = {
    enabled: true,
    delay: 100,
    mobileDelay: 0,
    pauseOnScroll: true,
    muteByDefault: true,
    loop: true,
    preload: 'metadata',
    playOnFocus: true,
    playOnTouch: true,
    thumbnailOpacity: 0
};

// Track Firebase initialization state
let firebaseInitialized = false;
let currentUserData = null;

// ==================== RAZORPAY PAYMENT FUNCTIONS ====================

let razorpayLoaded = false;
let razorpayKeyId = null;

// Get Razorpay key
async function getRazorpayKey() {
    try {
        const response = await fetch('/api/razorpay-key');
        const data = await response.json();
        razorpayKeyId = data.keyId;
        return data;
    } catch (error) {
        console.error('Error getting Razorpay key:', error);
        return { isDemo: true };
    }
}

// Load Razorpay script dynamically
async function loadRazorpayScript() {
    if (razorpayLoaded) return true;
    
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => {
            razorpayLoaded = true;
            resolve(true);
        };
        script.onerror = () => {
            console.error('Failed to load Razorpay script');
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

// Create Razorpay order
async function createRazorpayOrder(prompt, user, customerInfo) {
    try {
        const response = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                promptId: prompt.id,
                price: prompt.price,
                userId: user.uid,
                userEmail: user.email,
                customerName: customerInfo?.name,
                billingAddress: customerInfo?.address
            })
        });
        
        const data = await response.json();
        return data;
        
    } catch (error) {
        console.error('Error creating order:', error);
        throw error;
    }
}

// Fixed processPaymentWithRazorpay function
async function processPaymentWithRazorpay(prompt, customerInfo) {
    const buyBtn = document.getElementById('buyNowBtn');
    const originalText = buyBtn?.innerHTML || 'Buy Now';
    if (buyBtn) {
        buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating order...';
        buyBtn.disabled = true;
    }
    
    try {
        const user = await getCurrentUser();
        if (!user) {
            showNotification('Please login to purchase prompts', 'error');
            window.location.href = '/login.html?returnUrl=' + encodeURIComponent(window.location.href);
            return;
        }
        
        // Create order on server
        const response = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                promptId: prompt.id,
                price: prompt.price,
                userId: user.uid,
                userEmail: user.email,
                customerName: customerInfo?.name,
                customerPhone: customerInfo?.phone
            })
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.isDemo) {
            // Demo mode - complete purchase without actual payment
            if (buyBtn) buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
            await completePurchase(prompt, user, null);
            closeBuyModal();
            return;
        }
        
        // Load Razorpay script if needed
        if (typeof Razorpay === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://checkout.razorpay.com/v1/checkout.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        // Check if Razorpay loaded
        if (typeof Razorpay === 'undefined') {
            throw new Error('Payment system not available. Please try again later.');
        }
        
        // Create Razorpay options with key from server
        const options = {
            key: data.keyId,
            amount: data.amount,
            currency: data.currency,
            name: 'Tools Prompt',
            description: `Purchase: ${prompt.title.substring(0, 40)}`,
            order_id: data.orderId,
            handler: async function(response) {
                // Focus the main window before executing handler
                window.focus();
                
                if (buyBtn) buyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying payment...';
                
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
                        showNotification('Payment successful! Prompt copied to clipboard.', 'success');
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
                    showNotification('Payment recorded but verification failed. Contact support.', 'error');
                } finally {
                    if (buyBtn) {
                        buyBtn.innerHTML = originalText;
                        buyBtn.disabled = false;
                    }
                }
            },
            modal: {
                ondismiss: function() {
                    showNotification('Payment cancelled', 'info');
                    if (buyBtn) {
                        buyBtn.innerHTML = originalText;
                        buyBtn.disabled = false;
                    }
                }
            },
            theme: {
                color: '#4e54c8'
            },
            prefill: {
                name: customerInfo?.name || user.displayName || user.email,
                email: user.email,
                contact: customerInfo?.phone || ''
            },
            notes: {
                promptId: prompt.id,
                userId: user.uid,
                promptTitle: prompt.title
            }
        };
        
        const razorpayInstance = new Razorpay(options);
        
        // Add event listener for focus on modal close
        razorpayInstance.on('payment.failed', function(response) {
            console.error('Payment failed:', response.error);
            showNotification('Payment failed: ' + (response.error.description || 'Please try again'), 'error');
            if (buyBtn) {
                buyBtn.innerHTML = originalText;
                buyBtn.disabled = false;
            }
        });
        
        razorpayInstance.open();
        
    } catch (error) {
        console.error('Payment error:', error);
        showNotification(error.message || 'Payment failed. Please try again.', 'error');
        if (buyBtn) {
            buyBtn.innerHTML = originalText;
            buyBtn.disabled = false;
        }
    }
}
// Show buy prompt modal with Razorpay
function showBuyPromptModal(prompt) {
    closeBuyModal();
    
    const modalHTML = `
        <div class="buy-modal-overlay" id="buyPromptModal">
            <div class="buy-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-shopping-cart"></i> Purchase Prompt</h2>
                    <button class="close-modal" onclick="closeBuyModal()">&times;</button>
                </div>
                <div class="buy-modal-content">
                    <div class="prompt-preview">
                        <img src="${escapeHtml(prompt.imageUrl)}" alt="${escapeHtml(prompt.title)}" class="buy-prompt-image">
                        <h3>${escapeHtml(prompt.title)}</h3>
                        <p class="prompt-price-large">₹${prompt.price}</p>
                        <p class="prompt-creator">By: ${escapeHtml(prompt.userName)}</p>
                    </div>
                    <div class="payment-form">
                        <h3>Customer Information</h3>
                        <div class="form-group">
                            <label for="customerName">Full Name *</label>
                            <input type="text" id="customerName" required placeholder="As per your ID">
                        </div>
                        <div class="form-group">
                            <label for="customerEmail">Email *</label>
                            <input type="email" id="customerEmail" required placeholder="your@email.com">
                        </div>
                        <div class="form-group">
                            <label for="customerPhone">Phone (Optional)</label>
                            <input type="tel" id="customerPhone" placeholder="Mobile number for payment confirmation">
                        </div>
                        
                        <h3>Billing Address</h3>
                        <div class="form-group">
                            <label for="addressLine1">Address Line 1 *</label>
                            <input type="text" id="addressLine1" required placeholder="Street address">
                        </div>
                        <div class="form-group">
                            <label for="addressLine2">Address Line 2 (Optional)</label>
                            <input type="text" id="addressLine2" placeholder="Apartment, suite, etc.">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="city">City *</label>
                                <input type="text" id="city" required>
                            </div>
                            <div class="form-group">
                                <label for="state">State/Province</label>
                                <input type="text" id="state" placeholder="Optional">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="postalCode">Postal Code *</label>
                                <input type="text" id="postalCode" required>
                            </div>
                            <div class="form-group">
                                <label for="country">Country *</label>
                                <select id="country" required>
                                    <option value="IN">India</option>
                                    <option value="US">United States</option>
                                    <option value="GB">United Kingdom</option>
                                    <option value="CA">Canada</option>
                                    <option value="AU">Australia</option>
                                    <option value="AE">UAE</option>
                                    <option value="SG">Singapore</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="payment-info" style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <p style="margin: 0; font-size: 0.9rem; color: #666;">
                                <i class="fas fa-shield-alt"></i> Secure payment powered by Razorpay
                            </p>
                            <p style="margin: 5px 0 0; font-size: 0.8rem; color: #888;">
                                Supports UPI, Credit/Debit Cards, Net Banking, and Wallets
                            </p>
                        </div>
                        
                        <button class="buy-now-btn" id="buyNowBtn">
                            <i class="fas fa-rupee-sign"></i> Pay ₹${prompt.price}
                        </button>
                        <p class="secure-payment"><i class="fas fa-lock"></i> Secure payment powered by Razorpay</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
    
    // Set up payment button
    setTimeout(() => {
        const buyBtn = document.getElementById('buyNowBtn');
        if (buyBtn) {
            buyBtn.addEventListener('click', async () => {
                const customerName = document.getElementById('customerName')?.value;
                const customerEmail = document.getElementById('customerEmail')?.value;
                const customerPhone = document.getElementById('customerPhone')?.value;
                const addressLine1 = document.getElementById('addressLine1')?.value;
                const addressLine2 = document.getElementById('addressLine2')?.value;
                const city = document.getElementById('city')?.value;
                const state = document.getElementById('state')?.value;
                const postalCode = document.getElementById('postalCode')?.value;
                const country = document.getElementById('country')?.value;
                
                if (!customerName || !customerEmail || !addressLine1 || !city || !postalCode || !country) {
                    showNotification('Please fill all required fields', 'error');
                    return;
                }
                
                const customerInfo = {
                    name: customerName,
                    email: customerEmail,
                    phone: customerPhone,
                    address: {
                        line1: addressLine1,
                        line2: addressLine2,
                        city: city,
                        state: state,
                        postal_code: postalCode,
                        country: country
                    }
                };
                
                await processPaymentWithRazorpay(prompt, customerInfo);
            });
        }
    }, 100);
}

function closeBuyModal() {
    const modal = document.getElementById('buyPromptModal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = '';
    }
}

// Initialize Firebase
async function initializeFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded');
    return false;
  }
  
  if (!firebaseInitialized && firebase.apps.length === 0) {
    try {
      firebase.initializeApp(firebaseConfig);
      firebaseInitialized = true;
      console.log('Firebase initialized successfully');
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }
  
  return firebaseInitialized;
}

// Get current user
async function getCurrentUser() {
  await initializeFirebase();
  
  return new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Authentication functions
function checkAuth() {
  return JSON.parse(localStorage.getItem('user'));
}

function showAuthElements() {
  const user = checkAuth();
  const authSection = document.getElementById('authSection');
  const uploadButton = document.getElementById('openUploadModal');
  const newsUploadButton = document.getElementById('openNewsModal');
  
  if (authSection) {
    if (user) {
      authSection.innerHTML = `
        <div class="user-profile">
          <img src="${user.avatar || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiM0ZTU0YzgiLz4KPGNpcmNsZSBjeD0iMTgiIGN5PSIxNCIgcj0iNSIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTI2IDI4QzI2IDI0LjY4NjMgMjIuNDE4MyAyMiAxOCAyMkMxMy41ODE3IDIyIDEwIDI0LjY4NjMgMTAgMjgiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo='}"  
               alt="${user.name || 'User'}" 
               class="user-avatar"
               onerror="this.src='https://via.placeholder.com/36x36/4e54c8/white?text=U'">
          <span>${user.name || 'User'}</span>
          <button class="logout-btn" title="Logout"><i class="fas fa-sign-out-alt"></i></button>
        </div>
      `;
      
      const logoutBtn = authSection.querySelector('.logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            await firebase.auth().signOut();
            localStorage.removeItem('user');
            window.location.reload();
          } catch (error) {
            console.error('Logout error:', error);
            localStorage.removeItem('user');
            window.location.reload();
          }
        });
      }
    } else {
      authSection.innerHTML = `
        <a href="login.html" class="login-btn">Login / Register</a>
      `;
    }
  }
  
  if (uploadButton) {
    uploadButton.style.display = user ? 'flex' : 'none';
  }
  
  if (newsUploadButton) {
    newsUploadButton.style.display = user ? 'flex' : 'none';
  }
}

// Add dashboard button
function addDashboardButton() {
  const user = checkAuth();
  if (!user) return;
  
  if (!document.querySelector('.view-dashboard-btn')) {
    const dashboardBtn = document.createElement('button');
    dashboardBtn.className = 'view-dashboard-btn';
    dashboardBtn.innerHTML = '<i class="fas fa-chart-line"></i> My Dashboard';
    dashboardBtn.onclick = () => {
      window.location.href = '/dashboard.html';
    };
    document.body.appendChild(dashboardBtn);
  }
}

// Check if user has purchased a prompt
async function hasPurchasedPrompt(promptId) {
    const user = await getCurrentUser();
    if (!user) return false;
    
    try {
        const response = await fetch(`/api/check-purchase/${promptId}?userId=${user.uid}`);
        const data = await response.json();
        return data.purchased;
    } catch (error) {
        console.error('Error checking purchase:', error);
        return false;
    }
}

// Complete purchase after payment
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
            showNotification('Purchase successful! Prompt copied to clipboard.', 'success');
            await navigator.clipboard.writeText(prompt.promptText);
            closeBuyModal();
            
            if (window.location.pathname.includes('dashboard.html')) {
                location.reload();
            }
        } else {
            throw new Error(data.error || 'Purchase completion failed');
        }
    } catch (error) {
        console.error('Purchase completion error:', error);
        showNotification('Purchase recorded but prompt copy failed. Check your dashboard.', 'error');
    }
}

// Enhanced copy function with purchase check
async function handlePromptCopy(prompt, button) {
    const user = await getCurrentUser();
    
    if (prompt.price && prompt.price > 0) {
        const purchased = await hasPurchasedPrompt(prompt.id);
        
        if (purchased) {
            await copyPromptText(prompt.promptText, button);
            trackCopyAction(prompt.id);
            showNotification('Prompt copied to clipboard!', 'success');
        } else {
            showBuyPromptModal(prompt);
        }
    } else {
        await copyPromptText(prompt.promptText, button);
        trackCopyAction(prompt.id);
        showNotification('Prompt copied to clipboard!', 'success');
    }
}

// Copy prompt text with visual feedback
async function copyPromptText(text, button) {
    await navigator.clipboard.writeText(text);
    
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied!';
    button.style.background = '#20bf6b';
    button.style.color = 'white';
    
    setTimeout(() => {
        button.innerHTML = originalHTML;
        button.style.background = '';
        button.style.color = '';
    }, 2000);
}

// Track copy action for analytics
function trackCopyAction(promptId) {
    fetch(`/api/prompt/${promptId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }).catch(err => console.log('Copy tracking error:', err));
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification-toast ${type}`;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#20bf6b' : type === 'error' ? '#ff6b6b' : '#4e54c8'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10001;
        animation: slideInRight 0.3s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== SEARCH FUNCTIONALITY ====================

function initSearchFunctionality() {
    const searchIconButton = document.getElementById('searchIconButton');
    const searchExpandable = document.getElementById('searchExpandable');
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchSuggestions = document.getElementById('searchSuggestions');

    if (searchIconButton && searchExpandable) {
        searchIconButton.addEventListener('click', function(e) {
            e.stopPropagation();
            const isActive = searchExpandable.classList.contains('active');
            
            if (isActive) {
                searchExpandable.style.transform = 'translateY(-10px)';
                searchExpandable.style.opacity = '0';
                setTimeout(() => {
                    searchExpandable.classList.remove('active');
                }, 200);
            } else {
                searchExpandable.classList.add('active');
                setTimeout(() => {
                    searchExpandable.style.transform = 'translateY(5px)';
                    searchExpandable.style.opacity = '1';
                }, 10);
                
                setTimeout(() => {
                    if (searchInput) {
                        searchInput.focus();
                    }
                }, 150);
            }
        });
    }

    if (searchInput) {
        let inputTimeout;
        searchInput.addEventListener('input', function(e) {
            clearTimeout(inputTimeout);
            inputTimeout = setTimeout(() => {
                const query = e.target.value.trim();
                if (query.length > 0) {
                    showSearchSuggestions(query);
                } else {
                    showRecentSearches();
                }
            }, 150);
        });

        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeSearch();
            }
        });

        searchInput.addEventListener('focus', function() {
            if (this.value.trim() === '') {
                showRecentSearches();
            }
        });
    }

    if (searchButton) {
        searchButton.addEventListener('click', function(e) {
            e.preventDefault();
            performSearch(searchInput.value);
        });
    }

    document.addEventListener('click', function(e) {
        if (searchExpandable && searchIconButton && 
            !searchExpandable.contains(e.target) && 
            !searchIconButton.contains(e.target)) {
            closeSearch();
        }
    });
}

function performSearch(query) {
    if (!query || !query.trim()) {
        showNotification('Please enter a search term', 'error');
        return;
    }

    const searchExpandable = document.getElementById('searchExpandable');
    const searchInput = document.getElementById('searchInput');

    if (searchExpandable) {
        searchExpandable.style.transform = 'translateY(-10px)';
        searchExpandable.style.opacity = '0';
        setTimeout(() => {
            searchExpandable.classList.remove('active');
            searchExpandable.style.transform = '';
            searchExpandable.style.opacity = '';
        }, 200);
    }

    addToRecentSearches(query);
    showNotification(`Searching for: "${query}"`, 'info');

    requestAnimationFrame(() => {
        if (window.searchManager) {
            searchManager.currentSearchTerm = query;
            searchManager.showSearchResults();
        } else if (window.youtubePrompts) {
            const filteredPrompts = allPrompts.filter(prompt => {
                const searchLower = query.toLowerCase();
                const title = (prompt.title || '').toLowerCase();
                const promptText = (prompt.promptText || '').toLowerCase();
                const keywords = prompt.keywords || [];
                
                return (
                    title.includes(searchLower) ||
                    promptText.includes(searchLower) ||
                    keywords.some(keyword => 
                        keyword.toLowerCase().includes(searchLower)
                    )
                );
            });

            if (filteredPrompts.length > 0) {
                youtubePrompts.displayFilteredPrompts(filteredPrompts);
                showNotification(`Found ${filteredPrompts.length} results for "${query}"`, 'success');
            } else {
                showNotification(`No results found for "${query}"`, 'error');
                youtubePrompts.showNoResults();
            }
        }
    });

    if (searchInput) {
        searchInput.value = '';
    }
    hideSearchSuggestions();

    setTimeout(() => {
        if (searchInput) searchInput.blur();
    }, 300);
}

function showSearchSuggestions(query) {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;

    searchSuggestions.innerHTML = `
        <div class="suggestion-item">
            <i class="fas fa-spinner fa-spin suggestion-icon"></i>
            <span>Searching...</span>
        </div>
    `;
    searchSuggestions.style.display = 'block';

    setTimeout(() => {
        const mockSuggestions = [
            { text: `${query} art`, category: 'art', icon: 'fas fa-palette' },
            { text: `${query} photography`, category: 'photography', icon: 'fas fa-camera' },
            { text: `${query} design`, category: 'design', icon: 'fas fa-pencil-ruler' },
            { text: `${query} video`, category: 'video', icon: 'fas fa-video' }
        ];

        const suggestionsHTML = mockSuggestions.map(suggestion => `
            <div class="suggestion-item" 
                 data-query="${suggestion.text}"
                 tabindex="0"
                 role="button">
                <i class="${suggestion.icon} suggestion-icon"></i>
                <div class="suggestion-text">${suggestion.text}</div>
                <span class="suggestion-category">${suggestion.category}</span>
            </div>
        `).join('');

        searchSuggestions.innerHTML = suggestionsHTML;
        
        searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', function() {
                handleSuggestionClick(this.getAttribute('data-query'));
            });
        });
    }, 200);
}

function handleSuggestionClick(query) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = query;
    }
    performSearch(query);
}

function showRecentSearches() {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;

    const recentSearches = getRecentSearches();
    
    if (recentSearches.length === 0) {
        searchSuggestions.innerHTML = `
            <div class="suggestion-item">
                <i class="fas fa-clock suggestion-icon"></i>
                <span>No recent searches</span>
            </div>
        `;
    } else {
        const recentHTML = recentSearches.map(search => `
            <div class="suggestion-item" 
                 data-query="${search}"
                 tabindex="0"
                 role="button">
                <i class="fas fa-history suggestion-icon"></i>
                <div class="suggestion-text">${search}</div>
                <span class="suggestion-category">recent</span>
            </div>
        `).join('');

        searchSuggestions.innerHTML = `
            <div class="suggestion-item" style="font-weight: 600; color: #666; pointer-events: none;">
                <i class="fas fa-clock suggestion-icon"></i>
                <span>Recent searches</span>
            </div>
            ${recentHTML}
            <div class="suggestion-item" id="clearRecentSearches" style="border-top: 1px solid #eee; margin-top: 5px;">
                <i class="fas fa-trash suggestion-icon" style="color: #ff6b6b;"></i>
                <span style="color: #ff6b6b;">Clear recent searches</span>
            </div>
        `;

        searchSuggestions.querySelectorAll('.suggestion-item:not(:first-child):not(:last-child)').forEach(item => {
            item.addEventListener('click', () => handleSuggestionClick(item.getAttribute('data-query')));
        });

        const clearBtn = document.getElementById('clearRecentSearches');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearRecentSearches);
        }
    }

    searchSuggestions.style.display = 'block';
}

function closeSearch() {
    const searchExpandable = document.getElementById('searchExpandable');
    const searchInput = document.getElementById('searchInput');
    
    if (searchExpandable) {
        searchExpandable.style.transform = 'translateY(-10px)';
        searchExpandable.style.opacity = '0';
        setTimeout(() => {
            searchExpandable.classList.remove('active');
            searchExpandable.style.transform = '';
            searchExpandable.style.opacity = '';
        }, 200);
    }
    
    hideSearchSuggestions();
    if (searchInput) {
        searchInput.blur();
    }
}

function clearRecentSearches() {
    localStorage.removeItem('recentSearches');
    showRecentSearches();
    showNotification('Recent searches cleared', 'success');
}

function getRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem('recentSearches') || '[]');
    } catch (error) {
        console.error('Error getting recent searches:', error);
        return [];
    }
}

function addToRecentSearches(query) {
    try {
        let recent = getRecentSearches();
        recent = recent.filter(item => item !== query);
        recent.unshift(query);
        recent = recent.slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(recent));
    } catch (error) {
        console.error('Error adding to recent searches:', error);
    }
}

function hideSearchSuggestions() {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (searchSuggestions) {
        searchSuggestions.style.display = 'none';
    }
}

// ==================== HORIZONTAL FEED MANAGER ====================

class HorizontalFeedManager {
    constructor() {
        this.feeds = new Map();
        this.init();
    }

    init() {
        this.setupHorizontalFeeds();
        this.setupEventListeners();
    }

    setupHorizontalFeeds() {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                this.initializeAllFeeds();
            }, 1000);
        });
    }

    initializeAllFeeds() {
        const feedSections = document.querySelectorAll('.horizontal-feed-section');
        
        feedSections.forEach((section, index) => {
            const track = section.querySelector('.horizontal-feed-track');
            const controls = section.querySelector('.horizontal-controls');
            
            if (track && !this.feeds.has(track)) {
                this.initializeFeed(track, controls, `feed-${index}`);
            }
        });
    }

    initializeFeed(track, controls, feedId) {
        this.feeds.set(track, {
            id: feedId,
            controls: controls,
            isDragging: false,
            startX: 0,
            scrollLeft: 0
        });

        this.setupFeedControls(track, controls);
        this.setupTouchScrolling(track);
        this.setupMouseScrolling(track);
        this.setupKeyboardNavigation(track);
        this.updateFeedControls(track, controls);
    }

    setupFeedControls(track, controls) {
        const prevBtn = controls?.querySelector('.prev-horizontal');
        const nextBtn = controls?.querySelector('.next-horizontal');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.scrollFeed(track, -1));
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.scrollFeed(track, 1));
        }

        track.addEventListener('scroll', () => {
            this.updateFeedControls(track, controls);
        });
    }

    setupTouchScrolling(track) {
        const feedData = this.feeds.get(track);
        if (!feedData) return;

        track.addEventListener('touchstart', (e) => {
            feedData.isDragging = true;
            feedData.startX = e.touches[0].pageX;
            feedData.scrollLeft = track.scrollLeft;
            track.style.cursor = 'grabbing';
            track.style.scrollSnapType = 'none';
        }, { passive: true });

        track.addEventListener('touchmove', (e) => {
            if (!feedData.isDragging) return;
            
            e.preventDefault();
            const x = e.touches[0].pageX;
            const walk = (x - feedData.startX) * 2;
            track.scrollLeft = feedData.scrollLeft - walk;
        }, { passive: false });

        track.addEventListener('touchend', () => {
            feedData.isDragging = false;
            track.style.cursor = 'grab';
            
            if (window.innerWidth <= 768) {
                track.style.scrollSnapType = 'x mandatory';
                this.snapToNearestItem(track);
            }
        });
    }

    setupMouseScrolling(track) {
        const feedData = this.feeds.get(track);
        if (!feedData) return;

        track.addEventListener('mousedown', (e) => {
            feedData.isDragging = true;
            feedData.startX = e.pageX;
            feedData.scrollLeft = track.scrollLeft;
            track.style.cursor = 'grabbing';
            e.preventDefault();
        });

        track.addEventListener('mousemove', (e) => {
            if (!feedData.isDragging) return;
            
            const x = e.pageX;
            const walk = (x - feedData.startX) * 2;
            track.scrollLeft = feedData.scrollLeft - walk;
        });

        track.addEventListener('mouseup', () => {
            feedData.isDragging = false;
            track.style.cursor = 'grab';
        });
    }

    setupKeyboardNavigation(track) {
        track.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.scrollFeed(track, -1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.scrollFeed(track, 1);
            }
        });
    }

    scrollFeed(track, direction) {
        const itemWidth = this.getItemWidth(track);
        const gap = this.getGapSize(track);
        const scrollAmount = (itemWidth + gap) * direction;

        track.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
    }

    getItemWidth(track) {
        const item = track.querySelector('.horizontal-prompt-item');
        if (!item) return 200;
        const style = window.getComputedStyle(item);
        return parseInt(style.width) || 200;
    }

    getGapSize(track) {
        const style = window.getComputedStyle(track);
        const gap = style.gap || style.columnGap;
        return parseInt(gap) || 15;
    }

    snapToNearestItem(track) {
        const scrollLeft = track.scrollLeft;
        const itemWidth = this.getItemWidth(track);
        const gap = this.getGapSize(track);
        const totalItemWidth = itemWidth + gap;
        
        const nearestIndex = Math.round(scrollLeft / totalItemWidth);
        const targetScroll = Math.max(0, nearestIndex * totalItemWidth);
        
        track.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });
    }

    updateFeedControls(track, controls) {
        if (!controls) return;
        
        const prevBtn = controls.querySelector('.prev-horizontal');
        const nextBtn = controls.querySelector('.next-horizontal');
        
        if (!prevBtn || !nextBtn) return;
        
        const scrollLeft = track.scrollLeft;
        const scrollWidth = track.scrollWidth;
        const clientWidth = track.clientWidth;
        
        prevBtn.disabled = scrollLeft <= 10;
        prevBtn.style.opacity = scrollLeft <= 10 ? '0.5' : '1';
        
        nextBtn.disabled = scrollLeft >= scrollWidth - clientWidth - 10;
        nextBtn.style.opacity = scrollLeft >= scrollWidth - clientWidth - 10 ? '0.5' : '1';
    }

    setupEventListeners() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.classList?.contains('horizontal-feed-section')) {
                            setTimeout(() => {
                                this.initializeAllFeeds();
                            }, 100);
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        window.addEventListener('resize', () => {
            this.feeds.forEach((feedData, track) => {
                if (feedData.controls) {
                    this.updateFeedControls(track, feedData.controls);
                }
            });
        });
    }

    addFeed(track, controls, feedId) {
        this.initializeFeed(track, controls, feedId);
    }
}

window.horizontalFeedManager = new HorizontalFeedManager();

function scrollHorizontalFeed(button, direction) {
    const controls = button.closest('.horizontal-controls');
    const feedSection = controls.closest('.horizontal-feed-section');
    const track = feedSection.querySelector('.horizontal-feed-track');
    
    if (track && window.horizontalFeedManager) {
        window.horizontalFeedManager.scrollFeed(track, direction);
    }
}

function initHorizontalFeedTouchSupport() {
    document.addEventListener('DOMContentLoaded', function() {
        document.addEventListener('click', function(e) {
            const horizontalItem = e.target.closest('.horizontal-prompt-item');
            if (horizontalItem) {
                const promptId = horizontalItem.dataset.promptId;
                if (promptId) {
                    const isVideo = horizontalItem.classList.contains('video-item');
                    if (isVideo) {
                        openShortsPlayer(promptId);
                    } else {
                        openPromptPage(promptId);
                    }
                }
            }
        });
    });
}

// ==================== VIDEO HOVER AUTOPLAY MANAGER ====================

class VideoHoverManager {
    constructor() {
        this.hoverVideos = new Map();
        this.currentHoverItem = null;
        this.hoverTimeout = null;
        this.mobileTouchTimeout = null;
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.init();
    }

    init() {
        this.setupHoverListeners();
        this.setupVisibilityHandler();
        console.log('Video Hover Manager initialized');
    }

    setupHoverListeners() {
        document.addEventListener('mouseover', this.handleMouseOver.bind(this));
        document.addEventListener('mouseout', this.handleMouseOut.bind(this));
        
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });
        document.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: true });
        
        window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
        
        document.addEventListener('focusin', this.handleFocusIn.bind(this));
        document.addEventListener('focusout', this.handleFocusOut.bind(this));
    }

    handleMouseOver(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
        }

        this.hoverTimeout = setTimeout(() => {
            this.playHoverVideo(videoItem);
        }, hoverConfig.delay);
    }

    handleMouseOut(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }

        setTimeout(() => {
            const relatedTarget = e.relatedTarget;
            const stillInItem = relatedTarget && videoItem.contains(relatedTarget);
            
            if (!stillInItem) {
                this.pauseHoverVideo(videoItem);
            }
        }, 50);
    }

    handleTouchStart(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        document.querySelectorAll('.shorts-prompt-card.touch-active, .horizontal-prompt-item.touch-active').forEach(item => {
            if (item !== videoItem) {
                item.classList.remove('touch-active');
                this.pauseHoverVideo(item);
            }
        });

        if (this.mobileTouchTimeout) {
            clearTimeout(this.mobileTouchTimeout);
        }

        videoItem.classList.add('touch-active');
        this.playHoverVideo(videoItem);
        e.preventDefault();
    }

    handleTouchEnd(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        this.mobileTouchTimeout = setTimeout(() => {
            videoItem.classList.remove('touch-active');
            this.pauseHoverVideo(videoItem);
        }, 2000);
    }

    handleTouchCancel(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        videoItem.classList.remove('touch-active');
        this.pauseHoverVideo(videoItem);
        
        if (this.mobileTouchTimeout) {
            clearTimeout(this.mobileTouchTimeout);
        }
    }

    handleFocusIn(e) {
        if (!hoverConfig.playOnFocus) return;
        
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;
        
        this.playHoverVideo(videoItem);
    }

    handleFocusOut(e) {
        if (!hoverConfig.playOnFocus) return;
        
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;
        
        this.pauseHoverVideo(videoItem);
    }

    handleScroll() {
        if (!hoverConfig.pauseOnScroll) return;
        
        this.hoverVideos.forEach((data, element) => {
            if (data.isPlaying) {
                this.pauseHoverVideo(element);
            }
        });
    }

    setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.hoverVideos.forEach((data, element) => {
                    if (data.isPlaying) {
                        this.pauseHoverVideo(element);
                    }
                });
            }
        });
    }

    findVideoItem(element) {
        return element.closest('.shorts-prompt-card[data-file-type="video"], .horizontal-prompt-item.video-item');
    }

    playHoverVideo(item) {
        if (!item || !hoverConfig.enabled) return;

        const videoContainer = item.querySelector('.hover-video-container');
        const videoPlayer = item.querySelector('.hover-video-player');
        
        if (!videoPlayer || !videoContainer) return;

        const existingData = this.hoverVideos.get(item);
        if (existingData && existingData.isPlaying) return;

        const loading = item.querySelector('.hover-video-loading');
        if (loading) loading.style.display = 'block';

        if (!videoPlayer.src) {
            const promptId = item.dataset.promptId;
            const prompt = allPrompts.find(p => p.id === promptId);
            
            if (prompt && (prompt.videoUrl || prompt.mediaUrl)) {
                videoPlayer.src = prompt.videoUrl || prompt.mediaUrl;
                videoPlayer.load();
            }
        }

        videoPlayer.muted = true;

        const playPromise = videoPlayer.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    if (loading) loading.style.display = 'none';
                    
                    this.hoverVideos.set(item, {
                        isPlaying: true,
                        player: videoPlayer,
                        container: videoContainer
                    });
                    
                    item.classList.add('hover-active');
                    
                    const thumbnail = item.querySelector('.shorts-image, .horizontal-prompt-image img');
                    if (thumbnail) {
                        thumbnail.style.opacity = hoverConfig.thumbnailOpacity.toString();
                    }
                    
                    if (!item.dataset.viewTracked) {
                        const promptId = item.dataset.promptId;
                        this.trackView(promptId);
                        item.dataset.viewTracked = 'true';
                        
                        setTimeout(() => {
                            delete item.dataset.viewTracked;
                        }, 30000);
                    }
                })
                .catch(error => {
                    console.log('Hover autoplay prevented:', error);
                    if (loading) loading.style.display = 'none';
                });
        }
    }

    pauseHoverVideo(item) {
        if (!item) return;

        const videoPlayer = item.querySelector('.hover-video-player');
        const data = this.hoverVideos.get(item);
        const thumbnail = item.querySelector('.shorts-image, .horizontal-prompt-image img');
        
        if (videoPlayer && data && data.isPlaying) {
            videoPlayer.pause();
            videoPlayer.currentTime = 0;
            
            this.hoverVideos.set(item, {
                ...data,
                isPlaying: false
            });
            
            item.classList.remove('hover-active');
            
            if (thumbnail) {
                thumbnail.style.opacity = '1';
            }
        }
    }

    trackView(promptId) {
        if (!promptId) return;
        
        fetch(`/api/prompt/${promptId}/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.log('Hover view tracking error:', err));
    }

    createHoverVideoElement(prompt) {
        if (!prompt || !(prompt.videoUrl || prompt.mediaUrl)) return null;

        const videoContainer = document.createElement('div');
        videoContainer.className = 'hover-video-container';
        
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'hover-video-loading';
        loadingDiv.innerHTML = '<div class="spinner-small"></div>';
        
        const video = document.createElement('video');
        video.className = 'hover-video-player';
        video.muted = hoverConfig.muteByDefault;
        video.loop = hoverConfig.loop;
        video.playsInline = true;
        video.preload = hoverConfig.preload;
        video.src = prompt.videoUrl || prompt.mediaUrl;
        
        const indicator = document.createElement('div');
        indicator.className = 'hover-video-indicator';
        indicator.innerHTML = '<i class="fas fa-play"></i> Preview';
        
        const muteBtn = document.createElement('button');
        muteBtn.className = 'hover-video-mute';
        muteBtn.innerHTML = hoverConfig.muteByDefault ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            video.muted = !video.muted;
            muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
        });
        
        const pausedIndicator = document.createElement('div');
        pausedIndicator.className = 'hover-video-paused';
        pausedIndicator.innerHTML = '<i class="fas fa-pause"></i>';
        
        videoContainer.appendChild(loadingDiv);
        videoContainer.appendChild(video);
        videoContainer.appendChild(indicator);
        videoContainer.appendChild(muteBtn);
        videoContainer.appendChild(pausedIndicator);
        
        video.addEventListener('loadedmetadata', () => {
            loadingDiv.style.display = 'none';
        });
        
        video.addEventListener('waiting', () => {
            loadingDiv.style.display = 'block';
        });
        
        video.addEventListener('canplay', () => {
            loadingDiv.style.display = 'none';
        });
        
        video.addEventListener('play', () => {
            pausedIndicator.classList.remove('show');
        });
        
        video.addEventListener('pause', () => {
            pausedIndicator.classList.add('show');
            setTimeout(() => {
                pausedIndicator.classList.remove('show');
            }, 1000);
        });
        
        return videoContainer;
    }

    cleanup() {
        this.hoverVideos.forEach((data, item) => {
            if (data.player) {
                data.player.pause();
                data.player.src = '';
            }
        });
        this.hoverVideos.clear();
    }
}

window.videoHoverManager = new VideoHoverManager();

window.updateHoverConfig = function(newConfig) {
    Object.assign(hoverConfig, newConfig);
    console.log('Hover config updated:', hoverConfig);
};

// ==================== YOUTUBE SHORTS HORIZONTAL FEED ====================

class ShortsHorizontalFeed {
    constructor() {
        this.currentPosition = 0;
        this.track = null;
        this.items = [];
        this.isLoading = false;
        this.hasMore = true;
        this.last24hPrompts = [];
        this.init();
    }

    init() {
        this.createShortsFeed();
        this.setupEventListeners();
        this.loadLatestPrompts();
    }

    createShortsFeed() {
        const feedHTML = `
            <section class="shorts-horizontal-feed" id="shortsHorizontalFeed">
                <div class="container">
                    <div class="shorts-feed-header">
                        <h3>Latest Prompt <span class="new-badge">Seen</span></h3>
                        <div class="shorts-controls">
                            <button class="shorts-control-btn" id="shortsPrevBtn">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <button class="shorts-control-btn" id="shortsNextBtn">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>
                    <div class="shorts-track-container">
                        <div class="shorts-track" id="shortsTrack">
                            <div class="shorts-loading">
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                                <div class="shorts-skeleton"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;

        const header = document.getElementById('mainHeader');
        if (header) {
            header.insertAdjacentHTML('afterend', feedHTML);
        }
        
        this.track = document.getElementById('shortsTrack');
    }

    setupEventListeners() {
        const prevBtn = document.getElementById('shortsPrevBtn');
        const nextBtn = document.getElementById('shortsNextBtn');
        const trackContainer = document.querySelector('.shorts-track-container');

        if (prevBtn && nextBtn) {
            prevBtn.addEventListener('click', () => this.scrollShorts(-1));
            nextBtn.addEventListener('click', () => this.scrollShorts(1));
        }

        if (trackContainer) {
            let startX = 0;
            let startY = 0;
            let scrollLeft = 0;
            let isScrolling = false;

            trackContainer.addEventListener('touchstart', (e) => {
                startX = e.touches[0].pageX;
                startY = e.touches[0].pageY;
                scrollLeft = trackContainer.scrollLeft;
                isScrolling = true;
                trackContainer.style.cursor = 'grabbing';
            }, { passive: true });

            trackContainer.addEventListener('touchmove', (e) => {
                if (!isScrolling) return;
                
                const x = e.touches[0].pageX;
                const y = e.touches[0].pageY;
                const walkX = x - startX;
                const walkY = y - startY;
                
                if (Math.abs(walkX) > Math.abs(walkY)) {
                    e.preventDefault();
                }
                
                trackContainer.scrollLeft = scrollLeft - walkX;
            }, { passive: false });

            trackContainer.addEventListener('touchend', () => {
                isScrolling = false;
                trackContainer.style.cursor = 'grab';
                
                if (window.innerWidth <= 768) {
                    this.snapToNearestItem();
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.scrollShorts(-1);
            if (e.key === 'ArrowRight') this.scrollShorts(1);
        });

        this.setupInfiniteScroll();
        
        if (window.innerWidth > 768) {
            const trackContainer = document.querySelector('.shorts-track-container');
            if (trackContainer) {
                trackContainer.style.cursor = 'grab';
                
                trackContainer.addEventListener('mousedown', (e) => {
                    trackContainer.style.cursor = 'grabbing';
                    let startX = e.pageX;
                    let scrollLeft = trackContainer.scrollLeft;
                    
                    const mouseMoveHandler = (e) => {
                        const x = e.pageX;
                        const walk = (x - startX) * 2;
                        trackContainer.scrollLeft = scrollLeft - walk;
                    };
                    
                    const mouseUpHandler = () => {
                        document.removeEventListener('mousemove', mouseMoveHandler);
                        document.removeEventListener('mouseup', mouseUpHandler);
                        trackContainer.style.cursor = 'grab';
                    };
                    
                    document.addEventListener('mousemove', mouseMoveHandler);
                    document.addEventListener('mouseup', mouseUpHandler);
                });
            }
        }
    }

    snapToNearestItem() {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (!trackContainer) return;
        
        const scrollLeft = trackContainer.scrollLeft;
        const itemWidth = 110;
        const gap = 12;
        const totalItemWidth = itemWidth + gap;
        
        const nearestIndex = Math.round(scrollLeft / totalItemWidth);
        const targetScroll = nearestIndex * totalItemWidth;
        
        trackContainer.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });
    }

    scrollShorts(direction) {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (!trackContainer) return;

        const itemWidth = window.innerWidth <= 768 ? 110 : 132;
        const gap = 12;
        const totalItemWidth = itemWidth + gap;
        
        if (window.innerWidth <= 768) {
            const scrollAmount = totalItemWidth * direction;
            trackContainer.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            });
            
            setTimeout(() => this.updateNavigation(), 300);
        } else {
            const visibleItems = Math.floor(trackContainer.offsetWidth / totalItemWidth);
            const scrollAmount = totalItemWidth * visibleItems * direction;

            trackContainer.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            });

            this.updateNavigation();
        }
    }

    async loadLatestPrompts() {
        try {
            this.isLoading = true;
            
            const loadingPromise = new Promise(resolve => setTimeout(resolve, 500));
            
            await this.loadAllPrompts();
            
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            this.last24hPrompts = allPrompts.filter(prompt => {
                if (!prompt || !prompt.createdAt) return false;
                
                try {
                    let promptDate;
                    if (typeof prompt.createdAt === 'string') {
                        promptDate = new Date(prompt.createdAt);
                    } else if (prompt.createdAt.toDate && typeof prompt.createdAt.toDate === 'function') {
                        promptDate = prompt.createdAt.toDate();
                    } else {
                        promptDate = new Date();
                    }
                    
                    return promptDate > twentyFourHoursAgo;
                } catch (error) {
                    console.error('Error parsing date for prompt:', prompt.id, error);
                    return false;
                }
            }).sort((a, b) => {
                try {
                    const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
                    const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
                    return dateB - dateA;
                } catch (error) {
                    return 0;
                }
            });

            await loadingPromise;

            this.displayShorts();
            
        } catch (error) {
            console.error('Error loading latest prompts:', error);
            this.last24hPrompts = [];
            this.displayShorts();
        } finally {
            this.isLoading = false;
        }
    }

    async loadAllPrompts() {
        const now = Date.now();
        if (now - lastPromptUpdate < PROMPT_CACHE_DURATION && allPrompts.length > 0) {
            return allPrompts;
        }

        try {
            const user = await getCurrentUser();
            const userId = user?.uid || null;
            const params = new URLSearchParams({
                page: '1',
                limit: '1000',
                ...(userId && { userId })
            });
            
            const response = await fetch(`/api/uploads?${params}`);
            if (response.ok) {
                const data = await response.json();
                
                allPrompts = (data.uploads || []).map(prompt => ({
                    id: prompt.id || `unknown-${Date.now()}-${Math.random()}`,
                    title: prompt.title || 'Untitled Prompt',
                    promptText: prompt.promptText || 'No prompt text available.',
                    imageUrl: prompt.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=AI+Image',
                    videoUrl: prompt.videoUrl || null,
                    mediaUrl: prompt.mediaUrl || prompt.imageUrl,
                    thumbnailUrl: prompt.thumbnailUrl || null,
                    fileType: prompt.fileType || 'image',
                    videoDuration: prompt.videoDuration || null,
                    userName: prompt.userName || 'Anonymous',
                    likes: parseInt(prompt.likes) || 0,
                    views: parseInt(prompt.views) || 0,
                    uses: parseInt(prompt.uses) || 0,
                    commentCount: parseInt(prompt.commentCount) || 0,
                    keywords: Array.isArray(prompt.keywords) ? prompt.keywords : ['AI', 'prompt'],
                    category: prompt.category || 'general',
                    hasCustomThumbnail: prompt.hasCustomThumbnail || false,
                    createdAt: prompt.createdAt || new Date().toISOString(),
                    updatedAt: prompt.updatedAt || new Date().toISOString(),
                    price: prompt.price || 0,
                    isPaid: prompt.price > 0,
                    salesCount: prompt.salesCount || 0,
                    totalEarnings: prompt.totalEarnings || 0,
                    purchasedBy: prompt.purchasedBy || []
                }));
                
                lastPromptUpdate = now;
                console.log(`Loaded ${allPrompts.length} prompts for feeds`);
            } else {
                throw new Error('Failed to fetch prompts');
            }
        } catch (error) {
            console.error('Error loading prompts for feeds:', error);
            if (allPrompts.length === 0) {
                allPrompts = [];
            }
        }
        
        return allPrompts;
    }

    displayShorts() {
        if (!this.track) return;

        if (this.last24hPrompts.length === 0) {
            this.track.innerHTML = `
                <div class="no-prompts" style="text-align: center; padding: 40px; color: #666; width: 100%;">
                    <i class="fas fa-clock" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5;"></i>
                    <p>No recent prompts in the last 24 hours</p>
                    <p style="font-size: 0.9rem; margin-top: 5px;">Upload a prompt to see it here!</p>
                </div>
            `;
            return;
        }

        this.track.innerHTML = '';
        
        this.last24hPrompts.forEach(prompt => {
            const item = this.createShortItem(prompt);
            this.track.appendChild(item);
        });

        this.updateNavigation();
    }

    createShortItem(prompt) {
        const safePrompt = prompt || {};
        const promptId = safePrompt.id || 'unknown';
        const title = safePrompt.title || 'Untitled Prompt';
        const imageUrl = safePrompt.thumbnailUrl || safePrompt.imageUrl || 'https://via.placeholder.com/120x160/4e54c8/white?text=Prompt';
        const views = safePrompt.views || 0;
        const createdAt = safePrompt.createdAt || new Date().toISOString();
        const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl;
        const price = safePrompt.price || 0;
        const isPaid = price > 0;
        
        const timeAgo = this.getTimeAgo(createdAt);
        const isNew = this.isWithinLastHour(createdAt);

        const item = document.createElement('div');
        item.className = `shorts-item ${isVideo ? 'video-item' : ''}`;
        item.setAttribute('data-prompt-id', promptId);
        item.setAttribute('data-file-type', isVideo ? 'video' : 'image');

        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'shorts-thumbnail';
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = title;
        img.loading = 'lazy';
        img.onerror = function() { this.src = 'https://via.placeholder.com/120x160/4e54c8/white?text=Prompt'; };
        thumbnailDiv.appendChild(img);
        
        const priceBadge = document.createElement('div');
        priceBadge.className = `price-badge ${!isPaid ? 'free' : ''}`;
        priceBadge.innerHTML = isPaid ? `<i class="fas fa-rupee-sign"></i> ${price}` : '<i class="fas fa-gift"></i> Free';
        thumbnailDiv.appendChild(priceBadge);
        
        if (isVideo) {
            const badge = document.createElement('div');
            badge.className = 'video-reel-badge';
            badge.innerHTML = '<i class="fas fa-play"></i> Reel';
            thumbnailDiv.appendChild(badge);
            
            const hoverVideoContainer = window.videoHoverManager?.createHoverVideoElement(safePrompt);
            if (hoverVideoContainer) {
                thumbnailDiv.appendChild(hoverVideoContainer);
            }
        }
        
        if (isNew) {
            const newIndicator = document.createElement('div');
            newIndicator.className = 'shorts-new-indicator';
            thumbnailDiv.appendChild(newIndicator);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'shorts-info';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'shorts-title';
        titleDiv.textContent = title;
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'shorts-meta';
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'shorts-time';
        timeSpan.textContent = isVideo ? 'Watch Reel' : 'View Prompt';
        
        metaDiv.appendChild(timeSpan);
        
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(metaDiv);
        
        item.appendChild(thumbnailDiv);
        item.appendChild(infoDiv);

        item.addEventListener('click', () => {
            if (isVideo) {
                this.openShortsPlayer(promptId);
            } else {
                this.openPromptPage(promptId);
            }
        });

        return item;
    }

    getTimeAgo(dateString) {
        if (!dateString) return 'Unknown';
        
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
            
            if (diffInHours < 1) return 'Now';
            if (diffInHours < 24) return `${diffInHours}h`;
            
            const diffInDays = Math.floor(diffInHours / 24);
            return `${diffInDays}d`;
        } catch (error) {
            console.error('Error calculating time ago:', error);
            return 'Unknown';
        }
    }

    isWithinLastHour(dateString) {
        if (!dateString) return false;
        
        try {
            const date = new Date(dateString);
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            return date > oneHourAgo;
        } catch (error) {
            console.error('Error checking if within last hour:', error);
            return false;
        }
    }

    updateNavigation() {
        const prevBtn = document.getElementById('shortsPrevBtn');
        const nextBtn = document.getElementById('shortsNextBtn');

        if (!this.track || !prevBtn || !nextBtn) return;

        const scrollLeft = this.track.scrollLeft;
        const scrollWidth = this.track.scrollWidth;
        const clientWidth = this.track.clientWidth;

        prevBtn.disabled = scrollLeft <= 10;
        nextBtn.disabled = scrollLeft >= scrollWidth - clientWidth - 10;
    }

    setupInfiniteScroll() {
        if (this.track) {
            this.track.addEventListener('scroll', () => {
                const scrollLeft = this.track.scrollLeft;
                const scrollWidth = this.track.scrollWidth;
                const clientWidth = this.track.clientWidth;

                if (scrollLeft + clientWidth >= scrollWidth - 100 && this.hasMore && !this.isLoading) {
                    this.loadMoreShorts();
                }
            });
        }
    }

    async loadMoreShorts() {
        console.log('Loading more shorts...');
    }

    openPromptPage(promptId) {
        if (promptId && promptId !== 'unknown') {
            const currentHost = window.location.hostname;
            let targetUrl = `/prompt/${promptId}`;
            
            if (currentHost === 'promptseen.co' && window.location.hostname !== 'localhost') {
                targetUrl = `https://www.promptseen.co/prompt/${promptId}`;
            }
            
            window.open(targetUrl, '_blank');
        }
    }

    openShortsPlayer(promptId) {
        if (promptId && promptId !== 'unknown' && window.shortsPlayer) {
            const prompt = allPrompts.find(p => p.id === promptId);
            if (prompt && (prompt.fileType === 'video' || prompt.videoUrl)) {
                window.shortsPlayer.openPlayer([prompt], 0);
            } else {
                const videos = allPrompts.filter(p => p.fileType === 'video' || p.videoUrl);
                const index = videos.findIndex(p => p.id === promptId);
                window.shortsPlayer.openPlayer(videos, index >= 0 ? index : 0);
            }
        }
    }

    formatCount(count) {
        if (count === undefined || count === null || isNaN(count)) {
            return '0';
        }
        
        const numCount = typeof count === 'number' ? count : parseInt(count);
        
        if (isNaN(numCount)) {
            return '0';
        }
        
        if (numCount >= 1000000) {
            return (numCount / 1000000).toFixed(1) + 'M';
        } else if (numCount >= 1000) {
            return (numCount / 1000).toFixed(1) + 'K';
        }
        return numCount.toString();
    }

    showErrorState() {
        if (this.track) {
            this.track.innerHTML = `
                <div class="shorts-error" style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <p>Failed to load latest prompts</p>
                    <button onclick="shortsHorizontalFeed.loadLatestPrompts()" 
                            style="margin-top: 10px; padding: 8px 16px; background: #4e54c8; color: white; border: none; border-radius: 20px; cursor: pointer;">
                        Retry
                    </button>
                </div>
            `;
        }
    }

    async refreshFeed() {
        await this.loadAllPrompts();
        await this.loadLatestPrompts();
    }

    startAutoRefresh() {
        setInterval(async () => {
            await this.refreshFeed();
        }, 20 * 60 * 1000);
    }
}

// ==================== YOUTUBE-STYLE PROMPTS WITH MARKETPLACE ====================

class YouTubeStylePrompts {
    constructor() {
        this.currentPage = 1;
        this.isLoading = false;
        this.hasMore = true;
        this.promptsPerPage = 12;
        this.loadedPrompts = new Set();
        this.filteredPrompts = null;
        this.init();
    }

    init() {
        this.injectCriticalCSS();
        this.setupInfiniteScroll();
        this.loadInitialPrompts();
        this.setupEngagementListeners();
        console.log('YouTubeStylePrompts initialized with marketplace features');
    }

    injectCriticalCSS() {
        const criticalCSS = `
            .shorts-container {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important;
                gap: 20px !important;
                padding: 20px !important;
                max-width: 100% !important;
                margin: 0 auto !important;
                width: 100% !important;
            }
            .shorts-prompt-card {
                position: relative !important;
                background: white !important;
                border-radius: 12px !important;
                overflow: hidden !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
                width: 100% !important;
                margin: 0 !important;
                display: block !important;
                transition: transform 0.3s ease !important;
            }
            .shorts-prompt-card:hover {
                transform: translateY(-5px) !important;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15) !important;
            }
            .shorts-video-container {
                position: relative !important;
                width: 100% !important;
                height: 400px !important;
                background: #000 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer;
                outline: none;
            }
            .shorts-image {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                display: block !important;
                transition: opacity 0.3s ease !important;
            }
            .shorts-engagement {
                position: absolute !important;
                right: 12px !important;
                bottom: 80px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 15px !important;
                align-items: center !important;
                z-index: 10 !important;
            }
            .engagement-action {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 4px !important;
                color: white !important;
                background: none !important;
                border: none !important;
                cursor: pointer !important;
                padding: 0 !important;
                font-size: 12px !important;
                transition: transform 0.2s ease !important;
            }
            .engagement-action:hover {
                transform: scale(1.1) !important;
            }
            .engagement-action i {
                font-size: 18px !important;
                background: rgba(0, 0, 0, 0.5) !important;
                border-radius: 50% !important;
                padding: 8px !important;
                width: 36px !important;
                height: 36px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                backdrop-filter: blur(10px) !important;
            }
            .engagement-count {
                font-size: 11px !important;
                font-weight: 500 !important;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8) !important;
            }
            .shorts-info {
                padding: 15px !important;
                background: white !important;
                display: block !important;
            }
            .shorts-prompt-text {
                font-size: 14px !important;
                line-height: 1.4 !important;
                margin-bottom: 10px !important;
                display: -webkit-box !important;
                -webkit-line-clamp: 3 !important;
                -webkit-box-orient: vertical !important;
                overflow: hidden !important;
                color: #0f0f0f !important;
                min-height: 60px !important;
            }
            .shorts-meta {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                font-size: 12px !important;
                color: #606060 !important;
                margin-bottom: 8px !important;
            }
            .prompt-actions {
                margin-top: 10px !important;
                display: flex !important;
                gap: 10px !important;
                width: 100% !important;
                align-items: center !important;
            }
            .copy-prompt-btn {
                padding: 8px 16px !important;
                border: 1px solid #ddd !important;
                border-radius: 20px !important;
                background: white !important;
                font-size: 12px !important;
                cursor: pointer !important;
                transition: all 0.3s ease !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                font-weight: 500 !important;
            }
            .copy-prompt-btn:hover {
                background: #4e54c8 !important;
                color: white !important;
                border-color: #4e54c8 !important;
            }
            .video-reel-badge {
                position: absolute !important;
                top: 10px !important;
                right: 10px !important;
                background: rgba(255, 107, 107, 0.9) !important;
                color: white !important;
                padding: 4px 8px !important;
                border-radius: 12px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
                z-index: 15 !important;
            }
            .price-badge {
                position: absolute !important;
                top: 10px !important;
                left: 10px !important;
                background: linear-gradient(135deg, #ff6b6b 0%, #ff8787 100%) !important;
                color: white !important;
                padding: 4px 12px !important;
                border-radius: 20px !important;
                font-size: 0.8rem !important;
                font-weight: bold !important;
                z-index: 15 !important;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
            }
            .price-badge.free {
                background: linear-gradient(135deg, #20bf6b 0%, #4cd964 100%) !important;
            }
            .image-badge {
                position: absolute !important;
                top: 10px !important;
                right: 10px !important;
                background: rgba(78, 84, 200, 0.9) !important;
                color: white !important;
                padding: 4px 8px !important;
                border-radius: 12px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
                z-index: 15 !important;
            }
            .hover-video-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 2;
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
            }
            .shorts-prompt-card.hover-active .hover-video-container,
            .horizontal-prompt-item.hover-active .hover-video-container {
                opacity: 1;
                pointer-events: auto;
            }
            .hover-video-player {
                width: 100%;
                height: 100%;
                object-fit: cover;
                background: #000;
            }
            .spinner-small {
                width: 24px;
                height: 24px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top: 3px solid #4e54c8;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            .horizontal-feed-section {
                grid-column: 1 / -1;
                margin: 30px 0;
                padding: 20px 0;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-radius: 15px;
                border: 1px solid #e9ecef;
                width: 100%;
                overflow: hidden;
            }
            .horizontal-feed-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding: 0 20px;
                flex-wrap: wrap;
                gap: 10px;
            }
            .horizontal-feed-header h3 {
                color: #2d334a;
                font-size: 1.3rem;
                font-weight: 600;
                margin: 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .video-count-badge {
                background: #ff6b6b !important;
                color: white !important;
                padding: 4px 10px !important;
                border-radius: 20px !important;
                font-size: 0.8rem !important;
                font-weight: 600 !important;
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
                margin-left: 10px !important;
            }
            .horizontal-controls {
                display: flex;
                gap: 10px;
            }
            .horizontal-control-btn {
                background: white;
                border: 2px solid #4e54c8;
                color: #4e54c8;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 0.9rem;
            }
            .horizontal-control-btn:hover {
                background: #4e54c8;
                color: white;
                transform: scale(1.1);
            }
            .horizontal-feed-track {
                display: flex;
                gap: 15px;
                padding: 0 20px;
                overflow-x: auto;
                scroll-behavior: smooth;
                scrollbar-width: thin;
                cursor: grab;
            }
            .horizontal-prompt-item {
                flex: 0 0 auto;
                width: 200px;
                background: white;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                transition: all 0.3s ease;
                cursor: pointer;
                position: relative;
            }
            .horizontal-prompt-item.video-item {
                border: 2px solid transparent;
                transition: all 0.3s ease;
            }
            .horizontal-prompt-item.video-item:hover {
                border-color: #ff6b6b;
                transform: translateY(-5px);
            }
            .horizontal-prompt-item:hover {
                transform: translateY(-5px);
                box-shadow: 0 8px 20px rgba(0,0,0,0.15);
            }
            .horizontal-prompt-image {
                position: relative;
                width: 100%;
                height: 150px;
                overflow: hidden;
            }
            .horizontal-prompt-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.3s ease;
            }
            .horizontal-prompt-views {
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 0.8rem;
                display: flex;
                align-items: center;
                gap: 4px;
                z-index: 10;
            }
            .horizontal-prompt-info {
                padding: 12px;
            }
            .horizontal-prompt-title {
                font-size: 0.9rem;
                font-weight: 600;
                color: #2d334a;
                margin-bottom: 8px;
                line-height: 1.3;
                height: 36px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
            .view-prompt-btn {
                width: 100%;
                padding: 8px 12px;
                background: #4e54c8;
                color: white;
                border: none;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .view-prompt-btn:hover {
                background: #3f44b8;
                transform: translateY(-2px);
            }
            @media (min-width: 1024px) {
                .shorts-container {
                    grid-template-columns: repeat(4, 1fr) !important;
                    gap: 24px !important;
                    padding: 24px !important;
                    max-width: 1400px !important;
                }
                .shorts-video-container {
                    height: 350px !important;
                }
            }
            @media (min-width: 768px) and (max-width: 1023px) {
                .shorts-container {
                    grid-template-columns: repeat(2, 1fr) !important;
                    gap: 20px !important;
                    padding: 20px !important;
                }
                .shorts-video-container {
                    height: 400px !important;
                }
            }
            @media (max-width: 767px) {
                .shorts-container {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 16px !important;
                    padding: 16px !important;
                    width: 100% !important;
                }
                .shorts-prompt-card {
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .shorts-video-container {
                    height: 400px !important;
                }
                .horizontal-feed-section {
                    margin: 20px 0 !important;
                    padding: 15px 0 !important;
                }
                .horizontal-feed-header {
                    padding: 0 15px !important;
                }
                .horizontal-feed-header h3 {
                    font-size: 1.1rem !important;
                }
                .horizontal-control-btn {
                    width: 35px !important;
                    height: 35px !important;
                }
                .horizontal-feed-track {
                    padding: 0 15px !important;
                    gap: 12px !important;
                    scroll-snap-type: x mandatory !important;
                }
                .horizontal-prompt-item {
                    width: 160px !important;
                    scroll-snap-align: start !important;
                }
                .horizontal-prompt-image {
                    height: 120px !important;
                }
            }
            @keyframes spin {
                0% { transform: rotate(0deg) !important; }
                100% { transform: rotate(360deg) !important; }
            }
            .loading-shorts {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                padding: 40px !important;
                color: #666 !important;
                width: 100% !important;
                grid-column: 1 / -1 !important;
            }
            .loading-shorts .spinner {
                width: 24px !important;
                height: 24px !important;
                border: 3px solid #f3f3f3 !important;
                border-top: 3px solid #4e54c8 !important;
                border-radius: 50% !important;
                animation: spin 0.8s linear infinite !important;
                margin-right: 12px !important;
            }
        `;

        const style = document.createElement('style');
        style.id = 'youtube-shorts-critical-css';
        style.textContent = criticalCSS;
        document.head.appendChild(style);
    }

    setupInfiniteScroll() {
        let ticking = false;
        
        const checkScroll = () => {
            if (this.isLoading || !this.hasMore) return;

            const scrollPosition = window.innerHeight + window.scrollY;
            const pageHeight = document.documentElement.scrollHeight - 100;

            if (scrollPosition >= pageHeight) {
                console.log('Loading more prompts...');
                this.loadMorePrompts();
            }
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    checkScroll();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        window.addEventListener('load', () => {
            setTimeout(() => this.checkScrollPosition(), 100);
        });
    }

    checkScrollPosition() {
        const scrollPosition = window.innerHeight + window.scrollY;
        const pageHeight = document.documentElement.scrollHeight;
        
        if (scrollPosition >= pageHeight - 200 && this.hasMore && !this.isLoading) {
            this.loadMorePrompts();
        }
    }

    async loadInitialPrompts() {
        const promptsContainer = document.getElementById('promptsContainer');
        if (!promptsContainer) {
            console.error('Prompts container not found');
            return;
        }

        console.log('Loading initial prompts for vertical feed with marketplace...');
        
        promptsContainer.innerHTML = '';
        promptsContainer.className = 'shorts-container';
        
        promptsContainer.innerHTML = this.createLoadingShorts();

        try {
            await this.loadAllPrompts();
            const olderPrompts = this.getOlderPrompts();
            const initialPrompts = olderPrompts.slice(0, this.promptsPerPage);
            console.log(`Loaded ${initialPrompts.length} older prompts for vertical feed`);
            this.displayPrompts(initialPrompts, true);
        } catch (error) {
            console.error('Error loading initial prompts:', error);
            this.showErrorState();
        }
    }

    async loadAllPrompts() {
        const now = Date.now();
        if (now - lastPromptUpdate < PROMPT_CACHE_DURATION && allPrompts.length > 0) {
            return allPrompts;
        }

        try {
            const user = await getCurrentUser();
            const userId = user?.uid || null;
            const params = new URLSearchParams({
                page: '1',
                limit: '1000',
                ...(userId && { userId })
            });
            
            const response = await fetch(`/api/uploads?${params}`);
            if (response.ok) {
                const data = await response.json();
                
                allPrompts = (data.uploads || []).map(prompt => ({
                    id: prompt.id || `unknown-${Date.now()}-${Math.random()}`,
                    title: prompt.title || 'Untitled Prompt',
                    promptText: prompt.promptText || 'No prompt text available.',
                    imageUrl: prompt.imageUrl || 'https://via.placeholder.com/800x400/4e54c8/white?text=AI+Image',
                    videoUrl: prompt.videoUrl || null,
                    mediaUrl: prompt.mediaUrl || prompt.imageUrl,
                    thumbnailUrl: prompt.thumbnailUrl || null,
                    fileType: prompt.fileType || 'image',
                    videoDuration: prompt.videoDuration || null,
                    userName: prompt.userName || 'Anonymous',
                    likes: parseInt(prompt.likes) || 0,
                    views: parseInt(prompt.views) || 0,
                    uses: parseInt(prompt.uses) || 0,
                    commentCount: parseInt(prompt.commentCount) || 0,
                    keywords: Array.isArray(prompt.keywords) ? prompt.keywords : ['AI', 'prompt'],
                    category: prompt.category || 'general',
                    hasCustomThumbnail: prompt.hasCustomThumbnail || false,
                    createdAt: prompt.createdAt || new Date().toISOString(),
                    updatedAt: prompt.updatedAt || new Date().toISOString(),
                    price: prompt.price || 0,
                    isPaid: prompt.price > 0,
                    salesCount: prompt.salesCount || 0,
                    totalEarnings: prompt.totalEarnings || 0,
                    purchasedBy: prompt.purchasedBy || []
                }));
                
                lastPromptUpdate = now;
                console.log(`Loaded ${allPrompts.length} prompts for vertical feed`);
            } else {
                throw new Error('Failed to fetch prompts');
            }
        } catch (error) {
            console.error('API fetch error:', error);
            if (allPrompts.length === 0) {
                allPrompts = [];
            }
        }
        
        return allPrompts;
    }

    getOlderPrompts() {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return allPrompts.filter(prompt => {
            if (!prompt || !prompt.createdAt) return true;
            
            try {
                let promptDate;
                if (typeof prompt.createdAt === 'string') {
                    promptDate = new Date(prompt.createdAt);
                } else if (prompt.createdAt.toDate && typeof prompt.createdAt.toDate === 'function') {
                    promptDate = prompt.createdAt.toDate();
                } else {
                    promptDate = new Date();
                }
                
                return promptDate <= twentyFourHoursAgo;
            } catch (error) {
                console.error('Error parsing date for prompt:', prompt.id, error);
                return true;
            }
        }).sort((a, b) => {
            try {
                const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
                const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
                return dateB - dateA;
            } catch (error) {
                return 0;
            }
        });
    }

    async loadMorePrompts() {
        if (this.isLoading || !this.hasMore) {
            console.log('Already loading or no more prompts');
            return;
        }

        this.isLoading = true;
        this.showLoadingIndicator();
        console.log(`Loading page ${this.currentPage + 1} for vertical feed...`);

        try {
            await new Promise(resolve => setTimeout(resolve, 400));
            
            const olderPrompts = this.getOlderPrompts();
            const startIndex = this.currentPage * this.promptsPerPage;
            const nextPrompts = olderPrompts.slice(startIndex, startIndex + this.promptsPerPage);
            
            if (nextPrompts.length > 0) {
                console.log(`Displaying ${nextPrompts.length} more older prompts`);
                this.displayPrompts(nextPrompts, false);
                this.currentPage++;
                
                setTimeout(() => this.checkScrollPosition(), 500);
            } else {
                console.log('No more older prompts to load');
                this.hasMore = false;
                this.hideLoadingIndicator();
                this.showNoMorePrompts();
            }
        } catch (error) {
            console.error('Error loading more prompts:', error);
            this.hideLoadingIndicator();
            showNotification('Failed to load more prompts', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    createHorizontalFeed(prompts, index) {
        const horizontalFeed = document.createElement('div');
        horizontalFeed.className = 'horizontal-feed-section';
        
        const videoCount = prompts.filter(p => p.fileType === 'video' || p.videoUrl).length;
        const videoIndicator = videoCount > 0 ? `<span class="video-count-badge"><i class="fas fa-video"></i> ${videoCount} Reels</span>` : '';
        
        horizontalFeed.innerHTML = `
            <div class="horizontal-feed-header">
                <h3>
                    More Prompts You Might Like
                    ${videoIndicator}
                </h3>
                <div class="horizontal-controls">
                    <button class="horizontal-control-btn prev-horizontal" onclick="scrollHorizontalFeed(this, -1)">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="horizontal-control-btn next-horizontal" onclick="scrollHorizontalFeed(this, 1)">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            <div class="horizontal-feed-track" id="horizontalFeed${index}">
            </div>
        `;
        
        const track = horizontalFeed.querySelector('.horizontal-feed-track');
        prompts.forEach(prompt => {
            const item = this.createHorizontalPromptItem(prompt);
            if (item) {
                track.appendChild(item);
            }
        });
        
        return horizontalFeed;
    }

    createHorizontalPromptItem(prompt) {
        const safePrompt = prompt || {};
        const promptId = safePrompt.id || 'unknown';
        const title = safePrompt.title || 'Untitled Prompt';
        const imageUrl = safePrompt.thumbnailUrl || safePrompt.imageUrl || 'https://via.placeholder.com/200x150/4e54c8/white?text=Prompt';
        const views = safePrompt.views || 0;
        const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl || safePrompt.mediaUrl?.includes('video');
        const price = safePrompt.price || 0;
        const isPaid = price > 0;
        
        const item = document.createElement('div');
        item.className = `horizontal-prompt-item ${isVideo ? 'video-item' : ''}`;
        item.setAttribute('data-prompt-id', promptId);
        item.setAttribute('data-price', price);
        item.setAttribute('data-is-paid', isPaid);
        item.setAttribute('data-file-type', isVideo ? 'video' : 'image');
        
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.view-prompt-btn')) {
                if (isVideo) {
                    this.openShortsPlayer(promptId);
                } else {
                    this.openPromptPage(promptId);
                }
            }
        });

        const imageDiv = document.createElement('div');
        imageDiv.className = 'horizontal-prompt-image';
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = title;
        img.loading = 'lazy';
        img.onerror = function() { this.src = 'https://via.placeholder.com/200x150/4e54c8/white?text=Prompt'; };
        imageDiv.appendChild(img);
        
        const priceBadge = document.createElement('div');
        priceBadge.className = `price-badge ${!isPaid ? 'free' : ''}`;
        priceBadge.innerHTML = isPaid ? `<i class="fas fa-rupee-sign"></i> ${price}` : '<i class="fas fa-gift"></i> Free';
        imageDiv.appendChild(priceBadge);
        
        if (isVideo) {
            const badge = document.createElement('div');
            badge.className = 'video-reel-badge';
            badge.innerHTML = '<i class="fas fa-play"></i> Reel';
            imageDiv.appendChild(badge);
            
            if (window.videoHoverManager) {
                const hoverVideoContainer = window.videoHoverManager.createHoverVideoElement(safePrompt);
                if (hoverVideoContainer) {
                    imageDiv.appendChild(hoverVideoContainer);
                }
            }
        } else {
            const badge = document.createElement('div');
            badge.className = 'image-badge';
            badge.innerHTML = '<i class="fas fa-image"></i> Prompt';
            imageDiv.appendChild(badge);
        }
        
        const viewsDiv = document.createElement('div');
        viewsDiv.className = 'horizontal-prompt-views';
        viewsDiv.innerHTML = `<i class="fas fa-eye"></i> ${this.formatCount(views)}`;
        imageDiv.appendChild(viewsDiv);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'horizontal-prompt-info';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'horizontal-prompt-title';
        titleDiv.textContent = title.substring(0, 40) + (title.length > 40 ? '...' : '');
        
        const button = document.createElement('button');
        button.className = 'view-prompt-btn';
        button.setAttribute('data-prompt-id', promptId);
        button.setAttribute('data-price', price);
        button.setAttribute('data-is-paid', isPaid);
        button.setAttribute('data-prompt-text', safePrompt.promptText || '');
        button.setAttribute('data-title', title);
        button.setAttribute('data-image', imageUrl);
        button.setAttribute('data-user', safePrompt.userName || 'Anonymous');
        button.onclick = async (e) => {
            e.stopPropagation();
            if (isVideo) {
                this.openShortsPlayer(promptId);
            } else {
                if (isPaid) {
                    const promptData = {
                        id: promptId,
                        title: title,
                        promptText: safePrompt.promptText || '',
                        imageUrl: imageUrl,
                        price: price,
                        userName: safePrompt.userName || 'Anonymous'
                    };
                    showBuyPromptModal(promptData);
                } else {
                    this.openPromptPage(promptId);
                }
            }
        };
        button.textContent = isVideo ? 'Watch Reel' : (isPaid ? `Buy for ₹${price}` : 'View Prompt');
        
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(button);

        item.appendChild(imageDiv);
        item.appendChild(infoDiv);

        return item;
    }

    getRandomPrompts(count, excludePrompts = [], prioritizeVideos = true) {
        const excludeIds = new Set(excludePrompts.map(p => p.id));
        const availablePrompts = allPrompts.filter(prompt => 
            prompt && !excludeIds.has(prompt.id)
        );
        
        if (availablePrompts.length === 0) return [];
        
        if (prioritizeVideos) {
            const videos = availablePrompts.filter(p => p.fileType === 'video' || p.videoUrl);
            const images = availablePrompts.filter(p => p.fileType !== 'video' && !p.videoUrl);
            
            const videoCount = Math.min(
                Math.max(2, Math.floor(count * 0.3)), 
                videos.length,
                count
            );
            
            const shuffledVideos = [...videos].sort(() => 0.5 - Math.random());
            let selectedPrompts = shuffledVideos.slice(0, videoCount);
            
            const remainingCount = count - selectedPrompts.length;
            if (remainingCount > 0 && images.length > 0) {
                const shuffledImages = [...images].sort(() => 0.5 - Math.random());
                selectedPrompts = [...selectedPrompts, ...shuffledImages.slice(0, remainingCount)];
            }
            
            return selectedPrompts.slice(0, count);
        } else {
            const shuffled = [...availablePrompts].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        }
    }

    displayPrompts(prompts, isInitial) {
        const promptsContainer = document.getElementById('promptsContainer');
        if (!promptsContainer) return;

        promptsContainer.className = 'shorts-container';

        if (isInitial) {
            promptsContainer.innerHTML = '';
            this.loadedPrompts.clear();
        } else {
            this.hideLoadingIndicator();
        }

        if (!prompts || prompts.length === 0) {
            this.showNoResults();
            return;
        }

        const groupedPrompts = [];
        for (let i = 0; i < prompts.length; i += 4) {
            const verticalPrompts = prompts.slice(i, i + 4);
            groupedPrompts.push(verticalPrompts);
            
            if (i + 4 < prompts.length) {
                const randomPrompts = this.getRandomPrompts(10, prompts.slice(i + 4), true);
                groupedPrompts.push({ type: 'horizontal', prompts: randomPrompts, index: i / 4 });
            }
        }

        let globalIndex = 0;
        groupedPrompts.forEach((group, groupIndex) => {
            if (group.type === 'horizontal') {
                const horizontalFeed = this.createHorizontalFeed(group.prompts, group.index);
                promptsContainer.appendChild(horizontalFeed);
                
                setTimeout(() => {
                    this.initHorizontalFeedControls(horizontalFeed);
                }, 100);
            } else {
                group.forEach((prompt, indexInGroup) => {
                    if (!prompt || this.loadedPrompts.has(prompt.id)) return;
                    
                    const promptElement = this.createShortsPrompt(prompt, globalIndex);
                    if (promptElement) {
                        promptsContainer.appendChild(promptElement);
                        this.loadedPrompts.add(prompt.id);
                        globalIndex++;
                    }
                });
            }
        });

        setTimeout(() => {
            this.animatePromptsIn();
        }, 50);

        console.log(`Displayed mixed feed with ${this.loadedPrompts.size} vertical prompts`);
    }

    initHorizontalFeedControls(horizontalFeed) {
        const track = horizontalFeed.querySelector('.horizontal-feed-track');
        const controls = horizontalFeed.querySelector('.horizontal-controls');
        
        if (track && controls && window.horizontalFeedManager) {
            const feedId = `horizontal-feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            window.horizontalFeedManager.addFeed(track, controls, feedId);
        }
    }

    createShortsPrompt(prompt, index) {
        const safePrompt = prompt || {};
        const promptId = safePrompt.id || `unknown-${index}`;
        const title = safePrompt.title || 'Untitled Prompt';
        const imageUrl = safePrompt.thumbnailUrl || safePrompt.imageUrl || 'https://via.placeholder.com/300x500/4e54c8/white?text=AI+Image';
        const promptText = safePrompt.promptText || 'No prompt text available.';
        const userName = safePrompt.userName || 'Anonymous';
        const views = safePrompt.views || 0;
        const likes = safePrompt.likes || 0;
        const uses = safePrompt.uses || 0;
        const category = safePrompt.category || 'general';
        const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl;
        const price = safePrompt.price || 0;
        const isPaid = price > 0;
        
        let createdAt = safePrompt.createdAt;
        if (!createdAt || typeof createdAt !== 'string') {
            createdAt = new Date().toISOString();
        }

        const promptDiv = document.createElement('div');
        promptDiv.className = 'shorts-prompt-card';
        promptDiv.setAttribute('data-prompt-id', promptId);
        promptDiv.setAttribute('data-price', price);
        promptDiv.setAttribute('data-is-paid', isPaid);
        promptDiv.setAttribute('data-file-type', isVideo ? 'video' : 'image');
        promptDiv.style.opacity = '0';
        promptDiv.style.transform = 'translateY(20px)';
        promptDiv.style.transition = `opacity 0.3s ease ${index * 0.05}s, transform 0.3s ease ${index * 0.05}s`;

        const priceBadge = isPaid ? 
            `<span class="price-badge"><i class="fas fa-rupee-sign"></i> ${price}</span>` :
            `<span class="price-badge free"><i class="fas fa-gift"></i> Free</span>`;

        promptDiv.innerHTML = `
            <div class="shorts-video-container ${isVideo ? 'video-hover-container' : ''}" 
                 ${isVideo ? 'tabindex="0" role="button" aria-label="Play video reel"' : ''}>
                <img src="${imageUrl}" 
                     alt="${title}"
                     class="shorts-image"
                     loading="lazy"
                     onerror="this.src='https://via.placeholder.com/300x500/4e54c8/white?text=AI+Image'">
                
                ${priceBadge}
                ${isVideo ? '<div class="video-reel-badge"><i class="fas fa-play"></i> Reel</div>' : ''}
                
                <div class="shorts-engagement">
                    <button class="engagement-action like-btn" data-prompt-id="${promptId}" title="Like">
                        <i class="far fa-heart"></i>
                        <span class="engagement-count likes-count">${this.formatCount(likes)}</span>
                    </button>
                    
                    <button class="engagement-action use-btn" data-prompt-id="${promptId}" title="Mark as used">
                        <i class="fas fa-download"></i>
                        <span class="engagement-count uses-count">${this.formatCount(uses)}</span>
                    </button>
                    
                    <button class="engagement-action share-btn" data-prompt-id="${promptId}" title="Share">
                        <i class="fas fa-share"></i>
                        <span class="engagement-count">Share</span>
                    </button>
                    
                    <a href="/prompt/${promptId}" class="engagement-action view-btn" target="_blank" title="View details">
                        <i class="fas fa-expand"></i>
                        <span class="engagement-count views-count">${this.formatCount(views)}</span>
                    </a>
                </div>
            </div>
            
            <div class="shorts-info">
                <div class="shorts-prompt-text">
                    ${promptText.length > 120 ? promptText.substring(0, 120) + '...' : promptText}
                </div>
                <div class="shorts-meta">
                    <span>@${userName}</span>
                    <span>${this.formatCount(views)} views</span>
                </div>
                <div class="prompt-actions">
                    <button class="copy-prompt-btn" data-prompt-id="${promptId}" data-prompt-text="${promptText.replace(/"/g, '&quot;')}" data-price="${price}" data-is-paid="${isPaid}" data-title="${title}" data-image="${imageUrl}" data-user="${userName}">
                        <i class="fas fa-copy"></i> ${isPaid ? `Buy for ₹${price}` : 'Copy Prompt'}
                    </button>
                    <span style="font-size: 11px; color: #888; margin-left: auto;">
                        #${category}
                    </span>
                </div>
            </div>
        `;

        const copyBtn = promptDiv.querySelector('.copy-prompt-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const promptData = {
                    id: promptId,
                    title: title,
                    promptText: promptText,
                    imageUrl: imageUrl,
                    price: price,
                    userName: userName
                };
                await handlePromptCopy(promptData, copyBtn);
            });
        }

        if (isVideo && window.videoHoverManager) {
            const videoContainer = promptDiv.querySelector('.shorts-video-container');
            const hoverVideoContainer = window.videoHoverManager.createHoverVideoElement(safePrompt);
            if (hoverVideoContainer) {
                videoContainer.appendChild(hoverVideoContainer);
            }
            
            const videoElement = hoverVideoContainer?.querySelector('.hover-video-player');
            if (videoElement) {
                videoElement.preload = 'metadata';
                
                videoContainer.addEventListener('focus', () => {
                    window.videoHoverManager.playHoverVideo(promptDiv);
                });
                
                videoContainer.addEventListener('blur', () => {
                    window.videoHoverManager.pauseHoverVideo(promptDiv);
                });
                
                videoContainer.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    window.videoHoverManager.playHoverVideo(promptDiv);
                }, { passive: true });
                
                videoContainer.addEventListener('mouseenter', () => {
                    window.videoHoverManager.playHoverVideo(promptDiv);
                });
                
                videoContainer.addEventListener('mouseleave', () => {
                    window.videoHoverManager.pauseHoverVideo(promptDiv);
                });
                
                videoElement.setAttribute('playsinline', '');
                videoElement.setAttribute('webkit-playsinline', '');
            }
        }

        if (isVideo) {
            const videoContainer = promptDiv.querySelector('.shorts-video-container');
            videoContainer.addEventListener('click', (e) => {
                if (!e.target.closest('.engagement-action') && !e.target.closest('.copy-prompt-btn')) {
                    this.openShortsPlayer(promptId);
                }
            });
        }

        return promptDiv;
    }

    setupEngagementListeners() {
        document.addEventListener('click', async (e) => {
            const likeBtn = e.target.closest('.like-btn');
            const useBtn = e.target.closest('.use-btn');
            const shareBtn = e.target.closest('.share-btn');
            
            if (likeBtn) {
                await this.handleLike(likeBtn);
            } else if (useBtn) {
                await this.handleUse(useBtn);
            } else if (shareBtn) {
                await this.handleShare(shareBtn);
            }
        });
    }

    async handleLike(likeBtn) {
        const promptId = likeBtn.dataset.promptId;
        if (!promptId || promptId === 'unknown') {
            showNotification('Invalid prompt', 'error');
            return;
        }

        const user = await getCurrentUser();
        if (!user) {
            showNotification('Please login to like prompts', 'error');
            return;
        }

        const likesCount = likeBtn.querySelector('.likes-count');
        const icon = likeBtn.querySelector('i');
        const isLiked = icon.classList.contains('fas');
        
        try {
            const action = isLiked ? 'unlike' : 'like';
            const response = await fetch(`/api/prompt/${promptId}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid, action })
            });

            if (response.ok) {
                const currentLikes = parseInt(likesCount.textContent) || 0;
                const newLikes = action === 'like' ? currentLikes + 1 : Math.max(0, currentLikes - 1);
                
                likesCount.textContent = this.formatCount(newLikes);
                icon.className = action === 'like' ? 'fas fa-heart' : 'far fa-heart';
                
                likesCount.classList.add('count-animation');
                setTimeout(() => likesCount.classList.remove('count-animation'), 300);
                
                showNotification(action === 'like' ? 'Prompt liked!' : 'Like removed', 'success');
            }
        } catch (error) {
            console.error('Like error:', error);
            showNotification('Failed to update like', 'error');
        }
    }

    async handleUse(useBtn) {
        const promptId = useBtn.dataset.promptId;
        if (!promptId || promptId === 'unknown') {
            showNotification('Invalid prompt', 'error');
            return;
        }

        const user = await getCurrentUser();
        if (!user) {
            showNotification('Please login to mark prompts as used', 'error');
            return;
        }

        const usesCount = useBtn.querySelector('.uses-count');
        
        try {
            const response = await fetch(`/api/prompt/${promptId}/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid })
            });

            if (response.ok) {
                const currentUses = parseInt(usesCount.textContent) || 0;
                usesCount.textContent = this.formatCount(currentUses + 1);
                
                usesCount.classList.add('count-animation');
                setTimeout(() => usesCount.classList.remove('count-animation'), 300);
                
                showNotification('Prompt marked as used!', 'success');
            }
        } catch (error) {
            console.error('Use error:', error);
            showNotification('Failed to mark as used', 'error');
        }
    }

    async handleShare(shareBtn) {
        const promptId = shareBtn.dataset.promptId;
       
        const promptUrl = `${window.location.origin}/prompt/${promptId}`;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Check out this AI prompt!',
                    text: 'Amazing AI-generated creation on Prompt Seen',
                    url: promptUrl
                });
            } catch (error) {
                if (error.name !== 'AbortError') {
                    await this.copyToClipboard(promptUrl);
                    showNotification('Link copied to clipboard!', 'success');
                }
            }
        } else {
            await this.copyToClipboard(promptUrl);
            showNotification('Link copied to clipboard!', 'success');
        }
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    }

    createLoadingShorts() {
        const loadingCards = Array(12).fill(0).map((_, i) => {
            if (i % 5 === 4) {
                return `
                    <div class="horizontal-feed-section loading-horizontal" style="opacity: 0; transform: translateY(20px); transition: opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s">
                        <div class="horizontal-feed-header">
                            <div class="loading-text" style="width: 200px; height: 20px; border-radius: 4px;"></div>
                            <div class="horizontal-controls">
                                <div class="loading-text" style="width: 40px; height: 40px; border-radius: 50%;"></div>
                                <div class="loading-text" style="width: 40px; height: 40px; border-radius: 50%;"></div>
                            </div>
                        </div>
                        <div class="horizontal-feed-track">
                            ${Array(8).fill(0).map(() => `
                                <div class="horizontal-prompt-item loading-horizontal-item">
                                    <div class="horizontal-prompt-image loading-text" style="height: 150px;"></div>
                                    <div class="horizontal-prompt-info">
                                        <div class="loading-text" style="height: 36px; margin-bottom: 8px; border-radius: 4px;"></div>
                                        <div class="loading-text" style="height: 32px; border-radius: 20px;"></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                return `
                    <div class="shorts-prompt-card loading-prompt" style="opacity: 0; transform: translateY(20px); transition: opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s">
                        <div class="shorts-video-container">
                            <div class="loading-placeholder"></div>
                        </div>
                        <div class="shorts-info">
                            <div class="shorts-prompt-text loading-text" style="height: 60px; margin-bottom: 10px;"></div>
                            <div class="shorts-meta">
                                <span class="loading-text" style="width: 100px; height: 12px; display: inline-block;"></span>
                                <span class="loading-text" style="width: 80px; height: 12px; display: inline-block;"></span>
                            </div>
                            <div class="prompt-actions">
                                <div class="loading-text" style="width: 120px; height: 32px; border-radius: 20px;"></div>
                                <div class="loading-text" style="width: 60px; height: 12px; margin-left: auto;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }).join('');

        return loadingCards;
    }

    showLoadingIndicator() {
        let loader = document.getElementById('infinite-scroll-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'infinite-scroll-loader';
            loader.className = 'loading-shorts';
            loader.innerHTML = `
                <div class="spinner"></div>
                <span>Loading more prompts...</span>
            `;
            document.getElementById('promptsContainer').appendChild(loader);
        }
    }

    hideLoadingIndicator() {
        const loader = document.getElementById('infinite-scroll-loader');
        if (loader) {
            loader.remove();
        }
    }

    showNoMorePrompts() {
        const promptsContainer = document.getElementById('promptsContainer');
        if (promptsContainer) {
            const endMessage = document.createElement('div');
            endMessage.className = 'loading-shorts';
            endMessage.innerHTML = `
                <i class="fas fa-check-circle" style="color: #20bf6b; margin-right: 8px;"></i>
                <span>You've seen all prompts!</span>
            `;
            promptsContainer.appendChild(endMessage);
        }
    }

    animatePromptsIn() {
        const prompts = document.querySelectorAll('.shorts-prompt-card, .horizontal-feed-section');
        prompts.forEach(prompt => {
            prompt.style.opacity = '1';
            prompt.style.transform = 'translateY(0)';
        });
    }

    formatCount(count) {
        if (count === undefined || count === null || isNaN(count)) {
            return '0';
        }
        
        const numCount = typeof count === 'number' ? count : parseInt(count);
        
        if (isNaN(numCount)) {
            return '0';
        }
        
        if (numCount >= 1000000) {
            return (numCount / 1000000).toFixed(1) + 'M';
        } else if (numCount >= 1000) {
            return (numCount / 1000).toFixed(1) + 'K';
        }
        return numCount.toString();
    }

    showErrorState() {
        const promptsContainer = document.getElementById('promptsContainer');
        if (promptsContainer) {
            promptsContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                    <h3>Unable to load prompts</h3>
                    <p>Please check your connection and try again</p>
                    <button onclick="youtubePrompts.loadInitialPrompts()" class="cta-button" style="margin-top: 20px;">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </div>
            `;
        }
    }

    showNoResults() {
        const promptsContainer = document.getElementById('promptsContainer');
        if (promptsContainer) {
            promptsContainer.innerHTML = `
                <div class="no-results" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                    <i class="fas fa-search" style="font-size: 3rem; color: #ccc; margin-bottom: 20px;"></i>
                    <h3 style="color: #666; margin-bottom: 10px;">No prompts found</h3>
                    <p style="color: #888;">Try adjusting your search or browse different categories</p>
                    <button onclick="categoryManager.selectCategory('all')" 
                            class="cta-button" 
                            style="margin-top: 20px;">
                        Show All Prompts
                    </button>
                </div>
            `;
        }
    }

    displayFilteredPrompts(filteredPrompts) {
        const promptsContainer = document.getElementById('promptsContainer');
        if (!promptsContainer) return;

        promptsContainer.innerHTML = '';
        this.loadedPrompts.clear();

        if (!filteredPrompts || filteredPrompts.length === 0) {
            this.showNoResults();
            return;
        }

        const initialPrompts = filteredPrompts.slice(0, this.promptsPerPage);
        this.displayPrompts(initialPrompts, true);
        
        this.filteredPrompts = filteredPrompts;
        this.hasMore = filteredPrompts.length > this.promptsPerPage;
    }

    filterByCategory(category) {
        const filteredPrompts = allPrompts.filter(prompt => prompt.category === category);
        this.displayFilteredPrompts(filteredPrompts);
    }

    filterBySearchTerm(searchTerm) {
        const filteredPrompts = allPrompts.filter(prompt => {
            const searchLower = searchTerm.toLowerCase();
            const title = (prompt.title || '').toLowerCase();
            const promptText = (prompt.promptText || '').toLowerCase();
            const keywords = prompt.keywords || [];
            
            return (
                title.includes(searchLower) ||
                promptText.includes(searchLower) ||
                keywords.some(keyword => keyword.toLowerCase().includes(searchLower))
            );
        });
        this.displayFilteredPrompts(filteredPrompts);
    }

    async refreshFeed() {
        await this.loadAllPrompts();
        this.currentPage = 1;
        this.hasMore = true;
        this.loadedPrompts.clear();
        await this.loadInitialPrompts();
    }

    startAutoRefresh() {
        setInterval(async () => {
            await this.refreshFeed();
        }, 20 * 60 * 1000);
    }

    openPromptPage(promptId) {
        if (promptId && promptId !== 'unknown') {
            const currentHost = window.location.hostname;
            let targetUrl = `/prompt/${promptId}`;
            
            if (currentHost === 'promptseen.co' && window.location.hostname !== 'localhost') {
                targetUrl = `https://www.promptseen.co/prompt/${promptId}`;
            }
            
            window.open(targetUrl, '_blank');
        }
    }

    openShortsPlayer(promptId) {
        if (promptId && promptId !== 'unknown' && window.shortsPlayer) {
            const prompt = allPrompts.find(p => p.id === promptId);
            if (prompt && (prompt.fileType === 'video' || prompt.videoUrl)) {
                window.shortsPlayer.openPlayer([prompt], 0);
            } else {
                const videos = allPrompts.filter(p => p.fileType === 'video' || p.videoUrl);
                const index = videos.findIndex(p => p.id === promptId);
                window.shortsPlayer.openPlayer(videos, index >= 0 ? index : 0);
            }
        }
    }
}

// ==================== YOUTUBE SHORTS PLAYER ====================

class YouTubeShortsPlayer {
    constructor() {
        this.currentVideoIndex = 0;
        this.videos = [];
        this.isPlaying = false;
        this.playerContainer = null;
        this.videoElement = null;
        this.progressInterval = null;
        this.touchStartY = 0;
        this.touchStartX = 0;
        this.isScrolling = false;
        this.scrollThreshold = 50;
        this.isMuted = true;
        this.volumeLevel = 1;
        this.loadingTimeouts = new Map();
        this.maxLoadTime = 10000;
        this.init();
    }

    init() {
        this.createPlayerContainer();
        this.setupEventListeners();
    }

    createPlayerContainer() {
        const playerHTML = `
            <div class="shorts-player-container" id="shortsPlayer">
                <div class="shorts-player-header">
                    <div class="shorts-player-header-left">
                        <button class="shorts-back-btn" id="closeShortsPlayer">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                        <span class="shorts-header-title">Shorts</span>
                    </div>
                    <div class="shorts-player-header-right">
                        <button class="shorts-header-btn" id="shortsSearchBtn">
                            <i class="fas fa-search"></i>
                        </button>
                        <button class="shorts-header-btn" id="shortsMenuBtn">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </div>
                
                <div class="shorts-player-content" id="shortsPlayerContent">
                    <div class="video-loading-global" id="videoLoadingGlobal" style="display: none;">
                        <div class="spinner"></div>
                        <div>Loading video...</div>
                    </div>
                    
                    <div class="shorts-videos-container" id="shortsVideosContainer">
                    </div>
                    
                    <div class="shorts-navigation-hint" id="shortsNavHint">
                        <i class="fas fa-chevron-up"></i>
                        <span>Swipe up for next</span>
                        <i class="fas fa-chevron-down"></i>
                    </div>
                </div>
                
                <div class="shorts-volume-control" id="shortsVolumeControl">
                    <button class="shorts-volume-btn" id="shortsVolumeBtn">
                        <i class="fas fa-volume-mute"></i>
                    </button>
                    <input type="range" class="shorts-volume-slider" id="shortsVolumeSlider" min="0" max="1" step="0.1" value="0">
                </div>
                
                <div class="shorts-error-toast" id="shortsErrorToast" style="display: none;">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Failed to load video. Tap to retry.</span>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', playerHTML);
        this.playerContainer = document.getElementById('shortsPlayer');
        this.videosContainer = document.getElementById('shortsVideosContainer');
        this.globalLoading = document.getElementById('videoLoadingGlobal');
        this.errorToast = document.getElementById('shortsErrorToast');
        
        if (this.errorToast) {
            this.errorToast.addEventListener('click', () => {
                this.errorToast.style.display = 'none';
                this.retryLoadVideo(this.currentVideoIndex);
            });
        }
    }

    setupEventListeners() {
        document.getElementById('closeShortsPlayer').addEventListener('click', () => {
            this.closePlayer();
        });

        const searchBtn = document.getElementById('shortsSearchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.openSearch();
            });
        }

        const menuBtn = document.getElementById('shortsMenuBtn');
        if (menuBtn) {
            menuBtn.addEventListener('click', () => {
                this.openMenu();
            });
        }

        const volumeBtn = document.getElementById('shortsVolumeBtn');
        const volumeSlider = document.getElementById('shortsVolumeSlider');

        if (volumeBtn) {
            volumeBtn.addEventListener('click', () => this.toggleMute());
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseFloat(e.target.value);
                this.setVolume(volume);
            });
        }

        document.addEventListener('keydown', (e) => {
            if (!this.playerContainer.classList.contains('active')) return;
            
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.playPrevious();
                this.showNavigationFeedback('up');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.playNext();
                this.showNavigationFeedback('down');
            } else if (e.key === 'Escape') {
                this.closePlayer();
            } else if (e.key === ' ') {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                this.toggleMute();
            }
        });

        this.videosContainer.addEventListener('touchstart', (e) => {
            this.touchStartY = e.touches[0].clientY;
            this.touchStartX = e.touches[0].clientX;
            this.isScrolling = false;
            this.videosContainer.style.transition = 'none';
        }, { passive: true });

        this.videosContainer.addEventListener('touchmove', (e) => {
            if (!this.touchStartY) return;
            
            const currentY = e.touches[0].clientY;
            const currentX = e.touches[0].clientX;
            const diffY = this.touchStartY - currentY;
            const diffX = this.touchStartX - currentX;
            
            if (Math.abs(diffY) > Math.abs(diffX)) {
                e.preventDefault();
                const translateY = -diffY;
                this.videosContainer.style.transform = `translateY(${translateY}px)`;
                this.videosContainer.style.transition = 'none';
                
                if (diffY > this.scrollThreshold / 2) {
                    this.showSwipeHint('down', Math.min(Math.abs(diffY) / 200, 1));
                } else if (diffY < -this.scrollThreshold / 2) {
                    this.showSwipeHint('up', Math.min(Math.abs(diffY) / 200, 1));
                }
            }
        }, { passive: false });

        this.videosContainer.addEventListener('touchend', (e) => {
            if (!this.touchStartY) return;
            
            const touchEndY = e.changedTouches[0].clientY;
            const diffY = this.touchStartY - touchEndY;
            
            this.videosContainer.style.transition = 'transform 0.3s ease';
            this.videosContainer.style.transform = '';
            
            if (Math.abs(diffY) > this.scrollThreshold) {
                if (diffY > 0) {
                    this.playNext();
                    this.showNavigationFeedback('up');
                } else {
                    this.playPrevious();
                    this.showNavigationFeedback('down');
                }
            }
            
            this.touchStartY = 0;
            this.touchStartX = 0;
            this.hideSwipeHint();
        });

        this.videosContainer.addEventListener('wheel', (e) => {
            if (!this.playerContainer.classList.contains('active')) return;
            
            e.preventDefault();
            
            if (e.deltaY > 0) {
                this.playNext();
                this.showNavigationFeedback('down');
            } else if (e.deltaY < 0) {
                this.playPrevious();
                this.showNavigationFeedback('up');
            }
        }, { passive: false });
    }

    toggleMute() {
        const video = this.getCurrentVideoElement();
        if (!video) return;

        this.isMuted = !this.isMuted;
        video.muted = this.isMuted;

        const volumeBtn = document.getElementById('shortsVolumeBtn');
        const volumeSlider = document.getElementById('shortsVolumeSlider');

        if (volumeBtn) {
            if (this.isMuted) {
                volumeBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
                if (volumeSlider) volumeSlider.value = 0;
            } else {
                if (this.volumeLevel > 0.5) {
                    volumeBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                } else {
                    volumeBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
                }
                if (volumeSlider) volumeSlider.value = this.volumeLevel;
            }
        }

        this.showToast(this.isMuted ? 'Muted' : 'Unmuted', 1000);
    }

    setVolume(volume) {
        const video = this.getCurrentVideoElement();
        if (!video) return;

        this.volumeLevel = Math.max(0, Math.min(1, volume));
        
        if (this.volumeLevel > 0) {
            this.isMuted = false;
            video.muted = false;
            video.volume = this.volumeLevel;
            
            const volumeBtn = document.getElementById('shortsVolumeBtn');
            if (volumeBtn) {
                if (this.volumeLevel > 0.5) {
                    volumeBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                } else {
                    volumeBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
                }
            }
        } else {
            this.isMuted = true;
            video.muted = true;
            
            const volumeBtn = document.getElementById('shortsVolumeBtn');
            if (volumeBtn) {
                volumeBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            }
        }

        const volumeSlider = document.getElementById('shortsVolumeSlider');
        if (volumeSlider) {
            volumeSlider.value = this.volumeLevel;
        }
    }

    togglePlayPause() {
        const video = this.getCurrentVideoElement();
        if (!video) return;

        if (video.paused) {
            video.play();
            this.showToast('Playing', 800);
        } else {
            video.pause();
            this.showToast('Paused', 800);
        }
    }

    getCurrentVideoElement() {
        const currentVideoContainer = document.querySelector(`.shorts-video-item[data-index="${this.currentVideoIndex}"]`);
        if (currentVideoContainer) {
            return currentVideoContainer.querySelector('video');
        }
        return null;
    }

    showNavigationFeedback(direction) {
        const hint = document.getElementById('shortsNavHint');
        if (hint) {
            hint.classList.add('show', direction);
            setTimeout(() => {
                hint.classList.remove('show', direction);
            }, 500);
        }
    }

    showSwipeHint(direction, opacity) {
        const hint = document.getElementById('shortsNavHint');
        if (hint) {
            hint.style.opacity = opacity;
            hint.classList.add('swiping', direction);
        }
    }

    hideSwipeHint() {
        const hint = document.getElementById('shortsNavHint');
        if (hint) {
            hint.style.opacity = '';
            hint.classList.remove('swiping', 'up', 'down');
        }
    }

    showToast(message, duration = 2000) {
        let toast = document.querySelector('.shorts-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'shorts-toast';
            document.getElementById('shortsPlayer').appendChild(toast);
        }
        
        toast.textContent = message;
        toast.classList.add('show');
        
        clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    openPlayer(videos, startIndex = 0) {
        if (!videos || videos.length === 0) return;
        
        this.videos = videos.filter(v => v.fileType === 'video' || v.videoUrl);
        
        if (this.videos.length === 0) {
            showNotification('No videos found', 'error');
            return;
        }
        
        this.currentVideoIndex = Math.min(startIndex, this.videos.length - 1);
        
        this.loadingTimeouts.forEach(timeout => clearTimeout(timeout));
        this.loadingTimeouts.clear();
        
        if (this.errorToast) {
            this.errorToast.style.display = 'none';
        }
        
        this.renderAllVideos();
        
        this.playerContainer.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        if (this.globalLoading) {
            this.globalLoading.style.display = 'flex';
        }
        
        setTimeout(() => {
            this.scrollToVideo(this.currentVideoIndex, false);
            this.loadVideo(this.currentVideoIndex);
        }, 100);
        
        this.trackView(this.videos[this.currentVideoIndex].id);
    }

    renderAllVideos() {
        if (!this.videosContainer) return;
        
        this.videosContainer.innerHTML = '';
        
        this.videos.forEach((video, index) => {
            const videoItem = this.createVideoItem(video, index);
            this.videosContainer.appendChild(videoItem);
        });
    }

   createVideoItem(video, index) {
    const videoItem = document.createElement('div');
    videoItem.className = 'shorts-video-item';
    videoItem.setAttribute('data-index', index);
    videoItem.setAttribute('data-video-id', video.id);

    const videoUrl = video.videoUrl || video.mediaUrl;
    const posterUrl = video.thumbnailUrl || video.imageUrl;
    const isPaid = video.price > 0;
    const price = video.price || 0;

    videoItem.innerHTML = `
        <div class="shorts-video-wrapper">
            <div class="shorts-video-loading" id="loading-${index}" style="display: ${index === this.currentVideoIndex ? 'flex' : 'none'};">
                <div class="spinner"></div>
                <div>Loading video...</div>
            </div>
            
            <video 
                class="shorts-video-player" 
                preload="metadata"
                poster="${posterUrl || ''}"
                loop
                playsinline
                muted="${this.isMuted}"
            >
                <source src="${videoUrl}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            
            <div class="shorts-video-overlay">
                <div class="shorts-video-info">
                    <div class="shorts-video-title">${video.title || 'Untitled Video'}</div>
                    <div class="shorts-video-meta">
                        <span><i class="fas fa-user"></i> ${video.userName || 'Anonymous'}</span>
                        <span><i class="fas fa-eye"></i> ${this.formatCount(video.views || 0)}</span>
                        ${video.videoDuration ? `<span><i class="fas fa-clock"></i> ${video.videoDuration}s</span>` : ''}
                        ${isPaid ? `<span class="price-tag"><i class="fas fa-rupee-sign"></i> ${price}</span>` : ''}
                    </div>
                    <div class="shorts-video-description">${video.promptText ? video.promptText.substring(0, 100) + (video.promptText.length > 100 ? '...' : '') : 'No description'}</div>
                </div>
                
                <div class="shorts-video-actions">
                    <button class="shorts-action-btn like-btn" data-video-id="${video.id}">
                        <i class="far fa-heart"></i>
                        <span class="shorts-action-count">${this.formatCount(video.likes || 0)}</span>
                    </button>
                    
                    <button class="shorts-action-btn comment-btn" data-video-id="${video.id}">
                        <i class="far fa-comment"></i>
                        <span class="shorts-action-count">${this.formatCount(video.commentCount || 0)}</span>
                    </button>
                    
                    <button class="shorts-action-btn share-btn" data-video-id="${video.id}">
                        <i class="far fa-share-square"></i>
                        <span>Share</span>
                    </button>
                    
                    <button class="shorts-action-btn copy-btn" data-video-id="${video.id}" data-prompt="${video.promptText || ''}" data-price="${price}" data-is-paid="${isPaid}" data-title="${video.title}" data-image="${video.thumbnailUrl || video.imageUrl}" data-user="${video.userName}">
                        <i class="far fa-copy"></i>
                        <span>${isPaid ? `Buy ₹${price}` : 'Copy'}</span>
                    </button>
                </div>
            </div>
            
            <div class="shorts-video-progress">
                <div class="shorts-progress-bar" id="progress-${index}"></div>
            </div>
            
            <div class="shorts-video-index">
                ${index + 1}/${this.videos.length}
            </div>
            
            <button class="shorts-retry-btn" id="retry-${index}" style="display: none;">
                <i class="fas fa-redo"></i> Retry
            </button>
        </div>
    `;

        const videoElement = videoItem.querySelector('video');
        const loadingElement = videoItem.querySelector(`#loading-${index}`);
        const retryButton = videoItem.querySelector(`#retry-${index}`);
        const progressBar = videoItem.querySelector(`#progress-${index}`);

        const loadingTimeout = setTimeout(() => {
            if (loadingElement && loadingElement.style.display === 'flex') {
                loadingElement.style.display = 'none';
                if (retryButton) {
                    retryButton.style.display = 'flex';
                }
                if (this.globalLoading) {
                    this.globalLoading.style.display = 'none';
                }
            }
        }, this.maxLoadTime);
        
        this.loadingTimeouts.set(index, loadingTimeout);

        videoElement.addEventListener('loadedmetadata', () => {
            clearTimeout(this.loadingTimeouts.get(index));
            this.loadingTimeouts.delete(index);
            
            if (loadingElement) loadingElement.style.display = 'none';
            if (retryButton) retryButton.style.display = 'none';
            if (this.globalLoading && index === this.currentVideoIndex) {
                this.globalLoading.style.display = 'none';
            }
        });

        videoElement.addEventListener('canplay', () => {
            clearTimeout(this.loadingTimeouts.get(index));
            this.loadingTimeouts.delete(index);
            
            if (loadingElement) loadingElement.style.display = 'none';
            if (retryButton) retryButton.style.display = 'none';
            if (this.globalLoading && index === this.currentVideoIndex) {
                this.globalLoading.style.display = 'none';
            }
            
            if (index === this.currentVideoIndex && videoElement.paused) {
                videoElement.play().catch(e => console.log('Autoplay prevented:', e));
            }
        });

        videoElement.addEventListener('error', (e) => {
            console.error('Video error:', e);
            clearTimeout(this.loadingTimeouts.get(index));
            this.loadingTimeouts.delete(index);
            
            if (loadingElement) loadingElement.style.display = 'none';
            if (retryButton) retryButton.style.display = 'flex';
            if (this.globalLoading && index === this.currentVideoIndex) {
                this.globalLoading.style.display = 'none';
                this.errorToast.style.display = 'flex';
            }
        });

        videoElement.addEventListener('timeupdate', () => {
            if (videoElement.duration) {
                const progress = (videoElement.currentTime / videoElement.duration) * 100;
                progressBar.style.width = `${progress}%`;
            }
        });

        if (retryButton) {
            retryButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.retryLoadVideo(index);
            });
        }

        this.setupVideoActions(videoItem, video);

        return videoItem;
    }

    retryLoadVideo(index) {
        const videoItem = document.querySelector(`.shorts-video-item[data-index="${index}"]`);
        if (!videoItem) return;
        
        const videoElement = videoItem.querySelector('video');
        const loadingElement = videoItem.querySelector(`#loading-${index}`);
        const retryButton = videoItem.querySelector(`#retry-${index}`);
        const videoUrl = this.videos[index]?.videoUrl || this.videos[index]?.mediaUrl;
        
        if (videoElement && videoUrl) {
            if (retryButton) retryButton.style.display = 'none';
            if (loadingElement) loadingElement.style.display = 'flex';
            if (this.globalLoading && index === this.currentVideoIndex) {
                this.globalLoading.style.display = 'flex';
            }
            if (this.errorToast) this.errorToast.style.display = 'none';
            
            videoElement.src = videoUrl;
            videoElement.load();
            
            const loadingTimeout = setTimeout(() => {
                if (loadingElement && loadingElement.style.display === 'flex') {
                    loadingElement.style.display = 'none';
                    if (retryButton) retryButton.style.display = 'flex';
                    if (this.globalLoading && index === this.currentVideoIndex) {
                        this.globalLoading.style.display = 'none';
                    }
                }
            }, this.maxLoadTime);
            
            this.loadingTimeouts.set(index, loadingTimeout);
        }
    }

  setupVideoActions(videoItem, video) {
    const likeBtn = videoItem.querySelector('.like-btn');
    if (likeBtn) {
        likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleLike(video.id, likeBtn);
        });
    }

    const commentBtn = videoItem.querySelector('.comment-btn');
    if (commentBtn) {
        commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openComments(video.id);
        });
    }

    const shareBtn = videoItem.querySelector('.share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleShare(video.id);
        });
    }

    const copyBtn = videoItem.querySelector('.copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // Get the current video data
            const currentVideo = this.videos[this.currentVideoIndex];
            // Check if it's a paid prompt
            const isPaid = currentVideo.price > 0;
            
            if (isPaid) {
                // Show purchase modal instead of copying
                const promptData = {
                    id: currentVideo.id,
                    title: currentVideo.title,
                    promptText: currentVideo.promptText || '',
                    imageUrl: currentVideo.thumbnailUrl || currentVideo.imageUrl,
                    price: currentVideo.price,
                    userName: currentVideo.userName || 'Anonymous'
                };
                if (typeof showBuyPromptModal === 'function') {
                    showBuyPromptModal(promptData);
                } else {
                    console.log('Purchase required for:', currentVideo.title);
                    // Fallback notification
                    this.showToast(`Buy for ₹${currentVideo.price} to copy prompt`, 3000);
                }
            } else {
                // Free prompt - copy directly
                this.copyPrompt(currentVideo.promptText);
            }
        });
    }
}

    scrollToVideo(index, animated = true) {
        const videoItem = document.querySelector(`.shorts-video-item[data-index="${index}"]`);
        if (videoItem) {
            videoItem.scrollIntoView({
                behavior: animated ? 'smooth' : 'auto',
                block: 'start'
            });
        }
    }

    loadVideo(index) {
        const videoItem = document.querySelector(`.shorts-video-item[data-index="${index}"]`);
        if (!videoItem) return;

        if (this.globalLoading) {
            this.globalLoading.style.display = 'flex';
        }

        if (this.errorToast) {
            this.errorToast.style.display = 'none';
        }

        const currentLoading = videoItem.querySelector(`#loading-${index}`);
        if (currentLoading) {
            currentLoading.style.display = 'flex';
        }

        document.querySelectorAll('.shorts-video-item video').forEach((video, i) => {
            if (i !== index) {
                video.pause();
                video.currentTime = 0;
                
                const otherLoading = document.querySelector(`#loading-${i}`);
                if (otherLoading) {
                    otherLoading.style.display = 'none';
                }
            }
        });

        const videoElement = videoItem.querySelector('video');
        if (videoElement) {
            videoElement.muted = this.isMuted;
            videoElement.volume = this.volumeLevel;
            
            const playPromise = videoElement.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        if (currentLoading) currentLoading.style.display = 'none';
                        if (this.globalLoading) this.globalLoading.style.display = 'none';
                    })
                    .catch(error => {
                        console.log('Autoplay prevented:', error);
                        if (!videoElement.readyState) {
                            this.showPlayButton(videoItem);
                        } else {
                            if (currentLoading) currentLoading.style.display = 'none';
                            if (this.globalLoading) this.globalLoading.style.display = 'none';
                        }
                    });
            }
        }

        this.currentVideoIndex = index;
        this.updateHistory(videoItem.dataset.videoId);
    }

    showPlayButton(videoItem) {
        let playButton = videoItem.querySelector('.shorts-play-button');
        if (!playButton) {
            playButton = document.createElement('button');
            playButton.className = 'shorts-play-button';
            playButton.innerHTML = '<i class="fas fa-play"></i>';
            videoItem.querySelector('.shorts-video-wrapper').appendChild(playButton);
            
            playButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const video = videoItem.querySelector('video');
                video.play();
                playButton.remove();
            });
        }
    }

    updateHistory(videoId) {
        const url = new URL(window.location);
        url.searchParams.set('video', videoId);
        window.history.replaceState({}, '', url);
    }

    playNext() {
        if (this.currentVideoIndex < this.videos.length - 1) {
            const nextIndex = this.currentVideoIndex + 1;
            this.scrollToVideo(nextIndex);
            this.loadVideo(nextIndex);
            this.trackView(this.videos[nextIndex].id);
            this.showToast(`Next: ${this.videos[nextIndex].title || 'Video'}`, 1500);
        } else {
            this.showToast('You\'ve reached the end', 1000);
            this.loadMoreVideos();
        }
    }

    playPrevious() {
        if (this.currentVideoIndex > 0) {
            const prevIndex = this.currentVideoIndex - 1;
            this.scrollToVideo(prevIndex);
            this.loadVideo(prevIndex);
            this.trackView(this.videos[prevIndex].id);
            this.showToast(`Previous: ${this.videos[prevIndex].title || 'Video'}`, 1500);
        } else {
            this.showToast('This is the first video', 1000);
        }
    }

    async loadMoreVideos() {
        try {
            const response = await fetch('/api/uploads?type=video&page=' + Math.ceil(this.videos.length / 10 + 1));
            if (response.ok) {
                const data = await response.json();
                const newVideos = data.uploads.filter(v => v.fileType === 'video' || v.videoUrl);
                
                if (newVideos.length > 0) {
                    this.videos = [...this.videos, ...newVideos];
                    
                    newVideos.forEach((video, offset) => {
                        const index = this.videos.length - newVideos.length + offset;
                        const videoItem = this.createVideoItem(video, index);
                        this.videosContainer.appendChild(videoItem);
                    });
                    
                    this.showToast(`Loaded ${newVideos.length} more videos`, 2000);
                } else {
                    this.showToast('No more videos', 1000);
                }
            }
        } catch (error) {
            console.error('Error loading more videos:', error);
        }
    }

    closePlayer() {
        this.playerContainer.classList.remove('active');
        document.body.style.overflow = '';
        
        this.loadingTimeouts.forEach(timeout => clearTimeout(timeout));
        this.loadingTimeouts.clear();
        
        document.querySelectorAll('.shorts-video-item video').forEach(video => {
            video.pause();
            video.src = '';
            video.load();
        });
        
        if (this.videosContainer) {
            this.videosContainer.innerHTML = '';
        }
        
        const url = new URL(window.location);
        url.searchParams.delete('video');
        window.history.replaceState({}, '', url);
        
        if (this.errorToast) {
            this.errorToast.style.display = 'none';
        }
    }

    async handleLike(videoId, button) {
        const likeIcon = button.querySelector('i');
        const likeCount = button.querySelector('.shorts-action-count');
        const isLiked = likeIcon.classList.contains('fas');
        
        try {
            const response = await fetch(`/api/prompt/${videoId}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'anonymous', action: isLiked ? 'unlike' : 'like' })
            });
            
            if (response.ok) {
                const video = this.videos.find(v => v.id === videoId);
                if (video) {
                    if (isLiked) {
                        likeIcon.className = 'far fa-heart';
                        video.likes = Math.max(0, (video.likes || 0) - 1);
                    } else {
                        likeIcon.className = 'fas fa-heart';
                        video.likes = (video.likes || 0) + 1;
                        likeIcon.classList.add('heart-animation');
                        setTimeout(() => likeIcon.classList.remove('heart-animation'), 300);
                    }
                    
                    likeCount.textContent = this.formatCount(video.likes || 0);
                }
            }
        } catch (error) {
            console.error('Like error:', error);
        }
    }

    handleShare(videoId) {
        const shareUrl = `${window.location.origin}/prompt/${videoId}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'AI Video Reel',
                text: 'Check out this AI-generated video on prompt seen!',
                url: shareUrl
            }).catch(() => {
                this.copyToClipboard(shareUrl);
                this.showToast('Link copied to clipboard!', 2000);
            });
        } else {
            this.copyToClipboard(shareUrl);
            this.showToast('Link copied to clipboard!', 2000);
        }
    }

    copyPrompt(promptText) {
        if (promptText) {
            this.copyToClipboard(promptText);
            this.showToast('Prompt copied to clipboard!', 2000);
        }
    }

    openComments(videoId) {
        window.location.href = `/prompt/${videoId}#commentSection`;
    }

    openSearch() {
        this.showToast('Search coming soon', 1000);
    }

    openMenu() {
        const menu = document.createElement('div');
        menu.className = 'shorts-menu';
        menu.innerHTML = `
            <div class="shorts-menu-item">
                <i class="fas fa-info-circle"></i> About this reel
            </div>
            <div class="shorts-menu-item">
                <i class="fas fa-flag"></i> Report
            </div>
            <div class="shorts-menu-item">
                <i class="fas fa-ban"></i> Not interested
            </div>
            <div class="shorts-menu-item">
                <i class="fas fa-link"></i> Copy link
            </div>
        `;
        
        this.playerContainer.appendChild(menu);
        
        setTimeout(() => {
            menu.classList.add('show');
        }, 10);
        
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.classList.remove('show');
                setTimeout(() => menu.remove(), 300);
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        });
    }

    trackView(promptId) {
        fetch(`/api/prompt/${promptId}/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.log('View tracking error:', err));
    }

    formatCount(count) {
        if (count === undefined || count === null || isNaN(count)) return '0';
        const num = typeof count === 'number' ? count : parseInt(count);
        if (isNaN(num)) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
}

// Initialize the shorts player
window.shortsPlayer = new YouTubeShortsPlayer();

// Global function to open shorts player
function openShortsPlayer(promptId) {
    const prompt = allPrompts.find(p => p.id === promptId);
    if (prompt && (prompt.fileType === 'video' || prompt.videoUrl)) {
        window.shortsPlayer.openPlayer([prompt], 0);
    } else {
        const videos = allPrompts.filter(p => p.fileType === 'video' || p.videoUrl);
        const index = videos.findIndex(p => p.id === promptId);
        window.shortsPlayer.openPlayer(videos, index >= 0 ? index : 0);
    }
}

function addShortsFilterButton() {
    const categoriesContainer = document.querySelector('.categories-container');
    if (categoriesContainer) {
        const shortsBtn = document.createElement('button');
        shortsBtn.className = 'category-btn shorts-filter-btn';
        shortsBtn.innerHTML = '<i class="fas fa-play"></i> Shorts';
        shortsBtn.style.background = '#ff6b6b';
        shortsBtn.style.color = 'white';
        shortsBtn.style.marginLeft = '10px';
        
        shortsBtn.addEventListener('click', () => {
            filterByVideos();
        });
        
        categoriesContainer.appendChild(shortsBtn);
    }
}

function filterByVideos() {
    const videos = allPrompts.filter(p => p.fileType === 'video' || p.videoUrl);
    if (videos.length > 0) {
        window.shortsPlayer.openPlayer(videos, 0);
    } else {
        showNotification('No videos available', 'info');
    }
}

// ==================== UPLOAD HANDLER WITH MARKETPLACE ====================

async function handleUploadSubmit(e) {
    e.preventDefault();
    
    const user = checkAuth();
    if (!user) {
        alert('Please login to upload creations');
        window.location.href = 'login.html?returnUrl=' + encodeURIComponent(window.location.href);
        return;
    }
    
    const title = document.getElementById('promptTitle')?.value || '';
    const promptText = document.getElementById('promptText')?.value || '';
    const aboutDescription = document.getElementById('aboutDescription')?.value || '';
    const category = document.getElementById('category')?.value || '';
    const mediaFile = document.getElementById('imageUpload')?.files[0];
    const thumbnailFile = document.getElementById('videoThumbnailUpload')?.files[0];
    
    const pricingType = document.querySelector('input[name="pricingType"]:checked')?.value;
    let price = 0;
    if (pricingType === 'paid') {
        const priceInput = document.getElementById('promptPrice')?.value;
        price = parseFloat(priceInput) || 0;
        if (price < 10) {
            alert('Please enter a valid price (minimum ₹50) for paid prompts');
            return;
        }
    }
    const isPaid = price > 0;
    
    if (!mediaFile) {
        alert('Please select an image or video to upload!');
        return;
    }
    
    const isVideo = mediaFile.type.startsWith('video/');
    const isImage = mediaFile.type.startsWith('image/');
    if (!isImage && !isVideo) {
        alert('Please upload a valid image or video file (JPEG, PNG, WebP, MP4, WebM)');
        return;
    }
    
    const maxSize = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024;
    if (mediaFile.size > maxSize) {
        alert(`File size exceeds limit. ${isVideo ? 'Videos max 100MB' : 'Images max 5MB'}.`);
        return;
    }
    
    if (thumbnailFile) {
        if (!thumbnailFile.type.startsWith('image/')) {
            alert('Thumbnail must be an image file (JPEG, PNG, WebP)');
            return;
        }
        if (thumbnailFile.size > 5 * 1024 * 1024) {
            alert('Thumbnail size exceeds 5MB limit');
            return;
        }
    }
    
    if (!title || !title.trim()) {
        alert('Please enter a title for your creation');
        return;
    }
    
    if (!promptText || !promptText.trim()) {
        alert('Please enter the prompt text used to generate this content');
        return;
    }
    
    try {
        const submitBtn = document.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        submitBtn.disabled = true;
        
        await initializeFirebase();
        const firebaseUser = await getCurrentUser();
        if (!firebaseUser) {
            throw new Error('User not authenticated with Firebase. Please log in again.');
        }
        
        const idToken = await firebaseUser.getIdToken();
        
        const formData = new FormData();
        formData.append('media', mediaFile);
        if (thumbnailFile) formData.append('thumbnail', thumbnailFile);
        formData.append('title', title);
        formData.append('promptText', promptText);
        formData.append('aboutDescription', aboutDescription);
        if (category) formData.append('category', category);
        formData.append('userName', user.name || 'User');
        formData.append('userId', firebaseUser.uid);
        formData.append('price', price);
        formData.append('isPaid', isPaid);
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}` },
            body: formData
        });
        
        if (!response.ok) {
            let errorMsg = `Upload failed with status ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {}
            throw new Error(errorMsg);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const uploadModal = document.getElementById('uploadModal');
            const uploadForm = document.getElementById('uploadForm');
            const imagePreview = document.getElementById('imagePreview');
            const videoThumbnailPreview = document.getElementById('videoThumbnailPreview');
            const videoThumbnailSection = document.getElementById('videoThumbnailSection');
            
            uploadModal.classList.remove('active');
            document.body.style.overflow = '';
            uploadForm.reset();
            if (imagePreview) imagePreview.style.display = 'none';
            if (videoThumbnailPreview) videoThumbnailPreview.style.display = 'none';
            if (videoThumbnailSection) videoThumbnailSection.style.display = 'none';
            
            const priceMessage = isPaid ? ` with price ₹${price}` : ' as free';
            showNotification(`Upload successful${priceMessage}!`, 'success');
            
            lastPromptUpdate = 0;
            allPrompts = [];
            if (window.shortsHorizontalFeed) await window.shortsHorizontalFeed.refreshFeed();
            if (window.youtubePrompts) await window.youtubePrompts.refreshFeed();
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Upload error:', error);
        let userMessage;
        if (error.message.includes('bucket') || error.message.includes('Storage')) {
            userMessage = 'Storage service unavailable. Please try again later.';
        } else if (error.message.includes('permission') || error.message.includes('credentials')) {
            userMessage = 'Permission error. Please log out and log in again.';
        } else if (error.message.includes('size')) {
            userMessage = 'File too large. Please select a smaller file.';
        } else {
            userMessage = 'Could not save your file. Please try a different file.';
        }
        showNotification(`Upload failed: ${userMessage}`, 'error');
    } finally {
        const submitBtn = document.querySelector('.submit-btn');
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-upload"></i> List Your Prompt for Sale';
            submitBtn.disabled = false;
        }
    }
}

// ==================== NEWS MANAGER ====================

class NewsManager {
    constructor() {
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
    }
    
    async loadNews() {
        try {
            this.showLoading();
            const response = await fetch(`/api/news?page=${this.currentPage}&limit=6`);
            const data = await response.json();
            
            this.displayNews(data.news);
            this.hasMore = data.hasMore;
        } catch (error) {
            console.error('Error loading news:', error);
            this.showError();
        }
    }
    
    displayNews(news) {
        const newsContainer = document.getElementById('newsContainer');
        if (!newsContainer) return;
        
        if (!news || news.length === 0) {
            newsContainer.innerHTML = `
                <div class="no-news" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-newspaper" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                    <h3>No News Yet</h3>
                    <p>Be the first to publish AI news and updates!</p>
                </div>
            `;
            return;
        }
        
        newsContainer.innerHTML = news.map(item => {
            const safeItem = item || {};
            return `
                <div class="news-card" data-news-id="${safeItem.id || 'unknown'}">
                    ${safeItem.isBreaking ? '<span class="breaking-badge">BREAKING</span>' : ''}
                    ${safeItem.isFeatured ? '<span class="featured-badge">FEATURED</span>' : ''}
                    <img src="${safeItem.imageUrl || 'https://via.placeholder.com/300x200/4e54c8/white?text=News'}" 
                         alt="${safeItem.title || 'News'}" 
                         class="news-image" 
                         loading="lazy"
                         onerror="this.src='https://via.placeholder.com/300x200/4e54c8/white?text=News'">
                    <div class="news-content">
                        <h3 class="news-title">${safeItem.title || 'Untitled News'}</h3>
                        <p class="news-excerpt">${safeItem.excerpt || 'No excerpt available.'}</p>
                        <div class="news-meta">
                            <span class="news-author">By ${safeItem.author || 'Unknown'}</span>
                            <span class="news-date">${safeItem.publishedAt ? new Date(safeItem.publishedAt).toLocaleDateString() : 'Unknown date'}</span>
                        </div>
                        <div class="news-stats">
                            <span class="news-views"><i class="fas fa-eye"></i> ${this.formatCount(safeItem.views)}</span>
                            <a href="/news/${safeItem.id || 'unknown'}" class="read-more">Read More <i class="fas fa-arrow-right"></i></a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    showLoading() {
        const newsContainer = document.getElementById('newsContainer');
        if (!newsContainer) return;
        
        newsContainer.innerHTML = `
            <div class="news-loading" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <div class="spinner"></div>
                <p>Loading latest news...</p>
            </div>
        `;
    }
    
    showError() {
        const newsContainer = document.getElementById('newsContainer');
        if (!newsContainer) return;
        
        newsContainer.innerHTML = `
            <div class="news-error" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #666;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px;"></i>
                <h3>Failed to load news</h3>
                <p>Please try again later</p>
                <button onclick="newsManager.loadNews()" class="retry-btn" style="margin-top: 15px;">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
    }
    
    formatCount(count) {
        if (count === undefined || count === null || isNaN(count)) {
            return '0';
        }
        
        const numCount = typeof count === 'number' ? count : parseInt(count);
        
        if (isNaN(numCount)) {
            return '0';
        }
        
        if (numCount >= 1000000) {
            return (numCount / 1000000).toFixed(1) + 'M';
        } else if (numCount >= 1000) {
            return (numCount / 1000).toFixed(1) + 'K';
        }
        return numCount.toString();
    }
}

// ==================== CATEGORY MANAGER ====================

class CategoryManager {
    constructor() {
        this.defaultCategories = ['photography'];
        this.searchCategories = [];
        this.maxSearchCategories = 10;
        this.currentCategory = 'all';
        this.init();
    }

    init() {
        this.loadUserCategories();
        this.renderCategories();
        this.setupEventListeners();
        this.updateNavigation();
    }

    loadUserCategories() {
        const userCategories = localStorage.getItem('userSearchCategories');
        if (userCategories) {
            this.searchCategories = JSON.parse(userCategories);
        }
    }

    saveUserCategories() {
        localStorage.setItem('userSearchCategories', JSON.stringify(this.searchCategories));
    }

    addSearchCategory(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') return;

        const category = searchTerm.toLowerCase().trim();
        
        if (this.defaultCategories.includes(category)) return;

        const existingIndex = this.searchCategories.indexOf(category);
        if (existingIndex > -1) {
            this.searchCategories.splice(existingIndex, 1);
        }

        this.searchCategories.unshift(category);

        if (this.searchCategories.length > this.maxSearchCategories) {
            this.searchCategories = this.searchCategories.slice(0, this.maxSearchCategories);
        }

        this.saveUserCategories();
        this.renderCategories();
    }

    renderCategories() {
        const categoriesTrack = document.getElementById('categoriesTrack');
        if (!categoriesTrack) return;

        const allCategories = [...this.defaultCategories, ...this.searchCategories];
        
        categoriesTrack.innerHTML = allCategories.map(category => {
            const displayName = this.getCategoryDisplayName(category);
            const isActive = category === this.currentCategory;
            
            return `
                <button class="category-btn ${isActive ? 'active' : ''}" 
                        data-category="${category}">
                    ${displayName}
                </button>
            `;
        }).join('');
    }

    getCategoryDisplayName(category) {
        const displayNames = {
            'photography': 'All',
        };
        
        return displayNames[category] || this.capitalizeFirstLetter(category);
    }

    capitalizeFirstLetter(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.category-btn')) {
                const categoryBtn = e.target.closest('.category-btn');
                const category = categoryBtn.dataset.category;
                this.selectCategory(category);
            }
        });

        const prevBtn = document.getElementById('categoryPrev');
        const nextBtn = document.getElementById('categoryNext');
        const scrollContainer = document.getElementById('categoriesScroll');

        if (prevBtn && nextBtn && scrollContainer) {
            prevBtn.addEventListener('click', () => {
                this.scrollCategories(-200);
            });

            nextBtn.addEventListener('click', () => {
                this.scrollCategories(200);
            });

            scrollContainer.addEventListener('scroll', () => {
                this.updateNavigation();
            });
        }

        window.addEventListener('resize', () => {
            this.updateNavigation();
        });
    }

    scrollCategories(distance) {
        const scrollContainer = document.getElementById('categoriesScroll');
        if (scrollContainer) {
            scrollContainer.scrollBy({
                left: distance,
                behavior: 'smooth'
            });
        }
    }

    updateNavigation() {
        if (window.innerWidth <= 768) return;

        const scrollContainer = document.getElementById('categoriesScroll');
        const prevBtn = document.getElementById('categoryPrev');
        const nextBtn = document.getElementById('categoryNext');

        if (!scrollContainer || !prevBtn || !nextBtn) return;

        const scrollLeft = scrollContainer.scrollLeft;
        const scrollWidth = scrollContainer.scrollWidth;
        const clientWidth = scrollContainer.clientWidth;

        if (scrollLeft <= 10) {
            prevBtn.classList.add('hidden');
        } else {
            prevBtn.classList.remove('hidden');
        }

        if (scrollLeft >= scrollWidth - clientWidth - 10) {
            nextBtn.classList.add('hidden');
        } else {
            nextBtn.classList.remove('hidden');
        }
    }

    selectCategory(category) {
        this.currentCategory = category;
        
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`[data-category="${category}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        this.filterPromptsByCategory(category);
        
        if (!this.defaultCategories.includes(category)) {
            showNotification(`Showing results for: ${this.getCategoryDisplayName(category)}`, 'info');
        }
    }

    filterPromptsByCategory(category) {
        if (window.youtubePrompts) {
            youtubePrompts.currentPage = 1;
            youtubePrompts.hasMore = true;
            
            if (category === 'all') {
                youtubePrompts.loadInitialPrompts();
            } else if (this.defaultCategories.includes(category)) {
                youtubePrompts.filterByCategory(category);
            } else {
                youtubePrompts.filterBySearchTerm(category);
            }
        }
    }
}

// ==================== SEARCH MANAGER ====================

class SearchManager {
    constructor() {
        this.currentSearchTerm = '';
        this.currentCategory = 'all';
        this.currentSort = 'recent';
        this.isSearching = false;
    }

    async init() {
        await this.loadAllPrompts();
        this.setupSearchListeners();
    }

    async loadAllPrompts() {
        try {
            const user = await getCurrentUser();
            const userId = user?.uid || null;
            const params = new URLSearchParams({
                page: '1',
                limit: '1000',
                ...(userId && { userId })
            });
            
            const response = await fetch(`/api/uploads?${params}`);
            if (response.ok) {
                const data = await response.json();
                allPrompts = data.uploads || [];
            }
        } catch (error) {
            console.error('Error loading prompts for search:', error);
        }
    }

    setupSearchListeners() {
        const searchInput = document.getElementById('searchInput');
        const searchButton = document.getElementById('searchButton');
        const sortBy = document.getElementById('sortBy');
        const categoryFilter = document.getElementById('categoryFilter');
        const clearSearch = document.getElementById('clearSearch');

        if (searchButton) {
            searchButton.addEventListener('click', () => this.performSearch());
        }

        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        if (sortBy) {
            sortBy.addEventListener('change', () => {
                this.currentSort = sortBy.value || 'recent';
                if (this.currentSearchTerm || this.currentCategory !== 'all') {
                    this.performSearch();
                }
            });
        }

        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.currentCategory = categoryFilter.value || 'all';
                if (this.currentSearchTerm || this.currentCategory !== 'all') {
                    this.performSearch();
                }
            });
        }

        if (clearSearch) {
            clearSearch.addEventListener('click', () => this.clearSearch());
        }
    }

    performSearch() {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';
        
        this.currentSearchTerm = searchTerm;
        this.showSearchResults();
    }

    showSearchResults() {
        const promptsContainer = document.getElementById('promptsContainer');
        const resultsInfo = document.getElementById('searchResultsInfo');
        const resultsCount = document.getElementById('resultsCount');

        if (!this.currentSearchTerm && this.currentCategory === 'all') {
            this.clearSearch();
            return;
        }

        this.isSearching = true;

        if (promptsContainer) {
            promptsContainer.innerHTML = `
                <div class="search-loading">
                    <i class="fas fa-spinner fa-spin fa-2x"></i>
                    <p>Searching prompts...</p>
                </div>
            `;
        }

        setTimeout(() => {
            const filteredPrompts = this.filterPrompts();
            this.displaySearchResults(filteredPrompts);
            
            if (resultsCount && resultsInfo) {
                resultsCount.textContent = `Found ${filteredPrompts.length} prompts matching your search`;
                resultsInfo.style.display = 'flex';
            }
            
            this.isSearching = false;
        }, 500);
    }

    filterPrompts() {
        let filtered = [...allPrompts];

        if (this.currentSearchTerm) {
            const searchTerm = this.currentSearchTerm.toLowerCase();
            filtered = filtered.filter(prompt => {
                const title = (prompt.title || '').toLowerCase();
                const promptText = (prompt.promptText || '').toLowerCase();
                const keywords = prompt.keywords || [];
                
                return title.includes(searchTerm) ||
                       promptText.includes(searchTerm) ||
                       keywords.some(keyword => keyword.toLowerCase().includes(searchTerm));
            });
        }

        if (this.currentCategory !== 'all') {
            filtered = filtered.filter(prompt => prompt.category === this.currentCategory);
        }

        filtered = this.sortPrompts(filtered);

        return filtered;
    }

    sortPrompts(prompts) {
        switch (this.currentSort) {
            case 'recent':
                return prompts.sort((a, b) => {
                    const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
                    const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
                    return dateB - dateA;
                });
            case 'popular':
                return prompts.sort((a, b) => {
                    const aScore = (a.likes || 0) + (a.views || 0);
                    const bScore = (b.likes || 0) + (b.views || 0);
                    return bScore - aScore;
                });
            case 'likes':
                return prompts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
            case 'views':
                return prompts.sort((a, b) => (b.views || 0) - (a.views || 0));
            default:
                return prompts;
        }
    }

    displaySearchResults(prompts) {
        const promptsContainer = document.getElementById('promptsContainer');
        
        if (!promptsContainer) return;
        
        if (!prompts || prompts.length === 0) {
            promptsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <h3>No prompts found</h3>
                    <p>Try adjusting your search terms or filters</p>
                    <button class="btn-outline" onclick="searchManager.clearSearch()" style="margin-top: 20px;">
                        Show All Prompts
                    </button>
                </div>
            `;
            return;
        }

        promptsContainer.innerHTML = '';
        
        prompts.forEach((prompt, index) => {
            if (!prompt) return;
            
            const promptCard = window.youtubePrompts.createShortsPrompt(prompt, index);
            if (promptCard) {
                promptCard.style.opacity = '0';
                promptCard.style.transform = 'translateY(20px)';
                promptCard.style.transition = `opacity 0.3s ease ${index * 0.05}s, transform 0.3s ease ${index * 0.05}s`;
                
                promptsContainer.appendChild(promptCard);
                
                setTimeout(() => {
                    promptCard.style.opacity = '1';
                    promptCard.style.transform = 'translateY(0)';
                }, 100 + (index * 50));
            }
        });
    }

    clearSearch() {
        const searchInput = document.getElementById('searchInput');
        const categoryFilter = document.getElementById('categoryFilter');
        const sortBy = document.getElementById('sortBy');
        const resultsInfo = document.getElementById('searchResultsInfo');
        
        if (searchInput) searchInput.value = '';
        if (categoryFilter) categoryFilter.value = 'all';
        if (sortBy) sortBy.value = 'recent';
        
        this.currentSearchTerm = '';
        this.currentCategory = 'all';
        this.currentSort = 'recent';
        
        if (resultsInfo) resultsInfo.style.display = 'none';
        this.isSearching = false;
        
        if (window.youtubePrompts) {
            youtubePrompts.currentPage = 1;
            youtubePrompts.hasMore = true;
            youtubePrompts.loadInitialPrompts();
        }
    }
}

// ==================== NEWS UPLOAD MODAL ====================

function initNewsImagePreview() {
    const newsImageUpload = document.getElementById('newsImageUpload');
    const newsImagePreview = document.getElementById('newsImagePreview');
    
    if (newsImageUpload && newsImagePreview) {
        newsImageUpload.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    newsImagePreview.src = e.target.result;
                    newsImagePreview.style.display = 'block';
                }
                reader.readAsDataURL(file);
            } else {
                newsImagePreview.style.display = 'none';
            }
        });
        
        const fileUploadArea = document.querySelector('#newsUploadModal .file-upload');
        if (fileUploadArea) {
            fileUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUploadArea.style.borderColor = '#4e54c8';
                fileUploadArea.style.background = 'rgba(78, 84, 200, 0.05)';
            });
            
            fileUploadArea.addEventListener('dragleave', () => {
                fileUploadArea.style.borderColor = '#ddd';
                fileUploadArea.style.background = '';
            });
            
            fileUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUploadArea.style.borderColor = '#ddd';
                fileUploadArea.style.background = '';
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    newsImageUpload.files = files;
                    const event = new Event('change', { bubbles: true });
                    newsImageUpload.dispatchEvent(event);
                }
            });
        }
    }
}

function initNewsUploadModal() {
    const newsModal = document.getElementById('newsUploadModal');
    const openNewsBtn = document.getElementById('openNewsModal');
    const closeNewsModalBtn = document.getElementById('closeNewsModal');
    const newsForm = document.getElementById('newsForm');
    
    if (openNewsBtn && newsModal) {
        openNewsBtn.addEventListener('click', () => {
            const user = checkAuth();
            if (!user) {
                alert('Please login to publish news');
                window.location.href = 'login.html?returnUrl=' + encodeURIComponent(window.location.href);
                return;
            }
            
            newsModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
    
    if (closeNewsModalBtn && newsModal) {
        closeNewsModalBtn.addEventListener('click', () => {
            newsModal.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    if (newsModal) {
        newsModal.addEventListener('click', (e) => {
            if (e.target === newsModal) {
                newsModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
    
    if (newsForm) {
        newsForm.addEventListener('submit', handleNewsSubmit);
    }
    
    initNewsImagePreview();
}

async function handleNewsSubmit(e) {
    e.preventDefault();
    
    const user = checkAuth();
    if (!user) {
        alert('Please login to publish news');
        return;
    }
    
    const title = document.getElementById('newsTitle')?.value || '';
    const content = document.getElementById('newsContent')?.value || '';
    const excerpt = document.getElementById('newsExcerpt')?.value || '';
    const category = document.getElementById('newsCategory')?.value || 'ai-news';
    const tags = document.getElementById('newsTags')?.value || '';
    const isBreaking = document.getElementById('isBreaking')?.checked || false;
    const isFeatured = document.getElementById('isFeatured')?.checked || false;
    const file = document.getElementById('newsImageUpload')?.files[0];
    
    if (!title || !content) {
        alert('Please fill in title and content');
        return;
    }
    
    try {
        const submitBtn = document.querySelector('#newsForm .submit-btn');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';
        submitBtn.disabled = true;
        
        await initializeFirebase();
        const firebaseUser = await getCurrentUser();
        
        if (!firebaseUser) {
            throw new Error('User not authenticated');
        }
        
        const formData = new FormData();
        formData.append('title', title);
        formData.append('content', content);
        formData.append('excerpt', excerpt);
        formData.append('category', category);
        formData.append('tags', tags);
        formData.append('isBreaking', isBreaking);
        formData.append('isFeatured', isFeatured);
        formData.append('author', user.name || 'User');
        if (file) formData.append('image', file);
        
        const response = await fetch('/api/upload-news', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`News publication failed with status ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            const newsModal = document.getElementById('newsUploadModal');
            const newsForm = document.getElementById('newsForm');
            const newsImagePreview = document.getElementById('newsImagePreview');
            
            newsModal.classList.remove('active');
            document.body.style.overflow = '';
            newsForm.reset();
            
            if (newsImagePreview) {
                newsImagePreview.style.display = 'none';
            }
            
            showNotification('News published successfully!', 'success');
            
            if (window.newsManager) {
                newsManager.loadNews();
            }
        }
    } catch (error) {
        console.error('News publication error:', error);
        showNotification(`News publication failed: ${error.message}`, 'error');
    } finally {
        const submitBtn = document.querySelector('#newsForm .submit-btn');
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fas fa-newspaper"></i> Publish News';
            submitBtn.disabled = false;
        }
    }
}

// ==================== VIDEO THUMBNAIL UPLOAD ====================

function initVideoThumbnailUpload() {
    const videoUpload = document.getElementById('imageUpload');
    const videoThumbnailUpload = document.getElementById('videoThumbnailUpload');
    const videoThumbnailPreview = document.getElementById('videoThumbnailPreview');
    const videoThumbnailSection = document.getElementById('videoThumbnailSection');
    const fileTypeHint = document.getElementById('fileTypeHint');
    
    if (videoUpload) {
        videoUpload.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const isVideo = file.type.startsWith('video/');
                
                if (videoThumbnailSection) {
                    videoThumbnailSection.style.display = isVideo ? 'block' : 'none';
                }
                
                if (fileTypeHint) {
                    if (isVideo) {
                        fileTypeHint.innerHTML = '<i class="fas fa-play"></i> Video reel detected. You can upload a custom thumbnail below.';
                        fileTypeHint.style.color = '#ff6b6b';
                    } else {
                        fileTypeHint.innerHTML = '<i class="fas fa-image"></i> Image uploaded';
                        fileTypeHint.style.color = '#4e54c8';
                    }
                }
                
                const reader = new FileReader();
                reader.onload = function(e) {
                    const imagePreview = document.getElementById('imagePreview');
                    if (imagePreview) {
                        imagePreview.src = e.target.result;
                        imagePreview.style.display = 'block';
                    }
                }
                reader.readAsDataURL(file);
            }
        });
    }
    
    if (videoThumbnailUpload) {
        videoThumbnailUpload.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    if (videoThumbnailPreview) {
                        videoThumbnailPreview.src = e.target.result;
                        videoThumbnailPreview.style.display = 'block';
                    }
                }
                reader.readAsDataURL(file);
            } else {
                if (videoThumbnailPreview) {
                    videoThumbnailPreview.style.display = 'none';
                }
            }
        });
        
        const thumbnailUploadArea = document.querySelector('.thumbnail-upload');
        if (thumbnailUploadArea) {
            thumbnailUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                thumbnailUploadArea.style.borderColor = '#ff6b6b';
                thumbnailUploadArea.style.background = 'rgba(255, 107, 107, 0.05)';
            });
            
            thumbnailUploadArea.addEventListener('dragleave', () => {
                thumbnailUploadArea.style.borderColor = '#ddd';
                thumbnailUploadArea.style.background = '';
            });
            
            thumbnailUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                thumbnailUploadArea.style.borderColor = '#ddd';
                thumbnailUploadArea.style.background = '';
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    videoThumbnailUpload.files = files;
                    const event = new Event('change', { bubbles: true });
                    videoThumbnailUpload.dispatchEvent(event);
                }
            });
        }
    }
}

// ==================== UPLOAD MODAL ====================

function initUploadModal() {
    const uploadModal = document.getElementById('uploadModal');
    const openUploadBtn = document.getElementById('openUploadModal');
    const closeModalBtn = document.getElementById('closeModal');
    const uploadForm = document.getElementById('uploadForm');
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    
    if (openUploadBtn && uploadModal) {
        openUploadBtn.addEventListener('click', () => {
            const user = checkAuth();
            if (!user) {
                alert('Please login to upload creations');
                window.location.href = 'login.html?returnUrl=' + encodeURIComponent(window.location.href);
                return;
            }
            
            uploadModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
    
    if (closeModalBtn && uploadModal) {
        closeModalBtn.addEventListener('click', () => {
            uploadModal.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    if (uploadModal) {
        uploadModal.addEventListener('click', (e) => {
            if (e.target === uploadModal) {
                uploadModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
    
    if (imageUpload && imagePreview) {
        imageUpload.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    imagePreview.src = e.target.result;
                    imagePreview.style.display = 'block';
                }
                reader.readAsDataURL(file);
            } else {
                imagePreview.style.display = 'none';
            }
        });
        
        const fileUploadArea = document.querySelector('.file-upload');
        if (fileUploadArea) {
            fileUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUploadArea.style.borderColor = '#4e54c8';
                fileUploadArea.style.background = 'rgba(78, 84, 200, 0.05)';
            });
            
            fileUploadArea.addEventListener('dragleave', () => {
                fileUploadArea.style.borderColor = '#ddd';
                fileUploadArea.style.background = '';
            });
            
            fileUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUploadArea.style.borderColor = '#ddd';
                fileUploadArea.style.background = '';
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    imageUpload.files = files;
                    const event = new Event('change', { bubbles: true });
                    imageUpload.dispatchEvent(event);
                }
            });
        }
    }
    
    if (uploadForm) {
        uploadForm.addEventListener('submit', handleUploadSubmit);
    }
    
    initVideoThumbnailUpload();
}

// ==================== MOBILE FUNCTIONS ====================

function initMobileNavigation() {
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileToggle && navLinks) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            const icon = mobileToggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
            }
        });
        
        const navLinksItems = navLinks.querySelectorAll('a');
        navLinksItems.forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                const icon = mobileToggle.querySelector('i');
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-times');
                }
            });
        });
    }
}

function addMobileNavigation() {
    if (window.innerWidth <= 768) {
        const mobileNav = document.createElement('div');
        mobileNav.className = 'mobile-nav';
        mobileNav.innerHTML = `
            <a href="index.html" class="nav-item active">
                <i class="fas fa-home"></i>
                <span>Home</span>
            </a>
            <button class="nav-item" id="mobileShortsBtn">
                <i class="fas fa-play"></i>
                <span>Shorts</span>
            </button>
            <a href="dashboard.html" class="nav-item">
                <i class="fas fa-chart-line"></i>
                <span>Dashboard</span>
            </a>
            <button class="nav-item" id="mobileUploadBtn">
                <i class="fas fa-plus-circle"></i>
                <span>Sell</span>
            </button>
            <a href="ai-detector.html" class="nav-item">
                <i class="fas fa-cloud-upload-alt"></i>
                <span>Ai-Detector</span>
            </a>
        `;
        
        document.body.appendChild(mobileNav);
        
        const mobileUploadBtn = document.getElementById('mobileUploadBtn');
        if (mobileUploadBtn) {
            mobileUploadBtn.addEventListener('click', () => {
                const uploadModalBtn = document.getElementById('openUploadModal');
                if (uploadModalBtn) {
                    uploadModalBtn.click();
                }
            });
        }
        
        const mobileShortsBtn = document.getElementById('mobileShortsBtn');
        if (mobileShortsBtn) {
            mobileShortsBtn.addEventListener('click', () => {
                filterByVideos();
            });
        }
    }
}

function initMobileHorizontalScroll() {
    if (window.innerWidth <= 768) {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (trackContainer) {
            trackContainer.style.overflowX = 'auto';
            trackContainer.style.webkitOverflowScrolling = 'touch';
            
            trackContainer.addEventListener('scroll', () => {
                if (window.shortsHorizontalFeed) {
                    window.shortsHorizontalFeed.updateNavigation();
                }
            });
        }
    }
}

function initFilterButtons() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const filter = btn.textContent ? btn.textContent.toLowerCase() : 'all';
            
            if (window.youtubePrompts) {
                youtubePrompts.currentPage = 1;
                youtubePrompts.hasMore = true;
                youtubePrompts.loadInitialPrompts();
            }
        });
    });
}

function initScrollEffects() {
    window.addEventListener('scroll', () => {
        const header = document.querySelector('header');
        if (header) {
            if (window.scrollY > 100) {
                header.style.background = 'rgba(255, 255, 255, 0.98)';
                header.style.backdropFilter = 'blur(10px)';
                header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.15)';
            } else {
                header.style.background = 'rgba(255, 255, 255, 0.95)';
                header.style.backdropFilter = 'blur(5px)';
                header.style.boxShadow = '0 2px 15px rgba(0, 0, 0, 0.1)';
            }
        }
    });
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Initializing tools prompt with marketplace features and Razorpay...');
    
    await initializeFirebase();
    showAuthElements();
    await getRazorpayKey();
    initMobileNavigation();
    initFilterButtons();
    initScrollEffects();
    initUploadModal();
    initNewsUploadModal();
    initSearchFunctionality();
    
    window.youtubePrompts = new YouTubeStylePrompts();
    window.shortsHorizontalFeed = new ShortsHorizontalFeed();
    window.shortsHorizontalFeed.startAutoRefresh();
    window.youtubePrompts.startAutoRefresh();
    window.categoryManager = new CategoryManager();
    window.searchManager = new SearchManager();
    await searchManager.init();
    window.newsManager = new NewsManager();
    if (document.getElementById('newsContainer')) newsManager.loadNews();
    addMobileNavigation();
    initMobileHorizontalScroll();
    addDashboardButton();
    if (!window.horizontalFeedManager) window.horizontalFeedManager = new HorizontalFeedManager();
    initHorizontalFeedTouchSupport();
    setTimeout(() => {
        if (window.horizontalFeedManager) window.horizontalFeedManager.initializeAllFeeds();
    }, 1500);
    setTimeout(() => addShortsFilterButton(), 2000);
    window.addEventListener('resize', initMobileHorizontalScroll);
    console.log('tools prompt initialization complete with marketplace features and Razorpay');
});

window.loadUploads = () => { if (window.youtubePrompts) youtubePrompts.loadInitialPrompts(); };
window.searchManager = window.searchManager || {};
window.newsManager = window.newsManager || {};
window.categoryManager = window.categoryManager || {};
window.shortsHorizontalFeed = window.shortsHorizontalFeed || {};
window.horizontalFeedManager = window.horizontalFeedManager || {};
window.shortsPlayer = window.shortsPlayer || {};
window.videoHoverManager = window.videoHoverManager || {};
window.hoverConfig = hoverConfig;
window.updateHoverConfig = updateHoverConfig;
window.openShortsPlayer = openShortsPlayer;
window.filterByVideos = filterByVideos;
window.showBuyPromptModal = showBuyPromptModal;
window.closeBuyModal = closeBuyModal;

window.addEventListener('beforeunload', () => {
    if (window.videoHoverManager) window.videoHoverManager.cleanup();
});