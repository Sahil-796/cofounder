export * from "./types";
export * from "./rest";
export * from "./ws";
export * from "./sessions";
export * from "./auth";

import { hermesWs } from "./ws";
import { hermesRest } from "./rest";
import { HermesSessions } from "./sessions";

/** App-wide singletons. All Hermes access flows through these. */
export const sessions = new HermesSessions(hermesWs);
export { hermesWs, hermesRest };
