# Changelog

All notable changes to TweetSanitizer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2025-11-25

### Fixed
- **Critical**: Updated Twitter API Query ID to current version (`zs_jFPFT78rBpXv9Z3U2YQ`)
  - This fixes the issue where flags weren't loading
  - Dynamic capture still works, but fallback ID is now correct

### Improved
- Aggressive retry logic for instant initial load
  - 3 retry attempts: 0ms, 50ms, 200ms
  - Works on page load, navigation, and Twitter logo click
- Faster MutationObserver response (50ms for initial, 200ms after)
- Eliminated all delays for first flag appearance

## [1.0.1] - 2025-11-25

### Added
- 30+ additional regional variations to prevent "location" fallback
  - Asian sub-regions: East Asia, West Asia, Central Asia, North Asia
  - European sub-regions: Western/Eastern/Northern/Southern/Central Europe
  - African sub-regions: North/South/East/West/Central Africa
  - American sub-regions: Central America, Latin America
  - Global: International
- Universal coverage across all Twitter sections
  - Profile pages
  - Comment sections
  - Notifications
  - Search results
  - User lists
  - Hover cards

### Fixed
- Edge cases where regional variations showed as "location" instead of badges
- Flags not appearing in profile sections, comments, and notifications

### Improved
- Optimized selectors to prevent memory overhead
- Added `:not([data-observed])` to prevent re-processing
- More efficient DOM querying

## [1.0.0] - 2025-11-25

### Added
- Initial release of TweetSanitizer
- Support for 100+ countries with flag emojis
- Color-coded region badges for continents
  - Africa (Gold), Antarctica (White), Asia (Yellow)
  - Australia/Oceania (Green & Gold gradient)
  - Europe (Blue), North America (Red), South America (Green)
- Adaptive scroll-based loading system
  - Initial load: 30 items in parallel with loading shimmers
  - Slow scroll: 800px margin (~10 items)
  - Normal scroll: 2000px margin (~15 items)
  - Fast scroll: 5000px margin (~30 items)
- Idle background loading
  - Loads 1 item per 3 seconds when user is reading
  - Stops at 50-item lookahead limit
  - Automatically pauses during scrolling
- Fallback location detection
  - Extracts country from "connected via" field
  - 100+ country adjective mappings
- Enhanced popup UI
  - Real-time statistics (cache count, size, status)
  - Clear cache button
  - Toggle extension on/off
  - Auto-refreshing stats every 2 seconds
- Production-grade error handling
  - Global error handler prevents extension crashes
  - Extension context validation
  - Graceful failure recovery
- Smart caching system
  - 30-day local cache
  - Automatic expiry cleanup
  - Memory-efficient storage
- Rate limit protection
  - Automatic detection and backoff
  - Adaptive request intervals
  - Burst loading with cooldown
- Priority queue system
  - Processes visible items first
  - Distance-to-viewport sorting
  - Queue size limiting (max 50)
- Privacy-focused design
  - No data collection
  - No external servers
  - All processing local
  - No console logging in production

### Technical
- Manifest V3 compliance
- Semantic versioning (1.0.0)
- Comprehensive README documentation
- Privacy policy included
- Production-ready code quality

### Performance
- Parallel initial loading (30 items)
- Scroll velocity tracking
- Dynamic rootMargin adjustment
- Catch-up mechanism for missed items
- IntersectionObserver optimization

### Security
- No sensitive API details in code
- Obfuscated internal references
- No console logging
- Extension context validation

---

## Future Releases

### [1.1.0] - Planned
- Automatic retry logic for failed requests
- Visual rate limit indicator
- Memory leak prevention enhancements
- Performance monitoring (optional)
- Custom location override feature

### [1.2.0] - Planned
- User preferences (badge style, colors)
- Export/import cache
- Advanced statistics dashboard
- Keyboard shortcuts

---

**Note**: This extension is in active development. Feature requests and bug reports are welcome!
