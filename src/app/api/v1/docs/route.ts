import { publicBase, renderDocsHtml } from '@/lib/api/discovery';

/**
 * GET /api/v1/docs  (also /v1/docs on an API-only host)
 * Human-readable API documentation, rendered from the same source as the JSON
 * index and the OpenAPI spec. Public — this is the link to hand to consumers.
 */
export async function GET(request: Request) {
  const base = publicBase(request, 1); // strip the trailing /docs
  return new Response(renderDocsHtml(base), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
