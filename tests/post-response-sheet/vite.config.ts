import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Local synthetic fixture: no API requests are forwarded to a real backend.
export default defineConfig({optimizeDeps:{entries:['tests/post-response-sheet/index.html']},plugins:[react(),{name:'isolated-fixture-api',configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/'))return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,allowed:['response-sheet-fixture:public'],viewCount:0,counts:{},data:[]}));});}}],server:{host:'127.0.0.1',port:4187,strictPort:true}});
