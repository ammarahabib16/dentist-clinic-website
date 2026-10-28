(function () {
  'use strict';

  // â”€â”€â”€ Sequence Configurations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The hero is one scroll-scrubbed video. Hero-Section-compressed-scrub.mp4 is
  // a 720p scrub encode with a keyframe every 0.2s and faststart enabled; the
  // original compressed source stays on disk for rollback. Narrow viewports
  // keep the first-frame poster because the optimized file still trails fast
  // mobile scrolls by
  // roughly a quarter second. Remove this guard to opt mobile into video.
  const HERO_VIDEO_STATIC_QUERY = '(max-width: 768px)';
  const HERO_VIDEO_FPS = 30;
  const HERO_VIDEO_END_PAD = 1 / HERO_VIDEO_FPS;
  const HERO_SEEK_EPSILON = 0.02;

  // The clinic scene is also one scroll-scrubbed video now. The encode keeps
  // a keyframe every 0.2s for fast reverse seeking and has no audio track.
  // Narrow viewports keep the poster because video seeking trails fast mobile
  // scrolls; the old frame sequence stays on disk for rollback.
  const CLINIC_VIDEO_STATIC_QUERY = '(max-width: 768px)';
  const CLINIC_VIDEO_FPS = 30;
  const CLINIC_VIDEO_END_PAD = 1 / CLINIC_VIDEO_FPS;
  const CLINIC_SEEK_EPSILON = 0.02;
  // A seek that jumps several seconds can take longer than a frame or two in
  // a cold decoder. This is a genuine-stall guard, not a frame budget.
  const CLINIC_SEEK_TIMEOUT = 2500;

  // The water-flosser sequence behind the doctor cards. 180 frames at
  // 1280x720, 2.6 MB combined. It is never part of the initial page load.
  const DENTIST_WATER_FRAMES = 180;
  const DENTIST_WATER_DIR = 'water-flosser-jpg';
  const DENTIST_WATER_KEYFRAME_STEP = 6;
  const DENTIST_WATER_MAX_INFLIGHT = 4;
  const DENTIST_WATER_LERP = 0.16;

  // DOM Elements
  const heroSection = document.getElementById('hero-section');
  const heroMedia = document.getElementById('hero-media');
  const heroVideo = document.getElementById('hero-video');
  const heroContent = document.getElementById('hero-content');
  const heroScrollPrompt = document.getElementById('hero-scroll-prompt');

  const clinicSection = document.getElementById('clinic-section');
  const clinicMedia = document.getElementById('clinic-media');
  const clinicVideo = document.getElementById('clinic-video');
  const clinicViewport = clinicSection ? clinicSection.querySelector('.sticky-viewport') : null;
  const clinicOverlay = document.getElementById('clinic-overlay');
  const clinicBloom = document.getElementById('clinic-bloom');

  // Phase 3: Dental Services section (additive â€” nothing above changes)
  const servicesSection = document.getElementById('services-section');
  const svcBloom = document.getElementById('svc-bloom');
  const svcEyebrow = document.querySelector('.services-eyebrow');
  const svcTitle = document.getElementById('services-heading');
  const svcDesc = document.querySelector('.services-desc');
  // The four cards, cached once: the scroll-linked horizontal drift writes
  // to them on every frame the panel is crossing the viewport.
  const svcCards = servicesSection
    ? Array.prototype.slice.call(servicesSection.querySelectorAll('.service-card'))
    : [];

  // Phase 4: Visit Our Clinic section (additive â€” plain flow below services)
  const locationSection = document.getElementById('location-section');

  // Phase 5: Meet Your Dentist section (additive â€” plain flow between services and location)
  const dentistSection = document.getElementById('dentist-section');
  const dentistFlosserCanvas = document.getElementById('dentist-flosser-canvas');
  const dentistFlosserCtx = dentistFlosserCanvas ? dentistFlosserCanvas.getContext('2d') : null;

  // Progressive enhancement: entrance initial-states (CSS `html.js-anim`)
  // are only active when scripting runs AND the user has not requested
  // reduced motion â€” otherwise all content keeps its visible default.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
document.documentElement.classList.add('js');
    if (!motionQuery.matches) document.documentElement.classList.add('js-anim');

  const navbar = document.getElementById('navbar');

  // Lenis is a progressive enhancement for wheel input only. It runs on the
  // same requestAnimationFrame loop as the rest of the page (autoRaf stays
  // off), leaves touch scrolling native, and is never created when reduced
  // motion is requested. If the vendor file fails to load, every caller falls
  // back to the browser's native scrolling.
  let lenis = null;

  function initLenis() {
    if (lenis || motionQuery.matches) return;
    if (typeof window.Lenis !== 'function') return;
    try {
      lenis = new window.Lenis({
        autoRaf: false,
        smoothWheel: true,
        syncTouch: false,
        anchors: false,
        lerp: 0.15,
        wheelMultiplier: 1,
        touchMultiplier: 1,
        respectReducedMotion: true,
        prevent: (node) => !!(node && node.closest &&
          node.closest('dialog, [data-lenis-prevent]'))
      });
    } catch (err) {
      lenis = null;
    }
  }

  function destroyLenis() {
    if (!lenis) return;
    lenis.destroy();
    lenis = null;
  }

  // Hero video scrub state. Seeks are serialised: scroll updates only change
  // heroProgress; one rAF-coalesced seek is in flight at a time, and the next
  // one is issued from `seeked` if the target moved again.
  let heroProgress = 0;
  let heroVideoDuration = 0;
  let heroVideoReady = false;
  let heroVideoEnabled = false;
  let heroVideoFailed = false;
  let heroVideoSeeking = false;
  let heroVideoSeekScheduled = false;
  let heroVideoLastSeekTime = -1;
  let heroVideoListenersBound = false;
  let heroVideoSeekTimeout = 0;
  let heroVideoWarmed = false;
  let heroVideoWarming = false;
  let heroVideoWarmStep = 0;

  // Clinic video scrub state, deliberately separate from the hero so the
  // existing hero path stays untouched. The same serialised-seek contract
  // applies: scroll stores progress, then at most one seek is in flight.
  let clinicProgress = 0;
  let clinicVideoDuration = 0;
  let clinicVideoReady = false;
  let clinicVideoEnabled = false;
  let clinicVideoFailed = false;
  let clinicVideoSeeking = false;
  let clinicVideoSeekScheduled = false;
  let clinicVideoLastSeekTime = -1;
  let clinicVideoListenersBound = false;
  let clinicVideoSeekTimeout = 0;

  // Dentist water-flosser cache and lazy loader. The state array avoids
  // duplicate requests and lets the current scroll position jump the queue.
  const dentistWaterFrames = new Array(DENTIST_WATER_FRAMES);
  const dentistWaterState = new Array(DENTIST_WATER_FRAMES).fill(0);
  const dentistWaterPriority = [];
  const dentistWaterFill = [];
  let dentistWaterTarget = 0;
  let dentistWaterCurrent = 0;
  let dentistWaterLastRendered = -1;
  let dentistWaterNear = false;
  let dentistWaterStarted = false;
  let dentistWaterInFlight = 0;

  const padZero = (n) => String(n).padStart(3, '0');
  const getDentistWaterPath = (i) => `${DENTIST_WATER_DIR}/ezgif-frame-${padZero(i + 1)}.jpg`;

  // â”€â”€â”€ Canvas Sizing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€ Cover Fit Drawing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€ Nearest Loaded Frame Fallbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€ Render Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€ Hero Video Scrub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A single paused video is driven by scroll position. We never autoplay:
  // each scroll frame updates heroProgress, and at most one rAF-coalesced seek
  // is in flight. When that seek lands, `seeked` issues the next one only if
  // the target has moved, so a fast scroll cannot queue dozens of stale seeks.
  function onHeroVideoMetadata() {
    heroVideoDuration = Number.isFinite(heroVideo.duration) ? heroVideo.duration : 0;
    if (heroVideoDuration <= 0) {
      onHeroVideoError();
      return;
    }
    if (!heroVideoReady) scheduleHeroVideoUpdate();
  }

  function onHeroVideoReady() {
    if (!heroMedia || heroVideoFailed || !heroVideoEnabled || motionQuery.matches) return;
    if (!heroVideoReady) {
      heroVideoReady = true;
      if (!heroVideoWarmed) {
        warmHeroVideo();
        return;
      }
      heroMedia.classList.add('is-video-ready');
    }
    scheduleHeroVideoUpdate();
  }

  // A paused MP4 has no decoder allocated until the first non-zero seek. If
  // that seek happens on the user's first scroll, it costs one long decode
  // (200ms+ cold) exactly when the hero is supposed to start moving. Warm the
  // decoder behind the poster, then return to frame zero before revealing it.
  function warmHeroVideo() {
    if (heroVideoWarming || heroVideoWarmed || !heroVideoReady || heroVideoDuration <= 0) return;
    heroVideoWarming = true;
    heroVideoWarmStep = 0;
    heroVideoSeeking = true;
    heroVideoSeekTimeout = setTimeout(() => {
      heroVideoSeekTimeout = 0;
      if (!heroVideoWarming) return;
      heroVideoWarming = false;
      heroVideoSeeking = false;
      onHeroVideoError();
    }, 1200);
    // 0.2s is the first GOP boundary in the scrub encode. It is far enough
    // from zero that the return seek below is guaranteed to fire `seeked`.
    const warmTarget = Math.min(0.2, heroVideoDuration - HERO_VIDEO_END_PAD);
    try {
      heroVideo.currentTime = warmTarget;
    } catch (error) {
      heroVideoWarming = false;
      heroVideoSeeking = false;
      onHeroVideoError();
    }
  }

  function onHeroVideoError() {
    if (heroVideoFailed) return;
    heroVideoFailed = true;
    heroVideoEnabled = false;
    heroVideoReady = false;
    heroVideoSeeking = false;
    heroVideoWarming = false;
    heroVideoWarmStep = 0;
    if (heroVideoSeekTimeout) {
      clearTimeout(heroVideoSeekTimeout);
      heroVideoSeekTimeout = 0;
    }
    if (heroMedia) {
      heroMedia.classList.remove('is-video-ready');
      heroMedia.classList.add('hero-video-failed');
    }
  }

  function onHeroVideoSeeked() {
    if (heroVideoSeekTimeout) {
      clearTimeout(heroVideoSeekTimeout);
      heroVideoSeekTimeout = 0;
    }
    heroVideoSeeking = false;
    if (heroVideoWarming) {
      if (heroVideoWarmStep === 0) {
        heroVideoWarmStep = 1;
        heroVideoSeeking = true;
        heroVideoSeekTimeout = setTimeout(() => {
          heroVideoSeekTimeout = 0;
          if (!heroVideoWarming) return;
          heroVideoWarming = false;
          heroVideoSeeking = false;
          onHeroVideoError();
        }, 1200);
        try {
          heroVideo.currentTime = 0;
        } catch (error) {
          heroVideoWarming = false;
          heroVideoSeeking = false;
          onHeroVideoError();
        }
        return;
      }
      heroVideoWarming = false;
      heroVideoWarmed = true;
      heroVideoLastSeekTime = 0;
      if (heroMedia) heroMedia.classList.add('is-video-ready');
      scheduleHeroVideoUpdate();
      return;
    }
    scheduleHeroVideoUpdate();
  }

  function scheduleHeroVideoUpdate() {
    if (!heroVideoEnabled || heroVideoFailed || !heroVideoReady || heroVideoDuration <= 0) return;
    if (heroVideoSeeking || heroVideoSeekScheduled) return;

    heroVideoSeekScheduled = true;
    requestAnimationFrame(() => {
      heroVideoSeekScheduled = false;
      if (!heroVideoEnabled || heroVideoFailed || !heroVideoReady || heroVideoSeeking) return;

      const lastFrameTime = Math.max(0, heroVideoDuration - HERO_VIDEO_END_PAD);
      const target = Math.min(Math.max(heroProgress * lastFrameTime, 0), lastFrameTime);
      if (Math.abs(target - heroVideoLastSeekTime) < HERO_SEEK_EPSILON) return;
      if (Math.abs(target - heroVideo.currentTime) < HERO_SEEK_EPSILON) {
        heroVideoLastSeekTime = target;
        return;
      }

      heroVideoSeeking = true;
      heroVideoLastSeekTime = target;
      heroVideoSeekTimeout = setTimeout(() => {
        heroVideoSeekTimeout = 0;
        if (!heroVideoSeeking) return;
        heroVideoSeeking = false;
        onHeroVideoError();
      }, 1200);

      try {
        heroVideo.currentTime = target;
      } catch (error) {
        heroVideoSeeking = false;
        if (heroVideoSeekTimeout) {
          clearTimeout(heroVideoSeekTimeout);
          heroVideoSeekTimeout = 0;
        }
        onHeroVideoError();
      }
    });
  }

  function startHeroVideo() {
    if (!heroVideo || !heroMedia || heroVideoFailed) return;
    if (motionQuery.matches) return;

    heroVideoEnabled = true;
    if (!heroVideoListenersBound) {
      heroVideoListenersBound = true;
      heroVideo.addEventListener('loadedmetadata', onHeroVideoMetadata);
      heroVideo.addEventListener('loadeddata', onHeroVideoReady);
      heroVideo.addEventListener('canplay', onHeroVideoReady);
      heroVideo.addEventListener('error', onHeroVideoError);
      heroVideo.addEventListener('seeking', () => { heroVideoSeeking = true; });
      heroVideo.addEventListener('seeked', onHeroVideoSeeked);
    }

    if (!heroVideo.getAttribute('src')) {
      const src = heroVideo.getAttribute('data-src');
      if (!src) {
        onHeroVideoError();
        return;
      }
      heroVideo.muted = true;
      heroVideo.playsInline = true;
      heroVideo.preload = 'metadata';
      heroVideo.src = src;
      heroVideo.load();
    } else if (heroVideoReady) {
      if (!heroVideoWarmed) {
        warmHeroVideo();
        return;
      }
      heroMedia.classList.add('is-video-ready');
      scheduleHeroVideoUpdate();
    }
  }

  function stopHeroVideo() {
    heroVideoEnabled = false;
    heroVideoSeeking = false;
    if (heroVideoWarming) {
      heroVideoWarming = false;
      heroVideoWarmed = false;
      heroVideoWarmStep = 0;
    }
    if (heroVideoSeekTimeout) {
      clearTimeout(heroVideoSeekTimeout);
      heroVideoSeekTimeout = 0;
    }
    if (heroVideo) heroVideo.pause();
    if (heroMedia) heroMedia.classList.remove('is-video-ready');
  }

  function initHeroVideo() {
    if (!heroVideo || !heroMedia) return;
    const staticWidth = window.matchMedia(HERO_VIDEO_STATIC_QUERY);
    if (!motionQuery.matches && !staticWidth.matches) startHeroVideo();
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (motionQuery.matches) {
          stopHeroVideo();
        } else if (!staticWidth.matches) {
          startHeroVideo();
        }
      });
    }
    if (typeof staticWidth.addEventListener === 'function') {
      staticWidth.addEventListener('change', () => {
        if (staticWidth.matches) {
          stopHeroVideo();
        } else if (!motionQuery.matches) {
          startHeroVideo();
        }
      });
    }
  }

  // ─── Clinic Video Scrub ────────────────────────────────────────────────
  // The clinic uses the same paused-video contract as the hero, but with its
  // own state and timeline. Scroll progress is held at 0 through the bridge,
  // then maps the unchanged clinic pin range across the video. One seek is in
  // flight at a time; `seeked` only asks for another if scroll moved again.
  function onClinicVideoMetadata() {
    clinicVideoDuration = Number.isFinite(clinicVideo.duration) ? clinicVideo.duration : 0;
    if (clinicVideoDuration <= 0) {
      onClinicVideoError();
      return;
    }
    if (!clinicVideoReady) scheduleClinicVideoUpdate();
  }

  function onClinicVideoReady() {
    if (!clinicMedia || clinicVideoFailed || !clinicVideoEnabled || motionQuery.matches) return;
    if (!clinicVideoReady) {
      clinicVideoReady = true;
      clinicMedia.classList.add('is-video-ready');
    }
    scheduleClinicVideoUpdate();
  }

  function onClinicVideoError() {
    if (clinicVideoFailed) return;
    clinicVideoFailed = true;
    clinicVideoEnabled = false;
    clinicVideoReady = false;
    clinicVideoSeeking = false;
    if (clinicVideoSeekTimeout) {
      clearTimeout(clinicVideoSeekTimeout);
      clinicVideoSeekTimeout = 0;
    }
    if (clinicMedia) {
      clinicMedia.classList.remove('is-video-ready');
      clinicMedia.classList.add('clinic-video-failed');
    }
  }

  function onClinicVideoSeeked() {
    if (clinicVideoSeekTimeout) {
      clearTimeout(clinicVideoSeekTimeout);
      clinicVideoSeekTimeout = 0;
    }
    clinicVideoSeeking = false;
    scheduleClinicVideoUpdate();
  }

  function scheduleClinicVideoUpdate() {
    if (!clinicVideoEnabled || clinicVideoFailed || !clinicVideoReady || clinicVideoDuration <= 0) return;
    if (clinicVideoSeeking || clinicVideoSeekScheduled) return;

    clinicVideoSeekScheduled = true;
    requestAnimationFrame(() => {
      clinicVideoSeekScheduled = false;
      if (!clinicVideoEnabled || clinicVideoFailed || !clinicVideoReady || clinicVideoSeeking) return;

      const lastFrameTime = Math.max(0, clinicVideoDuration - CLINIC_VIDEO_END_PAD);
      const target = Math.min(Math.max(clinicProgress * lastFrameTime, 0), lastFrameTime);
      if (Math.abs(target - clinicVideoLastSeekTime) < CLINIC_SEEK_EPSILON) return;
      if (Math.abs(target - clinicVideo.currentTime) < CLINIC_SEEK_EPSILON) {
        clinicVideoLastSeekTime = target;
        return;
      }

      clinicVideoSeeking = true;
      clinicVideoLastSeekTime = target;
      clinicVideoSeekTimeout = setTimeout(() => {
        clinicVideoSeekTimeout = 0;
        if (!clinicVideoSeeking) return;
        clinicVideoSeeking = false;
        onClinicVideoError();
      }, CLINIC_SEEK_TIMEOUT);

      try {
        clinicVideo.currentTime = target;
      } catch (error) {
        clinicVideoSeeking = false;
        if (clinicVideoSeekTimeout) {
          clearTimeout(clinicVideoSeekTimeout);
          clinicVideoSeekTimeout = 0;
        }
        onClinicVideoError();
      }
    });
  }

  function startClinicVideo() {
    if (!clinicVideo || !clinicMedia || clinicVideoFailed || clinicVideoEnabled) return;
    if (motionQuery.matches) return;

    clinicVideoEnabled = true;
    if (!clinicVideoListenersBound) {
      clinicVideoListenersBound = true;
      clinicVideo.addEventListener('loadedmetadata', onClinicVideoMetadata);
      clinicVideo.addEventListener('loadeddata', onClinicVideoReady);
      clinicVideo.addEventListener('canplay', onClinicVideoReady);
      clinicVideo.addEventListener('error', onClinicVideoError);
      clinicVideo.addEventListener('seeking', () => { clinicVideoSeeking = true; });
      clinicVideo.addEventListener('seeked', onClinicVideoSeeked);
    }

    if (!clinicVideo.getAttribute('src')) {
      const src = clinicVideo.getAttribute('data-src');
      if (!src) {
        onClinicVideoError();
        return;
      }
      clinicVideo.muted = true;
      clinicVideo.playsInline = true;
      clinicVideo.preload = 'metadata';
      clinicVideo.src = src;
      clinicVideo.load();
    } else if (clinicVideoReady) {
      clinicMedia.classList.add('is-video-ready');
      scheduleClinicVideoUpdate();
    }
  }

  function stopClinicVideo() {
    clinicVideoEnabled = false;
    clinicVideoSeeking = false;
    if (clinicVideoSeekTimeout) {
      clearTimeout(clinicVideoSeekTimeout);
      clinicVideoSeekTimeout = 0;
    }
    if (clinicVideo) clinicVideo.pause();
    if (clinicMedia) clinicMedia.classList.remove('is-video-ready');
  }

  function initClinicVideo() {
    if (!clinicVideo || !clinicMedia) return;
    const staticWidth = window.matchMedia(CLINIC_VIDEO_STATIC_QUERY);
    if (!motionQuery.matches && !staticWidth.matches) startClinicVideo();
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (motionQuery.matches) {
          stopClinicVideo();
        } else if (!staticWidth.matches) {
          startClinicVideo();
        }
      });
    }
    if (typeof staticWidth.addEventListener === 'function') {
      staticWidth.addEventListener('change', () => {
        if (staticWidth.matches) {
          stopClinicVideo();
        } else if (!motionQuery.matches) {
          startClinicVideo();
        }
      });
    }
  }

  // â”€â”€â”€ Cinematic Bridge Metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The hero and clinic sequences are two halves of one camera journey that
  // meet on the "hand-held tooth" beat: the hero dollies into the tooth, the
  // clinic pulls back from it. The bridge overlaps their sticky viewports for
  // one viewport-height of scroll and cross-dissolves a matched dolly between
  // them, so the page reads as one continuous shot instead of a hard wipe.
  // Every value is measured from the live layout (never hard-coded) so the
  // bridge always aligns with the native sticky pinning ranges â€” including
  // mobile URL-bar resizes â€” and stays fully reversible while scrolling.
  let heroDocTop = 0;
  let clinicDocTop = 0;
  let bridgeStart = 0;    // scroll where the clinic viewport pins â†’ dissolve begins
  let bridgeEnd = 0;      // scroll where the hero viewport unpins â†’ dissolve ends
  let bridgeDist = 1;
  let heroScrubDist = 1;  // scroll distance over which the hero frames play
  let clinicScrubStart = 0;
  let clinicScrubDist = 1;
  // The bridge settles to 0 before the first frame and to 1 before the
  // services hand-off, so most scroll positions recompute an unchanged value.
  // Remembering the last applied t avoids re-writing five styles per frame.
  let lastBridgeT = -1;

  function measureBridge() {
    const vh = window.innerHeight;

    heroDocTop = heroSection ? heroSection.offsetTop : 0;
    const heroBottom = heroSection
      ? heroDocTop + heroSection.offsetHeight
      : heroDocTop + vh * 6.2;

    clinicDocTop = clinicSection ? clinicSection.offsetTop : heroBottom - vh * 2;
    const clinicBottom = clinicSection
      ? clinicDocTop + clinicSection.offsetHeight
      : clinicDocTop + vh * 6.2;

    // The clinic viewport pins exactly where the hero viewport is still
    // pinned; the hero unpins one viewport-height later. That overlap is
    // the bridge window.
    bridgeStart = clinicDocTop;
    bridgeEnd = heroBottom - vh;
    if (bridgeEnd <= bridgeStart) bridgeEnd = bridgeStart + vh;
    bridgeDist = bridgeEnd - bridgeStart;

    // Hero frames play up to the bridge, then hold on their final frame.
    heroScrubDist = Math.max(1, bridgeStart - heroDocTop);
    // Clinic video holds on its opening frame through the bridge, then
    // scrubs across its own pin range at the original pacing.
    clinicScrubStart = bridgeEnd;
    clinicScrubDist = Math.max(1, clinicBottom - vh - bridgeEnd);
    lastBridgeT = -1;
  }

  // â”€â”€â”€ Cinematic Bridge Driver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A pure function of scroll position â†’ deterministic and reversible.
  // Hero: final frame holds with a gentle dolly-in (continues its approach).
  // Clinic: opening frame settles from a slight push (the camera arrives),
  // while a soft light bloom carries the eye across the match-cut on the
  // tooth (bare hand â†’ gloved hands).
  function updateSectionBridge(scrollTop) {
    const t = bridgeDist > 0
      ? Math.min(Math.max((scrollTop - bridgeStart) / bridgeDist, 0), 1)
      : 0;

    // t is clamped at both ends. Once the bridge has settled (or not started)
    // every scroll computed the same styles; leave the existing style
    // declarations alone instead of invalidating the layer each frame.
    if (t === lastBridgeT) return;
    lastBridgeT = t;

    const dissolve = t * t * (3 - 2 * t);   // smoothstep cross-fade
    const settle = 1 - Math.pow(1 - t, 3);  // ease-out cubic settle

    if (heroMedia) {
      heroMedia.style.transform = t > 0
        ? `scale(${(1 + 0.055 * t * t).toFixed(4)})`
        : '';
    }
    if (clinicMedia) {
      clinicMedia.style.transform = t > 0
        ? `scale(${(1.09 - 0.09 * settle).toFixed(4)})`
        : '';
    }
    if (clinicViewport) {
      clinicViewport.style.opacity = dissolve.toFixed(3);
      // Fully inert until nearly opaque, so the pinned clinic layer can
      // never swallow clicks meant for the hero UI beneath it.
      clinicViewport.style.pointerEvents = dissolve > 0.92 ? 'auto' : 'none';
    }
    if (clinicOverlay) {
      const ui = Math.min(Math.max((t - 0.35) / 0.65, 0), 1);
      clinicOverlay.style.opacity = (ui * ui * (3 - 2 * ui)).toFixed(3);
    }
    if (clinicBloom) {
      clinicBloom.style.opacity = (0.34 * Math.sin(Math.PI * t)).toFixed(3);
    }
  }

  // â”€â”€â”€ Phase 3: Clinic â†’ Services Hand-off â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // #services-section is pulled up âˆ’200vh, so its top crosses the viewport
  // exactly during the LAST 100vh of the clinic scrub â€” the same scroll span
  // that ends where the clinic viewport unpins. Within that window the
  // clinic scene keeps travelling through its final frames while it pushes
  // in and dissolves behind a restrained white bloom; the white services
  // page rises underneath and its header reveals in sync with the camera's
  // arrival. Every value is a pure function of scroll â†’ deterministic and
  // fully reversible, exactly like the hero â†’ clinic bridge.
  //
  // NOTE: three of the outgoing values (viewport opacity, pointer-events,
  // media push-in) live on elements the hero â†’ clinic bridge ALSO writes
  // each frame, and that bridge runs first â€” so those are re-composed on
  // every scroll event. Values my code owns alone (bloom, header) are
  // memoised, so outside the hand-off window the new code writes nothing.
  let svcStart = 0;      // scroll at which the services top reaches the fold
  let svcEnd = 0;        // scroll at which the clinic viewport unpins
  let svcDist = 1;
  let svcHandoff = false; // true only while the two sections actually overlap
  let lastSvcT = -1;     // memoised hand-off progress (âˆ’1 forces a rewrite)

  function measureServicesTransition() {
    const vh = window.innerHeight;
    const clinicBottom = clinicSection
      ? clinicSection.offsetTop + clinicSection.offsetHeight
      : 0;
    svcStart = servicesSection ? servicesSection.offsetTop : clinicBottom;
    svcEnd = clinicBottom - vh;          // = clinic unpin = clinic scrub end
    svcDist = svcEnd - svcStart;
    // Phase 16: the panel is pulled up −200vh again (see the section's CSS),
    // so it shares its first viewport of scroll with the clinic's last one and
    // svcDist comes out at exactly one viewport: the dissolve window opens the
    // moment the section's top reaches the viewport and closes where the clinic
    // unpins. The footage is already pinned underneath by then and the copy is
    // still a viewport below the fold, so the window reveals footage only —
    // the copy then rises into it after the dissolve. If a future layout drops
    // the pull-up, svcDist goes negative and the whole hand-off disarms itself.
    svcHandoff = svcDist > 0;
    if (!svcHandoff) svcDist = 1;        // never divide by zero
    lastSvcT = -1;                       // re-apply styles after re-layout
  }

  function setSvcHeader(uLabel, uTitle, uDesc) {
    const apply = (el, u) => {
      if (!el) return;
      el.style.opacity = u.toFixed(3);
      el.style.transform = `translateY(${((1 - u) * 26).toFixed(1)}px)`;
    };
    apply(svcEyebrow, uLabel);
    apply(svcTitle, uTitle);
    apply(svcDesc, uDesc);
  }

  function clearSvcHeader() {
    [svcEyebrow, svcTitle, svcDesc].forEach((el) => {
      if (!el) return;
      el.style.opacity = '';
      el.style.transform = '';
    });
  }

  function updateServicesTransition(scrollTop) {
    if (!clinicViewport || !servicesSection || !svcHandoff) return;

    const t = Math.min(Math.max((scrollTop - svcStart) / svcDist, 0), 1);
    const fade = t * t * (3 - 2 * t);            // smoothstep wash-out
    const reduced = motionQuery.matches;

    // â”€â”€ Shared elements: only while the hand-off is running does my
    //    composed value differ from the bridge's â€” outside it the bridge's
    //    own value is already correct, so this function writes nothing.
    if (fade > 0) {
      // Derive the bridge's own opacity from scroll instead of reading it
      // back from the DOM. The bridge is memoised and no longer rewrites its
      // settled value, so reading the composed style would multiply the
      // previous frame's fade into the next one.
      const bridgeT = bridgeDist > 0
        ? Math.min(Math.max((scrollTop - bridgeStart) / bridgeDist, 0), 1)
        : 0;
      const bridgeOpacity = bridgeT * bridgeT * (3 - 2 * bridgeT);
      const composedStr = (bridgeOpacity * (1 - fade)).toFixed(3);
      if (clinicViewport.style.opacity !== composedStr) {
        clinicViewport.style.opacity = composedStr;
      }
      // The scene must never swallow clicks meant for the services page once
      // it starts to clear (the bridge would keep re-enabling them).
      if (clinicViewport.style.pointerEvents !== 'none') {
        clinicViewport.style.pointerEvents = 'none';
      }
      // Camera keeps travelling: the clinic pushes in as it dissolves â€” the
      // same 0 â†’ 1.055 dolly character as the hero â†’ clinic bridge. The
      // bridge rewrites this every frame, so it is re-asserted each event.
      if (!reduced && clinicMedia) {
        const pushStr = `scale(${(1 + 0.055 * t * t).toFixed(4)})`;
        if (clinicMedia.style.transform !== pushStr) {
          clinicMedia.style.transform = pushStr;
        }
      }
    }

    // â”€â”€ Owned values: memoised â€” zero style writes outside the window.
    if (t === lastSvcT) return;
    lastSvcT = t;

    // Restrained white bloom â€” peaks mid-hand-off and returns to exactly 0
    // when the clinic is gone, so it never veils the finished page.
    if (svcBloom) {
      svcBloom.style.opacity =
        t > 0 && !reduced ? (0.45 * Math.sin(Math.PI * t)).toFixed(3) : '0';
    }

    if (t <= 0) {
      if (reduced) clearSvcHeader();
      else setSvcHeader(0, 0, 0);
      return;
    }
    if (reduced) {
      // Motion-free path: the essential fade above still reveals the page,
      // so the header simply arrives with it.
      setSvcHeader(1, 1, 1);
      return;
    }

    // Header reveals in sync with the camera arrival: label â†’ heading â†’
    // description, each finishing before the window closes.
    const reveal = (start) => {
      const u = Math.min(Math.max((t - start) / 0.5, 0), 1);
      return u * u * (3 - 2 * u);
    };
    setSvcHeader(reveal(0.3), reveal(0.4), reveal(0.5));
  }

  // In-page anchors: the navbar's "Services" link points at the section's own
  // id, but since Phase 16 that id sits two viewports above the finished panel
  // - its first screen is the cross-dissolve (still covered by the clinic) and
  // its second is the footage alone. So Services aims two screens past the
  // section's top, which is exactly the composed panel: heading under the
  // navbar, four cards up, the dentist one screen below. Every other hash
  // target keeps its normal document-top landing. The links themselves are
  // left alone - same href, same hash, same history entry, and they still work
  // with JS off. Only the scroll is routed through Lenis when it is active;
  // otherwise the browser's native scroll is used. Modifier clicks are left to
  // the browser so open-in-new-tab and friends keep working.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target && event.target.closest
      ? event.target.closest('a[href]')
      : null;
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '#' || href === '#') return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const top = Math.max(0, Math.round(
      id === 'services-section' && servicesSection
        ? servicesSection.offsetTop + window.innerHeight * 2
        : target.getBoundingClientRect().top + (window.pageYOffset || 0)
    ));
    history.pushState(null, '', href);
    if (lenis) {
      lenis.scrollTo(top, { immediate: motionQuery.matches });
    } else if (motionQuery.matches) {
      // `behavior: 'auto'` still obeys the stylesheet's scroll-behavior:
      // smooth, so temporarily force an instant native jump instead.
      const root = document.documentElement;
      const previous = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(0, top);
      root.style.scrollBehavior = previous;
    } else {
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });

  // --- Services header reveal: one-shot, self-cleaning --------------------
  // The eyebrow, heading and description rise in once, the first time they
  // enter the viewport, staggered by their own --hd delays. The cards no
  // longer share this observer: their sequence is tied to scroll position
  // below. With reduced motion or no IntersectionObserver everything is
  // simply shown immediately.
  function initServicesReveal() {
    if (!servicesSection) return;
    const headItems = Array.prototype.slice.call(
      servicesSection.querySelectorAll('.services-anim')
    );
    if (!headItems.length) return;

    if (motionQuery.matches || typeof IntersectionObserver === 'undefined') {
      headItems.forEach((el) => el.classList.add('is-in'));
      return;
    }

    let revealed = 0;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
        revealed += 1;
      });
      if (revealed >= headItems.length) observer.disconnect();
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    headItems.forEach((el) => observer.observe(el));
  }

  // --- Services card sequence: scroll-linked, one card at a time ----------
  // Each card's reveal is a pure function of where that card sits on the
  // screen, so the sequence follows the layout instead of a fixed scroll
  // distance: four across on a desktop, 2x2 on a tablet, a stack on a phone,
  // and every card always reveals while it is actually in view.
  //
  //   t = 0   the card's trigger point is 95% down the viewport (entering)
  //   t = 1   it has risen 18% of the viewport (comfortably in view)
  //
  // Cards that share a row start at the same height, so each one is pushed
  // further down the trigger line by --step: that is what turns one row into
  // four separate moments, left to right. The row-index offset is used, not
  // the card index, so on a stacked phone layout the cards simply follow
  // their own positions, top to bottom, with no artificial delay.
  //
  // The last card has fully arrived by the time the panel settles (panel top
  // 0), so landing here from the nav bridge never shows a half-revealed row.
  // Progress is read straight from scroll, so the motion is smooth and
  // reversible before it completes; once a card reaches 1 it is latched
  // visible for the rest of the visit and never animates again.
  //
  // The hidden state is added only after this module has taken over
  // (html.js-anim.svc-seq), so no JS, reduced motion, a failed init or a
  // stalled frame loop all leave four readable, clickable cards behind. The
  // guard shows everything if the sequence never receives a frame.
  const SVC_REVEAL_LEAD = 0.95;   // trigger line, in viewport heights
  const SVC_REVEAL_SPAN = 0.18;   // scroll one card takes to arrive
  const SVC_REVEAL_STEP = 0.13;   // extra lead per card sharing a row
  const svcSeq = { latched: [], frames: 0, active: false };
  let svcCardOffsets = [];        // each card's static offset inside the copy block
  const svcInner = servicesSection
    ? servicesSection.querySelector('.services-inner')
    : null;

  // A card's own getBoundingClientRect() moves with the reveal transform this
  // module writes, so reading it would feed the animation back into its own
  // trigger and make the sequence jump. The offsets inside the (untransformed)
  // copy block are measured once per layout instead, then combined with that
  // block's live position on screen.
  function offsetIn(el, root) {
    let y = 0;
    let node = el;
    while (node && node !== root) {
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return y;
  }

  function measureCardOffsets() {
    if (!svcCards.length || !svcInner) return;
    svcCardOffsets = svcCards.map((card) => offsetIn(card, svcInner));
  }

  function revealAllCards() {
    svcCards.forEach((card, i) => {
      card.classList.add('is-visible');
      card.style.opacity = '1';
      card.style.transform = 'none';
      svcSeq.latched[i] = true;
    });
    document.documentElement.classList.remove('svc-seq');
  }

  function updateServicesSequence() {
    if (!svcSeq.active || !svcCards.length) return;
    if (svcSeq.latched.every(Boolean)) return;
    svcSeq.frames += 1;

    const vh = window.innerHeight;
    const lead = SVC_REVEAL_LEAD * vh;
    const span = Math.max(1, SVC_REVEAL_SPAN * vh);
    const step = SVC_REVEAL_STEP * vh;

    const grid = svcCards[0].parentElement;
    if (!grid || !svcInner) return;
    if (svcCardOffsets.length !== svcCards.length) measureCardOffsets();

    // Read every position first, then write: one layout pass per frame.
    const anchorTop = svcInner.getBoundingClientRect().top;
    const tops = svcCardOffsets.map((offset) => anchorTop + offset);

    // Position within its visual row (0 for the leftmost card of a row, and
    // 0 again for the first card of the next row on a wrapped layout).
    const rowIndex = tops.map((top, i) => {
      let k = 0;
      for (let j = 0; j < i; j++) {
        if (Math.abs(tops[j] - top) < 8) k += 1;
      }
      return k;
    });

    for (let i = 0; i < svcCards.length; i++) {
      if (svcSeq.latched[i]) continue;
      const t = Math.min(
        Math.max((lead - tops[i] - rowIndex[i] * step) / span, 0),
        1
      );
      if (t <= 0) continue;                  // still waiting its turn

      const eased = t * t * (3 - 2 * t);     // smoothstep: no abrupt starts
      const card = svcCards[i];
      card.style.opacity = eased.toFixed(3);
      card.style.transform =
        'translateY(' + ((1 - eased) * 28).toFixed(2) + 'px) scale(' +
        (0.965 + eased * 0.035).toFixed(4) + ')';

      if (t >= 1) {                          // latch: it never animates again
        card.style.opacity = '1';
        card.style.transform = 'none';
        card.classList.add('is-visible');
        svcSeq.latched[i] = true;
      }
    }
  }

  function initServicesSequence() {
    if (!servicesSection || !svcCards.length) return;
    svcSeq.latched = svcCards.map(() => false);

    if (motionQuery.matches) {               // no scroll-dependent hiding
      revealAllCards();
      return;
    }

    svcSeq.active = true;
    document.documentElement.classList.add('svc-seq');
    measureCardOffsets();
    updateServicesSequence();                // correct state on a mid-page reload
    svcSeq.frames = 0;                       // the guard counts loop frames only

    // Safety net: if the scroll loop never touches the sequence while the
    // cards are on screen, show everything rather than strand them. It never
    // fires once the sequence has done any work, and never when a frame has
    // been processed.
    const guard = () => {
      if (svcSeq.frames !== 0 || svcSeq.latched.some(Boolean)) {
        window.removeEventListener('scroll', guard);
        return;
      }
      const vh = window.innerHeight;
      if (svcCards.some((card) => card.getBoundingClientRect().top < vh)) {
        revealAllCards();
        window.removeEventListener('scroll', guard);
      }
    };
    window.setTimeout(guard, 2000);
    window.addEventListener('scroll', guard, { passive: true });
  }

  // --- Services footage backdrop -----------------------------------------
  // The supplied clip is muted, looping and purely decorative, so it is wired
  // here only for the two things the markup cannot do on its own. One: the
  // browser defers autoplay for a video that is still screens below the fold,
  // so playback is started by hand the first time the section is really on
  // screen. Two: decoding stops again whenever the section leaves the
  // viewport, which keeps a video from competing with the hero and clinic
  // canvases while nobody is looking at it. The element keeps its
  // autoplay/muted/loop/playsinline attributes, so with JS switched off the
  // clip still loops by itself, and a rejected play() (data not ready, policy
  // block) is swallowed on purpose: the layer is decoration, and the poster
  // surface sits behind it either way. Reduced motion never plays it at all -
  // the stylesheet removes the video element, leaving the poster frame.
  function initServicesFootage() {
    const footage = servicesSection && servicesSection.querySelector('.services-footage');
    if (!footage) return;

    const play = () => {
      const started = footage.play();
      if (started && typeof started.catch === 'function') started.catch(() => {});
    };
    const pause = () => {
      if (!footage.paused) footage.pause();
    };

    if (motionQuery.matches) {
      pause();
      return;
    }

    // No IntersectionObserver: hand the loop back to the browser's own
    // autoplay rather than leaving the section with a still.
    if (typeof IntersectionObserver === 'undefined') {
      play();
      return;
    }

    let onScreen = false;
    // Phase 16: start the clip roughly half a screen before the panel can be
    // seen (and stop it as far past it again). By the time the first pixels
    // reach the viewport the loop is already running, so the entry never opens
    // on a frozen poster frame and nothing pops when playback takes over.
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        onScreen = entry.isIntersecting;
        if (onScreen) play();
        else pause();
      });
    }, { rootMargin: '45% 0px 45% 0px' });
    observer.observe(footage);

    // A visitor can switch motion back on while the section is already in view,
    // which the observer would never re-report, so replay it from here. The
    // card sequence follows the same switch: turning motion off mid-visit
    // shows every card at once instead of leaving a scroll-dependent state.
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (motionQuery.matches) {
          svcSeq.active = false;
          revealAllCards();
          pause();
        } else if (onScreen) {
          play();
        }
      });
    }
  }

  // â”€â”€â”€ Location Section Reveal â€” one-shot, self-cleaning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The section is observed once; on first intersection it gains
  // .is-visible and the info card / map pair staggers in via CSS (--d).
  // The class is never removed, so scrolling back cannot replay it, and the
  // observer disconnects immediately after firing. Reduced motion or no
  // IntersectionObserver support â†’ the section is simply shown (the hidden
  // state is js-anim gated anyway).
  function initLocationReveal() {
    if (!locationSection) return;
    const show = () => locationSection.classList.add('is-visible');
    if (motionQuery.matches || typeof IntersectionObserver === 'undefined') {
      show();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show();
        observer.disconnect();
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -10% 0px' });
    observer.observe(locationSection);
  }

  // --- Footer: the copyright year ----------------------------------------
  // The markup already carries a correct year, so this is a pure upgrade:
  // without JS the visitor still sees a sensible footer, and with JS the year
  // can never go stale. No observer, no listener, nothing to clean up.
  function initFooterYear() {
    const slot = document.querySelector('.site-footer-year[data-year]');
    if (!slot) return;
    const year = String(new Date().getFullYear());
    if (slot.textContent.trim() !== year) slot.textContent = year;
  }

  // --- Footer: lazy, muted background video -------------------------------
  // The footage is decorative and only fetched once the footer approaches the
  // viewport. The solid footer ground is the fallback until a frame is actually
  // playing, and reduced-motion visitors never request the file at all.
  function initFooterVideo() {
    const footer = document.querySelector('.site-footer');
    const video = footer ? footer.querySelector('.site-footer-video') : null;
    if (!footer || !video) return;

    const src = video.getAttribute('data-src');
    if (!src) return;

    let loaded = false;
    let loading = false;
    let failed = false;

    const hide = () => footer.classList.remove('footer-video-on');

    const start = () => {
      if (!loaded || failed || motionQuery.matches) return;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(hide);
      }
    };

    const load = () => {
      if (loaded || loading || failed || motionQuery.matches) return;
      loading = true;
      video.src = src;
      video.load();
    };

    video.addEventListener('loadeddata', () => {
      loading = false;
      loaded = true;
      start();
    }, { once: true });

    video.addEventListener('playing', () => {
      if (!motionQuery.matches) footer.classList.add('footer-video-on');
    });

    video.addEventListener('error', () => {
      loading = false;
      failed = true;
      hide();
      video.removeAttribute('src');
      video.load();
    }, { once: true });

    const isNear = () => {
      const rect = footer.getBoundingClientRect();
      return rect.top < window.innerHeight + 300 && rect.bottom > -300;
    };

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            if (loaded) video.pause();
            return;
          }
          if (motionQuery.matches || failed) return;
          if (!loaded) load();
          else start();
        });
      }, { rootMargin: '300px 0px' });
      observer.observe(footer);
    } else if (!motionQuery.matches) {
      load();
    }

    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (motionQuery.matches) {
          video.pause();
          hide();
        } else if (isNear()) {
          if (!loaded && !failed) load();
          else start();
        }
      });
    }
  }

  // --- Book Appointment dialog -------------------------------------------
  // One booking surface for the whole page: the navbar's "Book Visit" CTA and
  // each service card's "Book Treatment" link carry data-book-open and all open
  // this same native <dialog>, so there is exactly one modal implementation
  // (the two doctor profiles use the same pattern).
  //
  // The WhatsApp hand-off deliberately reuses the clinic's existing number: it
  // is read off the site's own tel: link instead of being typed in here, so the
  // two can never drift apart and no number is invented. The links keep their
  // real href, and only a plain left click is intercepted — modifier clicks, and
  // JS switched off, still follow the link the markup points at.
  function initAppointmentDialog() {
    const dialog = document.getElementById('appointment-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return;

    const form = dialog.querySelector('#appointment-form');
    const submit = dialog.querySelector('#appt-submit');
    const submitText = dialog.querySelector('.appointment-submit-text');
    if (!form || !submit || !submitText) return;

    const fields = {
      name: dialog.querySelector('#appt-name'),
      phone: dialog.querySelector('#appt-phone'),
      procedure: dialog.querySelector('#appt-procedure')
    };
    const errors = {
      name: dialog.querySelector('#appt-name-error'),
      phone: dialog.querySelector('#appt-phone-error'),
      procedure: dialog.querySelector('#appt-procedure-error')
    };

    // The clinic's own number, straight from the first tel: link on the page.
    const tel = document.querySelector('a[href^="tel:"]');
    const waNumber = ((tel && tel.getAttribute('href')) || '').replace(/[^\d]/g, '');

    const REST_LABEL = submitText.textContent;
    const BUSY_LABEL = 'Opening WhatsApp\u2026';
    const BUSY_MS = 650; // long enough to read the state, short enough not to annoy
    let busy = false;

    // --- 1. Opening --------------------------------------------------------
    Array.prototype.forEach.call(document.querySelectorAll('[data-book-open]'), (btn) => {
      btn.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (dialog.open) return;
        dialog.showModal();
        document.documentElement.classList.add('appt-open');
      });
    });

    // --- 2. Closing --------------------------------------------------------
    // ESC, a backdrop click and the close button all end in close(), and the
    // CSS transition animates every one of those paths identically.
    const close = () => { if (dialog.open) dialog.close(); };
    const closeBtn = dialog.querySelector('[data-appt-close]');
    if (closeBtn) closeBtn.addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('appt-open');
      clearErrors();
    });

    // --- 3. Errors ---------------------------------------------------------
    function clearError(key) {
      const field = fields[key];
      const slot = errors[key];
      if (!field || !slot) return;
      field.removeAttribute('aria-invalid');
      slot.textContent = '';
      slot.hidden = true;
    }

    function clearErrors() {
      Object.keys(fields).forEach(clearError);
    }

    function setError(key, message) {
      const field = fields[key];
      const slot = errors[key];
      if (!field || !slot) return;
      field.setAttribute('aria-invalid', 'true');
      slot.textContent = message;
      slot.hidden = false;
    }

    // Never nag: a field that has been corrected stops being marked as wrong
    // the moment it is edited.
    Object.keys(fields).forEach((key) => {
      const field = fields[key];
      if (!field) return;
      field.addEventListener('input', () => clearError(key));
      field.addEventListener('change', () => clearError(key));
    });

    // --- 4. Validation -----------------------------------------------------
    // 0334 1234567, 03341234567, +92 334 1234567 and 0092 334 1234567 are all
    // the same number. Anything else is rejected before WhatsApp is opened.
    function normalisePhone(raw) {
      const digits = String(raw || '').replace(/[^\d]/g, '');
      if (digits.length < 10) return '';
      if (digits.indexOf('0092') === 0) return digits.slice(2);
      if (digits.indexOf('92') === 0) return digits;
      if (digits.charAt(0) === '0') return '92' + digits.slice(1);
      if (digits.length === 10 && digits.charAt(0) === '3') return '92' + digits;
      return digits;
    }

    function prettyPhone(international) {
      if (!/^92\d{10}$/.test(international)) return international;
      return '+' + international.slice(0, 2) + ' ' + international.slice(2, 5) + ' ' + international.slice(5);
    }

    function validate() {
      clearErrors();
      let firstBad = null;
      const mark = (key, message) => {
        setError(key, message);
        if (!firstBad) firstBad = fields[key];
      };

      const name = fields.name ? fields.name.value.replace(/\s+/g, ' ').trim() : '';
      if (!name) mark('name', 'Please enter the patient\u2019s name.');
      else if (name.length < 2) mark('name', 'That name looks too short.');

      const rawPhone = fields.phone ? fields.phone.value.trim() : '';
      const phone = normalisePhone(rawPhone);
      if (!rawPhone) mark('phone', 'Please enter a phone number.');
      else if (!/^92\d{10}$/.test(phone)) mark('phone', 'Enter a valid number, e.g. 0334 1234567.');

      const procedure = fields.procedure ? fields.procedure.value : '';
      if (!procedure) mark('procedure', 'Please choose a procedure.');

      return { ok: !firstBad, firstBad, name, phone, procedure };
    }

    // --- 5. The WhatsApp hand-off ------------------------------------------
    function buildMessage(v) {
      return [
        'Hello Dr. Syed Hashim Jamshed Bukhari Dental Clinic,',
        'I would like to request an appointment.',
        '',
        'Name: ' + v.name,
        'Phone: ' + prettyPhone(v.phone),
        'Procedure: ' + v.procedure
      ].join('\n');
    }

    function setBusy(on) {
      busy = on;
      submit.classList.toggle('is-loading', on);
      submit.setAttribute('aria-busy', on ? 'true' : 'false');
      submitText.textContent = on ? BUSY_LABEL : REST_LABEL;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;

      const v = validate();
      if (!v.ok) {
        if (v.firstBad) v.firstBad.focus();
        return;
      }
      if (!waNumber) {
        setError('phone', 'Online booking is unavailable right now \u2014 please call the clinic.');
        return;
      }

      // The tab is opened here, while the click is still the active gesture, so
      // no popup blocker can fire; it is pointed at WhatsApp once the loading
      // state has been seen. If the browser refused the tab, the same URL is
      // followed in this one — either way the visitor ends up in WhatsApp.
      let win = null;
      try { win = window.open('', '_blank'); } catch (err) { win = null; }
      if (win) { try { win.opener = null; } catch (err) { /* nothing to do */ } }

      setBusy(true);
      const url = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(buildMessage(v));

      window.setTimeout(() => {
        if (win && !win.closed) win.location.href = url;
        else window.location.href = url;
        window.setTimeout(() => setBusy(false), 1200);
      }, BUSY_MS);
    });
  }

  // --- Dentist Section: the 3D carousel, its arrival and its dialogs -----
  // Mirrors initLocationReveal() for the reveal itself: the section is
  // observed once, gains .is-visible on first intersection (the header and the
  // two panes stagger in via CSS --d), never replays on reverse scroll, and
  // the observer disconnects immediately. Reduced motion, no JS or no
  // IntersectionObserver -> the section is simply shown (the hidden states are
  // js-anim gated anyway, and reduced motion also flattens the carousel into
  // two readable cards).
  //
  // Four jobs, in order:
  //   1. dialogs  - wired unconditionally, so a reduced-motion visitor still
  //      gets a working View Profile button;
  //   2. carousel - one pane in front, one behind; the indicators, a click on
  //      the pane behind, a horizontal swipe and the arrow keys all bring a
  //      doctor forward, with a small smoke accent on the pane that arrives;
  //   3. continuous drift - .is-awake is toggled while the section is on
  //      screen, which is what runs the slow plumes; off screen they are
  //      display:none, so they cost nothing while reading another section;
  //   4. the one-shot arrival - the Z flight, the landing settle and the smoke
  //      burst that fires as each card reaches its destination.
  function initDentistReveal() {
    if (!dentistSection) return;
    const carousel = dentistSection.querySelector('[data-dent-carousel]');
    const cards = Array.prototype.slice.call(dentistSection.querySelectorAll('[data-dent-card]'));
    const dots = Array.prototype.slice.call(dentistSection.querySelectorAll('[data-dent-goto]'));
    const reveal = () => dentistSection.classList.add('is-visible');

    // --- 1. Profile dialogs ------------------------------------------------
    // Native <dialog>: showModal() gives us the top layer, a real backdrop,
    // focus trapping, ESC and focus restore for free. Clicking the backdrop
    // closes (a click that lands on the dialog element itself, not its body).
    const openers = dentistSection.querySelectorAll('[data-dent-open]');
    Array.prototype.forEach.call(openers, (btn) => {
      btn.addEventListener('click', () => {
        const dialog = document.getElementById(btn.getAttribute('data-dent-open'));
        if (!dialog || typeof dialog.showModal !== 'function') return;
        if (!dialog.open) dialog.showModal();
      });
    });
    Array.prototype.forEach.call(dentistSection.querySelectorAll('.dentist-dialog'), (dialog) => {
      const close = () => { if (dialog.open) dialog.close(); };
      const closeBtn = dialog.querySelector('[data-dent-close]');
      if (closeBtn) closeBtn.addEventListener('click', close);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    });

    // --- 2. The smoke tables ----------------------------------------------
    // Fixed, deterministic sets so every burst is the same (and testable). On
    // the dark stage the smoke reads as pale luminous aqua/white wisps, so the
    // tints are the site's own aqua #2dd4bf, sky #38bdf8, mint #a7f3d0 and
    // white glass. The arrival carries the full ring; bringing a doctor
    // forward carries a lighter accent. Puffs are built when they are needed,
    // animate once and are removed again, so nothing stays composited.
    const MIST_TINTS = [
      ['rgba(255, 255, 255, 0.55)', 'rgba(203, 238, 255, 0.22)'],
      ['rgba(94, 234, 212, 0.50)', 'rgba(45, 212, 191, 0.18)'],
      ['rgba(125, 211, 252, 0.46)', 'rgba(56, 189, 248, 0.16)'],
      ['rgba(167, 243, 208, 0.46)', 'rgba(146, 232, 222, 0.18)']
    ];
    // x%, y%, size, drift x, drift y, curl, scale, rotate, opacity, dur s,
    // delay ms, tint, blur px
    const MIST_PUFFS = [
      [3, 90, 122, -62, -28, 8, 1.6, -20, 0.84, 0.95, 20, 1, 3],
      [97, 90, 122, 62, -24, -8, 1.6, 18, 0.84, 0.95, 60, 2, 3],
      [2, 30, 150, -150, -6, 10, 1.8, -22, 0.80, 1.50, 0, 0, 4],
      [1, 58, 182, -172, 14, -8, 1.9, 16, 0.74, 1.70, 80, 1, 6],
      [2, 84, 148, -144, 48, 16, 1.7, -14, 0.76, 1.60, 150, 3, 3],
      [98, 28, 150, 148, -8, -12, 1.8, 24, 0.80, 1.55, 40, 2, 5],
      [99, 56, 176, 174, 12, 8, 1.9, -18, 0.74, 1.70, 120, 0, 4],
      [98, 82, 146, 146, 46, -14, 1.7, 12, 0.76, 1.60, 190, 1, 6],
      [12, 104, 172, -56, 62, 22, 1.8, 18, 0.70, 1.65, 110, 3, 4],
      [88, 104, 172, 58, 64, -20, 1.8, -16, 0.70, 1.65, 170, 2, 3],
      [50, 100, 200, 8, 54, 12, 1.6, -8, 0.56, 1.80, 230, 0, 5]
    ];
    // x%, y%, size, drift x, drift y, opacity, dur s, delay ms, tint
    const MIST_MOTES = [
      [18, 88, 12, -34, -58, 0.90, 1.60, 120, 1],
      [82, 84, 10, 30, -66, 0.85, 1.70, 190, 2],
      [62, 95, 11, 16, -74, 0.80, 1.80, 260, 3]
    ];
    // the lighter accent that greets a card coming back to the front
    const ACCENT_PUFFS = [
      [2, 64, 152, -122, 10, 6, 1.7, 14, 0.52, 1.20, 0, 1, 4],
      [98, 58, 150, 118, 8, -8, 1.7, -12, 0.52, 1.25, 40, 0, 4],
      [6, 93, 158, -54, 40, 14, 1.6, -10, 0.48, 1.35, 70, 3, 4],
      [94, 91, 156, 52, 42, -12, 1.6, 10, 0.48, 1.35, 110, 2, 4],
      [50, 105, 192, 6, 46, 8, 1.5, -6, 0.42, 1.45, 150, 0, 5]
    ];
    const ACCENT_MOTES = [
      [26, 96, 10, -20, -40, 0.62, 1.30, 120, 1],
      [74, 94, 9, 18, -44, 0.62, 1.40, 170, 2]
    ];

    function burst(card, puffs, motes, lifetime) {
      const host = card.querySelector('.dentist-smoke');
      if (!host) return;
      if (host.dentTimer) clearTimeout(host.dentTimer);
      while (host.firstChild) host.removeChild(host.firstChild);
      const frag = document.createDocumentFragment();
      const add = (cls, pairs) => {
        const el = document.createElement('span');
        el.className = cls;
        el.style.cssText = pairs.join('');
        frag.appendChild(el);
      };

      puffs.forEach((p) => {
        const tint = MIST_TINTS[p[11]];
        add('dentist-puff', [
          '--px:' + p[0] + '%;--py:' + p[1] + '%;--ps:' + p[2] + 'px;--bl:' + p[12] + 'px;',
          '--dx:' + p[3] + 'px;--dy:' + p[4] + 'px;--cx:' + p[5] + 'px;--sc:' + p[6] + ';',
          '--rot:' + p[7] + 'deg;--po:' + p[8] + ';--pd:' + p[9] + 's;--pdl:' + p[10] + 'ms;',
          '--pc1:' + tint[0] + ';--pc2:' + tint[1]
        ]);
      });

      motes.forEach((m) => {
        const tint = MIST_TINTS[m[8]];
        add('dentist-mote', [
          '--px:' + m[0] + '%;--py:' + m[1] + '%;--ps:' + m[2] + 'px;',
          '--dx:' + m[3] + 'px;--dy:' + m[4] + 'px;--po:' + m[5] + ';--pd:' + m[6] + 's;--pdl:' + m[7] + 'ms;',
          '--pc1:' + tint[0] + ';--pc2:' + tint[1]
        ]);
      });

      host.appendChild(frag);
      card.classList.add('is-smoking');

      // tear the burst down once the slowest puff has finished
      host.dentTimer = setTimeout(() => {
        host.dentTimer = null;
        card.classList.remove('is-smoking');
        while (host.firstChild) host.removeChild(host.firstChild);
      }, lifetime);
    }

    // --- 3. The carousel ---------------------------------------------------
    // One class swap moves both panes: the card that loses .is-active drifts
    // back and to the side, the one that gains it comes forward. With the two
    // doctors this is the whole state machine.
    const motionOff = motionQuery.matches;
    let front = 0;

    function setFront(next, accent) {
      if (motionOff) return;
      next = next ? 1 : 0;
      const changed = next !== front;
      front = next;
      cards.forEach((card, i) => {
        card.classList.toggle('is-active', i === next);
        card.classList.toggle('is-away', i !== next);
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-on', i === next);
        dot.setAttribute('aria-current', i === next ? 'true' : 'false');
      });
      if (changed && accent) burst(cards[next], ACCENT_PUFFS, ACCENT_MOTES, 1700);
    }

    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const i = Number(dot.getAttribute('data-dent-goto')) || 0;
        setFront(i, true);
      });
      dot.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const i = e.key === 'ArrowRight' ? 1 : 0;
        setFront(i, true);
        if (dots[i]) dots[i].focus();
      });
    });

    // Clicking the pane behind brings it forward; the View Profile button
    // inside it still opens that doctor's dialog instead.
    cards.forEach((card, i) => {
      card.addEventListener('click', (e) => {
        if (i === front) return;
        if (e.target.closest('.dentist-view, a, button')) return;
        setFront(i, true);
      });
    });

    // A clear horizontal swipe does the same, so the pair is usable on a
    // touch screen. Passive listeners and touch-action: pan-y on the carousel
    // mean vertical scrolling is never touched.
    if (carousel) {
      let sx = 0;
      let sy = 0;
      let tracking = false;
      carousel.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        tracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, { passive: true });
      carousel.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        setFront(dx < 0 ? 1 : 0, true);
      }, { passive: true });
    }

    // --- 4. Continuous drift ----------------------------------------------
    // A second, always-on observer: .is-awake exists while any part of the
    // section is on screen. Reusing one observer for both jobs would need the
    // reveal to stay subscribed forever; keeping them separate means the
    // reveal stays one-shot and self-cleaning.
    if (!motionOff && typeof IntersectionObserver !== 'undefined') {
      const liveObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          dentistSection.classList.toggle('is-awake', entry.isIntersecting);
        });
      }, { rootMargin: '0px 0px -5% 0px' });
      liveObserver.observe(dentistSection);
    }

    if (motionOff || typeof IntersectionObserver === 'undefined') {
      reveal();
      dentistSection.classList.add('is-settled');
      return;
    }

    // --- 5. Landing -------------------------------------------------------
    function land(card) {
      if (card.dataset.dentLanded) return;
      card.dataset.dentLanded = '1';
      card.classList.add('is-landed');
      card.addEventListener('animationend', function onSettle(e) {
        if (e.animationName !== 'dentSettle') return;
        card.classList.remove('is-landed');
        card.removeEventListener('animationend', onSettle);
      });
      setTimeout(() => card.classList.remove('is-landed'), 900);
      burst(card, MIST_PUFFS, MIST_MOTES, 2400);
    }

    // Each card finishes its flight at its own moment (the stagger lives in
    // --d), so the landing is driven per card by transitionend on the
    // transform, with a timer as a safety net if the event never arrives.
    // Once both have landed .is-settled swaps the slow arrival timing for the
    // quicker carousel timing.
    const startArrival = () => {
      let landed = 0;
      cards.forEach((card, i) => {
        let done = false;
        const onFlight = (e) => {
          if (e.target !== card || e.propertyName !== 'transform') return;
          settle();
        };
        const settle = () => {
          if (done) return;
          done = true;
          card.removeEventListener('transitionend', onFlight);
          land(card);
          landed += 1;
          if (landed === cards.length) dentistSection.classList.add('is-settled');
        };
        card.addEventListener('transitionend', onFlight);
        setTimeout(settle, 1300 + i * 160);
      });
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        reveal();
        startArrival();
        observer.disconnect();
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -10% 0px' });
    observer.observe(dentistSection);
  }

  // --- Dentist water-flosser backdrop -------------------------------------
  // A single canvas scrubs a 180-frame sequence behind the profile panes.
  // The sequence is 2.6 MB, so nothing is fetched at page load: the canvas
  // paints the first frame from CSS, and this loader starts only once the
  // section is within 700px of the viewport. Current-frame and every-sixth
  // keyframes go first; the rest fill in four at a time. If the visitor
  // scrolls, the live frame jumps the queue. No DOM is added per frame.
  function renderDentistWater(index) {
    if (!dentistFlosserCtx || !dentistFlosserCanvas) return;

    const wanted = Math.max(0, Math.min(DENTIST_WATER_FRAMES - 1, Math.round(index)));
    let source = -1;

    if (dentistWaterState[wanted] === 4) {
      source = wanted;
    } else {
      // Use the nearest already-loaded keyframe while the requested frame is
      // still in flight. Prefer the forward neighbour on a tie.
      for (let d = 1; d < DENTIST_WATER_FRAMES; d++) {
        const ahead = wanted + d;
        const behind = wanted - d;
        if (ahead < DENTIST_WATER_FRAMES && dentistWaterState[ahead] === 4) {
          source = ahead;
          break;
        }
        if (behind >= 0 && dentistWaterState[behind] === 4) {
          source = behind;
          break;
        }
      }
    }

    if (source === -1 || source === dentistWaterLastRendered) return;

    const img = dentistWaterFrames[source];
    if (!img || !img.naturalWidth) return;

    dentistFlosserCtx.drawImage(img, 0, 0, dentistFlosserCanvas.width, dentistFlosserCanvas.height);
    dentistWaterLastRendered = source;
  }

  function updateDentistWaterTarget() {
    if (!dentistSection) return;

    const rect = dentistSection.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vh || !rect.height) return;

    // 0 as the section begins to enter from the bottom, 1 as it leaves the
    // top. At the moment the section fills the screen the sequence is around
    // its middle, which is exactly when the spray is opening out behind the
    // panes.
    const progress = (vh - rect.top) / (vh + rect.height);
    dentistWaterTarget = Math.min(1, Math.max(0, progress)) * (DENTIST_WATER_FRAMES - 1);

    if (dentistWaterNear && dentistWaterStarted && !motionQuery.matches) {
      queueDentistWaterFrame(Math.round(dentistWaterTarget), true, true);
      pumpDentistWater();
    }
  }

  function queueDentistWaterFrame(index, priority, front) {
    if (index < 0 || index >= DENTIST_WATER_FRAMES) return;

    const state = dentistWaterState[index];
    if (state === 0) {
      dentistWaterState[index] = priority ? 1 : 2;
      if (priority) {
        if (front) dentistWaterPriority.unshift(index);
        else dentistWaterPriority.push(index);
      } else {
        dentistWaterFill.push(index);
      }
      return;
    }

    if (!priority) return;

    // A frame already queued for background fill - or merely waiting behind
    // older keyframes - can be promoted to the very front when it is the
    // frame the visitor is actually looking at.
    if (state === 2) {
      const at = dentistWaterFill.indexOf(index);
      if (at !== -1) dentistWaterFill.splice(at, 1);
      dentistWaterState[index] = 1;
      if (front) dentistWaterPriority.unshift(index);
      else dentistWaterPriority.push(index);
    } else if (state === 1 && front) {
      const at = dentistWaterPriority.indexOf(index);
      if (at > 0) {
        dentistWaterPriority.splice(at, 1);
        dentistWaterPriority.unshift(index);
      }
    }
  }

  function pumpDentistWater() {
    if (!dentistWaterStarted || !dentistWaterNear || motionQuery.matches) return;

    while (dentistWaterInFlight < DENTIST_WATER_MAX_INFLIGHT) {
      const index = dentistWaterPriority.length
        ? dentistWaterPriority.shift()
        : dentistWaterFill.shift();

      if (index === undefined) return;
      if (dentistWaterState[index] === 4 || dentistWaterState[index] === 5) continue;

      dentistWaterState[index] = 3;
      dentistWaterInFlight += 1;

      const img = new Image();
      dentistWaterFrames[index] = img;
      img.decoding = 'async';

      const finish = (ok) => {
        dentistWaterInFlight = Math.max(0, dentistWaterInFlight - 1);
        dentistWaterState[index] = ok ? 4 : 5;
        if (ok && dentistWaterNear && !motionQuery.matches) {
          renderDentistWater(dentistWaterCurrent);
        }
        pumpDentistWater();
      };

      img.onload = () => finish(true);
      img.onerror = () => {
        console.warn('Water-flosser frame could not load', index + 1);
        finish(false);
      };
      img.src = getDentistWaterPath(index);
    }
  }

  function startDentistWater() {
    if (dentistWaterStarted || motionQuery.matches || !dentistFlosserCtx) return;

    dentistWaterStarted = true;
    dentistWaterCurrent = dentistWaterTarget;

    // The frame the visitor is at, then frame zero, then the coarse keyframes
    // that let the scrub read smoothly before the full sequence has arrived.
    queueDentistWaterFrame(Math.round(dentistWaterTarget), true);
    queueDentistWaterFrame(0, true);
    for (let i = 0; i < DENTIST_WATER_FRAMES; i += DENTIST_WATER_KEYFRAME_STEP) {
      queueDentistWaterFrame(i, true);
    }
    queueDentistWaterFrame(DENTIST_WATER_FRAMES - 1, true);

    // Everything else is background fill; it only runs while the section is
    // near, and any frame promoted by scrolling overtakes it.
    for (let i = 0; i < DENTIST_WATER_FRAMES; i++) {
      queueDentistWaterFrame(i, false);
    }

    pumpDentistWater();
  }

  function initDentistWater() {
    if (!dentistSection || !dentistFlosserCanvas || !dentistFlosserCtx) return;

    dentistFlosserCtx.imageSmoothingEnabled = true;
    dentistFlosserCtx.imageSmoothingQuality = 'high';
    updateDentistWaterTarget();

    // Without IntersectionObserver the CSS still image remains the fallback;
    // never pull the sequence on a browser that cannot scrub it.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        dentistWaterNear = entry.isIntersecting;
        if (!dentistWaterNear) return;
        if (motionQuery.matches) return;

        updateDentistWaterTarget();
        startDentistWater();
        dentistWaterCurrent = dentistWaterTarget;
        renderDentistWater(dentistWaterCurrent);
        pumpDentistWater();
      });
    }, { rootMargin: '700px 0px' });
    observer.observe(dentistSection);

    // If the visitor turns reduced motion off during the visit, begin only
    // then; turning it on simply freezes the last frame (or leaves the CSS
    // still frame visible if nothing has loaded yet).
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (motionQuery.matches || !dentistWaterNear) return;
        updateDentistWaterTarget();
        startDentistWater();
        dentistWaterCurrent = dentistWaterTarget;
        renderDentistWater(dentistWaterCurrent);
        pumpDentistWater();
      });
    }
  }

  // â”€â”€â”€ Scroll Event Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Scroll events can arrive more than once per frame, and both window and
  // document were previously bound to this work. Keep one passive listener
  // and collapse every event into the next animation frame.
  let scrollUpdateRaf = 0;
  let lastHeroFade = -1;
  let lastHeroPromptHidden = null;
  let navScrolledState = false;

  function updateScrollState() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

    // 1. Hero video scrub â€” the timeline reaches its final frame exactly as
    //    the bridge opens, then holds that frame beneath the clinic.
    if (heroSection) {
      // The hero starts at the document origin and is not transformed, so its
      // position is already known. Reading getBoundingClientRect() here used
      // to force layout after the previous frame's style writes.
      const heroOffset = Math.max(0, scrollTop - heroDocTop);
      const progress = Math.min(Math.max(heroOffset / heroScrubDist, 0), 1);
      if (progress !== heroProgress) {
        heroProgress = progress;
        scheduleHeroVideoUpdate();
      }

      // Hero UI smooth fade over the first 480px. The mobile hand offset
      // introduced in CSS eases out over the same window, so it disappears
      // before the matched hero-to-clinic bridge begins.
      const fadeDist = 480;
      const fadeRatio = Math.min(Math.max(heroOffset / fadeDist, 0), 1);
      if (fadeRatio !== lastHeroFade) {
        lastHeroFade = fadeRatio;
        if (window.innerWidth <= 768) {
          heroSection.style.setProperty(
            '--hero-canvas-shift',
            `${(24 * (1 - fadeRatio)).toFixed(1)}px`
          );
        }
        if (heroContent) {
          const opacity = 1 - fadeRatio;
          heroContent.style.opacity = opacity.toFixed(3);
          heroContent.style.transform = `translateY(${-fadeRatio * 45}px)`;
          heroContent.style.pointerEvents = opacity < 0.08 ? 'none' : 'auto';
        }
      }

      const promptHidden = heroOffset > 60;
      if (heroScrollPrompt && promptHidden !== lastHeroPromptHidden) {
        lastHeroPromptHidden = promptHidden;
        heroScrollPrompt.style.opacity = promptHidden ? '0' : '1';
        heroScrollPrompt.style.transform = promptHidden
          ? 'translateX(-50%) translateY(12px)'
          : 'translateX(-50%) translateY(0)';
      }
    }

    // 2. Cinematic bridge â€” cross-dissolve + matched dolly from the hero
    //    environment into the clinic environment (pure scroll function).
    updateSectionBridge(scrollTop);

    // 3. Clinic â†’ Services hand-off â€” composes onto the bridge's output:
    //    scene push-in + fade behind the white bloom, header reveal in sync.
    updateServicesTransition(scrollTop);

    // 3b. Services cards: the scroll-linked sequence — one card at a time,
    //     in order, as the panel crosses the viewport (a no-op under reduced
    //     motion, before the cards exist, or once all four are latched). The
    //     section is far below the hero, so do not read its live rect there.
    const vh = window.innerHeight;
    if (!svcSeq.latched.every(Boolean) &&
        scrollTop + vh >= svcStart - vh) {
      updateServicesSequence();
    }

    // 4. Clinic Sequence Progress â€” held on its opening frame during the
    //    bridge, then scrubbed across its own pin range (pacing unchanged).
    if (clinicSection) {
      const progress = Math.min(Math.max((scrollTop - clinicScrubStart) / clinicScrubDist, 0), 1);
      if (progress !== clinicProgress) {
        clinicProgress = progress;
        scheduleClinicVideoUpdate();
      }
    }

    // 5. Dentist water-flosser progress. The observer owns the near/far
    //    state, so no live rect is read while the visitor is anywhere else
    //    on the page.
    if (dentistWaterNear) updateDentistWaterTarget();

    // 6. Navbar scroll style
    if (navbar) {
      const scrolled = scrollTop > 40;
      if (scrolled !== navScrolledState) {
        navScrolledState = scrolled;
        navbar.classList.toggle('nav-scrolled', scrolled);
      }
    }
  }

  function requestScrollUpdate() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

    // Video progress is just a number and a coalesced seek request. Updating
    // it in the scroll event (rather than waiting for the style rAF below)
    // keeps the scrub one frame closer to the pointer while still batching
    // every style write into a single frame.
    if (heroSection) {
      const progress = Math.min(Math.max((scrollTop - heroDocTop) / heroScrubDist, 0), 1);
      if (progress !== heroProgress) {
        heroProgress = progress;
        scheduleHeroVideoUpdate();
      }
    }
    if (clinicSection) {
      const progress = Math.min(Math.max((scrollTop - clinicScrubStart) / clinicScrubDist, 0), 1);
      if (progress !== clinicProgress) {
        clinicProgress = progress;
        scheduleClinicVideoUpdate();
      }
    }

    if (scrollUpdateRaf) return;
    scrollUpdateRaf = requestAnimationFrame(() => {
      scrollUpdateRaf = 0;
      updateScrollState();
    });
  }

  // â”€â”€â”€ Dual Animation Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function animationLoop(time) {
    // Lenis shares this loop; there is no second rAF loop competing with the
    // page's scroll-linked work.
    if (lenis) lenis.raf(time);

    // Dentist water-flosser LERP. It runs only while the section is near and
    // the frames have been given permission to load; otherwise the canvas
    // simply holds its last frame.
    if (dentistWaterNear && dentistWaterStarted && !motionQuery.matches) {
      const wDelta = dentistWaterTarget - dentistWaterCurrent;
      if (Math.abs(wDelta) > 0.5) {
        dentistWaterCurrent += wDelta * DENTIST_WATER_LERP;
      } else {
        dentistWaterCurrent = dentistWaterTarget;
      }
      renderDentistWater(dentistWaterCurrent);
    }

    requestAnimationFrame(animationLoop);
  }

  // â”€â”€â”€ Touch / Click Interaction for Infographic Badges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function initBadgeInteractions() {
    const badgeGroups = document.querySelectorAll('.infographic-badge-group');
    badgeGroups.forEach((group) => {
      group.addEventListener('click', (e) => {
        const isAlreadyOpen = group.classList.contains('active-popover');
        badgeGroups.forEach((b) => b.classList.remove('active-popover'));
        if (!isAlreadyOpen) {
          group.classList.add('active-popover');
        }
        e.stopPropagation();
      });
    });

    document.addEventListener('click', () => {
      badgeGroups.forEach((b) => b.classList.remove('active-popover'));
    });
  }

  // â”€â”€â”€ Initialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.addEventListener('resize', () => {
    measureBridge();
    measureServicesTransition(); // re-derive the hand-off window from layout
    measureCardOffsets();        // the grid may have wrapped to a new column count
    // A resize can change the breakpoint that owns the mobile hero offset.
    lastHeroFade = -1;
    lastHeroPromptHidden = null;
    navScrolledState = false;
    updateScrollState();
  }, { passive: true });
  window.addEventListener('scroll', requestScrollUpdate, { passive: true });

  // Late layout settle (web fonts / images): re-check the hand-off window
  // and re-apply once â€” cheap, one-shot.
  window.addEventListener('load', () => {
    measureServicesTransition();
    measureCardOffsets();
    updateScrollState();
  }, { once: true });

  // Live motion-preference changes: toggle the enhancement class, force the
  // hand-off styles to be re-applied, and make sure the card sequence can
  // never leave content hidden when motion is switched off mid-visit.
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', () => {
      document.documentElement.classList.toggle('js-anim', !motionQuery.matches);
      if (motionQuery.matches) {
        destroyLenis();
        svcSeq.active = false;
        revealAllCards();
      } else {
        initLenis();
      }
      lastSvcT = -1;
      updateScrollState();
    });
  }

  measureBridge();
  measureServicesTransition();
  updateScrollState();
  initHeroVideo();
  initClinicVideo();
  initBadgeInteractions();
  initServicesReveal();
  initServicesSequence();
  initServicesFootage();
  initLocationReveal();
  initFooterYear();
  initFooterVideo();
  initAppointmentDialog();
  initDentistWater();
  initDentistReveal();
  initLenis();
  requestAnimationFrame(animationLoop);
})();
