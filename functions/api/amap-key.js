// Cloudflare Function to return AMap API Key from environment variable
export async function onRequest(context) {
    const apiKey = context.env.AMAP_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'AMAP_API_KEY not configured' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    return new Response(JSON.stringify({ key: apiKey }), {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
