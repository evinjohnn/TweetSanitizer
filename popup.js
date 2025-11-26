const TOGGLE_KEY = 'extension_enabled';
const CACHE_KEY = 'twitter_location_cache';
const BLOCKED_KEY = 'blocked_countries';
const WHITELIST_KEY = 'whitelist_usernames';
const PROTECT_FOLLOWING_KEY = 'protect_following';
const DEFAULT_ENABLED = true;

// Load and display statistics
async function loadStats() {
  try {
    // Get cache data
    const result = await chrome.storage.local.get([CACHE_KEY]);
    const cache = result[CACHE_KEY] || {};

    // Count valid entries
    const now = Date.now();
    let validCount = 0;
    let totalSize = 0;

    for (const [username, data] of Object.entries(cache)) {
      if (data.expiry && data.expiry > now) {
        validCount++;
        // Rough size calculation
        totalSize += username.length + (data.location?.length || 0) + 50; // 50 bytes overhead
      }
    }

    // Update UI
    document.getElementById('cacheCount').textContent = validCount.toLocaleString();

    // Format size
    let sizeText;
    if (totalSize < 1024) {
      sizeText = totalSize + ' B';
    } else if (totalSize < 1024 * 1024) {
      sizeText = (totalSize / 1024).toFixed(1) + ' KB';
    } else {
      sizeText = (totalSize / (1024 * 1024)).toFixed(2) + ' MB';
    }
    document.getElementById('cacheSize').textContent = sizeText;

  } catch (error) {
    document.getElementById('cacheCount').textContent = 'Error';
    document.getElementById('cacheSize').textContent = 'Error';
  }
}

// Load extension state
async function loadState() {
  try {
    const result = await chrome.storage.local.get([TOGGLE_KEY]);
    const enabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;

    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusEl = document.getElementById('extensionStatus');

    if (enabled) {
      toggleSwitch.classList.add('enabled');
      statusEl.textContent = 'Active';
      statusEl.style.color = '#00ba7c';
    } else {
      toggleSwitch.classList.remove('enabled');
      statusEl.textContent = 'Disabled';
      statusEl.style.color = '#f4212e';
    }

    return enabled;
  } catch (error) {
    return DEFAULT_ENABLED;
  }
}

// Toggle extension
async function toggleExtension() {
  try {
    const currentState = await loadState();
    const newState = !currentState;

    await chrome.storage.local.set({ [TOGGLE_KEY]: newState });

    // Notify content script
    const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'extensionToggle',
          enabled: newState
        });
      } catch (e) {
        // Tab might not have content script loaded yet
      }
    }

    await loadState();
    showStatus(newState ? 'Extension enabled' : 'Extension disabled', true);
  } catch (error) {
    showStatus('Error toggling extension', false);
  }
}

// Clear cache
async function clearCache() {
  try {
    await chrome.storage.local.remove(CACHE_KEY);
    await loadStats();
    showStatus('Cache cleared successfully', true);
  } catch (error) {
    showStatus('Error clearing cache', false);
  }
}

// Show status message
function showStatus(message, success = true) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status' + (success ? ' success' : '');
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

// --- Country Blocking & Whitelist Logic ---

let allCountries = [];
let blockedCountries = new Set();
let whitelistUsernames = new Set();
const MUTE_KEY = 'auto_mute_enabled';

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([BLOCKED_KEY, MUTE_KEY, WHITELIST_KEY, PROTECT_FOLLOWING_KEY]);

    // Blocked Countries
    const blockedList = result[BLOCKED_KEY] || [];
    blockedCountries = new Set(blockedList);

    // Whitelist
    const whitelist = result[WHITELIST_KEY] || [];
    whitelistUsernames = new Set(whitelist);
    renderWhitelist();

    // Auto Mute
    const muteEnabled = result[MUTE_KEY] || false;
    const muteSwitch = document.getElementById('muteSwitch');
    if (muteEnabled) {
      muteSwitch.classList.add('enabled');
    } else {
      muteSwitch.classList.remove('enabled');
    }

    // Protect Following
    const protectFollowing = result[PROTECT_FOLLOWING_KEY] || false;
    const protectSwitch = document.getElementById('protectFollowingSwitch');
    if (protectFollowing) {
      protectSwitch.classList.add('enabled');
    } else {
      protectSwitch.classList.remove('enabled');
    }

  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

function toggleMute() {
  const muteSwitch = document.getElementById('muteSwitch');
  const isEnabled = muteSwitch.classList.contains('enabled');
  const newState = !isEnabled;

  if (newState) {
    muteSwitch.classList.add('enabled');
  } else {
    muteSwitch.classList.remove('enabled');
  }

  chrome.storage.local.set({ [MUTE_KEY]: newState });
}

