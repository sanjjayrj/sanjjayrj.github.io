// Theme toggle
(function() {
  var saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }

  document.addEventListener('DOMContentLoaded', function() {
    var toggle = document.getElementById('theme-toggle');
    var icon = document.getElementById('theme-icon');
    if (!toggle || !icon) return;

    function updateIcon() {
      var current = document.documentElement.getAttribute('data-theme');
      if (current === 'light') {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
      }
    }
    updateIcon();

    toggle.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateIcon();
    });
  });
})();

// Nav scroll hide/show
(function() {
  const nav = document.getElementById('navbar');
  let lastScrollY = 0;

  window.addEventListener('scroll', function() {
    const currentScrollY = window.pageYOffset;
    if (currentScrollY > lastScrollY && currentScrollY > 100) {
      nav.classList.add('nav-hidden');
    } else {
      nav.classList.remove('nav-hidden');
    }
    lastScrollY = currentScrollY <= 0 ? 0 : currentScrollY;
  });
})();

// Hamburger menu toggle
function toggleMenu() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('nav-links');
  hamburger.classList.toggle('active');
  navLinks.classList.toggle('active');
}

// Close mobile menu on link click
document.querySelectorAll('.nav-links a').forEach(function(link) {
  link.addEventListener('click', function() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('nav-links');
    hamburger.classList.remove('active');
    navLinks.classList.remove('active');
  });
});

// About image tap toggle (mobile)
(function() {
  var img = document.querySelector('.about-image img');
  if (!img) return;
  img.addEventListener('click', function() {
    img.classList.toggle('color-active');
  });
})();

// Scroll reveal (Intersection Observer)
(function() {
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(function(el) {
    observer.observe(el);
  });
})();

// Active nav link highlighting
(function() {
  var sections = document.querySelectorAll('.section[id]');
  if (sections.length === 0) return;

  var navLinks = document.querySelectorAll('.nav-links a');

  var sectionObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var id = entry.target.getAttribute('id');
        navLinks.forEach(function(link) {
          link.classList.remove('active');
          if (link.getAttribute('href') === '/#' + id || link.getAttribute('href') === '#' + id) {
            link.classList.add('active');
          }
        });
      }
    });
  }, { threshold: 0.3, rootMargin: '-80px 0px 0px 0px' });

  sections.forEach(function(section) {
    sectionObserver.observe(section);
  });
})();
