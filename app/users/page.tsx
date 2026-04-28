"use client";

import { useCallback, useEffect, useState } from "react";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "member";
  invited_by: string | null;
  created_at: string;
};

type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: "admin" | "member";
};

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.status === 503) {
        const body = (await res.json()) as { error?: string };
        setUnavailable(body.error ?? "Auth niet geconfigureerd");
        return;
      }
      if (!res.ok) {
        setError(`Laden faalde: ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        users: Profile[];
        currentUser: CurrentUser;
      };
      setUsers(body.users);
      setMe(body.currentUser);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviting) return;
    setInviting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteName || undefined,
          role: inviteRole,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Invite faalde");
        return;
      }
      setSuccess(`Invite verstuurd naar ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      await reload();
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(id: string, role: "admin" | "member") {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      await reload();
    } else {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Update faalde");
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Weet je zeker dat je deze user wilt verwijderen?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      await reload();
    } else {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Verwijderen faalde");
    }
  }

  if (unavailable) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Gebruikers</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">{unavailable}</p>
        <p className="mt-2 text-xs text-pavo-gray-600">
          Configureer Supabase env vars en draai migration 005 om
          user-management te activeren.
        </p>
      </div>
    );
  }

  const isAdmin = me?.role === "admin";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
        Gebruikers
      </h1>
      <p className="mt-2 text-sm text-pavo-gray-600">
        {isAdmin
          ? "Nodig collega's uit en beheer rollen. Magic-link login werkt direct na invite."
          : "Lijst van gebruikers in deze workspace. Vraag een admin om iemand uit te nodigen."}
      </p>

      {isAdmin && (
        <section className="mt-6 rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Nieuwe gebruiker uitnodigen
          </h2>
          <form
            onSubmit={handleInvite}
            className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12"
          >
            <input
              type="email"
              required
              placeholder="email@bedrijf.nl"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviting}
              className="rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none md:col-span-5"
            />
            <input
              type="text"
              placeholder="Naam (optioneel)"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              disabled={inviting}
              className="rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none md:col-span-3"
            />
            <select
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "member" | "admin")
              }
              disabled={inviting}
              className="rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm focus:border-pavo-teal focus:outline-none md:col-span-2"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
            >
              {inviting ? "Versturen…" : "Uitnodigen"}
            </button>
          </form>
          {success && (
            <p className="mt-3 text-xs text-emerald-700">{success}</p>
          )}
          {error && <p className="mt-3 text-xs text-pavo-orange">{error}</p>}
        </section>
      )}

      <section className="mt-6 rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
        <div className="border-b border-pavo-gray-100 px-5 py-3 md:px-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            {users.length} {users.length === 1 ? "gebruiker" : "gebruikers"}
          </h2>
        </div>
        {loading ? (
          <div className="space-y-2 p-5">
            <div className="h-5 w-3/4 animate-pulse rounded bg-pavo-gray-100" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-pavo-gray-100" />
          </div>
        ) : (
          <ul className="divide-y divide-pavo-gray-100">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 px-5 py-3 md:px-6"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-pavo-gray-900">
                    {u.full_name ?? u.email}
                    {me?.id === u.id && (
                      <span className="ml-2 text-xs text-pavo-gray-600">
                        (jij)
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-pavo-gray-600">
                    {u.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && me?.id !== u.id ? (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        handleRoleChange(
                          u.id,
                          e.target.value as "admin" | "member",
                        )
                      }
                      className="rounded-md border border-pavo-gray-100 bg-white px-2 py-1 text-xs focus:border-pavo-teal focus:outline-none"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-pavo-teal/10 text-pavo-teal"
                          : "bg-pavo-gray-100 text-pavo-gray-900"
                      }`}
                    >
                      {u.role}
                    </span>
                  )}
                  {isAdmin && me?.id !== u.id && (
                    <button
                      type="button"
                      onClick={() => handleRemove(u.id)}
                      className="text-xs text-pavo-orange transition-colors hover:underline"
                    >
                      Verwijder
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
