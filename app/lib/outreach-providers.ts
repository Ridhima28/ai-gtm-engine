import "server-only";
import { z } from "zod";
import { ContactResult } from "./outreach-schema";

export class OutreachProblem extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function enrichBusinessContact(name: string, domain: string) {
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) throw new OutreachProblem("Configure HUNTER_API_KEY to enrich contacts.", 503);
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", domain);
  url.searchParams.set("full_name", name);
  let response: Response;
  try {
    response = await fetch(url, { headers: { "X-API-KEY": key }, redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new OutreachProblem("Hunter could not be reached. Try again.", 502);
  }
  if (response.status === 404) return ContactResult.parse({ email: null, status: "not_found" });
  if (!response.ok) throw new OutreachProblem("Hunter could not verify a work email. Try again.", 502);
  const result = z.object({ data: z.object({
    email: z.email().nullish(),
    verification: z.object({ status: z.string().nullish() }).nullish(),
  }).nullish() }).safeParse(await response.json().catch(() => null));
  if (!result.success) throw new OutreachProblem("Hunter returned an unreadable result.", 502);
  const email = result.data.data?.email;
  const host = email?.split("@").at(-1)?.toLowerCase();
  if (!email || !host || (host !== domain && !host.endsWith(`.${domain}`))) {
    return ContactResult.parse({ email: null, status: "not_found" });
  }
  const status = result.data.data?.verification?.status;
  return ContactResult.parse({ email, status: status === "valid" || status === "accept_all" ? status : "unknown" });
}

const MailConfig = z.object({ key: z.string().trim().min(1), from: z.email(), recipient: z.email() });

export function outreachMailConfig() {
  const parsed = MailConfig.safeParse({
    key: process.env.SENDGRID_API_KEY,
    from: process.env.OUTREACH_FROM_EMAIL?.trim(),
    recipient: process.env.OUTREACH_TEST_RECIPIENT?.trim(),
  });
  if (!parsed.success) throw new OutreachProblem("Configure SendGrid, the sender, and the test inbox.", 503);
  return parsed.data;
}

export async function requestSendGrid(config: z.infer<typeof MailConfig>, draft: { subject: string; body: string }, sandbox: boolean) {
  return fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: config.recipient }] }],
      from: { email: config.from },
      subject: draft.subject,
      content: [{ type: "text/plain", value: draft.body }],
      mail_settings: { sandbox_mode: { enable: sandbox } },
      tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}

export async function sendGridRejection(response: Response) {
  const errors = z.object({ errors: z.array(z.object({ message: z.string() })) })
    .safeParse(await response.json().catch(() => null));
  const messages = errors.success ? errors.data.errors.map(({ message }) => message).join(" ") : "";
  if (/verified sender identity|not authorized to send from/i.test(messages)) {
    return "Verify OUTREACH_FROM_EMAIL as a SendGrid sender or use an authenticated domain.";
  }
  if (/credits exceeded|quota|sending limit/i.test(messages)) {
    return "Check the SendGrid account’s sending credits and limits.";
  }
  if (/account.*(?:disabled|suspended|under review|not active|not authorized)/i.test(messages)) {
    return "Check the SendGrid account’s sending eligibility.";
  }
  if (response.status === 401 || response.status === 403) {
    return "Check the SendGrid key’s Mail Send permission and sender authentication.";
  }
  return "";
}
