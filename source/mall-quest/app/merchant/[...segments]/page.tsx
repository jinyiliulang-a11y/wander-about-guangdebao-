import TreasureApp from "@/components/treasure-app";
import { notFound } from "next/navigation";
import { PROJECT_EDITION } from "@/lib/project-edition";

export default async function MerchantPage({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  // This old combined-app path selects the operations workspace. It is not a
  // merchant page in the standalone merchant edition, even on a direct GET.
  if (PROJECT_EDITION === "merchant" && segments.length === 1 && segments[0] === "review") notFound();
  return <TreasureApp />;
}
