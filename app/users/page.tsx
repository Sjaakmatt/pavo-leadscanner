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

type MyProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "member";
  notif_email_alerts: boolean;
  notif_email_team: boolean;
};

type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: "admin" | "member";
  orgId: string;
  orgNaam: string | null;
};

type Organization = {
  id: string;
  naam: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [orgEditOpen, setOrgEditOpen] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState("");
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
        organization?: Organization;
      };
      setUsers(body.users);
      setMe(body.currentUser);
      if (body.organization) {
        setOrganization(body.organization);
        setOrgNameDraft(body.organization.naam ?? "");
      }

      // Mijn voorkeuren los — andere shape met notif-vlaggen.
      try {
        const meRes = await fetch("/api/users/me", { cache: "no-store" });
        if (meRes.ok) {
          const meBody = (await meRes.json()) as { profile: MyProfile };
          setMyProfile(meBody.profile);
        }
      } catch {
        // silent
      }
    } finally {
      setLoading(false);
    }
  }, []);

  async function updateMyPrefs(
    patch: Partial<Pick<MyProfile, "notif_email_alerts" | "notif_email_team" | "full_name">>,
  ) {
    if (!myProfile) return;
    const optimistic = { ...myProfile, ...patch };
    setMyProfile(optimistic);
    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const body = (await res.json()) as { profile: MyProfile };
      setMyProfile(body.profile);
    } else {
      setMyProfile(myProfile); // revert
    }
  }

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

  async function saveOrgName() {
    const naam = orgNameDraft.trim();
    if (!naam || !organization || naam === organization.naam) {
      setOrgEditOpen(false);
      return;
    }
    const res = await fetch("/api/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ naam }),
    });
    if (res.ok) {
      const body = (await res.json()) as { organization: Organization };
      setOrganization(body.organization);
      setOrgEditOpen(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
            Gebruikers
          </h1>
          <p className="mt-2 text-sm text-pavo-gray-600">
            {isAdmin
              ? "Nodig collega's uit en beheer rollen. Magic-link login werkt direct na invite."
              : "Lijst van gebruikers in deze workspace. Vraag een admin om iemand uit te nodigen."}
          </p>
        </div>
        {organization && (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              Organisatie
            </p>
            {orgEditOpen && isAdmin ? (
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="text"
                  value={orgNameDraft}
                  onChange={(e) => setOrgNameDraft(e.target.value)}
                  className="w-44 rounded-md border border-pavo-gray-100 bg-white px-2 py-1 text-sm focus:border-pavo-teal focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveOrgName}
                  className="rounded-md bg-pavo-teal px-2 py-1 text-xs font-semibold text-white"
                >
                  Opslaan
                </button>
              </div>
            ) : (
              <p className="mt-0.5 flex items-center justify-end gap-2 text-sm font-medium text-pavo-navy">
                {organization.naam}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setOrgEditOpen(true)}
                    className="text-[11px] text-pavo-teal hover:underline"
                  >
                    hernoem
                  </button>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {myProfile && (
        <section className="mt-6 rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Mijn instellingen
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
                Volledige naam
              </span>
              <input
                type="text"
                defaultValue={myProfile.full_name ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (myProfile.full_name ?? "")) {
                    updateMyPrefs({ full_name: v });
                  }
                }}
                className="mt-1 w-full rounded-md border border-pavo-gray-100 bg-white px-2 py-1.5 text-sm focus:border-pavo-teal focus:outline-none"
              />
            </label>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
                E-mail-meldingen
              </p>
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={myProfile.notif_email_alerts}
                  onChange={(e) =>
                    updateMyPrefs({ notif_email_alerts: e.target.checked })
                  }
                  className="h-4 w-4 accent-pavo-teal"
                />
                Saved-search matches
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={myProfile.notif_email_team}
                  onChange={(e) =>
                    updateMyPrefs({ notif_email_team: e.target.checked })
                  }
                  className="h-4 w-4 accent-pavo-teal"
                />
                Team-events (lead-status wijzigingen)
              </label>
              <p className="mt-1.5 text-[10px] text-pavo-gray-600">
                In-app meldingen blijven altijd aan. E-mail werkt alleen
                als de admin Resend heeft gekoppeld.
              </p>
            </div>
          </div>
        </section>
      )}

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
