import { AppError, db } from "@/lib/server";
import { savedReference } from "@/services/production-categories.mjs";
import { productionSettings } from "@/services/production-direction.mjs";
export async function getSeries(id: string, owner: string) {
  const row = await db()
    .prepare("SELECT * FROM series WHERE id=? AND owner=?")
    .bind(id, owner)
    .first<any>();
  if (!row) throw new AppError("Series not found.", 404);
  const refs = await db()
    .prepare(
      "SELECT data,source_project FROM series_assets WHERE series_id=? ORDER BY asset_id",
    )
    .bind(id)
    .all<any>();
  return {
    ...row,
    ...JSON.parse(row.data),
    assets: refs.results.map((r) => ({
      ...JSON.parse(r.data),
      sourceProject: r.source_project,
    })),
  };
}
// First approved identity wins. Changes in one episode never silently replace
// the shared identity used by other episodes. An explicit adoption can replace it.
export function referenceStatements(
  p: any,
  owner: string,
  overwrite = false,
  checkpoint?: { version: number; data: string },
) {
  if (!p.seriesId) return [];
  const now = Date.now();
  const guard = checkpoint
    ? " AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)"
    : "";
  const guardValues = checkpoint
    ? [p.id, checkpoint.version, checkpoint.data]
    : [];
  const template = {
    productionBible: p.productionBible,
    style: p.style,
    ...productionSettings(p),
  };
  return [
    db()
      .prepare(
        "UPDATE series SET data=CASE WHEN json_extract(data,'$.productionBible') IS NULL THEN ? ELSE data END,updated=? WHERE id=? AND owner=?" +
          guard,
      )
      .bind(JSON.stringify(template), now, p.seriesId, owner, ...guardValues),
    ...p.assets
      .filter((a: any) => a.imageKey)
      .map((a: any) =>
        db()
          .prepare(
            `INSERT INTO series_assets(series_id,asset_id,data,source_project,updated) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM series WHERE id=? AND owner=?)${guard} ON CONFLICT(series_id,asset_id) ${overwrite ? "DO UPDATE SET data=excluded.data,source_project=excluded.source_project,updated=excluded.updated" : "DO NOTHING"}`,
          )
          .bind(
            p.seriesId,
            a.id,
            JSON.stringify(savedReference(a)),
            p.id,
            now,
            p.seriesId,
            owner,
            ...guardValues,
          ),
      ),
  ];
}
export async function seedSeries(p: any, owner: string) {
  if (!p.seriesId) return p;
  const s = await getSeries(p.seriesId, owner);
  const active = await db()
    .prepare(
      "SELECT 1 FROM productions WHERE series_id=? AND owner=? AND id<>? AND status IN ('planning','planned','preparing') LIMIT 1",
    )
    .bind(p.seriesId, owner, p.id)
    .first();
  if (active)
    throw new AppError(
      "Another episode is still preparing this series’ references. Your draft is saved; start planning after its preparation finishes.",
      409,
    );
  return {
    ...p,
    assets: [...s.assets.filter((a:any)=>!p.assets.some((own:any)=>own.id===a.id)).map(savedReference), ...p.assets],
    productionBible: s.productionBible,
  };
}
