import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spawn — Corellia",
};

export default function SpawnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
