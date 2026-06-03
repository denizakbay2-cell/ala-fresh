/* =========================================================
   ALFRESH — Interactions
   - Canvas frame scrubbing (Apple-style) driven by GSAP ScrollTrigger
   - Hero overlay cross-fades
   - Mobile drawer + nav scroll state
   - Swiper for products
   - Contact form validation
   - Reveal animations

   NOTE on the "canvas frame scrubbing" technique:
   ---------------------------------------------------
   We render the MP4 onto a <canvas> and drive `video.currentTime`
   from scroll progress. This sidesteps the native <video> element's
   styling/playback quirks and produces the buttery scrub you see on
   Apple product pages.

   For maximum smoothness (true Apple-grade), extract a JPG sequence
   from videomp_.mp4 once:

       ffmpeg -i videomp_.mp4 -vf "fps=30,scale=1920:-2" \
              -q:v 3 frames/frame_%04d.jpg

   Then swap `initCanvasScrubVideo()` for `initCanvasScrubFrames()`
   below (already implemented — just call it instead).
   ========================================================= */

(() => {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  /* ---------- DOM ready ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    initYear();
    initNav();
    initDrawer();
    initLoader();
    initCanvasScrubBuffered(); // desktop: pre-decodes frames for buttery scrub (no-op on mobile)
    initMobileCanvasScrub();   // mobile: same canvas scrub with the portrait clip (no-op on desktop)
    initHeroOverlays();
    initMarqueePause();
    initProductsSwiper();
    initAboutReveal();
    initFadeUps();
    initContactForm();
  });

  /* =========================================================
     Footer year
     ========================================================= */
  function initYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* =========================================================
     Loader — finishes once video metadata is loaded + 600ms grace
     ========================================================= */
  function initLoader() {
    const loader = document.getElementById('loader');
    const bar = loader?.querySelector('.loader__bar span');
    if (!loader || !bar) return;

    // The buffered decoder writes real progress to the bar.
    // We only handle final reveal + safety timeout.
    window.addEventListener('alfresh:ready', () => {
      bar.style.width = '100%';
      setTimeout(() => loader.classList.add('is-hidden'), 500);
    });

    // Safety: hide loader anyway after 35s in case decode stalls.
    // Mobile decode can take 20-25s — give it room before forcing reveal.
    setTimeout(() => {
      bar.style.width = '100%';
      loader.classList.add('is-hidden');
    }, 35000);
  }

  /* =========================================================
     Navigation scroll state
     ========================================================= */
  function initNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const onScroll = () => {
      nav.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* =========================================================
     Mobile drawer
     ========================================================= */
  function initDrawer() {
    const burger = document.getElementById('navBurger');
    const drawer = document.getElementById('drawer');
    if (!burger || !drawer) return;

    const close = () => {
      burger.classList.remove('is-open');
      drawer.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };
    const open = () => {
      burger.classList.add('is-open');
      drawer.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };

    burger.addEventListener('click', () => {
      drawer.classList.contains('is-open') ? close() : open();
    });
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  }

  /* =========================================================
     DESKTOP CANVAS FRAME SCRUBBING — pre-extracted JPG sequence
     ---------------------------------------------------------
     Draws a pre-rendered JPG image sequence (cilek-frames-desktop/
     frame-001.jpg … 192.jpg) instead of seek-decoding videomp_.mp4
     in the browser. Same 720p source — so resolution is unchanged —
     but pixel-exact frames with no H.264 seek softness and no 2–4s
     decode warm-up, for a cleaner, smoother scrub. Frames stream in
     parallel; progress is surfaced in the page loader. No-op on
     mobile (initMobileCanvasScrub owns the <=768px hero).
     ========================================================= */
  async function initCanvasScrubBuffered() {
    // ---------- MOBILE EARLY RETURN ----------
    // On mobile (<=768px) this desktop pipeline does nothing — the mobile
    // hero runs its own canvas scrub via initMobileCanvasScrub(), which
    // also dispatches the 'alfresh:ready' event. Desktop continues below.
    if (window.matchMedia('(max-width: 768px)').matches) {
      return;
    }

    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ----- Image sequence config -----
    // Pre-extracted JPG frames of videomp_.mp4 (1280×720, 24fps → 192 frames),
    // replacing the previous in-browser MP4 seek-decode. Pixel-exact frames,
    // no H.264 seek softness and no 2–4s decode warm-up. Same 720p source, so
    // the resolution is unchanged — the win is a cleaner, smoother scrub.
    const FRAME_COUNT = 192;
    const framePath = (n) => `cilek-frames-desktop/frame-${String(n).padStart(3, '0')}.jpg?v=1`;
    const frames = new Array(FRAME_COUNT);     // frames[0] => frame-001.jpg
    const loaderBar = document.querySelector('.loader__bar span');

    // ----- Drawing primitives -----
    let currentIdx = -1;
    const OVERSCAN = 1.10;

    function sizeCanvas() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    }

    const isReady = (img) => img && img.complete && img.naturalWidth > 0;

    function findFrame(idx) {
      // Walk outward to nearest loaded neighbour — lets paint() succeed
      // even while later frames are still streaming in.
      if (isReady(frames[idx])) return frames[idx];
      for (let d = 1; d < FRAME_COUNT; d++) {
        if (idx - d >= 0 && isReady(frames[idx - d])) return frames[idx - d];
        if (idx + d < FRAME_COUNT && isReady(frames[idx + d])) return frames[idx + d];
      }
      return null;
    }

    function paint(idx) {
      const f = findFrame(idx);
      if (!f) return;
      currentIdx = idx;
      const cw = canvas.width, ch = canvas.height;
      const iw = f.naturalWidth, ih = f.naturalHeight;
      const baseScale = Math.max(cw / iw, ch / ih);
      const scale = baseScale * OVERSCAN;
      const dw = iw * scale, dh = ih * scale;
      // Anchor at top-left so the extra overscan crops the right + bottom
      // edges (where the "Veo" watermark sits).
      const dx = 0;
      const dy = 0;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(f, dx, dy, dw, dh);
    }

    // Load a single frame; resolves whether it succeeds or fails.
    const loadFrame = (i) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { frames[i] = img; resolve(true); };
      img.onerror = () => { resolve(false); };
      img.src = framePath(i + 1);
      frames[i] = img; // store eagerly so findFrame can see it once complete
    });

    // ----- Frame 0 first → reveal page immediately -----
    const firstOk = await loadFrame(0);
    if (!firstOk) {
      console.warn('[ALFRESH] cilek-frames-desktop/ resim dizisi yüklenemedi. Lütfen `python3 -m http.server` ile çalıştırın.');
    }
    if (loaderBar) loaderBar.style.width = (1 / FRAME_COUNT * 100) + '%';

    sizeCanvas();
    paint(0);
    window.dispatchEvent(new Event('alfresh:ready'));

    const state = { f: 0 };
    gsap.to(state, {
      f: FRAME_COUNT - 1,
      ease: 'none',
      snap: { f: 1 },
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.35,
        invalidateOnRefresh: true
      },
      onUpdate: () => {
        const idx = Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(state.f)));
        if (idx !== currentIdx) paint(idx);
      }
    });

    window.addEventListener('resize', () => {
      sizeCanvas();
      paint(Math.max(0, currentIdx));
      ScrollTrigger.refresh();
    });

    // ----- Background-load every remaining frame IN PARALLEL -----
    // Firing all requests at once lets the browser stream them in quickly,
    // so the scrub fills in smoothly in both directions (mirrors the mobile
    // pipeline). findFrame() falls back to the nearest loaded neighbour until
    // each frame arrives, so the user can scroll immediately.
    let loaded = 1;
    for (let i = 1; i < FRAME_COUNT; i++) {
      loadFrame(i).then(() => {
        loaded++;
        if (loaderBar) loaderBar.style.width = (loaded / FRAME_COUNT * 100) + '%';
        if (i === currentIdx) paint(i); // sharpen whatever is on screen now
      });
    }
  }

  /* =========================================================
     MOBILE CANVAS FRAME SCRUBBING (<=768px only)
     ---------------------------------------------------------
     Apple-style scroll-linked canvas frame scrubbing, but instead
     of decoding an MP4 it draws a pre-rendered JPG image sequence
     (cilek-frames/ezgif-frame-001.jpg … 120.jpg). This avoids the
     mobile <video> quirks entirely — no black first frame, no
     decode stalls, no element stuck at the top with a gap below.

       • source  = cilek-frames/ JPG sequence (120 portrait frames)
       • <canvas> only — no <video> on mobile
       • GSAP ScrollTrigger pin:true + pinSpacing:true pins the
         hero and auto-computes the scroll distance below it
       • object-fit: contain drawing — the whole frame always fits
       • dvh-based container heights (set in CSS) dodge mobile
         browser-chrome height bugs

     No-op on desktop — the desktop pipeline is left fully untouched.
     ========================================================= */
  async function initMobileCanvasScrub() {
    if (!window.matchMedia('(max-width: 768px)').matches) return;

    const canvas = document.getElementById('heroCanvas');
    if (!canvas) { window.dispatchEvent(new Event('alfresh:ready')); return; }
    const ctx = canvas.getContext('2d', { alpha: false });

    // ----- Image sequence config -----
    const FRAME_COUNT = 120;
    // ?v=2 — frames re-exported from the 2156×3844 source (was a soft
    // 1076-wide intermediate); the cache-buster forces the sharp set in.
    const framePath = (n) => `cilek-frames/ezgif-frame-${String(n).padStart(3, '0')}.jpg?v=2`;
    const images = new Array(FRAME_COUNT);            // images[0] => frame 001
    const loaderBar = document.querySelector('.loader__bar span');

    // Letterbox fill — matches the page background so any contain-gap
    // is invisible.
    const BG = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim() || '#F5F1EA';

    let currentIdx = -1;

    function sizeCanvas() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    }

    const isReady = (img) => img && img.complete && img.naturalWidth > 0;

    function findFrame(idx) {
      // Walk outward to the nearest already-loaded neighbour so paint()
      // succeeds even while later frames are still streaming in.
      if (isReady(images[idx])) return images[idx];
      for (let d = 1; d < FRAME_COUNT; d++) {
        if (idx - d >= 0 && isReady(images[idx - d])) return images[idx - d];
        if (idx + d < FRAME_COUNT && isReady(images[idx + d])) return images[idx + d];
      }
      return null;
    }

    // cover-fit — fills the whole stage like the desktop hero. The source
    // frames have a white background, so a "contain" letterbox left a
    // visible cream-vs-white seam and shrank the strawberry, which read as
    // low quality. cover crops a few px off the sides instead: full-bleed,
    // full-size, no seam. High-quality smoothing keeps the downscale crisp.
    function paint(idx) {
      const f = findFrame(idx);
      if (!f) return;
      currentIdx = idx;
      const cw = canvas.width, ch = canvas.height;
      const iw = f.naturalWidth, ih = f.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);   // cover (max, not min)
      const dw = iw * scale, dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = BG;                          // safety fill behind the frame
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(f, dx, dy, dw, dh);
    }

    // Load a single frame; resolves whether it succeeds or fails.
    const loadFrame = (i) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { images[i] = img; resolve(true); };
      img.onerror = () => { resolve(false); };
      img.src = framePath(i + 1);
      images[i] = img; // store eagerly so findFrame can see it once complete
    });

    // ----- Frame 0 first → reveal the page immediately -----
    const firstOk = await loadFrame(0);
    if (!firstOk) {
      console.warn('[ALFRESH] cilek-frames/ resim dizisi yüklenemedi. ' +
        'Sayfayı bir HTTP sunucusu ile açın (örn: `python3 -m http.server`).');
    }
    if (loaderBar) loaderBar.style.width = (1 / FRAME_COUNT * 100) + '%';

    sizeCanvas();
    paint(0);

    // ----- Background-load every remaining frame IN PARALLEL -----
    // Sequential await-loading made fast scrolls (and scrolling back up)
    // stutter — findFrame() kept falling back to far-away neighbours while
    // the next frame was still in the await queue. Firing all requests at
    // once lets the browser stream them in quickly, so the scrub fills in
    // smoothly in both directions.
    let loaded = 1;
    for (let i = 1; i < FRAME_COUNT; i++) {
      loadFrame(i).then(() => {
        loaded++;
        if (loaderBar) loaderBar.style.width = (loaded / FRAME_COUNT * 100) + '%';
        if (i === currentIdx) paint(i); // sharpen whatever is on screen now
      });
    }

    // ----- GSAP ScrollTrigger: ONE pinned timeline owns everything -----
    // The frame scrub AND the intro → mid → end text beats are tweened on
    // a single timeline driven by a single pinned ScrollTrigger.
    // Previously the text had its own ScrollTrigger (in initHeroOverlays):
    // two triggers spanning the same range drift apart — that was the
    // "integration" glitch, most visible when scrolling back up. One
    // timeline physically cannot desync.
    //
    // pin:true keeps the stage fixed (no CSS sticky); pinSpacing:true
    // inserts a spacer of exactly the right height. ignoreMobileResize
    // stops the iOS/Android URL-bar slide from refreshing ScrollTrigger
    // mid-scroll — that refresh was the main cause of the scrub stutter.
    ScrollTrigger.config({ ignoreMobileResize: true });

    const intro = document.querySelector('[data-hero-overlay="intro"]');
    const mid   = document.querySelector('[data-hero-overlay="mid"]');
    const end   = document.querySelector('[data-hero-overlay="end"]');
    const cue   = document.querySelector('.hero__cue');

    // Same starting state as desktop: intro shown, mid + end hidden below.
    gsap.set(intro, { opacity: 1, y: 0 });
    gsap.set([mid, end], { opacity: 0, y: 30 });

    const state = { f: 0 };
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: '+=170%',          // scrub distance — shorter = animation plays faster per scroll
        scrub: 0.35,
        pin: true,
        pinSpacing: true,
        invalidateOnRefresh: true
      }
    });

    // Frame scrub — runs the full length of the timeline.
    tl.to(state, {
      f: FRAME_COUNT - 1,
      ease: 'none',
      duration: 1,
      onUpdate: () => {
        // onUpdate drives the draw — already rAF-throttled by GSAP,
        // so the scrub stays buttery without a second rAF loop.
        const idx = Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(state.f)));
        if (idx !== currentIdx) paint(idx);
      }
    }, 0);

    // Text beats — same copy and same timing as the desktop hero, layered
    // onto the same timeline so they stay locked to the strawberry scrub.
    if (cue)   tl.to(cue,   { opacity: 0, y: 0,   duration: 0.05 }, 0.04);
    if (intro) tl.to(intro, { opacity: 0, y: -30, duration: 0.12 }, 0.16);
    if (mid)   tl.to(mid,   { opacity: 1, y: 0,   duration: 0.12 }, 0.30);
    if (mid)   tl.to(mid,   { opacity: 0, y: -30, duration: 0.12 }, 0.55);
    if (end)   tl.to(end,   { opacity: 1, y: 0,   duration: 0.16 }, 0.76);

    // Resize: re-sizing the canvas + refreshing ScrollTrigger is right for
    // a real orientation change — but mobile browsers also fire resize
    // when the URL bar slides, and refreshing then yanks the scroll
    // position. So only do the full refresh when the WIDTH actually
    // changed (orientation / window resize), not on pure height jitter.
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      sizeCanvas();
      paint(Math.max(0, currentIdx));
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        ScrollTrigger.refresh();
      }
    });

    // The pin is created late (after the first frame's async load), so the
    // hero-overlay ScrollTriggers built earlier need their positions
    // recomputed against the pinned scroll distance. Then reveal the page.
    ScrollTrigger.refresh();
    window.dispatchEvent(new Event('alfresh:ready'));
  }

  /* =========================================================
     CANVAS FRAME SCRUBBING — Direct video seek (kept as fallback)
     - Loads videomp_.mp4 into a hidden <video>
     - On every ScrollTrigger update, sets video.currentTime
     - A continuous rAF loop paints the current frame to <canvas>
     ========================================================= */
  function initCanvasScrubVideo() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const video = document.createElement('video');
    // No crossOrigin: the file is same-origin. Setting it can break decode/seek.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
    video.src = 'videomp_.mp4';
    video.load();

    let triggerBuilt = false;
    const proxy = { t: 0 };          // GSAP animates this; we mirror to video.currentTime

    function sizeCanvas() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    }

    function paint() {
      if (video.readyState < 2) return;
      const cw = canvas.width, ch = canvas.height;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || !cw || !ch) return;
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale, dh = vh * scale;
      ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    function loop() {
      paint();
      requestAnimationFrame(loop);
    }

    function buildScrub() {
      if (triggerBuilt) return;
      if (!isFinite(video.duration) || video.duration <= 0) return;
      triggerBuilt = true;

      gsap.to(proxy, {
        t: video.duration,
        ease: 'none',
        scrollTrigger: {
          trigger: '#hero',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.4,
          invalidateOnRefresh: true
        },
        onUpdate: () => {
          // Setting currentTime triggers an async seek; rAF loop redraws.
          try { video.currentTime = proxy.t; } catch (_) {}
        }
      });
    }

    function onReady() {
      sizeCanvas();
      paint();
      buildScrub();
      window.dispatchEvent(new Event('alfresh:ready'));
    }

    video.addEventListener('loadedmetadata', () => {
      sizeCanvas();
      // Nudge a tiny seek so the first frame is decoded (Safari/iOS need this).
      try { video.currentTime = 0.0001; } catch (_) {}
    });
    video.addEventListener('loadeddata',     onReady);
    video.addEventListener('canplay',        onReady);
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('seeked',         paint);
    video.addEventListener('error', () => {
      console.warn(
        '[ALFRESH] videomp_.mp4 yüklenemedi. Sayfayı bir HTTP sunucusu ile aç ' +
        '(örn: `python3 -m http.server 8000`). file:// üzerinden bazı tarayıcılar ' +
        'canvas\'a video çizmeyi engeller.'
      );
    });

    window.addEventListener('resize', () => {
      sizeCanvas();
      paint();
      ScrollTrigger.refresh();
    });

    requestAnimationFrame(loop);
  }

  /* =========================================================
     CANVAS FRAME SCRUBBING — JPG sequence source (Apple's exact pattern)
     Call this *instead of* initCanvasScrubVideo() once you've extracted
     frames with:  ffmpeg -i videomp_.mp4 -vf "fps=30,scale=1920:-2" \
                          -q:v 3 frames/frame_%04d.jpg
     ========================================================= */
  // eslint-disable-next-line no-unused-vars
  function initCanvasScrubFrames() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const FRAME_COUNT  = 180;                      // adjust to your exported count
    const FRAME_PATH   = (i) => `frames/frame_${String(i).padStart(4, '0')}.jpg`;
    const images = new Array(FRAME_COUNT);
    let loaded = 0;
    const state = { frame: 0 };

    function sizeCanvas() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    function paint() {
      const img = images[state.frame];
      if (!img || !img.complete) return;
      const cw = canvas.width, ch = canvas.height;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.src = FRAME_PATH(i + 1);
      img.onload = () => {
        loaded++;
        if (loaded === 1) { sizeCanvas(); paint(); }
        if (loaded === FRAME_COUNT) window.dispatchEvent(new Event('alfresh:ready'));
      };
      images[i] = img;
    }

    gsap.to(state, {
      frame: FRAME_COUNT - 1,
      snap: 'frame',
      ease: 'none',
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.4,
        invalidateOnRefresh: true
      },
      onUpdate: paint
    });

    window.addEventListener('resize', () => { sizeCanvas(); paint(); });
  }

  /* =========================================================
     Hero overlay cross-fades (intro → mid → end)
     ========================================================= */
  function initHeroOverlays() {
    const intro = document.querySelector('[data-hero-overlay="intro"]');
    const mid   = document.querySelector('[data-hero-overlay="mid"]');
    const end   = document.querySelector('[data-hero-overlay="end"]');
    const cue   = document.querySelector('.hero__cue');
    if (!intro || !mid || !end) return;

    // Initial state (shared by both viewports)
    gsap.set([mid, end], { opacity: 0, y: 30 });
    gsap.set(intro, { opacity: 1, y: 0 });

    const mm = gsap.matchMedia();

    // ---------- DESKTOP (>=769px) — VERBATIM existing logic ----------
    mm.add('(min-width: 769px)', () => {
      // INTRO appears, fades out before MID
      gsap.timeline({
        scrollTrigger: {
          trigger: '#hero',
          start: 'top top',
          end: '25% top',
          scrub: true
        }
      })
      .to(intro, { opacity: 1, y: 0, duration: 0.2 }, 0)
      .to(intro, { opacity: 0, y: -30, duration: 0.5 }, 0.5)
      .to(cue,   { opacity: 0, duration: 0.3 }, 0);

      // MID fades in then out
      gsap.timeline({
        scrollTrigger: {
          trigger: '#hero',
          start: '25% top',
          end: '70% top',
          scrub: true
        }
      })
      .to(mid, { opacity: 1, y: 0, duration: 0.4 }, 0)
      .to(mid, { opacity: 0, y: -30, duration: 0.4 }, 0.6);

      // END fades in toward bottom
      gsap.timeline({
        scrollTrigger: {
          trigger: '#hero',
          start: '70% top',
          end: 'bottom bottom',
          scrub: true
        }
      })
      .to(end, { opacity: 1, y: 0, duration: 0.5 }, 0);
    });

    // ---------- MOBILE (<=768px) — handled elsewhere -----------------
    // The mobile intro → mid → end cross-fade is NOT built here. It lives
    // on the SAME timeline as the mobile canvas scrub (see
    // initMobileCanvasScrub) so the text beats can never drift out of
    // sync with the strawberry animation. Two separate ScrollTriggers
    // over the same pinned range used to desync — that was the
    // "integration" glitch, most visible when scrolling back up.
    // Nothing on desktop is touched.
  }

  /* =========================================================
     Marquee — pause on hover via CSS animation play-state
     ========================================================= */
  function initMarqueePause() {
    const m = document.querySelector('.marquee__track');
    if (!m) return;
    m.parentElement.addEventListener('mouseenter', () => m.style.animationPlayState = 'paused');
    m.parentElement.addEventListener('mouseleave', () => m.style.animationPlayState = 'running');
  }

  /* =========================================================
     Products — Swiper
     ========================================================= */
  function initProductsSwiper() {
    const el = document.getElementById('productsSwiper');
    if (!el || typeof Swiper === 'undefined') return;

    const progressBar = document.getElementById('prodProgress');

    const swiper = new Swiper(el, {
      slidesPerView: 'auto',
      spaceBetween: 32,
      grabCursor: true,
      speed: 800,
      mousewheel: { forceToAxis: true, sensitivity: 0.6, releaseOnEdges: true },
      keyboard: { enabled: true },
      navigation: {
        prevEl: '#prodPrev',
        nextEl: '#prodNext'
      },
      breakpoints: {
        640:  { spaceBetween: 32 },
        1024: { spaceBetween: 48 }
      },
      on: {
        progress(swiperInstance, progress) {
          if (progressBar) progressBar.style.width = Math.max(0.12, progress) * 100 + '%';
        }
      }
    });

    return swiper;
  }

  /* =========================================================
     About statement — word-by-word reveal
     ========================================================= */
  function initAboutReveal() {
    document.querySelectorAll('.reveal-words').forEach(el => {
      // Wrap each word in a <span class="word"> while preserving <em>
      const wrap = (node) => {
        if (node.nodeType === 3) {
          const parts = node.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach(p => {
            if (/^\s+$/.test(p)) {
              frag.appendChild(document.createTextNode(p));
            } else if (p.length) {
              const span = document.createElement('span');
              span.className = 'word';
              span.textContent = p;
              frag.appendChild(span);
            }
          });
          node.replaceWith(frag);
        } else if (node.nodeType === 1) {
          const span = document.createElement('span');
          span.className = 'word';
          span.appendChild(node.cloneNode(true));
          node.replaceWith(span);
        }
      };
      Array.from(el.childNodes).forEach(wrap);

      gsap.to(el.querySelectorAll('.word'), {
        y: '0%',
        opacity: 1,
        duration: 1.2,
        ease: 'expo.out',
        stagger: 0.04,
        scrollTrigger: {
          trigger: el,
          start: 'top 78%',
          once: true
        }
      });
    });
  }

  /* =========================================================
     Generic fade-up reveals for sections
     ========================================================= */
  function initFadeUps() {
    const targets = [
      '.section-head__eyebrow',
      '.section-head__title',
      '.section-head__lede',
      '.catalog__eyebrow',
      '.catalog__title',
      '.catalog__list li',
      '.about__card',
      '.contact__title',
      '.field',
      '.contact__aside > div'
    ];
    targets.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        gsap.fromTo(el,
          { y: 30, opacity: 0 },
          {
            y: 0, opacity: 1,
            duration: 1, ease: 'expo.out',
            scrollTrigger: { trigger: el, start: 'top 88%', once: true }
          });
      });
    });
  }

  /* =========================================================
     Contact form — graceful validation, no backend
     ========================================================= */
  function initContactForm() {
    const form = document.getElementById('contactForm');
    const note = document.getElementById('formNote');
    const submitBtn = form?.querySelector('.contact__submit');
    if (!form || !note) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name  = (data.get('name')  || '').toString().trim();
      const email = (data.get('email') || '').toString().trim();
      const msg   = (data.get('message') || '').toString().trim();
      const honey = (data.get('_honey') || '').toString().trim();

      if (honey) return; // bot trap silently dropped

      if (!name || !email || !msg) {
        note.textContent = 'Lütfen ad, e-posta ve mesaj alanlarını doldurun.';
        note.style.color = '#8B2E2E';
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        note.textContent = 'Geçerli bir e-posta adresi girin.';
        note.style.color = '#8B2E2E';
        return;
      }

      // Build JSON payload — Formsubmit's AJAX endpoint accepts application/json
      const payload = Object.fromEntries(data.entries());

      const endpoint = form.action;
      const original = submitBtn?.querySelector('span')?.textContent;
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.querySelector('span').textContent = 'Gönderiliyor…';
        }
        note.textContent = '';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));

        if (res.ok && (json.success === 'true' || json.success === true)) {
          note.textContent = 'Teşekkür ederiz. Talebiniz alındı — en kısa sürede dönüş yapacağız.';
          note.style.color = '';
          form.reset();
        } else {
          note.textContent = json.message
            ? `Gönderilemedi: ${json.message}`
            : 'Gönderilemedi. Lütfen daha sonra tekrar deneyin veya doğrudan e-posta gönderin.';
          note.style.color = '#8B2E2E';
        }
      } catch (err) {
        note.textContent = 'Bağlantı hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.';
        note.style.color = '#8B2E2E';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (original) submitBtn.querySelector('span').textContent = original;
        }
      }
    });
  }
})();
