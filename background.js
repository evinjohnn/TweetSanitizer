chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Open the onboard/settings page
        chrome.tabs.create({ url: 'https://tweetsanitizer.com/welcome' });
    }
});

// --- Background Upload Logic ---
const CLOUD_API_URL = 'https://tweet-sanitizer-api.tweet-sanitizer.workers.dev';
const UPLOAD_QUEUE_KEY = 'pending_uploads';

async function processUploadQueue() {
    try {
        // 1. Get queue
        const result = await chrome.storage.local.get(UPLOAD_QUEUE_KEY);
        const queue = result[UPLOAD_QUEUE_KEY] || {};
        const usernames = Object.keys(queue);

        if (usernames.length === 0) return;

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
        } else {
            console.warn('TweetSanitizer (BG): Upload failed, keeping data for retry.');
        }
    } catch (e) {
        console.error('TweetSanitizer (BG): Upload error', e);
    }
}

// Listen for queue changes
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
