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
const PROMPT_CACHE_DURATION = 15000; // REDUCED: 15 seconds

// Hover autoplay configuration
const hoverConfig = {
    enabled: true,
    delay: 100, // ms before playing on hover
    mobileDelay: 0, // instant on mobile
    pauseOnScroll: true,
    muteByDefault: true, // Must be true for autoplay to work
    loop: true,
    preload: 'metadata', // 'metadata', 'auto', 'none'
    playOnFocus: true, // Play when element receives focus
    playOnTouch: true, // Play on touch for mobile
    thumbnailOpacity: 0 // Opacity of thumbnail when video is playing (0 = hidden)
};

// Add this to your existing script.js file or include it in a script tag
document.addEventListener('DOMContentLoaded', function() {
    // Add scroll effect to header for desktop
    const header = document.getElementById('mainHeader');
    
    function handleScroll() {
        if (window.scrollY > 10) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }
    
    // Apply scroll effect for desktop
    if (window.innerWidth >= 769) {
        window.addEventListener('scroll', handleScroll);
    }
    
    // Re-apply on resize
    window.addEventListener('resize', function() {
        if (window.innerWidth >= 769) {
            window.addEventListener('scroll', handleScroll);
        } else {
            window.removeEventListener('scroll', handleScroll);
            header.classList.remove('scrolled');
        }
    });
});

// Track Firebase initialization state
let firebaseInitialized = false;

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
        <a href="login.html" class="login-btn">Login</a>
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

// Enhanced Search Functionality with Better Mobile Support
function initSearchFunctionality() {
    const searchIconButton = document.getElementById('searchIconButton');
    const searchExpandable = document.getElementById('searchExpandable');
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchSuggestions = document.getElementById('searchSuggestions');

    // Enhanced toggle with smooth animations
    if (searchIconButton && searchExpandable) {
        searchIconButton.addEventListener('click', function(e) {
            e.stopPropagation();
            const isActive = searchExpandable.classList.contains('active');
            
            if (isActive) {
                // Smooth close animation
                searchExpandable.style.transform = 'translateY(-10px)';
                searchExpandable.style.opacity = '0';
                setTimeout(() => {
                    searchExpandable.classList.remove('active');
                }, 200);
            } else {
                // Smooth open animation
                searchExpandable.classList.add('active');
                setTimeout(() => {
                    searchExpandable.style.transform = 'translateY(5px)';
                    searchExpandable.style.opacity = '1';
                }, 10);
                
                // Focus on input with slight delay for better UX
                setTimeout(() => {
                    if (searchInput) {
                        searchInput.focus();
                        // Show keyboard on mobile
                        searchInput.setAttribute('inputmode', 'search');
                    }
                }, 150);
            }
        });
    }

    // Enhanced mobile touch support for search input
    if (searchInput) {
        // Better touch handling for mobile
        searchInput.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: true });

        searchInput.addEventListener('touchend', function(e) {
            e.stopPropagation();
            // Prevent focus loss on mobile
            this.focus();
        }, { passive: true });

        // Improved input handling with debouncing
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
            }, 150); // Reduced debounce time for better responsiveness
        });

        // Enhanced keyboard handling
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeSearch();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusFirstSuggestion();
            }
        });

        // Better focus handling for mobile
        searchInput.addEventListener('focus', function() {
            if (this.value.trim() === '') {
                showRecentSearches();
            }
        });
    }

    // Enhanced search button with better touch feedback
    if (searchButton) {
        // Add touch feedback
        searchButton.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.95)';
        }, { passive: true });

        searchButton.addEventListener('touchend', function() {
            this.style.transform = 'scale(1)';
            performSearch(searchInput.value);
        }, { passive: true });

        searchButton.addEventListener('click', function(e) {
            e.preventDefault();
            performSearch(searchInput.value);
        });
    }

    // Enhanced outside click detection
    document.addEventListener('click', function(e) {
        if (searchExpandable && searchIconButton && 
            !searchExpandable.contains(e.target) && 
            !searchIconButton.contains(e.target)) {
            closeSearch();
        }
    });

    // Enhanced touch support for search expandable
    if (searchExpandable) {
        searchExpandable.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: true });

        searchExpandable.addEventListener('touchmove', function(e) {
            e.stopPropagation();
        }, { passive: true });

        searchExpandable.addEventListener('touchend', function(e) {
            e.stopPropagation();
        }, { passive: true });
    }

    // Keyboard navigation for suggestions
    document.addEventListener('keydown', function(e) {
        if (!searchExpandable.classList.contains('active')) return;

        const suggestions = searchSuggestions.querySelectorAll('.suggestion-item');
        const focusedSuggestion = searchSuggestions.querySelector('.suggestion-item:focus');
        
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (!focusedSuggestion) {
                    focusFirstSuggestion();
                } else {
                    focusNextSuggestion(focusedSuggestion);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (focusedSuggestion) {
                    focusPreviousSuggestion(focusedSuggestion);
                }
                break;
            case 'Enter':
                if (focusedSuggestion) {
                    e.preventDefault();
                    focusedSuggestion.click();
                }
                break;
        }
    });
}

// Enhanced search performance with better mobile support
function performSearch(query) {
    if (!query || !query.trim()) {
        showNotification('Please enter a search term', 'error');
        return;
    }

    const searchExpandable = document.getElementById('searchExpandable');
    const searchInput = document.getElementById('searchInput');

    // Smooth close animation
    if (searchExpandable) {
        searchExpandable.style.transform = 'translateY(-10px)';
        searchExpandable.style.opacity = '0';
        setTimeout(() => {
            searchExpandable.classList.remove('active');
            searchExpandable.style.transform = '';
            searchExpandable.style.opacity = '';
        }, 200);
    }

    // Add to recent searches
    addToRecentSearches(query);

    // Show loading state with better mobile optimization
    showNotification(`Searching for: "${query}"`, 'info');

    // Use requestAnimationFrame for smoother performance
    requestAnimationFrame(() => {
        if (window.searchManager) {
            searchManager.currentSearchTerm = query;
            searchManager.showSearchResults();
        } else if (window.youtubePrompts) {
            // Fallback: filter prompts by search term
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

    // Clear input and hide suggestions
    if (searchInput) {
        searchInput.value = '';
    }
    hideSearchSuggestions();

    // Blur input to hide keyboard on mobile after search
    setTimeout(() => {
        if (searchInput) searchInput.blur();
    }, 300);
}

// Enhanced search suggestions with better mobile touch
function showSearchSuggestions(query) {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;

    // Show loading state
    searchSuggestions.innerHTML = `
        <div class="suggestion-item">
            <i class="fas fa-spinner fa-spin suggestion-icon"></i>
            <span>Searching...</span>
        </div>
    `;
    searchSuggestions.style.display = 'block';

    // Simulate API call with better mobile performance
    setTimeout(() => {
        const mockSuggestions = [
            { text: `${query} art`, category: 'art', icon: 'fas fa-palette' },
            { text: `${query} photography`, category: 'photography', icon: 'fas fa-camera' },
            { text: `${query} design`, category: 'design', icon: 'fas fa-pencil-ruler' },
            { text: `${query} AI`, category: 'ai', icon: 'fas fa-robot' },
            { text: `${query} video`, category: 'video', icon: 'fas fa-video' }
        ];

        const suggestionsHTML = mockSuggestions.map(suggestion => `
            <div class="suggestion-item" 
                 data-query="${suggestion.text}"
                 tabindex="0"
                 role="button"
                 aria-label="Search for ${suggestion.text}">
                <i class="${suggestion.icon} suggestion-icon"></i>
                <div class="suggestion-text">${suggestion.text}</div>
                <span class="suggestion-category">${suggestion.category}</span>
            </div>
        `).join('');

        searchSuggestions.innerHTML = suggestionsHTML;
        
        // Enhanced touch/click handlers for suggestions
        searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            // Click handler
            item.addEventListener('click', function() {
                handleSuggestionClick(this.getAttribute('data-query'));
            });

            // Touch handlers for better mobile
            item.addEventListener('touchstart', function() {
                this.style.background = '#f0f0f0';
            }, { passive: true });

            item.addEventListener('touchend', function() {
                this.style.background = '';
                handleSuggestionClick(this.getAttribute('data-query'));
            }, { passive: true });

            item.addEventListener('touchcancel', function() {
                this.style.background = '';
            }, { passive: true });

            // Keyboard support
            item.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSuggestionClick(this.getAttribute('data-query'));
                }
            });
        });

    }, 200); // Reduced delay for better responsiveness
}

// Helper function for suggestion clicks
function handleSuggestionClick(query) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = query;
        searchInput.focus(); // Keep focus for better UX
    }
    performSearch(query);
}

// Enhanced recent searches with mobile optimization
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
                 role="button"
                 aria-label="Search for ${search}">
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

        // Add handlers for recent searches
        searchSuggestions.querySelectorAll('.suggestion-item:not(:first-child):not(:last-child)').forEach(item => {
            setupSuggestionHandlers(item);
        });

        // Clear recent searches handler
        const clearBtn = document.getElementById('clearRecentSearches');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearRecentSearches);
        }
    }

    searchSuggestions.style.display = 'block';
}

// Setup suggestion handlers
function setupSuggestionHandlers(item) {
    const query = item.getAttribute('data-query');
    
    item.addEventListener('click', () => handleSuggestionClick(query));
    
    item.addEventListener('touchstart', function() {
        this.style.background = '#f0f0f0';
    }, { passive: true });

    item.addEventListener('touchend', function() {
        this.style.background = '';
        handleSuggestionClick(query);
    }, { passive: true });
}

// Enhanced keyboard navigation functions
function focusFirstSuggestion() {
    const suggestions = document.querySelectorAll('.suggestion-item');
    if (suggestions.length > 0) {
        suggestions[0].focus();
    }
}

function focusNextSuggestion(current) {
    const next = current.nextElementSibling;
    if (next && next.classList.contains('suggestion-item')) {
        next.focus();
    }
}

function focusPreviousSuggestion(current) {
    const prev = current.previousElementSibling;
    if (prev && prev.classList.contains('suggestion-item')) {
        prev.focus();
    }
}

// Enhanced close search function
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
    
    // Blur input to hide keyboard on mobile
    if (searchInput) {
        searchInput.blur();
    }
}

// Clear recent searches
function clearRecentSearches() {
    localStorage.removeItem('recentSearches');
    showRecentSearches(); // Refresh the display
    showNotification('Recent searches cleared', 'success');
}

