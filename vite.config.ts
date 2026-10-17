import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

/**
 * Serves api/drip.ts at /api/drip during `pnpm dev`, so posting works locally exactly as on
 * Vercel. Uses DRIP_PRIVATE_KEY, or falls back to ARKIV_PRIVATE_KEY from .env.
 */
function devDrip(): Plugin {
  return {
    name: "gawaah-dev-drip",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", process.cwd(), "")
      process.env.DRIP_PRIVATE_KEY ??= env.DRIP_PRIVATE_KEY || env.ARKIV_PRIVATE_KEY
      server.middlewares.use("/api/drip", async (req, res) => {
        const mod = await server.ssrLoadModule("/api/drip.ts")
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const request = new Request("http://localhost/api/drip", {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(req.method === "POST" && { body: Buffer.concat(chunks) }),
        })
        const handler = req.method === "OPTIONS" ? mod.OPTIONS : mod.POST
        const response: Response = await handler(request)
        res.statusCode = response.status
        response.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devDrip()],
  // Relative asset paths and hash routing let the build run from any host, a subfolder, an IPFS
  // gateway, or straight off disk — there is no server route to block.
  base: "./",
  build: { target: "es2022" },
})
