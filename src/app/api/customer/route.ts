import { timingSafeEqual } from "node:crypto";
import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrestaShopRow = {
  id_customer: number;
  firstname: string;
  lastname: string;
  email: string;
  newsletter: number;
  note: string | null;
  fecha_alta: string;
  total_pedidos: number;
  importe_total: number | string | null;
};

type AddressRow = {
  firstname: string | null;
  lastname: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postcode: string | null;
  phone: string | null;
  dni: string | null;
  company: string | null;
  vat_number: string | null;
  province_name: string | null;
  country_code: string | null;
};

const customerQuery = `
  SELECT c.id_customer, c.firstname, c.lastname, c.email, c.newsletter, c.note,
         c.date_add AS fecha_alta, COUNT(DISTINCT o.id_order) AS total_pedidos,
         SUM(od.total_price_tax_incl) AS importe_total
  FROM ev_customer c
  LEFT JOIN ev_orders o ON c.id_customer = o.id_customer AND o.valid = 1
  LEFT JOIN ev_order_detail od ON o.id_order = od.id_order
  WHERE c.id_customer = ? AND c.active = 1 AND c.deleted = 0
  GROUP BY c.id_customer, c.firstname, c.lastname, c.email, c.newsletter, c.note, c.date_add
`;

const addressQuery = `
  SELECT a.firstname, a.lastname, a.address1, a.address2, a.city, a.postcode, a.phone,
         a.dni, a.company, a.vat_number, s.name AS province_name, co.iso_code AS country_code
  FROM ev_address a
  LEFT JOIN ev_state s ON a.id_state = s.id_state
  LEFT JOIN ev_country co ON a.id_country = co.id_country
  WHERE a.id_customer = ? AND a.active = 1 AND a.deleted = 0
`;

const provinceMapping: Record<string, string> = {
  Baleares: "Islas Baleares", Girona: "Gerona", "A Coruña": "La Coruña", Lleida: "Lérida",
};

const countryPhonePrefixes: Record<string, string> = {
  PT: "+351", ES: "+34", FR: "+33", IT: "+39", DE: "+49", GB: "+44", UK: "+44",
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function shopifyUrl() {
  return `https://${required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-07/graphql.json`;
}

async function shopifyRequest<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(shopifyUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") },
    body: JSON.stringify({ query, variables }), cache: "no-store",
  });
  const body = await response.json() as T & { errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) throw new Error(`Shopify: ${body.errors?.[0]?.message ?? response.statusText}`);
  return body;
}

async function findInShopify(email: string) {
  const body = await shopifyRequest<{ data: { customers: { nodes: Array<{ id: string; firstName: string | null; lastName: string | null; defaultEmailAddress: { emailAddress: string } | null; numberOfOrders: number; createdAt: string }> } } }>(
    `query CustomerByEmail($query: String!) { customers(first: 1, query: $query) { nodes { id firstName lastName defaultEmailAddress { emailAddress } numberOfOrders createdAt } } }`,
    { query: `email:${JSON.stringify(email)}` },
  );
  const customer = body.data.customers.nodes[0];
  return customer ? { found: true, id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.defaultEmailAddress?.emailAddress ?? null, orderCount: customer.numberOfOrders, createdAt: customer.createdAt } : { found: false };
}

function normalizePhone(phone: string | null) {
  if (!phone?.trim()) return null;
  let normalized = [...phone.trim()].filter((character, index) => /\d/.test(character) || (character === "+" && index === 0)).join("");
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  const digits = normalized.replace(/^\+/, "");
  if (digits.length < 6) return null;
  if (digits.length > 15) normalized = `${normalized.startsWith("+") ? "+" : ""}${digits.slice(0, 9)}`;
  return normalized;
}

function formatCompany(address: AddressRow) {
  return [address.dni, address.company].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()).join(" ") || undefined;
}

function toShopifyAddresses(addresses: AddressRow[]) {
  const portuguese = addresses.filter((address) => address.country_code === "PT");
  const chosen = portuguese.length ? portuguese : addresses;
  let customerPhone: string | undefined;
  const mapped = chosen.map((address) => {
    const countryCode = address.country_code || "ES";
    const rawPhone = normalizePhone(address.phone);
    const phone = rawPhone && !rawPhone.startsWith("+") ? `${countryPhonePrefixes[countryCode] ?? ""}${rawPhone}` : rawPhone;
    customerPhone ??= phone ?? undefined;
    return {
      address1: address.address1 ?? "", address2: address.address2 || undefined,
      city: address.city ?? "", province: provinceMapping[address.province_name ?? ""] ?? address.province_name ?? "",
      zip: address.postcode ?? "", countryCode, firstName: address.firstname ?? "", lastName: address.lastname ?? "",
      phone: phone ?? customerPhone, company: formatCompany(address),
    };
  });
  return { addresses: mapped, customerPhone };
}

