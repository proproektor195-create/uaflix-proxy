export default {
    async fetch(request) {
        const url = new URL(request.url);

        return Response.json({
            ok: true,
            service: "Lampa API",
            host: url.hostname,
            message: "Vercel працює"
        }, {
            headers: {
                "Access-Control-Allow-Origin": "*"
            }
        });
    }
};
