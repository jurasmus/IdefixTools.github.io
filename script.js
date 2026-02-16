document.addEventListener('DOMContentLoaded', function () {

    // --- Dark mode toggle ---
    const darkModeToggle = document.getElementById('darkModeToggle');
    const darkModePreference = localStorage.getItem('darkMode');

    if (darkModePreference === 'disabled') {
        document.body.classList.remove('dark-mode');
    }

    updateDarkModeIcon();

    darkModeToggle.addEventListener('click', function () {
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

    // --- Smooth scroll for anchor links ---
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener('click', function (e) {
            var targetId = this.getAttribute('href');
            if (targetId === '#') return;

            var targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                var headerHeight = document.querySelector('.site-header').offsetHeight;
                var targetPosition = targetElement.offsetTop - headerHeight - 24;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // --- Scroll-triggered reveal ---
    var revealElements = document.querySelectorAll('[data-reveal]');

    var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(function (el) {
        revealObserver.observe(el);
    });

    // --- Read more / less ---
    document.querySelectorAll('.read-more-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            var description = this.parentElement;
            var fullText = description.getAttribute('data-full-text');
            var shortText = description.querySelector('.short-text');
            var ellipsis = description.querySelector('.ellipsis');

            if (!description.classList.contains('expanded')) {
                if (shortText) shortText.style.display = 'none';
                if (ellipsis) ellipsis.style.display = 'none';

                var fullTextSpan = description.querySelector('.full-text');
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
                if (shortText) shortText.style.display = 'inline';
                if (ellipsis) ellipsis.style.display = 'inline';

                var fullTextSpan = description.querySelector('.full-text');
                if (fullTextSpan) fullTextSpan.style.display = 'none';

                this.textContent = 'read more';
                description.classList.remove('expanded');
            }
        });
    });

});
