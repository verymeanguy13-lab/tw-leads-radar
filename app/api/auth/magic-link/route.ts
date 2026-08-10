import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: NextRequest) {
  const { email, callbackUrl } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const safeCallbackUrl = typeof callbackUrl === "string" ? callbackUrl : "/searches";

  const token = await encode({
    token: { email },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 15 * 60,
  });

  const link = `${process.env.NEXTAUTH_URL}/login/verify?token=${token}&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: email,
    subject: "\u65b0\u516c\u53f8\u5feb\u5831 \u2014 \u767b\u5165\u9023\u7d50",
    html: `<p>Click to log in (expires in 15 minutes):</p><p><a href="${link}">${link}</a></p>`,
  });

  if (result.error) {
    console.error("[magic-link] Resend send failed:", result.error);
    return NextResponse.json(
      { error: "Failed to send login email. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true });
}