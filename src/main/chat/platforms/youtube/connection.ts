import { Innertube, UniversalCache } from "youtubei.js";

let session: Promise<Innertube> | null = null;

export function innertube(): Promise<Innertube> {
  session ??= Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: false,
  });

  return session;
}
