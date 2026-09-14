(function () {
  'use strict';

  // ---------- VK Bridge init (обязательно для открытия внутри VK) ----------
  // vkReady становится true только если VKWebAppInit реально ответил — то есть
  // мы точно внутри VK. Вне VK этот промис часто просто зависает без ответа,
  // поэтому НЕЛЬЗЯ ждать его для остального кода — используем как флаг.
  var vkReady = false;
  try {
    if (window.vkBridge) {
      vkBridge.send('VKWebAppInit').then(function () { vkReady = true; }).catch(function () {});
    }
  } catch (e) {
    // не в VK / bridge недоступен — продолжаем как обычную веб-страницу
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                    function (e) { clearTimeout(timer); reject(e); });
    });
  }

  // ---------- Состояние квиза храним только в памяти JS ----------
  var state = {
    step: 'start', // 'start' | 'question' | 'result'
    qIndex: 0,
    scores: { spark: 0, keeper: 0, game: 0, guide: 0, dreamer: 0 },
    resultKey: null
  };

  var appEl = document.getElementById('app');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Фоновая текстура из полупрозрачных хэштегов — фирменный приём бренда,
  // используется на обоих полноцветных экранах (старт и результат).
  // Каждая строка получает свой размер шрифта и прозрачность (по золотому
  // сечению — детерминированный, но визуально "случайный" разброс), чтобы
  // текстура читалась как лёгкая органичная деталь, а не ровная решётка.
  var HASHTAG_ROW_TEXT = new Array(16).fill('#ВожатыеЮга').join(' ');
  var HASHTAG_ROWS = 14;
  function hashtagBackdrop() {
    var rows = [];
    for (var i = 0; i < HASHTAG_ROWS; i++) {
      var tOpacity = (i * 0.618034) % 1;
      var tSize = (i * 0.381966) % 1;
      var opacity = (0.08 + tOpacity * 0.10).toFixed(3);
      var fontSize = Math.round(15 + tSize * 9);
      rows.push(el('div', {
        class: 'hashtag-row',
        text: HASHTAG_ROW_TEXT,
        style: 'opacity:' + opacity + ';font-size:' + fontSize + 'px'
      }));
    }
    var inner = el('div', { class: 'brand-hashtags-inner' }, rows);
    return el('div', { class: 'brand-hashtags', 'aria-hidden': 'true' }, [inner]);
  }

  // Каскадная подача элементов стартового экрана — только при самой первой
  // загрузке страницы (не при возврате на старт через "пройти заново").
  var introPlayed = false;

  // ---------- Экран старта ----------
  function renderStart() {
    var screen = el('div', { class: 'screen-hero' });
    var playIntro = !introPlayed;
    function enterCls(base, delayClass) {
      return playIntro ? base + ' enter-item ' + delayClass : base;
    }

    var hashtags = hashtagBackdrop();

    var decor = el('div', { class: 'hero-decor' }, [
      el('div', { class: 'hero-decor-scale' }, [
        el('span', { class: 'ring1' }), el('span', { class: 'ring2' }),
        el('span', { class: 'ring3' }), el('span', { class: 'ring4' }),
        el('span', { class: 'core' })
      ])
    ]);

    var top = el('div', { class: enterCls('hero-top', 'enter-d0') }, [
      el('div', { class: 'hero-badge', text: 'ШВ' }),
      el('div', { class: 'hero-brand', text: 'Школа вожатых Юга ЮФУ' })
    ]);

    var mid = el('div', { class: 'hero-mid' }, [
      el('div', { class: enterCls('hero-title', 'enter-d1'), text: 'Осень. Лето где-то рядом.' }),
      el('div', { class: enterCls('hero-text', 'enter-d2'), html: 'Учёба началась. Друзья рядом. Но чего-то не хватает.<br>Пройди квиз — узнай, какой ты вожатый.' })
    ]);

    var startBtn = el('button', { class: enterCls('btn-cta', 'enter-d3'), text: 'Начать', onclick: startQuiz });
    var bottom = el('div', { class: 'hero-bottom' }, [
      startBtn,
      el('div', { class: enterCls('hero-fine', 'enter-d4'), text: '7 вопросов · 2 минуты' })
    ]);

    screen.appendChild(hashtags);
    screen.appendChild(decor);
    screen.appendChild(top);
    screen.appendChild(mid);
    screen.appendChild(bottom);

    if (playIntro) {
      introPlayed = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { screen.classList.add('enter-run'); });
      });
    }

    return screen;
  }

  // Портальный переход: лента-цветок стремительно разрастается от своей
  // позиции на экране и закрывает viewport, одновременно меняя цвет
  // с бренд-красного на кремовый фон экрана вопроса. Экран вопроса уже
  // монтируется под этим слоем, поэтому после его удаления не видно
  // ни задержки, ни домигивания.
  function runPortalTransition(originEl, onMidpoint) {
    var supportsClip = !!(window.CSS && CSS.supports && CSS.supports('clip-path', 'circle(0px at 0px 0px)'));

    if (prefersReducedMotion() || !supportsClip) {
      appEl.style.transition = 'opacity .15s ease';
      appEl.style.opacity = '0';
      setTimeout(function () {
        onMidpoint();
        requestAnimationFrame(function () {
          appEl.style.opacity = '1';
          setTimeout(function () { appEl.style.transition = ''; appEl.style.opacity = ''; }, 200);
        });
      }, 150);
      return;
    }

    var rect = originEl ? originEl.getBoundingClientRect() : null;
    var originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    var startRadius = rect ? Math.max(rect.width, rect.height) / 2 : 10;
    var dx = Math.max(originX, window.innerWidth - originX);
    var dy = Math.max(originY, window.innerHeight - originY);
    var endRadius = Math.hypot(dx, dy) * 1.15;

    var overlay = document.createElement('div');
    overlay.className = 'portal-layer';
    var startClip = 'circle(' + startRadius + 'px at ' + originX + 'px ' + originY + 'px)';
    overlay.style.clipPath = startClip;
    overlay.style.webkitClipPath = startClip;
    overlay.style.backgroundColor = '#C4192B';
    document.body.appendChild(overlay);

    // Форсируем рефлоу — иначе браузер может схлопнуть старт и финиш
    // в один кадр и переход не заанимируется.
    // eslint-disable-next-line no-unused-expressions
    overlay.getBoundingClientRect();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var endClip = 'circle(' + endRadius + 'px at ' + originX + 'px ' + originY + 'px)';
        overlay.style.clipPath = endClip;
        overlay.style.webkitClipPath = endClip;
        overlay.style.backgroundColor = '#FDF6F3';
      });
    });

    onMidpoint();

    setTimeout(function () { overlay.remove(); }, 560);
  }

  function startQuiz() {
    var origin = document.querySelector('.hero-decor');
    runPortalTransition(origin, function () {
      state.step = 'question';
      state.qIndex = 0;
      state.scores = { spark: 0, keeper: 0, game: 0, guide: 0, dreamer: 0 };
      state.resultKey = null;
      render();
    });
  }

  function restartQuiz() {
    state.step = 'start';
    render();
  }

  // ---------- Экран вопроса ----------
  function renderQuestion() {
    var q = QUESTIONS[state.qIndex];
    var screen = el('div', { class: 'screen-question' });

    var head = el('div', { class: 'q-head' }, [
      el('div', { class: 'q-label', text: 'Вопрос ' + (state.qIndex + 1) + ' из ' + QUESTIONS.length }),
      el('button', { class: 'q-restart', text: 'заново', onclick: restartQuiz })
    ]);

    var dots = el('div', { class: 'q-dots' });
    QUESTIONS.forEach(function (_, i) {
      var cls = i < state.qIndex ? 'done' : (i === state.qIndex ? 'current' : '');
      dots.appendChild(el('span', { class: cls }));
    });

    var title = el('div', { class: 'q-title', text: q.text });

    var options = el('div', { class: 'q-options' });
    q.options.forEach(function (text, idx) {
      var btn = el('button', {
        class: 'q-option',
        onclick: function () { pickAnswer(idx); }
      }, [
        el('span', { class: 'dot' }),
        el('span', { text: text })
      ]);
      options.appendChild(btn);
    });

    screen.appendChild(head);
    screen.appendChild(dots);
    screen.appendChild(title);
    screen.appendChild(options);
    return screen;
  }

  function pickAnswer(optionIndex) {
    var archetype = ARCHETYPE_ORDER[optionIndex];
    state.scores[archetype] = (state.scores[archetype] || 0) + 1;

    if (state.qIndex + 1 >= QUESTIONS.length) {
      state.resultKey = computeResult();
      state.step = 'result';
    } else {
      state.qIndex += 1;
    }
    render();
  }

  function computeResult() {
    var best = ARCHETYPE_ORDER[0];
    ARCHETYPE_ORDER.forEach(function (key) {
      if ((state.scores[key] || 0) > (state.scores[best] || 0)) best = key;
    });
    return best;
  }

  // ---------- Экран результата ----------
  function renderResult() {
    var a = ARCHETYPES[state.resultKey];
    var screen = el('div', { class: 'screen-result' });
    screen.style.setProperty('--r-hex', a.color1);
    screen.style.setProperty('--r-deco', a.deco);
    screen.style.background = 'linear-gradient(150deg,' + a.color1 + ',' + a.color2 + ')';

    var hashtags = hashtagBackdrop();

    var decor = el('div', { class: 'result-decor' }, [
      el('div', { class: 'result-decor-scale' }, [
        el('span', { class: 'r1' }), el('span', { class: 'r2' }), el('span', { class: 'r3' })
      ])
    ]);

    var top = el('div', { class: 'result-top' }, [
      el('div', { class: 'result-eyebrow', text: 'Твой тип вожатого' }),
      el('div', { class: 'result-name', text: 'Ты — ' + a.name + '!' }),
      el('div', { class: 'result-desc', text: a.desc }),
      el('div', { class: 'result-note', html:
        'Кем бы ты ни был — все эти роли нужны в отряде.<br><br>' +
        'Осень — не конец лета. Это время подготовиться, чтобы следующее лето было самым ярким.<br><br>' +
        'Приглашаем тебя в Школу Вожатского Мастерства. Здесь ты найдёшь команду, прокачаешь себя и получишь путёвку в лето.'
      })
    ]);

    var communityLink = el('a', {
      class: 'btn-share', text: 'Вступить в Школу вожатых',
      href: COMMUNITY_URL, target: '_blank', rel: 'noopener'
    });
    var shareBtn = el('button', { class: 'btn-outline', text: 'Поделиться результатом', onclick: onShareClick });
    var restartBtn = el('button', { class: 'result-link', text: 'пройти заново', onclick: restartQuiz });

    var bottom = el('div', { class: 'result-bottom' }, [communityLink, shareBtn, restartBtn]);

    screen.appendChild(hashtags);
    screen.appendChild(decor);
    screen.appendChild(top);
    screen.appendChild(bottom);
    return screen;
  }

  // ---------- Шеринг результата ----------
  // Готовые картинки под каждый архетип (5 штук) лежат в share/img/ и
  // отдаются через собственную статическую страницу share/<key>.html —
  // там прописаны og:image/og:title, чтобы VK и другие клиенты сами
  // подтягивали красивую карточку по ссылке. Бэкенд и canvas не нужны.
  function archetypeShareUrl(key) { return SITE_URL + 'share/' + key + '.html'; }
  function archetypeImageUrl(key) { return SITE_URL + 'share/img/' + key + '.jpg'; }

  // Небольшой ненавязчивый тост для редких запасных сценариев шеринга
  function toast(message) {
    var node = el('div', { class: 'toast', text: message });
    document.body.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('show'); });
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () { node.remove(); }, 300);
    }, 3200);
  }

  // Запасной сценарий для сред без VK Bridge и без Web Share (в основном —
  // десктопные браузеры вне VK): показываем готовую картинку архетипа и
  // ссылку прямо в приложении, чтобы можно было скопировать и отправить вручную.
  function showShareFallback(key) {
    var existing = document.querySelector('.share-fallback-overlay');
    if (existing) existing.remove();

    var a = ARCHETYPES[key];
    var url = archetypeShareUrl(key);

    function close() { overlay.remove(); }

    function copyLink() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          toast('Ссылка скопирована — вставь её в сообщении ВКонтакте');
        }).catch(function () {
          toast('Не получилось скопировать — выдели ссылку вручную');
        });
      } else {
        toast('Не получилось скопировать — выдели ссылку вручную');
      }
    }

    var card = el('div', { class: 'share-fallback-card' }, [
      el('button', { class: 'sf-x', 'aria-label': 'Закрыть', text: '✕', onclick: close }),
      el('div', { class: 'sf-title', text: 'Отправь другу вручную' }),
      el('div', { class: 'sf-hint', text: 'Автоматически поделиться на этом устройстве нельзя — скопируй ссылку, дальше просто вставь её в сообщение или пост ВКонтакте.' }),
      el('img', { class: 'sf-img', src: archetypeImageUrl(key), alt: a.name }),
      el('div', { class: 'sf-text', text: url }),
      el('button', { class: 'sf-btn-primary', text: 'Скопировать ссылку', onclick: copyLink }),
      el('a', { class: 'sf-btn-secondary', text: 'Открыть картинку', href: archetypeImageUrl(key), target: '_blank', rel: 'noopener' }),
      el('button', { class: 'sf-close', text: 'Закрыть', onclick: close })
    ]);

    var overlay = el('div', {
      class: 'share-fallback-overlay',
      onclick: function (e) { if (e.target === overlay) close(); }
    }, [card]);

    document.body.appendChild(overlay);
  }

  function onShareClick() {
    var key = state.resultKey;
    var a = ARCHETYPES[key];
    var url = archetypeShareUrl(key);
    var title = 'Я — ' + a.name + '! А ты кто?';
    var text = a.desc + ' Пройди квиз и узнай свой тип вожатого.';

    // 1) Внутри VK — нативное окно «Поделиться» с этой ссылкой. VK сам
    // подтянет og:image/og:title со страницы и покажет готовую карточку.
    if (vkReady && window.vkBridge && typeof vkBridge.send === 'function') {
      withTimeout(vkBridge.send('VKWebAppShare', { link: url }), 4000)
        .catch(function () { showShareFallback(key); });
      return;
    }

    // 2) Обычный браузерный Web Share — делимся ссылкой и текстом
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url })
        .catch(function () { /* пользователь отменил шеринг */ });
      return;
    }

    // 3) Ничего из этого нет (десктопный браузер вне VK) — показываем
    // картинку и ссылку прямо в приложении
    showShareFallback(key);
  }

  // ---------- Рендер ----------
  function render() {
    appEl.innerHTML = '';
    var screen;
    if (state.step === 'start') screen = renderStart();
    else if (state.step === 'question') screen = renderQuestion();
    else screen = renderResult();
    appEl.appendChild(screen);
    window.scrollTo(0, 0);
  }

  render();
})();
