// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAzbWLTCm_FMCEHoqGhIZ1xKQmuTej9rjo",
  authDomain: "aicloude-63cab.firebaseapp.com",
  databaseURL: "https://aicloude-63cab-default-rtdb.firebaseio.com",
  projectId: "aicloude-63cab",
  storageBucket: "aicloude-63cab.firebasestorage.app",
  messagingSenderId: "165516825130",
  appId: "1:165516825130:web:b79d21b218d72869436953",
  measurementId: "G-LS811PSS3V"
};

// Track Firebase initialization state
let firebaseInitialized = false;

// Initialize Firebase only if not already initialized
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

// Get current user with auth state persistence
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
  
  if (authSection) {
    if (user) {
      authSection.innerHTML = `
        <div class="user-profile">
          <img src="${user.avatar}" alt="${user.name}" class="user-avatar">
          <span>${user.name}</span>
          <button class="logout-btn"><i class="fas fa-sign-out-alt"></i></button>
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
    uploadButton.style.display = user ? 'block' : 'none';
  }
}

// Mobile Navigation Toggle
const mobileToggle = document.querySelector('.mobile-toggle');
const navLinks = document.querySelector('.nav-links');

if (mobileToggle && navLinks) {
  mobileToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
  });
}

// Filter buttons functionality
const filterBtns = document.querySelectorAll('.filter-btn');

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons
    filterBtns.forEach(b => b.classList.remove('active'));
    // Add active class to clicked button
    btn.classList.add('active');
    
    // In a real implementation, this would filter the showcase content
    console.log(`Filtering by: ${btn.textContent}`);
  });
});

// Add scroll effect to header
window.addEventListener('scroll', () => {
  const header = document.querySelector('header');
  if (header) {
    if (window.scrollY > 100) {
      header.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.1)';
      header.style.background = 'rgba(255, 255, 255, 0.98)';
    } else {
      header.style.boxShadow = '0 2px 15px rgba(0, 0, 0, 0.1)';
      header.style.background = 'rgba(255, 255, 255, 0.95)';
    }
  }
});

// Handle redirect after 404
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Firebase
  await initializeFirebase();
  
  // Initialize auth UI
  showAuthElements();
  
  // Check for redirect URL
  const redirect = sessionStorage.redirect;
  delete sessionStorage.redirect;
  if (redirect && redirect !== location.pathname) {
    history.replaceState(null, null, redirect);
  }
});

// Prompt Enhancement Functionality
const userPrompt = document.getElementById('userPrompt');
const enhancedPrompt = document.getElementById('enhancedPrompt');
const convertBtn = document.getElementById('convertBtn');

if (userPrompt && enhancedPrompt && convertBtn) {
  // Safe enhancements that follow content policies
  const enhancements = {
    styles: ['cinematic', 'photorealistic', 'oil painting', 'watercolor', 'anime', 'pixel art', 'concept art', 'impressionist', 'illustration', 'digital art'],
    details: ['intricate details', 'highly detailed', 'sharp focus', '8k resolution', 'ultra HD'],
    lighting: ['dramatic lighting', 'soft natural light', 'volumetric lighting', 'golden hour', 'neon glow', 'moody ambiance'],
    compositions: ['rule of thirds', 'centered composition', 'shallow depth of field', 'wide angle view', 'macro shot'],
    technical: ['--ar 16:9', '--v 5', '--style raw', '--no blur', '--s 750']
  };
  
  // Content policy filter
  const forbiddenKeywords = [
    'nude', 'naked', 'sexual', 'violence', 'blood', 'gore', 'hate', 'racist',
    'offensive', 'illegal', 'weapon', 'drug', 'alcohol', 'tobacco', 'explicit'
  ];
  
  // Function to check prompt safety
  function isPromptSafe(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    return !forbiddenKeywords.some(keyword => lowerPrompt.includes(keyword));
  }
  
  // Function to enhance prompt safely
  function enhancePrompt(prompt) {
    // Check content policy compliance
    if (!isPromptSafe(prompt)) {
      return "This prompt could not be enhanced due to content policy restrictions. Please try a different prompt.";
    }
    
    // Basic enhancements
    let enhanced = prompt.trim();
    
    // Capitalize first letter
    enhanced = enhanced.charAt(0).toUpperCase() + enhanced.slice(1);
    
    // Add details based on content
    if (enhanced.includes('cat') || enhanced.includes('dog') || enhanced.includes('animal')) {
      enhanced += `, ${getRandomItem(enhancements.details)}, fur texture detailed`;
    }
    
    if (enhanced.includes('landscape') || enhanced.includes('city') || enhanced.includes('nature')) {
      enhanced += `, ${getRandomItem(enhancements.lighting)}, atmospheric perspective`;
    }
    
    if (enhanced.includes('portrait') || enhanced.includes('person') || enhanced.includes('character')) {
      enhanced += `, ${getRandomItem(enhancements.details)}, expressive eyes`;
    }
    
    // Add safe enhancements
    enhanced += `, ${getRandomItem(enhancements.styles)} style`;
    enhanced += `, ${getRandomItem(enhancements.lighting)}`;
    
    // Add composition 40% of the time
    if (Math.random() > 0.6) {
      enhanced += `, ${getRandomItem(enhancements.compositions)}`;
    }
    
    // Add technical specifications
    enhanced += ` ${getRandomItem(enhancements.technical)}`;
    
    return enhanced;
  }
  
  // Helper function to get random item from array
  function getRandomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
  }
  
  // Convert button event
  convertBtn.addEventListener('click', () => {
    const rawPrompt = userPrompt.value.trim();
    
    if (rawPrompt === '') {
      enhancedPrompt.value = 'Please enter a prompt to enhance!';
      return;
    }
    
    // Show loading state
    convertBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enhancing...';
    convertBtn.disabled = true;
    
    // Simulate processing time
    setTimeout(() => {
      const result = enhancePrompt(rawPrompt);
      enhancedPrompt.value = result;
      
      // Restore button
      convertBtn.innerHTML = '<i class="fas fa-bolt"></i> Enhance Prompt';
      convertBtn.disabled = false;
    }, 1000);
  });
  
  // Initialize with an example
  window.addEventListener('load', () => {
    const exampleResult = enhancePrompt(userPrompt.value);
    enhancedPrompt.value = exampleResult;
  });
}

// Upload Modal Functionality
const uploadModal = document.getElementById('uploadModal');
const openUploadBtn = document.getElementById('openUploadModal');
const closeModalBtn = document.getElementById('closeModal');
const uploadForm = document.getElementById('uploadForm');
const imageUpload = document.getElementById('imageUpload');
const imagePreview = document.getElementById('imagePreview');
const promptsContainer = document.getElementById('promptsContainer');

if (openUploadBtn && uploadModal) {
  // Open modal
  openUploadBtn.addEventListener('click', () => {
    // Check authentication
    const user = checkAuth();
    if (!user) {
      alert('Please login to upload creations');
      window.location.href = 'login.html?returnUrl=' + encodeURIComponent(window.location.href);
      return;
    }
    
    uploadModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent scrolling
  });
}

if (closeModalBtn && uploadModal) {
  // Close modal
  closeModalBtn.addEventListener('click', () => {
    uploadModal.classList.remove('active');
    document.body.style.overflow = '';
  });
}

if (uploadModal) {
  // Close modal when clicking outside
  uploadModal.addEventListener('click', (e) => {
    if (e.target === uploadModal) {
      uploadModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
}

if (imageUpload && imagePreview) {
  // Preview image when selected
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
}

if (uploadForm && promptsContainer) {
  // Handle form submission
  uploadForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const user = checkAuth();
    if (!user) {
      alert('Please login to upload creations');
      window.location.href = 'login.html?returnUrl=' + encodeURIComponent(window.location.href);
      return;
    }
    
    const title = document.getElementById('promptTitle').value;
    const promptText = document.getElementById('promptText').value;
    const file = imageUpload.files[0];
    
    // Validate inputs
    if (!file) {
      alert('Please select an image to upload!');
      return;
    }
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Please upload a JPEG, PNG, or WebP image');
      return;
    }
    
    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds 5MB limit. Please choose a smaller image.');
      return;
    }
    
    if (!title || !title.trim()) {
      alert('Please enter a title for your creation');
      return;
    }
    
    if (!promptText || !promptText.trim()) {
      alert('Please enter the prompt text used to generate this image');
      return;
    }
    
    try {
      // Show loading state
      const submitBtn = uploadForm.querySelector('.submit-btn');
      const originalBtnText = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
      submitBtn.disabled = true;
      
      // Ensure Firebase is initialized and get current user
      await initializeFirebase();
      const firebaseUser = await getCurrentUser();
      
      if (!firebaseUser) {
        throw new Error('User not authenticated with Firebase. Please log in again.');
      }
      
      // Get Firebase token
      const idToken = await firebaseUser.getIdToken();
      
      // Create FormData
      const formData = new FormData();
      formData.append('image', file);
      formData.append('title', title);
      formData.append('promptText', promptText);
      
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
        // Add to showcase
        addPromptToShowcase(result.upload);
        
        // Close modal and reset form
        uploadModal.classList.remove('active');
        document.body.style.overflow = '';
        uploadForm.reset();
        imagePreview.style.display = 'none';
        
        alert('Upload successful! Your creation is now visible in the showcase.');
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      // Show user-friendly error messages
      let userMessage;
      
      if (error.message.includes('bucket') || error.message.includes('Storage')) {
        userMessage = 'Storage service unavailable. Please try again later.';
      } else if (error.message.includes('permission') || error.message.includes('credentials')) {
        userMessage = 'Permission error. Please log out and log in again.';
      } else if (error.message.includes('size')) {
        userMessage = 'File too large. Please select an image under 5MB.';
      } else {
        userMessage = 'Could not save your image. Please try a different file.';
      }
      
      alert(`Upload failed: ${userMessage}`);
    } finally {
      // Restore button
      const submitBtn = uploadForm.querySelector('.submit-btn');
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-upload"></i> Submit Creation';
        submitBtn.disabled = false;
      }
    }
  });
  
  // Add prompt to showcase grid
  function addPromptToShowcase(prompt) {
    const promptCard = createPromptCard(prompt);
    
    // Add to the top of the grid
    promptsContainer.prepend(promptCard);
  }
  
  function createPromptCard(prompt) {
    const promptCard = document.createElement('div');
    promptCard.className = 'prompt-card';
    promptCard.innerHTML = `
      <div class="prompt-image" style="background-image: url('${prompt.imageUrl}')">
        <div class="viral-badge" style="background: #20bf6b">
          <i class="fas fa-user"></i> Your Upload
        </div>
      </div>
      <div class="prompt-content">
        <div class="prompt-meta">
          <span><i class="fas fa-heart"></i> ${prompt.likes} Likes</span>
          <span><i class="fas fa-download"></i> ${prompt.uses} Uses</span>
        </div>
        <h3 class="prompt-title">${prompt.title}</h3>
        <div class="prompt-text">
          ${prompt.promptText}
        </div>
        <div class="prompt-analysis">
          <h4>Why this prompt works:</h4>
          <p>This prompt was successfully generated by a community member. It demonstrates effective prompt engineering techniques to achieve desired results.</p>
        </div>
      </div>
    `;
    return promptCard;
  }
  
  // Load uploads from server with pagination
  async function loadUploads(page = 1) {
    try {
      // Show loading state
      promptsContainer.innerHTML = '<div class="loading">Loading creations...</div>';
      
      const response = await fetch(`/api/uploads?page=${page}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load uploads: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Clear container
      promptsContainer.innerHTML = '';
      
      // Add uploads
      data.uploads.forEach(upload => {
        const promptCard = createPromptCard(upload);
        promptsContainer.appendChild(promptCard);
      });
      
      // Update pagination
      updatePagination(data.currentPage, data.totalPages);
    } catch (error) {
      console.error('Error loading uploads:', error);
      promptsContainer.innerHTML = '<p class="error">Error loading content. Please try again later.</p>';
    }
  }
  
  function updatePagination(currentPage, totalPages) {
    const pagination = document.querySelector('.pagination');
    if (!pagination) return;
    
    pagination.innerHTML = '';
    
    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) loadUploads(currentPage - 1);
    });
    pagination.appendChild(prevBtn);
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => {
        if (i !== currentPage) loadUploads(i);
      });
      pagination.appendChild(pageBtn);
    }
    
    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) loadUploads(currentPage + 1);
    });
    pagination.appendChild(nextBtn);
  }
  
  // Load first page on showcase page load
  if (window.location.pathname.includes('showcase.html')) {
    window.addEventListener('load', () => {
      loadUploads(1);
    });
  }
}