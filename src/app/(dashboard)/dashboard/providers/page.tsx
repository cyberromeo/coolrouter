"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ClassicProvidersView from "./ClassicProvidersView";
import SimpleProvidersPage from "./SimpleProvidersPage";

/**
 * Providers. The simple view (your connections + the gallery) is the default; the
 * detailed view with every card, bulk tests and imports stays at ?view=all.
 */
function ProvidersPageContent() {
  const view = useSearchParams().get("view");
  return view === "all" ? <ClassicProvidersView /> : <SimpleProvidersPage />;
}

export default function ProvidersPage() {
  return (
    <Suspense fallback={null}>
      <ProvidersPageContent />
    </Suspense>
  );
}
