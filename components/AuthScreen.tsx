import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = isLogin
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else if (!isLogin) {
      setMessage("Success! Check your email to confirm your account.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 p-8 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-2xl font-bold mb-6 text-white text-center">
          {isLogin ? "Welcome Back" : "Create an Account"}
        </h2>

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <div>
            <label className="block text-gray-400 mb-1 text-xs uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alumno@tec.mx"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-gray-400 mb-1 text-xs uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-4 bg-blue-600 text-white font-bold py-2 px-4 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Processing..." : isLogin ? "Log In" : "Register"}
          </button>

          {message && (
            <p
              className={`text-sm mt-2 text-center ${message.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
            >
              {message}
            </p>
          )}
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setMessage("");
            }}
            className="text-sm text-gray-400 hover:text-blue-400 transition-colors"
          >
            {isLogin
              ? "Don't have an account? Register here."
              : "Already have an account? Log in."}
          </button>
        </div>
      </div>
    </div>
  );
}