// Enhanced Horizontal Feed Scrolling Functionality
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
        // This will be called when horizontal feeds are created
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
        // Store feed reference
        this.feeds.set(track, {
            id: feedId,
            controls: controls,
            isDragging: false,
            startX: 0,
            scrollLeft: 0
        });

        // Setup navigation controls
        this.setupFeedControls(track, controls);
        
        // Setup touch/swipe for mobile
        this.setupTouchScrolling(track);
        
        // Setup mouse drag for desktop
        this.setupMouseScrolling(track);
        
        // Setup keyboard navigation
        this.setupKeyboardNavigation(track);
        
        // Initial control state update
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

        // Update controls on scroll
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
            track.style.scrollSnapType = 'none'; // Disable snap while dragging
        }, { passive: true });

        track.addEventListener('touchmove', (e) => {
            if (!feedData.isDragging) return;
            
            e.preventDefault();
            const x = e.touches[0].pageX;
            const walk = (x - feedData.startX) * 2; // Multiply for better feel
            track.scrollLeft = feedData.scrollLeft - walk;
        }, { passive: false });

        track.addEventListener('touchend', () => {
            feedData.isDragging = false;
            track.style.cursor = 'grab';
            
            // Re-enable snap scrolling on mobile after drag
            if (window.innerWidth <= 768) {
                track.style.scrollSnapType = 'x mandatory';
                this.snapToNearestItem(track);
            }
        });

        track.addEventListener('touchcancel', () => {
            feedData.isDragging = false;
            track.style.cursor = 'grab';
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

        track.addEventListener('mouseleave', () => {
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

        // Make horizontal items focusable
        const items = track.querySelectorAll('.horizontal-prompt-item');
        items.forEach((item, index) => {
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-label', `Prompt ${index + 1}`);
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

        // Update controls after scroll
        setTimeout(() => {
            const feedData = this.feeds.get(track);
            if (feedData && feedData.controls) {
                this.updateFeedControls(track, feedData.controls);
            }
        }, 300);
    }

    getItemWidth(track) {
        const item = track.querySelector('.horizontal-prompt-item');
        if (!item) return 200; // Default fallback
        
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
        
        // Show/hide previous button
        prevBtn.disabled = scrollLeft <= 10;
        prevBtn.style.opacity = scrollLeft <= 10 ? '0.5' : '1';
        
        // Show/hide next button
        nextBtn.disabled = scrollLeft >= scrollWidth - clientWidth - 10;
        nextBtn.style.opacity = scrollLeft >= scrollWidth - clientWidth - 10 ? '0.5' : '1';
    }

    setupEventListeners() {
        // Reinitialize feeds when new content is added
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

        // Reinitialize on window resize
        window.addEventListener('resize', () => {
            this.feeds.forEach((feedData, track) => {
                if (feedData.controls) {
                    this.updateFeedControls(track, feedData.controls);
                }
            });
        });
    }

    // Public method to add a new feed
    addFeed(track, controls, feedId) {
        this.initializeFeed(track, controls, feedId);
    }
}

// Global horizontal feed manager instance
window.horizontalFeedManager = new HorizontalFeedManager();

// Update the existing scrollHorizontalFeed function to use the new manager
function scrollHorizontalFeed(button, direction) {
    const controls = button.closest('.horizontal-controls');
    const feedSection = controls.closest('.horizontal-feed-section');
    const track = feedSection.querySelector('.horizontal-feed-track');
    
    if (track && window.horizontalFeedManager) {
        window.horizontalFeedManager.scrollFeed(track, direction);
    }
}

// Add touch support for horizontal feed items
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

        // Add touch feedback for horizontal items
        document.addEventListener('touchstart', function(e) {
            const horizontalItem = e.target.closest('.horizontal-prompt-item');
            if (horizontalItem) {
                horizontalItem.style.transform = 'scale(0.98)';
            }
        }, { passive: true });

        document.addEventListener('touchend', function(e) {
            const horizontalItem = e.target.closest('.horizontal-prompt-item');
            if (horizontalItem) {
                horizontalItem.style.transform = '';
            }
        }, { passive: true });
    });
}

// ========== VIDEO HOVER AUTOPLAY MANAGER ==========
class VideoHoverManager {
    constructor() {
        this.hoverVideos = new Map(); // Store video elements and their states
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
        // Use event delegation for dynamically added content
        document.addEventListener('mouseover', this.handleMouseOver.bind(this));
        document.addEventListener('mouseout', this.handleMouseOut.bind(this));
        
        // Touch events for mobile
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });
        document.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: true });
        
        // Scroll handling to pause videos when scrolling
        window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
        
        // Focus handling for keyboard navigation
        document.addEventListener('focusin', this.handleFocusIn.bind(this));
        document.addEventListener('focusout', this.handleFocusOut.bind(this));
    }

    handleMouseOver(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        // Clear any pending timeout
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
        }

        // Small delay to prevent accidental hovers
        this.hoverTimeout = setTimeout(() => {
            this.playHoverVideo(videoItem);
        }, hoverConfig.delay);
    }

    handleMouseOut(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        // Clear timeout
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }

        // Small delay before pausing to allow moving between items
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

        // Remove active class from other items
        document.querySelectorAll('.shorts-prompt-card.touch-active, .horizontal-prompt-item.touch-active').forEach(item => {
            if (item !== videoItem) {
                item.classList.remove('touch-active');
                this.pauseHoverVideo(item);
            }
        });

        // Clear previous timeout
        if (this.mobileTouchTimeout) {
            clearTimeout(this.mobileTouchTimeout);
        }

        // Add touch active class
        videoItem.classList.add('touch-active');
        
        // Play video immediately on touch
        this.playHoverVideo(videoItem);
        
        // Prevent default to avoid page scroll
        e.preventDefault();
    }

    handleTouchEnd(e) {
        const videoItem = this.findVideoItem(e.target);
        if (!videoItem) return;

        // Don't pause immediately to allow for better UX
        this.mobileTouchTimeout = setTimeout(() => {
            videoItem.classList.remove('touch-active');
            this.pauseHoverVideo(videoItem);
        }, 2000); // Keep playing for 2 seconds after touch ends
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
        
        // Pause all hover videos when scrolling for performance
        this.hoverVideos.forEach((data, element) => {
            if (data.isPlaying) {
                this.pauseHoverVideo(element);
            }
        });
    }

    setupVisibilityHandler() {
        // Pause videos when tab becomes inactive
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
        // Check if element is a video item or inside one
        return element.closest('.shorts-prompt-card[data-file-type="video"], .horizontal-prompt-item.video-item');
    }

    playHoverVideo(item) {
        if (!item || !hoverConfig.enabled) return;

        const videoContainer = item.querySelector('.hover-video-container');
        const videoPlayer = item.querySelector('.hover-video-player');
        
        if (!videoPlayer || !videoContainer) return;

        // Check if already playing
        const existingData = this.hoverVideos.get(item);
        if (existingData && existingData.isPlaying) return;

        // Show loading if video isn't ready
        const loading = item.querySelector('.hover-video-loading');
        if (loading) loading.style.display = 'block';

        // Set video source if not set
        if (!videoPlayer.src) {
            const promptId = item.dataset.promptId;
            const prompt = allPrompts.find(p => p.id === promptId);
            
            if (prompt && (prompt.videoUrl || prompt.mediaUrl)) {
                videoPlayer.src = prompt.videoUrl || prompt.mediaUrl;
                videoPlayer.load();
            }
        }

        // Ensure video is muted for autoplay
        videoPlayer.muted = true;

        // Play video with promise handling
        const playPromise = videoPlayer.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Hide loading
                    if (loading) loading.style.display = 'none';
                    
                    // Update state
                    this.hoverVideos.set(item, {
                        isPlaying: true,
                        player: videoPlayer,
                        container: videoContainer
                    });
                    
                    // Add active class
                    item.classList.add('hover-active');
                    
                    // Ensure the thumbnail image is hidden or dimmed
                    const thumbnail = item.querySelector('.shorts-image, .horizontal-prompt-image img');
                    if (thumbnail) {
                        thumbnail.style.opacity = hoverConfig.thumbnailOpacity.toString();
                    }
                    
                    // Track view (only once per hover session)
                    if (!item.dataset.viewTracked) {
                        this.trackView(promptId);
                        item.dataset.viewTracked = 'true';
                        
                        // Reset after 30 seconds
                        setTimeout(() => {
                            delete item.dataset.viewTracked;
                        }, 30000);
                    }
                })
                .catch(error => {
                    console.log('Hover autoplay prevented:', error);
                    if (loading) loading.style.display = 'none';
                    
                    // Fallback: try playing on user interaction
                    const playOnInteraction = () => {
                        videoPlayer.play().catch(e => console.log('Still failed:', e));
                        item.removeEventListener('click', playOnInteraction);
                    };
                    item.addEventListener('click', playOnInteraction, { once: true });
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
            videoPlayer.currentTime = 0; // Reset to start
            
            this.hoverVideos.set(item, {
                ...data,
                isPlaying: false
            });
            
            item.classList.remove('hover-active');
            
            // Show thumbnail again
            if (thumbnail) {
                thumbnail.style.opacity = '1';
            }
        }
    }

    trackView(promptId) {
        if (!promptId) return;
        
        // Use the existing view tracking with reduced rate
        fetch(`/api/prompt/${promptId}/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.log('Hover view tracking error:', err));
    }

    // Method to create hover video element for a prompt
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
        
        // Video event listeners
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

    // Clean up method
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

// Initialize the hover manager
window.videoHoverManager = new VideoHoverManager();

// Function to update hover config
window.updateHoverConfig = function(newConfig) {
    Object.assign(hoverConfig, newConfig);
    console.log('Hover config updated:', hoverConfig);
};

// YouTube Shorts Style Horizontal Feed - UPDATED
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

        // Insert after header
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

        // Enhanced Touch/swipe support for mobile
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
                
                // Add active state for visual feedback
                trackContainer.style.cursor = 'grabbing';
            }, { passive: true });

            trackContainer.addEventListener('touchmove', (e) => {
                if (!isScrolling) return;
                
                const x = e.touches[0].pageX;
                const y = e.touches[0].pageY;
                
                // Calculate the distance moved
                const walkX = x - startX;
                const walkY = y - startY;
                
                // Only prevent default if primarily horizontal movement
                if (Math.abs(walkX) > Math.abs(walkY)) {
                    e.preventDefault();
                }
                
                trackContainer.scrollLeft = scrollLeft - walkX;
            }, { passive: false });

            trackContainer.addEventListener('touchend', () => {
                isScrolling = false;
                trackContainer.style.cursor = 'grab';
                
                // Apply snap scrolling on mobile
                if (window.innerWidth <= 768) {
                    this.snapToNearestItem();
                }
            });

            trackContainer.addEventListener('touchcancel', () => {
                isScrolling = false;
                trackContainer.style.cursor = 'grab';
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.scrollShorts(-1);
            if (e.key === 'ArrowRight') this.scrollShorts(1);
        });

        // Infinite scroll detection
        this.setupInfiniteScroll();
        
        // Add cursor style for desktop hover
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

    // Add this new method for snap scrolling
    snapToNearestItem() {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (!trackContainer) return;
        
        const scrollLeft = trackContainer.scrollLeft;
        const itemWidth = 110; // Match the mobile item width
        const gap = 12;
        const totalItemWidth = itemWidth + gap;
        
        const nearestIndex = Math.round(scrollLeft / totalItemWidth);
        const targetScroll = nearestIndex * totalItemWidth;
        
        trackContainer.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });
    }

    // Update the scrollShorts method for better mobile behavior
    scrollShorts(direction) {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (!trackContainer) return;

        const itemWidth = window.innerWidth <= 768 ? 110 : 132;
        const gap = 12;
        const totalItemWidth = itemWidth + gap;
        
        // On mobile, scroll by one item at a time with snap
        if (window.innerWidth <= 768) {
            const scrollAmount = totalItemWidth * direction;
            trackContainer.scrollBy({
                left: scrollAmount,
                behavior: 'smooth'
            });
            
            // Update navigation after scroll completes
            setTimeout(() => this.updateNavigation(), 300);
        } else {
            // Desktop behavior (original code)
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
            
            // REDUCED: Show loading state for only 500ms instead of 1000ms
            const loadingPromise = new Promise(resolve => setTimeout(resolve, 500));
            
            // Get fresh prompts data
            await this.loadAllPrompts();
            
            // Filter prompts from last 24 hours with safe date handling
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
                // Safe sorting
                try {
                    const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
                    const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
                    return dateB - dateA;
                } catch (error) {
                    return 0;
                }
            });

            // Wait for minimum loading time
            await loadingPromise;

            this.displayShorts();
            
        } catch (error) {
            console.error('Error loading latest prompts:', error);
            // On error, show empty state
            this.last24hPrompts = [];
            this.displayShorts();
        } finally {
            this.isLoading = false;
        }
    }

    // Add this method to load all prompts
    async loadAllPrompts() {
        const now = Date.now();
        // Use cache if data is fresh
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
                
                // Validate and sanitize the data
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
                    updatedAt: prompt.updatedAt || new Date().toISOString()
                }));
                
                lastPromptUpdate = now;
                console.log(`Loaded ${allPrompts.length} prompts for feeds`);
            } else {
                throw new Error('Failed to fetch prompts');
            }
        } catch (error) {
            console.error('Error loading prompts for feeds:', error);
            // Keep existing data if available, otherwise use empty array
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

        // Clear track and add items
        this.track.innerHTML = '';
        
        this.last24hPrompts.forEach(prompt => {
            const item = this.createShortItem(prompt);
            this.track.appendChild(item);
        });

        this.updateNavigation();
    }

    createShortItem(prompt) {
        // Safe data access
        const safePrompt = prompt || {};
        const promptId = safePrompt.id || 'unknown';
        const title = safePrompt.title || 'Untitled Prompt';
        const imageUrl = safePrompt.thumbnailUrl || safePrompt.imageUrl || 'https://via.placeholder.com/120x160/4e54c8/white?text=Prompt';
        const views = safePrompt.views || 0;
        const createdAt = safePrompt.createdAt || new Date().toISOString();
        const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl;
        
        const timeAgo = this.getTimeAgo(createdAt);
        const isNew = this.isWithinLastHour(createdAt);

        const item = document.createElement('div');
        item.className = `shorts-item ${isVideo ? 'video-item' : ''}`;
        item.setAttribute('data-prompt-id', promptId);
        item.setAttribute('data-file-type', isVideo ? 'video' : 'image');

        // Create thumbnail container
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'shorts-thumbnail';
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = title;
        img.loading = 'lazy';
        img.onerror = function() { this.src = 'https://via.placeholder.com/120x160/4e54c8/white?text=Prompt'; };
        thumbnailDiv.appendChild(img);
        
        if (isVideo) {
            const badge = document.createElement('div');
            badge.className = 'video-reel-badge';
            badge.innerHTML = '<i class="fas fa-play"></i> Reel';
            thumbnailDiv.appendChild(badge);
            
            // Add hover video container
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

        // Add click handler
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
        // Load more when near the end of horizontal scroll
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
        // This can be extended to load more prompts if needed
        console.log('Loading more shorts...');
        // Implementation for infinite horizontal loading
    }

   openPromptPage(promptId) {
        if (promptId && promptId !== 'unknown') {
            const currentHost = window.location.hostname;
            let targetUrl = `/prompt/${promptId}`;
            
            // If on non-www version in production, redirect to www
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
        // Handle undefined, null, or non-numeric values
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

    // Method to refresh the feed with new prompts
    async refreshFeed() {
        await this.loadAllPrompts(); // Refresh the global data first
        await this.loadLatestPrompts();
    }

    // Auto-refresh every 2 minutes to check for new prompts
    startAutoRefresh() {
        setInterval(async () => {
            await this.refreshFeed();
        }, 2 * 60 * 1000);
    }
}

// Initialize mobile horizontal scrolling
function initMobileHorizontalScroll() {
    if (window.innerWidth <= 768) {
        const trackContainer = document.querySelector('.shorts-track-container');
        if (trackContainer) {
            // Ensure proper touch scrolling
            trackContainer.style.overflowX = 'auto';
            trackContainer.style.webkitOverflowScrolling = 'touch';
            
            // Add scroll event listener to update navigation
            trackContainer.addEventListener('scroll', () => {
                if (window.shortsHorizontalFeed) {
                    window.shortsHorizontalFeed.updateNavigation();
                }
            });
        }
    }
}

// YouTube-style Category Manager
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
        // Load user's search history categories
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
        
        // Don't add if it's already in default categories
        if (this.defaultCategories.includes(category)) return;

        // Remove if already exists (to move to front)
        const existingIndex = this.searchCategories.indexOf(category);
        if (existingIndex > -1) {
            this.searchCategories.splice(existingIndex, 1);
        }

        // Add to beginning
        this.searchCategories.unshift(category);

        // Limit the number of search categories
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
        // Category button clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.category-btn')) {
                const categoryBtn = e.target.closest('.category-btn');
                const category = categoryBtn.dataset.category;
                this.selectCategory(category);
            }
        });

        // Navigation arrows
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

            // Show/hide arrows based on scroll position
            scrollContainer.addEventListener('scroll', () => {
                this.updateNavigation();
            });
        }

        // Handle window resize
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
        if (window.innerWidth <= 768) return; // Don't show arrows on mobile

        const scrollContainer = document.getElementById('categoriesScroll');
        const prevBtn = document.getElementById('categoryPrev');
        const nextBtn = document.getElementById('categoryNext');

        if (!scrollContainer || !prevBtn || !nextBtn) return;

        const scrollLeft = scrollContainer.scrollLeft;
        const scrollWidth = scrollContainer.scrollWidth;
        const clientWidth = scrollContainer.clientWidth;

        // Show/hide previous button
        if (scrollLeft <= 10) {
            prevBtn.classList.add('hidden');
        } else {
            prevBtn.classList.remove('hidden');
        }

        // Show/hide next button
        if (scrollLeft >= scrollWidth - clientWidth - 10) {
            nextBtn.classList.add('hidden');
        } else {
            nextBtn.classList.remove('hidden');
        }
    }

    selectCategory(category) {
        this.currentCategory = category;
        
        // Update active state
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`[data-category="${category}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        // Filter prompts based on category
        this.filterPromptsByCategory(category);
        
        // Show notification for search-based categories
        if (!this.defaultCategories.includes(category)) {
            showNotification(`Showing results for: ${this.getCategoryDisplayName(category)}`, 'info');
        }
    }

    filterPromptsByCategory(category) {
        if (window.youtubePrompts) {
            // Reset to first page
            youtubePrompts.currentPage = 1;
            youtubePrompts.hasMore = true;
            
            if (category === 'all') {
                // Show all prompts
                youtubePrompts.loadInitialPrompts();
            } else if (this.defaultCategories.includes(category)) {
                // Filter by default category
                youtubePrompts.filterByCategory(category);
            } else {
                // Filter by search term (dynamic category)
                youtubePrompts.filterBySearchTerm(category);
            }
        }
    }
}

// News Manager Class
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
    // Handle undefined, null, or non-numeric values
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

// News Image Preview Functionality
function initNewsImagePreview() {
  const newsImageUpload = document.getElementById('newsImageUpload');
  const newsImagePreview = document.getElementById('newsImagePreview');
  
  if (newsImageUpload && newsImagePreview) {
    // File input change event
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
    
    // Drag and drop functionality
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

// News Upload Modal Functionality
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
  
  // Initialize image preview for news upload
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
      
      // Hide the image preview
      if (newsImagePreview) {
        newsImagePreview.style.display = 'none';
      }
      
      showNotification('News published successfully!', 'success');
      
      // Refresh news section
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

// YouTube-style Prompts with Infinite Scroll - UPDATED WITH HORIZONTAL FEEDS AND VIDEO SUPPORT
class YouTubeStylePrompts {
  constructor() {
    this.currentPage = 1;
    this.isLoading = false;
    this.hasMore = true;
    this.promptsPerPage = 12;
    this.loadedPrompts = new Set();
    this.init();
  }

  init() {
    this.injectCriticalCSS();
    this.setupInfiniteScroll();
    this.loadInitialPrompts();
    this.setupEngagementListeners();
    console.log('YouTubeStylePrompts initialized with horizontal feeds and video support');
  }

  injectCriticalCSS() {
    const criticalCSS = `
      /* YouTube Shorts Critical Styles with !important */
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

      .shorts-video-container:focus-visible {
        outline: 3px solid #4e54c8 !important;
        outline-offset: 2px !important;
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

      /* Video reel indicator */
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
        backdrop-filter: blur(4px) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        pointer-events: none !important;
      }

      /* Image badge */
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
        backdrop-filter: blur(4px) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        pointer-events: none !important;
      }

      /* Horizontal feed video count badge */
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

      .video-count-badge i {
        font-size: 0.75rem !important;
      }

      /* Loading states */
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

      .loading-prompt .shorts-video-container {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%) !important;
        background-size: 200% 100% !important;
        animation: loading 1s infinite !important;
      }

      .loading-text {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%) !important;
        background-size: 200% 100% !important;
        animation: loading 1s infinite !important;
        border-radius: 4px !important;
      }

      /* Hover video container styles */
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

      .hover-video-loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 3;
        display: none;
      }

      .hover-video-indicator {
        position: absolute;
        bottom: 10px;
        left: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
        z-index: 4;
        pointer-events: none;
      }

      .hover-video-mute {
        position: absolute;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 5;
        transition: all 0.2s ease;
        pointer-events: auto;
      }

      .hover-video-mute:hover {
        background: rgba(78, 84, 200, 0.9);
        transform: scale(1.1);
      }

      .hover-video-paused {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: transform 0.2s ease;
        z-index: 6;
        pointer-events: none;
      }

      .hover-video-paused.show {
        transform: translate(-50%, -50%) scale(1);
      }

      .spinner-small {
        width: 24px;
        height: 24px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top: 3px solid #4e54c8;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      /* Horizontal Feed Styles with Video Support */
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

      .horizontal-control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .horizontal-control-btn:disabled:hover {
        background: white;
        color: #4e54c8;
      }

      .horizontal-feed-track {
        display: flex;
        gap: 15px;
        padding: 0 20px;
        overflow-x: auto;
        scroll-behavior: smooth;
        scrollbar-width: thin;
        scrollbar-color: #4e54c8 #f1f1f1;
        cursor: grab;
      }

      .horizontal-feed-track:active {
        cursor: grabbing;
      }

      .horizontal-feed-track::-webkit-scrollbar {
        height: 6px;
      }

      .horizontal-feed-track::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 10px;
      }

      .horizontal-feed-track::-webkit-scrollbar-thumb {
        background: #4e54c8;
        border-radius: 10px;
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

      .horizontal-prompt-item:hover .horizontal-prompt-image img {
        transform: scale(1.05);
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

      /* Desktop specific styles */
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

        .shorts-prompt-text {
          -webkit-line-clamp: 4 !important;
          min-height: 80px !important;
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

      /* Mobile responsive */
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
        
        .shorts-prompt-card {
          border-radius: 8px !important;
        }
        
        .engagement-action i {
          font-size: 20px !important;
          width: 40px !important;
          height: 40px !important;
        }

        .shorts-prompt-text {
          -webkit-line-clamp: 2 !important;
          min-height: 50px !important;
        }

        .shorts-prompt-card.touch-active .hover-video-container {
          opacity: 1;
          pointer-events: auto;
        }

        .shorts-prompt-card.touch-active .shorts-image {
          opacity: 0;
        }

        .hover-video-mute {
          width: 36px;
          height: 36px;
          font-size: 14px;
        }

        /* Horizontal feed mobile fixes */
        .horizontal-feed-section {
          margin: 20px 0 !important;
          padding: 15px 0 !important;
          border-radius: 12px !important;
          width: 100% !important;
        }
        
        .horizontal-feed-header {
          padding: 0 15px !important;
          margin-bottom: 15px !important;
        }
        
        .horizontal-feed-header h3 {
          font-size: 1.1rem !important;
        }
        
        .video-count-badge {
          font-size: 0.7rem !important;
          padding: 3px 8px !important;
        }
        
        .horizontal-control-btn {
          width: 35px !important;
          height: 35px !important;
          font-size: 0.8rem !important;
        }
        
        .horizontal-feed-track {
          padding: 0 15px !important;
          gap: 12px !important;
          scroll-snap-type: x mandatory !important;
        }
        
        .horizontal-prompt-item {
          width: 160px !important;
          scroll-snap-align: start !important;
          flex-shrink: 0 !important;
        }
        
        .horizontal-prompt-image {
          height: 120px !important;
        }
        
        .horizontal-prompt-title {
          font-size: 0.85rem !important;
          height: 32px !important;
        }
        
        .hover-video-mute {
          width: 28px !important;
          height: 28px !important;
          font-size: 0.7rem !important;
        }
        
        .hover-video-indicator {
          font-size: 0.65rem !important;
          padding: 3px 6px !important;
        }
      }

      @media (max-width: 480px) {
        .shorts-video-container {
          height: 350px !important;
        }
        
        .shorts-info {
          padding: 12px !important;
        }
        
        .shorts-prompt-text {
          font-size: 13px !important;
          line-height: 1.3 !important;
          max-height: 50px !important;
        }
        
        .horizontal-feed-section {
          margin: 15px 0 !important;
          padding: 12px 0 !important;
        }
        
        .horizontal-feed-header {
          padding: 0 12px !important;
        }
        
        .horizontal-feed-header h3 {
          font-size: 1rem !important;
        }
        
        .horizontal-feed-track {
          padding: 0 12px !important;
          gap: 10px !important;
        }
        
        .horizontal-prompt-item {
          width: 140px !important;
        }
        
        .horizontal-prompt-image {
          height: 100px !important;
        }
        
        .horizontal-prompt-title {
          font-size: 0.8rem !important;
          height: 32px !important;
        }
      }

      @media (max-width: 360px) {
        .shorts-video-container {
          height: 300px !important;
        }
        
        .shorts-container {
          padding: 12px !important;
          gap: 12px !important;
        }
        
        .horizontal-prompt-item {
          width: 130px !important;
        }
      }

      /* Animations */
      @keyframes spin {
        0% { transform: rotate(0deg) !important; }
        100% { transform: rotate(360deg) !important; }
      }

      @keyframes loading {
        0% { background-position: 200% 0 !important; }
        100% { background-position: -200% 0 !important; }
      }

      @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
      }

      .count-animation {
        animation: countPop 0.3s ease !important;
      }

      @keyframes countPop {
        0% { transform: scale(1) !important; }
        50% { transform: scale(1.2) !important; }
        100% { transform: scale(1) !important; }
      }

      /* Override any grid layouts */
      #promptsContainer {
        display: grid !important;
        width: 100% !important;
      }

      /* Hide any existing grid styles */
      .prompts-grid {
        display: none !important;
      }

      .prompt-card {
        display: none !important;
      }

      /* Ensure proper image loading */
      .shorts-image {
        transition: opacity 0.3s ease !important;
      }

      .shorts-image:not([src]) {
        opacity: 0 !important;
      }

      .shorts-image[src] {
        opacity: 1 !important;
      }

      /* Loading states for horizontal feed */
      .loading-horizontal .horizontal-feed-header .loading-text,
      .loading-horizontal-item .loading-text {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: loading 1s infinite;
        border-radius: 4px;
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

    // Also check on load in case content doesn't fill the screen
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

    console.log('Loading initial prompts for vertical feed with horizontal feeds...');
    
    // Clear any existing content and apply critical styles
    promptsContainer.innerHTML = '';
    promptsContainer.className = 'shorts-container';
    
    // Add loading skeletons
    promptsContainer.innerHTML = this.createLoadingShorts();

    try {
      await this.loadAllPrompts();
      const olderPrompts = this.getOlderPrompts(); // Get prompts older than 24h
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
    // Use cache if data is fresh
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
        
        // Validate and sanitize the data
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
          updatedAt: prompt.updatedAt || new Date().toISOString()
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

  // Get prompts older than 24 hours for vertical feed
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
      // Safe sorting
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
      // REDUCED: Simulate API delay for better UX - reduced from 800ms to 400ms
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const olderPrompts = this.getOlderPrompts();
      const startIndex = this.currentPage * this.promptsPerPage;
      const nextPrompts = olderPrompts.slice(startIndex, startIndex + this.promptsPerPage);
      
      if (nextPrompts.length > 0) {
        console.log(`Displaying ${nextPrompts.length} more older prompts`);
        this.displayPrompts(nextPrompts, false);
        this.currentPage++;
        
        // Check if we need to load more immediately (for short screens)
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

  // Enhanced: Create horizontal feed section with video support
  createHorizontalFeed(prompts, index) {
    const horizontalFeed = document.createElement('div');
    horizontalFeed.className = 'horizontal-feed-section';
    
    // Count videos in this feed
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
            <!-- Items will be added via JavaScript -->
        </div>
    `;
    
    // Add items after creating the container
    const track = horizontalFeed.querySelector('.horizontal-feed-track');
    prompts.forEach(prompt => {
        const item = this.createHorizontalPromptItem(prompt);
        if (item) {
            track.appendChild(item);
        }
    });
    
    return horizontalFeed;
  }

  // Enhanced: Create horizontal prompt item with video reel support
  createHorizontalPromptItem(prompt) {
    const safePrompt = prompt || {};
    const promptId = safePrompt.id || 'unknown';
    const title = safePrompt.title || 'Untitled Prompt';
    const imageUrl = safePrompt.thumbnailUrl || safePrompt.imageUrl || 'https://via.placeholder.com/200x150/4e54c8/white?text=Prompt';
    const views = safePrompt.views || 0;
    const isVideo = safePrompt.fileType === 'video' || safePrompt.videoUrl || safePrompt.mediaUrl?.includes('video');
    
    const item = document.createElement('div');
    item.className = `horizontal-prompt-item ${isVideo ? 'video-item' : ''}`;
    item.setAttribute('data-prompt-id', promptId);
    item.setAttribute('data-file-type', isVideo ? 'video' : 'image');
    
    // Handle click - open in shorts player for videos, prompt page for images
    item.addEventListener('click', (e) => {
        if (!e.target.closest('.view-prompt-btn')) {
            if (isVideo) {
                this.openShortsPlayer(promptId);
            } else {
                this.openPromptPage(promptId);
            }
        }
    });

    // Create image container
    const imageDiv = document.createElement('div');
    imageDiv.className = 'horizontal-prompt-image';
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = title;
    img.loading = 'lazy';
    img.onerror = function() { this.src = 'https://via.placeholder.com/200x150/4e54c8/white?text=Prompt'; };
    imageDiv.appendChild(img);
    
    // Video badge for video items
    if (isVideo) {
        const badge = document.createElement('div');
        badge.className = 'video-reel-badge';
        badge.innerHTML = '<i class="fas fa-play"></i> Reel';
        imageDiv.appendChild(badge);
        
        // Add hover video container for video previews
        if (window.videoHoverManager) {
            const hoverVideoContainer = window.videoHoverManager.createHoverVideoElement(safePrompt);
            if (hoverVideoContainer) {
                imageDiv.appendChild(hoverVideoContainer);
            }
        }
    } else {
        // Image badge for image items
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
    button.onclick = (e) => {
        e.stopPropagation();
        if (isVideo) {
            this.openShortsPlayer(promptId);
        } else {
            this.openPromptPage(promptId);
        }
    };
    button.textContent = isVideo ? 'Watch Reel' : 'View Prompt';
    
    infoDiv.appendChild(titleDiv);
    infoDiv.appendChild(button);

    item.appendChild(imageDiv);
    item.appendChild(infoDiv);

    return item;
  }

  // Enhanced: Get random prompts for horizontal feed with video prioritization
  getRandomPrompts(count, excludePrompts = [], prioritizeVideos = true) {
    const excludeIds = new Set(excludePrompts.map(p => p.id));
    const availablePrompts = allPrompts.filter(prompt => 
        prompt && !excludeIds.has(prompt.id)
    );
    
    if (availablePrompts.length === 0) return [];
    
    // If prioritizeVideos is true, ensure at least 30% of items are videos
    let selectedPrompts = [];
    
    if (prioritizeVideos) {
        const videos = availablePrompts.filter(p => p.fileType === 'video' || p.videoUrl);
        const images = availablePrompts.filter(p => p.fileType !== 'video' && !p.videoUrl);
        
        // Calculate how many videos to include (30-40% of count)
        const videoCount = Math.min(
            Math.max(2, Math.floor(count * 0.3)), 
            videos.length,
            count
        );
        
        // Shuffle and select videos
        const shuffledVideos = [...videos].sort(() => 0.5 - Math.random());
        selectedPrompts = shuffledVideos.slice(0, videoCount);
        
        // Fill remaining with random images
        const remainingCount = count - selectedPrompts.length;
        if (remainingCount > 0 && images.length > 0) {
            const shuffledImages = [...images].sort(() => 0.5 - Math.random());
            selectedPrompts = [...selectedPrompts, ...shuffledImages.slice(0, remainingCount)];
        }
    } else {
        // Regular random selection
        const shuffled = [...availablePrompts].sort(() => 0.5 - Math.random());
        selectedPrompts = shuffled.slice(0, count);
    }
    
    // If we still don't have enough prompts, duplicate some (but avoid duplicates in display)
    if (selectedPrompts.length < count && availablePrompts.length > 0) {
        const needed = count - selectedPrompts.length;
        const duplicates = [...availablePrompts]
            .sort(() => 0.5 - Math.random())
            .slice(0, needed)
            .map(p => ({...p, id: p.id + '-copy'})); // Add unique identifier to avoid key conflicts
        
        selectedPrompts = [...selectedPrompts, ...duplicates];
    }
    
    return selectedPrompts.slice(0, count);
  }

  // UPDATED: Display prompts with horizontal feeds - enhanced for video reels
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

    // Group prompts - every 4 vertical items, add a horizontal feed
    const groupedPrompts = [];
    for (let i = 0; i < prompts.length; i += 4) {
      const verticalPrompts = prompts.slice(i, i + 4);
      groupedPrompts.push(verticalPrompts);
      
      // After every 4 vertical prompts, get random prompts for horizontal feed
      if (i + 4 < prompts.length) {
        // Get 8-10 random prompts with video prioritization
        const randomPrompts = this.getRandomPrompts(10, prompts.slice(i + 4), true);
        groupedPrompts.push({ type: 'horizontal', prompts: randomPrompts, index: i / 4 });
      }
    }

    // Render the mixed feed
    let globalIndex = 0;
    groupedPrompts.forEach((group, groupIndex) => {
      if (group.type === 'horizontal') {
        // Add horizontal feed
        const horizontalFeed = this.createHorizontalFeed(group.prompts, group.index);
        promptsContainer.appendChild(horizontalFeed);
        
        // Initialize horizontal feed controls
        setTimeout(() => {
          this.initHorizontalFeedControls(horizontalFeed);
        }, 100);
      } else {
        // Add vertical prompts
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

    // Animate prompts in
    setTimeout(() => {
      this.animatePromptsIn();
    }, 50);

    console.log(`Displayed mixed feed with ${this.loadedPrompts.size} vertical prompts and ${Math.floor(this.loadedPrompts.size / 4)} horizontal feeds`);
  }

  // NEW: Initialize horizontal feed controls
  initHorizontalFeedControls(horizontalFeed) {
    const track = horizontalFeed.querySelector('.horizontal-feed-track');
    const controls = horizontalFeed.querySelector('.horizontal-controls');
    
    if (track && controls && window.horizontalFeedManager) {
      const feedId = `horizontal-feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      window.horizontalFeedManager.addFeed(track, controls, feedId);
    }
  }

  filterByCategory(category) {
    const filteredPrompts = allPrompts.filter(prompt => 
      prompt.category === category
    );
    
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
        keywords.some(keyword => 
          keyword.toLowerCase().includes(searchLower)
        )
      );
    });
    
    this.displayFilteredPrompts(filteredPrompts);
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
    
    // Update infinite scroll to use filtered prompts
    this.filteredPrompts = filteredPrompts;
    this.hasMore = filteredPrompts.length > this.promptsPerPage;
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

  createShortsPrompt(prompt, index) {
    // Safe data access
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
    
    // Safe date handling
    let createdAt = safePrompt.createdAt;
    if (!createdAt || typeof createdAt !== 'string') {
      createdAt = new Date().toISOString();
    }

    const promptDiv = document.createElement('div');
    promptDiv.className = 'shorts-prompt-card';
    promptDiv.setAttribute('data-prompt-id', promptId);
    promptDiv.setAttribute('data-file-type', isVideo ? 'video' : 'image');
    promptDiv.style.opacity = '0';
    promptDiv.style.transform = 'translateY(20px)';
    promptDiv.style.transition = `opacity 0.3s ease ${index * 0.05}s, transform 0.3s ease ${index * 0.05}s`;

    promptDiv.innerHTML = `
      <div class="shorts-video-container ${isVideo ? 'video-hover-container' : ''}" 
           ${isVideo ? 'tabindex="0" role="button" aria-label="Play video reel"' : ''}>
        <img src="${imageUrl}" 
             alt="${title}"
             class="shorts-image"
             loading="lazy"
             onerror="this.src='https://via.placeholder.com/300x500/4e54c8/white?text=AI+Image'">
        
        ${isVideo ? '<div class="video-reel-badge"><i class="fas fa-play"></i> Reel</div>' : ''}
        
        <!-- Hover video container will be added dynamically -->
        
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
          ${promptText}
        </div>
        <div class="shorts-meta">
          <span>@${userName}</span>
          <span>${this.formatCount(views)} views</span>
        </div>
        <div class="prompt-actions">
          <button class="copy-prompt-btn" data-prompt-text="${promptText}">
            <i class="fas fa-copy"></i> Copy Prompt
          </button>
          <span style="font-size: 11px; color: #888; margin-left: auto;">
            #${category}
          </span>
        </div>
      </div>
    `;

    // Add hover video container for video items
    if (isVideo && window.videoHoverManager) {
        const videoContainer = promptDiv.querySelector('.shorts-video-container');
        const hoverVideoContainer = window.videoHoverManager.createHoverVideoElement(safePrompt);
        if (hoverVideoContainer) {
            videoContainer.appendChild(hoverVideoContainer);
        }
        
        // Add direct event listeners for better autoplay control
        const videoElement = hoverVideoContainer?.querySelector('.hover-video-player');
        if (videoElement) {
            // Preload video metadata
            videoElement.preload = 'metadata';
            
            // Handle focus events for keyboard navigation
            videoContainer.addEventListener('focus', () => {
                window.videoHoverManager.playHoverVideo(promptDiv);
            });
            
            videoContainer.addEventListener('blur', () => {
                window.videoHoverManager.pauseHoverVideo(promptDiv);
            });
            
            // Handle touch events for mobile
            videoContainer.addEventListener('touchstart', (e) => {
                e.preventDefault();
                window.videoHoverManager.playHoverVideo(promptDiv);
            }, { passive: true });
            
            // Handle mouse events for desktop
            videoContainer.addEventListener('mouseenter', () => {
                window.videoHoverManager.playHoverVideo(promptDiv);
            });
            
            videoContainer.addEventListener('mouseleave', () => {
                window.videoHoverManager.pauseHoverVideo(promptDiv);
            });
            
            // Ensure video plays inline on mobile
            videoElement.setAttribute('playsinline', '');
            videoElement.setAttribute('webkit-playsinline', '');
        }
    }

    // Add click handler to open full player
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
    // Event delegation for all engagement buttons
    document.addEventListener('click', async (e) => {
      const likeBtn = e.target.closest('.like-btn');
      const useBtn = e.target.closest('.use-btn');
      const shareBtn = e.target.closest('.share-btn');
      const copyBtn = e.target.closest('.copy-prompt-btn');
      
      if (likeBtn) {
        await this.handleLike(likeBtn);
      } else if (useBtn) {
        await this.handleUse(useBtn);
      } else if (shareBtn) {
        await this.handleShare(shareBtn);
      } else if (copyBtn) {
        await this.handleCopyPrompt(copyBtn);
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
        
        // Add animation
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
        
        // Add animation
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

  async handleCopyPrompt(button) {
    const promptText = button.dataset.promptText || '';
    await this.copyToClipboard(promptText);
    showNotification('Prompt copied to clipboard!', 'success');
    
    // Add visual feedback
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied!';
    button.style.background = '#20bf6b';
    button.style.color = 'white';
    button.style.borderColor = '#20bf6b';
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.style.background = '';
      button.style.color = '';
      button.style.borderColor = '';
    }, 2000);
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  }

  // UPDATED: Create loading shorts with horizontal feed skeletons
  createLoadingShorts() {
    // Create mixed loading cards (4 vertical + 1 horizontal skeleton)
    const loadingCards = Array(12).fill(0).map((_, i) => {
      if (i % 5 === 4) {
        // Horizontal feed skeleton (every 5th item after 4 vertical ones)
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
        // Vertical prompt skeleton
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
    // Handle undefined, null, or non-numeric values
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

  // Method to refresh the vertical feed
  async refreshFeed() {
    await this.loadAllPrompts(); // Refresh the global data first
    this.currentPage = 1;
    this.hasMore = true;
    this.loadedPrompts.clear();
    await this.loadInitialPrompts();
  }

  // Auto-refresh every 2 minutes to sync with horizontal feed
  startAutoRefresh() {
    setInterval(async () => {
      await this.refreshFeed();
    }, 2 * 60 * 1000);
  }

  // Helper methods for opening prompts and videos
  openPromptPage(promptId) {
    if (promptId && promptId !== 'unknown') {
      const currentHost = window.location.hostname;
      let targetUrl = `/prompt/${promptId}`;
      
      // If on non-www version in production, redirect to www
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

// ========== YOUTUBE SHORTS PLAYER CLASS WITH VERTICAL SCROLLING ==========
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
    this.touchEndY = 0;
    this.isScrolling = false;
    this.scrollThreshold = 50; // Minimum swipe distance to change video
    this.isMuted = true; // Start muted for autoplay
    this.volumeLevel = 1; // Default volume when unmuted
    this.loadingTimeouts = new Map(); // Track loading timeouts
    this.maxLoadTime = 10000; // Max 10 seconds loading time
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
            <!-- Videos will be dynamically inserted here -->
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
    
    // Add retry functionality
    if (this.errorToast) {
      this.errorToast.addEventListener('click', () => {
        this.errorToast.style.display = 'none';
        this.retryLoadVideo(this.currentVideoIndex);
      });
    }
  }

  setupEventListeners() {
    // Close button
    document.getElementById('closeShortsPlayer').addEventListener('click', () => {
      this.closePlayer();
    });

    // Search button
    const searchBtn = document.getElementById('shortsSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        this.openSearch();
      });
    }

    // Menu button
    const menuBtn = document.getElementById('shortsMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        this.openMenu();
      });
    }

    // Volume control
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

    // Keyboard navigation
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

    // Touch events for swipe navigation
    this.videosContainer.addEventListener('touchstart', (e) => {
      this.touchStartY = e.touches[0].clientY;
      this.touchStartX = e.touches[0].clientX;
      this.isScrolling = false;
      
      // Add visual feedback
      this.videosContainer.style.transition = 'none';
    }, { passive: true });

    this.videosContainer.addEventListener('touchmove', (e) => {
      if (!this.touchStartY) return;
      
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = this.touchStartY - currentY;
      const diffX = this.touchStartX - currentX;
      
      // Determine if scrolling vertically (for shorts) or horizontally (for other content)
      if (Math.abs(diffY) > Math.abs(diffX)) {
        e.preventDefault(); // Prevent page scroll
        
        // Add visual feedback during swipe
        const translateY = -diffY;
        this.videosContainer.style.transform = `translateY(${translateY}px)`;
        this.videosContainer.style.transition = 'none';
        
        // Show hint based on direction
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
      
      // Reset transform
      this.videosContainer.style.transition = 'transform 0.3s ease';
      this.videosContainer.style.transform = '';
      
      // Check if swipe distance exceeds threshold
      if (Math.abs(diffY) > this.scrollThreshold) {
        if (diffY > 0) {
          // Swipe up - next video
          this.playNext();
          this.showNavigationFeedback('up');
        } else {
          // Swipe down - previous video
          this.playPrevious();
          this.showNavigationFeedback('down');
        }
      }
      
      this.touchStartY = 0;
      this.touchStartX = 0;
      
      // Hide swipe hint
      this.hideSwipeHint();
    });

    // Mouse wheel navigation for desktop
    this.videosContainer.addEventListener('wheel', (e) => {
      if (!this.playerContainer.classList.contains('active')) return;
      
      e.preventDefault();
      
      if (e.deltaY > 0) {
        // Scroll down - next video
        this.playNext();
        this.showNavigationFeedback('down');
      } else if (e.deltaY < 0) {
        // Scroll up - previous video
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

    // Update volume button icon
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

    // Show mute toast
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
    
    // Filter only video prompts
    this.videos = videos.filter(v => v.fileType === 'video' || v.videoUrl);
    
    if (this.videos.length === 0) {
      showNotification('No videos found', 'error');
      return;
    }
    
    this.currentVideoIndex = Math.min(startIndex, this.videos.length - 1);
    
    // Clear any existing loading timeouts
    this.loadingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.loadingTimeouts.clear();
    
    // Hide error toast
    if (this.errorToast) {
      this.errorToast.style.display = 'none';
    }
    
    // Create video items for all videos (for smooth scrolling)
    this.renderAllVideos();
    
    this.playerContainer.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Show global loading
    if (this.globalLoading) {
      this.globalLoading.style.display = 'flex';
    }
    
    // Scroll to current video
    setTimeout(() => {
      this.scrollToVideo(this.currentVideoIndex, false);
      this.loadVideo(this.currentVideoIndex);
    }, 100);
    
    // Track view
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

    // Determine video source
    const videoUrl = video.videoUrl || video.mediaUrl;
    const posterUrl = video.thumbnailUrl || video.imageUrl;

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
            
            <button class="shorts-action-btn copy-btn" data-video-id="${video.id}" data-prompt="${video.promptText || ''}">
              <i class="far fa-copy"></i>
              <span>Prompt</span>
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

    // Setup video event listeners
    const videoElement = videoItem.querySelector('video');
    const loadingElement = videoItem.querySelector(`#loading-${index}`);
    const retryButton = videoItem.querySelector(`#retry-${index}`);
    const progressBar = videoItem.querySelector(`#progress-${index}`);

    // Set up loading timeout
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

    // Video event handlers
    videoElement.addEventListener('loadedmetadata', () => {
      clearTimeout(this.loadingTimeouts.get(index));
      this.loadingTimeouts.delete(index);
      
      if (loadingElement) loadingElement.style.display = 'none';
      if (retryButton) retryButton.style.display = 'none';
      if (this.globalLoading && index === this.currentVideoIndex) {
        this.globalLoading.style.display = 'none';
      }
    });

    videoElement.addEventListener('loadeddata', () => {
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
      
      // Auto play if this is the current video
      if (index === this.currentVideoIndex && videoElement.paused) {
        videoElement.play().catch(e => console.log('Autoplay prevented:', e));
      }
    });

    videoElement.addEventListener('waiting', () => {
      if (index === this.currentVideoIndex) {
        if (loadingElement) loadingElement.style.display = 'flex';
        if (this.globalLoading) this.globalLoading.style.display = 'flex';
      }
    });

    videoElement.addEventListener('playing', () => {
      if (loadingElement) loadingElement.style.display = 'none';
      if (retryButton) retryButton.style.display = 'none';
      if (this.globalLoading && index === this.currentVideoIndex) {
        this.globalLoading.style.display = 'none';
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

    videoElement.addEventListener('click', () => {
      if (videoElement.paused) {
        videoElement.play();
      } else {
        videoElement.pause();
      }
    });

    // Retry button handler
    if (retryButton) {
      retryButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.retryLoadVideo(index);
      });
    }

    // Setup action buttons for this video
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
      // Hide retry button, show loading
      if (retryButton) retryButton.style.display = 'none';
      if (loadingElement) loadingElement.style.display = 'flex';
      if (this.globalLoading && index === this.currentVideoIndex) {
        this.globalLoading.style.display = 'flex';
      }
      if (this.errorToast) this.errorToast.style.display = 'none';
      
      // Reload video
      videoElement.src = videoUrl;
      videoElement.load();
      
      // Set new loading timeout
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
    // Like button
    const likeBtn = videoItem.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleLike(video.id, likeBtn);
      });
    }

    // Comment button
    const commentBtn = videoItem.querySelector('.comment-btn');
    if (commentBtn) {
      commentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openComments(video.id);
      });
    }

    // Share button
    const shareBtn = videoItem.querySelector('.share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleShare(video.id);
      });
    }

    // Copy button
    const copyBtn = videoItem.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyPrompt(video.promptText);
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

    // Hide global loading
    if (this.globalLoading) {
      this.globalLoading.style.display = 'flex';
    }

    // Hide error toast
    if (this.errorToast) {
      this.errorToast.style.display = 'none';
    }

    // Show loading for current video
    const currentLoading = videoItem.querySelector(`#loading-${index}`);
    if (currentLoading) {
      currentLoading.style.display = 'flex';
    }

    // Pause all other videos
    document.querySelectorAll('.shorts-video-item video').forEach((video, i) => {
      if (i !== index) {
        video.pause();
        video.currentTime = 0;
        
        // Hide loading for other videos
        const otherLoading = document.querySelector(`#loading-${i}`);
        if (otherLoading) {
          otherLoading.style.display = 'none';
        }
      }
    });

    // Play current video
    const videoElement = videoItem.querySelector('video');
    if (videoElement) {
      videoElement.muted = this.isMuted;
      videoElement.volume = this.volumeLevel;
      
      const playPromise = videoElement.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Hide loading when video starts playing
            if (currentLoading) currentLoading.style.display = 'none';
            if (this.globalLoading) this.globalLoading.style.display = 'none';
          })
          .catch(error => {
            console.log('Autoplay prevented:', error);
            // Keep loading visible if video hasn't started
            if (!videoElement.readyState) {
              // Show play button overlay
              this.showPlayButton(videoItem);
            } else {
              if (currentLoading) currentLoading.style.display = 'none';
              if (this.globalLoading) this.globalLoading.style.display = 'none';
            }
          });
      }
    }

    // Update current index
    this.currentVideoIndex = index;

    // Update URL or history if needed
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
    // Update URL without reloading
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
      
      // Show next indicator
      this.showToast(`Next: ${this.videos[nextIndex].title || 'Video'}`, 1500);
    } else {
      // Reached the end
      this.showToast('You\'ve reached the end', 1000);
      
      // Optional: Load more videos
      this.loadMoreVideos();
    }
  }

  playPrevious() {
    if (this.currentVideoIndex > 0) {
      const prevIndex = this.currentVideoIndex - 1;
      this.scrollToVideo(prevIndex);
      this.loadVideo(prevIndex);
      this.trackView(this.videos[prevIndex].id);
      
      // Show previous indicator
      this.showToast(`Previous: ${this.videos[prevIndex].title || 'Video'}`, 1500);
    } else {
      this.showToast('This is the first video', 1000);
    }
  }

  async loadMoreVideos() {
    try {
      // Fetch more videos from API
      const response = await fetch('/api/uploads?type=video&page=' + Math.ceil(this.videos.length / 10 + 1));
      if (response.ok) {
        const data = await response.json();
        const newVideos = data.uploads.filter(v => v.fileType === 'video' || v.videoUrl);
        
        if (newVideos.length > 0) {
          // Add new videos to the list
          this.videos = [...this.videos, ...newVideos];
          
          // Render new videos
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
    
    // Clear all loading timeouts
    this.loadingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.loadingTimeouts.clear();
    
    // Pause all videos
    document.querySelectorAll('.shorts-video-item video').forEach(video => {
      video.pause();
      video.src = '';
      video.load();
    });
    
    // Clear container
    if (this.videosContainer) {
      this.videosContainer.innerHTML = '';
    }
    
    // Remove video param from URL
    const url = new URL(window.location);
    url.searchParams.delete('video');
    window.history.replaceState({}, '', url);
    
    // Hide error toast
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
    // Scroll to comments section on prompt page
    window.location.href = `/prompt/${videoId}#commentSection`;
  }

  openSearch() {
    // Implement search functionality
    this.showToast('Search coming soon', 1000);
  }

  openMenu() {
    // Implement menu functionality
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
      // Fallback
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
  // Find the prompt data
  const prompt = allPrompts.find(p => p.id === promptId);
  if (prompt && (prompt.fileType === 'video' || prompt.videoUrl)) {
    // Open single video in player
    window.shortsPlayer.openPlayer([prompt], 0);
  } else {
    // Show all videos
    const videos = allPrompts.filter(p => p.fileType === 'video' || p.videoUrl);
    const index = videos.findIndex(p => p.id === promptId);
    window.shortsPlayer.openPlayer(videos, index >= 0 ? index : 0);
  }
}

// Add a "Shorts" button to filter videos
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

// Function to filter horizontal feed by video content
function filterHorizontalFeedByVideo(horizontalFeed) {
    const items = horizontalFeed.querySelectorAll('.horizontal-prompt-item');
    let videoCount = 0;
    
    items.forEach(item => {
        if (item.classList.contains('video-item')) {
            videoCount++;
            item.style.display = 'block';
        } else {
            // Hide non-video items if we want only videos
            // item.style.display = 'none';
        }
    });
    
    return videoCount;
}

// Optional: Add a filter button for horizontal feeds
function addHorizontalFeedFilters() {
    document.querySelectorAll('.horizontal-feed-section').forEach(section => {
        const header = section.querySelector('.horizontal-feed-header');
        const filterBtn = document.createElement('button');
        filterBtn.className = 'horizontal-control-btn';
        filterBtn.innerHTML = '<i class="fas fa-filter"></i>';
        filterBtn.title = 'Filter videos';
        filterBtn.onclick = () => {
            const videoCount = filterHorizontalFeedByVideo(section);
            showNotification(`${videoCount} video reels found`, 'info');
        };
        header.querySelector('.horizontal-controls').appendChild(filterBtn);
    });
}

// Horizontal scroll functionality
function scrollHorizontalFeed(button, direction) {
  const controls = button.closest('.horizontal-controls');
  const feedSection = controls.closest('.horizontal-feed-section');
  const track = feedSection.querySelector('.horizontal-feed-track');
  
  if (!track) return;
  
  const scrollAmount = 300; // Adjust based on your item width + gap
  const newScrollLeft = track.scrollLeft + (scrollAmount * direction);
  
  track.scrollTo({
    left: newScrollLeft,
    behavior: 'smooth'
  });
  
  // Update button states after scroll
  setTimeout(() => updateHorizontalControls(track, controls), 300);
}

function updateHorizontalControls(track, controls) {
  const prevBtn = controls.querySelector('.prev-horizontal');
  const nextBtn = controls.querySelector('.next-horizontal');
  
  if (!prevBtn || !nextBtn) return;
  
  const scrollLeft = track.scrollLeft;
  const scrollWidth = track.scrollWidth;
  const clientWidth = track.clientWidth;
  
  prevBtn.disabled = scrollLeft <= 10;
  nextBtn.disabled = scrollLeft >= scrollWidth - clientWidth - 10;
}

// Initialize horizontal feed controls
function initHorizontalFeedControls() {
  document.addEventListener('DOMContentLoaded', function() {
    const horizontalFeeds = document.querySelectorAll('.horizontal-feed-track');
    
    horizontalFeeds.forEach(track => {
      const controls = track.closest('.horizontal-feed-section').querySelector('.horizontal-controls');
      updateHorizontalControls(track, controls);
      
      // Update controls on scroll
      track.addEventListener('scroll', () => {
        updateHorizontalControls(track, controls);
      });
    });
  });
}

// Touch/swipe support for horizontal feeds
function initHorizontalTouchSupport() {
  document.addEventListener('DOMContentLoaded', function() {
    const tracks = document.querySelectorAll('.horizontal-feed-track');
    
    tracks.forEach(track => {
      let startX = 0;
      let startY = 0;
      let scrollLeft = 0;
      let isScrolling = false;
      
      track.addEventListener('touchstart', (e) => {
        startX = e.touches[0].pageX;
        startY = e.touches[0].pageY;
        scrollLeft = track.scrollLeft;
        isScrolling = true;
      }, { passive: true });
      
      track.addEventListener('touchmove', (e) => {
        if (!isScrolling) return;
        
        const x = e.touches[0].pageX;
        const y = e.touches[0].pageY;
        
        const walkX = x - startX;
        const walkY = y - startY;
        
        // Only prevent default if primarily horizontal movement
        if (Math.abs(walkX) > Math.abs(walkY)) {
          e.preventDefault();
          track.scrollLeft = scrollLeft - walkX;
        }
      }, { passive: false });
      
      track.addEventListener('touchend', () => {
        isScrolling = false;
      });
    });
  });
}

// Call initialization functions
initHorizontalFeedControls();
initHorizontalTouchSupport();

// Global function to open prompt page - RELY ON SERVER-SIDE VIEW COUNTING
function openPromptPage(promptId) {
  if (promptId && promptId !== 'unknown') {
    const currentHost = window.location.hostname;
    let targetUrl = `/prompt/${promptId}`;
    
    // If on non-www version in production, redirect to www
    if (currentHost === 'promptseen.co' && window.location.hostname !== 'localhost') {
      targetUrl = `https://www.promptseen.co/prompt/${promptId}`;
    }
    
    // Server will handle view counting when the page loads
    window.open(targetUrl, '_blank');
  }
}

// YouTube-style Search and Category Functionality
class YouTubeStyleHeader {
  constructor() {
    this.currentCategory = 'all';
    this.searchTimeout = null;
    this.init();
  }

  init() {
    this.setupSearch();
    this.setupCategories();
    this.setupMobileMenu();
  }

  setupSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchSuggestions = document.getElementById('searchSuggestions');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.handleSearch(e.target.value);
        }, 200); // REDUCED: 200ms instead of 300ms
      });

      if (searchButton) {
        searchButton.addEventListener('click', () => {
          this.performSearch(searchInput.value);
        });
      }

      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.performSearch(searchInput.value);
        }
      });

      searchInput.addEventListener('focus', () => {
        this.showRecentSearches();
      });

      document.addEventListener('click', (e) => {
        if (searchSuggestions && !searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
          searchSuggestions.style.display = 'none';
        }
      });
    }
  }

  setupCategories() {
    const categoryItems = document.querySelectorAll('.category-item');
    
    categoryItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const category = item.dataset.category;
        this.selectCategory(category);
        
        categoryItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  setupMobileMenu() {
    const mobileToggle = document.querySelector('.mobile-toggle');
    
    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => {
        document.body.classList.toggle('mobile-menu-open');
      });
    }
  }

  async handleSearch(query) {
    const searchSuggestions = document.getElementById('searchSuggestions');
    
    if (!searchSuggestions) return;
    
    if (!query || !query.trim()) {
      this.showRecentSearches();
      return;
    }

    try {
      searchSuggestions.innerHTML = `
        <div class="suggestion-item">
          <i class="fas fa-spinner fa-spin suggestion-icon"></i>
          <span>Searching...</span>
        </div>
      `;
      searchSuggestions.style.display = 'block';

      const suggestions = await this.getSearchSuggestions(query.toLowerCase());
      this.displaySearchSuggestions(suggestions, query);
      
    } catch (error) {
      console.error('Search error:', error);
      this.showSearchError();
    }
  }

  async getSearchSuggestions(query) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockSuggestions = [
          { text: `${query} `, category: 'art' },
          { text: `${query} `, category: 'photography' },
          { text: `${query} `, category: 'design' },
          { text: `${query} `, category: 'video' },
          { text: `${query} `, category: 'all' }
        ];
        resolve(mockSuggestions);
      }, 200);
    });
  }

  displaySearchSuggestions(suggestions, query) {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;
    
    if (!suggestions || suggestions.length === 0) {
      searchSuggestions.innerHTML = `
        <div class="suggestion-item">
          <i class="fas fa-search suggestion-icon"></i>
          <span>No results for "${query}"</span>
        </div>
      `;
    } else {
      searchSuggestions.innerHTML = suggestions.map(suggestion => `
        <div class="suggestion-item" data-query="${suggestion.text || ''}">
          <i class="fas fa-search suggestion-icon"></i>
          <div class="suggestion-text">${suggestion.text || ''}</div>
          <span class="suggestion-category">${suggestion.category || 'general'}</span>
        </div>
      `).join('');

      searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          const query = item.dataset.query || '';
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.value = query;
          }
          this.performSearch(query);
          searchSuggestions.style.display = 'none';
        });
      });
    }
    
    searchSuggestions.style.display = 'block';
  }

  showRecentSearches() {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;
    
    const recentSearches = this.getRecentSearches();
    
    if (!recentSearches || recentSearches.length === 0) {
      searchSuggestions.innerHTML = `
        <div class="suggestion-item">
          <i class="fas fa-clock suggestion-icon"></i>
          <span>No recent searches</span>
        </div>
      `;
    } else {
      searchSuggestions.innerHTML = `
        <div class="suggestion-item" style="font-weight: 600; color: #666;">
          <i class="fas fa-clock suggestion-icon"></i>
          <span>Recent searches</span>
        </div>
        ${recentSearches.map(search => `
          <div class="suggestion-item" data-query="${search || ''}">
            <i class="fas fa-search suggestion-icon"></i>
            <div class="suggestion-text">${search || ''}</div>
          </div>
        `).join('')}
      `;

      searchSuggestions.querySelectorAll('.suggestion-item:not(:first-child)').forEach(item => {
        item.addEventListener('click', () => {
          const query = item.dataset.query || '';
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.value = query;
          }
          this.performSearch(query);
          searchSuggestions.style.display = 'none';
        });
      });
    }
    
    searchSuggestions.style.display = 'block';
  }

  showSearchError() {
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (!searchSuggestions) return;
    
    searchSuggestions.innerHTML = `
      <div class="suggestion-item">
        <i class="fas fa-exclamation-triangle suggestion-icon"></i>
        <span>Search temporarily unavailable</span>
      </div>
    `;
    searchSuggestions.style.display = 'block';
  }

  performSearch(query) {
    if (!query || !query.trim()) return;
    
    // Add search term to categories
    if (window.categoryManager) {
      categoryManager.addSearchCategory(query);
    }
    
    this.addToRecentSearches(query);
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = query;
    }
    
    // Show search results using the search manager
    if (window.searchManager) {
      searchManager.currentSearchTerm = query;
      searchManager.showSearchResults();
    }
    
    const searchSuggestions = document.getElementById('searchSuggestions');
    if (searchSuggestions) {
      searchSuggestions.style.display = 'none';
    }
  }

  selectCategory(category) {
    this.currentCategory = category || 'all';
    
    if (window.youtubePrompts) {
      // Filter prompts by category
      youtubePrompts.currentPage = 1;
      youtubePrompts.hasMore = true;
      youtubePrompts.loadInitialPrompts();
    }
    
    showNotification(`Showing ${this.getCategoryName(category)} prompts`, 'info');
  }

  getCategoryName(category) {
    const categories = {
      'photography': 'Photography',
    };
    return categories[category] || category || 'All';
  }

  getRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem('recentSearches') || '[]');
    } catch (error) {
      console.error('Error getting recent searches:', error);
      return [];
    }
  }

  addToRecentSearches(query) {
    try {
      let recent = this.getRecentSearches();
      recent = recent.filter(item => item !== query);
      recent.unshift(query);
      recent = recent.slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(recent));
    } catch (error) {
      console.error('Error adding to recent searches:', error);
    }
  }
}

