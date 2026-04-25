import { ConstructionIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  title: string;
  description: string;
  eta?: string;
};

export function ComingSoon({ title, description, eta }: Props) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ConstructionIcon className="size-4" />
            </div>
            <div className="space-y-0.5">
              <CardTitle>{title}</CardTitle>
              {eta && (
                <p className="text-xs font-medium text-muted-foreground">{eta}</p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {description}
        </CardContent>
      </Card>
    </div>
  );
}
