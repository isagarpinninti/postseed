import { nodeIo } from "./io";
import { runStudio } from "./commands/studio";
import { run } from "./run";

const code = await run(process.argv.slice(2), nodeIo(), runStudio);
process.exit(code);
