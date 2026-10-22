import Library from "@/components/library";
import { requireStudioUser } from "../auth";
export const dynamic = "force-dynamic";
export default async function LibraryPage() {
  await requireStudioUser("/library");
  return <Library />;
}
