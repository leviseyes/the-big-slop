import AssetLibrary from '@/components/asset-library';
import { requireStudioUser } from '../auth';
export const dynamic='force-dynamic';
export default async function AssetsPage(){await requireStudioUser('/assets');return <AssetLibrary/>;}
