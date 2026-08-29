import { Innertube, Parser, UniversalCache } from "youtubei.js";

let session: Promise<Innertube> | null = null;

const reported = new Set<string>();

function ownParserErrors(): void {
  Parser.setParserErrorHandler(({ classname, error_type }) => {
    const fault = `${error_type} on ${classname}`;
    if (reported.has(fault)) return;

    reported.add(fault);
    console.warn(`[youtube] parser ${fault}`);
  });
}

export function innertube(): Promise<Innertube> {
  if (session) return session;

  ownParserErrors();

  session = Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: false,
  });

  return session;
}
