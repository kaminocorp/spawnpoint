"use client";

import { useState } from "react";
import { BotIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeployModal } from "@/components/agents/deploy-modal";
import type { AgentTemplate } from "@/gen/corellia/v1/agents_pb";

type Props = {
  template: AgentTemplate;
};

export function AgentTemplateCard({ template }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"one" | "many">("one");

  function openWith(next: "one" | "many") {
    setMode(next);
    setOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="halftone-bg flex size-9 items-center justify-center rounded-md text-primary">
            <BotIcon className="size-4" />
          </div>
          <CardTitle>{template.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {template.description}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={() => openWith("many")}>
          Deploy 5
        </Button>
        <Button onClick={() => openWith("one")}>Deploy</Button>
      </CardFooter>

      <DeployModal
        open={open}
        onOpenChange={setOpen}
        template={template}
        mode={mode}
      />
    </Card>
  );
}
