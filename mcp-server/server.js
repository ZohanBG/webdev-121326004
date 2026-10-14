const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

const lectures = JSON.parse(fs.readFileSync(path.join(__dirname, 'lectures.json'), 'utf8'));

const SERVER_INFO = { name: 'lectures', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-11-25';

const tools = [
  {
    name: 'find_lecture',
    description:
      'Return the title and topics of one course lecture, looked up by its number (1 to 10). ' +
      'Use it when the user asks what a specific lecture covers. Returns one line of text.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'integer', minimum: 1, maximum: 10, description: 'Lecture number, 1 to 10' } },
      required: ['number'],
    },
  },
  {
    name: 'search_lectures',
    description:
      'Search all course lectures for a keyword (case-insensitive) in their titles and topics. ' +
      'Use it when the user asks WHICH lecture covers a subject, e.g. "where do we talk about CSRF?". ' +
      'Returns one line per matching lecture, or a message that nothing matched.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, description: 'Word or phrase to look for, e.g. "REST"' } },
      required: ['query'],
    },
  },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (id, body, isError = false) => ok(id, { content: [{ type: 'text', text: body }], isError });
const describe = (l) => `Lecture ${l.number}: ${l.title}. Topics: ${l.topics}`;

const handlers = {
  find_lecture(id, args) {
    if (!Number.isInteger(args.number)) {
      return text(id, `"number" must be a whole number from 1 to 10, got ${JSON.stringify(args.number)}.`, true);
    }
    const lecture = lectures.find((l) => l.number === args.number);
    if (!lecture) {
      return text(id, `There is no lecture ${args.number}. The course has lectures 1 to ${lectures.length}.`, true);
    }
    return text(id, describe(lecture));
  },

  search_lectures(id, args) {
    if (typeof args.query !== 'string' || args.query.trim() === '') {
      return text(id, '"query" must be a non-empty string, e.g. "REST".', true);
    }
    const q = args.query.trim().toLowerCase();
    const hits = lectures.filter((l) => `${l.title} ${l.topics}`.toLowerCase().includes(q));
    if (hits.length === 0) {
      return text(id, `No lecture mentions "${args.query}". Try a broader word, or call find_lecture with a number.`);
    }
    return text(id, hits.map(describe).join('\n'));
  },
};

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return ok(msg.id, { tools });

    case 'tools/call': {
      const name = msg.params?.name;
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
      if (!handler) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      return handler(msg.id, msg.params?.arguments ?? {});
    }

    case 'ping':
      return ok(msg.id, {});

    default:
      return msg.id !== undefined ? fail(msg.id, -32601, `Unknown method: ${msg.method}`) : null;
  }
}

function send(reply) {
  process.stdout.write(JSON.stringify(reply) + '\n');
}

const lines = readline.createInterface({ input: process.stdin });

lines.on('line', (line) => {
  if (!line.trim()) return;
  console.error('got: ' + line);

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send(fail(null, -32700, 'Parse error'));
  }

  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return send(fail(msg?.id ?? null, -32600, 'Invalid request'));
  }

  try {
    const reply = handle(msg);
    if (reply) send(reply);
  } catch (err) {
    console.error(err);
    if (msg.id !== undefined) send(fail(msg.id, -32603, 'Internal error'));
  }
});
