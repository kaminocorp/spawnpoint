import { Deck } from "@/components/presentation/deck";

export default function PresentationPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-black text-foreground">
      <Deck />
    </main>
  );
}
