import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrestaShopRow = {
  id_customer: number;
  firstname: string;
  lastname: string;
  email: string;
  newsletter: number;
  fecha_alta: string;
  total_pedidos: number;
  importe_total: number | string | null;
};

const customerQuery = `
  SELECT c.id_customer, c.firstname, c.lastname, c.email, c.newsletter,
         c.date_add AS fecha_alta, COUNT(DISTINCT o.id_order) AS total_pedidos,
         SUM(od.total_price_tax_incl) AS importe_total
  FROM ev_customer c
  LEFT JOIN ev_orders o ON c.id_customer = o.id_customer AND o.valid = 1
  LEFT JOIN ev_order_detail od ON o.id_order = od.id_order
  WHERE c.id_customer = ? AND c.active = 1 AND c.deleted = 0
  GROUP BY c.id_customer, c.firstname, c.lastname, c.email, c.newsletter, c.date_add
`;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

async function findInShopify(email: string) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") },
    body: JSON.stringify({ query: `query CustomerByEmail($query: String!) { customers(first: 1, query: $query) { nodes { id firstName lastName defaultEmailAddress { emailAddress } numberOfOrders createdAt } } }`, variables: { query: `email:${JSON.stringify(email)}` } }),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(`Shopify: ${body.errors?.[0]?.message ?? response.statusText}`);
  const customer = body.data.customers.nodes[0];
  return customer ? { found: true, id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.defaultEmailAddress?.emailAddress ?? null, orderCount: customer.numberOfOrders, createdAt: customer.createdAt } : { found: false };
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return Response.json({ error: "Indica un ID numérico de cliente." }, { status: 400 });

  try {
    const connection = await mysql.createConnection({ host: required("MYSQL_HOST"), port: Number(process.env.MYSQL_PORT ?? 3306), database: required("MYSQL_DATABASE"), user: required("MYSQL_USER"), password: required("MYSQL_PASSWORD"), ssl: process.env.MYSQL_SSL === "true" ? {} : undefined, connectTimeout: 10_000 });
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(customerQuery, [id]);
    await connection.end();
    const row = rows[0] as PrestaShopRow | undefined;
    if (!row) return Response.json({ error: "No existe un cliente activo con ese ID." }, { status: 404 });

    const shopify = await findInShopify(row.email);
    return Response.json({ prestashop: { id: row.id_customer, firstName: row.firstname, lastName: row.lastname, email: row.email, newsletter: Boolean(row.newsletter), createdAt: row.fecha_alta, orderCount: Number(row.total_pedidos), totalSpent: Number(row.importe_total ?? 0) }, shopify });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Customer lookup failed", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "No se pudo consultar el cliente. Revisa las credenciales y el acceso de red." }, { status: 500 });
  }
}
