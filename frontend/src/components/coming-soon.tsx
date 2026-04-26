import { TerminalContainer } from "@/components/ui/terminal-container";

type Props = {
  title: string;
  description: string;
  eta?: string;
};

export function ComingSoon({ title, description, eta }: Props) {
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
            [ MODULE ]
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
            {title}
          </h1>
        </div>
        {eta && (
          <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            ETA — {eta}
          </span>
        )}
      </header>

      <div className="mx-auto max-w-md">
        <TerminalContainer title="STATUS — PLANNED" accent="pending">
          <p className="text-sm text-muted-foreground">{description}</p>
        </TerminalContainer>
      </div>
    </div>
  );
}
