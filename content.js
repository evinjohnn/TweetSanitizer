// Global error handler to prevent extension crashes from breaking Twitter
window.addEventListener('error', (event) => {
  if (event.filename?.includes('chrome-extension://')) {
    event.preventDefault();
  }
});

function isExtensionContextValid() {
  try { return chrome.runtime?.id !== undefined; } catch { return false; }
}

let isProUser = false; // Default to locked

// Check license with Server on startup (Security Best Practice)
async function checkLicense() {
  try {
    const result = await chrome.storage.local.get(['license_key']);
    const savedKey = result.license_key;

    if (!savedKey) {
      isProUser = false;
      return;
    }

    // Verify with Cloudflare
    const response = await fetch(`${CLOUD_API_URL}/verify-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: savedKey })
    });

    const data = await response.json();
    isProUser = data.valid;

    // If key became invalid (refunded/expired), revoke access locally
    if (!isProUser) {
      chrome.storage.local.set({ license_status: false });
    }

  } catch (e) {
    // Network error? Fallback to last known status to be nice to user
    const local = await chrome.storage.local.get('license_status');
    isProUser = local.license_status === true;
  }
}

let locationCache = new Map();
const CACHE_KEY = 'twitter_location_cache';
const CACHE_EXPIRY_DAYS = 30; // Cache for 30 days

// Cloud API Configuration
const CLOUD_API_URL = 'https://tweet-sanitizer-api.tweet-sanitizer.workers.dev';
const BATCH_SIZE = 5; // Process 5 items at a time
const UPLOAD_QUEUE_KEY = 'pending_uploads';
const UPLOAD_INTERVAL = 30 * 60 * 1000; // 30 Minutes
let uploadIntervalRef = null;
const requestQueue = [];
const MAX_QUEUE_SIZE = 150; // Increased limit to prevent dropping items during fast scroll
const QUEUE_ITEM_TIMEOUT = 30000; // 30 seconds max in queuese;
let isProcessingQueue = false;
let lastRequestTime = 0;
let currentRequestInterval = 100;
let maxConcurrentRequests = 5;
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
let autoMuteEnabled = false;
const BLOCKED_KEY = 'blocked_countries';
const MUTE_KEY = 'auto_mute_enabled';

async function loadBlockedCountries() {
  try {
    if (!chrome.runtime?.id) return; // Extension context invalid
    const result = await chrome.storage.local.get([BLOCKED_KEY, MUTE_KEY]);
    let blockedList = result[BLOCKED_KEY];
    if (!Array.isArray(blockedList)) {
      blockedList = [];
    }
    blockedCountries = new Set(blockedList);
    autoMuteEnabled = result[MUTE_KEY] || false;
    // console.log('TweetSanitizer: Loaded blocked countries:', blockedList, 'Auto-Mute:', autoMuteEnabled);
  } catch (error) {
    console.warn('TweetSanitizer: Warning loading blocked countries (non-fatal)', error);
    // Initialize empty to prevent crashes
    blockedCountries = new Set();
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes[BLOCKED_KEY]) {
      let newValue = changes[BLOCKED_KEY].newValue;
      if (!Array.isArray(newValue)) {
        newValue = [];
      }
      blockedCountries = new Set(newValue);
      // console.log('TweetSanitizer: Updated blocked countries:', newValue);
    }
    if (changes[MUTE_KEY]) {
      autoMuteEnabled = changes[MUTE_KEY].newValue !== undefined ? changes[MUTE_KEY].newValue : false;
      // console.log('TweetSanitizer: Updated Auto-Mute:', autoMuteEnabled);
    }
  }
});

window.addEventListener('focus', () => {
  loadBlockedCountries();
});

function hideContentIfBlocked(element, locationKey, screenName, userId) {
  // --- SECURITY GATE ---
  if (!isProUser) {
    // If not Pro, do NOT hide the tweet.
    // Just return false, so the Flag still shows, but the Tweet stays visible.
    return false;
  }

  if (blockedCountries.has(locationKey)) {
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
          element.style.setProperty('display', 'none', 'important');
          if (element.parentElement) element.parentElement.style.setProperty('display', 'none', 'important');
          hidden = true;
        }
      }
    }

    if (hidden) {
      // console.log('TweetSanitizer: Visually hidden content for', screenName);
    } else {
      console.warn('TweetSanitizer: Failed to visually hide content for', screenName);
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
    if (Object.keys(queue).length >= 20) {
      processUploadQueue();
    }
  } catch (e) {
    console.warn('TweetSanitizer: Queue save failed', e);
  }
}

// Flush the queue to the server
async function processUploadQueue() {
  try {
    // 1. Get queue
    const result = await chrome.storage.local.get(UPLOAD_QUEUE_KEY);
    const queue = result[UPLOAD_QUEUE_KEY] || {};
    const usernames = Object.keys(queue);

    if (usernames.length === 0) return;

    // console.log(`TweetSanitizer: Uploading ${usernames.length} new locations to Cloud...`);

    // 2. Convert to Array format for server
    const payload = usernames.map(u => ({ username: u, location: queue[u] }));

    // 3. Send Batch
    const response = await fetch(`${CLOUD_API_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: payload })
    });

    if (response.ok) {
      // 4. Clear Queue ONLY if successful
      // We remove the specific keys we just sent, in case new ones were added while uploading
      const currentStorage = await chrome.storage.local.get(UPLOAD_QUEUE_KEY);
      let currentQueue = currentStorage[UPLOAD_QUEUE_KEY] || {};

      usernames.forEach(u => delete currentQueue[u]);

      await chrome.storage.local.set({ [UPLOAD_QUEUE_KEY]: currentQueue });
      // console.log('TweetSanitizer: Upload success.');
    } else {
      console.warn('TweetSanitizer: Upload failed, keeping data for retry.');
    }
  } catch (e) {
    console.error('TweetSanitizer: Upload error', e);
  }
}

