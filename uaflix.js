/*
 * Завантажувач UA-джерел для Lampa (UAFlix + Filmix).
 * Бере базовий плагін з зафіксованого commit і правлює його "на льоту":
 *  - проксі -> Vercel, Filmix API -> filmixapp.cyou;
 *  - запити до Filmix API йдуть НАПРЯМУ з пристрою (щоб посилання на відео
 *    видавалось під твій IP), а через проксі лише якщо напряму не вийшло;
 *  - посилання на відео більше не міняється з https на http.
 */
(function () {
    'use strict';

    if (window.uaflix_fixed_loader) return;
    window.uaflix_fixed_loader = true;

    var SOURCE = 'https://cdn.jsdelivr.net/gh/proproektor195-create/uaflix-proxy@5a590e1/uaflix.js';
    var VERCEL_PROXY = 'https://uaflix-proxy.vercel.app/api';
    var FILMIX_API = 'http://filmixapp.cyou/api/v2/';
    // Тимчасова діагностика: показувати адресу відео Filmix перед запуском (постав false, коли все працює)
    var DEBUG_URL = true;

    // Код, який вставляється в базовий плагін (ES5, у його області видимості)
    var FX_HTTP = [
        'var fxDirectBroken = false, fxNoted = false;',
        'function fxHttp(url, ok, fail) {',
        '    if (fxDirectBroken) return http(url, undefined, ok, fail);',
        '    var direct = url;',
        "    try { if (location.protocol === 'https:') direct = url.replace(/^http:\\/\\//i, 'https://'); } catch (e) { }",
        '    var done = false;',
        '    function viaProxy(reason, broken) {',
        '        if (done) return;',
        '        done = true;',
        '        if (broken) fxDirectBroken = true;',
        '        if (!fxNoted) { fxNoted = true; noty("Filmix: напряму не вийшло (" + reason + "), йду через проксі"); }',
        '        http(url, undefined, ok, fail);',
        '    }',
        '    var xhr = new XMLHttpRequest();',
        "    xhr.open('GET', direct, true);",
        '    xhr.timeout = 15000;',
        '    xhr.onload = function () {',
        '        if (xhr.status >= 200 && xhr.status < 300) { if (!done) { done = true; ok(xhr.responseText); } }',
        "        else viaProxy('HTTP ' + xhr.status, false);",
        '    };',
        "    xhr.onerror = function () { viaProxy('мережа/CORS', true); };",
        "    xhr.ontimeout = function () { viaProxy('таймаут', false); };",
        '    xhr.send();',
        '}',
        ''
    ].join('\n');

    function banner(text, ms) {
        try {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c62828;color:#fff;padding:10px;font:16px sans-serif;text-align:center';
            d.textContent = text;
            (document.body || document.documentElement).appendChild(d);
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 15000);
        }
        catch (e) { console.log('UA loader:', text); }
    }

    function noty(text) {
        try { Lampa.Noty.show(text); }
        catch (e) { console.log('UA loader:', text); }
    }

    // Замінює рівно одне входження; якщо маркера нема — помилка (щоб не мовчки зламати)
    function must(code, from, to, name) {
        var i = code.indexOf(from);
        if (i < 0) throw new Error('не знайдено місце для правки: ' + name);
        return code.substring(0, i) + to + code.substring(i + from.length);
    }

    function patch(code) {
        code = code.replace(/var PROXY\s*=\s*['"][^'"]*['"]\s*;/, "var PROXY = '" + VERCEL_PROXY + "';");
        code = code.replace(/var API\s*=\s*['"]https?:\/\/filmixapp\.vip\/api\/v2\/['"]\s*;/, "var API = '" + FILMIX_API + "';");

        // 1) Filmix API напряму, проксі — запасний варіант
        code = must(code, 'http(url, undefined, function (text) {', 'fxHttp(url, function (text) {', 'getJson');
        code = must(code, 'function parseHtml(text) {', FX_HTTP + 'function parseHtml(text) {', 'parseHtml');

        // 2) не понижувати посилання на відео до http
        code = must(code, ".replace('https://', 'http://')", '', 'https->http');

        // 3) діагностика: адреса відео на екрані
        if (DEBUG_URL) {
            code = must(code, 'Lampa.Player.play(data);',
                "if (play.direct) banner('URL: ' + data.url, 40000);\n        Lampa.Player.play(data);", 'play');
        }

        return code;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', SOURCE + '?loader=' + Date.now(), true);
    xhr.timeout = 20000;
    xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
            return banner('UA loader: не вдалося завантажити основу, HTTP ' + xhr.status);
        }
        try {
            var code = patch(xhr.responseText);
            try { delete window.uaflix_plugin; } catch (e) { window.uaflix_plugin = false; }
            (0, eval)(code + '\n//# sourceURL=uaflix-fixed-runtime.js');
            noty('UA-джерела: виправлений плагін завантажено');
        }
        catch (e) {
            banner('UA loader: ' + (e && e.message ? e.message : e), 20000);
        }
    };
    xhr.onerror = function () { banner('UA loader: мережа/CORS під час завантаження основи'); };
    xhr.ontimeout = function () { banner('UA loader: таймаут завантаження основи'); };
    xhr.send();
})();
