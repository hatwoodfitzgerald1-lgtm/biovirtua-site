import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Webflow Cloud runs Astro on a Cloudflare-based edge. Server output + the
// Cloudflare adapter, with a server-rendered catch-all, so subpages never hit
// the trailing-slash redirect loop that plain static /public pages cause.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
});
