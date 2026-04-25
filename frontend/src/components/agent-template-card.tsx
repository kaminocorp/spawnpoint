import { BotIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";

type Props = {
  template: AgentTemplate;
};

export function AgentTemplateCard({ template }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BotIcon className="size-4" />
          </div>
          <CardTitle>{template.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {template.description}
      </CardContent>
      <CardFooter className="justify-end">
        <Tooltip>
          <TooltipTrigger
            render={<span tabIndex={0} className="inline-flex" />}
          >
            <Button disabled>Deploy</Button>
          </TooltipTrigger>
          <TooltipContent>Available in v1</TooltipContent>
        </Tooltip>
      </CardFooter>
    </Card>
  );
}
