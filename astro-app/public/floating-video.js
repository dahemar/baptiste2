/**
 * Vanilla floating video pop-out for static pages (e.g. audiovisual).
 * Mirrors Firefox's in-page floating player on Chrome/Safari.
 */
(function () {
  var MIN_W = 280;
  var MIN_H = 158;
  var zCounter = 4500;
  var windows = [];

  function isDesktop() {
    try {
      return window.matchMedia('(min-width: 769px)').matches;
    } catch {
      return window.innerWidth > 768;
    }
  }

  function popoutSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<rect x="3" y="5" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="11" y="9" width="10" height="8" rx="1.5" fill="currentColor" opacity="0.92"/>' +
      '</svg>'
    );
  }

  function clampPosition(x, y, w, h) {
    var margin = 8;
    var maxX = Math.max(margin, window.innerWidth - w - margin);
    var maxY = Math.max(margin, window.innerHeight - h - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }

  function openFromVideo(video, options) {
    if (!video || !isDesktop()) return null;
    options = options || {};

    var src = video.currentSrc || video.src;
    if (!src) return null;

    var initialTime = video.currentTime || 0;
    var autoPlay = !video.paused && !video.ended;
    if (!video.paused) {
      try {
        video.pause();
      } catch (e) {
        /* ignore */
      }
    }

    var offset = windows.length * 28;
    var w = options.width || 480;
    var h = options.height || 270;
    var pos = clampPosition((options.x != null ? options.x : 72) + offset, (options.y != null ? options.y : 96) + offset, w, h);

    var root = document.createElement('div');
    root.className = 'floating-video-window';
    root.setAttribute('role', 'dialog');
    root.style.left = pos.x + 'px';
    root.style.top = pos.y + 'px';
    root.style.width = w + 'px';
    root.style.height = h + 'px';
    root.style.zIndex = String(zCounter++);

    var toolbar = document.createElement('div');
    toolbar.className = 'floating-video-toolbar';

    var titleEl = document.createElement('span');
    titleEl.className = 'floating-video-title';
    titleEl.textContent = options.title || 'Video';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'floating-video-close';
    closeBtn.setAttribute('aria-label', 'Close floating video');
    closeBtn.textContent = '×';

    var body = document.createElement('div');
    body.className = 'floating-video-body';

    var floatVideo = document.createElement('video');
    floatVideo.className = 'floating-video-element';
    floatVideo.src = src;
    floatVideo.controls = true;
    floatVideo.playsInline = true;
    floatVideo.loop = true;
    if (options.poster) floatVideo.poster = options.poster;
    if (video.crossOrigin) floatVideo.crossOrigin = video.crossOrigin;

    toolbar.appendChild(titleEl);
    toolbar.appendChild(closeBtn);
    body.appendChild(floatVideo);

    var resize = document.createElement('div');
    resize.className = 'floating-video-resize';
    resize.setAttribute('aria-hidden', 'true');

    root.appendChild(toolbar);
    root.appendChild(body);
    root.appendChild(resize);
    document.body.appendChild(root);

    var state = {
      root: root,
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      drag: null,
      resize: null,
    };
    windows.push(state);

    function bringToFront() {
      root.style.zIndex = String(zCounter++);
    }

    function applyLayout() {
      var p = clampPosition(state.x, state.y, state.width, state.height);
      state.x = p.x;
      state.y = p.y;
      root.style.left = state.x + 'px';
      root.style.top = state.y + 'px';
      root.style.width = state.width + 'px';
      root.style.height = state.height + 'px';
    }

    function removeWindow() {
      try {
        floatVideo.pause();
        floatVideo.removeAttribute('src');
        floatVideo.load();
      } catch (e) {
        /* ignore */
      }
      root.remove();
      windows = windows.filter(function (w) {
        return w !== state;
      });
    }

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeWindow();
    });

    root.addEventListener('pointerdown', bringToFront);

    toolbar.addEventListener('pointerdown', function (e) {
      if (e.target === closeBtn) return;
      e.preventDefault();
      bringToFront();
      state.drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: state.x,
        originY: state.y,
      };
      toolbar.setPointerCapture(e.pointerId);
    });

    resize.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      bringToFront();
      state.resize = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startW: state.width,
        startH: state.height,
      };
      resize.setPointerCapture(e.pointerId);
    });

    function onPointerMove(e) {
      if (state.drag && state.drag.pointerId === e.pointerId) {
        var dx = e.clientX - state.drag.startX;
        var dy = e.clientY - state.drag.startY;
        state.x = state.drag.originX + dx;
        state.y = state.drag.originY + dy;
        applyLayout();
      }
      if (state.resize && state.resize.pointerId === e.pointerId) {
        var rdx = e.clientX - state.resize.startX;
        var rdy = e.clientY - state.resize.startY;
        state.width = Math.max(MIN_W, state.resize.startW + rdx);
        state.height = Math.max(MIN_H, state.resize.startH + rdy);
        applyLayout();
      }
    }

    function onPointerUp(e) {
      if (state.drag && state.drag.pointerId === e.pointerId) state.drag = null;
      if (state.resize && state.resize.pointerId === e.pointerId) state.resize = null;
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    var onLoaded = function () {
      if (initialTime > 0) {
        try {
          floatVideo.currentTime = initialTime;
        } catch (err) {
          /* ignore */
        }
      }
      if (autoPlay) {
        floatVideo.muted = false;
        floatVideo.volume = 1;
        floatVideo.play().catch(function () {});
      }
    };
    floatVideo.addEventListener('loadeddata', onLoaded, { once: true });
    if (floatVideo.readyState >= 2) onLoaded();

    return { close: removeWindow, element: root };
  }

  function mountPopoutButtons() {
    if (!isDesktop()) return;
    document.querySelectorAll('.av-media').forEach(function (container) {
      var video = container.querySelector('video');
      if (!video || container.querySelector('.video-popout-button')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'video-popout-button';
      btn.setAttribute('aria-label', 'Open in floating window');
      btn.setAttribute('title', 'Open in floating window');
      btn.innerHTML = popoutSvg();
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var posterImg = container.querySelector('img.av-image');
        openFromVideo(video, {
          poster: video.getAttribute('poster') || (posterImg && posterImg.src) || undefined,
          title: 'Video',
        });
      });
      container.appendChild(btn);
    });
  }

  window.FloatingVideo = {
    openFromVideo: openFromVideo,
    mountPopoutButtons: mountPopoutButtons,
  };

  function init() {
    mountPopoutButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
