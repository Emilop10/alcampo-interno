// src/middleware.ts
import { NextResponse } from 'next/server';

export function middleware(req: Request) {
  const url = new URL(req.url);
  // deja pasar assets y un ping
  const open = [/^\/_next\//, /^\/favicon\.ico$/, /^\/health$/];
  if (open.some((r) => r.test(url.pathname))) return NextResponse.next();

  const user = process.env.INTERNAL_BASIC_AUTH_USER || '';
  const pass = process.env.INTERNAL_BASIC_AUTH_PASS || '';

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) {
    return new NextResponse('Auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ALCAMPO"' },
    });
  }

  const [u, p] = Buffer.from(auth.split(' ')[1], 'base64')
    .toString()
    .split(':');

  if (u !== user || p !== pass) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api/public).*)'] };
