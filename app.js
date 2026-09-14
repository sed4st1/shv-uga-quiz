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

  // ---------- Экран старта ----------
  function renderStart() {
    var screen = el('div', { class: 'screen-hero' });

    var decor = el('div', { class: 'hero-decor' }, [
      el('span', { class: 'ring1' }), el('span', { class: 'ring2' }),
      el('span', { class: 'ring3' }), el('span', { class: 'ring4' }),
      el('span', { class: 'core' })
    ]);

    var top = el('div', { class: 'hero-top' }, [
      el('div', { class: 'hero-badge', text: 'ШВ' }),
      el('div', { class: 'hero-brand', text: 'Школа вожатых РОПО Юга' })
    ]);

    var mid = el('div', { class: 'hero-mid' }, [
      el('div', { class: 'hero-title', text: 'Осень. Лето где-то рядом.' }),
      el('div', { class: 'hero-text', html: 'Учёба началась. Друзья рядом. Но чего-то не хватает.<br>Пройди квиз — узнай, какой ты вожатый.' })
    ]);

    var startBtn = el('button', { class: 'btn-cta', text: 'Начать', onclick: startQuiz });
    var bottom = el('div', { class: 'hero-bottom' }, [
      startBtn,
      el('div', { class: 'hero-fine', text: '7 вопросов · 2 минуты' })
    ]);

    screen.appendChild(decor);
    screen.appendChild(top);
    screen.appendChild(mid);
    screen.appendChild(bottom);
    return screen;
  }

  function startQuiz() {
    state.step = 'question';
    state.qIndex = 0;
    state.scores = { spark: 0, keeper: 0, game: 0, guide: 0, dreamer: 0 };
    state.resultKey = null;
    render();
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

    var decor = el('div', { class: 'result-decor' }, [
      el('span', { class: 'r1' }), el('span', { class: 'r2' }), el('span', { class: 'r3' })
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

    screen.appendChild(decor);
    screen.appendChild(top);
    screen.appendChild(bottom);
    return screen;
  }

  // ---------- Генерация картинки-результата на canvas ----------
  function wrapText(ctx, text, maxWidth) {
    var words = text.split(' ');
    var lines = [];
    var current = '';
    words.forEach(function (word) {
      var test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function drawResultCanvas() {
    var a = ARCHETYPES[state.resultKey];
    var canvas = document.getElementById('result-canvas');
    var size = 1080;
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');

    // фон — градиент архетипа
    var grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, a.color1);
    grad.addColorStop(1, a.color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // декоративные кольца
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = a.deco;
    ctx.fillStyle = a.deco;

    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(size - 230, 330, 210, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(size - 230, 330, 110, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(size - 720, 460, 90, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // бренд-плашка
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 26px Oswald, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('ШКОЛА ВОЖАТЫХ РОПО ЮГА', 64, 92);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 28px Oswald, sans-serif';
    ctx.fillText('ТВОЙ ТИП ВОЖАТОГО', 64, 200);

    // имя архетипа
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 116px Oswald, sans-serif';
    var nameUpper = a.name.toUpperCase();
    ctx.fillText(nameUpper, 60, 340);

    // тег
    var tagPaddingX = 24;
    var tagY = 400;
    ctx.font = '600 28px Oswald, sans-serif';
    var tagWidth = ctx.measureText(a.tag.toUpperCase()).width + tagPaddingX * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, 60, tagY, tagWidth, 60, 30);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(a.tag.toUpperCase(), 60 + tagPaddingX, tagY + 40);

    // описание
    ctx.font = '500 34px Onest, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    var lines = wrapText(ctx, a.desc, size - 130);
    var lineY = 560;
    lines.forEach(function (line) {
      ctx.fillText(line, 64, lineY);
      lineY += 46;
    });

    // подпись-приглашение
    ctx.font = '700 40px Oswald, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('ПРИСОЕДИНЯЙСЯ К НАМ', 64, size - 140);

    ctx.font = '500 30px Onest, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(COMMUNITY_URL.replace('https://', ''), 64, size - 90);

    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png', 0.95);
    });
  }

  function fontsReady() {
    if (document.fonts && document.fonts.ready) {
      return document.fonts.ready.catch(function () {});
    }
    return Promise.resolve();
  }

  function shareText(a) {
    return 'Мой тип вожатого — ' + a.name + '. Пройди квиз и узнай свой — а потом' +
      ' вступай в Школу вожатых РОПО Юга: там как раз таких ищут. ' + COMMUNITY_URL;
  }

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

  // Запасной сценарий для сред без Web Share (в основном — десктопные браузеры):
  // показываем саму картинку и текст прямо в приложении, а не молча открываем
  // голый PNG в новой вкладке — так понятно, что делать дальше.
  function showShareFallback(text, blob) {
    var existing = document.querySelector('.share-fallback-overlay');
    if (existing) existing.remove();

    var imgUrl = blob ? URL.createObjectURL(blob) : null;

    function close() {
      overlay.remove();
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    }

    function downloadImage() {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = imgUrl;
      a.download = 'kakoi-ty-vozhatyi.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function copyText() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast('Текст скопирован — вставь его в сообщении ВКонтакте');
        }).catch(function () {
          toast('Не получилось скопировать — выдели текст вручную');
        });
      } else {
        toast('Не получилось скопировать — выдели текст вручную');
      }
    }

    var card = el('div', { class: 'share-fallback-card' }, [
      el('button', { class: 'sf-x', 'aria-label': 'Закрыть', text: '✕', onclick: close }),
      el('div', { class: 'sf-title', text: 'Отправь другу вручную' }),
      el('div', { class: 'sf-hint', text: 'Автоматически поделиться на этом устройстве нельзя — скачай картинку и скопируй текст, дальше просто вставь их в сообщение или пост ВКонтакте.' }),
      imgUrl ? el('img', { class: 'sf-img', src: imgUrl, alt: 'Результат квиза' }) : null,
      el('div', { class: 'sf-text', text: text }),
      el('button', { class: 'sf-btn-primary', text: 'Скачать картинку', onclick: downloadImage }),
      el('button', { class: 'sf-btn-secondary', text: 'Скопировать текст', onclick: copyText }),
      el('button', { class: 'sf-close', text: 'Закрыть', onclick: close })
    ]);

    var overlay = el('div', {
      class: 'share-fallback-overlay',
      onclick: function (e) { if (e.target === overlay) close(); }
    }, [card]);

    document.body.appendChild(overlay);
  }

  function onShareClick() {
    var a = ARCHETYPES[state.resultKey];
    var text = shareText(a);

    fontsReady().then(function () {
      var canvas = drawResultCanvas();
      return canvasToBlob(canvas);
    }).then(function (blob) {
      var file = blob ? new File([blob], 'kakoi-ty-vozhatyi.png', { type: 'image/png' }) : null;

      // 1) Полноценный шеринг картинки + текста (лучший случай на мобильных браузерах)
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file], title: 'Какой ты вожатый?', text: text })
          .catch(function () { /* пользователь отменил шеринг */ });
        return;
      }

      // 2) Веб Шеринг без файлов — просто текст со ссылкой на группу
      if (navigator.share) {
        navigator.share({ title: 'Какой ты вожатый?', text: text })
          .catch(function () { /* пользователь отменил шеринг */ });
        return;
      }

      // 3) Внутри VK, но файловый/текстовый Web Share недоступен — нативный шеринг ссылки от VK
      if (vkReady && window.vkBridge && typeof vkBridge.send === 'function') {
        withTimeout(vkBridge.send('VKWebAppShare', { link: COMMUNITY_URL }), 4000)
          .catch(function () { showShareFallback(text, blob); });
        return;
      }

      // 4) Совсем без Web Share API и не внутри VK (обычно — десктопный браузер)
      showShareFallback(text, blob);
    });
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
