(function () {
        'use strict';
        var $ = function (id) { return document.getElementById(id); };

        /* ============ データ ============ */
        var SCRIPTS = {
          a: [
            { src: 'audio/script-a1.mp3', gap: 2.2 },
            { src: 'audio/script-a2.mp3', gap: 3.2 },
            { src: 'audio/script-a3.mp3', gap: 2.8 },
            { src: 'audio/script-a4.mp3', gap: 0 }
          ],
          b: [
            { src: 'audio/script-b1.mp3', gap: 2.2 },
            { src: 'audio/script-b2.mp3', gap: 3.2 },
            { src: 'audio/script-b3.mp3', gap: 2.8 },
            { src: 'audio/script-b4.mp3', gap: 0 }
          ],
          c: [
            { src: 'audio/script-c1.mp3', gap: 3.2 },
            { src: 'audio/script-c2.mp3', gap: 3.2 },
            { src: 'audio/script-c3.mp3', gap: 0 }
          ]
        };
        var CALLERS = {
          miruku: { name: 'ミルク', photo: 'images/miruku.jpg', initial: '', color: '#f3e2c7' },
          yui:    { name: 'ゆい', photo: null, initial: 'ゆ', color: '#e58bb1' },
          tanaka: { name: '田中さん', photo: null, initial: '田', color: '#5b7fa6' },
          custom: { name: '', photo: null, initial: '？', color: '#8e8e93' }
        };

        /* ============ 状態 ============ */
        var state = {
          caller: 'miruku',
          script: 'b',
          delay: 3,
          customPhotoURL: null,
          standbyTimer: null,
          ringTimeout: null,
          vibTimer: null,
          callTimer: null,
          callSeconds: 0,
          seqToken: 0,
          wakeLock: null,
          armed: false,
          recBlobURL: null
        };

        var ringtone = $('ringtone');
        var voice = $('voice');
        var recplay = $('recplay');

        /* ============ 画面遷移 ============ */
        function show(id) {
          var screens = document.querySelectorAll('.screen');
          for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
          $(id).classList.add('active');
        }
        var toastTimer = null;
        function toast(msg) {
          var t = $('toast');
          t.textContent = msg;
          t.classList.add('show');
          clearTimeout(toastTimer);
          toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
        }

        /* ============ ステータスバーの時計 ============ */
        function tickClock() {
          var d = new Date();
          var s = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
          var els = document.querySelectorAll('.sb-time');
          for (var i = 0; i < els.length; i++) els[i].textContent = s;
        }
        tickClock();
        setInterval(tickClock, 10000);

        /* ============ 選択UI ============ */
        function wireRows(listId, rowClass, key, onChange) {
          var rows = document.querySelectorAll('#' + listId + ' .' + rowClass);
          rows.forEach(function (row) {
            row.addEventListener('click', function () {
              rows.forEach(function (r) { r.classList.remove('selected'); });
              row.classList.add('selected');
              state[key] = row.getAttribute('data-' + (key === 'caller' ? 'caller' : 'script'));
              if (onChange) onChange(state[key]);
            });
          });
        }
        wireRows('caller-list', 'caller-row', 'caller', function (v) {
          $('custom-caller-fields').hidden = v !== 'custom';
        });
        wireRows('script-list', 'script-row', 'script', function (v) {
          $('custom-text-wrap').hidden = v !== 'd';
          $('record-wrap').hidden = v !== 'e';
          stopPreview();
        });
        var chips = document.querySelectorAll('#delay-chips .chip');
        chips.forEach(function (chip) {
          chip.addEventListener('click', function () {
            chips.forEach(function (c) { c.classList.remove('selected'); });
            chip.classList.add('selected');
            state.delay = parseInt(chip.getAttribute('data-delay'), 10);
          });
        });

        /* カスタム写真 */
        $('custom-photo').addEventListener('change', function (e) {
          var f = e.target.files && e.target.files[0];
          if (!f) return;
          if (state.customPhotoURL) URL.revokeObjectURL(state.customPhotoURL);
          state.customPhotoURL = URL.createObjectURL(f);
          var prev = $('custom-avatar-preview');
          prev.innerHTML = '';
          var img = document.createElement('img');
          img.src = state.customPhotoURL;
          img.alt = '';
          prev.appendChild(img);
        });

        /* ============ 試聴（シナリオ再生） ============ */
        var previewBtn = null;
        function stopPreview() {
          state.seqToken++;
          voice.pause();
          voice.removeAttribute('src');
          if (previewBtn) {
            previewBtn.classList.remove('playing');
            previewBtn.textContent = '試聴';
            previewBtn = null;
          }
        }
        function playSequence(items, token, onDone) {
          var i = 0;
          function next() {
            if (token !== state.seqToken) return;
            if (i >= items.length) { if (onDone) onDone(); return; }
            var item = items[i++];
            voice.src = item.src;
            voice.onended = function () {
              if (token !== state.seqToken) return;
              if (item.gap > 0) setTimeout(function () { if (token === state.seqToken) next(); }, item.gap * 1000);
              else next();
            };
            voice.onerror = function () { next(); };
            var p = voice.play();
            if (p && p.catch) p.catch(function () { next(); });
          }
          next();
        }
        document.querySelectorAll('.preview-btn').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var key = btn.getAttribute('data-preview');
            if (previewBtn === btn) { stopPreview(); return; }
            stopPreview();
            previewBtn = btn;
            btn.classList.add('playing');
            btn.textContent = '停止';
            var token = ++state.seqToken;
            playSequence(SCRIPTS[key], token, function () {
              if (previewBtn === btn) stopPreview();
            });
          });
        });

        /* ============ 録音（E） ============ */
        var mediaRecorder = null, recChunks = [], recStream = null, recSeconds = 0, recTimer = null;
        var recBtn = $('rec-btn'), recLabel = $('rec-btn-label'), recStatus = $('rec-status');
        function fmt(sec) { return ('0' + Math.floor(sec / 60)).slice(-2) + ':' + ('0' + (sec % 60)).slice(-2); }
        recBtn.addEventListener('click', function () {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            return;
          }
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
            recStatus.textContent = 'この端末では録音に対応していません';
            return;
          }
          navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            recStream = stream;
            recChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = function (ev) { if (ev.data.size) recChunks.push(ev.data); };
            mediaRecorder.onstop = function () {
              recStream.getTracks().forEach(function (t) { t.stop(); });
              clearInterval(recTimer);
              recBtn.classList.remove('recording');
              recLabel.textContent = '録り直す';
              if (state.recBlobURL) URL.revokeObjectURL(state.recBlobURL);
              var blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/mp4' });
              state.recBlobURL = URL.createObjectURL(blob);
              recplay.src = state.recBlobURL;
              recStatus.textContent = '録音できました（' + fmt(recSeconds) + '）';
              $('play-rec-btn').hidden = false;
            };
            mediaRecorder.start();
            recSeconds = 0;
            recBtn.classList.add('recording');
            recLabel.textContent = '録音中… タップで停止';
            recStatus.textContent = '00:00';
            recTimer = setInterval(function () {
              recSeconds++;
              recStatus.textContent = fmt(recSeconds) + ' 録音中';
              if (recSeconds >= 90 && mediaRecorder.state === 'recording') mediaRecorder.stop();
            }, 1000);
          }).catch(function () {
            recStatus.textContent = 'マイクの許可が必要です（ブラウザの設定で許可してください）';
          });
        });
        $('play-rec-btn').addEventListener('click', function () {
          if (!state.recBlobURL) return;
          if (!recplay.paused) { recplay.pause(); this.textContent = '▶ 録音を聞く'; return; }
          this.textContent = '⏸ 停止';
          var self = this;
          recplay.onended = function () { self.textContent = '▶ 録音を聞く'; };
          recplay.currentTime = 0;
          recplay.play();
        });

        /* ============ 発信者情報の解決 ============ */
        function currentCaller() {
          var c = CALLERS[state.caller];
          if (state.caller === 'custom') {
            var name = $('custom-name').value.trim();
            return {
              name: name || 'カスタム',
              photo: state.customPhotoURL,
              initial: (name || '？').charAt(0),
              color: '#8e8e93'
            };
          }
          return c;
        }
        function paintCaller() {
          var c = currentCaller();
          $('in-name').textContent = c.name;
          $('call-name').textContent = c.name;
          var photo = $('in-photo');
          photo.innerHTML = '';
          photo.style.background = c.color;
          if (c.photo) {
            var img = document.createElement('img');
            img.src = c.photo;
            img.alt = c.name;
            photo.appendChild(img);
            $('in-bg').style.backgroundImage = 'url("' + c.photo + '")';
            $('call-bg').style.backgroundImage = 'url("' + c.photo + '")';
          } else {
            photo.textContent = c.initial;
            $('in-bg').style.backgroundImage = 'none';
            $('call-bg').style.backgroundImage = 'none';
          }
        }

        /* ============ オーディオのアンロック ============ */
        function primeAudio() {
          [ringtone, voice, recplay].forEach(function (el) {
            try {
              el.muted = true;
              var p = el.play();
              if (p && p.then) {
                p.then(function () { el.pause(); el.currentTime = 0; el.muted = false; })
                 .catch(function () { el.muted = false; });
              } else { el.pause(); el.muted = false; }
            } catch (e) { el.muted = false; }
          });
        }

        /* ============ PWA：フルスクリーン起動まわり ============ */
        function isStandalone() {
          if (window.navigator.standalone === true) return true;
          try {
            return window.matchMedia('(display-mode: fullscreen)').matches ||
                   window.matchMedia('(display-mode: standalone)').matches;
          } catch (e) { return false; }
        }
        function refreshInstallUI() {
          var standalone = isStandalone();
          document.body.classList.toggle('standalone', standalone);
          $('install-guide').hidden = standalone;
          $('install-done').hidden = !standalone;
          if (!standalone) {
            var ua = window.navigator.userAgent || '';
            var isIOS = /iphone|ipad|ipod/i.test(ua) ||
              (/macintosh/i.test(ua) && 'ontouchend' in document);
            var isAndroid = /android/i.test(ua);
            $('install-steps-ios').hidden = !isIOS;
            $('install-steps-android').hidden = isIOS || !isAndroid;
            $('install-steps-other').hidden = isIOS || isAndroid;
          }
        }
        /* Android / Chrome のインストールプロンプト */
        var deferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', function (e) {
          e.preventDefault();
          deferredInstallPrompt = e;
          if (!isStandalone()) $('btn-install').hidden = false;
        });
        $('btn-install').addEventListener('click', function () {
          if (!deferredInstallPrompt) return;
          var p = deferredInstallPrompt;
          deferredInstallPrompt = null;
          $('btn-install').hidden = true;
          /* beforeinstallprompt の表示メソッド（ブラウザ標準のインストールUI） */
          var showInstallUI = p['prompt'];
          if (showInstallUI) showInstallUI.call(p);
          if (p.userChoice && p.userChoice.then) {
            p.userChoice.then(function () { refreshInstallUI(); }).catch(function () {});
          }
        });
        window.addEventListener('appinstalled', function () { refreshInstallUI(); });
        try {
          window.matchMedia('(display-mode: standalone)').addEventListener('change', refreshInstallUI);
          window.matchMedia('(display-mode: fullscreen)').addEventListener('change', refreshInstallUI);
        } catch (e) {}
        document.addEventListener('fullscreenchange', function () {
          document.body.classList.toggle('fs-active', !!document.fullscreenElement);
        });
        refreshInstallUI();

        /* ブラウザ表示のときは「セット」のタップを契機に全画面化を試みる
           （iPhone Safari はこのAPIが無いので、その場合はホーム画面追加が本命） */
        function requestAppFullscreen() {
          if (isStandalone() || document.fullscreenElement) return;
          var el = document.documentElement;
          var req = el.requestFullscreen || el.webkitRequestFullscreen;
          if (!req) return;
          try {
            var r = req.call(el, { navigationUI: 'hide' });
            if (r && r.catch) {
              r.catch(function () {
                try { var r2 = req.call(el); if (r2 && r2.catch) r2.catch(function () {}); } catch (e) {}
              });
            }
            if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
              setTimeout(function () {
                try { var lp = window.screen.orientation.lock('portrait'); if (lp && lp.catch) lp.catch(function () {}); } catch (e) {}
              }, 60);
            }
          } catch (e) {}
        }

        /* サービスワーカー登録（音声・画像などのアセットをキャッシュして読み込みを速くする。
           静的配信の都合で SW は assets/ 配下に置くため、効く範囲はアセットのみ。
           フルスクリーン起動そのものはマニフェスト＋Apple用メタタグ側で効く） */
        if ('serviceWorker' in window.navigator) {
          window.addEventListener('load', function () {
            window.navigator.serviceWorker.register('sw.js').catch(function () {});
          });
        }

        /* 画面が裏に回って WakeLock が落ちたら、セット中だけ取り直す */
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible' || !state.armed) return;
          if (state.wakeLock) return;
          if (navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').then(function (wl) { state.wakeLock = wl; }).catch(function () {});
          }
        });

        /* ============ セット → 待機 ============ */
        $('btn-set').addEventListener('click', function () {
          stopPreview();
          if (state.script === 'e' && !state.recBlobURL) {
            toast('先にセリフを録音してください');
            return;
          }
          if (state.script === 'd' && !$('custom-text').value.trim()) {
            toast('読み上げる文章を入力してください');
            return;
          }
          primeAudio();
          requestAppFullscreen();
          state.armed = true;
          paintCaller();
          show('scr-standby');
          if (navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').then(function (wl) { state.wakeLock = wl; }).catch(function () {});
          }
          state.standbyTimer = setTimeout(startRinging, state.delay * 1000);
        });
        $('scr-standby').addEventListener('click', function () {
          clearTimeout(state.standbyTimer);
          state.armed = false;
          releaseWakeLock();
          show('scr-setup');
        });
        function releaseWakeLock() {
          if (state.wakeLock) { try { state.wakeLock.release(); } catch (e) {} state.wakeLock = null; }
        }

        /* ============ 着信 ============ */
        function startRinging() {
          show('scr-incoming');
          resetSlide();
          ringtone.currentTime = 0;
          var p = ringtone.play();
          if (p && p.catch) p.catch(function () {});
          if (navigator.vibrate) {
            var vib = function () { navigator.vibrate([900, 600]); };
            vib();
            state.vibTimer = setInterval(vib, 1600);
          }
          state.ringTimeout = setTimeout(function () { endRinging(false); }, 45000);
        }
        function stopRinging() {
          ringtone.pause();
          try { ringtone.currentTime = 0; } catch (e) {}
          clearInterval(state.vibTimer);
          if (navigator.vibrate) navigator.vibrate(0);
          clearTimeout(state.ringTimeout);
        }
        function endRinging(answered) {
          stopRinging();
          hideSheet();
          if (!answered) state.armed = false;
          releaseWakeLock();
          if (!answered) {
            show('scr-setup');
            toast('応答がなかったので終了しました');
          }
        }

        /* ----- スライドで応答 ----- */
        var knob = $('slide-knob'), track = $('slide-track'), label = $('slide-label');
        var dragging = false, startX = 0, curX = 0, moved = 0;
        function maxSlide() { return track.clientWidth - knob.offsetWidth - 10; }
        function resetSlide() {
          knob.style.transition = '';
          knob.style.transform = 'translateX(0px)';
          label.style.opacity = '1';
        }
        knob.addEventListener('pointerdown', function (e) {
          dragging = true; moved = 0;
          startX = e.clientX - curX;
          knob.style.transition = 'none';
          knob.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        knob.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          var x = e.clientX - startX;
          moved = Math.max(moved, Math.abs(x - curX));
          curX = Math.max(0, Math.min(x, maxSlide()));
          knob.style.transform = 'translateX(' + curX + 'px)';
          label.style.opacity = String(1 - (curX / maxSlide()) * 1.4);
        });
        function knobRelease() {
          if (!dragging) return;
          dragging = false;
          var wasTap = moved < 8;
          if (wasTap || curX > maxSlide() * 0.6) {
            curX = 0;
            answerCall();
          } else {
            curX = 0;
            knob.style.transition = 'transform .3s cubic-bezier(.2,.8,.3,1)';
            resetSlide();
          }
        }
        knob.addEventListener('pointerup', knobRelease);
        knob.addEventListener('pointercancel', knobRelease);

        /* ----- あとで / メッセージ シート ----- */
        var sheet = $('sheet'), veil = $('sheet-veil');
        function openSheet(title, options) {
          $('sheet-title').textContent = title;
          var box = $('sheet-options');
          box.innerHTML = '';
          options.forEach(function (opt) {
            var b = document.createElement('button');
            b.textContent = opt;
            b.addEventListener('click', function () { endRinging(false); });
            box.appendChild(b);
          });
          sheet.hidden = false;
          veil.hidden = false;
        }
        function hideSheet() { sheet.hidden = true; veil.hidden = true; }
        $('btn-remind').addEventListener('click', function () {
          openSheet('あとで通知', ['この場所を出たら', '1時間後']);
        });
        $('btn-message').addEventListener('click', function () {
          openSheet('メッセージで返信', ['あとでかけ直します', '今、向かっています', 'ごめん、今は話せません']);
        });
        $('sheet-cancel').addEventListener('click', hideSheet);
        veil.addEventListener('click', hideSheet);

        /* ============ 応答 → 通話 ============ */
        function answerCall() {
          endRinging(true);
          show('scr-incall');
          /* 通話中も画面が消えないように WakeLock を取り直す */
          if (navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').then(function (wl) { state.wakeLock = wl; }).catch(function () {});
          }
          state.callSeconds = 0;
          $('call-timer').textContent = '00:00';
          $('keypad-display').textContent = '';
          $('keypad-view').classList.remove('show');
          $('incall-grid').style.display = '';
          setToggle($('ctl-mute'), false);
          setToggle($('ctl-speaker'), false);
          state.callTimer = setInterval(function () {
            state.callSeconds++;
            $('call-timer').textContent = fmt(state.callSeconds);
          }, 1000);
          var token = ++state.seqToken;
          setTimeout(function () {
            if (token === state.seqToken) startVoice(token);
          }, 700);
        }
        function startVoice(token) {
          if (state.script === 'd') { speakCustom(token); return; }
          if (state.script === 'e') {
            if (!state.recBlobURL) return;
            voice.src = state.recBlobURL;
            voice.onended = null;
            voice.play().catch(function () {});
            return;
          }
          playSequence(SCRIPTS[state.script], token, null);
        }

        /* カスタム文章の読み上げ */
        function speakCustom(token) {
          if (!('speechSynthesis' in window)) return;
          var lines = $('custom-text').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
          var i = 0;
          var voices = window.speechSynthesis.getVoices();
          var jaVoice = null;
          for (var v = 0; v < voices.length; v++) {
            if (voices[v].lang && voices[v].lang.indexOf('ja') === 0) { jaVoice = voices[v]; break; }
          }
          function nextLine() {
            if (token !== state.seqToken || i >= lines.length) return;
            var u = new SpeechSynthesisUtterance(lines[i++]);
            u.lang = 'ja-JP';
            if (jaVoice) u.voice = jaVoice;
            u.rate = 1.0;
            u.onend = function () {
              if (token === state.seqToken) setTimeout(nextLine, 2500);
            };
            u.onerror = function () {
              if (token === state.seqToken) setTimeout(nextLine, 600);
            };
            window.speechSynthesis.speak(u);
          }
          nextLine();
        }
        if ('speechSynthesis' in window) {
          window.speechSynthesis.getVoices();
          window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
        }

        /* ============ 通話コントロール ============ */
        function setToggle(btn, on) {
          btn.classList.toggle('on', on);
          var slash = btn.querySelector('.mute-slash');
          if (slash) slash.style.display = on ? '' : 'none';
        }
        $('ctl-mute').addEventListener('click', function () {
          setToggle(this, !this.classList.contains('on'));
        });
        $('ctl-speaker').addEventListener('click', function () {
          var on = !this.classList.contains('on');
          setToggle(this, on);
          voice.volume = on ? 1.0 : 0.85;
        });
        ['ctl-facetime', 'ctl-contacts', 'ctl-add'].forEach(function (id) {
          $(id).addEventListener('click', function () {
            var self = this;
            self.classList.add('on');
            setTimeout(function () { self.classList.remove('on'); }, 350);
          });
        });
        $('ctl-keypad').addEventListener('click', function () {
          $('incall-grid').style.display = 'none';
          $('keypad-view').classList.add('show');
        });
        $('keypad-hide').addEventListener('click', function () {
          $('keypad-view').classList.remove('show');
          $('incall-grid').style.display = '';
        });
        var KEYS = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
        var kg = $('keypad-grid');
        KEYS.forEach(function (k) {
          var b = document.createElement('button');
          b.className = 'key-btn';
          b.innerHTML = '<span class="k-num">' + k[0] + '</span>' + (k[1] ? '<span class="k-sub">' + k[1] + '</span>' : '');
          b.addEventListener('click', function () {
            var d = $('keypad-display');
            if (d.textContent.length < 18) d.textContent += k[0];
          });
          kg.appendChild(b);
        });

        /* ============ 終了 ============ */
        $('btn-end').addEventListener('click', function () {
          state.seqToken++;
          state.armed = false;
          voice.pause();
          voice.removeAttribute('src');
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
          clearInterval(state.callTimer);
          stopRinging();
          releaseWakeLock();
          $('end-dur').textContent = '通話時間 ' + fmt(state.callSeconds);
          show('scr-ended');
          setTimeout(function () { show('scr-setup'); }, 1600);
        });
      })();