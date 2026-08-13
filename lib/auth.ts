import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import FacebookProvider from "next-auth/providers/facebook";
import { db } from "./db";

export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_CLIENT_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const sql = db();
      await sql`
        INSERT INTO users (email, name)
        VALUES (${user.email}, ${user.name ?? null})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      `;
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