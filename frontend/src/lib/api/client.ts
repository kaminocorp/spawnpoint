import { createClient as createConnectClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { AgentsService } from "@/gen/corellia/v1/agents_pb";
import { OrganizationsService } from "@/gen/corellia/v1/organizations_pb";
import { UsersService } from "@/gen/corellia/v1/users_pb";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

export function createApiClient() {
  const supabase = createSupabaseClient();

  const transport = createConnectTransport({
    baseUrl: process.env.NEXT_PUBLIC_API_URL!,
    fetch: async (input, init) => {
      const { data } = await supabase.auth.getSession();
      const headers = new Headers(init?.headers);
      if (data.session) {
        headers.set("Authorization", `Bearer ${data.session.access_token}`);
      }
      return fetch(input, { ...init, headers });
    },
  });

  return {
    users: createConnectClient(UsersService, transport),
    organizations: createConnectClient(OrganizationsService, transport),
    agents: createConnectClient(AgentsService, transport),
  };
}
