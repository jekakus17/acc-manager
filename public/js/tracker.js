/**
 * Нейроуниверситет — Tracker
 * Подключается на все страницы первым.
 */
(function() {
  'use strict';

  const API = window.location.origin + '/api';
  let sessionId = null;
  let currentLesson = 0;
  let pageOpenTime = Date.now();
  let scrollThresholds = { 25: false, 50: false, 75: false, 100: false };
  let videoThresholds = {};
  let eventQueue = [];
  let isOnline = navigator.onLine;
  let rageClickMap = {};

  // ─── SESSION ───
  function getOrCreateSession() {
    // Check URL param first
    const urlParams = new URLSearchParams(window.location.search);
    const urlSession = urlParams.get('s');
    if (urlSession) {
      localStorage.setItem('neuro_session', urlSession);
      sessionId = urlSession;
    } else {
      sessionId = localStorage.getItem('neuro_session');
    }

    // Check referral
    const refParam = urlParams.get('ref');
    if (refParam) {
      localStorage.setItem('neuro_ref_from', refParam);
    }

    if (!sessionId) {
      sessionId = generateUUID();
      localStorage.setItem('neuro_session', sessionId);
      createSession();
    }

    return sessionId;
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function detectDevice() {
    const ua = navigator.userAgent;
    if (/Mobi|Android.*Mobile|iPhone|iPod/.test(ua)) return 'mobile';
    if (/Tablet|iPad|Android(?!.*Mobile)/.test(ua)) return 'tablet';
    return 'desktop';
  }

  function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('OPR') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('YaBrowser')) return 'Yandex';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return 'Other';
  }

  function detectOS() {
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac OS')) return 'macOS';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Other';
  }

  function createSession() {
    const urlParams = new URLSearchParams(window.location.search);
    const refFrom = localStorage.getItem('neuro_ref_from') || null;

    const data = {
      session_id: sessionId,
      utm_source: urlParams.get('utm_source'),
      utm_medium: urlParams.get('utm_medium'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_content: urlParams.get('utm_content'),
      utm_term: urlParams.get('utm_term'),
      device_type: detectDevice(),
      browser: detectBrowser(),
      os: detectOS(),
      referrer: document.referrer || null,
      first_lesson: currentLesson || 1,
      ref_from: refFrom
    };

    sendToAPI('/session', data);

    // Register referral
    if (refFrom && refFrom !== sessionId) {
      sendToAPI('/referral/register', {
        ref_session_id: refFrom,
        friend_session_id: sessionId
      });
    }
  }

  // ─── EVENTS ───
  function trackEvent(event, lesson, value) {
    const data = {
      session_id: sessionId,
      event: event,
      lesson: lesson || currentLesson,
      value: value || null
    };

    if (!isOnline) {
      eventQueue.push(data);
      return;
    }

    sendToAPI('/event', data);
  }

  function sendToAPI(endpoint, data) {
    fetch(API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(function() {
      if (endpoint === '/event') {
        eventQueue.push(data);
      }
    });
  }

  function flushQueue() {
    while (eventQueue.length > 0) {
      const data = eventQueue.shift();
      sendToAPI('/event', data);
    }
  }

  window.addEventListener('online', function() {
    isOnline = true;
    flushQueue();
  });
  window.addEventListener('offline', function() { isOnline = false; });

  // ─── PAGE TIME ───
  function trackPageTime() {
    pageOpenTime = Date.now();
    window.addEventListener('beforeunload', function() {
      const seconds = Math.round((Date.now() - pageOpenTime) / 1000);
      // Use sendBeacon for reliability
      const data = JSON.stringify({
        session_id: sessionId,
        event: 'page_close',
        lesson: currentLesson,
        value: JSON.stringify({ seconds: seconds })
      });
      navigator.sendBeacon(API + '/event', new Blob([data], { type: 'application/json' }));
    });
  }

  // ─── SCROLL ───
  function trackScroll() {
    window.addEventListener('scroll', function() {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;
      const percent = Math.round((window.scrollY / scrollHeight) * 100);

      [25, 50, 75, 100].forEach(function(threshold) {
        if (percent >= threshold && !scrollThresholds[threshold]) {
          scrollThresholds[threshold] = true;
          trackEvent('scroll_' + threshold, currentLesson);
        }
      });
    }, { passive: true });
  }

  // ─── VIDEO ───
  function trackVideo(iframe, lesson) {
    if (!iframe) return;

    videoThresholds[lesson] = {};

    window.addEventListener('message', function(e) {
      if (!e.data || typeof e.data !== 'object') return;

      const data = e.data;
      // Kinescope player events
      if (data.type === 'player:play' || data.event === 'play') {
        trackEvent('video_play', lesson);
      }
      if (data.type === 'player:pause' || data.event === 'pause') {
        const pct = data.data ? data.data.percent : (data.percent || 0);
        trackEvent('video_pause', lesson, JSON.stringify({ percent: Math.round(pct * 100) }));
      }
      if (data.type === 'player:replay' || data.event === 'replay') {
        trackEvent('video_replay', lesson);
      }
      if (data.type === 'player:timeupdate' || data.event === 'timeupdate') {
        const pct = data.data ? data.data.percent : (data.percent || 0);
        const percent = Math.round(pct * 100);

        for (let t = 10; t <= 90; t += 10) {
          if (percent >= t && !videoThresholds[lesson][t]) {
            videoThresholds[lesson][t] = true;
            trackEvent('video_' + t, lesson);
          }
        }

        // Dispatch custom event for app logic
        window.dispatchEvent(new CustomEvent('videoProgress', { detail: { lesson: lesson, percent: percent } }));
      }
      if (data.type === 'player:ended' || data.event === 'ended') {
        if (!videoThresholds[lesson][100]) {
          videoThresholds[lesson][100] = true;
          trackEvent('video_complete', lesson);
          window.dispatchEvent(new CustomEvent('videoProgress', { detail: { lesson: lesson, percent: 100 } }));
        }
      }
    });
  }

  // ─── RAGE CLICK ───
  function trackRageClick() {
    document.addEventListener('click', function(e) {
      const selector = e.target.tagName + (e.target.className ? '.' + e.target.className.split(' ')[0] : '');
      const now = Date.now();

      if (!rageClickMap[selector]) {
        rageClickMap[selector] = [];
      }

      rageClickMap[selector].push(now);
      // Keep only clicks within 2 seconds
      rageClickMap[selector] = rageClickMap[selector].filter(function(t) { return now - t < 2000; });

      if (rageClickMap[selector].length >= 3) {
        trackEvent('rage_click', currentLesson, JSON.stringify({ element_selector: selector, click_count: rageClickMap[selector].length }));
        rageClickMap[selector] = [];
      }
    });
  }

  // ─── POINTS ───
  function getPoints(callback) {
    if (!sessionId) {
      callback({ total: 0, expires_at: null, seconds_left: 0, breakdown: [] });
      return;
    }
    fetch(API + '/points/' + sessionId)
      .then(function(r) { return r.json(); })
      .then(callback)
      .catch(function() {
        callback({ total: 0, expires_at: null, seconds_left: 0, breakdown: [] });
      });
  }

  function startPointsTimer(expiresAt, timerEl, pointsEl) {
    if (!expiresAt || !timerEl) return;

    const interval = setInterval(function() {
      const now = Date.now();
      const exp = new Date(expiresAt).getTime();
      const diff = Math.max(0, Math.floor((exp - now) / 1000));

      if (diff <= 0) {
        timerEl.textContent = 'Баллы сгорели';
        timerEl.closest('.timer-card')?.classList.add('urgent');
        clearInterval(interval);
        if (pointsEl) pointsEl.textContent = '0';
        return;
      }

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      timerEl.textContent = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);

      if (diff < 86400) {
        timerEl.closest('.timer-card')?.classList.add('urgent');
      }
    }, 1000);

    return interval;
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ─── HELPERS ───
  function appendSessionToUrl(url) {
    if (!sessionId) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 's=' + sessionId;
  }

  function getReferralLink() {
    return window.location.origin + '/lesson1.html?ref=' + sessionId;
  }

  // ─── CONFETTI ───
  function showConfetti() {
    var container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    var colors = ['#00e5a0', '#00ffa8', '#fff', '#ffdd57', '#ff6b6b'];
    for (var i = 0; i < 50; i++) {
      var piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 1 + 's';
      piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      container.appendChild(piece);
    }
    setTimeout(function() { container.remove(); }, 4000);
  }

  // ─── DETECT LESSON ───
  function detectLesson() {
    const path = window.location.pathname;
    if (path.includes('lesson1')) return 1;
    if (path.includes('lesson2')) return 2;
    if (path.includes('lesson3')) return 3;
    return 0;
  }

  // ─── AUTO INIT ───
  currentLesson = detectLesson();
  getOrCreateSession();
  trackPageTime();
  trackScroll();
  trackRageClick();

  if (currentLesson > 0) {
    trackEvent('page_open', currentLesson, JSON.stringify({ referrer: document.referrer }));
  }

  // ─── PUBLIC API ───
  window.Tracker = {
    getSession: function() { return sessionId; },
    trackEvent: trackEvent,
    trackVideo: trackVideo,
    getPoints: getPoints,
    startPointsTimer: startPointsTimer,
    appendSessionToUrl: appendSessionToUrl,
    getReferralLink: getReferralLink,
    showConfetti: showConfetti,
    getCurrentLesson: function() { return currentLesson; }
  };
})();
