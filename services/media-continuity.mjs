// Count decoded frames, then select the actual final frame (not an approximate
// seek near the end). Works with variable frame rates and clips without audio.
export async function extractLastFrame(exec, ffprobe, ffmpeg, source, output) {
  const info = JSON.parse(await exec(ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "json", source]));
  const frames = Number(info.streams?.[0]?.nb_read_frames);
  if (!Number.isSafeInteger(frames) || frames < 1) throw new Error("The preceding clip has no readable final frame.");
  await exec(ffmpeg, ["-y", "-i", source, "-vf", `select=eq(n\\,${frames - 1})`, "-vsync", "0", "-frames:v", "1", output]);
}
