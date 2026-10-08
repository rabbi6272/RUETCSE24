import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_ERROR_PATH, startGoogleSignIn } from "../../../../../lib/auth/google.server";

export async function GET(request: NextRequest) {
  try {
    const url = await startGoogleSignIn(
      request.nextUrl.searchParams.get("next"),
      request.nextUrl.origin,
    );
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[auth] google start failed", error);
    return NextResponse.redirect(new URL(GOOGLE_ERROR_PATH, request.url));
  }
}
