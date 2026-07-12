const LOCAL_BACKEND = "http://localhost:8000";

function backendApiBase(): string {
  const configured =
    process.env.BACKEND_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE ??
    LOCAL_BACKEND;
  const base = configured.replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const target = `${backendApiBase()}/${path.map(encodeURIComponent).join("/")}${incomingUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Backend proxy failed", { target, error });
    return Response.json(
      {
        error: "backend_unreachable",
        detail: "BACKEND_API_URLとバックエンドの公開設定を確認してください。",
      },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
