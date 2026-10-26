import pinoHttpModule from 'pino-http';
import type { HttpLogger, Options } from 'pino-http';

/**
 * pino-http@11's `index.d.ts` uses ESM `export default PinoHttp;` syntax, but the
 * package itself is CommonJS with no `package.json#exports` map. Under
 * `moduleResolution: NodeNext`, TypeScript resolves a default import of that
 * module to the whole CJS namespace type (which has no call signature) rather
 * than to the callable factory the runtime actually exports. This is a
 * type-declaration bug in the dependency, not a runtime issue - `pinoHttpModule`
 * IS callable at runtime. Isolate the one necessary cast here.
 */
type PinoHttpFactory = (opts?: Options) => HttpLogger;

export const pinoHttp: PinoHttpFactory = pinoHttpModule as unknown as PinoHttpFactory;
