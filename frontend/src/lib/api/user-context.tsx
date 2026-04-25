"use client";

import { createContext, useContext } from "react";

import type { Organization } from "@/gen/corellia/v1/organizations_pb";
import type { User } from "@/gen/corellia/v1/users_pb";

type UserContextValue = {
  user: User;
  org: Organization;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  value,
  children,
}: {
  value: UserContextValue;
  children: React.ReactNode;
}) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error(
      "useUser must be used inside <UserProvider>. Likely cause: a chrome route rendered outside (app)/layout.tsx.",
    );
  }
  return ctx;
}
