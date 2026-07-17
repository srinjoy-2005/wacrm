import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const profile = await db
          .select()
          .from(profiles)
          .where(eq(profiles.email, credentials.email))
          .limit(1)
          .then((res) => res[0]);

        if (!profile || !profile.hashed_password) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          profile.hashed_password
        );

        if (!isValid) return null;

        return {
          id: profile.user_id,
          email: profile.email,
          name: profile.full_name,
          accountId: profile.account_id,
          role: profile.account_role || profile.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accountId = (user as any).accountId;
        token.role = (user as any).role;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).accountId = token.accountId;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};
