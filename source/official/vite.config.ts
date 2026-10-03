import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig(({command,mode})=>{
 const env=loadEnv(mode,process.cwd(),"VITE_");
 const requested=env.VITE_SITE_BASE?.trim()||"/official/";
 const parts=requested.split("/").filter(Boolean);
 if(parts.some(part=>!/^[A-Za-z0-9_-]+$/.test(part)))throw new Error("VITE_SITE_BASE 必须是站内路径，例如 /official/。");
 return {base:parts.length?`/${parts.join("/")}/`:"/",plugins:[react(command==="serve"?{babel:{plugins:["react-dev-locator"]}}:{}),tsconfigPaths()],build:{sourcemap:false}};
});
