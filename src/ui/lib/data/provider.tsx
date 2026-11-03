import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { connectEvents } from "./events.ts";
import { createQueryClient } from "./query.ts";

export function DataProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [c] = useState(() => client ?? createQueryClient());
  useEffect(() => connectEvents(c), [c]);
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}
