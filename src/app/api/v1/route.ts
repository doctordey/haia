import { NextResponse } from 'next/server';
import { publicBase, discoveryDoc } from '@/lib/api/discovery';

/**
 * GET /api/v1  (also /v1 on an API-only host, and /haia/v1)
 * Machine-readable API index. Public (no key required). Human documentation
 * lives at /docs beneath this base; the OpenAPI spec at /openapi.json.
 */
export async function GET(request: Request) {
  return NextResponse.json(discoveryDoc(publicBase(request)));
}
