# TweetSanitizer v2.0

A powerful Chrome extension that enhances your Twitter/X experience by displaying country flags and region badges next to usernames. Now with Pro features for advanced control.

![Version](https://img.shields.io/badge/version-2.0.0-blue)


## ✨ What's New in v2.0

### 💎 Pro License System
- **Monthly & Lifetime Plans**: Unlock advanced features with flexible pricing.
- **Cloudflare Integration**: Secure, server-side license verification.
- **Instant Activation**: Enter your key and unlock Pro features immediately without reloading.

### 🎨 Premium UI Redesign
- **Apple-Inspired Aesthetic**: Clean, modern interface with San Francisco typography.
- **Card-Based Layout**: Organized, easy-to-use settings.
- **Polished Interactions**: Smooth transitions, soft shadows, and high-contrast buttons.

### 🛡️ Advanced Security & Logic
- **Smart Retry System**: Intelligent handling of API rate limits (429 errors) with exponential backoff (5s -> 10s -> 30s).
- **Hybrid Batch-Sync Architecture**: Combines direct API calls for speed with Cloudflare batch processing for efficiency.
- **Security Gate**: Robust server-side checks ensure Pro features are only accessible to valid license holders.

---

## 🚀 Core Features

### 🌍 Comprehensive Location Support
- **100+ Countries**: Full support for country flag emojis.
- **Region Badges**: Color-coded badges for continents (Europe, Asia, Americas, etc.).
- **Fallback Detection**: Smartly extracts location from bio and "connected via" fields.

### ⚡ Smart Performance
- **Adaptive Loading**: Adjusts strategy based on scroll speed (Direct vs. Hybrid).
- **Idle Background Loading**: Pre-loads content while you read.
- **Intelligent Caching**: 30-day local cache minimizes API usage.

### 🔒 Privacy-Focused
- **Local Processing**: Data stays in your browser.
- **No Tracking**: Zero analytics or telemetry.

---

## 🎮 Usage

1. **Install** from Chrome Web Store.
2. **Browse Twitter/X**: Flags appear automatically.
3. **Open Popup**:
   - **Free Tier**: View stats, clear cache, toggle extension.
   - **Pro Tier**: Unlock "Block Countries" and "Auto-Mute".

### Pro Features (Locked)
- **Block Countries**: Hide tweets from specific countries entirely.
- **Auto-Mute**: Automatically mute users from blocked regions (Legacy/Experimental).

---

## 🔧 Technical Details

- **Manifest V3**: Built on the latest secure extension standard.
- **Cloudflare Workers**: Handles license verification and batch location lookups.
- **LemonSqueezy**: Secure payment processing for Pro licenses.

## 🔐 Permissions Justification

| Permission | Purpose |
| :--- | :--- |
| `storage` | Required to save user settings (Pro license key, blocked countries, whitelist) and cache location data locally. |
| `alarms` | Used to schedule a periodic background task (every 10 minutes) that syncs pending, locally cached public location data to the extension's database. This ensures data consistency without impacting browser performance. |
| `host_permissions` | - `x.com` / `twitter.com`: To display flags on the website.<br>- `tweet-sanitizer-api...`: To verify licenses and fetch location data. |

## 🔄 Changelog

### Version 2.0.0 (2025-11-26)
- **Major**: Implemented Pro License System (Monthly/Lifetime).
- **Major**: Complete Premium UI Overhaul.
- **Feature**: Smart Retry Logic for 429 errors.
- **Feature**: Hybrid Batch-Sync Architecture.
- **Feature**: Cloudflare Worker Integration.
- **Improvement**: Enhanced error handling and rate limit protection.

### Version 1.0.0 (2025-11-25)
- Initial release.

## 👨‍💻 Author
**Evin John**
- Email: evynjohnignatious@gmail.com


