const normalized = s => String(s).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export function assetConflicts(plan, existing) {
  const ids = new Set();
  for (const a of plan.assets) {
    if (!/^[a-z0-9_-]{1,100}$/.test(a.id) || ids.has(a.id)) throw new Error("The director must use unique valid asset IDs within a section.");
    ids.add(a.id);
  }
  return plan.assets.filter(a => {
    const known = existing.find(v => v.id === a.id);
    return known && (known.kind !== a.kind || normalized(known.name) !== normalized(a.name));
  });
}

// Build a new registry and remap this section atomically. Established reference
// descriptions and images are never overwritten by a later naming variation.
export function mergePlanAssets(plan, existing, decisions = [], section = 0) {
  const conflicts = assetConflicts(plan, existing);
  if (decisions.length !== conflicts.length || new Set(decisions.map(d => d.sourceId)).size !== decisions.length)
    throw new Error("The director did not resolve every asset identity conflict.");
  const assets = [...existing], aliases = new Map();
  for (const a of plan.assets) {
    let id = a.id;
    if (conflicts.some(c => c.id === a.id)) {
      const decision = decisions.find(d => d.sourceId === a.id);
      if (!decision) throw new Error("Missing asset identity decision.");
      if (decision.existingId !== null) {
        const target = existing.find(v => v.id === decision.existingId);
        if (!target || target.kind !== a.kind) throw new Error("The director selected an incompatible asset identity.");
        id = target.id;
      } else {
        let suffix = 1;
        do { id = `${a.id.slice(0,75)}-s${section + 1}-${suffix++}`; } while (assets.some(v => v.id === id) || plan.assets.some(v => v.id === id));
      }
    }
    aliases.set(a.id, id);
    if (!assets.some(v => v.id === id)) assets.push({ ...a, id });
  }
  const clips = plan.clips.map(c => ({
    ...c,
    assetIds: [...new Set(c.assetIds.map(id => aliases.get(id) || id))],
    ...(c.locationId ? {locationId: aliases.get(c.locationId) || c.locationId} : {}),
    ...(c.endLocationId ? {endLocationId: aliases.get(c.endLocationId) || c.endLocationId} : {}),
  }));
  if (clips.some(c => c.assetIds.some(id => !assets.some(a => a.id === id)))) throw new Error("A shot refers to an unknown asset.");
  return { assets, clips };
}
