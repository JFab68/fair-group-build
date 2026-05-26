(function() {
  'use strict';

  // Mobile menu toggle
  var btn = document.getElementById('mobile-menu-btn');
  var menu = document.getElementById('mobile-menu');
  if (btn && menu) {
    btn.addEventListener('click', function() {
      var isOpen = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  // Mobile logout button
  var mobileLogout = document.getElementById('logout-btn-mobile');
  if (mobileLogout) {
    mobileLogout.addEventListener('click', async function() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }
})();
