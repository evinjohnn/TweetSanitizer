// pageScript.js
(function () {
    // 1. Capture Headers Logic
    let headersCaptured = false;

    function captureHeaders(headers, url) {
        if (headersCaptured) return; // Only need to capture once per session usually

        const headerObj = {};
        if (headers instanceof Headers) {
            headers.forEach((value, key) => { headerObj[key] = value; });
        } else {
            Object.assign(headerObj, headers);
        }

        // We specifically need Authorization and CSRF Token
        // Note: We use lowercase keys because frameworks/browsers normalize them
        const auth = headerObj['authorization'] || headerObj['Authorization'];
        const csrf = headerObj['x-csrf-token'] || headerObj['X-Csrf-Token'];

        if (auth && csrf) {
            headersCaptured = true;
            // Send to Content Script
            window.postMessage({
                type: 'TWITTER_HEADERS_CAPTURED',
                payload: {
                    authorization: auth,
                    csrfToken: csrf
                }
            }, '*');
            // console.log('TweetSanitizer: Headers captured and sent to extension.');
        }
    }

    // 2. Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const [url, options] = args;
        if (typeof url === 'string' && (url.includes('x.com/i/api/') || url.includes('twitter.com/i/api/'))) {
            if (options && options.headers) {
                captureHeaders(options.headers, url);
            }
        }
        return originalFetch.apply(this, args);
    };

    // 3. Intercept XHR
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._url = url;
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (!this._headers) this._headers = {};
        this._headers[header.toLowerCase()] = value;
        return originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        if (this._url && (this._url.includes('x.com/i/api/') || this._url.includes('twitter.com/i/api/'))) {
            if (this._headers) captureHeaders(this._headers, this._url);
        }
        return originalXHRSend.apply(this, arguments);
    };
})();