function toggleProtectFollowing() {
  const protectSwitch = document.getElementById('protectFollowingSwitch');
  const isEnabled = protectSwitch.classList.contains('enabled');
  const newState = !isEnabled;

  if (newState) {
    protectSwitch.classList.add('enabled');
  } else {
    protectSwitch.classList.remove('enabled');
  }

  chrome.storage.local.set({ [PROTECT_FOLLOWING_KEY]: newState });
}

// --- Whitelist Functions ---

function renderWhitelist() {
  const container = document.getElementById('whitelistContainer');
  container.innerHTML = '';

  if (whitelistUsernames.size === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '12px';
    emptyMsg.style.color = 'var(--text-secondary)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.textContent = 'No whitelisted users';
    container.appendChild(emptyMsg);
    return;
  }

  whitelistUsernames.forEach(username => {
    const item = document.createElement('div');
    item.className = 'country-item';
    item.style.justifyContent = 'space-between';

    const label = document.createElement('span');
    label.textContent = username;

    const removeBtn = document.createElement('span');
    removeBtn.textContent = '✕';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.color = 'var(--text-secondary)';
    removeBtn.style.padding = '4px 8px';

    removeBtn.onclick = () => {
      whitelistUsernames.delete(username);
      saveWhitelist();
      renderWhitelist();
    };

    item.appendChild(label);
    item.appendChild(removeBtn);
    container.appendChild(item);
  });
}

async function saveWhitelist() {
  const list = Array.from(whitelistUsernames);
  await chrome.storage.local.set({ [WHITELIST_KEY]: list });
}

function addToWhitelist() {
  const input = document.getElementById('whitelistInput');
  let username = input.value.trim();

  if (!username) return;

  // Normalize: Remove @ if present
  if (username.startsWith('@')) {
    username = username.substring(1);
  }

  if (username) {
    whitelistUsernames.add(username); // Store without @ for consistency with API/Content script
    saveWhitelist();
    renderWhitelist();
    input.value = '';
  }
}

function populateCountryList(filter = '') {
  const listContainer = document.getElementById('countryList');
  listContainer.innerHTML = '';

  const filterLower = filter.toLowerCase();

  // Sort countries: Blocked first, then Alphabetical
  const sortedCountries = allCountries.filter(c =>
    c.name.toLowerCase().includes(filterLower)
  ).sort((a, b) => {
    const aBlocked = blockedCountries.has(a.key);
    const bBlocked = blockedCountries.has(b.key);
    if (aBlocked && !bBlocked) return -1;
    if (!aBlocked && bBlocked) return 1;
    return a.name.localeCompare(b.name);
  });

  sortedCountries.forEach(country => {
    const item = document.createElement('div');
    item.className = 'country-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'country-checkbox';
    checkbox.checked = blockedCountries.has(country.key);
    checkbox.dataset.key = country.key;

    // Toggle checkbox on click
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        blockedCountries.add(country.key);
      } else {
        blockedCountries.delete(country.key);
      }
    });

    const label = document.createElement('span');
    label.className = 'country-name';
    label.textContent = `${country.emoji || ''} ${country.name}`;

    // Allow clicking the row to toggle
    item.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    item.appendChild(checkbox);
    item.appendChild(label);
    listContainer.appendChild(item);
  });
}

