import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Custom logic can go here if needed.
    // For now, next-auth handles the redirect to signIn page if not authenticated.
    return NextResponse.next();
  },
  {
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;
        
        // Public API routes
        if (path.startsWith('/api/whatsapp/webhook')) {
          return true;
        }
        
        // If it's a protected API route (e.g. other /api/whatsapp/ routes),
        // we require a token.
        if (path.startsWith('/api/whatsapp/')) {
          return !!token;
        }
        
        // For UI routes, if the user doesn't have a token, withAuth will automatically
        // redirect them to the signIn page (/login).
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    '/dashboard/:path*', 
    '/inbox/:path*', 
    '/contacts/:path*', 
    '/pipelines/:path*', 
    '/broadcasts/:path*', 
    '/automations/:path*', 
    '/settings/:path*',
    '/api/whatsapp/:path*'
  ],
};
