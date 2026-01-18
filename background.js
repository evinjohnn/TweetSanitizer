chrome.runtime.onInstalled.addListener(async (details) => {
    // --- Promo Logic: Native Flow ---
    // 1. Badge removed by user request
    // chrome.action.setBadgeText({ text: "•" });
    // chrome.action.setBadgeBackgroundColor({ color: "#FFD84D" });

    console.log("TweetSanitizer: onInstalled fired. Attempting to create notification...");

    // 2. Notification (Optional, trustworthy)
    chrome.notifications.create("tweet-sanitizer-promo", {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "Tweet Sanitizer",
        message: "Clean your timeline. Keep what matters.",
        priority: 2,
        requireInteraction: true
    }, (notificationId) => {
        if (chrome.runtime.lastError) {
            console.error("TweetSanitizer: Notification error:", chrome.runtime.lastError);
        } else {
            console.log("TweetSanitizer: Notification created with ID:", notificationId);
        }
    });

    if (details.reason === 'install') {
        // Open the onboard/settings page
        chrome.tabs.create({ url: 'https://gum.new/gum/cmihc8rnk000l04kwbr6lcfuc' });
    }
});

// --- Handle Notification Click ---
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === "tweet-sanitizer-promo") {
        // Open Popup
        chrome.action.openPopup();

        // Clear Badge
        chrome.action.setBadgeText({ text: "" });
    }
});


// --- Google Analytics 4 (Measurement Protocol) ---
const ga4mpLib = require('ga4-mp');
const ga4mp = ga4mpLib.default || ga4mpLib;

const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // TODO: Replace with your Measurement ID
const GA_API_SECRET = 'YOUR_API_SECRET';   // TODO: Replace with your API Secret

// Persistent Client ID Logic
async function getOrCreateClientId() {
    const result = await chrome.storage.local.get('client_id');
    let clientId = result.client_id;
    if (!clientId) {
        clientId = self.crypto.randomUUID();
        await chrome.storage.local.set({ client_id: clientId });
    }
    return clientId;
}

// Initialize GA4 with persistent ID
async function getGA4() {
    const clientId = await getOrCreateClientId();
    return ga4mp([GA_MEASUREMENT_ID], {
        api_secret: GA_API_SECRET,
        client_id: clientId,
        non_personalized_ads: true,
    });
}

// Track Install/Update Events
chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        const ga4 = await getGA4();
        const version = chrome.runtime.getManifest().version;

        if (details.reason === 'install') {
            // 1. Open Onboarding
            // This is already handled by the first onInstalled listener, but keeping it here for context if that one is removed.
            // chrome.tabs.create({ url: 'https://gum.new/gum/cmihc8rnk000l04kwbr6lcfuc' });

            // 2. Track Install
            await ga4.send([{
                name: 'extension_install',
                params: { version: version }
            }]);
            console.log('TweetSanitizer: Tracked install event');

        } else if (details.reason === 'update') {
            // Track Update
            await ga4.send([{
                name: 'extension_update',
                params: {
                    version: version,
                    previous_version: details.previousVersion
                }
            }]);
            console.log('TweetSanitizer: Tracked update event');
        }
    } catch (e) {
        console.error('TweetSanitizer: Analytics error', e);
    }
});

// Listen for tracking events from content scripts
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'TRACK_EVENT') {
        try {
            const ga4 = await getGA4();
            const { name, params } = message.payload;
            await ga4.send([{
                name: name,
                params: params || {},
            }]);
        } catch (e) {
            console.error('TweetSanitizer: Event tracking error', e);
        }
    }
});

// --- Background Upload Logic ---
const CLOUD_API_URL = 'https://tweet-sanitizer-api.tweetsanitizer.workers.dev';
const UPLOAD_QUEUE_KEY = 'pending_uploads';

async function processUploadQueue() {
    try {
        // 1. Get queue
        const result = await chrome.storage.local.get(UPLOAD_QUEUE_KEY);
        const queue = result[UPLOAD_QUEUE_KEY] || {};
        const usernames = Object.keys(queue);

        if (usernames.length === 0) return;

        // 2. Chunking (Max 50 items per request to avoid server reject/timeout)
        // We only take the first 50. The rest will stay in queue and trigger again later.
        const chunkUsernames = usernames.slice(0, 50);
        const payload = chunkUsernames.map(u => ({ username: u, location: queue[u] }));

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

            chunkUsernames.forEach(u => delete currentQueue[u]);

            await chrome.storage.local.set({ [UPLOAD_QUEUE_KEY]: currentQueue });
        } else {
            console.warn('TweetSanitizer (BG): Upload failed, keeping data for retry.');
        }
    } catch (e) {
        console.error('TweetSanitizer (BG): Upload error', e);
    }
}

// --- Triggers ---

// 1. Alarm (Every 10 minutes)
chrome.alarms.create('uploadAlarm', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'uploadAlarm') {
        processUploadQueue();
    }
});

// 2. Startup
chrome.runtime.onStartup.addListener(() => {
    processUploadQueue();
});

// 3. Tab Update (When opening X/Twitter)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (tab.url.includes('twitter.com') || tab.url.includes('x.com')) {
            processUploadQueue();
        }
    }
});

// 4. Queue Size (Existing)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[UPLOAD_QUEUE_KEY]) {
        const newValue = changes[UPLOAD_QUEUE_KEY].newValue || {};
        const queueSize = Object.keys(newValue).length;

        // Trigger upload if queue hits 10 or more
        if (queueSize >= 10) {
            processUploadQueue();
        }
    }
});

// --- HOVERCARD LOGIC ---