// Engagement Manager Class - UPDATED: No view tracking
class EngagementManager {
  constructor() {
    this.user = null;
  }

  async init() {
    this.user = await getCurrentUser();
    // No automatic view tracking setup
  }

  // Only handle likes, uses, shares - NO VIEWS
  async handleLike(likeBtn) {
    // Your existing like handling code
  }

  async handleUse(useBtn) {
    // Your existing use handling code
  }

  async handleShare(shareBtn) {
    // Your existing share handling code
  }
}

// Search Manager Class
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
            filtered = filtered.filter(prompt => 
                prompt.category === this.currentCategory
            );
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
        
        // Reload YouTube-style prompts
        if (window.youtubePrompts) {
            youtubePrompts.currentPage = 1;
            youtubePrompts.hasMore = true;
            youtubePrompts.loadInitialPrompts();
        }
    }
}

// Mobile Navigation Functions
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
      <a href="news.html" class="nav-item">
        <i class="fas fa-cloud-upload-alt"></i>
        <span>News</span>
      </a>
      <button class="nav-item" id="mobileUploadBtn">
        <i class="fas fa-plus-circle"></i>
        <span>Upload</span>
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

// Filter buttons functionality
function initFilterButtons() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const filter = btn.textContent ? btn.textContent.toLowerCase() : 'all';
      
      // This will be handled by the YouTubeStylePrompts category filtering
      if (window.youtubePrompts) {
        youtubePrompts.currentPage = 1;
        youtubePrompts.hasMore = true;
        youtubePrompts.loadInitialPrompts();
      }
    });
  });
}

