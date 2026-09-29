import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = new Set(['index.html','style.css','src/app.js','src/domain.js','src/youtube.js']);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
createServer(async (request,response)=>{
  const pathname = new URL(request.url,'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.has(file)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(path.join(root,file));
    response.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});
    response.end(body);
  } catch { response.writeHead(500); response.end('Unable to read file'); }
}).listen(4173,'127.0.0.1',()=>console.log('MyTube: http://localhost:4173'));
