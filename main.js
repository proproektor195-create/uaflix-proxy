// Точка входу для Deno Deploy: запускає той самий воркер (worker.js) без змін.
// Файл main.js і worker.js мають лежати в одному репозиторії.
import worker from './worker.js';

Deno.serve((request) => worker.fetch(request));