// Scroll effect for header
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

// Video thumbnail upload functionality
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
                
                // Show/hide thumbnail section based on file type
                if (videoThumbnailSection) {
                    videoThumbnailSection.style.display = isVideo ? 'block' : 'none';
                }
                
                // Update file type hint
                if (fileTypeHint) {
                    if (isVideo) {
                        fileTypeHint.innerHTML = '<i class="fas fa-play"></i> Video reel detected. You can upload a custom thumbnail below.';
                        fileTypeHint.style.color = '#ff6b6b';
                    } else {
                        fileTypeHint.innerHTML = '<i class="fas fa-image"></i> Image uploaded';
                        fileTypeHint.style.color = '#4e54c8';
                    }
                }
                
                // Show preview
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
    
    // Thumbnail preview
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
        
        // Drag and drop for thumbnail
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

// Upload Modal Functionality
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
  
  // Initialize video thumbnail upload
  initVideoThumbnailUpload();
}

// Enhanced upload handler to refresh both feeds
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
  const category = document.getElementById('category')?.value || '';
  const mediaFile = document.getElementById('imageUpload')?.files[0];
  const thumbnailFile = document.getElementById('videoThumbnailUpload')?.files[0];
  
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
  
  const maxSize = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB for videos, 5MB for images
  if (mediaFile.size > maxSize) {
    alert(`File size exceeds limit. ${isVideo ? 'Videos max 100MB' : 'Images max 5MB'}.`);
    return;
  }
  
  // Validate thumbnail if provided
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
    formData.append('media', mediaFile); // Main media file
    if (thumbnailFile) {
      formData.append('thumbnail', thumbnailFile); // Custom thumbnail
    }
    formData.append('title', title);
    formData.append('promptText', promptText);
    if (category) formData.append('category', category);
    formData.append('userName', user.name || 'User');
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`
      },
      body: formData
    });
    
    if (!response.ok) {
      let errorMsg = `Upload failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        console.error('Error parsing error response:', e);
      }
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
      if (imagePreview) {
        imagePreview.style.display = 'none';
      }
      if (videoThumbnailPreview) {
        videoThumbnailPreview.style.display = 'none';
      }
      if (videoThumbnailSection) {
        videoThumbnailSection.style.display = 'none';
      }
      
      showNotification(result.message || 'Upload successful!', 'success');
      
      // Clear cache to force refresh
      lastPromptUpdate = 0;
      allPrompts = [];
      
      // Immediately refresh both feeds
      if (window.shortsHorizontalFeed) {
        await window.shortsHorizontalFeed.refreshFeed();
      }
      
      if (window.youtubePrompts) {
        await window.youtubePrompts.refreshFeed();
      }
      
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
      submitBtn.innerHTML = '<i class="fas fa-upload"></i> Upload with SEO Optimization';
      submitBtn.disabled = false;
    }
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const existingNotification = document.querySelector('.notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
      <span>${message || 'Notification'}</span>
      <button class="notification-close"><i class="fas fa-times"></i></button>
    </div>
  `;
  
  if (!document.querySelector('#notification-styles')) {
    const styles = document.createElement('style');
    styles.id = 'notification-styles';
    styles.textContent = `
      .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 10000;
        max-width: 400px;
        animation: slideIn 0.3s ease;
      }
      .notification-success { border-left: 4px solid #20bf6b; }
      .notification-error { border-left: 4px solid #ff6b6b; }
      .notification-info { border-left: 4px solid #4e54c8; }
      .notification-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .notification-close {
        background: none;
        border: none;
        cursor: pointer;
        color: #777;
        margin-left: auto;
      }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(styles);
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
  
  const closeBtn = notification.querySelector('.notification-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notification.remove();
    });
  }
}

