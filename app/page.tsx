import Studio from "@/components/studio";
import { requireStudioUser } from "./auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requireStudioUser("/");
  return <Studio />;
}