function historicalValue(customer: PrestaShopRow) {
  const date = customer.fecha_alta ? new Date(customer.fecha_alta).toLocaleDateString("es-ES") : "N/A";
  const amount = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(customer.importe_total ?? 0));
  return `Pedidos: ${Number(customer.total_pedidos ?? 0)}, Importe: ${amount}, Fecha de alta: ${date}`;
}

async function loadCustomer(customerId: string) {
  const connection = await mysql.createConnection({
    host: required("MYSQL_HOST"), port: Number(process.env.MYSQL_PORT ?? 3306), database: required("MYSQL_DATABASE"), user: required("MYSQL_USER"), password: required("MYSQL_PASSWORD"), ssl: process.env.MYSQL_SSL === "true" ? {} : undefined, connectTimeout: 10_000,
  });
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(customerQuery, [customerId]);
    const customer = rows[0] as PrestaShopRow | undefined;
    if (!customer) return null;
    const [addressRows] = await connection.execute<mysql.RowDataPacket[]>(addressQuery, [customerId]);
    return { customer, addresses: addressRows as AddressRow[] };
  } finally {
    await connection.end();
  }
}

function publicCustomer(customer: PrestaShopRow) {
  return { id: customer.id_customer, firstName: customer.firstname, lastName: customer.lastname, email: customer.email, newsletter: Boolean(customer.newsletter), createdAt: customer.fecha_alta, orderCount: Number(customer.total_pedidos), totalSpent: Number(customer.importe_total ?? 0) };
}

function authorized(secret: unknown) {
  if (typeof secret !== "string") return false;
  const expected = Buffer.from(required("SYNC_WRITE_SECRET"));
  const received = Buffer.from(secret);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return Response.json({ error: "Indica un ID numérico de cliente." }, { status: 400 });
  try {
    const loaded = await loadCustomer(id);
    if (!loaded) return Response.json({ error: "No existe un cliente activo con ese ID." }, { status: 404 });
    return Response.json({ prestashop: publicCustomer(loaded.customer), shopify: await findInShopify(loaded.customer.email) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Customer lookup failed", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "No se pudo consultar el cliente. Revisa las credenciales y el acceso de red." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { id, secret } = await request.json() as { id?: string; secret?: string };
    if (!id || !/^\d+$/.test(id)) return Response.json({ error: "Indica un ID numérico de cliente." }, { status: 400 });
    if (!authorized(secret)) return Response.json({ error: "Clave de escritura incorrecta." }, { status: 401 });
    if (id !== required("SYNC_ALLOWED_CUSTOMER_ID")) return Response.json({ error: "La escritura está limitada al cliente autorizado para esta prueba." }, { status: 403 });

    const loaded = await loadCustomer(id);
    if (!loaded) return Response.json({ error: "No existe un cliente activo con ese ID." }, { status: 404 });
    if ((await findInShopify(loaded.customer.email)).found) return Response.json({ error: "El cliente ya existe en Shopify; no se ha creado ningún duplicado." }, { status: 409 });

    const { addresses, customerPhone } = toShopifyAddresses(loaded.addresses);
    const input: Record<string, unknown> = {
      firstName: loaded.customer.firstname, lastName: loaded.customer.lastname, email: loaded.customer.email,
      emailMarketingConsent: { marketingState: loaded.customer.newsletter ? "SUBSCRIBED" : "NOT_SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" },
    };
    if (addresses.length) input.addresses = addresses;
    if (customerPhone) input.phone = customerPhone;
    if (loaded.customer.note?.trim()) input.note = loaded.customer.note.trim();

    const created = await shopifyRequest<{ data: { customerCreate: { customer: { id: string; firstName: string; lastName: string; email: string } | null; userErrors: { field: string[] | null; message: string }[] } } }>(
      `mutation CustomerCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { id firstName lastName email } userErrors { field message } } }`, { input },
    );
    const result = created.data.customerCreate;
    if (result.userErrors.length || !result.customer) return Response.json({ error: result.userErrors.map((item) => item.message).join(" ") || "Shopify no creó el cliente." }, { status: 422 });

    const vat = loaded.addresses.map((address) => address.vat_number?.trim().toUpperCase()).find((value) => value && !value.startsWith("ES"));
    const metafields = [{ ownerId: result.customer.id, namespace: "custom", key: "historico_de_prestashop", type: "single_line_text_field", value: historicalValue(loaded.customer) }];
    if (vat) metafields.push({ ownerId: result.customer.id, namespace: "custom", key: "vat_number", type: "single_line_text_field", value: vat });
    const metafieldResult = await shopifyRequest<{ data: { metafieldsSet: { userErrors: { message: string }[] } } }>(
      `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { userErrors { message } } }`, { metafields },
    );
    const metafieldErrors = metafieldResult.data.metafieldsSet.userErrors.map((item) => item.message);
    return Response.json({ customer: result.customer, addressesCreated: addresses.length, metafieldsCreated: metafields.length, warnings: metafieldErrors });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Customer create failed", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "No se pudo crear el cliente. Revisa los permisos de Shopify y la configuración." }, { status: 500 });
  }
}
