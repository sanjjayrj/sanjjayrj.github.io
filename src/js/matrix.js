// Matrix rain animation for hero section
(function() {
  var canvas = document.getElementById('matrix-canvas');
  if (!canvas) return;

  // Disable on mobile
  if (window.innerWidth < 768) return;

  var ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;:,.<>?/~`';
  var charArr = chars.split('');
  var fontSize = 14;
  var columns = Math.floor(canvas.width / fontSize);
  var drops = [];

  for (var i = 0; i < columns; i++) {
    drops[i] = Math.random() * -100;
  }

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function draw() {
    var light = isLight();
    ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = fontSize + 'px JetBrains Mono, monospace';

    for (var i = 0; i < drops.length; i++) {
      var text = charArr[Math.floor(Math.random() * charArr.length)];
      var x = i * fontSize;
      var y = drops[i] * fontSize;

      var opacity = 0.03 + Math.random() * 0.12;
      ctx.fillStyle = light
        ? 'rgba(0, 0, 0, ' + opacity + ')'
        : 'rgba(255, 255, 255, ' + opacity + ')';
      ctx.fillText(text, x, y);

      if (y > canvas.height && Math.random() > 0.985) {
        drops[i] = 0;
      }
      drops[i] += 0.5;
    }
  }

  var animationId;
  function animate() {
    draw();
    animationId = requestAnimationFrame(animate);
  }
  animate();

  // Pause when hero is not visible
  var hero = document.getElementById('hero');
  if (hero) {
    var heroObserver = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        if (!animationId) animate();
      } else {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    }, { threshold: 0.1 });
    heroObserver.observe(hero);
  }
})();
