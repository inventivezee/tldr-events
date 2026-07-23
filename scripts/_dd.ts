import "./_env";
import { sqlClient } from "../src/db/client";
import { runDedup } from "../src/dedup/canonicalize";
(async()=>{ console.log(JSON.stringify(await runDedup())); await sqlClient().end(); })().catch(e=>{console.error(e);process.exit(1)});
