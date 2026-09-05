import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import AuthScreen from "@/components/AuthScreen";

export default function Home() {
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

  if (!loaded) return null;
  if (!session) return <AuthScreen />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Signed in as {session.user.email}</p>
      <button onClick={() => supabase.auth.signOut()} className="underline">
        Log out
      </button>
    </div>
  );
}
