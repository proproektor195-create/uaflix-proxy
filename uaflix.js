/*
 * Завантажувач виправленої версії UA-джерел для Lampa.
 * Бере синтаксично справну версію плагіна з зафіксованого commit,
 * замінює старий Deno proxy на Vercel і Filmix API на filmixapp.cyou.
 */
(function () {
    'use strict';

    if (window.uaflix_fixed_loader) return;
    window.uaflix_fixed_loader = true;

    var SOURCE = 'https://cdn.jsdelivr.net/gh/proproektor195-create/uaflix-proxy@5a590e1/uaflix.js';
    var VERCEL_PROXY = 'https://uaflix-proxy.vercel.app/api';

    function notify(text) {
        try {
            Lampa.Noty.show(text);
        }
        catch (e) {
            console.log('UA loader:', text);
        }
    }

    function showError(text) {
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c62828;color:#fff;padding:10px;font:16px sans-serif;text-align:center';
            d.textContent = text;
            (document.body || document.documentElement).appendChild(d);
            setTimeout(function () {
                if (d.parentNode) d.parentNode.removeChild(d);
            }, 15000);
        }
        catch (e) {
            console.log(text);
        }
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', SOURCE + '?v=' + Date.now(), true);
    xhr.timeout = 20000;

    xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
            return showError('UA loader: не вдалося завантажити основу, HTTP ' + xhr.status);
        }

        var code = xhr.responseText;

        code = code.replace(
            /var PROXY\s*=\s*['"][^'"]*['"]\s*;/,
            "var PROXY = '" + VERCEL_PROXY + "';"
        );

        code = code.replace(
            /var API\s*=\s*['"]https?:\/\/filmixapp\.vip\/api\/v2\/['"]\s*;/,
            "var API = 'http://filmixapp.cyou/api/v2/';"
        );

        try {
            (0, eval)(code + '\n//# sourceURL=uaflix-runtime-fixed.js');
            notify('UA-джерела: виправлену версію завантажено');
        }
        catch (e) {
            showError('UA loader: помилка запуску: ' + (e && e.message ? e.message : e));
        }
    };

    xhr.onerror = function () {
        showError('UA loader: мережа/CORS під час завантаження плагіна');
    };

    xhr.ontimeout = function () {
        showError('UA loader: таймаут завантаження плагіна');
    };

    xhr.send();
})();
