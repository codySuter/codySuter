import { notFound } from "next/navigation";
import { getCampaignContext, getEntryTypes } from "@/lib/data";
import { AppShell } from "@/components/shell/AppShell";

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const ctx = await getCampaignContext(campaignId);
  if (!ctx) notFound();

  const entryTypes = ctx.isEditor ? await getEntryTypes(campaignId) : [];

  return (
    <AppShell
      campaignId={campaignId}
      campaignName={ctx.campaignName}
      role={ctx.role}
      isEditor={ctx.isEditor}
      entryTypes={entryTypes.map((t) => ({
        key: t.key,
        label: t.label,
        icon: t.icon,
      }))}
    >
      {children}
    </AppShell>
  );
}
