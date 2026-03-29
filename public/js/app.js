/**
 * Нейроуниверситет — App Logic
 */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    updatePointsBadge();
    initTimerCard();
    initSurvey();
    initContactForm();
    initVideoPlayer();
    initSecretBonus();
    initOffer();
    initNextButtons();
    initThankYouPage();

    // Refresh points every 30s
    setInterval(updatePointsBadge, 30000);
  }

  // ─── POINTS BADGE ───
  function updatePointsBadge() {
    var badge = document.getElementById('points-value');
    if (!badge) return;
    Tracker.getPoints(function(data) {
      badge.textContent = data.total;
      window._pointsData = data;

      // Update timer if exists
      if (data.expires_at && data.total > 0) {
        showTimerCard(data);
      }

      // Update offer if on lesson 3
      if (Tracker.getCurrentLesson() === 3) {
        updateOfferPrice(data);
      }
    });
  }

  // ─── TIMER CARD ───
  function initTimerCard() {
    var card = document.getElementById('timer-card');
    if (!card) return;
    Tracker.getPoints(function(data) {
      if (data.total > 0 && data.expires_at) {
        showTimerCard(data);
      }
    });
  }

  function showTimerCard(data) {
    var card = document.getElementById('timer-card');
    if (!card) return;
    card.style.display = 'flex';

    var timerText = card.querySelector('.timer-points-text');
    if (timerText) {
      timerText.textContent = 'Ваши ' + data.total + ' баллов (' + data.total + ' ₽ скидка) сгорят через: ';
    }

    var timerValue = card.querySelector('.timer-value');
    var pointsBadge = document.getElementById('points-value');
    Tracker.startPointsTimer(data.expires_at, timerValue, pointsBadge);

    Tracker.trackEvent('points_timer_shown', Tracker.getCurrentLesson(), JSON.stringify({ seconds_left: data.seconds_left }));
  }

  // ─── SURVEY ───
  function initSurvey() {
    var surveyBlock = document.getElementById('survey-block');
    if (!surveyBlock) return;

    var questions = surveyBlock.querySelectorAll('.survey-question');
    var progressDots = surveyBlock.querySelectorAll('.survey-progress-dot');
    var currentQ = 0;
    var answers = {};
    var started = false;

    // Show first question
    if (questions.length > 0) {
      questions[0].classList.add('active');
      progressDots[0]?.classList.add('done');
    }

    // Handle option clicks
    surveyBlock.addEventListener('click', function(e) {
      var option = e.target.closest('.survey-option');
      if (!option) return;

      if (!started) {
        started = true;
        Tracker.trackEvent('survey_start', 1);
      }

      // Deselect siblings
      var siblings = option.parentElement.querySelectorAll('.survey-option');
      siblings.forEach(function(s) { s.classList.remove('selected'); });
      option.classList.add('selected');

      var qName = option.dataset.question;
      var val = option.dataset.value;
      answers[qName] = val;

      // Auto-advance after short delay
      setTimeout(function() {
        if (currentQ < questions.length - 1) {
          questions[currentQ].classList.remove('active');
          currentQ++;
          questions[currentQ].classList.add('active');
          progressDots[currentQ]?.classList.add('done');
        }
      }, 400);
    });

    // Submit button
    var submitBtn = document.getElementById('survey-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        if (Object.keys(answers).length < 4) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка...';

        fetch('/api/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: Tracker.getSession(),
            occupation: answers.occupation || '',
            pain: answers.pain || '',
            source: answers.source || '',
            goal: answers.goal || ''
          })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            Tracker.showConfetti();
            surveyBlock.innerHTML = '<div class="survey-success fade-in">' +
              '<div class="check-icon">✓</div>' +
              '<h2>Спасибо! +500 баллов начислены</h2>' +
              '<p style="color:var(--text-secondary);margin-top:8px;">Баллы дают скидку на полный курс</p>' +
              '</div>';
            updatePointsBadge();

            // Show next lesson button
            var nextBtn = document.getElementById('next-lesson-section');
            if (nextBtn) nextBtn.style.display = 'block';
          }
        })
        .catch(function() {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Отправить и получить 500 баллов →';
        });
      });
    }

    // Track survey abandon on page leave
    window.addEventListener('beforeunload', function() {
      if (started && Object.keys(answers).length < 4) {
        navigator.sendBeacon('/api/survey/abandon', new Blob([JSON.stringify({
          session_id: Tracker.getSession(),
          question_number: currentQ + 1
        })], { type: 'application/json' }));
      }
    });
  }

  // ─── CONTACT FORM ───
  function initContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;

    var inputs = form.querySelectorAll('input');
    var focusTracked = false;
    inputs.forEach(function(input) {
      input.addEventListener('focus', function() {
        if (!focusTracked) {
          focusTracked = true;
          Tracker.trackEvent('contact_form_start', 2);
        }
      });
    });

    var submitBtn = form.querySelector('.btn-primary');
    submitBtn.addEventListener('click', function(e) {
      e.preventDefault();

      var name = form.querySelector('[name="name"]').value.trim();
      var email = form.querySelector('[name="email"]').value.trim();

      if (!name || !email) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: Tracker.getSession(),
          name: name,
          email: email,
          lesson: 2
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          Tracker.showConfetti();
          var giftBlock = document.getElementById('gift-block');
          if (giftBlock) {
            giftBlock.innerHTML = '<div class="survey-success fade-in">' +
              '<div class="check-icon">✓</div>' +
              '<h2>PDF отправлен на ' + email + '</h2>' +
              '<p style="color:var(--text-secondary);margin-top:8px;">+1000 баллов начислены</p>' +
              '</div>';
          }
          updatePointsBadge();

          var nextBtn = document.getElementById('next-lesson-section');
          if (nextBtn) nextBtn.style.display = 'block';
        }
      })
      .catch(function() {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Получить PDF и +1000 баллов →';
      });
    });
  }

  // ─── VIDEO ───
  function initVideoPlayer() {
    var iframe = document.getElementById('video-player');
    if (!iframe) return;

    var lesson = Tracker.getCurrentLesson();

    // Set video URL from config
    var videoKey = 'lesson' + lesson;
    if (typeof CONFIG !== 'undefined' && CONFIG.videos && CONFIG.videos[videoKey]) {
      var url = CONFIG.videos[videoKey];
      if (url && !url.includes('ВСТАВИТЬ')) {
        iframe.src = url;
      }
    }

    Tracker.trackVideo(iframe, lesson);

    // Show survey/gift after 30s
    var showTimeout = setTimeout(function() {
      showAfterVideoBlock();
    }, 30000);

    // Also show on video progress
    window.addEventListener('videoProgress', function(e) {
      if (e.detail.percent >= 5) {
        showAfterVideoBlock();
        clearTimeout(showTimeout);
      }
    });
  }

  function showAfterVideoBlock() {
    var block = document.getElementById('after-video-block');
    if (block && !block.classList.contains('shown')) {
      block.classList.add('shown');
      block.style.display = 'block';
      block.classList.add('fade-in');
    }
  }

  // ─── SECRET BONUS (Lesson 3) ───
  function initSecretBonus() {
    var bonus = document.getElementById('secret-bonus');
    if (!bonus) return;

    var shown = false;
    var lesson3PointsGiven = false;

    function showBonus() {
      if (shown) return;
      shown = true;
      bonus.style.display = 'block';
      setTimeout(function() { bonus.classList.add('visible'); }, 50);
      Tracker.trackEvent('secret_bonus_shown', 3);
    }

    // Show after 30s or video 30%
    var timer = setTimeout(showBonus, 30000);

    window.addEventListener('videoProgress', function(e) {
      if (e.detail.lesson === 3) {
        if (e.detail.percent >= 30) {
          showBonus();
          clearTimeout(timer);
        }
        if (e.detail.percent >= 50 && !lesson3PointsGiven) {
          lesson3PointsGiven = true;
          // Add 1500 points
          fetch('/api/points/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: Tracker.getSession(),
              lesson: 3,
              amount: 1500,
              reason: 'lesson3_watch'
            })
          }).then(function() {
            Tracker.showConfetti();
            Tracker.trackEvent('lesson3_points_earned', 3);
            updatePointsBadge();
          });
        }
      }
    });
  }

  // ─── OFFER (Lesson 3) ───
  function initOffer() {
    var offerBlock = document.getElementById('offer-block');
    if (!offerBlock) return;

    // Track when visible
    var observer = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        Tracker.getPoints(function(data) {
          Tracker.trackEvent('offer_view', 3, JSON.stringify({ points: data.total, price_shown: Math.max(0, 15000 - data.total) }));
        });
        observer.disconnect();
      }
    });
    observer.observe(offerBlock);

    updateOfferPrice(window._pointsData || { total: 0 });

    // Buy button
    var buyBtn = document.getElementById('buy-btn');
    if (buyBtn) {
      buyBtn.addEventListener('click', function() {
        buyBtn.disabled = true;
        buyBtn.textContent = 'Подготовка оплаты...';

        Tracker.getPoints(function(pData) {
          Tracker.trackEvent('buy_click', 3, JSON.stringify({ points: pData.total, price: Math.max(0, 15000 - pData.total) }));

          fetch('/api/purchase/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: Tracker.getSession() })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.robokassa_url) {
              window.location.href = data.robokassa_url;
            }
          })
          .catch(function() {
            buyBtn.disabled = false;
            buyBtn.textContent = 'Купить →';
          });
        });
      });
    }
  }

  function updateOfferPrice(data) {
    var priceOld = document.getElementById('price-old');
    var priceCurrent = document.getElementById('price-current');
    var pricePoints = document.getElementById('price-points');
    var priceNoDiscount = document.getElementById('price-no-discount');
    var buyBtn = document.getElementById('buy-btn');

    if (!priceCurrent) return;

    var total = (data && data.total) || 0;
    var finalPrice = Math.max(0, 15000 - total);

    if (total > 0) {
      if (priceOld) { priceOld.style.display = 'block'; priceOld.textContent = '15 000 ₽'; }
      priceCurrent.textContent = formatPrice(finalPrice) + ' ₽';
      if (pricePoints) { pricePoints.style.display = 'block'; pricePoints.textContent = '⬡ ' + total + ' баллов = −' + total + ' ₽'; }
      if (priceNoDiscount) priceNoDiscount.style.display = 'none';
    } else {
      if (priceOld) priceOld.style.display = 'none';
      priceCurrent.textContent = '15 000 ₽';
      if (pricePoints) pricePoints.style.display = 'none';
      if (priceNoDiscount) priceNoDiscount.style.display = 'block';
    }

    if (buyBtn) {
      buyBtn.textContent = 'Купить за ' + formatPrice(finalPrice) + ' ₽ →';
    }
  }

  function formatPrice(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // ─── NEXT LESSON BUTTONS ───
  function initNextButtons() {
    var links = document.querySelectorAll('.next-lesson-link');
    links.forEach(function(link) {
      var href = link.getAttribute('href');
      if (href) {
        link.setAttribute('href', Tracker.appendSessionToUrl(href));
      }
      link.addEventListener('click', function() {
        Tracker.trackEvent('next_lesson_click', Tracker.getCurrentLesson());
      });
    });
  }

  // ─── THANK YOU PAGE ───
  function initThankYouPage() {
    var referralField = document.getElementById('referral-link-input');
    if (!referralField) return;

    Tracker.trackEvent('thank_you_page', 0);

    var link = Tracker.getReferralLink();
    referralField.value = link;

    var copyBtn = document.getElementById('copy-referral-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(link).then(function() {
          copyBtn.textContent = '✓ Скопировано';
          Tracker.trackEvent('referral_link_copied', 0);
          setTimeout(function() { copyBtn.textContent = 'Скопировать ссылку'; }, 3000);
        });
      });
    }

    var tgBtn = document.getElementById('share-telegram-btn');
    if (tgBtn) {
      tgBtn.addEventListener('click', function() {
        Tracker.trackEvent('referral_telegram_click', 0);
        var text = encodeURIComponent('Я начал учиться в Нейроуниверситете — посмотри бесплатный курс по нейросетям:\n' + link);
        window.open('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + text, '_blank');
      });
    }
  }
})();
