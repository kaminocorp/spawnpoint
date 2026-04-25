export type ComingSoonHarness = {
  name: string;
  description: string;
  vendor: string;
};

export const COMING_SOON_HARNESSES: ComingSoonHarness[] = [
  {
    name: "LangGraph",
    description:
      "Stateful, multi-actor agents on LangChain's graph runtime.",
    vendor: "LangChain",
  },
  {
    name: "CrewAI",
    description:
      "Role-based multi-agent orchestration. Define a crew, give them tasks.",
    vendor: "CrewAI Inc.",
  },
  {
    name: "AutoGen",
    description: "Microsoft's multi-agent conversation framework.",
    vendor: "Microsoft Research",
  },
];
