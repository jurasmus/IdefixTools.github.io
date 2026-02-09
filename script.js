document.addEventListener('DOMContentLoaded', function() {
    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    const isDarkMode = localStorage.getItem('darkMode') === 'enabled';
    
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        updateDarkModeIcon();
    }
    
    darkModeToggle.addEventListener('click', function() {
        document.body.classList.toggle('dark-mode');
        const isEnabled = document.body.classList.contains('dark-mode');
        localStorage.setItem('darkMode', isEnabled ? 'enabled' : 'disabled');
        updateDarkModeIcon();
    });
    
    function updateDarkModeIcon() {
        const icon = darkModeToggle.querySelector('i');
        if (document.body.classList.contains('dark-mode')) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    }

    // Smooth scroll for CTA buttons
    const buttons = document.querySelectorAll('a[href^="#"]');
    
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const headerHeight = document.querySelector('.site-header').offsetHeight;
                const targetPosition = targetElement.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Read more/less functionality
    const readMoreLinks = document.querySelectorAll('.read-more-link');
    
    readMoreLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const description = this.parentElement;
            const fullText = description.getAttribute('data-full-text');
            const shortText = description.querySelector('.short-text');
            const ellipsis = description.querySelector('.ellipsis');
            
            if (!description.classList.contains('expanded')) {
                // Expand: hide short text and ellipsis, show full text
                if (shortText) shortText.style.display = 'none';
                if (ellipsis) ellipsis.style.display = 'none';
                
                // Create full text span if it doesn't exist
                let fullTextSpan = description.querySelector('.full-text');
                if (!fullTextSpan) {
                    fullTextSpan = document.createElement('span');
                    fullTextSpan.className = 'full-text';
                    fullTextSpan.textContent = fullText + ' ';
                    description.insertBefore(fullTextSpan, this);
                } else {
                    fullTextSpan.style.display = 'inline';
                }
                
                this.textContent = 'read less';
                description.classList.add('expanded');
            } else {
                // Collapse: show short text and ellipsis, hide full text
                if (shortText) shortText.style.display = 'inline';
                if (ellipsis) ellipsis.style.display = 'inline';
                
                const fullTextSpan = description.querySelector('.full-text');
                if (fullTextSpan) fullTextSpan.style.display = 'none';
                
                this.textContent = 'read more';
                description.classList.remove('expanded');
            }
        });
    });
});
