import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
    });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Signed in as {email}</p>
      <button onClick={() => supabase.auth.signOut()} className="underline">
        Log out
      </button>
    </div>
  );
}
