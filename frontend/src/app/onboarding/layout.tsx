import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Welcome to Corellia" },
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
