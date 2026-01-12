// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

function decodeBasicAuth(authHeader: string | null) {
  if (!authHeader?.startsWith('Basic ')) return null;

  const b64 = authHeader.slice('Basic '.length).trim();
  try {
    // Edge Runtime: usa atob en lugar de Buffer
    const decoded = atob(b64);
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;

    return {
      user: decoded.slice(0, idx),
      pass: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // deja pasar assets y un ping
  const open = [/^\/_next\//, /^\/favicon\.ico$/, /^\/health$/];
  if (open.some((r) => r.test(pathname))) return NextResponse.next();

  const user = process.env.INTERNAL_BASIC_AUTH_USER || '';
  const pass = process.env.INTERNAL_BASIC_AUTH_PASS || '';

  // Fail-closed: si no están definidas las env vars, NO dejes la app abierta
  if (!user || !pass) {
    return new NextResponse('Basic Auth env vars missing', { status: 500 });
  }

  const creds = decodeBasicAuth(req.headers.get('authorization'));
  if (!creds) {
    return new NextResponse('Auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ALCAMPO"' },
    });
  }

  if (creds.user !== user || creds.pass !== pass) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  return NextResponse.next();
}

export const config = { matcher: ['/((?!api/public).*)'] };
