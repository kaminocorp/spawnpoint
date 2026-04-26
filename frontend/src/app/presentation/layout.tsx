import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Presentation",
};

export default function PresentationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