// 1. Store API Keys
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SAVE_TWITTER_HEADERS') {
        const { authorization, csrfToken } = message.payload;
        if (authorization && csrfToken) {
            chrome.storage.local.set({
                'ts_api_auth': authorization,
                'ts_api_csrf': csrfToken
            });
            // console.log('TweetSanitizer: Headers saved to storage');
        }
    }
});

// 2. Data Parsing Logic
function parseXResponse(json) {
    const result = json?.data?.user_result_by_screen_name?.result;
    if (!result) return null;

    const about = result.about_profile || {};
    const core = result.core || {};
    const verification = result.verification || {};
    const verificationInfo = result.verification_info || {};

    // 1. Parse Device/Source (e.g., "India Android App")
    let device = "Unknown";
    const sourceRaw = about.source || "";
    if (sourceRaw) {
        // Check if it contains HTML (legacy format)
        const htmlMatch = sourceRaw.match(/>(.*?)</);
        if (htmlMatch) {
            device = htmlMatch[1];
        } else {
            // Plain text format like "India Android App"
            device = sourceRaw;
        }
    }

    // 2. Parse Created Date and Calculate Days on X
    let createdAt = "Unknown";
    let daysOnX = 0;
    let createdDateObj = null;
    const createdAtRaw = core.created_at || result.legacy?.created_at;
    if (createdAtRaw) {
        try {
            createdDateObj = new Date(createdAtRaw);
            createdAt = createdDateObj.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            daysOnX = Math.floor((Date.now() - createdDateObj.getTime()) / (1000 * 60 * 60 * 24));
        } catch (e) { }
    }

    // 3. Location Accuracy (VPN/Proxy Detection)
    const locationAccurate = about.location_accurate;
    const usingVPN = locationAccurate === false;

    // 4. Created Country Accuracy
    const createdCountryAccurate = about.created_country_accurate === true;
    let createdInLocation = null;
    if (createdCountryAccurate && device) {
        // Extract country from source like "India Android App"
        const countryMatch = device.match(/^(\w+(?:\s+\w+)?)\s+(Android|iOS|Web|iPhone|iPad)/i);
        if (countryMatch) {
            createdInLocation = countryMatch[1];
        } else if (about.account_based_in) {
            createdInLocation = about.account_based_in;
        }
    }

    // 5. Username Changes
    let usernameChanges = 0;
    let lastUsernameChange = null;
    if (about.username_changes) {
        usernameChanges = parseInt(about.username_changes.count) || 0;
        if (about.username_changes.last_changed_at_msec) {
            try {
                const changeDate = new Date(parseInt(about.username_changes.last_changed_at_msec));
                lastUsernameChange = changeDate.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            } catch (e) { }
        }
    }

    // 6. All Verification Types (Separate)
    const isBlueVerified = result.is_blue_verified === true;
    const isLegacyVerified = verification.verified === true;
    const isIdentityVerified = verificationInfo.is_identity_verified === true;

    // 7. Verified Since Date
    let verifiedSince = null;
    if (verificationInfo.reason?.verified_since_msec) {
        try {
            const verifiedDate = new Date(parseInt(verificationInfo.reason.verified_since_msec));
            verifiedSince = verifiedDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) { }
    }

    // 8. Affiliation
    const affiliation = result.affiliates_highlighted_label?.label?.description || null;

    // 9. Privacy
    const isProtected = result.privacy?.protected === true;

    return {
        // Basic Info
        screenName: core.screen_name || result.legacy?.screen_name,
        name: core.name || result.legacy?.name || "",
        userId: result.rest_id,
        avatar: result.avatar?.image_url || result.legacy?.profile_image_url_https,

        // Dates
        createdAt: createdAt,
        daysOnX: daysOnX,

        // Location & Device
        location: about.account_based_in || result.legacy?.location || null,
        usingVPN: usingVPN,
        locationAccurate: locationAccurate,
        createdInLocation: createdInLocation,
        createdCountryAccurate: createdCountryAccurate,
        device: device,

        // Username Changes
        usernameChanges: usernameChanges,
        lastUsernameChange: lastUsernameChange,

        // Verification (All 3 Types)
        isBlueVerified: isBlueVerified,
        isLegacyVerified: isLegacyVerified,
        isIdentityVerified: isIdentityVerified,
        verifiedSince: verifiedSince,

        // Other
        affiliation: affiliation,
        isProtected: isProtected
    };
}

// 3. Fetch User Details
const GRAPHQL_ID = "zs_jFPFT78rBpXv9Z3U2YQ"; // Must match pageScript.js
const API_URL = "https://x.com/i/api/graphql";

async function fetchDetailedUserData(screenName) {
    try {
        const keys = await chrome.storage.local.get(['ts_api_auth', 'ts_api_csrf']);
        const auth = keys.ts_api_auth;
        const csrf = keys.ts_api_csrf;

        if (!auth || !csrf) {
            console.warn('TweetSanitizer: Missing headers for fetch');
            return null;
        }

        const variables = encodeURIComponent(JSON.stringify({ screenName }));
        const url = `${API_URL}/${GRAPHQL_ID}/AboutAccountQuery?variables=${variables}`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "authorization": auth,
                "x-csrf-token": csrf,
                "x-twitter-active-user": "yes",
                "x-twitter-auth-type": "OAuth2Session",
                "content-type": "application/json"
            }
        });

        if (!response.ok) {
            console.error('TweetSanitizer: Fetch failed', response.status);
            return null;
        }

        const json = await response.json();
        return parseXResponse(json);
    } catch (e) {
        console.error("TweetSanitizer: Fetch error", e);
        return null;
    }
}

// 4. Handle Message from Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'FETCH_USER_DETAILS') {
        fetchDetailedUserData(message.username).then(data => {
            sendResponse(data);
        });
        return true; // Keep channel open
    }
});
