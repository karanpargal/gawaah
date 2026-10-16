import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  // Relative asset paths and hash routing let the build run from any host, a subfolder, an IPFS
  // gateway, or straight off disk — there is no server route to block.
  base: "./",
  build: { target: "es2022" },
})
