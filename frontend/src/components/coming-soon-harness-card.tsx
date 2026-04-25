import { SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  name: string;
  description: string;
  vendor?: string;
};

export function ComingSoonHarnessCard({ name, description, vendor }: Props) {
  return (
    <Card className="opacity-75">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <SparklesIcon className="size-4" />
            </div>
            <CardTitle>{name}</CardTitle>
          </div>
          <Badge variant="secondary">Coming Soon</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p>{description}</p>
        {vendor && (
          <p className="mt-2 text-xs text-muted-foreground/80">by {vendor}</p>
        )}
      </CardContent>
    </Card>
  );
}
