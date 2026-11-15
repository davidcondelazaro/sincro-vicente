import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync("/Users/dconde/Desarrollo/importacion-vicente/sincro-vicente/.env.local","utf8").split("\n").filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,"")]}));
const domain = env.SHOPIFY_STORE_URL.replace(/^https?:\/\//,"").replace(/\/.*$/,"");
export const gql = async (query, variables) => { const j = await (await fetch(`https://${domain}/admin/api/2025-10/graphql.json`, { method:"POST", headers:{ "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN, "Content-Type":"application/json" }, body: JSON.stringify({ query, variables }) })).json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data; };
