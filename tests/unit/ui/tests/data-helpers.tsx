import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";

// ponytail: a fresh cache per render, with no retry, so a failed read says so at once
export function testClient(): QueryClient {
  const c = createQueryClient();
  c.setDefaultOptions({
    queries: { ...c.getDefaultOptions().queries, retry: false },
    mutations: { ...c.getDefaultOptions().mutations, retry: false },
  });
  return c;
}

export function WithData({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <DataProvider client={client}>{children}</DataProvider>;
}
