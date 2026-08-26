import { Passkey } from "@convex-dev/auth/providers/Passkey";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Passkey],
});
