import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "./db";

export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const sql = db();
        const rows = await sql`
          SELECT id, email, name, password_hash, email_verified_at
          FROM users
          WHERE email = ${credentials.email}
        `;
        const user = rows[0] as
          | {
              id: string;
              email: string;
              name: string | null;
              password_hash: string | null;
              email_verified_at: string | null;
            }
          | undefined;

        if (!user || !user.password_hash) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        if (!user.email_verified_at) {
          // Caught client-side via result.error on the non-redirect
          // signIn() call - distinct from the generic wrong-password case.
          throw new Error("EmailNotVerified");
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;
      const sql = db();
      // Google's own OAuth flow already confirms the person controls
      // this email address, so Google sign-ins are auto-verified. The
      // credentials path's password_hash and verification columns are
      // untouched by this UPSERT either way.
      if (account?.provider === "google") {
        await sql`
          INSERT INTO users (email, name, email_verified_at)
          VALUES (${user.email}, ${user.name ?? null}, now())
          ON CONFLICT (email) DO UPDATE
          SET name = EXCLUDED.name,
              email_verified_at = COALESCE(users.email_verified_at, now())
        `;
      } else {
        await sql`
          INSERT INTO users (email, name)
          VALUES (${user.email}, ${user.name ?? null})
          ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        `;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const sql = db();
        const rows = await sql`SELECT id FROM users WHERE email = ${user.email}`;
        if (rows[0]) token.id = rows[0].id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.id;
      return session;
    },
  },
};