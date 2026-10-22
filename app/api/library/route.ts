import { assetLibraryCatalog } from "@/services/asset-library.mjs";
import { z } from "zod";
import {
  AppError,
  bucket,
  db,
  failure,
  getProject,
  identity,
  json,
  originCheck,
} from "@/lib/server";
import { getSeries, referenceStatements } from "@/lib/series";
import { CATEGORIES, categoryOf } from "@/services/production-categories.mjs";
import { productionSettings } from "@/services/production-direction.mjs";
export const dynamic = "force-dynamic";
const category = z.string().refine((v) => CATEGORIES.includes(v));
const uuid = z.string().uuid();
export async function POST(req: Request) {
  try {
    originCheck(req);
    const user = await identity(),
      body = (await req.json()) as any;
    if (body.action === "list") {
      const [productions, groups] = await Promise.all([
        db()
          .prepare(
            "SELECT id,title,status,category,series_id,created,updated,json_extract(data,'$.format') AS format,json_extract(data,'$.outputKey') AS outputKey,json_extract(data,'$.targetMinutes') AS targetMinutes,json_extract(data,'$.resolution') AS resolution,json_array_length(json_extract(data,'$.clips')) AS clipCount,COALESCE(json_extract(data,'$.clips[0].frameKey'),json_extract(data,'$.assets[0].imageKey')) AS posterKey FROM productions WHERE owner=? ORDER BY created DESC",
          )
          .bind(user)
          .all<any>(),
        db()
          .prepare(
            "SELECT s.id,s.name,s.category,(SELECT COUNT(*) FROM series_assets a WHERE a.series_id=s.id) AS referenceCount,(SELECT COUNT(*) FROM productions p WHERE p.series_id=s.id AND p.owner=s.owner) AS episodeCount FROM series s WHERE owner=? ORDER BY updated DESC",
          )
          .bind(user)
          .all<any>(),
      ]);
      return json({
        productions: productions.results.map((p) => ({
          ...p,
          category: categoryOf(p),
          seriesId: p.series_id,
        })),
        series: groups.results,
      });
    }
    if (body.action === "imageAssets") {
      const {project:p}=await getProject(uuid.parse(body.id),user);
      const catalog=assetLibraryCatalog(p);
      const listed=await bucket().list({prefix:`${p.id}/`,limit:200,cursor:typeof body.cursor==='string'?body.cursor:undefined});
      const known=new Map(catalog.map((a:any)=>[a.key,a]));
      const stored=listed.objects.filter((o:any)=>/\.(png|jpe?g|webp|gif|avif)$/i.test(o.key)).map((o:any)=>known.get(o.key)||({key:o.key,name:o.key.split('/').slice(1).join(' / '),group:'Saved versions',description:'Saved production image',source:'Saved',created:o.uploaded}));
      // Current references can be inherited from another production in this owner's series.
      const inherited=!body.cursor?catalog.filter((a:any)=>!a.key.startsWith(`${p.id}/`)):[];
      return json({assets:[...stored,...inherited],cursor:listed.truncated?listed.cursor:null});
    }
    if (body.action === "createSeries") {
      const name = z.string().trim().min(1).max(120).parse(body.name),
        cat = category.parse(body.category),
        id = crypto.randomUUID(),
        now = Date.now();
      await db()
        .prepare(
          "INSERT INTO series(id,owner,name,category,created,updated) VALUES(?,?,?,?,?,?)",
        )
        .bind(id, user, name, cat, now, now)
        .run();
      return json({ series: await getSeries(id, user) });
    }
    if (body.action === "series")
      return json({ series: await getSeries(uuid.parse(body.seriesId), user) });
    if (body.action === "newEpisode") {
      const s = await getSeries(uuid.parse(body.seriesId), user),
        id = crypto.randomUUID(),
        now = Date.now();
      const count = await db()
        .prepare(
          "SELECT count(*) AS n FROM productions WHERE series_id=? AND owner=?",
        )
        .bind(s.id, user)
        .first<any>();
      const p = {
        id,
        title: `${s.name.slice(0, 95)} — Episode ${count.n + 1}`,
        format: s.category,
        category: s.category,
        seriesId: s.id,
        status: "draft",
        script: "",
        style: s.style || "Cinematic",
        ...productionSettings(s),
        targetMinutes: 5,
        phase: "",
        assets: [],
        clips: [],
      };
      await db()
        .prepare(
          "INSERT INTO productions(id,owner,title,status,data,category,series_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          user,
          p.title,
          "draft",
          JSON.stringify(p),
          s.category,
          s.id,
          now,
          now,
        )
        .run();
      return json({ project: p });
    }
    const row = await getProject(uuid.parse(body.id), user),
      p = row.project;
    if (body.action === "rename") {
      const parsed = z.string().trim().min(1).max(120).safeParse(body.title);
      if (!parsed.success) throw new AppError("Enter a production title between 1 and 120 characters.");
      // Independent metadata: do not invalidate a running worker's version.
      await db().prepare("UPDATE productions SET title=?,updated=? WHERE id=? AND owner=?")
        .bind(parsed.data, Date.now(), row.id, user).run();
      return json({ id: row.id, title: parsed.data });
    }
    if (body.action === "organize") {
      const title = body.title === undefined ? p.title : z.string().trim().min(1).max(120).parse(body.title);
      const cat = category.parse(body.category),
        seriesId = body.seriesId == null ? null : uuid.parse(body.seriesId);
      if (seriesId) await getSeries(seriesId, user);
      if (
        seriesId !== p.seriesId &&
        !["draft", "ready", "complete"].includes(p.status)
      )
        throw new AppError(
          "You can change the category now. Wait for preparation to finish before moving this production into a different series.",
          409,
        );
      const next = { ...p, title, category: cat, format: cat, seriesId };
      if (
        ["writing", "planning", "preparing", "queued", "rendering", "stitching"].includes(
          p.status,
        )
      ) {
        await db()
          .prepare(
            "UPDATE productions SET category=?,title=?,updated=? WHERE id=? AND owner=?",
          )
          .bind(cat, title, Date.now(), p.id, user)
          .run();
        return json({ project: next });
      }
      const r = await db()
        .prepare(
          "UPDATE productions SET title=?,category=?,series_id=?,data=?,version=version+1,updated=? WHERE id=? AND owner=? AND version=?",
        )
        .bind(
          title,
          cat,
          seriesId,
          JSON.stringify(next),
          Date.now(),
          p.id,
          user,
          row.version,
        )
        .run();
      if (!r.meta.changes)
        throw new AppError("Production changed. Refresh and try again.", 409);
      const statements = referenceStatements(next, user);
      if (statements.length) await db().batch(statements);
      return json({ project: next });
    }
    if (body.action === "adoptReferences") {
      if (!p.seriesId || !["ready", "complete"].includes(p.status))
        throw new AppError(
          "Choose a prepared or completed episode in a series.",
          409,
        );
      await getSeries(p.seriesId, user);
      const statements = referenceStatements(p, user, true);
      if (statements.length) await db().batch(statements);
      if (p.productionBible)
        await db()
          .prepare("UPDATE series SET data=? WHERE id=? AND owner=?")
          .bind(
            JSON.stringify({
              productionBible: p.productionBible,
              style: p.style,
              ...productionSettings(p),
            }),
            p.seriesId,
            user,
          )
          .run();
      return json({ ok: true });
    }
    throw new AppError("Unknown library action.");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        { error: "Check the category, series name and production." },
        400,
      );
    return failure(e);
  }
}
