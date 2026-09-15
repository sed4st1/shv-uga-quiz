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
  // answers — индекс выбранного варианта (0..4) для каждого вопроса,
  // null пока не отвечен. Баллы по архетипам всегда пересчитываются из
  // этого массива заново (computeResult), а не копятся отдельным
  // счётчиком — иначе шаг назад с изменением ответа было бы легко
  // рассинхронизировать со старым выбором.
  function emptyAnswers() { return new Array(QUESTIONS.length).fill(null); }

  var state = {
    step: 'start', // 'start' | 'question' | 'result'
    qIndex: 0,
    answers: emptyAnswers(),
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
      state.answers = emptyAnswers();
      state.resultKey = null;
      render();
    });
  }

  function restartQuiz() {
    state.step = 'start';
    state.qIndex = 0;
    state.answers = emptyAnswers();
    state.resultKey = null;
    render();
  }

  // Переход между экранами вопросов (и вопрос 1 <-> старт) — тот же
  // механизм в обе стороны, только зеркальный: вперёд уходит влево и
  // въезжает справа, назад — наоборот. Старый экран отсоединяется от
  // #app и доигрывает анимацию поверх уже смонтированного нового,
  // чтобы не ждать окончания выхода перед показом следующего шага.
  function slideQuestionTransition(direction, mutateAndRender) {
    if (prefersReducedMotion()) { mutateAndRender(); return; }

    var outClass = direction === 'forward' ? 'q-slide-exit-forward' : 'q-slide-exit-backward';
    var inClass = direction === 'forward' ? 'q-slide-enter-forward' : 'q-slide-enter-backward';

    var leaving = document.querySelector('.screen-question, .screen-hero');
    if (leaving) {
      document.body.appendChild(leaving); // отсоединяем от #app, не трогая содержимое
      leaving.classList.add('q-transition-exit-layer', outClass);
      setTimeout(function () { leaving.remove(); }, 220);
    }

    mutateAndRender();

    // Каскад входа результата (Часть 2) — самостоятельный "момент награды",
    // ему не нужна общая задвижка слайда поверх него.
    var entering = document.querySelector('.screen-question, .screen-hero');
    if (entering) {
      entering.classList.add(inClass);
      setTimeout(function () { entering.classList.remove(inClass); }, 220);
    }
  }

  // ---------- Экран вопроса ----------
  function renderQuestion() {
    var q = QUESTIONS[state.qIndex];
    var selected = state.answers[state.qIndex];
    var screen = el('div', { class: 'screen-question' });

    var head = el('div', { class: 'q-head' }, [
      el('div', { class: 'q-label', text: 'Вопрос ' + (state.qIndex + 1) + ' из ' + QUESTIONS.length }),
      el('button', { class: 'q-back', 'aria-label': 'Назад', text: '←', onclick: goBack })
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
        class: 'q-option' + (idx === selected ? ' selected' : ''),
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
    state.answers[state.qIndex] = optionIndex;

    if (state.qIndex + 1 >= QUESTIONS.length) {
      state.resultKey = computeResult();
      slideQuestionTransition('forward', function () {
        state.step = 'result';
        render();
      });
    } else {
      slideQuestionTransition('forward', function () {
        state.qIndex += 1;
        render();
      });
    }
  }

  // Шаг назад всегда доступен: с первого вопроса ведёт на старт (не прячем
  // и не блокируем стрелку). Полный сброс прогресса делает только
  // «пройти заново» на экране результата.
  function goBack() {
    if (state.qIndex === 0) {
      slideQuestionTransition('backward', function () {
        state.step = 'start';
        render();
      });
      return;
    }
    slideQuestionTransition('backward', function () {
      state.qIndex -= 1;
      render();
    });
  }

  function computeResult() {
    var scores = { spark: 0, keeper: 0, game: 0, guide: 0, dreamer: 0 };
    state.answers.forEach(function (optionIndex) {
      if (optionIndex === null || optionIndex === undefined) return;
      var key = ARCHETYPE_ORDER[optionIndex];
      scores[key] = (scores[key] || 0) + 1;
    });
    var best = ARCHETYPE_ORDER[0];
    ARCHETYPE_ORDER.forEach(function (key) {
      if ((scores[key] || 0) > (scores[best] || 0)) best = key;
    });
    return best;
  }

  // ---------- Экран результата ----------
  // Декоративный фоновый слой результата — берёт визуальный язык
  // референс-карточек (орбитальные кольца со спутниками, мерцающие
  // звёзды, зерно, световой луч, точечная сетка) и оживляет его. Цвет
  // везде — var(--r-deco), подставленный на .screen-result, поэтому под
  // архетип подстраивается само.
  function resultDecorLayer() {
    var grain = el('div', { class: 'result-grain', 'aria-hidden': 'true' });
    var beam = el('div', { class: 'result-beam', 'aria-hidden': 'true' });
    var dotgrid = el('div', { class: 'result-dotgrid', 'aria-hidden': 'true' },
      new Array(6).fill(0).map(function () { return el('span', {}); })
    );

    var ringSpecs = [
      { w: 340, h: 220, top: '6%', left: '46%', rot: -22 },
      { w: 250, h: 165, top: '30%', left: '58%', rot: 18 },
      { w: 190, h: 130, top: '54%', left: '30%', rot: 42 }
    ];
    var rings = ringSpecs.map(function (r) {
      return el('div', {
        class: 'orbit-ring',
        style: 'width:' + r.w + 'px;height:' + r.h + 'px;top:' + r.top + ';left:' + r.left +
          ';transform:rotate(' + r.rot + 'deg);'
      }, [el('span', { class: 'orbit-dot' })]);
    });
    var orbitsSpin = el('div', { class: 'result-orbits-spin' }, rings);
    var orbits = el('div', { class: 'result-orbits', 'aria-hidden': 'true' }, [orbitsSpin]);

    var starSpecs = [
      { top: '12%', left: '20%', size: 16, dur: 3.2, delay: 0 },
      { top: '20%', left: '82%', size: 22, dur: 3.7, delay: 80 },
      { top: '46%', left: '88%', size: 14, dur: 3.4, delay: 160 },
      { top: '66%', left: '12%', size: 18, dur: 4.1, delay: 240 },
      { top: '78%', left: '70%', size: 12, dur: 3.9, delay: 320 },
      { top: '38%', left: '8%', size: 20, dur: 3.5, delay: 400 }
    ];
    var stars = starSpecs.map(function (s) {
      return el('div', {
        class: 'result-star',
        style: 'top:' + s.top + ';left:' + s.left + ';width:' + s.size + 'px;height:' + s.size + 'px;' +
          'animation-duration:' + s.dur + 's;animation-delay:' + s.delay + 'ms;',
        html: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/></svg>'
      });
    });
    var starsLayer = el('div', { class: 'result-stars', 'aria-hidden': 'true' }, stars);

    return [grain, beam, orbits, starsLayer, dotgrid];
  }

  function renderResult() {
    var a = ARCHETYPES[state.resultKey];
    var screen = el('div', { class: 'screen-result' });
    screen.style.setProperty('--r-hex', a.color1);
    screen.style.setProperty('--r-deco', a.deco);
    screen.style.background = 'linear-gradient(150deg,' + a.color1 + ',' + a.color2 + ')';

    var hashtags = hashtagBackdrop();
    var decorLayer = resultDecorLayer();

    var decor = el('div', { class: 'result-decor' }, [
      el('div', { class: 'result-decor-scale' }, [
        el('span', { class: 'r1' }), el('span', { class: 'r2' }), el('span', { class: 'r3' })
      ])
    ]);

    // Каскад текстового блока — та же механика, что на старте (enter-item
    // + enter-run), но с отдельными, более поздними задержками: должен
    // начаться уже после того, как отрисуются орбиты и соберётся "созвездие"
    // звёзд, а не одновременно с ними.
    var top = el('div', { class: 'result-top' }, [
      el('div', { class: 'result-eyebrow enter-item result-enter-d0', text: 'Твой тип вожатого' }),
      el('div', { class: 'result-name enter-item result-enter-d1', text: 'Ты — ' + a.name + '!' }),
      el('div', { class: 'result-desc enter-item result-enter-d2', text: a.desc }),
      el('div', { class: 'result-note enter-item result-enter-d3', html:
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

    var bottom = el('div', { class: 'result-bottom enter-item result-enter-d4' }, [communityLink, shareBtn, restartBtn]);

    screen.appendChild(hashtags);
    decorLayer.forEach(function (node) { screen.appendChild(node); });
    screen.appendChild(decor);
    screen.appendChild(top);
    screen.appendChild(bottom);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { screen.classList.add('enter-run'); });
    });

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