// Smart Strategy Selector
function getFetchStrategy() {
  // 1. Initial Load: Use Direct API for first 30 items (Speed & Reliability)
  if (totalItemsProcessed < 30) return 'DIRECT';

  // 2. Fast Scroll: Use Direct API (Avoid Cloud Miss Latency)
  if (scrollVelocity > FAST_SCROLL_THRESHOLD) return 'DIRECT';

  // 3. Normal/Idle: Use Hybrid (Cloud Batch -> Fallback) (Efficiency)
  return 'HYBRID';
}

// Process request queue with Smart Strategy
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }

  // Filter out items that are not ready yet (retry delay)
  const now = Date.now();
  // We need to check if the *next* item is ready. If not, we shouldn't block the queue, 
  // but since we sort by distance, we might want to skip over delayed items.
  // Let's just filter the queue for ready items for this run? 
  // No, splicing is dangerous while iterating. 
  // Better: When picking an item, check processAfter.


  // Check if we're rate limited (affects fallback/direct only)
  const isTwitterRateLimited = rateLimitResetTime > 0 && Math.floor(Date.now() / 1000) < rateLimitResetTime;

  isProcessingQueue = true;

  // Clean up timed out items from queue
  // Clean up timed out items from queue
  // Reuse 'now' from line 360
  // const now = Date.now(); // Already declared
  // Actually, let's just use the variable we already have.
  // But wait, line 360 'now' is in the same scope.
  // Let's just remove the declaration line or update the value if needed.
  // Since we want fresh time, let's just update the variable if it was let, but it was const.
  // So we must rename this one too.
  const cleanupTime = Date.now();
  let cleanedCount = 0;
  for (let i = requestQueue.length - 1; i >= 0; i--) {
    if (cleanupTime - requestQueue[i].timestamp > QUEUE_ITEM_TIMEOUT) {
      const item = requestQueue[i];
      requestQueue.splice(i, 1);
      item.resolve({ location: null, userId: null });
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    // console.log(`TweetSanitizer: Cleaned ${cleanedCount} timed out items from queue`);
  }

  // PRIORITY LOGIC: Sort queue by distance to center
  requestQueue.sort((a, b) => {
    const distA = getDistanceToCenter(a.element);
    const distB = getDistanceToCenter(b.element);
    return distA - distB;
  });

  const strategy = getFetchStrategy();

  if (strategy === 'DIRECT') {
    // --- DIRECT STRATEGY (Single Item, Twitter API) ---
    if (activeRequests < maxConcurrentRequests) {
      // Find first ready item
      const directTime = Date.now();
      const readyIndex = requestQueue.findIndex(req => !req.processAfter || req.processAfter <= directTime);

      if (readyIndex === -1) {
        // No items ready, try again later
        isProcessingQueue = false;
        setTimeout(processRequestQueue, 1000);
        return;
      }

      const request = requestQueue.splice(readyIndex, 1)[0];
      const { screenName, resolve, reject } = request;

      activeRequests++;
      lastRequestTime = Date.now();

      if (isTwitterRateLimited && request.retryCount === 0) {
        resolve({ location: null, userId: null });
        activeRequests--;
      } else {
        makeLocationRequest(screenName)
          .then(result => {
            // Check for 429 or rate limited flag
            if (result.isRateLimited) {
              if (request.retryCount < 3) {
                const delays = [5000, 10000, 30000];
                const delay = delays[request.retryCount];
                request.retryCount++;
                request.processAfter = Date.now() + delay;
                // console.log(`TweetSanitizer: 429 for ${screenName}, retrying in ${delay}ms (Attempt ${request.retryCount}/3)`);
                requestQueue.push(request);
                // Don't resolve, just re-queue
              } else {
                console.warn(`TweetSanitizer: Gave up on ${screenName} after 3 retries`);
                resolve({ location: null, userId: null });
              }
            } else {
              resolve(result);
              totalItemsProcessed++;
              if (result.location) queueForUpload(screenName, result.location);
            }
          })
          .catch(error => reject(error))
          .finally(() => {
            activeRequests--;
            setTimeout(processRequestQueue, 50);
          });
      }
    } else {
      // Concurrency limit reached for direct
      isProcessingQueue = false;
      return;
    }
  } else {
    // --- HYBRID STRATEGY (Batch, Cloud -> Fallback) ---

    // Process a batch of items
    const batch = [];
    // Reuse 'now' from outer scope or just get fresh time if needed, but 'now' is already defined at top of function
    // Actually 'now' was defined at line 365. Let's just use that or update it.
    const batchTime = Date.now();

    // Collect ready items for batch
    // We iterate and splice carefully
    let i = 0;
    while (batch.length < BATCH_SIZE && i < requestQueue.length && activeRequests < maxConcurrentRequests) {
      const req = requestQueue[i];
      if (!req.processAfter || req.processAfter <= batchTime) {
        batch.push(requestQueue.splice(i, 1)[0]);
        activeRequests++;
        // Don't increment i because splice shifted elements
      } else {
        i++;
      }
    }

    if (batch.length === 0) {
      isProcessingQueue = false;
      return;
    }

    const usernames = batch.map(req => req.screenName);

    // 1. Try Cloud API first (Batch)
    let cloudResults = null;
    try {
      cloudResults = await fetchFromCloud(usernames);
    } catch (e) {
      console.error('TweetSanitizer: Cloud batch failed', e);
    }

    // Process batch results
    for (const request of batch) {
      const { screenName, resolve, reject } = request;
      const cloudLocation = cloudResults ? cloudResults[screenName] : null;

      if (cloudLocation) {
        // HIT: Found in Cloud
        resolve({ location: cloudLocation, userId: null });
        activeRequests--;
        saveCacheEntry(screenName, { location: cloudLocation, userId: null });
        totalItemsProcessed++;
      } else {
        // MISS: Fallback to Twitter API
        if (isTwitterRateLimited && request.retryCount === 0) {
          resolve({ location: null, userId: null });
          activeRequests--;
        } else {
          makeLocationRequest(screenName)
            .then(result => {
              if (result.isRateLimited) {
                if (request.retryCount < 3) {
                  const delays = [5000, 10000, 30000];
                  const delay = delays[request.retryCount];
                  request.retryCount++;
                  request.processAfter = Date.now() + delay;
                  // console.log(`TweetSanitizer: 429 for ${screenName}, retrying in ${delay}ms (Attempt ${request.retryCount}/3)`);
                  requestQueue.push(request);
                } else {
                  console.warn(`TweetSanitizer: Gave up on ${screenName} after 3 retries`);
                  resolve({ location: null, userId: null });
                }
              } else {
                resolve(result);
                totalItemsProcessed++;
                if (result.location) {
                  queueForUpload(screenName, result.location);
                }
              }
            })
            .catch(error => reject(error))
            .finally(() => {
              activeRequests--;
            });
        }
      }
    }

    lastRequestTime = Date.now();
    setTimeout(processRequestQueue, 100);
  }

  // Keep processing if queue not empty
  if (requestQueue.length > 0) {
    // If we just fired async requests, we don't want to loop immediately and block
    // But we rely on callbacks to trigger next processRequestQueue usually.
    // However, for batching, we might want to trigger again if we have capacity.
  }

  isProcessingQueue = false;
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
    const shimmerSpan = createLoadingShimmer();
    let shimmerInserted = false;

    if (userNameContainer) {
      const handleSection = findHandleSection(userNameContainer, screenName);
      if (handleSection && handleSection.parentNode) {
        try {
          handleSection.parentNode.insertBefore(shimmerSpan, handleSection);
          shimmerInserted = true;
        } catch (e) {
          try {
            userNameContainer.appendChild(shimmerSpan);
            shimmerInserted = true;
          } catch (e2) { }
        }
      } else {
        try {
          userNameContainer.appendChild(shimmerSpan);
          shimmerInserted = true;
        } catch (e) { }
      }
    }

    try {
      const result = await getUserLocation(screenName, usernameElement);
      const location = result?.location;
      const userId = result?.userId;

      if (shimmerInserted && shimmerSpan.parentNode) {
        shimmerSpan.remove();
      }

      if (!location) {
        usernameElement.dataset.flagAdded = 'failed';
        return;
      }

      const flagData = getCountryFlag(location);
      if (!flagData) {
        usernameElement.dataset.flagAdded = 'failed';
        return;
      }

      if (flagData.key && hideContentIfBlocked(usernameElement, flagData.key, screenName, userId)) {
        usernameElement.dataset.flagAdded = 'blocked';
        return;
      }

      let usernameLink = null;
      const containerForLink = userNameContainer || usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');

      if (containerForLink) {
        const containerLinks = containerForLink.querySelectorAll('a[href^="/"]');
        for (const link of containerLinks) {
          const text = link.textContent?.trim();
          const href = link.getAttribute('href');
          const match = href.match(/^\/([^\/\?]+)/);
          if (match && match[1] === screenName) {
            if (text === `@${screenName}` || text === screenName) {
              usernameLink = link;
              break;
            }
          }
        }
      }

      if (!usernameLink && containerForLink) {
        const containerLinks = containerForLink.querySelectorAll('a[href^="/"]');
        for (const link of containerLinks) {
          const text = link.textContent?.trim();
          if (text === `@${screenName}`) {
            usernameLink = link;
            break;
          }
        }
      }

      if (!usernameLink) {
        const links = usernameElement.querySelectorAll('a[href^="/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim();
          if ((href === `/${screenName}` || href.startsWith(`/${screenName}?`)) && (text === `@${screenName}` || text === screenName)) {
            usernameLink = link;
            break;
          }
        }
      }

      if (!usernameLink) {
        const links = usernameElement.querySelectorAll('a[href^="/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          const match = href.match(/^\/([^\/\?]+)/);
          if (match && match[1] === screenName) {
            const hasVerificationBadge = link.closest('[data-testid="User-Name"]')?.querySelector('[data-testid="icon-verified"]');
            if (!hasVerificationBadge || link.textContent?.trim() === `@${screenName}`) {
              usernameLink = link;
              break;
            }
          }
        }
      }

      if (!usernameLink) {
        usernameElement.dataset.flagAdded = 'failed';
        return;
      }

      const existingFlag = usernameElement.querySelector('[data-twitter-flag]');
      if (existingFlag) {
        usernameElement.dataset.flagAdded = 'true';
        return;
      }

      const flagSpan = document.createElement('span');
      flagSpan.setAttribute('data-twitter-flag', 'true');
      flagSpan.style.marginLeft = '4px';
      flagSpan.style.marginRight = '4px';
      flagSpan.style.display = 'inline-block';
      flagSpan.style.verticalAlign = 'middle';

      if (flagData.type === 'text') {
        flagSpan.textContent = ` ${flagData.value} `;
        flagSpan.style.fontSize = '10px';
        flagSpan.style.fontWeight = 'bold';
        flagSpan.style.borderRadius = '3px';
        flagSpan.style.padding = '1px 4px';
        flagSpan.style.lineHeight = '12px';
        if (flagData.style) {
          if (flagData.style.backgroundColor) flagSpan.style.backgroundColor = flagData.style.backgroundColor;
          if (flagData.style.background) flagSpan.style.background = flagData.style.background;
          if (flagData.style.color) flagSpan.style.color = flagData.style.color;
          if (flagData.style.border) flagSpan.style.border = flagData.style.border;
          if (flagData.style.textShadow) flagSpan.style.textShadow = flagData.style.textShadow;
        } else {
          flagSpan.style.color = '#536471';
          flagSpan.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        }
      } else {
        flagSpan.textContent = ` ${flagData.value}`;
        flagSpan.style.color = 'inherit';
      }

      const containerForFlag = userNameContainer || usernameElement.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
      if (!containerForFlag) {
        usernameElement.dataset.flagAdded = 'failed';
        return;
      }

      const handleSection = findHandleSection(containerForFlag, screenName);
      let inserted = false;

      // Check for Column Layout (Tweet Detail View)
      let isColumnLayout = false;
      try {
        const style = window.getComputedStyle(containerForFlag);
        if (style.flexDirection === 'column') {
          isColumnLayout = true;
        }
      } catch (e) { }

      if (isColumnLayout && handleSection && handleSection.parentNode === containerForFlag) {
        // In column layout, insert INSIDE the name section (previous sibling)
        // to keep it on the same line as the name
        const nameSection = handleSection.previousElementSibling;
        if (nameSection) {
          try {
            nameSection.appendChild(flagSpan);
            inserted = true;
          } catch (e) { }
        }
      }

      if (!inserted && handleSection && handleSection.parentNode === containerForFlag) {
        try {
          containerForFlag.insertBefore(flagSpan, handleSection);
          inserted = true;
        } catch (e) { }
      }

      if (!inserted && handleSection && handleSection.parentNode) {
        try {
          const handleParent = handleSection.parentNode;
          if (handleParent !== containerForFlag && handleParent.parentNode) {
            handleParent.parentNode.insertBefore(flagSpan, handleParent);
            inserted = true;
          } else if (handleParent === containerForFlag) {
            containerForFlag.insertBefore(flagSpan, handleSection);
            inserted = true;
          }
        } catch (e) { }
      }

      if (!inserted && handleSection) {
        try {
          const displayNameLink = containerForFlag.querySelector('a[href^="/"]');
          if (displayNameLink) {
            const displayNameContainer = displayNameLink.closest('div');
            if (displayNameContainer && displayNameContainer.parentNode) {
              if (displayNameContainer.parentNode === handleSection.parentNode) {
                displayNameContainer.parentNode.insertBefore(flagSpan, handleSection);
                inserted = true;
              } else {
                displayNameContainer.parentNode.insertBefore(flagSpan, displayNameContainer.nextSibling);
                inserted = true;
              }
            }
          }
        } catch (e) { }
      }

      if (!inserted) {
        try {
          containerForFlag.appendChild(flagSpan);
          inserted = true;
        } catch (e) { }
      }

      if (inserted) {
        usernameElement.dataset.flagAdded = 'true';
        const waitingContainers = document.querySelectorAll(`[data-flag-added="waiting"]`);
        waitingContainers.forEach(container => {
          const waitingUsername = extractUsername(container);
          if (waitingUsername === screenName) {
            addFlagToUsername(container, screenName).catch(() => { });
          }
        });
      } else {
        usernameElement.dataset.flagAdded = 'failed';
      }
    } catch (error) {
      if (shimmerInserted && shimmerSpan.parentNode) {
        shimmerSpan.remove();
      }
      usernameElement.dataset.flagAdded = 'failed';
    } finally {
      processingUsernames.delete(screenName);
    }
  } catch (e) {
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



async function init() {
  await loadEnabledState();
  await loadCache();
  await loadBlockedCountries();
  await checkLicense(); // <--- MUST ADD THIS WAIT

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
  setInterval(processUploadQueue, UPLOAD_INTERVAL);
  // Also try to upload on page load (in case previous session left data)
  setTimeout(processUploadQueue, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
