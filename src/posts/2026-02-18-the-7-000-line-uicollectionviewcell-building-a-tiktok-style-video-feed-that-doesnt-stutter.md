---
title: "The 7,000-Line UICollectionViewCell: Building a TikTok-Style Video Feed
  That Doesn't Stutter"
date: 2026-02-14T00:19:00.000-05:00
excerpt: >-2
    How I built a 4-tier video caching system and a single UICollectionViewCell                                                                                                                               
    that handles playback, engagement tracking, gesture recognition, trust                                                                                                                                     
    visualization, recovery from compositor crashes, and first-frame detection
    for HLS streams - all at 60fps.
tags: []
---
  ---                                                                                                                                                                                                                                                                                                                    
                                                                                                                                                             
  *How I built a 4-tier video caching system and a single UICollectionViewCell                                                                                                                               
  that handles playback, engagement tracking, gesture recognition, trust                                                                                                                                     
  visualization, recovery from compositor crashes, and first-frame detection
  for HLS streams—all at 60fps.*

  ---

  ## The Problem

  Vertical short-form video feeds look simple. Swipe up, next video plays.
  But under the hood, it's one of the hardest UI problems in mobile
  engineering. You need:

  - Instant playback (no black frames, no buffering spinners)
  - Smooth 60fps scrolling (no dropped frames during swipe)
  - Memory efficiency (can't hold 50 AVPlayers in memory)
  - Audio exclusivity (only one cell plays at a time)
  - Graceful degradation (network drops, HLS failures, compositor crashes)
  - Engagement tracking (2-second views, watch milestones, skip detection)

  SwiftUI can't do this. I tried. The moment you put AVPlayer inside a
  SwiftUI ScrollView with paging, you get dropped frames, audio glitches,
  and layout thrashing. So I went hybrid: SwiftUI for the app shell, UIKit
  for the video feed.

  The result is a `UICollectionViewCell` subclass that grew to 7,342 lines,
  backed by a 4-tier caching system spanning 7 files and ~2,900 lines. This
  post covers how it all works and every roadblock I hit.

  ---

  ## Architecture at a Glance

  ```
┌─────────────────────────────────────────────────────────────────────┐
  │                        VIDEO FEED STACK                             │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐  │
  │  │                    SwiftUI Shell                              │  │
  │  │  HomeView → VideoFeedView (UIViewControllerRepresentable)     │  │
  │  └──────────────────────────┬────────────────────────────────────┘  │
  │                             │                                       │
  │  ┌───────────────────────────▼───────────────────────────────────┐  │
  │  │          VideoFeedViewController (UIKit, ~2,400 lines)        │  │
  │  │                                                               │  │
  │  │  • UICollectionView with vertical paging                      │  │
  │  │  • Custom snap-to-cell (decelerationRate = 0.0)               │  │
  │  │  • Loading cover with thumbnail fade                          │  │
  │  │  • Pull-to-refresh with custom header                         │  │
  │  │  • Scroll position restoration                                │  │
  │  └───────────────────────────┬───────────────────────────────────┘  │
  │                              │                                      │
  │  ┌───────────────────────────▼───────────────────────────────────┐  │
  │  │               VideoCell (UIKit, ~7,342 lines)                 │  │
  │  │                                                               │  │
  │  │  • Full-screen AVPlayer with HLS first-frame detection        │  │
  │  │  • Trust score ring, engagement buttons, scrubber             │  │
  │  │  • Gesture system (tap, double-tap, long press, swipe)        │  │
  │  │  • Engagement tracking (views, milestones, skip detection)    │  │
  │  │  • Recovery from compositor crashes and stalled playback      │  │
  │  │  • Deferred player creation (prevents -12860 errors)          │  │
  │  └───────────────────────────┬───────────────────────────────────┘  │
  │                              │                                      │
  │  ┌───────────────────────────▼───────────────────────────────────┐  │
  │  │                  4-TIER CACHING SYSTEM                        │  │
  │  │                                                               │  │
  │  │  Tier 1: VideoAssetCache (NSCache, memory, per-device limits) │  │
  │  │  Tier 2: PersistentVideoCache (disk, 500MB, SHA-256 keys)     │  │
  │  │  Tier 3: HLSPrefetchManager (warmed AVPlayers, 6 ahead)       │  │
  │  │  Tier 4: ThumbnailPrefetchManager (CDN images, 20 ahead)      │  │
  │  │                                                               │  │
  │  │  + FrozenFrameCache (live layer capture for scroll previews)  │  │
  │  │  + FirstFrameThumbnailCache (AVAssetImageGenerator at 0.1s)   │  │
  │  │  + CDNURLRewriter (S3→CloudFront, longest-prefix matching)    │  │
  │  └───────────────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────┘
```

  ---

  ## Part 1: The 4-Tier Caching System

  ### Why Four Tiers?

  A single cache can't serve every access pattern. The main feed needs
  instant playback (warm AVPlayers). The profile grid needs lightweight
  thumbnails (CDN images). Scrolling needs frozen frames (captured from
  the player layer). And everything needs a disk fallback for when the
  user scrolls back.

  Each tier is optimized for a different scenario:

  ```
┌─────────────────────────────────────────────────────────────────┐
  │                    CACHE TIER HIERARCHY                         │
  │                                                                 │
  │  REQUEST: "I need video X"                                      │
  │           │                                                     │
  │           ▼                                                     │
  │  ┌─────────────────────────────────────────────────┐            │
  │  │ TIER 1: VideoAssetCache (Memory)                │            │
  │  │ NSCache<NSURL, AVURLAsset>                      │            │
  │  │ Adaptive count limits by device RAM:            │            │
  │  │   < 4GB → 15 assets                             │            │
  │  │   4-6GB → 25 assets (iPhone 12-14)              │            │
  │  │   6-8GB → 40 assets (iPhone 15 Pro)             │            │
  │  │   8GB+  → 60 assets (iPhone 16 Pro, iPad Pro)   │            │
  │  │ Lookup: O(1), ~0ms                              │            │
  │  └──────────┬──────────────────────────────────────┘            │
  │        MISS │                                                   │
  │             ▼                                                   │
  │  ┌─────────────────────────────────────────────────┐            │
  │  │ TIER 2: PersistentVideoCache (Disk)             │            │
  │  │ LRU with SHA-256 hashed filenames               │            │
  │  │ Max: 500 MB, evicts to 400 MB (80%)             │            │
  │  │ Partial downloads: first 5 MB (~2.5s @ 1080p)   │            │
  │  │ Source-aware TTL:                               │            │
  │  │   Home feed → expires after 2 hours             │            │
  │  │   Profile/Trending → LRU eviction only          │            │
  │  │ Lookup: ~5-20ms (disk I/O)                      │            │
  │  └──────────┬──────────────────────────────────────┘            │
  │        MISS │                                                   │
  │             ▼                                                   │
  │  ┌─────────────────────────────────────────────────┐            │
  │  │ TIER 3: HLSPrefetchManager (Warmed Players)     │            │
  │  │ Pre-buffered AVPlayers ready to play instantly  │            │
  │  │ Window: 6 ahead + 4 behind = 10 total           │            │
  │  │ Buffer: 2.0s at 750kbps, 720×1280 max           │            │
  │  │ Max concurrent prefetches: 4                    │            │
  │  │ Lookup: O(1), returns playing-ready AVPlayer    │            │
  │  └──────────┬──────────────────────────────────────┘            │
  │    NO WARM  │                                                   │
  │    PLAYER   │                                                   │
  │             ▼                                                   │
  │  ┌─────────────────────────────────────────────────┐            │
  │  │ COLD START: Create AVPlayer from scratch        │            │
  │  │ Uses Tier 1/2 AVURLAsset if available           │            │
  │  │ HLS: buffer 2.0s at 750kbps                     │            │
  │  │ MP4: buffer 3.0s                                │            │
  │  │ Time to first frame: 200-800ms                  │            │
  │  └─────────────────────────────────────────────────┘            │
  │                                                                 │
  │  PARALLEL VISUAL TIERS (prevent black screens):                 │
  │  ┌─────────────────────────────────────────────────┐            │
  │  │ ThumbnailPrefetchManager: CDN images, 20 ahead  │            │
  │  │   150 images in NSCache, 30 MB limit            │            │
  │  │   3 priority tiers (immediate/nearby/far)       │            │
  │  │   12 max concurrent downloads                   │            │
  │  ├─────────────────────────────────────────────────┤            │
  │  │ FrozenFrameCache: Live player layer captures    │            │
  │  │   50 frames, 50 MB limit                        │            │
  │  │   Blank detection: 4×4 sample, 25% threshold    │            │
  │  │   JPEG compression at 80% quality               │            │
  │  │   Retries up to 8 times at 150ms intervals      │            │
  │  ├─────────────────────────────────────────────────┤            │
  │  │ FirstFrameThumbnailCache: AVAssetImageGenerator │            │
  │  │   Extracts at 0.1s (skips black intros)         │            │
  │  │   50 images, zero-tolerance time accuracy       │            │
  │  └─────────────────────────────────────────────────┘            │
  └─────────────────────────────────────────────────────────────────┘


```
  ### Tier 1: VideoAssetCache — Memory LRU

  The first layer is an `NSCache<NSURL, AVURLAsset>` singleton. Its count
  limit adapts to the device's physical RAM at init time:
```
  | Device RAM | Count Limit | Example Devices          |
  |------------|-------------|--------------------------|
  | < 4 GB     | 15          | iPhone SE, older iPads   |
  | 4–6 GB     | 25          | iPhone 12–14             |
  | 6–8 GB     | 40          | iPhone 15 Pro            |
  | 8 GB+      | 60          | iPhone 16 Pro, iPad Pro  |

```
  I deliberately set `totalCostLimit = 0` (disabled). AVURLAsset memory
  isn't easily measurable—it's a mix of internal buffers, demuxer state,
  and HTTP connection objects. Trying to assign a "cost" leads to wildly
  inaccurate eviction. Count-based limits are more predictable.

  The lookup chain inside `asset(for:)`:

  1. Check NSCache (memory hit)
  2. Check PersistentVideoCache for a local file (disk hit → promote to NSCache)
  3. Create AVURLAsset from remote URL (cache miss → store in NSCache)

  HLS URLs (`.m3u8`) are never stored in the disk cache. HLS manifests are
  text files that reference time-shifting segment URLs—caching the manifest
  leads to stale segment references that fail silently.

  ### Tier 2: PersistentVideoCache — Disk LRU with Partial Downloads

  The disk cache stores actual video bytes under SHA-256-hashed filenames
  in `Documents/VideoCache/`. The SHA-256 hash prevents collisions for
  similar URLs (e.g., same video ID with different CDN query parameters).

  The key innovation is **partial downloads**. Most videos are 10-30 MB,
  but the first 2.5 seconds of playback is typically 2-5 MB. The cache
  downloads just the first 5 MB via an HTTP Range header:

  Range: bytes=0-5242879


  When a video actually starts playing, `ensureFullDownload(for:)` upgrades
  the partial to a full download in the background. This means prefetching
  10 videos costs ~50 MB instead of ~200 MB.

  **Source-aware TTL** is the other key feature. Home feed videos expire
  after 2 hours (the feed refreshes constantly, old videos become stale).
  Profile and trending videos use LRU eviction only (users revisit these).

  ```python
  # Pseudocode for the eviction logic
  if total_size > 500 MB:
      sort entries by last_access_date (oldest first)
      while current_size > 400 MB:     # target = 80% of max
          delete oldest entry
```

  The index is a JSON file (cache_index.json) written atomically. Access
  dates are updated in memory on every lookup but NOT persisted immediately
  —the index is only saved after downloads and evictions. This avoids
  expensive disk writes on every cache hit.

  A version field (cacheVersion = 3) enables nuclear migration: if any
  entry has an older version, the entire cache directory is deleted at init.
  This is intentional—partial migration of a video cache is more complex
  than it's worth.

 ### Tier 3: HLSPrefetchManager — Warmed Players

  This is where the magic happens. Instead of caching bytes, this tier
  caches fully buffered, paused AVPlayer instances that are ready to
  play the instant the cell appears.



```
  ┌──────────────────────────────────────────────────────────────────┐
  │               HLS PREFETCH WINDOW                                │
  │                                                                  │
  │  Video index:  0   1   2   3   4   5   6   7   8   9  10  11     │
  │                                                                  │
  │  Current = 4:          ◄── 4 behind ──►│◄── 6 ahead ────────►    │
  │                        [0] [1] [2] [3] [4] [5] [6] [7] [8] [9]   │
  │                         ▲               ▲   ▲                    │
  │                         │               │   │                    │
  │                      retained        playing prefetched          │
  │                                                                  │
  │  Outside window: evicted (player.pause + replaceCurrentItem nil) │
  │                                                                  │
  │  Per warmed player:                                              │
  │    • AVPlayerItem.preferredForwardBufferDuration = 2.0s          │
  │    • AVPlayerItem.preferredPeakBitRate = 750,000 bps             │
  │    • AVPlayerItem.preferredMaximumResolution = 720×1280          │
  │    • AVPlayer.automaticallyWaitsToMinimizeStalling = false       │
  │    • Buffering verified: polls isPlaybackLikelyToKeepUp          │
  │      20 times at 100ms intervals (max 2s wait)                   │
  └──────────────────────────────────────────────────────────────────┘

```

  Each warmed player goes through a verification loop: after creation, the
  manager polls `isPlaybackLikelyToKeepUp` up to 20 times at 100ms
  intervals. Only players that pass this check within 2 seconds are stored.
  Players that time out are discarded.

  The concurrency limit is 4 simultaneous prefetches. This is the maximum
  number of concurrent HLS connections iOS allows before triggering error
  `-12860` (`AVErrorTooManyHLSConnections`). More on that error later.

  **Index update debouncing:** The first call executes immediately (so
  videos 1-6 start prefetching before the user swipes). Subsequent calls
  are debounced by 300ms to avoid thrashing during rapid scrolling.

  **Memory pressure response:** On `didReceiveMemoryWarning`, the manager
  cancels all prefetch tasks and keeps only the current and next video.
  Everything else is evicted immediately.

  ### Tier 4: ThumbnailPrefetchManager — CDN Image Cache

  While the video layers initialize, users see a static thumbnail image.
  This cache prefetches CDN thumbnail URLs with three priority tiers:

```
  | Distance from Current | Priority   | TaskPriority | Concurrent Limit   |
  |-----------------------|------------|--------------|--------------------|
  | 1–3 videos ahead      | Immediate  | .high        | Unlimited (bypass) |
  | 4–8 videos ahead      | Nearby     | .medium      | 12 max             |
  | 9+ ahead, any behind  | Far        | .utility     | 12 max             |

```
  The NSCache holds 150 images with a 30 MB `totalCostLimit` (cost =
  raw byte count of the downloaded image data). It layers on top of the
  system `URLCache` for automatic disk persistence.

  ### Supporting Caches

  **FrozenFrameCache** captures frames from the live `AVPlayerLayer` using
  `UIGraphicsImageRenderer`. This only works while the layer is in the view
  hierarchy (an HLS player layer that isn't on-screen never becomes "ready").
  It retries up to 8 times at 150ms intervals, rejecting blank frames via a
  4×4 pixel sampling algorithm (a frame is "blank" if fewer than 25% of the
  16 sampled pixels have any RGB channel above 15/255).

  **FirstFrameThumbnailCache** uses `AVAssetImageGenerator` to extract a
  frame at 0.1 seconds (skipping black intro frames). Time tolerance is
  set to zero for exact frame extraction. The 50-image NSCache is shared
  across all feed contexts.

  **CDNURLRewriter** silently rewrites legacy S3 URLs to CloudFront. It
  handles four URL patterns (two S3 bucket hosts × http/https), Supabase
  storage paths, and relative paths. The prefix array is sorted by length
  descending to prevent partial matches. A bulk `rewritingImageURLs<T:
  Codable>(in:)` method walks any Codable object graph and rewrites all
  string values whose key contains "url", "image", "thumbnail", "poster",
  "cover", "avatar", "media", or "s3".

  ---

  ## Part 2: The 7,342-Line VideoCell

  ### Why So Large?

  A full-screen video cell in a TikTok-style feed isn't just a video player.
  It's a video player + engagement tracker + gesture handler + trust score
  visualizer + scrubber + loading state machine + error recovery system +
  accessibility layer, all in a single reusable cell that must correctly
  handle being recycled hundreds of times without leaking memory or audio
  sessions.

  Here's what's inside:
```
  ┌──────────────────────────────────────────────────────────────────┐
  │                     VideoCell ANATOMY                            │
  │                                                                  │
  │  Z-ORDER (bottom to top):                                        │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │ 1. playerContainerView                                     │  │
  │  │    └─ AVPlayerLayer (resizeAspectFill, clipsToBounds)      │  │
  │  ├────────────────────────────────────────────────────────────┤  │
  │  │ 2. thumbnailImageView                                      │  │
  │  │    └─ CDN thumbnail (alpha=1 until video renders)          │  │
  │  ├────────────────────────────────────────────────────────────┤  │
  │  │ 3. overlayView (semi-transparent black, 20% opacity)       │  │
  │  │    ├─ brandLogoView (top-right, safe-area-aware)           │  │
  │  │    ├─ creatorImageView + creatorLabel + followButton       │  │
  │  │    ├─ descriptionLabel (2 lines collapsed, scrollable)     │  │
  │  │    ├─ tagsScrollView (horizontal topic chips)              │  │
  │  │    ├─ shortTimeLabel ("3m ago", cascade-scheduled timer)   │  │
  │  │    ├─ Right rail: like, dislike, comment, save, share      │  │
  │  │    ├─ menuButton (ExpandedHitButton, +16pt touch target)   │  │
  │  │    ├─ Trust ring (CAShapeLayer arc + gradient + blur)      │  │
  │  │    └─ scrubberView (bottom, 20pt height, 10Hz updates)     │  │
  │  ├────────────────────────────────────────────────────────────┤  │
  │  │ 4. playbackHUD (88×88, blur, spring-animated symbols)      │  │
  │  │ 5. pausedBadge (persistent pause icon during user pause)   │  │
  │  │ 6. confirmationToast (slide-up/down for save/like)         │  │
  │  │ 7. loadingIndicator (disabled in home feed)                │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  GESTURE RECOGNIZERS:                                            │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │ • Single tap → play/pause (requires double-tap failure)    │  │
  │  │ • Double tap → like + shield animation (110pt, spring)     │  │
  │  │ • Long press (0.4s) → video menu sheet                     │  │
  │  │ • Description tap → expand/collapse caption                │  │
  │  │ • Scrubber drag → seek with frozen frame thumbnails        │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  STATE FLAGS (20+):                                              │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │ isAttemptingPlayback, manuallyPaused, pendingAutoplay,     │  │
  │  │ didRenderFirstFrame, justSwappedItem, needsCompositorRec,  │  │
  │  │ isRefreshingPlaybackSource, isDescriptionExpanded,         │  │
  │  │ isPlayerLayerSuppressed, loadingOverlayEnabled,            │  │
  │  │ viewLogged, isCurrentlyWatching, hasTrackedVideoStarted,   │  │
  │  │ isIntroPlaceholder, hasPreloadedThumbnail, hasValidHLSURL, │  │
  │  │ isOwnContent, isCaptionDragging, hasReachedCaptionEnd...   │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  KVO OBSERVERS (7 tokens):                                       │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │ timeControlStatus, reasonForWaiting, itemStatus,           │  │
  │  │ bufferEmpty, likelyToKeepUp, loadedRanges, layerReady      │  │
  │  │ All NSKeyValueObservation (closure-based, no removeObserver)│  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  TIMERS:                                                         │
  │  ┌────────────────────────────────────────────────────────────┐  │
  │  │ watchTimeObserver (0.1s periodic, drives scrubber+tracking)│  │
  │  │ viewTimer (2s one-shot, qualified view event)              │  │
  │  │ firstFrameCheckTimer (16ms, polls AVPlayerItemVideoOutput) │  │
  │  │ renderWatchdog (1.5s one-shot, triggers recovery)          │  │
  │  │ thumbnailSwitchMonitor (16ms, thumbnail→video transition)  │  │
  │  │ relativeTimeTimer (cascading intervals: 1s→1min→1hr→1day)  │  │
  │  │ loadingShowTask (180ms debounce), loadingHideTask (50ms)   │  │
  │  └────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────┘
```

  ### The Player Lifecycle

  The most important design decision: **players are never created in
  `configure()`**. They're created in `play()`.

  This is counterintuitive. Normally you'd set up the player when the cell
  is configured. But UICollectionView calls `cellForItemAt` for cells that
  are about to become visible—sometimes 2-3 cells ahead. Creating AVPlayers
  for cells the user hasn't swiped to yet causes iOS error `-12860`
  (too many concurrent HLS connections) and wastes bandwidth.

  Instead, `configure()` stores the video URL and optional warmed player as
  deferred properties. The actual player is created only when `play()` is
  called, which happens only for the centered cell.
```
  ┌──────────────────────────────────────────────────────────────┐
  │              PLAYER CREATION DECISION TREE                   │
  │                                                              │
  │  play() called                                               │
  │  │                                                           │
  │  ├─ Player already exists and valid?                         │
  │  │  YES → Resume playback                                    │
  │  │        └─ But verify video ID matches!                    │
  │  │           (wrong-item detection via URL prefix check)     │
  │  │                                                           │
  │  ├─ Deferred warmed player available?                        │
  │  │  YES → Install warmed player (instant, pre-buffered)      │
  │  │        └─ Validate with isPlayerValid() first             │
  │  │           (checks: item exists, not failed, time not NaN) │
  │  │                                                           │
  │  ├─ Can claim from HLSPrefetchManager?                       │
  │  │  YES → Claim and install (removes from prefetch cache)    │
  │  │                                                           │
  │  └─ Cold start                                               │
  │     └─ Create AVPlayer from URL                              │
  │        ├─ HLS: buffer 2.0s, 750kbps cap, 720×1280 max        │
  │        └─ MP4: buffer 3.0s, no bitrate cap                   │
  │                                                              │
  │  After play():                                               │
  │  ├─ 200ms check: retry play() if currentTime < 0.01          │
  │  ├─ 300ms check: if audio playing but no video, force show   │
  │  │               video layer (fixes audio-without-video bug) │
  │  └─ 500ms check: if currentTime < 0.05 (stuck), destroy      │
  │                   player and recreate from scratch           │
  └──────────────────────────────────────────────────────────────┘

```
  ### Roadblock #1: `isReadyForDisplay` Lies for HLS

  Apple's `AVPlayerLayer.isReadyForDisplay` is supposed to tell you when
  the first video frame has been decoded and is ready to render. For MP4
  files, it works. For HLS streams, it fires before actual frames are
  decoded—the layer reports "ready" while still showing black.

  I wasted days debugging black screens that only appeared with HLS content.
  The fix was `AVPlayerItemVideoOutput`:

  ```swift
  // Setup: attach a video output to the player item
  let output = AVPlayerItemVideoOutput(
      pixelBufferAttributes: [AVVideoAllowWideColorKey: false]
  )
  playerItem.add(output)

  // Detection: poll at 60Hz for actual pixel data
  firstFrameCheckTimer = Timer.scheduledTimer(
      withTimeInterval: 0.016,  // 60 fps
      repeats: true
  ) { [weak self] _ in
      guard let self, let player = self.player else { return }
      if output.hasNewPixelBuffer(forItemTime: player.currentTime()) {
          self.didRenderFirstFrame = true
          self.ensureVideoLayerVisible()  // fade out thumbnail
          self.firstFrameCheckTimer?.invalidate()
      }
  }
```
  hasNewPixelBuffer(forItemTime:) returns true only when an actual decoded
  frame exists in the output buffer. No false positives. The tradeoff is
  that it requires polling (I poll at 60Hz = 16ms intervals), but it's the
  only reliable first-frame signal for HLS.

  As a safety net, a render watchdog timer fires after 1.5 seconds. If the
  player layer still isn't ready, it triggers full recovery (asset
  recreation with cache-busted URL).

  ### Roadblock #2: The Thumbnail-to-Video Transition

  The thumbnail must stay visible until the video is actually rendering.
  Fade it out too early → black flash. Fade it out too late → the user sees
  a frozen image with audio playing underneath.

  My solution is a state machine with multiple confirmation signals:
```
  ┌──────────────────────────────────────────────────────────┐
  │          THUMBNAIL → VIDEO TRANSITION                    │
  │                                                          │
  │  Initial state: thumbnail alpha = 1.0, layer opacity = 0 │
  │                                                          │
  │  Signal 1: AVPlayerItemVideoOutput.hasNewPixelBuffer     │
  │            → didRenderFirstFrame = true                  │
  │                                                          │
  │  Signal 2: playerLayer.isReadyForDisplay == true         │
  │                                                          │
  │  Signal 3: playerLayer.frame.width > 100                 │
  │            (sanity check: layer has nonzero size)        │
  │                                                          │
  │  ALL THREE TRUE → ensureVideoLayerVisible():             │
  │    CATransaction.setDisableActions(true)                 │
  │    playerLayer.opacity = 1                               │
  │    thumbnailImageView.alpha = 0                          │
  │                                                          │
  │  Safety net: thumbnailSwitchMonitor (16ms timer)         │
  │  Polls until (thumbnail hidden AND video visible),       │
  │  then self-invalidates.                                  │
  └──────────────────────────────────────────────────────────┘

```
  The CATransaction.setDisableActions(true) is critical. Without it, Core
  Animation interpolates the opacity change over 0.25 seconds, causing a
  visible cross-fade where both thumbnail and video are partially visible.
  The switch needs to be instantaneous.

 ### Roadblock #3: Audio Exclusivity Without a Singleton

  Only one cell should play audio at a time. The obvious solution is a
  global audio manager singleton. The problem: singletons create implicit
  dependencies and race conditions when cells are created and destroyed
  during rapid scrolling.

  Instead, I use notification-based muting. Before any cell calls
  player.play(), it posts .videoCellWillPlay:

  NotificationCenter.default.post(name: .videoCellWillPlay, object: self)

  Every other cell observes this notification and pauses:
```swift
  @objc private func handleOtherCellWillPlay(_ note: Notification) {
      guard note.object as? VideoCell !== self else { return }
      if isAttemptingPlayback || pendingAutoplay || player?.timeControlStatus == .playing {
          pause(userInitiated: false)
      }
  }
```
  The note.object !== self check prevents a cell from muting itself.
  This scales to any number of cells across multiple feed controllers
  without a central coordinator.

 ### Roadblock #4: The removeObserver Crash

  The classic AVPlayer crash: "cannot remove an observer that was not added"
  or "cannot remove observer added by a different AVPlayer instance." This
  happens when you call removeTimeObserver on a player that was replaced
  during cell reuse.

  I track the owning player with a weak reference:
```
  private weak var observerOwnerPlayer: AVPlayer?

  func addWatchTimeObserver() {
      let token = player?.addPeriodicTimeObserver(...)
      watchTimeObserver = token
      observerOwnerPlayer = player  // remember who owns this
  }

  func removeWatchTimeObserver() {
      guard let observer = watchTimeObserver,
            let owner = observerOwnerPlayer else { return }
      owner.removeTimeObserver(observer)  // always use the owner
      watchTimeObserver = nil
      observerOwnerPlayer = nil
  }
```
  If observerOwnerPlayer is nil (the owning player was deallocated),
  the observer was already cleaned up by ARC. No removal needed, no crash.

  For KVO, I use the closure-based observe(_:options:changeHandler:)
  API exclusively. Setting the returned NSKeyValueObservation token to
  nil automatically deregisters the observer. No manual removeObserver
  calls anywhere.

 ### Roadblock #5: Cell Reuse and the "Reel-Style" Pattern

  UICollectionView reuses cells aggressively. The standard pattern is to
  tear everything down in prepareForReuse() and rebuild in
  cellForItemAt. But for video cells, this causes a visible black flash
  during every swipe—the old player is destroyed before the new one is
  ready.

  My approach: don't destroy the player on reuse. Keep the player,
  layer, and item intact. Only reset the metadata and UI state:



```
  ┌────────────────────────────────────────────────────────────┐
  │           REUSE CLEANUP (prepareForReuse)                  │
  │                                                            │
  │  DO:                                                       │
  │  ✓ Cancel all pending tasks (loading, thumbnails, timers)  │
  │  ✓ Reset engagement state (milestones, watch time)         │
  │  ✓ Clear currentVideoID (prevents stale ID bugs)           │
  │  ✓ Reset scrubber position                                 │
  │  ✓ Set thumbnail alpha back to 1.0                         │
  │  ✓ Set all 7 KVO tokens to nil                             │
  │  ✓ Remove AVPlayerLayer sublayers                          │
  │  ✓ Unregister cold-start with HLSPrefetchManager           │
  │  ✓ Hide trust ring                                         │
  │                                                            │
  │  DO NOT:                                                   │
  │  ✗ Call player.replaceCurrentItem(with: nil)               │
  │    → This breaks the layer connection!                     │
  │  ✗ Clear thumbnail image                                   │
  │    → Old thumbnail prevents grey flash during scroll       │
  │  ✗ Set player = nil                                        │
  │    → Player is kept paused for potential reuse             │
  └────────────────────────────────────────────────────────────┘

```
  The `configure()` method has an early-return optimization: if the cell
  already has the correct `currentVideoID` and a valid player, it skips
  reconfiguration entirely. This handles the common case where
  UICollectionView asks for a cell that's already displaying the right
  video.

  ### Roadblock #6: Compositor Crashes (XPC Errors)

  On rare occasions, iOS's video compositor crashes with an XPC error
  (-12860 or -12785). The AVPlayer enters a zombie state: it reports
  `.playing` but no frames render. Audio may or may not work.

  I detect this in the `pause()` method: if `didRenderFirstFrame` is
  true but `videoOutput.hasNewPixelBuffer` returns false, the compositor
  is broken. I set `needsCompositorRecovery = true` and show the thumbnail.

  On the next tap (play attempt), recovery runs before anything else:

  ```swift
  func checkAndPerformCompositorRecovery() {
      guard needsCompositorRecovery else { return }
      needsCompositorRecovery = false

      // Nuclear option: destroy everything
      player?.pause()
      player?.replaceCurrentItem(with: nil)
      playerLayer?.removeFromSuperlayer()
      player = nil
      playerLayer = nil

      // Clear cached asset (it may be corrupted)
      if let url = deferredVideoURL {
          VideoAssetCache.shared.removeAsset(for: url)
      }

      // Recreate from scratch
      play()
  }
```

 ### Roadblock #7: The 83-Point Jump

  During a swipe gesture, the bottom safe area inset can change (e.g.,
  when the home indicator bar transitions). This causes the cell height to
  change mid-gesture, creating an 83-point "jump" in the scroll position.

  The fix: lock the cell height at gesture start and use that locked value
  for all snap calculations:
```
  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
      lockedCellHeightForCurrentGesture = cellHeight
  }

  func scrollViewWillEndDragging(...) {
      let cellHeight = lockedCellHeightForCurrentGesture ?? self.cellHeight
      // Use locked height for snap target calculation
      let currentPage = scrollView.contentOffset.y / cellHeight
      // ...
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
      lockedCellHeightForCurrentGesture = nil  // unlock
  }
```
  ---
 ### Part 3: The Feed Controller

  Custom Snap-to-Cell Pagination

  I disabled isPagingEnabled and set decelerationRate to literally zero:

  collectionView.decelerationRate = UIScrollView.DecelerationRate(rawValue: 0.0)

  This stops the scroll dead when the user lifts their finger. Then I run
  my own snap animation:
```
  func scrollViewWillEndDragging(
      _ scrollView: UIScrollView,
      withVelocity velocity: CGPoint,
      targetContentOffset: UnsafeMutablePointer<CGPoint>
  ) {
      // Cancel system deceleration
      targetContentOffset.pointee = scrollView.contentOffset

      // Calculate snap target
      let page = scrollView.contentOffset.y / cellHeight
      let target: Int
      if abs(velocity.y) > 0.3 {
          target = velocity.y > 0 ? Int(ceil(page)) : Int(floor(page))
      } else {
          target = Int(round(page))
      }

      // Linear animation (not spring—springs feel sluggish for paging)
      let distance = abs(targetOffset - scrollView.contentOffset.y)
      let duration = min(max(distance / cellHeight * 0.15, 0.1), 0.3)

      UIView.animate(
          withDuration: duration,
          delay: 0,
          options: [.curveLinear, .allowUserInteraction]
      ) {
          scrollView.contentOffset.y = targetOffset
      }
  }
```
  The velocity threshold of 0.3 determines whether a swipe "commits" to the
  next video or snaps back. The animation duration scales linearly with
  distance (0.15 seconds per cell height), clamped between 0.1s and 0.3s.
  This feels instant without being jarring.

  The allTrackedCells Pattern

  UICollectionView.visibleCells only returns cells currently on screen.
  But I need to pause cells that have scrolled off-screen and are sitting
  in UIKit's internal reuse pool. My solution:

  private let allTrackedCells = NSHashTable<VideoCell>.weakObjects()

  Every cell dequeued in cellForItemAt is added to this hash table. The
  weak references mean cells in the reuse pool don't get retained. But
  they're still reachable for pauseAllPlayers():

  func pauseAllPlayers() {
      for cell in allTrackedCells.allObjects {
          if cell.isPlaying { cell.pause(userInitiated: false) }
      }
  }

  This catches the edge case where a playing cell scrolls off-screen, enters
  the reuse pool, but hasn't been reconfigured yet—its audio would continue
  playing in the background without this.

  Engagement Tracking
```
  ┌──────────────────────────────────────────────────────────────┐
  │              ENGAGEMENT TRACKING PIPELINE                    │
  │                                                              │
  │  Cell becomes visible                                        │
  │  │                                                           │
  │  ├─ Impression (300ms debounce, ≥60% visible)                │
  │  │   └─ Fires once per video per session                     │
  │  │                                                           │
  │  ├─ play() called                                            │
  │  │   └─ Start 2-second view timer                            │
  │  │                                                           │
  │  ├─ 2 seconds elapsed + still playing                        │
  │  │   └─ Qualified view event (POST /videos/track_view)       │
  │  │      └─ Fires once per video (viewLogged = true)          │
  │  │                                                           │
  │  ├─ Periodic observer (every 0.1s):                          │
  │  │   ├─ Update scrubber position                             │
  │  │   ├─ Compute completionPercentage                         │
  │  │   └─ Check milestones:                                    │
  │  │       ├─ 25% → track event                                │
  │  │       ├─ 50% → track event                                │
  │  │       ├─ 75% → track event                                │
  │  │       └─ 95% → track event (not 100%, avoids rounding)    │
  │  │                                                           │
  │  ├─ Cell disappears with < 80% watched                       │
  │  │   └─ Track skip event                                     │
  │  │                                                           │
  │  └─ Cell disappears (always):                                │
  │      └─ POST /videos/track_engagement                        │
  │         { watch_time, completion%, milestones,               │
  │           replay_count, has_skipped, buffer_duration }       │
  └──────────────────────────────────────────────────────────────┘
```

  The milestone set tracks which thresholds have already fired to prevent
  duplicates during looped playback. Buffer stall duration is tracked
  separately: `bufferingStartTime` is set when `.AVPlayerItemPlaybackStalled`
  fires, and the duration is computed when `isPlaybackLikelyToKeepUp`
  becomes true again.

  ---

  ## Part 4: The Relative Time Optimization

  Small detail, but worth mentioning. The "3m ago" time label uses a
  cascade of single-fire timers instead of a fixed-interval repeating timer:
```
  | Elapsed Time     | Timer Interval                 | Updates Per Hour |
  |------------------|--------------------------------|------------------|
  | < 1 minute       | 1 second                       | 3,600            |
  | 1–60 minutes     | Next minute boundary (min 10s) | 60               |
  | 1–24 hours       | Next hour boundary (min 60s)   | 24               |
  | 1–7 days         | Next day boundary (min 600s)   | ~3               |
  | 7–30 days        | Next week boundary (min 1800s) | ~1               |
  | > 30 days        | Next month boundary (min 3600s)| < 1              |
```

  A video posted 3 hours ago updates once per hour. A video posted 2 days
  ago updates once per day. A repeating 1-second timer for all cells would
  fire 10 times/second across 10 visible cells—600 timer fires per minute
  for text that changes once per hour.

  ---

  ## The Numbers
```
  | Component                    | Lines       | Files  |
  |------------------------------|-------------|--------|
  | VideoCell                    | 7,342       | 1      |
  | VideoFeedViewController      | 2,400       | 1      |
  | TopicVideoFeedController     | 1,800       | 1      |
  | VideoAssetCache              | 354         | 1      |
  | PersistentVideoCache         | 708         | 1      |
  | HLSPrefetchManager           | 634         | 1      |
  | VideoPrefetchManager         | 358         | 1      |
  | ThumbnailPrefetchManager     | 303         | 1      |
  | FrozenFrameCache             | 302         | 1      |
  | FirstFrameThumbnailCache     | 252         | 1      |
  | CDNURLRewriter               | 200         | 1      |
  | NetworkVideoPlayer           | 200         | 1      |
  | **Total**                    | **~14,853** | **12** |


  | Metric                               | Value                   |
  |--------------------------------------|-------------------------|
  | KVO observers per cell               | 7                       |
  | Timers per cell                      | 7 (concurrent max)      |
  | State flags per cell                 | 20+                     |
  | Gesture recognizers per cell         | 4                       |
  | Disk cache max                       | 500 MB                  |
  | Memory cache (adaptive)              | 15–60 AVURLAssets       |
  | HLS prefetch window                  | 10 videos (6+4)         |
  | Thumbnail prefetch window            | 28 images (20+8)        |
  | Frozen frame max                     | 50 frames (50 MB)       |
  | Scrubber update frequency            | 10 Hz                   |
  | First-frame detection frequency      | 60 Hz                   |
  | Qualified view threshold             | 2 seconds               |
  | Watch milestones                     | 25%, 50%, 75%, 95%      |
  | Render watchdog timeout              | 1.5 seconds             |
  | Max recovery attempts                | 3                       |
  | Snap animation duration              | 0.1–0.3 seconds         |

```
  ---

  ## What I'd Do Differently

  1. **Break up VideoCell.** 7,342 lines is too large. The engagement
     tracker, gesture handler, trust ring, and player lifecycle should be
     separate objects composed inside the cell. I kept them together for
     shipping speed, but testability and readability suffered.

  2. **Use AVQueuePlayer.** Instead of creating a new player per video, an
     AVQueuePlayer can preload the next item while the current one plays.
     This would eliminate cold-start latency entirely for sequential viewing.
     I avoided it because queue management during rapid scrolling is complex,
     but it's the right long-term architecture.

  3. **Move to async/await for cache coordination.** The caching system uses
     three different concurrency models (GCD, @MainActor, NSLock). Unifying
     on Swift structured concurrency would reduce the surface area for race
     conditions.

  4. **Implement adaptive bitrate based on scroll behavior.** Currently,
     prefetched videos always cap at 750kbps. A smarter system would detect
     fast scrollers (who skip 80% of videos) and reduce prefetch quality,
     then increase quality for slow scrollers who watch most videos.

  ---

  *This was a first for me in designing Swift UI interface for a video player and I hope I did a good job. I'm open to requests for the codebase, you can contact me at my email sanjjayrj@gmail.com*

  ---
