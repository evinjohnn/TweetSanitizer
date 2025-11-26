// This script runs in the page context to access cookies and make API calls
(function () {
    // Store headers from the platform's API calls
    let platformHeaders = null;
    let headersReady = false;
    let capturedQueryId = null;
    const FALLBACK_QUERY_ID = 'zs_jFPFT78rBpXv9Z3U2YQ'; // Updated fallback ID (2025-11-25)

    // Mapping of adjectives to country/region names for "connected via" fallback
    const ADJECTIVE_TO_LOCATION = {
        'indian': 'India',
        'india': 'India',
        'american': 'United States',
        'united states': 'United States',
        'usa': 'United States',
        'european': 'Europe',
        'europe': 'Europe',
        'chinese': 'China',
        'china': 'China',
        'japanese': 'Japan',
        'japan': 'Japan',
        'korean': 'South Korea',
        'british': 'United Kingdom',
        'french': 'France',
        'german': 'Germany',
        'italian': 'Italy',
        'spanish': 'Spain',
        'russian': 'Russia',
        'brazilian': 'Brazil',
        'mexican': 'Mexico',
        'canadian': 'Canada',
        'australian': 'Australia',
        'indonesian': 'Indonesia',
        'pakistani': 'Pakistan',
        'bangladeshi': 'Bangladesh',
        'nigerian': 'Nigeria',
        'egyptian': 'Egypt',
        'turkish': 'Turkey',
        'iranian': 'Iran',
        'thai': 'Thailand',
        'vietnamese': 'Vietnam',
        'filipino': 'Philippines',
        'polish': 'Poland',
        'ukrainian': 'Ukraine',
        'argentinian': 'Argentina',
        'colombian': 'Colombia',
        'south african': 'South Africa',
        'kenyan': 'Kenya',
        'saudi': 'Saudi Arabia',
        'malaysian': 'Malaysia',
        'singaporean': 'Singapore',
        'dutch': 'Netherlands',
        'belgian': 'Belgium',
        'swedish': 'Sweden',
        'norwegian': 'Norway',
        'danish': 'Denmark',
        'finnish': 'Finland',
        'swiss': 'Switzerland',
        'austrian': 'Austria',
        'greek': 'Greece',
        'portuguese': 'Portugal',
        'czech': 'Czech Republic',
        'romanian': 'Romania',
        'hungarian': 'Hungary',
        'chilean': 'Chile',
        'peruvian': 'Peru',
        'venezuelan': 'Venezuela',
        'ecuadorian': 'Ecuador',
        'guatemalan': 'Guatemala',
        'cuban': 'Cuba',
        'dominican': 'Dominican Republic',
        'honduran': 'Honduras',
        'bolivian': 'Bolivia',
        'haitian': 'Haiti',
        'salvadoran': 'El Salvador',
        'nicaraguan': 'Nicaragua',
        'costa rican': 'Costa Rica',
        'panamanian': 'Panama',
        'uruguayan': 'Uruguay',
        'paraguayan': 'Paraguay',
        'moroccan': 'Morocco',
        'algerian': 'Algeria',
        'tunisian': 'Tunisia',
        'libyan': 'Libya',
        'sudanese': 'Sudan',
        'ethiopian': 'Ethiopia',
        'ghanaian': 'Ghana',
        'tanzanian': 'Tanzania',
        'ugandan': 'Uganda',
        'angolan': 'Angola',
        'mozambican': 'Mozambique',
        'zimbabwean': 'Zimbabwe',
        'zambian': 'Zambia',
        'senegalese': 'Senegal',
        'rwandan': 'Rwanda',
        'somali': 'Somalia',
        'iraqi': 'Iraq',
        'syrian': 'Syria',
        'lebanese': 'Lebanon',
        'jordanian': 'Jordan',
        'yemeni': 'Yemen',
        'kuwaiti': 'Kuwait',
        'emirati': 'United Arab Emirates',
        'qatari': 'Qatar',
        'bahraini': 'Bahrain',
        'omani': 'Oman',
        'israeli': 'Israel',
        'palestinian': 'Palestine',
        'afghan': 'Afghanistan',
        'nepalese': 'Nepal',
        'sri lankan': 'Sri Lanka',
        'burmese': 'Myanmar',
        'cambodian': 'Cambodia',
        'laotian': 'Laos',
        'mongolian': 'Mongolia',
        'north korean': 'North Korea',
        'taiwanese': 'Taiwan',
        'hong kong': 'Hong Kong',
        'new zealand': 'New Zealand',
        'fijian': 'Fiji',
        'papua new guinean': 'Papua New Guinea',
        'south asian': 'South Asia',
        'south asian': 'South Asia',
        'south asia': 'South Asia',
        'west asian': 'West Asia',
        'west asia': 'West Asia',
        'west european': 'Western Europe',
        'western european': 'Western Europe',
        'east european': 'Eastern Europe',
        'eastern european': 'Eastern Europe',
        'north european': 'Northern Europe',
        'northern european': 'Northern Europe',
        'south european': 'Southern Europe',
        'southern european': 'Southern Europe',
        'central european': 'Central Europe',
        'viet nam': 'Vietnam',
        'turkiye': 'Turkey',
        'cote d\'ivoire': 'Ivory Coast',
        'timor leste': 'Timor-Leste',
        'burma': 'Myanmar',
        'macao': 'Macau',
        'hongkong': 'Hong Kong'
    };

    // Helper function to parse location string against known adjectives
    function parseLocationString(text) {
        if (!text || typeof text !== 'string') return null;

        const lowerText = text.toLowerCase();
        // Try to match any adjective from our mapping
        for (const [adjective, location] of Object.entries(ADJECTIVE_TO_LOCATION)) {
            if (lowerText.includes(adjective)) {
                return location;
            }
        }
        return null;
    }

    // Helper function to extract location from "account_based_in" field (Primary)
    function extractLocationFromAccountBasedIn(data) {
        try {
            return data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in || null;
        } catch (error) {
            return null;
        }
    }

    // Helper function to extract location from "source" field (e.g. "India Android App")
    function extractLocationFromSource(data) {
        try {
            const userResult = data?.data?.user_result_by_screen_name?.result;
            if (!userResult) return null;

            const source = userResult?.about_profile?.source;
            return parseLocationString(source);
        } catch (error) {
            return null;
        }
    }

    // Helper function to extract location from "connected via" fields (legacy)
    function extractLocationFromConnectedVia(data) {
        try {
            const userResult = data?.data?.user_result_by_screen_name?.result;
            if (!userResult) return null;

            const connectedVia =
                userResult?.legacy?.connected_via ||
                userResult?.about_profile?.connected_via ||
                userResult?.connected_via;

            return parseLocationString(connectedVia);
        } catch (error) {
            return null;
        }
    }

    // Function to capture headers from a request
    function captureHeaders(headers, url) {
        if (!headers) return;

        // Extract Query ID if this is the target query
        if (url && url.includes('/AboutAccountQuery')) {
            const match = url.match(/graphql\/([^\/]+)\/AboutAccountQuery/);
            if (match && match[1]) {
                capturedQueryId = match[1];
                // Query ID captured
            }
        }

        const headerObj = {};
        if (headers instanceof Headers) {
            headers.forEach((value, key) => {
                headerObj[key] = value;
            });
        } else if (headers instanceof Object) {
            // Copy all headers
            for (const [key, value] of Object.entries(headers)) {
                headerObj[key] = value;
            }
        }

        // Replace headers completely (don't merge) to ensure we get auth tokens
        platformHeaders = headerObj;
        headersReady = true;
    }

    // Intercept fetch to capture headers
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const url = args[0];
        const options = args[1] || {};

        // If it's a GraphQL API call, capture ALL headers
        if (typeof url === 'string' && url.includes('x.com/i/api/graphql')) {
            if (options.headers) {
                captureHeaders(options.headers, url);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Also intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (this._url) {
            const headers = {};
            if (this._headers) {
                Object.assign(headers, this._headers);
            }

            // Try to capture headers from any request that looks relevant
            if (this._url.includes('x.com/i/api/') || this._url.includes('twitter.com/i/api/')) {
                captureHeaders(headers, this._url);
            }
        }
        return originalXHRSend.apply(this, args);
    };

    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (!this._headers) this._headers = {};
        this._headers[header] = value;
        return originalSetRequestHeader.apply(this, [header, value]);
    };

    // Function to mute a user
    async function muteUser(userId, screenName) {
        // console.log(`TweetSanitizer: muteUser called for ${screenName} (ID: ${userId})`);

        // Construct headers if not ready
        let headers = platformHeaders;

        if (!headers) {
            // console.log('TweetSanitizer: platformHeaders missing, constructing fallback headers');
            const csrfToken = getCookie('ct0');
            if (csrfToken) {
                headers = {
                    'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                    'x-csrf-token': csrfToken,
                    'x-twitter-active-user': 'yes',
                    'x-twitter-auth-type': 'OAuth2Session',
                    'content-type': 'application/x-www-form-urlencoded'
                };
            }
        }

        if (!headers) {
            console.error('TweetSanitizer: Cannot mute, missing headers and CSRF token');
            return;
        }

        if (!userId && !screenName) {
            console.error('TweetSanitizer: Cannot mute, missing ID and screenName');
            return;
        }

        try {
            // Use standard v1.1 endpoint for muting
            const url = 'https://x.com/i/api/1.1/mutes/users/create.json';

            // Ensure content type is correct for form data
            headers['content-type'] = 'application/x-www-form-urlencoded';

            let body;
            if (userId) {
                body = `user_id=${encodeURIComponent(userId)}`;
            } else {
                body = `screen_name=${encodeURIComponent(screenName)}`;
            }

            // console.log(`TweetSanitizer: Sending Mute request to ${url} with body: ${body}`);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: headers,
                body: body
            });

            if (response.ok) {
                // console.log(`TweetSanitizer: SUCCESSFULLY Muted user ${screenName || userId}`);
            } else {
                console.error(`TweetSanitizer: Failed to mute user ${screenName || userId}`, response.status, await response.text());
            }
        } catch (error) {
            console.error('TweetSanitizer: Error muting user', error);
        }
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    }

    // Listen for fetch requests from content script via postMessage
    window.addEventListener('message', async function (event) {
        // Only accept messages from our extension
        if (event.data) {
            if (event.data.type === '__fetchLocation') {
                const { screenName, requestId } = event.data;

                // Wait for headers to be ready
                if (!headersReady) {
                    let waitCount = 0;
                    while (!headersReady && waitCount < 30) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        waitCount++;
                    }
                }

                try {
                    const variables = JSON.stringify({ screenName });
                    const queryId = capturedQueryId || FALLBACK_QUERY_ID;
                    const url = `https://x.com/i/api/graphql/${queryId}/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

                    // Use captured headers or minimal defaults
                    const headers = platformHeaders || {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    };

                    // Ensure credentials are included
                    const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'include',
                        headers: headers,
                        referrer: window.location.href,
                        referrerPolicy: 'origin-when-cross-origin'
                    });

                    let location = null;
                    let userId = null;

                    if (response.ok) {
                        const data = await response.json();

                        // Try to extract location using our prioritized chain of methods
                        const loc1 = extractLocationFromAccountBasedIn(data);
                        const loc2 = extractLocationFromSource(data);
                        const loc3 = extractLocationFromConnectedVia(data);

                        location = loc1 || loc2 || loc3;

                        /* console.log(`TweetSanitizer: Extracted for ${screenName}:`, {
                            basedIn: loc1,
                            source: loc2,
                            connected: loc3,
                            final: location
                        }); */

                        // Extract user ID (rest_id)
                        try {
                            userId = data?.data?.user_result_by_screen_name?.result?.rest_id;
                        } catch (e) {
                            // Ignore extraction error
                        }
                    } else {
                        // Handle rate limiting
                        if (response.status === 429) {
                            const resetTime = response.headers.get('x-rate-limit-reset');
                            const waitTime = resetTime ? (new Date(parseInt(resetTime) * 1000).getTime() - Date.now()) : 0;

                            // Store rate limit info for content script
                            window.postMessage({
                                type: '__rateLimitInfo',
                                resetTime: parseInt(resetTime),
                                waitTime: Math.max(0, waitTime)
                            }, '*');
                        }
                    }

                    // Send response back to content script via postMessage
                    // Include error status so content script knows not to cache on rate limit
                    window.postMessage({
                        type: '__locationResponse',
                        screenName,
                        location,
                        userId,
                        requestId,
                        isRateLimited: response.status === 429
                    }, '*');
                } catch (error) {
                    window.postMessage({
                        type: '__locationResponse',
                        screenName,
                        location: null,
                        userId: null,
                        requestId
                    }, '*');
                }
            } else if (event.data.type === '__muteUser') {
                // console.log('TweetSanitizer: Received __muteUser message', event.data);
                const { screenName, userId } = event.data;
                muteUser(userId, screenName);
            }
        }
    });
})();
