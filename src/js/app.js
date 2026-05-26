(function() {
  'use strict';

  let csrfToken = '';
  let currentUser = null;

  async function fetchCsrfToken() {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  async function checkAuth() {
    try {
      const res = await fetch('/api/user/profile');
      if (!res.ok) {
        window.location.href = '/login.html';
        return null;
      }
      currentUser = await res.json();
      return currentUser;
    } catch {
      window.location.href = '/login.html';
      return null;
    }
  }

  function setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });
    }
  }

  // --- Dashboard ---
  async function initDashboard() {
    const user = await checkAuth();
    if (!user) return;
    await fetchCsrfToken();

    const welcomeEl = document.getElementById('welcome-name');
    if (welcomeEl) welcomeEl.textContent = user.firstName;

    const adminLink = document.getElementById('admin-link');
    if (adminLink && user.role === 'admin') {
      adminLink.classList.remove('hidden');
    }

    setupLogout();
  }

  // --- Subcommittee Tabs ---
  function initSubcommittee() {
    checkAuth().then(user => {
      if (!user) return;
      setupLogout();

      const urlParams = new URLSearchParams(window.location.search);
      const groupName = urlParams.get('group') || 'Working Group';
      const titleEl = document.getElementById('group-title');
      if (titleEl) titleEl.textContent = groupName;

      document.querySelectorAll('[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.tab;
          document.querySelectorAll('[data-tab]').forEach(t => {
            t.classList.toggle('border-navy', t.dataset.tab === target);
            t.classList.toggle('text-navy', t.dataset.tab === target);
            t.classList.toggle('border-transparent', t.dataset.tab !== target);
            t.classList.toggle('text-gray-500', t.dataset.tab !== target);
          });
          document.querySelectorAll('[data-tab-content]').forEach(content => {
            content.classList.toggle('hidden', content.dataset.tabContent !== target);
          });
        });
      });
    });
  }

  // --- Profile ---
  async function initProfile() {
    const user = await checkAuth();
    if (!user) return;
    setupLogout();

    const fields = ['firstName', 'lastName', 'email', 'phone', 'city', 'county', 'interestAreas'];
    fields.forEach(field => {
      const el = document.getElementById(`profile-${field}`);
      if (el) el.textContent = user[field] || 'Not provided';
    });

    // Sync profile header display
    const headerName = document.getElementById('profile-header-name');
    const headerEmail = document.getElementById('profile-header-email');
    if (headerName) headerName.textContent = (user.firstName + ' ' + user.lastName).trim();
    if (headerEmail) headerEmail.textContent = user.email;
  }

  // --- Admin ---
  async function initAdmin() {
    const user = await checkAuth();
    if (!user || user.role !== 'admin') {
      window.location.href = '/dashboard.html';
      return;
    }
    await fetchCsrfToken();
    setupLogout();

    document.querySelectorAll('[data-admin-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.adminTab;
        document.querySelectorAll('[data-admin-tab]').forEach(t => {
          t.classList.toggle('bg-navy', t.dataset.adminTab === target);
          t.classList.toggle('text-white', t.dataset.adminTab === target);
          t.classList.toggle('bg-gray-200', t.dataset.adminTab !== target);
        });
        document.querySelectorAll('[data-admin-content]').forEach(c => {
          c.classList.toggle('hidden', c.dataset.adminContent !== target);
        });
        if (target === 'pending') loadPendingUsers();
        if (target === 'all') loadAllUsers();
        if (target === 'audit') loadAuditLogs();
      });
    });

    loadPendingUsers();
  }

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function updateUserStatus(userId, status) {
    try {
      var res = await fetch('/api/admin/users/' + userId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ status: status }),
      });
      if (res.ok) {
        loadPendingUsers();
      } else {
        var data = await res.json();
        alert(data.error || 'Update failed');
      }
    } catch (e) {
      alert('Connection error. Please try again.');
    }
  }

  async function loadPendingUsers() {
    try {
      var res = await fetch('/api/admin/users/pending');
      var users = await res.json();
      var container = document.getElementById('pending-users');
      if (!container) return;

      if (users.length === 0) {
        container.innerHTML = '<p class="text-gray-500 p-4">No pending applications.</p>';
        return;
      }

      container.innerHTML = users.map(function(u) {
        var location = esc(u.city || '') + (u.city && u.county ? ', ' : '') + esc(u.county || '');
        var statement = u.statement ? '<p class="text-sm mt-2 italic">"' + esc(u.statement) + '"</p>' : '';
        return '<div class="card mb-4">'
          + '<div class="flex justify-between items-start">'
          + '<div>'
          + '<h3 class="font-heading text-lg font-bold">' + esc(u.firstName) + ' ' + esc(u.lastName) + '</h3>'
          + '<p class="text-sm text-gray-600">' + esc(u.email) + '</p>'
          + '<p class="text-sm text-gray-600">' + location + '</p>'
          + '<p class="text-sm mt-1"><strong>Interests:</strong> ' + esc(u.interestAreas || 'None specified') + '</p>'
          + statement
          + '<p class="text-xs text-gray-400 mt-1">Applied: ' + new Date(u.createdAt).toLocaleDateString() + '</p>'
          + '</div>'
          + '<div class="flex gap-2">'
          + '<button data-action="approve" data-user-id="' + u.id + '" class="btn-primary text-sm px-4 py-2">Approve</button>'
          + '<button data-action="reject" data-user-id="' + u.id + '" class="btn-secondary text-sm px-4 py-2">Reject</button>'
          + '</div>'
          + '</div>'
          + '</div>';
      }).join('');

      container.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var userId = parseInt(btn.dataset.userId, 10);
        var action = btn.dataset.action;
        var status = action === 'approve' ? 'approved' : 'rejected';
        updateUserStatus(userId, status);
      });
    } catch (error) {
      console.error('Failed to load pending users:', error);
    }
  }

  async function loadAllUsers() {
    try {
      var res = await fetch('/api/admin/users');
      var users = await res.json();
      var container = document.getElementById('all-users');
      if (!container) return;

      var statusColors = { approved: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800', rejected: 'bg-red-100 text-red-800' };

      var rows = users.map(function(u) {
        return '<tr class="border-b">'
          + '<td class="p-3">' + esc(u.firstName) + ' ' + esc(u.lastName) + '</td>'
          + '<td class="p-3">' + esc(u.email) + '</td>'
          + '<td class="p-3"><span class="px-2 py-1 rounded text-xs font-semibold ' + (statusColors[u.status] || '') + '">' + esc(u.status) + '</span></td>'
          + '<td class="p-3">' + esc(u.role) + '</td>'
          + '<td class="p-3">' + new Date(u.createdAt).toLocaleDateString() + '</td>'
          + '</tr>';
      }).join('');

      container.innerHTML = '<table class="w-full text-sm">'
        + '<thead class="bg-light-gray"><tr>'
        + '<th class="text-left p-3">Name</th>'
        + '<th class="text-left p-3">Email</th>'
        + '<th class="text-left p-3">Status</th>'
        + '<th class="text-left p-3">Role</th>'
        + '<th class="text-left p-3">Joined</th>'
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table>';
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }

  var currentAuditPage = 1;

  async function loadAuditLogs(page) {
    if (page === undefined) page = 1;
    currentAuditPage = page;
    try {
      var res = await fetch('/api/admin/audit-logs?page=' + page);
      var data = await res.json();
      var container = document.getElementById('audit-logs');
      if (!container) return;

      var rows = data.logs.map(function(log) {
        return '<tr class="border-b">'
          + '<td class="p-3">' + esc(log.action) + '</td>'
          + '<td class="p-3">' + esc(log.adminEmail) + '</td>'
          + '<td class="p-3">' + esc(log.targetType) + ' #' + log.targetId + '</td>'
          + '<td class="p-3 text-xs">' + esc(log.details) + '</td>'
          + '<td class="p-3">' + new Date(log.timestamp).toLocaleString() + '</td>'
          + '</tr>';
      }).join('');

      var prevBtn = data.page > 1 ? '<button data-audit-page="' + (data.page - 1) + '" class="btn-outline text-sm px-3 py-1">Previous</button>' : '';
      var nextBtn = data.page < data.totalPages ? '<button data-audit-page="' + (data.page + 1) + '" class="btn-outline text-sm px-3 py-1">Next</button>' : '';

      container.innerHTML = '<table class="w-full text-sm">'
        + '<thead class="bg-light-gray"><tr>'
        + '<th class="text-left p-3">Action</th>'
        + '<th class="text-left p-3">Admin</th>'
        + '<th class="text-left p-3">Target</th>'
        + '<th class="text-left p-3">Details</th>'
        + '<th class="text-left p-3">Timestamp</th>'
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table>'
        + '<div class="flex justify-between items-center mt-4">'
        + '<span class="text-sm text-gray-600">Page ' + data.page + ' of ' + data.totalPages + '</span>'
        + '<div class="flex gap-2">' + prevBtn + nextBtn + '</div>'
        + '</div>';

      container.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-audit-page]');
        if (!btn) return;
        loadAuditLogs(parseInt(btn.dataset.auditPage, 10));
      });
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    }
  }

  // --- Resources ---
  async function initResources() {
    const user = await checkAuth();
    if (!user) return;
    setupLogout();
    const adminLink = document.getElementById('admin-link');
    if (adminLink && user.role === 'admin') {
      adminLink.classList.remove('hidden');
    }
  }

  // --- Advocacy Toolkit ---
  async function initAdvocacy() {
    const user = await checkAuth();
    if (!user) return;
    setupLogout();
    const adminLink = document.getElementById('admin-link');
    if (adminLink && user.role === 'admin') {
      adminLink.classList.remove('hidden');
    }
  }

  // --- Page Router ---
  const page = document.body.dataset.page;
  if (page === 'dashboard') initDashboard();
  if (page === 'subcommittee') initSubcommittee();
  if (page === 'profile') initProfile();
  if (page === 'admin') initAdmin();
  if (page === 'resources') initResources();
  if (page === 'advocacy') initAdvocacy();
})();
