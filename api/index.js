/*
 * Vercel proxy для власного плагіна Lampa.
 *
 * Підтримує:
 *   ?url=https%3A%2F%2F...
 *   &ref=https%3A%2F%2F...
 *   &method=POST
 *   &body=...
 *
 * Доступ обмежений списком ALLOWED_HOSTS.
 */
var ALLOWED_HOSTS = [
    'uafix.net',
    'filmixapp.vip',
    'filmixapp.cyou',
    'filmix.ac',
    'filmix.my',
    'tortuga.wtf',
    'ashdi.vip',
    'zetvideo.net'
];

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers':
            'Content-Type, Range, Accept, Accept-Language',
        'Access-Control-Expose-Headers':
            'Content-Length, Content-Range, Accept-Ranges, X-Final-Url, X-Upstream-Status',
        'Access-Control-Max-Age': '86400'
    };
}

function json(data, status) {
    return new Response(JSON.stringify(data, null, 2), {
        status: status || 200,
        headers: Object.assign(corsHeaders(), {
            'Content-Type': 'application/json; charset=utf-8'
        })
    });
}

function hostAllowed(hostname) {
    hostname = String(hostname || '').toLowerCase();

    for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
        var allowed = ALLOWED_HOSTS[i];

        if (
            hostname === allowed ||
            hostname.slice(-(allowed.length + 1)) === '.' + allowed
        ) {
            return true;
        }
    }

    return false;
}

/*
 * Filmix API віддає 404 {"message":null} на сторінку фільму (post/{id}),
 * якщо запит приходить з браузерним User-Agent, Referer/Origin чи Accept.
 * Тому для Filmix шлемо UA застосунку й нічого зайвого.
 */
var FILMIX_UA = 'okhttp/4.9.3';

function isFilmix(hostname) {
    hostname = String(hostname || '').toLowerCase();
    return (
        hostname === 'filmixapp.vip' ||
        hostname.slice(-'.filmixapp.vip'.length) === '.filmixapp.vip' ||
        hostname === 'filmixapp.cyou' ||
        hostname.slice(-'.filmixapp.cyou'.length) === '.filmixapp.cyou'
    );
}

function privateHost(hostname) {
    hostname = String(hostname || '').toLowerCase();

    if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '127.0.0.1' ||
        hostname === '::1'
    ) {
        return true;
    }

    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^169\.254\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true;

    return false;
}

export default {
    async fetch(request) {
        var requestUrl = new URL(request.url);
        var cors = corsHeaders();

        /*
         * CORS preflight
         */
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: cors
            });
        }

        /*
         * Контрольна перевірка:
         * https://uaflix-proxy.vercel.app/api
         */
        var targetRaw = requestUrl.searchParams.get('url');

        if (!targetRaw) {
            return json({
                ok: true,
                service: 'Lampa UA proxy',
                provider: 'Vercel',
                usage: '/api?url=https%3A%2F%2Fexample.com',
                allowedHosts: ALLOWED_HOSTS
            });
        }

        var target;

        try {
            target = new URL(targetRaw);
        } catch (error) {
            return json({
                ok: false,
                error: 'Некоректний параметр url'
            }, 400);
        }

        if (
            target.protocol !== 'http:' &&
            target.protocol !== 'https:'
        ) {
            return json({
                ok: false,
                error: 'Дозволені тільки HTTP та HTTPS'
            }, 400);
        }

        if (
            privateHost(target.hostname) ||
            !hostAllowed(target.hostname)
        ) {
            return json({
                ok: false,
                error: 'Хост не дозволений',
                hostname: target.hostname
            }, 403);
        }

        var requestedMethod =
            String(requestUrl.searchParams.get('method') || 'GET')
                .toUpperCase();

        if (
            requestedMethod !== 'GET' &&
            requestedMethod !== 'POST' &&
            requestedMethod !== 'HEAD'
        ) {
            return json({
                ok: false,
                error: 'Метод не дозволений'
            }, 405);
        }

        var referer =
            requestUrl.searchParams.get('ref') ||
            target.origin + '/';

        var headers = new Headers();

        headers.set(
            'Accept',
            request.headers.get('Accept') ||
            'text/html,application/xhtml+xml,application/json,text/plain,*/*'
        );

        headers.set(
            'Accept-Language',
            request.headers.get('Accept-Language') ||
            'uk-UA,uk;q=0.9,en;q=0.8'
        );

        headers.set(
            'User-Agent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/124.0.0.0 Safari/537.36'
        );

        headers.set('Referer', referer);

        try {
            var refUrl = new URL(referer);
            headers.set('Origin', refUrl.origin);
        } catch (error) {
            headers.set('Origin', target.origin);
        }

        /*
         * Для перемотування та часткового завантаження відео.
         */
        var range = request.headers.get('Range');

        if (range) {
            headers.set('Range', range);
        }

        /*
         * Filmix: лише User-Agent застосунку, без Referer/Origin/Accept.
         */
        if (isFilmix(target.hostname)) {
            headers = new Headers();
            headers.set('User-Agent', FILMIX_UA);
        }

        var upstreamOptions = {
            method: requestedMethod,
            headers: headers,
            redirect: 'follow'
        };

        /*
         * Старий плагін передає POST-дані через параметр body.
         */
        if (requestedMethod === 'POST') {
            upstreamOptions.body =
                requestUrl.searchParams.get('body') || '';

            headers.set(
                'Content-Type',
                'application/x-www-form-urlencoded; charset=UTF-8'
            );
        }

        try {
            var upstream = await fetch(
                target.toString(),
                upstreamOptions
            );

            var responseHeaders = new Headers();

            Object.keys(cors).forEach(function (name) {
                responseHeaders.set(name, cors[name]);
            });

            var copyHeaders = [
                'Content-Type',
                'Content-Length',
                'Content-Range',
                'Accept-Ranges',
                'Cache-Control',
                'ETag',
                'Last-Modified'
            ];

            for (var i = 0; i < copyHeaders.length; i++) {
                var value =
                    upstream.headers.get(copyHeaders[i]);

                if (value) {
                    responseHeaders.set(copyHeaders[i], value);
                }
            }

            responseHeaders.set(
                'X-Upstream-Status',
                String(upstream.status)
            );

            responseHeaders.set(
                'X-Final-Url',
                upstream.url || target.toString()
            );

            return new Response(
                requestedMethod === 'HEAD'
                    ? null
                    : upstream.body,
                {
                    status: upstream.status,
                    statusText: upstream.statusText,
                    headers: responseHeaders
                }
            );
        } catch (error) {
            return json({
                ok: false,
                error: 'Помилка запиту до джерела',
                details: String(error),
                target: target.toString()
            }, 502);
        }
    }
};