async function saveSettings() {
  try {
    const blockedList = Array.from(blockedCountries);
    await chrome.storage.local.set({ [BLOCKED_KEY]: blockedList });
    showStatus('Settings saved. Reloading...', true);

    // Reload active tab to apply changes
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && (tabs[0].url.includes('twitter.com') || tabs[0].url.includes('x.com'))) {
      setTimeout(() => {
        chrome.tabs.reload(tabs[0].id);
      }, 1000);
    }
  } catch (error) {
    showStatus('Error saving settings', false);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await loadStats();
  await loadSettings();

  // Prepare country list from COUNTRY_FLAGS (available via script tag)
  if (typeof COUNTRY_FLAGS !== 'undefined') {
    allCountries = Object.keys(COUNTRY_FLAGS).map(key => {
      const value = COUNTRY_FLAGS[key];
      return {
        name: key,
        key: key,
        emoji: typeof value === 'string' ? value : (value.label || '')
      };
    });
    populateCountryList();
  }

  // Search input
  document.getElementById('countrySearch').addEventListener('input', (e) => {
    populateCountryList(e.target.value);
  });

  // Save button
  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  // Mute switch
  document.getElementById('muteSwitch').addEventListener('click', toggleMute);

  // Protect Following switch
  document.getElementById('protectFollowingSwitch').addEventListener('click', toggleProtectFollowing);

  // Whitelist
  document.getElementById('addWhitelistBtn').addEventListener('click', addToWhitelist);
  document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addToWhitelist();
  });

  // Toggle switch click
  document.getElementById('toggleSwitch').addEventListener('click', toggleExtension);

  // Clear cache button
  document.getElementById('clearCache').addEventListener('click', clearCache);

  // --- LICENSE LOGIC ---
  const WORKER_URL = "https://tweet-sanitizer-api.tweet-sanitizer.workers.dev";

  async function updateLicenseUI() {
    // Try sync first, then local (migration/fallback)
    let result = await chrome.storage.sync.get(['license_key', 'license_status']);
    if (!result.license_key) {
      result = await chrome.storage.local.get(['license_key', 'license_status']);
      // Optional: Migrate to sync if found in local?
      if (result.license_key) {
        await chrome.storage.sync.set({
          license_key: result.license_key,
          license_status: result.license_status
        });
      }
    }
    const isPro = result.license_status === true;

    const buyContainer = document.getElementById('buyContainer');
    const activeContainer = document.getElementById('activeContainer');
    const badge = document.getElementById('licenseStatusBadge');

    // Locking Elements
    const proWrapper = document.getElementById('proFeaturesWrapper');
    const lockOverlay = document.getElementById('proLockOverlay');

    if (isPro) {
      buyContainer.style.display = 'none';
      activeContainer.style.display = 'block';
      badge.textContent = "PRO";
      badge.className = "badge pro";

      // Unlock Features
      proWrapper.classList.remove('pro-locked');
      lockOverlay.style.display = 'none';
    } else {
      buyContainer.style.display = 'block';
      activeContainer.style.display = 'none';
      badge.textContent = "Free Tier";
      badge.className = "badge";

      // Lock Features
      proWrapper.classList.add('pro-locked');
      lockOverlay.style.display = 'block';
    }
  }

  // Initialize UI
  await updateLicenseUI();

  // Toast Logic
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = "toast show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
  }

  // Lock Overlay Click Listener
  document.getElementById('proLockOverlay').addEventListener('click', () => {
    showToast("Available only in Pro plan");
  });

  // --- User ID Logic (Anti-Sharing) ---
  async function getUniqueUserId() {
    // Try sync storage (cross-device profile)
    let data = await chrome.storage.sync.get(['ts_user_id']);
    if (data.ts_user_id) return data.ts_user_id;

    // Generate new ID if missing
    const newId = crypto.randomUUID();
    await chrome.storage.sync.set({ ts_user_id: newId });
    return newId;
  }

  // Verify Button Click
  document.getElementById('verifyBtn').addEventListener('click', async () => {
    const input = document.getElementById('licenseInput');
    const msg = document.getElementById('verifyMsg');
    const btn = document.getElementById('verifyBtn');
    const key = input.value.trim();

    if (!key) return;

    // Start Loading State
    btn.classList.add('loading');
    msg.textContent = "Verifying...";
    msg.style.color = "#86868B"; // var(--text-secondary)

    try {
      const userId = await getUniqueUserId();
      const response = await fetch(`${WORKER_URL}/verify-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: key,
          userId: userId
        })
      });

      const data = await response.json();

      if (data.valid) {
        msg.textContent = "Success!";
        msg.style.color = "#34C759"; // var(--accent-green)

        // Save to storage (SYNC)
        await chrome.storage.sync.set({
          license_key: key,
          license_status: true
        });

        await updateLicenseUI();

        // Reload tabs to apply pro features immediately
        const tabs = await chrome.tabs.query({ url: ["*://*.x.com/*", "*://*.twitter.com/*"] });
        for (const tab of tabs) {
          chrome.tabs.reload(tab.id);
        }

      } else {
        msg.textContent = data.message || "Invalid Key";
        msg.style.color = "#FF3B30"; // var(--accent-red)
        await chrome.storage.sync.set({ license_status: false });
      }
    } catch (e) {
      msg.textContent = "Connection Error";
      msg.style.color = "#FF3B30";
      console.error(e);
    } finally {
      // Stop Loading State
      btn.classList.remove('loading');
    }
  });

  // Deactivate Button
  document.getElementById('deactivateBtn').addEventListener('click', async () => {
    await chrome.storage.sync.remove(['license_key', 'license_status']);
    await chrome.storage.local.remove(['license_key', 'license_status']); // Clear local too just in case
    await updateLicenseUI();
    // Reload tabs to apply changes
    const tabs = await chrome.tabs.query({ url: ["*://*.x.com/*", "*://*.twitter.com/*"] });
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id);
    }
  });

  // Load saved license key if exists (for pre-fill)
  chrome.storage.sync.get(['license_key'], (result) => {
    if (result.license_key) {
      document.getElementById('licenseInput').value = result.license_key;
    } else {
      // Fallback to local
      chrome.storage.local.get(['license_key'], (localResult) => {
        if (localResult.license_key) {
          document.getElementById('licenseInput').value = localResult.license_key;
        }
      });
    }
  });

  // Refresh stats every 2 seconds
  setInterval(loadStats, 2000);
});
