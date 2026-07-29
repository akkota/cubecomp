import type { ReactNode } from "react";

// Scramble generation uses cubing.js worker_threads and must run in Node.
export const runtime = "nodejs";

// Applied to Server Actions invoked from this route. Typical generation takes
// 1–3 seconds, but this protects cold starts on constrained deployments.
export const maxDuration = 60;

export default function CompetitionAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
