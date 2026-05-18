// Resend HTTP-client. Geen SDK-dependency — Resend's REST is simpel
// genoeg dat we 'm direct aanroepen. Activeert alleen als RESEND_API_KEY
// + RESEND_FROM_EMAIL gezet zijn; anders is de hele e-mail-laag een
// no-op zodat lokaal/demo zonder e-mail provider blijft werken.
//
// Spec: https://resend.com/docs/api-reference/emails/send-email

const REQUEST_TIMEOUT_MS = 10_000;

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

class EmailClient {
  private readonly apiKey: string | null;
  private readonly from: string | null;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || null;
    this.from = process.env.RESEND_FROM_EMAIL || null;
  }

  get enabled(): boolean {
    return !!this.apiKey && !!this.from;
  }

  async send(args: SendArgs): Promise<{ ok: boolean; error?: string }> {
    if (!this.enabled || !this.apiKey || !this.from) {
      return { ok: false, error: "Resend not configured" };
    }
    if (!args.to || !args.to.includes("@")) {
      return { ok: false, error: "Invalid recipient" };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: args.to,
          subject: args.subject,
          html: args.html,
          text: args.text,
          reply_to: args.replyTo,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `Resend ${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __emailClient: EmailClient | undefined;
}

const client: EmailClient = globalThis.__emailClient ?? new EmailClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__emailClient = client;
}

export const email = client;
