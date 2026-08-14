import { corsPreflight, withCors } from './lib/cors';
import type { Env } from './env';
import { handle01Dev } from './routes/01_dev';
import { handle02ParseForm } from './routes/02_parse-form';
import { handle03Validate } from './routes/03_validate';
import { handleRoot } from './routes/root';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // OPTIONS works for every path (not only /wf/*).
    if (request.method === 'OPTIONS') {
      return corsPreflight();
    }

    let response: Response;

    if (request.method === 'GET' && pathname === '/') {
      response = await handleRoot(request);
    } else if (request.method === 'POST' && pathname === '/wf/01_dev') {
      response = await handle01Dev(request);
    } else if (request.method === 'POST' && pathname === '/wf/02_parse-form') {
      response = await handle02ParseForm(request);
    } else if (request.method === 'POST' && pathname === '/wf/03_validate') {
      response = await handle03Validate(request, env);
    } else {
      response = new Response('Not found', { status: 404 });
    }

    return withCors(response);
  },
} satisfies ExportedHandler<Env>;
