/*
 * UA-джерела для Lampa: один плагін, кілька провайдерів (порт з cloudstream-extensions-uk).
 * Провайдери: UAFlix, UASerialsPro. Додати новий = додати ще один блок PROVIDERS.push(...).
 * Код навмисно в старому стилі JS (var, function, XHR) для старих webOS.
 *
 * УВАГА: API Лампи використано по пам'яті, провайдери не перевірені на живих сайтах.
 */
(function () {
    'use strict';

    if (window.uaflix_plugin) return;
    window.uaflix_plugin = true;

    // Адреса проксі (див. worker.js)
    var PROXY = 'https://uaflix-proxy.vercel.app/api';


    var PROVIDERS = [];

    // =====================================================================
    // Спільне
    // =====================================================================

    function px(url, ref, post) {
        if (!PROXY) return url;
        return PROXY + '?url=' + encodeURIComponent(url) +
            (ref ? '&ref=' + encodeURIComponent(ref) : '') +
            (post !== undefined ? '&method=POST&body=' + encodeURIComponent(post) : '');
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { console.log('UA:', text); }
    }

    // Червона смужка зверху, не залежить від Lampa.Noty
    function banner(text, ms) {
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c62828;color:#fff;padding:10px;font:16px sans-serif;text-align:center';
            d.textContent = text;
            (document.body || document.documentElement).appendChild(d);
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 7000);
        } catch (e) { }
    }

    function err(prov, e) {
        if (e) banner(prov + ': ' + e, 12000);
    }

    function fixUrl(u, base) {
        if (!u) return '';
        u = u.trim();
        if (u.indexOf('//') === 0) return 'https:' + u;
        if (u.indexOf('/') === 0) return (base || '') + u;
        return u;
    }

    var lastMeta = {};

    function http(url, ref, ok, fail, post) {
        var origin = (/^https?:\/\/[^\/]+/.exec(url) || [''])[0];
        var xhr = new XMLHttpRequest();
        xhr.open('GET', px(url, ref || origin + '/', post), true);
        xhr.timeout = 20000;
        xhr.onload = function () {
            lastMeta = {
                finalUrl: xhr.getResponseHeader('X-Final-Url') || '',
                status: xhr.getResponseHeader('X-Upstream-Status') || String(xhr.status)
            };
            if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
            else fail('HTTP ' + xhr.status);
        };
        xhr.onerror = function () { fail('мережа/CORS'); };
        xhr.ontimeout = function () { fail('таймаут'); };
        xhr.send();
    }

    function parseHtml(text) {
        return new DOMParser().parseFromString(text, 'text/html');
    }

    // Діагностика: що віддала сторінка плеєра, коли в ній не знайшлося file
    function diagFile(prov, url, html) {
        var d = parseHtml(html);
        var ctx = [], re = /file/ig, m, n = 0;
        while ((m = re.exec(html)) && n < 2) {
            ctx.push(html.substr(Math.max(0, m.index - 20), 80).replace(/\s+/g, ' '));
            n++;
        }
        banner(prov + ': сторінка плеєра без file. ' + url +
            ' | довжина: ' + html.length +
            ' | кінцевий URL: ' + (lastMeta.finalUrl || '?') + ' (статус ' + (lastMeta.status || '?') + ')' +
            ' | file у HTML: ' + (ctx.join(' // ') || 'нема') +
            ' | title: ' + ((d.querySelector('title') || {}).textContent || '').slice(0, 50) +
            ' | текст: ' + (d.body ? d.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 150) : ''), 25000);
    }

    function stripSeo(t) {
        return (t || '').replace(/(?:\s+(?:дивитись|дивитися)\s+онлайн|\s+українською)+\s*$/i, '').trim();
    }

    // "[Українські (UA)]https://...vtt,[EN]https://..." -> [{label,url}]
    function parseSubs(raw, base) {
        var out = [];
        if (!raw) return out;
        var parts = raw.split(/,(?=\[)/);
        for (var i = 0; i < parts.length; i++) {
            var v = parts[i].trim();
            if (v.charAt(0) !== '[') continue;
            var end = v.indexOf(']');
            if (end <= 1) continue;
            var label = v.substring(1, end).trim();
            var url = v.substring(end + 1).trim().replace(/,+$/, '');
            if (!label || !/^(https?:)?\/\//i.test(url)) continue;
            out.push({ label: label, url: fixUrl(url, base) });
        }
        return out;
    }

    // Читає значення file: '...' до закриваючої лапки того ж типу
    function extractFile(js) {
        var m = /file\s*:\s*(['"])/.exec(js);
        if (!m) return '';
        var q = m[1], out = '';
        for (var i = m.index + m[0].length; i < js.length; i++) {
            var c = js.charAt(i);
            if (c === '\\') {
                var n = js.charAt(i + 1);
                if (n === q || n === '\\' || n === '/') { out += n; i++; continue; }
                out += c;
                continue;
            }
            if (c === q) break;
            out += c;
        }
        return out;
    }

    // Сторінка плеєра з file: '...' (tortuga/zetvideo) -> вузол дерева.
    // Деякі хостинги віддають заглушку залежно від Referer, тому пробуємо кілька варіантів.
    function resolveFilePlayer(playerUrl, siteBase, playRef, ok, fail, pageUrl) {
        var refs = [siteBase + '/', pageUrl || siteBase, siteBase];
        (function tryRef(ri) {
            http(playerUrl, refs[ri], function (html) {
                var doc = parseHtml(html);
                var scripts = doc.querySelectorAll('script');
                var js = '';
                for (var i = 0; i < scripts.length; i++) js += scripts[i].textContent + '\n';

                var file = extractFile(js);
                if (!file) {
                    if (ri + 1 < refs.length) return tryRef(ri + 1);
                    diagFile('Плеєр', playerUrl, html);
                    return fail(null);
                }

                var subM = /subtitle\s*:\s*['"]([^'"]*)['"]/.exec(js);
                var subs = parseSubs(subM ? subM[1] : '', siteBase);

                if (file.charAt(0) === '[') {
                    var dubs;
                    try { dubs = JSON.parse(file); } catch (e) { return fail('не вдалось розібрати список озвучок'); }
                    return ok({
                        label: 'Озвучка',
                        children: dubs.map(function (d) {
                            return {
                                title: d.title || 'Озвучка',
                                label: 'Сезон',
                                children: (d.folder || []).map(function (sn) {
                                    return {
                                        title: sn.title || 'Сезон',
                                        label: 'Серія',
                                        children: (sn.folder || []).map(function (ep) {
                                            return { title: ep.title || 'Серія', play: { url: ep.file, ref: playRef, subs: parseSubs(ep.subtitle, siteBase) } };
                                        })
                                    };
                                })
                            };
                        })
                    });
                }
                ok({ play: { url: file, ref: playRef, subs: subs } });
            }, fail);
        })(0);
    }

    // =====================================================================
    // Інтерфейс: вибір зі списку, дерево "озвучка → сезон → серія", запуск плеєра
    // =====================================================================

    function select(title, list, cb) {
        var prev = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: title,
            items: list,
            onSelect: function (a) { cb(a.item); },
            onBack: function () { Lampa.Controller.toggle(prev); }
        });
    }

    // list: [{title, item}]. force = показувати список навіть для одного елемента
    function pick(title, list, cb, force) {
        if (!list.length) return noty('Нічого не знайдено');
        if (list.length === 1 && !force) return cb(list[0].item);
        select(title, list, cb);
    }

    function doPlay(play, title) {
        if (!play.url) return noty('Немає посилання на потік');
        var data = {
            url: play.direct ? play.url : px(play.url, play.ref),
            title: title,
            subtitles: (play.subs || []).map(function (s) { return { label: s.label, url: s.url }; })
        };
        if (play.quality) data.quality = play.quality;
        if (play.headers) data.headers = play.headers;
        Lampa.Player.play(data);
        Lampa.Player.playlist([data]);
    }

    // Вузол дерева: { label, children:[вузли] } | { play:{url,ref,subs} } | { load:function(ok,fail) }
    function walk(node, path, name, provName) {
        if (node.play) return doPlay(node.play, [name].concat(path).join(' — '));

        if (!node.children && node.load) {
            return node.load(function (n) {
                node.children = n.children;
                node.play = n.play;
                node.label = n.label || node.label;
                walk(node, path, name, provName);
            }, function (e) { err(provName, e); });
        }

        var kids = node.children || [];
        if (!kids.length) return noty('Нічого не знайдено');
        if (kids.length === 1) return walk(kids[0], path, name, provName);

        select(node.label || 'Вибір', kids.map(function (k) { return { title: k.title || '…', item: k }; }), function (k) {
            walk(k, path.concat([k.title || '']), name, provName);
        });
    }

    function openEntry(p, entry) {
        noty(p.name + ': завантаження…');
        p.resolve(entry, function (root) {
            walk(root, [], entry.title, p.name);
        }, function (e) { err(p.name, e); });
    }

    // =====================================================================
    // Провайдер: UAFlix (uafix.net)
    // =====================================================================

    PROVIDERS.push((function () {
        var BASE = 'https://uafix.net';
        var PLAYER_REFERER = 'https://tortuga.wtf/';
        var PLAYER_RE = /(?:https?:)?\/\/[^"'\s<>\\]*?(?:ashdi\.vip|tortuga\.wtf|zetvideo\.net)[^"'\s<>\\]*/i;

        function parseSearch(doc) {
            var out = [];
            var cards = doc.querySelectorAll('.sres-wrap');
            for (var i = 0; i < cards.length; i++) {
                var el = cards[i];
                var href = el.getAttribute('href');
                if (!href) {
                    var a = el.querySelector('a[href]');
                    href = a ? a.getAttribute('href') : '';
                }
                var t = el.querySelector('.vi-title');
                var title = t ? t.textContent.trim() : '';
                if (!title) {
                    var im = el.querySelector('.vi-img, .sres-img img');
                    title = im ? (im.getAttribute('alt') || '').trim() : '';
                }
                if (href) out.push({ title: stripSeo(title) || href, href: fixUrl(href, BASE) });
            }
            return out;
        }

        function iframeSrc(fr) {
            return fr.getAttribute('src') || fr.getAttribute('data-src') || fr.getAttribute('data-lazy-src') || '';
        }

        function getIframe(doc) {
            // Спершу iframe у .video-box, потім будь-який інший; трейлери з YouTube пропускаємо
            var groups = [doc.querySelectorAll('.video-box iframe'), doc.querySelectorAll('iframe')];
            for (var g = 0; g < groups.length; g++) {
                for (var i = 0; i < groups[g].length; i++) {
                    var src = iframeSrc(groups[g][i]).trim();
                    if (src && src !== 'about:blank' && !/youtube\.com|youtu\.be/i.test(src)) return fixUrl(src, BASE);
                }
            }
            return '';
        }

        // Запасний варіант: адреса відеохостингу в сирому HTML
        function scanPlayer(html) {
            var m = PLAYER_RE.exec(html);
            return m ? fixUrl(m[0], BASE) : '';
        }

        function parseEpisodeCards(doc) {
            var out = [];
            var items = doc.querySelectorAll('.video-item');
            for (var i = 0; i < items.length; i++) {
                var a = items[i].querySelector('.vi-img');
                var t = items[i].querySelector('.vi-title');
                var r = items[i].querySelector('.vi-rate');
                if (!a) continue;
                var name = (t ? t.textContent.trim() : '') + (r && r.textContent.trim() ? ' — ' + r.textContent.trim() : '');
                out.push({ title: name || 'Серія ' + (i + 1), href: fixUrl(a.getAttribute('href'), BASE) });
            }
            return out;
        }

        // Діагностика: що саме повернув сайт, коли плеєра не знайдено
        function diagPage(url, html) {
            var d = parseHtml(html);
            var box = d.querySelector('.video-box');
            var kw = /ashdi|tortuga|zetvideo|\/vod\//i.exec(html);
            banner('UAFlix: плеєра нема. ' + url +
                ' | довжина: ' + html.length +
                ' | iframe src: ' + Array.prototype.map.call(d.querySelectorAll('iframe'), function (f) { return (iframeSrc(f) || '(порожньо)').slice(0, 60); }).join(' ; ') +
                ' | video-box: ' + (box ? box.innerHTML.replace(/\s+/g, ' ').slice(0, 250) : 'нема') +
                ' | збіг у HTML: ' + (kw ? html.substr(Math.max(0, kw.index - 40), 120).replace(/\s+/g, ' ') : 'нема') +
                ' | title: ' + ((d.querySelector('title') || {}).textContent || '').slice(0, 50), 25000);
        }

        // Сторінка плеєра -> вузол дерева
        function resolvePlayer(iframeUrl, ok, fail) {
            http(iframeUrl, BASE + '/', function (html) {
                var doc = parseHtml(html);
                var scripts = doc.querySelectorAll('script');
                var js = '';
                for (var i = 0; i < scripts.length; i++) js += scripts[i].textContent + '\n';

                var file = extractFile(js);
                if (!file) return fail('плеєр не віддав file');

                var subM = /subtitle\s*:\s*['"]([^'"]*)['"]/.exec(js);
                var subs = parseSubs(subM ? subM[1] : '', BASE);

                if (file.charAt(0) === '[') {
                    var dubs;
                    try { dubs = JSON.parse(file); } catch (e) { return fail('не вдалось розібрати список озвучок'); }
                    return ok({
                        label: 'Озвучка',
                        children: dubs.map(function (d) {
                            return {
                                title: d.title || 'Озвучка',
                                label: 'Сезон',
                                children: (d.folder || []).map(function (s) {
                                    return {
                                        title: s.title || 'Сезон',
                                        label: 'Серія',
                                        children: (s.folder || []).map(function (ep) {
                                            return { title: ep.title || 'Серія', play: { url: ep.file, ref: PLAYER_REFERER, subs: parseSubs(ep.subtitle, BASE) } };
                                        })
                                    };
                                })
                            };
                        })
                    });
                }
                ok({ play: { url: file, ref: PLAYER_REFERER, subs: subs } });
            }, fail);
        }

        function openPlayerPage(url, ok, fail) {
            http(url, BASE + '/', function (html) {
                var iframe = getIframe(parseHtml(html)) || scanPlayer(html);
                if (!iframe) { diagPage(url, html); return fail(null); }
                resolvePlayer(iframe, ok, fail);
            }, fail);
        }

        // Серіал, де епізоди — окремі сторінки з пагінацією
        function loadEpisodePages(firstDoc, url, cb) {
            var pages = firstDoc.querySelectorAll('.pagination li').length || 1;
            var all = parseEpisodeCards(firstDoc);
            var i = 2;
            (function next() {
                if (i > pages) return cb(all);
                http(url + (url.indexOf('?') > -1 ? '&' : '?') + 'page=' + i, BASE + '/', function (html) {
                    all = all.concat(parseEpisodeCards(parseHtml(html)));
                    i++;
                    next();
                }, function () { cb(all); });
            })();
        }

        return {
            name: 'UAFlix',

            search: function (titles, ok, fail) {
                (function next(i) {
                    if (i >= titles.length) return ok([]);
                    var url = BASE + '/index.php?do=search&subaction=search&search_start=0&story=' + encodeURIComponent(titles[i]);
                    http(url, BASE + '/', function (html) {
                        var found = parseSearch(parseHtml(html));
                        if (found.length) ok(found);
                        else next(i + 1);
                    }, fail);
                })(0);
            },

            resolve: function (entry, ok, fail) {
                http(entry.href, BASE + '/', function (html) {
                    var doc = parseHtml(html);
                    var iframe = getIframe(doc) || scanPlayer(html);

                    if (iframe) return resolvePlayer(iframe, ok, fail);

                    loadEpisodePages(doc, entry.href, function (eps) {
                        if (!eps.length) { diagPage(entry.href, html); return fail(null); }
                        ok({
                            label: 'Серії',
                            children: eps.map(function (e) {
                                return { title: e.title, load: function (ok2, fail2) { openPlayerPage(e.href, ok2, fail2); } };
                            })
                        });
                    });
                }, fail);
            }
        };
    })());

    // =====================================================================
    // Провайдер: Filmix (потрібен акаунт Filmix: код входу вводиться один раз)
    // Логіка взята з відкритого плагіна komar404/filmix-plugin; запити йдуть через твій проксі.
    // =====================================================================

    PROVIDERS.push((function () {
        var API = 'http://filmixapp.cyou/api/v2/';
        var FX_REF = 'https://filmix.ac/';
        var FX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        var maxQ = 720;          // без PRO Filmix віддає до 720p
        var profiled = false;
        var authTimer = null;

        function uid() {
            var u = store('ua_fx_uid');
            if (!u) {
                u = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
                store('ua_fx_uid', u);
            }
            return u;
        }

        function devToken(token) {
            return 'user_dev_apk=2.2.13&user_dev_id=' + uid() + '&user_dev_name=Lampa&user_dev_os=11' +
                '&user_dev_token=' + (token || '') + '&user_dev_vendor=FILMIX';
        }

        function getJson(path, params, token, ok, fail) {
            var url = API + path + '?' + (params ? params + '&' : '') + devToken(token);
            http(url, undefined, function (text) {
                var json;
                try { json = JSON.parse(text); } catch (e) { return fail('Filmix повернув не JSON'); }
                ok(json);
            }, fail);
        }

        function applyProfile(json) {
            if (json && json.user_data) {
                maxQ = json.user_data.is_pro_plus ? 2160 : (json.user_data.is_pro ? 1080 : 720);
            }
        }

        // Вікно з кодом: його вводять на https://filmix.my/consoles у своєму акаунті
        function showCode(code, onClose) {
            var prev = Lampa.Controller.enabled().name;
            var modal = $('<div><div class="broadcast__text">Введіть код на сторінці https://filmix.my/consoles (увійдіть у свій акаунт Filmix)</div>' +
                '<div class="broadcast__device selector" style="text-align:center;background-color:darkslategrey;color:white;">' + code + '</div><br>' +
                '<div class="broadcast__scan"><div></div></div></div>');
            try {
                Lampa.Modal.open({
                    title: '',
                    html: modal,
                    onBack: function () {
                        Lampa.Modal.close();
                        onClose();
                        Lampa.Controller.toggle(prev);
                    },
                    onSelect: function () {
                        Lampa.Utils.copyTextToClipboard(code, function () { noty('Код скопійовано'); }, function () { noty('Не вдалося скопіювати'); });
                    }
                });
            } catch (e) {
                banner('Filmix: код входу ' + code + ' — введіть його на https://filmix.my/consoles', 60000);
            }
            return function () {
                try { Lampa.Modal.close(); } catch (e) { }
                try { Lampa.Controller.toggle(prev); } catch (e) { }
            };
        }

        function ensureAuth(ok, fail) {
            var token = store('ua_fx_token');

            if (token) {
                if (profiled) return ok(token);
                return getJson('user_profile', '', token, function (json) {
                    if (json && json.user_data) {
                        profiled = true;
                        applyProfile(json);
                        return ok(token);
                    }
                    // токен більше не дійсний — входимо заново
                    store('ua_fx_token', '');
                    ensureAuth(ok, fail);
                }, function () { ok(token); });
            }

            getJson('token_request', '', '', function (found) {
                if (!found || found.status !== 'ok' || !found.code) return fail('Filmix не видав код для входу');
                var userToken = found.code;
                var finished = false;
                var tries = 0;
                var closeModal = showCode(found.user_code, function () { clearInterval(authTimer); });

                clearInterval(authTimer);
                authTimer = setInterval(function () {
                    if (++tries > 300) { clearInterval(authTimer); return; }
                    getJson('user_profile', '', userToken, function (json) {
                        if (finished || !json || !json.user_data) return;
                        finished = true;
                        clearInterval(authTimer);
                        store('ua_fx_token', userToken);
                        profiled = true;
                        applyProfile(json);
                        closeModal();
                        ok(userToken);
                    }, function () { });
                }, 2000);
            }, fail);
        }

        // file закінчується на _<якість>.mp4 -> посилання для плеєра з вибором якості
        function buildPlay(file, qualities) {
    var parts = file.split('?');
    var base = parts[0];
    var query = parts.length > 1 ? '?' + parts.slice(1).join('?') : '';
    var link = base.slice(0, base.lastIndexOf('_')) + '_';
    var qmap = {};

    qualities.forEach(function (q) {
        qmap[q + 'p'] = (link + q + '.mp4' + query).replace('https://', 'http://');
    });

    var pref = (store('video_quality_default') || '1080') + 'p';
    var url = qmap[pref] || qmap[Math.max.apply(null, qualities) + 'p'];

    return {
        url: url,
        quality: qmap,
        direct: true,
        ref: FX_REF,
        headers: {
            'Referer': FX_REF,
            'User-Agent': FX_UA
        }
    };
}


        function allowedQualities(list) {
            return (list || []).map(function (q) { return parseInt(q, 10); }).filter(function (q) { return q > 0 && q <= maxQ; });
        }

        function movieTree(movies) {
            var children = [];
            movies.forEach(function (m, i) {
                var mq = /.+\[(.+[\d])[,]+?\].+/i.exec(m.link || '');
                var qs = allowedQualities(mq ? mq[1].split(',') : []);
                if (!qs.length) return;
                var file = m.link.replace(/\[(.+[\d])[,]+?\]/i, Math.max.apply(null, qs));
                children.push({ title: m.translation || ('Озвучка ' + (i + 1)), play: buildPlay(file, qs) });
            });
            return { label: 'Озвучка', children: children };
        }

        // playlist[сезон][озвучка][id] = {link, qualities} -> озвучка → сезон → серія
        function seriesTree(playlist) {
            var voices = {}, order = [];
            Object.keys(playlist).forEach(function (seasonKey) {
                var byVoice = playlist[seasonKey];
                Object.keys(byVoice).forEach(function (voice) {
                    var eps = byVoice[voice];
                    Object.keys(eps).forEach(function (id) {
                        var f = eps[id];
                        var qs = allowedQualities(f.qualities);
                        if (!qs.length || !f.link) return;
                        var file = f.link.replace('%s.mp4', Math.max.apply(null, qs) + '.mp4');
                        var m = file.slice(file.lastIndexOf('/')).match(/s(\d+)e(\d+?)_\d+\.mp4/i);
                        if (!m) return;
                        var sn = parseInt(m[1], 10), en = parseInt(m[2], 10);
                        if (!voices[voice]) { voices[voice] = {}; order.push(voice); }
                        if (!voices[voice][sn]) voices[voice][sn] = [];
                        voices[voice][sn].push({ num: en, file: file, qs: qs });
                    });
                });
            });

            return {
                label: 'Озвучка',
                children: order.map(function (voice) {
                    return {
                        title: voice,
                        label: 'Сезон',
                        children: Object.keys(voices[voice]).map(Number).sort(function (a, b) { return a - b; }).map(function (sn) {
                            return {
                                title: 'Сезон ' + sn,
                                label: 'Серія',
                                children: voices[voice][sn].sort(function (a, b) { return a.num - b.num; }).map(function (e) {
                                    return { title: 'Серія ' + e.num, play: buildPlay(e.file, e.qs) };
                                })
                            };
                        })
                    };
                })
            };
        }

        return {
            name: 'Filmix',

            // без входу в акаунт Filmix не працює, тому в "Усі джерела" не потрапляє
            skipInAll: function () { return !store('ua_fx_token'); },

            search: function (titles, ok, fail, movie) {
                var year = movie ? parseInt(String(movie.release_date || movie.first_air_date || '0000').slice(0, 4), 10) : 0;

                ensureAuth(function (token) {
                    (function next(i) {
                        if (i >= titles.length) return ok([]);
                        getJson('search', 'story=' + encodeURIComponent(titles[i]), token, function (json) {
                            if (!Array.isArray(json)) return fail('Filmix: пошук повернув неочікувану відповідь');

                            var list = json.map(function (c) {
                                var y = parseInt(c.year || String(c.alt_name || '').split('-').pop(), 10) || 0;
                                var name = c.title || c.ru_title || c.en_title || '';
                                var orig = c.original_title || c.orig_title || '';
                                return {
                                    id: c.id,
                                    year: y,
                                    title: name + (orig && orig !== name ? ' / ' + orig : '') + (y ? ' (' + y + ')' : '')
                                };
                            });

                            if (year) {
                                var near = list.filter(function (c) { return c.year > year - 2 && c.year < year + 2; });
                                if (near.length) list = near;
                            }

                            if (list.length) ok(list);
                            else next(i + 1);
                        }, fail);
                    })(0);
                }, fail);
            },

            if (!found) {
    return fail('Filmix: порожня відповідь post');
}

var pl = found.player_links || {};
var tree = null;

if (pl.playlist && Object.keys(pl.playlist).length) {
    tree = seriesTree(pl.playlist);
}
else if (pl.movie && pl.movie.length) {
    tree = movieTree(pl.movie);
}

if (!tree || !tree.children || !tree.children.length) {
    var playerKeys = [];

    try {
        playerKeys = Object.keys(pl);
    }
    catch (e) { }

    banner(
        'Filmix: player_links без розпізнаних відео' +
        ' | поля player_links: ' +
        (playerKeys.length ? playerKeys.join(', ') : 'порожньо') +
        ' | поля відповіді: ' +
        Object.keys(found).join(', '),
        30000
    );

    return fail(
        'структура відео змінилася; поля: ' +
        (playerKeys.join(', ') || 'player_links порожній')
    );
}

ok(tree);

    })());

    // =====================================================================
    // Запуск: вибір джерела -> пошук -> вибір результату -> дерево -> плеєр
    // =====================================================================

    function store(key, value) {
        try {
            if (value === undefined) return Lampa.Storage.get(key, '');
            Lampa.Storage.set(key, value);
        } catch (e) { }
        return '';
    }

    function buildTitles(movie) {
        var titles = [];
        [movie.title, movie.name, movie.original_title, movie.original_name].forEach(function (t) {
            if (!t) return;
            [t.split(/\s*[:—–]\s*/)[0], t].forEach(function (x) {
                x = x.trim();
                if (x && titles.indexOf(x) < 0) titles.push(x);
            });
        });
        return titles;
    }

    function showResults(items) {
        pick('Результати', items, function (it) { openEntry(it.provider, it.entry); }, true);
    }

    function searchOne(p, titles, movie) {
        noty(p.name + ': пошук…');
        p.search(titles, function (found) {
            showResults(found.map(function (f) { return { title: f.title, item: { provider: p, entry: f } }; }));
        }, function (e) {
            err(p.name, e + (PROXY ? '' : ' — потрібен проксі (PROXY у плагіні)'));
        }, movie);
    }

    function searchAll(titles, movie) {
        noty('Пошук у всіх джерелах…');
        var pending = PROVIDERS.length, all = [];
        function done() {
            if (--pending > 0) return;
            showResults(all);
        }
        PROVIDERS.forEach(function (p) {
            if (p.skipInAll && p.skipInAll()) return done();
            p.search(titles, function (found) {
                found.forEach(function (f) {
                    all.push({ title: '[' + p.name + '] ' + f.title, item: { provider: p, entry: f } });
                });
                done();
            }, function () { done(); }, movie);
        });
    }

    function start(movie) {
        var titles = buildTitles(movie);
        var last = store('uaflix_source');

        var provs = PROVIDERS.slice().sort(function (a, b) {
            return (b.name === last ? 1 : 0) - (a.name === last ? 1 : 0);
        });
        var items = [{ title: 'Усі джерела', item: '__all' }].concat(provs.map(function (p) { return { title: p.name, item: p }; }));

        pick('Джерело', items, function (sel) {
            if (sel === '__all') return searchAll(titles, movie);
            store('uaflix_source', sel.name);
            searchOne(sel, titles, movie);
        }, true);
    }

    function init() {
        noty('UA-джерела: плагін завантажено');

        Lampa.Listener.follow('full', function (e) {
            // У Лампі подія історично пишеться з помилкою: 'complite'
            if (e.type !== 'complite' && e.type !== 'complete') return;

            var root = e.object.activity.render();
            if (root.find('.uaflix--button').length) return;

            var btn = $(
                '<div class="full-start__button selector uaflix--button">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
                '<span>UA</span></div>'
            );

            var last = 0;
            btn.on('hover:enter click', function () {
                var now = Date.now();
                if (now - last < 800) return; // захист від подвійного спрацювання
                last = now;
                start(e.data.movie);
            });

            var anchor = root.find('.view--torrent').first();
            var holder = root.find('.full-start__buttons, .full-start-new__buttons').first();
            if (!holder.length) holder = root.find('.full-start__button').first().parent();

            if (anchor.length) anchor.after(btn);
            else if (holder.length) holder.append(btn);
            else banner('UA-джерела: не знайшов місце для кнопки');
        });
    }

    var booted = false;
    function boot() {
        if (booted) return;
        if (typeof Lampa === 'undefined' || !Lampa.Listener) return;
        booted = true;
        try { init(); } catch (e) { banner('UA-джерела: помилка init: ' + e.message); }
    }

    boot();
    if (!booted) {
        var tries = 0;
        var timer = setInterval(function () {
            boot();
            if (booted || ++tries > 60) clearInterval(timer);
        }, 500);
    }
})();
