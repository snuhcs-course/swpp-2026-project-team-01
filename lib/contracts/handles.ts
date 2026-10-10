import {z} from 'zod';
// Keep aligned with fmat.valid_public_handle. Protocol and application routes
// must never become published host handles, including through legacy setup.
const reserved=new Set(['host','requests','api','operator','auth','skills','app','booking','connections','connect','_next','favicon','robots','sitemap','mcp','oauth']);
export const publicHandle=z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u).refine(value=>!reserved.has(value),'This booking name is reserved.');
