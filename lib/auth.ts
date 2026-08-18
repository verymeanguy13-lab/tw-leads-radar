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
          SELECT id, email, name, password_hash
          FROM users
          WHERE email = ${credentials.email}
        `;
        const user = rows[0] as
          | { id: string; email: string; name: string | null; password_hash: string | null }
          | undefined;

        if (!user || !user.password_hash) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      // Credentials sign-ins already have a users row (created by the
      // signup route) - this UPSERT only ever touches name for that
      // path, never password_hash, so it can't clobber the hash.
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