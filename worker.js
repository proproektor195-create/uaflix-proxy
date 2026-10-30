// Cloudflare Worker: проксі для uaflix.js (додає CORS і Referer).
// Не перевірено на живому сайті. Якщо плеєр/сегменти лежать на інших доменах — додай їх у ALLOWED.
// Підтримує GET та POST (?method=POST&body=...).

// Дозволені домени (з підтримкою піддоменів). Інші сайти проксі не пропустить.
const ALLOWED = [
  // UAFlix
  'uafix.net', 'tortuga.wtf', 'zetvideo.net',
  // Filmix (API додатка; відео-файли плеєр бере напряму, не через проксі)
  'filmixapp.vip', 'filmixapp.cyou',
  // запас: Kinostrain / ashdi / KlonTV
  'kinostrain.com', 'ashdi.vip', 'klonua.com',
  // запас на майбутні провайдери з репозиторію
  'eneyida.tv', 'kinotron.tv', 'serialno.tv', 'kinovezha.tv',
  'cikava-ideya.top', 'animeua.club', 'bambooua.com', 'coani.net',
  'uakino.cx', 'hdvbua.pro', 'simpsonsua.tv',
  'anitube.in.ua', 'fenixplay.xyz', 'monstro.site', 'animeon.club',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Final-Url, X-Upstream-Status',
};

// Той самий User-Agent і заголовки, що в Kotlin-провайдера (деякі сайти ріжуть "чужі" браузери)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

// Filmix API віддає порожню відповідь/404 на сторінку фільму, якщо запит з браузерним User-Agent.
// Тому для Filmix шлемо UA "застосунку" і без браузерних заголовків.
const FILMIX_UA = 'okhttp/4.9.3';
function isFilmix(host) {
  return host === 'filmixapp.vip' || host.endsWith('.filmixapp.vip') || host === 'filmixapp.cyou' || host.endsWith('.filmixapp.cyou');
}

function allowed(host) {
  return ALLOWED.some((d) => host === d || host.endsWith('.' + d));
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const self = new URL(request.url);
    const target = self.searchParams.get('url');
    const ref = self.searchParams.get('ref') || 'https://uafix.net/';

    if (!target || !/^https?:\/\//i.test(target)) {
      return new Response('bad url', { status: 400, headers: CORS });
    }
    const t = new URL(target);
    if (!allowed(t.hostname)) {
      return new Response('host not allowed: ' + t.hostname, { status: 403, headers: CORS });
    }

    const isPost = (self.searchParams.get('method') || '').toUpperCase() === 'POST';
    const headers = {
      Referer: ref,
      'User-Agent': UA,
      Accept: ACCEPT,
      'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
    };
    if (isPost) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (isFilmix(t.hostname)) {
      delete headers.Referer;
      delete headers.Accept;
      delete headers['Accept-Language'];
      headers['User-Agent'] = FILMIX_UA;
    }

    const upstream = await fetch(target, {
      method: isPost ? 'POST' : 'GET',
      body: isPost ? self.searchParams.get('body') || '' : undefined,
      headers,
    });

    const ct = upstream.headers.get('Content-Type') || '';
    const isM3u8 = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(t.pathname + t.search);

    if (!isM3u8) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...CORS, 'Content-Type': ct, 'X-Final-Url': upstream.url, 'X-Upstream-Status': String(upstream.status) },
      });
    }

    // Плейлист: вкладені .m3u8 ведемо через проксі, решту (сегменти) робимо абсолютними.
    const wrap = (u) =>
      self.origin + '/?url=' + encodeURIComponent(u) + '&ref=' + encodeURIComponent(ref);
    const fix = (line) => {
      const abs = new URL(line, target).href;
      return /\.m3u8(\?|$)/i.test(abs) ? wrap(abs) : abs;
    };

    const text = await upstream.text();
    const out = text
      .split('\n')
      .map((line) => {
        const l = line.trim();
        if (!l) return line;
        if (l.startsWith('#')) {
          return l.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + fix(u) + '"');
        }
        return fix(l);
      })
      .join('\n');

    return new Response(out, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl', 'X-Final-Url': upstream.url, 'X-Upstream-Status': String(upstream.status) },
    });
  },
};
