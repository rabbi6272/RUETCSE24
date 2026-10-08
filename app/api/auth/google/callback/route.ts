import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_ERROR_PATH, completeGoogleSignIn } from "../../../../../lib/auth/google.server";
import { revalidateAll } from "../../../../../lib/revalidate";

export async function GET(request: NextRequest) {
  let path = GOOGLE_ERROR_PATH;
  try {
    path = await completeGoogleSignIn(request.nextUrl.searchParams);
  } catch (error) {
    console.error("[auth] google callback failed", error);
  }
  // A Google sign-in may have just created an account (or linked one).
  if (path !== GOOGLE_ERROR_PATH) revalidateAll();

  return NextResponse.redirect(new URL(path, request.url));
}
