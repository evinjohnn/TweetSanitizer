// Global error handler to prevent extension crashes from breaking Twitter
window.addEventListener('error', (event) => {
  if (event.filename?.includes('chrome-extension://')) {
    event.preventDefault();
  }
});

function isExtensionContextValid() {
  try { return chrome.runtime?.id !== undefined; } catch { return false; }
}

// --- Analytics Helper ---
function trackEvent(eventName, params = {}) {
  if (isExtensionContextValid()) {
    try {
      chrome.runtime.sendMessage({
        action: 'TRACK_EVENT',
        payload: { name: eventName, params }
      });
    } catch (e) {
      // Ignore errors (e.g. if extension context invalid)
    }
  }
}

let isProUser = false; // Default to locked

// Check license with Server on startup (Security Best Practice)
async function checkLicense() {
  try {
    // Try sync first, then local
    let result = await chrome.storage.sync.get(['license_key']);
    let savedKey = result.license_key;

    if (!savedKey) {
      result = await chrome.storage.local.get(['license_key']);
      savedKey = result.license_key;
    }

    if (!savedKey) {
      isProUser = false;
      return;
    }

    // Get User ID for binding check
    const userId = await getUniqueUserId();

    // Verify with Cloudflare
    const response = await fetch(`${CLOUD_API_URL}/verify-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: savedKey,
        userId: userId
      })
    });

    const data = await response.json();
    isProUser = data.valid;

    // If key became invalid (refunded/expired), revoke access locally
    if (!isProUser) {
      chrome.storage.sync.set({ license_status: false });
      chrome.storage.local.set({ license_status: false });
    }

  } catch (e) {
    // Network error? Fallback to last known status to be nice to user
    let local = await chrome.storage.sync.get('license_status');
    if (local.license_status === undefined) {
      local = await chrome.storage.local.get('license_status');
    }
    isProUser = local.license_status === true;
  }
}

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

let locationCache = new Map();
const CACHE_KEY = 'twitter_location_cache';
const CACHE_EXPIRY_DAYS = 30; // Cache for 30 days

// Cloud API Configuration
const CLOUD_API_URL = 'https://tweet-sanitizer-api.tweetsanitizer.workers.dev';
const BATCH_SIZE = 5; // Process 5 items at a time
const UPLOAD_QUEUE_KEY = 'pending_uploads';
// Removed UPLOAD_INTERVAL and uploadIntervalRef as upload is now handled by background.js
const requestQueue = [];
const MAX_QUEUE_SIZE = 150; // Increased limit to prevent dropping items during fast scroll
const QUEUE_ITEM_TIMEOUT = 30000; // 30 seconds max in queuese;
let isProcessingQueue = false;
let lastRequestTime = 0;
let currentRequestInterval = 100;
let maxConcurrentRequests = 20;
let activeRequests = 0;
let rateLimitResetTime = 0;

let mutationObserver = null;
let visibilityObserver = null;

let extensionEnabled = true;
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;

const processingUsernames = new Set();

let lastScrollY = 0;
let lastScrollTime = Date.now();
let scrollVelocity = 0;
let scrollCheckInterval = null;
let scrollStopTimeout = null;
let isScrolling = false;

let idleLoadingInterval = null;
let idleLoadingActive = false;
let lastIdleLoadTime = 0;
const IDLE_LOAD_INTERVAL = 3000;
const IDLE_LOOKAHEAD_LIMIT = 50;
const IDLE_START_DELAY = 5000;

let isInitialLoad = true;
let initialLoadCount = 0;
let totalItemsProcessed = 0; // Track total items for strategy switching
const INITIAL_LOAD_TARGET = 30; // Increased from 25 for better initial coverage
let itemsLoadedInBurst = 0;
let lastBurstTime = 0;
const MAX_BURST_SIZE = 30;
const COOLDOWN_DURATION = 1000;

const SLOW_SCROLL_THRESHOLD = 500;
const NORMAL_SCROLL_THRESHOLD = 1500;
const FAST_SCROLL_THRESHOLD = 1500;

const INITIAL_ROOT_MARGIN = '2000px'; // Increased for background loading
const SLOW_SCROLL_MARGIN = '2500px';
const NORMAL_SCROLL_MARGIN = '3000px';
const FAST_SCROLL_MARGIN = '4000px'; // Aggressive lookahead for fast scroll
const IDLE_MARGIN = '3000px';

let currentRootMargin = INITIAL_ROOT_MARGIN;

async function loadEnabledState() {
  try {
    const result = await chrome.storage.local.get([TOGGLE_KEY]);
    extensionEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
  } catch (error) {
    extensionEnabled = DEFAULT_ENABLED;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extensionToggle') {
    extensionEnabled = request.enabled;
    if (extensionEnabled) {
      setTimeout(() => { processUsernames(); }, 500);
    } else {
      removeAllFlags();
    }
  }
});

// --- Country Blocking Logic ---
let blockedCountries = new Set();
let whitelistUsernames = new Set();
let autoMuteEnabled = false;
let protectFollowing = false;
const BLOCKED_KEY = 'blocked_countries';
const MUTE_KEY = 'auto_mute_enabled';
const WHITELIST_KEY = 'whitelist_usernames';
const PROTECT_FOLLOWING_KEY = 'protect_following';

async function loadBlockedCountries() {
  try {
    if (!chrome.runtime?.id) return; // Extension context invalid
    const result = await chrome.storage.local.get([BLOCKED_KEY, MUTE_KEY, WHITELIST_KEY, PROTECT_FOLLOWING_KEY]);

    // Blocked Countries
    let blockedList = result[BLOCKED_KEY];
    if (!Array.isArray(blockedList)) {
      blockedList = [];
    }
    blockedCountries = new Set(blockedList);

    // Whitelist
    let whitelist = result[WHITELIST_KEY];
    if (!Array.isArray(whitelist)) {
      whitelist = [];
    }
    whitelistUsernames = new Set(whitelist);

    // Settings
    autoMuteEnabled = result[MUTE_KEY] || false;
    protectFollowing = result[PROTECT_FOLLOWING_KEY] || false;

    // console.log('TweetSanitizer: Loaded settings. Blocked:', blockedCountries.size, 'Whitelist:', whitelistUsernames.size, 'Protect:', protectFollowing);
  } catch (error) {
    console.warn('TweetSanitizer: Warning loading blocked countries (non-fatal)', error);
    // Initialize empty to prevent crashes
    blockedCountries = new Set();
    whitelistUsernames = new Set();
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes[BLOCKED_KEY]) {
      let newValue = changes[BLOCKED_KEY].newValue;
      if (!Array.isArray(newValue)) newValue = [];
      blockedCountries = new Set(newValue);
    }
    if (changes[WHITELIST_KEY]) {
      let newValue = changes[WHITELIST_KEY].newValue;
      if (!Array.isArray(newValue)) newValue = [];
      whitelistUsernames = new Set(newValue);
    }
    if (changes[MUTE_KEY]) {
      autoMuteEnabled = changes[MUTE_KEY].newValue !== undefined ? changes[MUTE_KEY].newValue : false;
    }
    if (changes[PROTECT_FOLLOWING_KEY]) {
      protectFollowing = changes[PROTECT_FOLLOWING_KEY].newValue !== undefined ? changes[PROTECT_FOLLOWING_KEY].newValue : false;
    }
  }
});

window.addEventListener('focus', () => {
  loadBlockedCountries();
});

function isUserFollowed(element) {
  try {
    // 1. Check for "Following" button in the same container (UserCell, etc.)
    // Twitter Follow buttons usually have data-testid ending in "-unfollow" if you are following them.
    // e.g. data-testid="userFollow-123456-unfollow"

    // Look up to finding a container
    const container = element.closest('[data-testid="UserCell"], [data-testid="tweet"], [data-testid="cellInnerDiv"]');

    if (container) {
      // Check for the "Following" button state (which allows unfollowing)
      const unfollowBtn = container.querySelector('[data-testid$="-unfollow"]');
      if (unfollowBtn) return true;

      // Also check for "Following" text badge if present (sometimes in header)
      // This is less reliable as it depends on language, but "Following" is common.
      // Let's stick to the data-testid which implies state.
    }
  } catch (e) {
    // Fail silently
  }
  return false;
}

function hideContentIfBlocked(element, locationKey, screenName, userId) {
  // --- SECURITY GATE ---
  if (!isProUser) {
    // If not Pro, do NOT hide the tweet.
    return false;
  }

  // 1. Whitelist Check
  if (whitelistUsernames.has(screenName)) {
    // console.log(`TweetSanitizer: Allowed whitelisted user ${screenName}`);
    return false;
  }

  if (blockedCountries.has(locationKey)) {

    // 2. Protect Following Check
    if (protectFollowing) {
      if (isUserFollowed(element)) {
        // console.log(`TweetSanitizer: Allowed followed user ${screenName}`);
        return false;
      }
    }

    // console.log(`TweetSanitizer: Blocking content from ${locationKey}`);
    let hidden = false;
    const tweetArticle = element.closest('article[data-testid="tweet"]');
    if (tweetArticle) {
      tweetArticle.style.setProperty('display', 'none', 'important');
      const cellInner = tweetArticle.closest('div[data-testid="cellInnerDiv"]');
      if (cellInner) {
        cellInner.style.setProperty('display', 'none', 'important');
      }
      hidden = true;
    } else {
      const cellInnerFallback = element.closest('div[data-testid="cellInnerDiv"]');
      if (cellInnerFallback) {
        cellInnerFallback.style.setProperty('display', 'none', 'important');
        hidden = true;
      } else {
        const userCell = element.closest('[data-testid="UserCell"]');
        if (userCell) {
          userCell.style.setProperty('display', 'none', 'important');
          hidden = true;
        } else {
          // Fallback: Hide the username element itself and its parent if possible
          // This ensures we don't leave a "blank" unflagged user visible
          // element.style.setProperty('display', 'none', 'important');
          // if (element.parentElement) element.parentElement.style.setProperty('display', 'none', 'important');
          // hidden = true;
          // COMMENTED OUT: Hiding the username itself looks broken. Better to leave it visible if we can't hide the container.
        }
      }
    }

    if (hidden) {
      // console.log('TweetSanitizer: Visually hidden content for', screenName);
    } else {
      // console.warn('TweetSanitizer: Failed to visually hide content for', screenName);
    }

    if (autoMuteEnabled) {
      if (userId || screenName) {
        // console.log(`TweetSanitizer: Queuing legacy auto-mute for ${screenName} (ID: ${userId})`);
        setTimeout(() => {
          window.postMessage({
            type: '__muteUser',
            screenName: screenName,
            userId: userId
          }, '*');
        }, 0);
      }
    }
    return true;
  }
  return false;
}

async function loadCache() {
  try {
    if (!chrome.runtime?.id) return;
    const result = await chrome.storage.local.get(CACHE_KEY);
    if (result[CACHE_KEY]) {
      const cached = result[CACHE_KEY];
      const now = Date.now();
      for (const [username, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now && data.location !== null) {
          locationCache.set(username, data.location);
        }
      }
    }
  } catch (error) { }
}

async function saveCache() {
  try {
    if (!chrome.runtime?.id) return;
    const cacheObj = {};
    const now = Date.now();
    const expiry = now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    for (const [username, location] of locationCache.entries()) {
      cacheObj[username] = {
        location: location,
        expiry: expiry,
        cachedAt: now
      };
    }
    await chrome.storage.local.set({ [CACHE_KEY]: cacheObj });
  } catch (error) { }
}

async function saveCacheEntry(username, location) {
  if (!chrome.runtime?.id) return;
  locationCache.set(username, location);
  if (!saveCache.timeout) {
    saveCache.timeout = setTimeout(async () => {
      await saveCache();
      saveCache.timeout = null;
    }, 5000);
  }
}

function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pageScript.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === '__rateLimitInfo') {
      rateLimitResetTime = event.data.resetTime;
      currentRequestInterval = 2000;
      maxConcurrentRequests = 1;
    }
  });
}

function getDistanceToCenter(element) {
  if (!element) return Infinity;
  const rect = element.getBoundingClientRect();
  const elementCenterY = rect.top + rect.height / 2;
  const viewportCenterY = window.innerHeight / 2;
  return Math.abs(elementCenterY - viewportCenterY);
}

// Cloud API: Batch Fetch
async function fetchFromCloud(usernames) {
  try {
    const response = await fetch(`${CLOUD_API_URL}/lookup?users=${usernames.join(',')}`);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('TweetSanitizer: Cloud API fetch failed', error);
    return null;
  }
}

// Add to Upload Queue (Persisted in Local Storage)
async function queueForUpload(username, location) {
  if (!username || !location) return;

  try {
    // 1. Get current queue
    const result = await chrome.storage.local.get(UPLOAD_QUEUE_KEY);
    let queue = result[UPLOAD_QUEUE_KEY] || {}; // Object for auto-deduplication

    // 2. Add/Update item
    queue[username] = location;

    // 3. Save back
    await chrome.storage.local.set({ [UPLOAD_QUEUE_KEY]: queue });

    // 4. Trigger upload if queue gets big (e.g., > 20 items)
    // Handled by background.js listener now
  } catch (e) {
    console.warn('TweetSanitizer: Queue save failed', e);
  }
}

// Flush the queue to the server
// processUploadQueue removed - moved to background.js

// Smart Strategy Selector
function getFetchStrategy() {
  // OLD DANGEROUS WAY:
  // if (totalItemsProcessed < 30) return 'DIRECT'; 

  // NEW SAFE WAY:
  // Only use Direct for the very first few items to make it feel "instant",
  // but switch to Cloud immediately to save API calls.
  if (totalItemsProcessed < 5) return 'DIRECT';

  // 2. Fast Scroll: Use Direct API (Avoid Cloud Miss Latency)
  // You might even want to disable this if 429s are frequent
  if (scrollVelocity > FAST_SCROLL_THRESHOLD) return 'DIRECT';

  // 3. Normal/Idle: Use Hybrid (Cloud Batch -> Fallback) (Efficiency)
  return 'HYBRID';
}

// Process request queue with Smart Strategy
async function processRequestQueue() {
  if (isProcessingQueue) {
    return;
  }
  isProcessingQueue = true;

  try {
    // Clean up timed out items from queue
    const cleanupTime = Date.now();
    for (let i = requestQueue.length - 1; i >= 0; i--) {
      if (cleanupTime - requestQueue[i].timestamp > QUEUE_ITEM_TIMEOUT) {
        const item = requestQueue[i];
        requestQueue.splice(i, 1);
        item.resolve({ location: null, userId: null });
      }
    }

    // PRIORITY LOGIC: Sort queue by distance to center
    requestQueue.sort((a, b) => {
      const distA = getDistanceToCenter(a.element);
      const distB = getDistanceToCenter(b.element);
      return distA - distB;
    });

    const isTwitterRateLimited = rateLimitResetTime > 0 && Math.floor(Date.now() / 1000) < rateLimitResetTime;

    // Dispatch Loop: Fire requests until we hit concurrency limit or queue is empty
    while (activeRequests < maxConcurrentRequests && requestQueue.length > 0) {
      const strategy = getFetchStrategy();
      const now = Date.now();

      if (strategy === 'DIRECT') {
        // --- DIRECT STRATEGY ---
        const readyIndex = requestQueue.findIndex(req => !req.processAfter || req.processAfter <= now);

        if (readyIndex === -1) {
          // No items ready for direct (all delaying), break loop to avoid spin
          break;
        }

        const request = requestQueue.splice(readyIndex, 1)[0];
        activeRequests++;

        // Fire and forget (handled by callback)
        processDirectItem(request, isTwitterRateLimited).finally(() => {
          activeRequests--;
          processRequestQueue(); // Trigger next item
        });

      } else {
        // --- HYBRID STRATEGY ---
        // Collect batch
        const batch = [];
        let i = 0;
        // Look for ready items
        while (batch.length < BATCH_SIZE && i < requestQueue.length) {
          const req = requestQueue[i];
          if (!req.processAfter || req.processAfter <= now) {
            batch.push(requestQueue.splice(i, 1)[0]);
            // Don't increment i
          } else {
            i++;
          }
        }

        if (batch.length === 0) {
          break; // No ready items for batch
        }

        activeRequests++; // Count 1 batch as 1 active request slot

        // Fire and forget
        processBatch(batch, isTwitterRateLimited).finally(() => {
          activeRequests--;
          processRequestQueue();
        });
      }
    }

  } finally {
    isProcessingQueue = false;
  }
}

async function processDirectItem(request, isTwitterRateLimited) {
  const { screenName, resolve, reject } = request;

  if (isTwitterRateLimited && request.retryCount === 0) {
    resolve({ location: null, userId: null });
    return;
  }

  try {
    const result = await makeLocationRequest(screenName);
    if (result.isRateLimited) {
      // Fallback: Try Cloud API before giving up/retrying
      try {
        const cloudResults = await fetchFromCloud([screenName]);
        const cloudLocation = cloudResults ? cloudResults[screenName] : null;

        if (cloudLocation) {
          // HIT: Found in Cloud despite 429 on Twitter
          resolve({ location: cloudLocation, userId: null });
          saveCacheEntry(screenName, { location: cloudLocation, userId: null });
          totalItemsProcessed++;
          return;
        }
      } catch (e) {
        // Cloud failed too, proceed to retry logic
      }

      handleRateLimit(request);
    } else {
      resolve(result);
      totalItemsProcessed++;
      if (result.location) queueForUpload(screenName, result.location);
    }
  } catch (error) {
    reject(error);
  }
}

async function processBatch(batch, isTwitterRateLimited) {
  const usernames = batch.map(req => req.screenName);
  let cloudResults = null;

  try {
    cloudResults = await fetchFromCloud(usernames);
  } catch (e) {
    console.error('TweetSanitizer: Cloud batch failed', e);
  }

  // Process results
  for (const request of batch) {
    const { screenName, resolve, reject } = request;
    const cloudLocation = cloudResults ? cloudResults[screenName] : null;

    if (cloudLocation) {
      // HIT
      resolve({ location: cloudLocation, userId: null });
      saveCacheEntry(screenName, { location: cloudLocation, userId: null });
      totalItemsProcessed++;
    } else {
      // MISS: Fallback to Direct
      // Note: This runs sequentially within the batch context, but the batch itself is async
      // To avoid blocking, we could re-queue as high priority direct?
      // For now, let's just run it here.

      if (isTwitterRateLimited && request.retryCount === 0) {
        resolve({ location: null, userId: null });
      } else {
        try {
          const result = await makeLocationRequest(screenName);
          if (result.isRateLimited) {
            handleRateLimit(request);
          } else {
            resolve(result);
            totalItemsProcessed++;
            if (result.location) queueForUpload(screenName, result.location);
          }
        } catch (error) {
          reject(error);
        }
      }
    }
  }
}

function handleRateLimit(request) {
  if (request.retryCount < 3) {
    const delays = [5000, 10000, 30000];
    const delay = delays[request.retryCount];
    request.retryCount++;
    request.processAfter = Date.now() + delay;
    requestQueue.push(request); // Re-queue
  } else {
    request.resolve({ location: null, userId: null });
  }
}

function makeLocationRequest(screenName) {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();
    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse' && event.data.screenName === screenName && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        const location = event.data.location;
        const userId = event.data.userId;
        const isRateLimited = event.data.isRateLimited || false;
        if (!isRateLimited) {
          saveCacheEntry(screenName, { location: location || null, userId: userId || null });
        }
        resolve({ location: location || null, userId: userId || null });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: '__fetchLocation', screenName, requestId }, '*');
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ location: null, userId: null });
    }, 10000);
  });
}

async function getUserLocation(screenName, element) {
  if (locationCache.has(screenName)) {
    const cached = locationCache.get(screenName);
    if (cached !== null && cached !== undefined) {
      if (typeof cached === 'object' && cached.location !== undefined) {
        return cached;
      }
      return { location: cached, userId: null };
    } else {
      locationCache.delete(screenName);
    }
  }

  if (requestQueue.length >= MAX_QUEUE_SIZE) {
    let furthestIdx = -1;
    let maxDist = -1;
    for (let i = 0; i < requestQueue.length; i++) {
      const dist = getDistanceToCenter(requestQueue[i].element);
      if (dist > maxDist) {
        maxDist = dist;
        furthestIdx = i;
      }
    }
    const newDist = getDistanceToCenter(element);
    if (furthestIdx !== -1 && newDist < maxDist) {
      requestQueue.splice(furthestIdx, 1);
    } else {
      return { location: null, userId: null };
    }
  }

  return new Promise((resolve, reject) => {
    requestQueue.push({
      screenName,
      element,
      resolve,
      reject,
      timestamp: Date.now(),
      retryCount: 0,
      processAfter: 0
    });
    processRequestQueue();
  });
}

function extractUsername(element) {
  const usernameElement = element.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (usernameElement) {
    const links = usernameElement.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href.match(/^\/([^\/\?]+)/);
      if (match && match[1]) {
        const username = match[1];
        const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
        if (!excludedRoutes.includes(username) && !username.startsWith('hashtag') && !username.startsWith('search') && username.length > 0 && username.length < 20) {
          return username;
        }
      }
    }
  }
  const allLinks = element.querySelectorAll('a[href^="/"]');
  const seenUsernames = new Set();
  for (const link of allLinks) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const match = href.match(/^\/([^\/\?]+)/);
    if (!match || !match[1]) continue;
    const potentialUsername = match[1];
    if (seenUsernames.has(potentialUsername)) continue;
    seenUsernames.add(potentialUsername);
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities', 'hashtag'];
    if (excludedRoutes.some(route => potentialUsername === route || potentialUsername.startsWith(route))) continue;
    if (potentialUsername.includes('status') || potentialUsername.match(/^\d+$/)) continue;
    const text = link.textContent?.trim() || '';
    const linkText = text.toLowerCase();
    const usernameLower = potentialUsername.toLowerCase();
    if (text.startsWith('@')) return potentialUsername;
    if (linkText === usernameLower || linkText === `@${usernameLower}`) return potentialUsername;
    const parent = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
    if (parent) {
      if (potentialUsername.length > 0 && potentialUsername.length < 20 && !potentialUsername.includes('/')) return potentialUsername;
    }
    if (text && text.trim().startsWith('@')) {
      const atUsername = text.trim().substring(1);
      if (atUsername === potentialUsername) return potentialUsername;
    }
  }
  const textContent = element.textContent || '';
  const atMentionMatches = textContent.matchAll(/@([a-zA-Z0-9_]+)/g);
  for (const match of atMentionMatches) {
    const username = match[1];
    const link = element.querySelector(`a[href="/${username}"], a[href^="/${username}?"]`);
    if (link) {
      const isInUserNameContainer = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
      if (isInUserNameContainer) return username;
    }
  }
  return null;
}

function findHandleSection(container, screenName) {
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    if (link) {
      const text = link.textContent?.trim();
      return text === `@${screenName}`;
    }
    return false;
  });
}

function createLoadingShimmer() {
  const shimmer = document.createElement('span');
  shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
  shimmer.style.display = 'inline-block';
  shimmer.style.width = '20px';
  shimmer.style.height = '16px';
  shimmer.style.marginLeft = '4px';
  shimmer.style.marginRight = '4px';
  shimmer.style.verticalAlign = 'middle';
  shimmer.style.borderRadius = '2px';
  shimmer.style.background = 'linear-gradient(90deg, rgba(113, 118, 123, 0.2) 25%, rgba(113, 118, 123, 0.4) 50%, rgba(113, 118, 123, 0.2) 75%)';
  shimmer.style.backgroundSize = '200% 100%';
  shimmer.style.animation = 'shimmer 1.5s infinite';
  if (!document.getElementById('twitter-flag-shimmer-style')) {
    const style = document.createElement('style');
    style.id = 'twitter-flag-shimmer-style';
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `;
    document.head.appendChild(style);
  }
  return shimmer;
}

// Function to add flag to username element
async function addFlagToUsername(usernameElement, screenName) {
  if (usernameElement.dataset.flagAdded === 'true') return;

  if (processingUsernames.has(screenName)) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (usernameElement.dataset.flagAdded === 'true') return;
    usernameElement.dataset.flagAdded = 'waiting';
    return;
  }

  usernameElement.dataset.flagAdded = 'processing';
  processingUsernames.add(screenName);

  try {
    const userNameContainer = usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');

    // Create placeholder pill immediately with "?" 
    const placeholderPill = document.createElement('span');
    placeholderPill.setAttribute('data-twitter-flag', 'true');
    placeholderPill.setAttribute('data-loading', 'true');
    placeholderPill.style.cssText = `
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      padding: 2px 8px 2px 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(113, 118, 123, 0.4);
      border-radius: 999px;
      font-size: 11px;
      vertical-align: middle;
      gap: 0;
      transition: border-color 0.15s;
    `;
    placeholderPill.addEventListener('mouseenter', () => { placeholderPill.style.borderColor = 'rgba(29, 155, 240, 0.5)'; });
    placeholderPill.addEventListener('mouseleave', () => { placeholderPill.style.borderColor = 'rgba(113, 118, 123, 0.4)'; });

    // Flag placeholder
    const flagPart = document.createElement('span');
    flagPart.className = 'ts-flag-part';
    flagPart.textContent = '?';
    flagPart.title = 'Loading location...';
    flagPart.style.cssText = 'color: #536471; font-size: 11px; font-weight: bold; cursor: default; padding-left: 2px;';

    // Separator
    const separator = document.createElement('span');
    separator.textContent = '|';
    separator.style.cssText = 'color: rgba(113, 118, 123, 0.4); margin: 0 5px; font-size: 10px;';

    // Details link (always functional)
    const detailsLink = document.createElement('span');
    detailsLink.textContent = 'Details';
    detailsLink.style.cssText = 'color: #71767b; font-weight: 500; cursor: pointer; transition: color 0.15s;';
    detailsLink.addEventListener('mouseenter', () => {
      detailsLink.style.color = '#1d9bf0';
      HovercardController.open({
        anchor: placeholderPill,
        screenName: screenName,
        lock: false
      });
    });
    detailsLink.addEventListener('mouseleave', () => {
      detailsLink.style.color = '#71767b';
      HovercardController.closeWithDelay(300);
    });
    detailsLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      HovercardController.open({
        anchor: placeholderPill,
        screenName: screenName,
        lock: true
      });
    });

    placeholderPill.appendChild(flagPart);
    placeholderPill.appendChild(separator);
    placeholderPill.appendChild(detailsLink);

    // Insert placeholder pill
    if (userNameContainer) {
      const handleSection = findHandleSection(userNameContainer, screenName);
      if (handleSection && handleSection.parentNode) {
        try { handleSection.parentNode.insertBefore(placeholderPill, handleSection); }
        catch (e) { try { userNameContainer.appendChild(placeholderPill); } catch (e2) { } }
      } else {
        try { userNameContainer.appendChild(placeholderPill); } catch (e) { }
      }
    }

    // Now fetch the actual location
    try {
      const result = await getUserLocation(screenName, usernameElement);
      const location = result?.location;
      const userId = result?.userId;

      if (!location) {
        // Keep placeholder with "?"
        placeholderPill.removeAttribute('data-loading');
        usernameElement.dataset.flagAdded = 'true'; // Mark as done (even if no flag)
        return;
      }

      const flagData = getCountryFlag(location);
      if (!flagData) {
        placeholderPill.removeAttribute('data-loading');
        usernameElement.dataset.flagAdded = 'true';
        return;
      }

      if (flagData.key && hideContentIfBlocked(usernameElement, flagData.key, screenName, userId)) {
        usernameElement.dataset.flagAdded = 'blocked';
        return;
      }

      // Update the flag part with actual flag
      if (flagData.type === 'text') {
        flagPart.textContent = flagData.value;
        flagPart.style.cssText = `
          font-size: 9px;
          font-weight: bold;
          padding: 1px 5px;
          border-radius: 3px;
          margin-right: -2px;
        `;
        // Apply custom styles (background, color, border) for text labels
        if (flagData.style) {
          if (flagData.style.backgroundColor) flagPart.style.backgroundColor = flagData.style.backgroundColor;
          if (flagData.style.background) flagPart.style.background = flagData.style.background;
          if (flagData.style.color) flagPart.style.color = flagData.style.color;
          if (flagData.style.border) flagPart.style.border = flagData.style.border;
          if (flagData.style.textShadow) flagPart.style.textShadow = flagData.style.textShadow;
        } else {
          flagPart.style.color = '#536471';
          flagPart.style.backgroundColor = 'rgba(0, 0, 0, 0.08)';
        }
      } else {
        // Use Twemoji for flag
        const emoji = flagData.value;
        const hexCode = Array.from(emoji).map(c => c.codePointAt(0).toString(16)).join('-');
        const img = document.createElement('img');
        img.src = `https://abs-0.twimg.com/emoji/v2/svg/${hexCode}.svg`;
        img.alt = emoji;
        img.draggable = false;
        img.style.cssText = 'height: 1em; width: auto; vertical-align: -0.1em; cursor: default;';
        img.onerror = () => { flagPart.textContent = emoji; };
        flagPart.textContent = '';
        flagPart.appendChild(img);
      }

      // Add instant tooltip on flag hover
      const locationName = location || '';
      if (locationName) {
        let tooltip = null;
        flagPart.style.cursor = 'help';
        flagPart.addEventListener('mouseenter', (e) => {
          tooltip = document.createElement('div');
          tooltip.className = 'ts-flag-tooltip';
          tooltip.textContent = locationName;
          tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.9);
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            z-index: 9999999;
            pointer-events: none;
            white-space: nowrap;
          `;
          document.body.appendChild(tooltip);
          const rect = flagPart.getBoundingClientRect();
          tooltip.style.left = `${rect.left}px`;
          tooltip.style.top = `${rect.top - tooltip.offsetHeight - 4}px`;
        });
        flagPart.addEventListener('mouseleave', () => {
          if (tooltip && tooltip.parentNode) tooltip.remove();
          tooltip = null;
        });
      }

      placeholderPill.removeAttribute('data-loading');
      usernameElement.dataset.flagAdded = 'true';

    } catch (e) {
      // Fetch error - keep pill with "?" placeholder
      placeholderPill?.removeAttribute?.('data-loading');
      usernameElement.dataset.flagAdded = 'true';
    }

  } catch (error) {
    usernameElement.dataset.flagAdded = 'failed';
  } finally {
    processingUsernames.delete(screenName);
  }
}

function removeAllFlags() {
  const flags = document.querySelectorAll('[data-twitter-flag]');
  flags.forEach(flag => flag.remove());
  const shimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
  shimmers.forEach(shimmer => shimmer.remove());
  const containers = document.querySelectorAll('[data-flag-added]');
  containers.forEach(container => {
    delete container.dataset.flagAdded;
    delete container.dataset.observed;
    delete container.dataset.screenName;
  });
  if (visibilityObserver) {
    visibilityObserver.disconnect();
  }
}

function updateScrollVelocity() {
  const currentScrollY = window.scrollY;
  const currentTime = Date.now();
  const deltaY = currentScrollY - lastScrollY;
  const deltaTime = currentTime - lastScrollTime;
  if (deltaTime > 0) {
    scrollVelocity = Math.abs(deltaY / deltaTime) * 1000;
  }
  lastScrollY = currentScrollY;
  lastScrollTime = currentTime;
}

function getAdaptiveRootMargin() {
  if (isInitialLoad) return INITIAL_ROOT_MARGIN;
  if (scrollVelocity < SLOW_SCROLL_THRESHOLD) return SLOW_SCROLL_MARGIN;
  else if (scrollVelocity < NORMAL_SCROLL_THRESHOLD) return NORMAL_SCROLL_MARGIN;
  else return FAST_SCROLL_MARGIN;
}

function shouldLoadItem() {
  if (isScrolling) return true;
  const now = Date.now();
  if (now - lastBurstTime < COOLDOWN_DURATION && itemsLoadedInBurst >= MAX_BURST_SIZE) return false;
  if (now - lastBurstTime >= COOLDOWN_DURATION) itemsLoadedInBurst = 0;
  return true;
}

function trackItemLoaded() {
  const now = Date.now();
  if (now - lastBurstTime >= COOLDOWN_DURATION) {
    itemsLoadedInBurst = 0;
    lastBurstTime = now;
  }
  itemsLoadedInBurst++;
}

function updateObserverMargin() {
  const newMargin = getAdaptiveRootMargin();
  if (newMargin !== currentRootMargin) {
    currentRootMargin = newMargin;
    initObservers();
  }
}

function initObservers() {
  if (visibilityObserver) visibilityObserver.disconnect();
  visibilityObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        if (container.dataset.flagAdded === 'true') {
          observer.unobserve(container);
          return;
        }

        // Removed shouldLoadItem() check to prevent dropping items. 
        // We rely on requestQueue to handle rate limiting.

        const screenName = container.dataset.screenName || extractUsername(container);
        if (screenName) {
          trackItemLoaded();
          addFlagToUsername(container, screenName).catch(err => { });
        }
        observer.unobserve(container);
      }
    });
  }, {
    rootMargin: currentRootMargin,
    threshold: 0.01
  });

  if (mutationObserver) mutationObserver.disconnect();
  mutationObserver = new MutationObserver((mutations) => {
    if (!extensionEnabled) return;
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    if (shouldProcess) {
      if (initObservers.timeout) clearTimeout(initObservers.timeout);
      const delay = isInitialLoad ? 50 : 200;
      initObservers.timeout = setTimeout(processUsernames, delay);
    }
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function processUsernames() {
  if (!extensionEnabled) return;
  const selector = [
    'article[data-testid="tweet"]:not([data-observed])',
    '[data-testid="UserCell"]:not([data-observed])',
    '[data-testid="User-Names"]:not([data-observed])',
    '[data-testid="User-Name"]:not([data-observed])',
    '[data-testid="primaryColumn"] [data-testid="UserName"]:not([data-observed])',
    '[data-testid="cellInnerDiv"]:not([data-observed])',
    '[role="article"]:not([data-observed])',
    '[data-testid="typeaheadResult"]:not([data-observed])'
  ].join(', ');

  const containers = document.querySelectorAll(selector);
  if (containers.length === 0) return;

  const initialLoadItems = [];
  for (const container of containers) {
    if (container.dataset.flagAdded === 'true') {
      container.dataset.observed = 'true';
      continue;
    }
    const screenName = extractUsername(container);
    if (screenName) {
      container.dataset.observed = 'true';
      container.dataset.screenName = screenName;
      if (isInitialLoad && initialLoadCount < INITIAL_LOAD_TARGET) {
        initialLoadCount++;
        initialLoadItems.push({ container, screenName });
        if (initialLoadCount >= INITIAL_LOAD_TARGET) isInitialLoad = false;
      } else {
        if (visibilityObserver) visibilityObserver.observe(container);
      }
    }
  }

  if (initialLoadItems.length > 0) {
    initialLoadItems.forEach(({ container, screenName }) => {
      addFlagToUsername(container, screenName).catch(() => { });
    });
    if (!isInitialLoad && !scrollCheckInterval) {
      setTimeout(() => { startScrollTracking(); }, 500);
    }
  }
}

function startScrollTracking() {
  if (scrollCheckInterval) clearInterval(scrollCheckInterval);
  scrollCheckInterval = setInterval(() => {
    updateScrollVelocity();
    updateObserverMargin();
  }, 100);

  window.addEventListener('scroll', () => {
    isScrolling = true;
    updateScrollVelocity();
    stopIdleLoading();
    if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
    scrollStopTimeout = setTimeout(() => {
      isScrolling = false;
      scrollVelocity = 0;
      setTimeout(() => { processVisibleItems(); }, 100);
      setTimeout(() => {
        if (!isScrolling && !idleLoadingActive) startIdleLoading();
      }, IDLE_START_DELAY);
    }, 150);
  }, { passive: true });
}

function processVisibleItems() {
  if (!extensionEnabled) return;
  const selector = [
    'article[data-testid="tweet"]:not([data-observed])',
    '[data-testid="UserCell"]:not([data-observed])',
    '[data-testid="User-Names"]:not([data-observed])',
    '[data-testid="User-Name"]:not([data-observed])',
    '[data-testid="primaryColumn"] [data-testid="UserName"]:not([data-observed])',
    '[data-testid="cellInnerDiv"]:not([data-observed])',
    '[role="article"]:not([data-observed])',
    '[data-testid="typeaheadResult"]:not([data-observed])'
  ].join(', ');

  const containers = document.querySelectorAll(selector);
  containers.forEach(container => {
    const rect = container.getBoundingClientRect();
    const isVisible = (
      rect.top >= 0 && rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
    if (isVisible && (!container.dataset.flagAdded || container.dataset.flagAdded === 'waiting')) {
      const screenName = extractUsername(container);
      if (screenName) {
        container.dataset.observed = 'true';
        container.dataset.screenName = screenName;
        addFlagToUsername(container, screenName).catch(() => { });
      }
    }
  });
}

function countLoadedItemsAhead() {
  const viewportBottom = window.scrollY + window.innerHeight;
  const selector = 'article[data-testid="tweet"], [data-testid="UserCell"]';
  const allContainers = document.querySelectorAll(selector);
  let loadedAhead = 0;
  for (const container of allContainers) {
    const rect = container.getBoundingClientRect();
    const elementTop = window.scrollY + rect.top;
    if (elementTop > viewportBottom) {
      if (container.dataset.flagAdded === 'true') loadedAhead++;
    }
  }
  return loadedAhead;
}

function getNextUnloadedItem() {
  const viewportBottom = window.scrollY + window.innerHeight;
  // Increase idle margin to match background loading strategy
  const marginPx = 3000;
  const selector = 'article[data-testid="tweet"]:not([data-observed]), [data-testid="UserCell"]:not([data-observed])';
  const containers = document.querySelectorAll(selector);
  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    const elementTop = window.scrollY + rect.top;
    if (elementTop > viewportBottom && elementTop <= viewportBottom + marginPx) return container;
  }
  return null;
}

function startIdleLoading() {
  stopIdleLoading();
  idleLoadingActive = true;
  idleLoadingInterval = setInterval(() => {
    if (!extensionEnabled || isScrolling) return;
    const loadedAhead = countLoadedItemsAhead();
    if (loadedAhead >= IDLE_LOOKAHEAD_LIMIT) return;

    // Aggressive idle loading
    const nextItem = getNextUnloadedItem();
    if (nextItem) {
      const screenName = extractUsername(nextItem);
      if (screenName) {
        nextItem.dataset.observed = 'true';
        nextItem.dataset.screenName = screenName;
        addFlagToUsername(nextItem, screenName).catch(() => { });
        lastIdleLoadTime = Date.now();
      }
    }
  }, IDLE_LOAD_INTERVAL);
}

function stopIdleLoading() {
  if (idleLoadingInterval) {
    clearInterval(idleLoadingInterval);
    idleLoadingInterval = null;
  }
  idleLoadingActive = false;
}

init();

// --- Premium Promo Logic (Refined Liquid Glass) ---
// --- Premium Promo Logic (Refined Liquid Glass) ---
async function showChristmasPromo() {
  // 1. Feature Flag / Date Check (End of December)
  const today = new Date();
  const endOfDec = new Date(today.getFullYear(), 11, 31, 23, 59, 59); // Dec 31st
  if (today > endOfDec) return;

  // 2. Premium Check (Don't show to paid users)
  if (isProUser) {
    console.log('TweetSanitizer: User is Premium. Skipping promo.');
    return;
  }

  // 3. Frequency Check (Once every week)
  const STORAGE_KEY = 'ts_promo_last_shown';
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const lastShown = result[STORAGE_KEY] || 0;

    // If shown less than a week ago, skip
    if (Date.now() - lastShown < ONE_WEEK_MS) {
      console.log('TweetSanitizer: Promo shown recently. Skipping.');
      return;
    }

    // Save new showing time
    await chrome.storage.local.set({ [STORAGE_KEY]: Date.now() });

  } catch (e) {
    console.error('TweetSanitizer: Storage error', e);
    // Continue cautiously or return? If storage fails, maybe safe to show or skip. 
    // Let's proceed to show to avoid blocking value prop, but unlikely to fail.
  }

  const existingId = 'tweet-sanitizer-christmas-promo';
  if (document.getElementById(existingId)) return;


  const promoContainer = document.createElement('div');
  promoContainer.id = existingId;
  promoContainer.style.position = 'fixed';
  promoContainer.style.top = '32px';  // Moved higher as requested
  promoContainer.style.right = '24px';
  promoContainer.style.zIndex = '2147483647';
  promoContainer.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // Shadow DOM
  const shadow = promoContainer.attachShadow({ mode: 'open' });

  // Get Icon URL
  const logoUrl = chrome.runtime.getURL('icons/icon-48.png');

  const style = `
    /* CSS Reset */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :host {
      /* Grey Blurred Translucent Theme */
      --glass-bg: rgba(40, 44, 52, 0.85); /* Grey Blurred Translucent */
      --glass-border: rgba(255, 255, 255, 0.15);
      --shadow-ambient: 0 8px 32px rgba(0, 0, 0, 0.3);
      --text-main: #FFFFFF;
      --text-sub: #9CA3AF; /* Ash */
      --price-red: #FF3B30; /* Red for $2 */
      --price-ash: #6E6E73; /* Ash for $5 */
      --accent-grad: linear-gradient(135deg, #FF3E55 0%, #FF9000 100%);
    }

    .container {
      position: relative;
      width: 350px; /* Wider to un-constrict headline */
      padding: 0;
      border-radius: 20px;
      
      background: var(--glass-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 
        0 0 0 1px var(--glass-border) inset,
        var(--shadow-ambient);
      
      opacity: 0;
      transform: translateY(-10px) scale(0.96);
      animation: springIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      overflow: hidden;
      cursor: default;
      text-align: center;
    }

    @keyframes springIn {
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    
    @keyframes blink-badge {
      0%, 100% { color: #34C759; background: rgba(52, 199, 89, 0.15); } /* Green */
      50% { color: #FF3B30; background: rgba(255, 59, 48, 0.15); } /* Red */
    }

    /* Bounce Out Right Animation (User Provided) */
    @keyframes bounceOutRight {
      20% {
        opacity: 1;
        transform: translateX(-20px);
      }
    
      100% {
        opacity: 0;
        transform: translateX(2000px);
      }
    }
    
    .bounceOutRight {
      animation-name: bounceOutRight;
      animation-duration: 0.75s;
      animation-timing-function: ease-in;
      animation-fill-mode: both;
    }

    /* Header */
    .top-notch {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px 16px 8px;
      gap: 8px;
    }
    
    .logo-img {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: block;
    }
    
    .brand-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-sub);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .content {
      padding: 0 20px 24px; /* Slightly less padding to give more width */
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .headline {
      font-size: 28px; /* Bigger as requested */
      font-weight: 800;
      color: #FFD700; /* Yellow */
      margin-bottom: 8px;
      line-height: 1.1;
      letter-spacing: -0.02em;
      max-width: 100%;
    }

    .subtext {
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-sub);
      margin-bottom: 20px;
      font-weight: 400;
      max-width: 90%;
    }

    /* Pricing */
    .pricing-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    
    .price-val {
      font-size: 28px;
      font-weight: 800;
      color: var(--price-red); /* Red */
    }

    .price-old {
      font-size: 16px;
      color: var(--price-ash); /* Ash */
      text-decoration: line-through;
      font-weight: 500;
    }

    .lifetime-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 100px;
      margin-left: 4px;
      animation: blink-badge 2s infinite ease-in-out; /* Blinking Animation */
    }

    /* CTA Button */
    .cta-btn {
      width: 100%;
      background: var(--accent-grad);
      color: white;
      border: none;
      padding: 14px;
      font-size: 16px;
      font-weight: 700;
      border-radius: 12px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      box-shadow: 0 4px 16px rgba(255, 62, 85, 0.3);
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      overflow: hidden;
    }

    .cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(255, 62, 85, 0.4);
    }
    
    /* Close Button */
    .close-btn {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      border: none;
      cursor: pointer;
      display:flex;
      align-items: center;
      justify-content: center;
      color: var(--text-sub);
      transition: all 0.2s;
      z-index: 2;
    }

    .close-btn:hover {
      background: #FF3B30; /* Red on hover */
      color: white;
      transform: rotate(90deg); /* Nice little rotation */
    }
    
    .shine {
      position: absolute;
      top: 0;
      left: -100%;
      width: 50%;
      height: 100%;
      background: linear-gradient(
        to right,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,0.2) 50%,
        rgba(255,255,255,0) 100%
      );
      transform: skewX(-20deg);
      animation: shine 3s infinite;
    }
    
    @keyframes shine {
      0%, 80% { left: -100%; }
      100% { left: 200%; }
    }
  `;

  // HTML Structure
  const html = `
    <div class="container">
      <button class="close-btn" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
      </button>

      <div class="top-notch">
        <img class="logo-img" src="${logoUrl}" alt="Logo">
        <span class="brand-name">Tweet Sanitizer</span>
      </div>

      <div class="content">
        <div class="headline">See Tweets That<br>Actually Matter</div>
        <div class="subtext">Filter out regional noise and focus your timeline on the content you care about.</div>

        <div class="pricing-row">
          <span class="price-val">$2</span>
          <span class="price-old">$5</span>
          <span class="lifetime-badge">LIFETIME ACCESS</span>
        </div>

        <a href="https://evynignatious.gumroad.com/l/ypykqhh/XMAs" target="_blank" class="cta-btn">
          <span>Take Control of Your Timeline</span>
          <div class="shine"></div>
        </a>
      </div>
    </div>
  `;

  shadow.innerHTML = `<style>${style}</style>${html}`;

  document.body.appendChild(promoContainer);

  const closeBtn = shadow.querySelector('.close-btn');
  const ctaBtn = shadow.querySelector('.cta-btn');
  const container = shadow.querySelector('.container');

  /* Close Logic with Bounce Out Right Animation */
  const closePromo = () => {
    container.classList.add('bounceOutRight');
    // Remove after animation completes
    setTimeout(() => {
      promoContainer.remove();
    }, 800);
  };

  closeBtn.addEventListener('click', closePromo);
  ctaBtn.addEventListener('click', () => {
    setTimeout(closePromo, 1500);
  });
}


async function init() {
  // Check license in background (don't await to avoid blocking UI)
  await checkLicense(); // AWAIT THIS NOW to ensure we know Pro status before checking promo

  // Trigger Promo (after license check)
  showChristmasPromo();


  // Load settings
  await loadEnabledState();
  await loadBlockedCountries();
  await loadCache();

  if (!extensionEnabled) return;

  injectPageScript();
  initObservers();

  processUsernames();
  setTimeout(processUsernames, 50);
  setTimeout(processUsernames, 200);

  let lastUrl = location.href;
  setInterval(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      isInitialLoad = true;
      initialLoadCount = 0;
      totalItemsProcessed = 0; // Reset on navigation
      itemsLoadedInBurst = 0;
      lastBurstTime = 0;
      currentRootMargin = INITIAL_ROOT_MARGIN;
      processUsernames();
      setTimeout(processUsernames, 50);
      setTimeout(processUsernames, 200);
    }
  }, 1000);

  setInterval(saveCache, 30000);

  // Start periodic upload sync
  // Upload logic moved to background.js
  // setInterval(processUploadQueue, UPLOAD_INTERVAL);
  // Also try to upload on page load (in case previous session left data)
  // setTimeout(processUploadQueue, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// --- DETAILS HOVERCARD SYSTEM (Rebuilt) ---

// --- DETAILS HOVERCARD SYSTEM (Controller Pattern) ---

const HovercardController = {
  card: null,
  anchor: null,
  locked: false,
  requestId: null,
  screenName: null,
  hoverTimeout: null,

  init() {
    this.card = getDetailsHovercard();
  },

  open({ anchor, screenName, lock }) {
    if (this.hoverTimeout && lock) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }

    // Ignore hover if already locked on another element
    if (this.locked && !lock && this.anchor !== anchor) {
      return;
    }

    // Hard reset if switching anchors or re-opening
    if (this.anchor !== anchor) {
      this.reset();
      this.anchor = anchor;
      this.screenName = screenName;

      // Reset content to loading
      this.card.querySelectorAll('.ts-hc-val').forEach(el => {
        el.textContent = '...';
        el.className = 'ts-hc-val loading';
      });

      this.card.classList.add('visible');
      this.position();
      this.fetchDetails(screenName);
    } else if (!this.card.classList.contains('visible')) {
      // Re-opening same anchor
      this.card.classList.add('visible');
      this.position();
    }

    // Update lock state - click always upgrades to locked
    if (lock) {
      this.locked = true;
    }
  },

  close(force = false) {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }

    if (this.locked && !force) return;
    this.reset();
  },

  closeWithDelay(delay = 300) {
    if (this.locked) return;

    if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
    this.hoverTimeout = setTimeout(() => {
      this.close();
    }, delay);
  },

  reset() {
    this.locked = false;
    this.anchor = null;
    this.requestId = null;
    this.screenName = null;
    this.card?.classList.remove('visible');
  },

  position() {
    if (!this.anchor || !this.card) return;
    const rect = this.anchor.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 8;
    let left = rect.left;
    if (left + 300 > window.innerWidth) {
      left = window.innerWidth - 310;
    }
    this.card.style.top = `${top}px`;
    this.card.style.left = `${left}px`;
  },

  fetchDetails(screenName) {
    // Generate simple unique ID
    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.requestId = id;

    window.postMessage({
      type: '__fetchAccountDetails',
      screenName,
      requestId: id
    }, '*');
  },

  onData({ requestId, data, error, retryAfter }) {
    if (requestId !== this.requestId) return;

    if (error === 'RATE_LIMITED') {
      this.card.querySelectorAll('.ts-hc-val').forEach(el => {
        el.textContent = '—';
        el.className = 'ts-hc-val';
      });
      const firstVal = this.card.querySelector('.ts-hc-val');
      if (firstVal) {
        firstVal.textContent = `Wait ${retryAfter}s`;
        firstVal.className = 'ts-hc-val warning';
      }
      return;
    }

    if (data) {
      populateDetailsHovercard(data);
    } else {
      const firstVal = this.card.querySelector('.ts-hc-val');
      if (firstVal) {
        firstVal.textContent = 'Error';
        firstVal.className = 'ts-hc-val warning';
      }
    }
  }
};

// Create the hovercard element
let detailsHovercard = null; // Keep this declaration for getDetailsHovercard to assign to
function getDetailsHovercard() {
  if (detailsHovercard) return detailsHovercard;

  detailsHovercard = document.createElement('div');
  detailsHovercard.id = 'ts-details-hovercard';
  detailsHovercard.innerHTML = `
    <div class="ts-hc-header">
      <span class="ts-hc-title">Account Details</span>
      <span class="ts-hc-close"></span>
    </div>
    <div class="ts-hc-body">
      <div class="ts-hc-section">
        <div class="ts-hc-row"><span class="ts-hc-label">User ID</span><span class="ts-hc-val" data-field="userId">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Created</span><span class="ts-hc-val" data-field="created">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Account Age</span><span class="ts-hc-val" data-field="daysOnX">—</span></div>
      </div>
      <div class="ts-hc-section">
        <div class="ts-hc-row"><span class="ts-hc-label">Location</span><span class="ts-hc-val" data-field="location">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Created In</span><span class="ts-hc-val" data-field="createdIn">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Device</span><span class="ts-hc-val" data-field="device">—</span></div>
      </div>
      <div class="ts-hc-section">
        <div class="ts-hc-row"><span class="ts-hc-label">Username Changes</span><span class="ts-hc-val" data-field="usernameChanges">—</span></div>
      </div>
      <div class="ts-hc-section">
        <div class="ts-hc-row"><span class="ts-hc-label">Blue Verified</span><span class="ts-hc-val" data-field="blueVerified">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Legacy Verified</span><span class="ts-hc-val" data-field="legacyVerified">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">ID Verified</span><span class="ts-hc-val" data-field="idVerified">—</span></div>
        <div class="ts-hc-row"><span class="ts-hc-label">Affiliation</span><span class="ts-hc-val" data-field="affiliation">—</span></div>
      </div>
    </div>
  `;

  // Add styles - Premium Glassmorphism
  const style = document.createElement('style');
  style.textContent = `
    #ts-details-hovercard {
      position: fixed;
      z-index: 999999;
      width: 300px;
      background: rgba(22, 24, 28, 0.65);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: 
        0 4px 6px rgba(0, 0, 0, 0.1),
        0 12px 40px rgba(0, 0, 0, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #e7e9ea;
      display: none;
      overflow: hidden;
      animation: ts-hc-fadeIn 0.15s ease-out;
    }
    @keyframes ts-hc-fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    #ts-details-hovercard.visible { display: block; }
    .ts-hc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ts-hc-title {
      font-weight: 600;
      font-size: 13px;
      color: #e7e9ea;
      letter-spacing: -0.01em;
    }
    .ts-hc-close {
      width: 18px;
      height: 18px;
      cursor: pointer;
      opacity: 0.5;
      transition: opacity 0.15s;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e7e9ea' stroke-width='2'%3E%3Cpath d='M18 6L6 18M6 6l12 12'/%3E%3C/svg%3E") center/contain no-repeat;
    }
    .ts-hc-close:hover { opacity: 1; }
    .ts-hc-body { padding: 4px 0; }
    .ts-hc-section {
      padding: 6px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .ts-hc-section:last-child { border-bottom: none; }
    .ts-hc-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      font-size: 12px;
    }
    .ts-hc-label { 
      color: #71767b;
      font-weight: 400;
    }
    .ts-hc-val { 
      font-weight: 500; 
      color: #e7e9ea;
      text-align: right;
      max-width: 160px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ts-hc-val.verified { color: #00ba7c; }
    .ts-hc-val.warning { color: #ff6b6b; }
    .ts-hc-val.blue { color: #1d9bf0; }
    .ts-hc-val.gold { color: #ffd93d; }
    .ts-hc-val.loading { color: #536471; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(detailsHovercard);

  // Close button
  detailsHovercard.querySelector('.ts-hc-close').addEventListener('click', () => {
    HovercardController.close(true);
  });

  // Keep alive on hover
  detailsHovercard.addEventListener('mouseenter', () => {
    if (HovercardController.hoverTimeout) {
      clearTimeout(HovercardController.hoverTimeout);
      HovercardController.hoverTimeout = null;
    }
  });
  detailsHovercard.addEventListener('mouseleave', () => {
    HovercardController.closeWithDelay(300);
  });

  return detailsHovercard;
}

function populateDetailsHovercard(data) {
  const card = HovercardController.card;
  if (!card || !card.classList.contains('visible')) return;

  const setValue = (field, value, className = '') => {
    const el = card.querySelector(`[data-field="${field}"]`);
    if (el) {
      el.textContent = value || '—';
      el.className = 'ts-hc-val' + (className ? ` ${className}` : '');
    }
  };

  // Basic Info
  setValue('userId', data.userId);
  setValue('created', data.createdAt);
  setValue('daysOnX', data.daysOnX ? `${data.daysOnX.toLocaleString()} days` : null);

  // Location
  setValue('location', data.location);
  if (data.createdCountryAccurate && data.createdIn) {
    setValue('createdIn', `✓ ${data.createdIn}`, 'verified');
  } else {
    setValue('createdIn', 'Unknown');
  }

  // Device Formatting
  if (data.device) {
    let deviceRaw = data.device.toLowerCase();

    if (deviceRaw.includes('android')) {
      setValue('device', 'Android');
    } else if (deviceRaw.includes('iphone') || deviceRaw.includes('ipad') || deviceRaw.includes('ios') || deviceRaw.includes('app store')) {
      setValue('device', 'iOS');
    } else if (deviceRaw.includes('web') || deviceRaw.includes('twitter for web')) {
      setValue('device', 'Web');
    } else {
      // For others, clean up "Twitter for ..." or show as is if readable, else "Browser"
      let clean = data.device.replace(/^Twitter for /i, '').replace(/^Twitter /i, '');
      setValue('device', clean);
    }
  } else {
    setValue('device', 'Unknown');
  }

  // Username Changes
  if (data.usernameChanges > 0) {
    setValue('usernameChanges', `${data.usernameChanges}x`);
  } else {
    setValue('usernameChanges', 'Never');
  }

  // Verification
  setValue('blueVerified', data.isBlueVerified ? '✓ Paid' : 'No', data.isBlueVerified ? 'blue' : '');
  setValue('legacyVerified', data.isLegacyVerified ? '✓ Yes' : 'No', data.isLegacyVerified ? 'gold' : '');
  setValue('idVerified', data.isIdentityVerified ? '✓ KYC' : 'No', data.isIdentityVerified ? 'verified' : '');
  setValue('affiliation', data.affiliation || 'None');
}

// Initialize controller
HovercardController.init();

// Listen for details response from pageScript
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === '__accountDetailsResponse') {
    // Forward to controller
    HovercardController.onData(event.data);
  }
});

// Close hovercard when clicking outside
document.addEventListener('click', (e) => {
  if (HovercardController.card?.classList.contains('visible')) {
    if (!HovercardController.card.contains(e.target) && !e.target.closest('[data-twitter-flag]')) {
      HovercardController.close(true); // Force close
    }
  }
});

// Update hovercard position on scroll, close if anchor is out of view
window.addEventListener('scroll', () => {
  HovercardController.position();

  if (HovercardController.anchor) {
    const rect = HovercardController.anchor.getBoundingClientRect();
    if (rect.bottom < -50 || rect.top > window.innerHeight + 50) {
      HovercardController.close(true);
    }
  }
}, { passive: true });

// Close hovercard on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    HovercardController.close(true);
  }
});
