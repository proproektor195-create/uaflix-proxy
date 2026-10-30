/*
 * UA-джерела для Lampa: UAFlix + Filmix.
 * Виправлена версія-завантажувач:
 * - використовує Vercel proxy;
 * - використовує Filmix API filmixapp.cyou;
 * - перевіряє збережений Filmix token;
 * - при 404/недійсному token запускає нову авторизацію за кодом.
 */
(function () {
    'use strict';

    if (window.uaflix_fixed_loader) return;
    window.uaflix_fixed_loader = true;

    var SOURCE = 'https://cdn.jsdelivr.net/gh/proproektor195-create/uaflix-proxy@5a590e1/uaflix.js';
    var PROXY = 'https://uaflix-proxy.vercel.app/api';
    var FILMIX_API = 'http://filmixapp.cyou/api/v2/';

    function banner(text, ms) {
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c62828;color:#fff;padding:10px;font:16px sans-serif;text-align:center';
            d.textContent = text;
            (document.body || document.documentElement).appendChild(d);
            setTimeout(function () {
                if (d.parentNode) d.parentNode.removeChild(d);
            }, ms || 15000);
        }
        catch (e) {
            console.log('UA loader:', text);
        }
    }

    function noty(text) {
        try {
            Lampa.Noty.show(text);
        }
        catch (e) {
            console.log('UA loader:', text);
        }
    }

    function loadText(url, ok, fail) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 20000;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
            else fail('HTTP ' + xhr.status);
        };
        xhr.onerror = function () { fail('мережа/CORS'); };
        xhr.ontimeout = function () { fail('таймаут'); };
        xhr.send();
    }

    function replaceEnsureAuth(code) {
        var start = code.indexOf('        function ensureAuth(ok, fail) {');
        var endMarker = '        // file закінчується на _<якість>.mp4';
        var end = code.indexOf(endMarker, start);

        if (start < 0 || end < 0) {
            throw new Error('не знайдено блок ensureAuth');
        }

        var fixed = [
            '        function ensureAuth(ok, fail) {',
            "            var token = store('ua_fx_token');",
            '',
            '            if (token) {',
            '                if (profiled) return ok(token);',
            '',
            "                return getJson('user_profile', '', token, function (json) {",
            '                    if (json && json.user_data) {',
            '                        profiled = true;',
            '                        applyProfile(json);',
            '                        return ok(token);',
            '                    }',
            '',
            "                    store('ua_fx_token', '');",
            '                    profiled = false;',
            '                    ensureAuth(ok, fail);',
            '                }, function () {',
            "                    store('ua_fx_token', '');",
            '                    profiled = false;',
            '                    ensureAuth(ok, fail);',
            '                });',
            '            }',
            '',
            "            getJson('token_request', '', '', function (found) {",
            "                if (!found || found.status !== 'ok' || !found.code) return fail('Filmix не видав код для входу');",
            '',
            '                var userToken = found.code;',
            '                var finished = false;',
            '                var tries = 0;',
            '                var closeModal = showCode(found.user_code, function () { clearInterval(authTimer); });',
            '',
            '                clearInterval(authTimer);',
            '                authTimer = setInterval(function () {',
            '                    if (++tries > 300) {',
            '                        clearInterval(authTimer);',
            "                        return fail('Час очікування авторизації Filmix вичерпано');",
            '                    }',
            '',
            "                    getJson('user_profile', '', userToken, function (json) {",
            '                        if (finished || !json || !json.user_data) return;',
            '',
            '                        finished = true;',
            '                        clearInterval(authTimer);',
            "                        store('ua_fx_token', userToken);",
            '                        profiled = true;',
            '                        applyProfile(json);',
            '                        closeModal();',
            '                        ok(userToken);',
            '                    }, function () {',
            '                        // 404 під час очікування означає, що код ще не підтверджено.',
            '                    });',
            '                }, 2000);',
            '            }, fail);',
            '        }',
            '',
            ''
        ].join('\n');

        return code.substring(0, start) + fixed + code.substring(end);
    }

    loadText(SOURCE + '?loader=' + Date.now(), function (code) {
        try {
            code = code.replace(
                /var PROXY\s*=\s*['"][^'"]*['"]\s*;/,
                "var PROXY = '" + PROXY + "';"
            );

            code = code.replace(
                /var API\s*=\s*['"]https?:\/\/filmixapp\.vip\/api\/v2\/['"]\s*;/,
                "var API = '" + FILMIX_API + "';"
            );

            code = replaceEnsureAuth(code);

            // Новий ключ сховища примусово запускає чисту авторизацію Filmix.
            code = code.replace(/ua_fx_token/g, 'ua_fx_token_v2');

            // Дозволяє повторний запуск після видалення старої зламаної версії.
            try { delete window.uaflix_plugin; } catch (e) { window.uaflix_plugin = false; }

            (0, eval)(code + '\n//# sourceURL=uaflix-fixed-runtime.js');
            noty('UA-джерела: виправлений плагін завантажено');
        }
        catch (e) {
            banner('UA loader: ' + (e && e.message ? e.message : e), 20000);
        }
    }, function (error) {
        banner('UA loader: не завантажився базовий файл, ' + error, 20000);
    });
})();
