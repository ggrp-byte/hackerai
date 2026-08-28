import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirectToAuthorizationUrl } from "@/lib/auth/auth-redirect-intents";

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (process.env.HACKERAI_LOCAL_MODEL === "true") {
    return Response.redirect(new URL("/", request.url), 307);
  }

  const authorizationUrl = await getSignUpUrl();
  return redirectToAuthorizationUrl(authorizationUrl, url);
}
