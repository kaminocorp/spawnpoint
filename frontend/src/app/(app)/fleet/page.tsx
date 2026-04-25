import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = {
  title: "Fleet",
};

export default function FleetPage() {
  return (
    <ComingSoon
      title="Fleet"
      description="Every spawned agent, with status and logs. Fills in once spawn lands."
      eta="Available in v1"
    />
  );
}
