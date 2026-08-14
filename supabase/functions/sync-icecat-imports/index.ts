import { handleWorkerRequest } from "../sync-catalog-imports/index.ts";

if (import.meta.main) Deno.serve((request) => handleWorkerRequest(request, "icecat_import_jobs"));
