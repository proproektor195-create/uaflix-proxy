export default {
    async fetch(request) {
        const url = new URL(request.url);

        const cors = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: cors
            });
        }

        // Головна перевірка
        if (url.pathname === "/api") {
            return Response.json(
                {
                    ok: true,
                    service: "Lampa API",
                    message: "Vercel працює"
                },
                {
                    headers: cors
                }
            );
        }

        // Тест зовнішнього URL
        if (url.pathname === "/api/test") {

            const target = url.searchParams.get("url");

            if (!target) {
                return Response.json(
                    {
                        ok: false,
                        error: "Не вказаний параметр url"
                    },
                    {
                        status: 400,
                        headers: cors
                    }
                );
            }

            try {
                const response = await fetch(target, {
                    redirect: "follow",
                    headers: {
                        "Accept": "*/*",
                        "User-Agent": "Mozilla/5.0"
                    }
                });

                const body = await response.text();

                return Response.json(
                    {
                        ok: response.ok,
                        status: response.status,
                        finalUrl: response.url,
                        contentType:
                            response.headers.get("content-type"),
                        preview: body.slice(0, 1000)
                    },
                    {
                        headers: cors
                    }
                );

            } catch (error) {

                return Response.json(
                    {
                        ok: false,
                        error: String(error)
                    },
                    {
                        status: 502,
                        headers: cors
                    }
                );
            }
        }

        return Response.json(
            {
                ok: false,
                error: "Route not found"
            },
            {
                status: 404,
                headers: cors
            }
        );
    }
};
