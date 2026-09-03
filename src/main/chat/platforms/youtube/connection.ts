import { Innertube, Parser, UniversalCache } from "youtubei.js";
import { log } from "../../../log";

let session: Promise<Innertube> | null = null;

const reported = new Set<string>();

function ownParserErrors(): void {
  Parser.setParserErrorHandler(({ classname, error_type }) => {
    const fault = `${error_type} on ${classname}`;
    if (reported.has(fault)) return;

    reported.add(fault);
    log("youtube").warn(`parser ${fault}`);
  });
}

/** The session is cached, but a *rejected* one must not be: a single failure while
    creating it — no network at launch is the ordinary case — otherwise poisoned every
    later poll with the same stale error, and YouTube stayed dead for the life of the
    process while the other two platforms reconnected on their own. */
export function innertube(): Promise<Innertube> {
  if (session) return session;

  ownParserErrors();

  const creating = Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: false,
  }).catch((error: unknown) => {
    if (session === creating) session = null;
    throw error;
  });

  session = creating;

  return creating;
}
