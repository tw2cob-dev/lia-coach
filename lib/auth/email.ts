const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendVerificationEmail(args: {
  to: string;
  code: string;
  name?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL");
  }

  const subject = "Tu codigo de verificacion LIA Coach";
  const greeting = args.name ? `Hola ${args.name},` : "Hola,";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
      <p>${greeting}</p>
      <p>Tu codigo de verificacion es:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${args.code}</p>
      <p>Caduca en 10 minutos.</p>
    </div>
  `;

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend error: ${text}`);
  }
}
