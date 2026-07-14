import { NextResponse } from 'next/server';
import { publicBase, openapiSpec } from '@/lib/api/discovery';

/**
 * GET /api/v1/openapi.json  (also /v1/openapi.json on an API-only host)
 * OpenAPI 3.0 description of the read API — importable into Postman, Insomnia,
 * or any generator. Public.
 */
export async function GET(request: Request) {
  const base = publicBase(request, 1); // strip the trailing /openapi.json
  return NextResponse.json(openapiSpec(base));
}
