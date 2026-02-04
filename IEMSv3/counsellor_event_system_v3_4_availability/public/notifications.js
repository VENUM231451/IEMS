/**
 * Notification Manager - Frontend notification handler
 * Handles notification bell, dropdown, toasts, and real-time updates
 */

const NotificationManager = {
  pollInterval: null,
  lastUnreadCount: 0,
  isDropdownOpen: false,

  /**
   * Initialize the notification system
   */
  init() {
    this.setupBell();
    this.setupToastContainer();
    this.setupViewAllModal();
    this.loadNotifications();
    this.startPolling();
  },

  /**
   * Setup notification bell click handlers
   */
  setupBell() {
    const trigger = document.getElementById('notificationTrigger');
    const dropdown = document.getElementById('notificationDropdown');

    if (!trigger || !dropdown) return;

    // Toggle dropdown on bell click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isDropdownOpen = !this.isDropdownOpen;
      dropdown.style.display = this.isDropdownOpen ? 'block' : 'none';

      if (this.isDropdownOpen) {
        this.loadNotifications();
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notification-bell')) {
        dropdown.style.display = 'none';
        this.isDropdownOpen = false;
      }
    });

    // Prevent dropdown from closing when clicking inside
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Mark all read button
    const markAllBtn = document.getElementById('markAllRead');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', () => this.markAllRead());
    }
  },

  /**
   * Setup toast container in DOM
   */
  setupToastContainer() {
    if (document.getElementById('toastContainer')) return;

    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  },

  /**
   * Setup "View all notifications" modal
   */
  setupViewAllModal() {
    // Create modal if it doesn't exist
    if (!document.getElementById('notificationsModal')) {
      const modal = document.createElement('div');
      modal.id = 'notificationsModal';
      modal.innerHTML = `
        <div class="notifications-modal-content">
          <div class="notif-modal-header">
            <h3>All Notifications</h3>
            <button class="notif-modal-close" type="button">&times;</button>
          </div>
          <div class="notif-modal-body" id="allNotificationsList">
            <div class="notification-empty">
              <i data-lucide="bell-off"></i>
              <p>Loading...</p>
            </div>
          </div>
          <div class="notif-modal-footer">
            <button class="btn" id="loadMoreNotifications" type="button">Load More</button>
            <button class="btn" id="clearAllNotifications" type="button">Clear Read</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Close modal handlers
      modal.querySelector('.notif-modal-close').addEventListener('click', () => this.closeAllNotificationsModal());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeAllNotificationsModal();
      });

      // Load more button
      modal.querySelector('#loadMoreNotifications').addEventListener('click', () => this.loadMoreNotifications());

      // Clear all read button
      modal.querySelector('#clearAllNotifications').addEventListener('click', () => this.clearAllReadNotifications());
    }

    // Attach handler to "View all notifications" link
    const viewAllLink = document.getElementById('viewAllNotifications');
    if (viewAllLink) {
      viewAllLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.openAllNotificationsModal();
      });
    }
  },

  allNotificationsOffset: 0,
  allNotificationsLimit: 20,

  /**
   * Open modal with all notifications
   */
  async openAllNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (!modal) return;

    // Close dropdown
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) dropdown.style.display = 'none';
    this.isDropdownOpen = false;

    // Reset offset
    this.allNotificationsOffset = 0;

    // Show modal
    modal.style.display = 'flex';

    // Load notifications
    await this.loadAllNotifications(true);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  /**
   * Close the all notifications modal
   */
  closeAllNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'none';
  },

  /**
   * Load all notifications for modal
   */
  async loadAllNotifications(reset = false) {
    const list = document.getElementById('allNotificationsList');
    if (!list) return;

    if (reset) {
      this.allNotificationsOffset = 0;
      list.innerHTML = '<p style="text-align:center;padding:20px;">Loading...</p>';
    }

    try {
      const r = await api(`/api/notifications?limit=${this.allNotificationsLimit}&offset=${this.allNotificationsOffset}`);
      const data = await r.json();

      if (data.ok) {
        if (reset) {
          list.innerHTML = '';
        }

        if (data.notifications.length === 0 && this.allNotificationsOffset === 0) {
          list.innerHTML = `
            <div class="notification-empty">
              <i data-lucide="bell-off"></i>
              <p>No notifications</p>
            </div>
          `;
        } else {
          list.innerHTML += data.notifications.map(n => this.renderAllNotificationItem(n)).join('');
        }

        // Hide "Load More" if no more notifications
        const loadMoreBtn = document.getElementById('loadMoreNotifications');
        if (loadMoreBtn) {
          loadMoreBtn.style.display = data.notifications.length < this.allNotificationsLimit ? 'none' : 'inline-block';
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    } catch (e) {
      console.error('Failed to load all notifications:', e);
      list.innerHTML = '<p style="color:red;text-align:center;">Failed to load notifications</p>';
    }
  },

  /**
   * Load more notifications
   */
  async loadMoreNotifications() {
    this.allNotificationsOffset += this.allNotificationsLimit;
    await this.loadAllNotifications(false);
  },

  /**
   * Clear all read notifications
   */
  async clearAllReadNotifications() {
    if (!confirm('Delete all read notifications?')) return;

    try {
      await api('/api/notifications/clear-read', { method: 'DELETE' });
      await this.loadAllNotifications(true);
      this.loadNotifications();
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to clear read notifications:', e);
    }
  },

  /**
   * Render notification item for modal (larger format)
   */
  renderAllNotificationItem(notification) {
    const iconMap = {
      'event_reminder': 'clock',
      'duplicate_detected': 'copy',
      'staffing_warning': 'alert-triangle',
      'anomaly': 'activity',
      'weekly_report': 'file-text'
    };

    const classMap = {
      'event_reminder': 'reminder',
      'duplicate_detected': 'duplicate',
      'staffing_warning': 'warning',
      'anomaly': 'anomaly',
      'weekly_report': 'report'
    };

    const icon = iconMap[notification.type] || 'bell';
    const iconClass = classMap[notification.type] || 'reminder';
    const unreadClass = notification.status === 'unread' ? 'unread' : '';

    // Format message with line breaks
    let formattedMessage = esc(notification.message);
    if (notification.type === 'weekly_report') {
      formattedMessage = formattedMessage.replace(/ \| /g, '<br>');
    }

    return `
      <div class="notification-item-full ${unreadClass}" data-id="${notification.id}">
        <div class="notification-icon ${iconClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="notification-content-full">
          <div class="notification-title">${esc(notification.title)}</div>
          <div class="notification-message-full">${formattedMessage}</div>
          <div class="notification-meta">
            <span class="notification-time">${this.formatTime(notification.created_at)}</span>
            <span class="notification-type">${notification.type.replace(/_/g, ' ')}</span>
          </div>
        </div>
        <div class="notification-actions">
          <button class="notif-action-btn" onclick="NotificationManager.deleteNotification(${notification.id})" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  },

  /**
   * Mark single notification as read from modal
   */
  async markOneRead(id) {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'PUT' });
      await this.loadAllNotifications(true);
      this.loadNotifications();
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  },

  /**
   * Start polling for new notifications
   */
  startPolling() {
    // Poll every 30 seconds
    this.pollInterval = setInterval(() => this.checkForNewNotifications(), 30000);
  },

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  /**
   * Load notifications from server
   */
  async loadNotifications() {
    try {
      const r = await api('/api/notifications?limit=15');
      const data = await r.json();

      if (data.ok) {
        this.renderNotifications(data.notifications);
      }

      // Also update badge
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
  },

  /**
   * Load unread count for badge
   */
  async loadUnreadCount() {
    try {
      const r = await api('/api/notifications/unread-count');
      const data = await r.json();

      if (data.ok) {
        this.updateBadge(data.count);
      }
    } catch (e) {
      console.error('Failed to load unread count:', e);
    }
  },

  /**
   * Check for new notifications and show toast
   */
  async checkForNewNotifications() {
    try {
      const r = await api('/api/notifications/unread-count');
      const data = await r.json();

      if (data.ok) {
        // Show toast if there are new notifications
        if (data.count > this.lastUnreadCount && data.latestNotification) {
          this.showToast(
            data.latestNotification.title,
            data.latestNotification.message,
            data.latestNotification.priority
          );
        }

        this.lastUnreadCount = data.count;
        this.updateBadge(data.count);
      }
    } catch (e) {
      console.error('Poll failed:', e);
    }
  },

  /**
   * Render notifications in dropdown
   */
  renderNotifications(notifications) {
    const list = document.getElementById('notificationList');
    if (!list) return;

    if (!notifications || notifications.length === 0) {
      list.innerHTML = `
        <div class="notification-empty">
          <i data-lucide="bell-off"></i>
          <p>No notifications</p>
        </div>
      `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    list.innerHTML = notifications.map(n => this.renderNotificationItem(n)).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Add click handlers to notification items
    list.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const type = item.dataset.type;
        this.handleNotificationClick(id, type);
      });
    });
  },

  /**
   * Render a single notification item
   */
  renderNotificationItem(notification) {
    const iconMap = {
      'event_reminder': 'clock',
      'duplicate_detected': 'copy',
      'staffing_warning': 'alert-triangle',
      'anomaly': 'activity',
      'weekly_report': 'file-text'
    };

    const classMap = {
      'event_reminder': 'reminder',
      'duplicate_detected': 'duplicate',
      'staffing_warning': 'warning',
      'anomaly': 'anomaly',
      'weekly_report': 'report'
    };

    const icon = iconMap[notification.type] || 'bell';
    const iconClass = classMap[notification.type] || 'reminder';
    const unreadClass = notification.status === 'unread' ? 'unread' : '';
    const priorityClass = `priority-${notification.priority}`;
    const typeClass = `type-${notification.type}`;

    // Check if message is long enough to need expansion
    const isLongMessage = notification.message && notification.message.length > 150;
    const expandBtn = isLongMessage ? `<button class="notification-expand-btn" onclick="NotificationManager.toggleExpand(event, this)">Show more</button>` : '';

    // Format message with line breaks for weekly reports
    let formattedMessage = esc(notification.message);
    if (notification.type === 'weekly_report') {
      // Convert pipe separators to line breaks for better readability
      formattedMessage = formattedMessage.replace(/ \| /g, '<br>');
    }

    return `
      <div class="notification-item ${unreadClass} ${priorityClass} ${typeClass}"
           data-id="${notification.id}"
           data-type="${notification.type}">
        <div class="notification-icon ${iconClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="notification-content">
          <div class="notification-title">${esc(notification.title)}</div>
          <div class="notification-message">${formattedMessage}</div>
          ${expandBtn}
          <div class="notification-time">${this.formatTime(notification.created_at)}</div>
        </div>
      </div>
    `;
  },

  /**
   * Toggle expand/collapse for long notifications
   */
  toggleExpand(event, btn) {
    event.stopPropagation();
    const item = btn.closest('.notification-item');
    const message = item.querySelector('.notification-message');

    if (message.classList.contains('expanded')) {
      message.classList.remove('expanded');
      btn.textContent = 'Show more';
    } else {
      message.classList.add('expanded');
      btn.textContent = 'Show less';
    }
  },

  /**
   * Update notification badge count
   */
  updateBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;

    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  },

  /**
   * Handle notification item click
   */
  async handleNotificationClick(id, type) {
    // Mark as read
    try {
      await api(`/api/notifications/${id}/read`, { method: 'PUT' });
      this.loadNotifications();
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }

    // Handle specific notification types
    if (type === 'duplicate_detected') {
      // Could open duplicate modal here
      // For now, just close dropdown
    }
  },

  /**
   * Mark all notifications as read
   */
  async markAllRead() {
    try {
      await api('/api/notifications/mark-all-read', { method: 'POST' });
      this.loadNotifications();
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  },

  /**
   * Show a toast notification
   */
  showToast(title, message, priority = 'medium', duration = 6000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${priority}`;
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-title">${esc(title)}</div>
        <div class="toast-message">${esc(message)}</div>
      </div>
      <button class="toast-close" type="button">
        <i data-lucide="x"></i>
      </button>
    `;

    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.removeToast(toast));

    // Auto-dismiss
    setTimeout(() => this.removeToast(toast), duration);
  },

  /**
   * Remove a toast with animation
   */
  removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.style.animation = 'toastSlideOut 0.3s ease-out forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },

  /**
   * Format timestamp to relative time
   */
  formatTime(isoString) {
    if (!isoString) return '';

    // SQLite datetime('now') returns UTC without 'Z' suffix
    // Append 'Z' to tell JavaScript it's UTC time
    let dateStr = isoString;
    if (!dateStr.endsWith('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
      dateStr = dateStr.replace(' ', 'T') + 'Z';
    }

    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than a minute
    if (diff < 60000) return 'Just now';

    // Less than an hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }

    // Less than a day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than a week
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Format as date
    return date.toLocaleDateString();
  },



  /**
   * Dismiss a notification
   */
  async dismissNotification(id) {
    try {
      await api(`/api/notifications/${id}/dismiss`, { method: 'PUT' });
      this.loadNotifications();
      this.loadUnreadCount();
    } catch (e) {
      console.error('Failed to dismiss notification:', e);
    }
  },

  /**
   * Delete a notification
   */
  async deleteNotification(id) {
    try {
      await api(`/api/notifications/${id}`, { method: 'DELETE' });
      // Refresh both dropdown and modal
      this.loadNotifications();
      this.loadUnreadCount();
      // Also refresh modal if open
      const modal = document.getElementById('notificationsModal');
      if (modal && modal.style.display === 'flex') {
        await this.loadAllNotifications(true);
      }
    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => NotificationManager.init());
} else {
  // DOM is already ready
  NotificationManager.init();
}
