// Console Message Tracker
// Integrates with existing modal system to display console messages

(function() {
  'use strict';

  // Console message storage with memory management
  const MAX_MESSAGES_PER_TYPE = 100;
  const consoleStore = {
    log: [],
    warn: [],
    error: [],
    info: [],
    debug: []
  };

  // Store original console methods
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
  };

  // Format timestamp using existing formatTimeIST function
  function formatTimestamp(timestamp) {
    if (window.formatTimeIST) {
      return window.formatTimeIST(timestamp);
    }
    return new Date(timestamp).toLocaleTimeString();
  }

  // Intercept console methods
  function interceptConsoleMethod(type) {
    return function(...args) {
      try {
        // Store the message
        const message = {
          timestamp: Date.now(),
          content: args.map(arg => {
            if (typeof arg === 'object') {
              try {
                return JSON.stringify(arg, null, 2);
              } catch (e) {
                return String(arg);
              }
            }
            return String(arg);
          }).join(' '),
          type: type
        };

        consoleStore[type].push(message);

        // Memory management - keep only last MAX_MESSAGES_PER_TYPE messages
        if (consoleStore[type].length > MAX_MESSAGES_PER_TYPE) {
          consoleStore[type].shift();
        }

        // Update counter
        updateConsoleCounter();

        // Call original console method
        originalConsole[type].apply(console, args);
      } catch (error) {
        // Fallback to original console if something goes wrong
        originalConsole[type].apply(console, args);
      }
    };
  }

  // Override console methods
  console.log = interceptConsoleMethod('log');
  console.warn = interceptConsoleMethod('warn');
  console.error = interceptConsoleMethod('error');
  console.info = interceptConsoleMethod('info');
  console.debug = interceptConsoleMethod('debug');

  // Get total message count
  function getTotalMessageCount() {
    return Object.values(consoleStore).reduce((total, messages) => total + messages.length, 0);
  }

  // Get count by type
  function getCountByType() {
    return {
      log: consoleStore.log.length,
      warn: consoleStore.warn.length,
      error: consoleStore.error.length,
      info: consoleStore.info.length,
      debug: consoleStore.debug.length
    };
  }

  // Update console counter display
  function updateConsoleCounter() {
    const counter = document.getElementById('consoleCounter');
    if (counter) {
      const total = getTotalMessageCount();
      const counts = getCountByType();
      
      // Update main count
      const countSpan = counter.querySelector('.console-count');
      if (countSpan) {
        countSpan.textContent = total;
      }

      // Update individual type counts
      const errorCount = counter.querySelector('.error-count');
      const warnCount = counter.querySelector('.warn-count');
      
      if (errorCount) {
        errorCount.textContent = counts.error;
        errorCount.style.display = counts.error > 0 ? 'inline' : 'none';
      }
      
      if (warnCount) {
        warnCount.textContent = counts.warn;
        warnCount.style.display = counts.warn > 0 ? 'inline' : 'none';
      }
    }
  }

  // Create console counter UI
  function createConsoleCounter() {
    const counter = document.createElement('div');
    counter.id = 'consoleCounter';
    counter.className = 'console-counter';
    counter.innerHTML = `
      <div class="console-counter-content">
        <div class="console-icon">LOG</div>
        <div class="console-text">
          <span class="console-count">0</span>
          <span class="error-count pill" style="display: none;">0</span>
          <span class="warn-count pill" style="display: none;">0</span>
        </div>
      </div>
    `;
    
    counter.addEventListener('click', openConsoleModal);
    document.body.appendChild(counter);
    return counter;
  }

  // Open console messages modal
  function openConsoleModal() {
    const counts = getCountByType();
    const total = getTotalMessageCount();
    
    if (total === 0) {
      showModal('Console Messages', '<div class="muted">No console messages captured yet.</div>');
      return;
    }

    // Create tabbed interface for different message types
    const tabs = Object.keys(consoleStore)
      .filter(type => counts[type] > 0)
      .map(type => {
        const className = type === 'log' ? 'pill tab active' : 'pill tab';
        return `<button class="${className}" data-tab="${type}">${type.toUpperCase()} (${counts[type]})</button>`;
      }).join('');

    // Create content for each tab
    const tabContents = Object.keys(consoleStore)
      .filter(type => counts[type] > 0)
      .map((type, index) => {
        const isActive = index === 0;
        const messages = consoleStore[type]
          .slice(-50) // Show last 50 messages
          .reverse() // Show newest first
          .map(msg => {
            const time = formatTimestamp(msg.timestamp);
            const content = escapeHtml(msg.content);
            return `<div class="console-message console-${type}">
              <div class="console-time">${time}</div>
              <div class="console-content">${content}</div>
            </div>`;
          }).join('');

        return `<div class="tabcontent ${isActive ? '' : 'hidden'}" data-tab="${type}">
          <div class="console-messages">${messages}</div>
        </div>`;
      }).join('');

    const html = `
      <div class="console-modal">
        <div class="console-summary">
          <div class="muted">Total messages: ${total} (showing last 50 per type)</div>
        </div>
        <div class="tabbar" style="display:flex; gap:8px; margin:12px 0;">
          ${tabs}
        </div>
        ${tabContents}
        <div class="console-actions" style="margin-top:16px; display:flex; gap:8px; justify-content:flex-end;">
          <button class="pill" id="clearConsoleMessages">Clear All</button>
          <button class="pill" id="exportConsoleMessages">Export</button>
        </div>
      </div>
    `;

    showModal('Console Messages', html, { push: true });

    // Add event listeners for tabs and actions
    const modal = document.querySelector('#modal');
    if (modal) {
      // Tab switching
      modal.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab');
        if (tab) {
          const tabType = tab.getAttribute('data-tab');
          
          // Update active tab
          modal.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          
          // Show corresponding content
          modal.querySelectorAll('.tabcontent').forEach(tc => {
            tc.classList.toggle('hidden', tc.getAttribute('data-tab') !== tabType);
          });
        }

        // Clear messages
        if (e.target.id === 'clearConsoleMessages') {
          clearAllMessages();
          hideModal();
        }

        // Export messages
        if (e.target.id === 'exportConsoleMessages') {
          exportMessages();
        }
      });
    }
  }

  // Clear all console messages
  function clearAllMessages() {
    Object.keys(consoleStore).forEach(type => {
      consoleStore[type] = [];
    });
    updateConsoleCounter();
  }

  // Export messages as JSON
  function exportMessages() {
    const data = {
      timestamp: new Date().toISOString(),
      messages: consoleStore
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-messages-${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Initialize when DOM is ready
  function init() {
    if (document.getElementById('consoleCounter')) {
      return; // Already initialized
    }
    
    createConsoleCounter();
    updateConsoleCounter();
    
    // Log initialization
    console.info('Console message tracker initialized');
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API
  window.consoleTracker = {
    getMessages: () => ({ ...consoleStore }),
    getCounts: getCountByType,
    clear: clearAllMessages,
    export: exportMessages
  };

})();

