import { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { decode } from "next-auth/jwt";
import { db } from "./db";

export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      id: "magic-link",
      name: "Magic Link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        if (!credentials?.token) return null;

        const payload = await decode({
          token: credentials.token,
          secret: process.env.NEXTAUTH_SECRET!,
        });

        if (!payload?.email || typeof payload.email !== "string") return null;

        const sql = db();
        const rows = await sql`
          INSERT INTO users (email)
          VALUES (${payload.email})
          ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
          RETURNING id, email, name
        `;
        const user = rows[0];
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as any).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.id;
      return session;
    },
  },
};