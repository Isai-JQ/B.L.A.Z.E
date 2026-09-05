import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// Routes reachable without an active Supabase session.
const PUBLIC_ROUTES = ["/login"];

// ponytail: client-side auth guard. supabase-js keeps the session in
// localStorage, which edge middleware can't read, so guarding happens here on
// mount. Switch to middleware.ts + @supabase/ssr cookie storage if we ever need
// server-rendered protected routes.
export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const isPublic = PUBLIC_ROUTES.includes(router.pathname);

  useEffect(() => {
    if (!loaded) return;
    if (!session && !isPublic) router.replace("/login");
    if (session && isPublic) router.replace("/");
  }, [loaded, session, isPublic, router]);

  if (!loaded) return null;
  if (!session && !isPublic) return null;
  if (session && isPublic) return null;

  return <Component {...pageProps} />;
}
