import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const NEW_ORG_VALUE = "__new__";

type Organization = { id: string; name: string };

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isLogin) return;
    supabase
      .from("organizations")
      .select("id, name")
      .order("name")
      .then(({ data }) => setOrganizations(data ?? []));
  }, [isLogin]);

  const resolveOrganizationName = (): string =>
    selectedOrg === NEW_ORG_VALUE
      ? newOrgName.trim()
      : (organizations.find((org) => org.id === selectedOrg)?.name ?? "");

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");

    if (!isLogin) {
      if (!/@tec\.mx$/i.test(email.trim())) {
        setMessage("Error: el registro está restringido a correos @tec.mx.");
        return;
      }
      if (!selectedOrg) {
        setMessage("Error: elige una organización.");
        return;
      }
      if (selectedOrg === NEW_ORG_VALUE && !newOrgName.trim()) {
        setMessage("Error: escribe el nombre de la nueva organización.");
        return;
      }
    }

    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(`Error: ${error.message}`);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { organization_name: resolveOrganizationName() } },
    });
    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
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

          {!isLogin && (
            <div>
              <label className="block text-gray-400 mb-1 text-xs uppercase tracking-wider">
                Organización
              </label>
              <select
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none transition-colors"
              >
                <option value="">Selecciona tu organización</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
                <option value={NEW_ORG_VALUE}>Otra (agregar nueva)</option>
              </select>

              {selectedOrg === NEW_ORG_VALUE && (
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Nombre de la organización"
                  required
                  className="mt-2 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:border-blue-500 outline-none transition-colors"
                />
              )}
            </div>
          )}

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
