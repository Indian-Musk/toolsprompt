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
document.addEventListener('DOMContentLoaded', () => {
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
    // Sample enhancements
    const enhancements = {
        styles: ['cinematic', 'photorealistic', 'oil painting', 'watercolor', 'anime', 'pixel art', 'concept art', 'impressionist'],
        details: ['intricate details', 'highly detailed', 'sharp focus', '8k resolution', 'ultra HD'],
        lighting: ['dramatic lighting', 'soft natural light', 'volumetric lighting', 'golden hour', 'neon glow', 'moody ambiance'],
        artists: ['by Studio Ghibli', 'in the style of Van Gogh', 'photography by Ansel Adams', 'art by Beeple', 'concept art by Craig Mullins'],
        compositions: ['rule of thirds', 'centered composition', 'shallow depth of field', 'wide angle view', 'macro shot'],
        technical: ['--ar 16:9', '--v 5', '--style raw', '--no blur', '--s 750']
    };
    
    // Function to enhance prompt
    function enhancePrompt(prompt) {
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
        
        // Add random enhancements
        enhanced += `, ${getRandomItem(enhancements.styles)} style`;
        enhanced += `, ${getRandomItem(enhancements.lighting)}`;
        
        // Add artist/style 50% of the time
        if (Math.random() > 0.5) {
            enhanced += `, ${getRandomItem(enhancements.artists)}`;
        }
        
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
        if (userPrompt.value.trim() === '') {
            enhancedPrompt.value = 'Please enter a prompt to enhance!';
            return;
        }
        
        // Show loading state
        convertBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enhancing...';
        convertBtn.disabled = true;
        
        // Simulate processing time
        setTimeout(() => {
            const result = enhancePrompt(userPrompt.value);
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
        }
    });
}

if (uploadForm && promptsContainer) {
    // Handle form submission
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const title = document.getElementById('promptTitle').value;
        const promptText = document.getElementById('promptText').value;
        const file = imageUpload.files[0];
        
        if (!file) {
            alert('Please select an image to upload!');
            return;
        }
        
        // Create a FileReader to get the image data
        const reader = new FileReader();
        reader.onload = function(event) {
            const imageData = event.target.result;
            
            // Create a new prompt object
            const newPrompt = {
                title,
                promptText,
                imageData,
                likes: Math.floor(Math.random() * 500) + 50,
                uses: Math.floor(Math.random() * 300) + 30,
                isUserUpload: true
            };
            
            // Save to localStorage
            savePromptToStorage(newPrompt);
            
            // Add to showcase
            addPromptToShowcase(newPrompt);
            
            // Close modal and reset form
            uploadModal.classList.remove('active');
            document.body.style.overflow = '';
            uploadForm.reset();
            imagePreview.style.display = 'none';
        };
        
        reader.readAsDataURL(file);
    });
    
    // Save prompt to localStorage
    function savePromptToStorage(prompt) {
        let prompts = JSON.parse(localStorage.getItem('userPrompts')) || [];
        prompts.push(prompt);
        localStorage.setItem('userPrompts', JSON.stringify(prompts));
    }
    
    // Add prompt to showcase grid
    function addPromptToShowcase(prompt) {
        const promptCard = document.createElement('div');
        promptCard.className = 'prompt-card';
        promptCard.innerHTML = `
            <div class="prompt-image" style="background-image: url('${prompt.imageData}')">
                <div class="viral-badge" style="background: ${prompt.isUserUpload ? '#20bf6b' : '#ff6b6b'}">
                    <i class="${prompt.isUserUpload ? 'fas fa-user' : 'fas fa-fire'}"></i> 
                    ${prompt.isUserUpload ? 'Your Upload' : 'Viral'}
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
        
        // Add to the top of the grid
        promptsContainer.prepend(promptCard);
    }
    
    // Load user prompts from localStorage on page load
    window.addEventListener('load', () => {
        const savedPrompts = JSON.parse(localStorage.getItem('userPrompts')) || [];
        savedPrompts.forEach(prompt => {
            addPromptToShowcase(prompt);
        });
    });
}