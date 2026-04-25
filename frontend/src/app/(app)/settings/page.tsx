import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Workspace name, members, billing. For now, you can rename your workspace from sign-up."
      eta="Polish pass"
    />
  );
}