// Quick Fix for Case-Insensitive Search
function setupCaseInsensitiveSearch() {
  const searchInput = document.getElementById('searchInput');
  
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      // Search logic handles case-insensitive matching
    });
  }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing Prompt Seen with optimized loading and horizontal feeds...');
  
  await initializeFirebase();
  showAuthElements();
  
  // Initialize core UI immediately
  initMobileNavigation();
  initFilterButtons();
  initScrollEffects();
  initUploadModal(); // This now includes video thumbnail initialization
  initNewsUploadModal();
  
  // Initialize search functionality
  initSearchFunctionality();
  
  // Initialize YouTube-style prompts with infinite scroll (vertical feed)
  window.youtubePrompts = new YouTubeStylePrompts();
  
  // Initialize horizontal shorts feed
  window.shortsHorizontalFeed = new ShortsHorizontalFeed();
  
  // Start auto-refresh for both feeds
  window.shortsHorizontalFeed.startAutoRefresh();
  window.youtubePrompts.startAutoRefresh();
  
  // Initialize category manager
  window.categoryManager = new CategoryManager();
  
  // Initialize engagement manager
  const engagementManager = new EngagementManager();
  await engagementManager.init();
  
  // Initialize search functionality
  window.searchManager = new SearchManager();
  await searchManager.init();
  
  // Initialize news functionality
  window.newsManager = new NewsManager();
  
  // Load news if news container exists
  if (document.getElementById('newsContainer')) {
    newsManager.loadNews();
  }
  
  // Initialize YouTube-style header
  const youTubeHeader = new YouTubeStyleHeader();
  
  // Setup case-insensitive search
  setupCaseInsensitiveSearch();
  
  // Add mobile bottom navigation
  addMobileNavigation();
  
  // Initialize mobile horizontal scrolling
  initMobileHorizontalScroll();
  
  // Initialize enhanced horizontal feed functionality
  if (!window.horizontalFeedManager) {
    window.horizontalFeedManager = new HorizontalFeedManager();
  }
  
  // Initialize touch support
  initHorizontalFeedTouchSupport();
  
  // Initialize all existing feeds
  setTimeout(() => {
    if (window.horizontalFeedManager) {
      window.horizontalFeedManager.initializeAllFeeds();
    }
  }, 1500);
  
  // Add shorts filter button
  setTimeout(() => {
    addShortsFilterButton();
  }, 2000);
  
  // Add horizontal feed filters
  setTimeout(() => {
    addHorizontalFeedFilters();
  }, 2500);
  
  // Re-initialize on resize
  window.addEventListener('resize', initMobileHorizontalScroll);
  
  // Add structured data for homepage
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Prompt Seen",
    "url": "https://www.promptseen.co",
    "description": "AI Prompt Provider and Sharing platform - Create, share and discover effective AI prompts",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.promptseen.co/search?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  };
  
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(structuredData);
  document.head.appendChild(script);
  
  console.log('Prompt Seen initialization complete with horizontal feeds and video shorts');
});

// Mobile Navigation Toggle
document.addEventListener('DOMContentLoaded', function() {
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navLinks = document.querySelector('.nav-links');
    const mobileOverlay = document.createElement('div');
    
    mobileOverlay.className = 'mobile-overlay';
    document.body.appendChild(mobileOverlay);
    
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function() {
          navLinks.classList.toggle('active');
          mobileOverlay.classList.toggle('active');
          document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
      });
    }
    
    mobileOverlay.addEventListener('click', function() {
        navLinks.classList.remove('active');
        mobileOverlay.classList.remove('active');
        document.body.style.overflow = '';
    });
    
    const navLinksItems = document.querySelectorAll('.nav-links a');
    navLinksItems.forEach(link => {
        link.addEventListener('click', function() {
            navLinks.classList.remove('active');
            mobileOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    });
    
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            navLinks.classList.remove('active');
            mobileOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
});

// Make functions available globally
window.loadUploads = () => {
  if (window.youtubePrompts) {
    youtubePrompts.currentPage = 1;
    youtubePrompts.hasMore = true;
    youtubePrompts.loadInitialPrompts();
  }
};

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

// Helper functions for search
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

// Add cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.videoHoverManager) {
        window.videoHoverManager.cleanup();
    }
});