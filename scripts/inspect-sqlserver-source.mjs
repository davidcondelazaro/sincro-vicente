import sql from "mssql";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return value;
};

const pool = await sql.connect({
  server: required("SQL_SERVER_HOST"), port: Number(process.env.SQL_SERVER_PORT ?? 1433),
  database: required("SQL_SERVER_DATABASE"), user: required("SQL_SERVER_USER"), password: required("SQL_SERVER_PASSWORD"),
  options: { encrypt: process.env.SQL_SERVER_ENCRYPT === "true", trustServerCertificate: process.env.SQL_SERVER_TRUST_SERVER_CERTIFICATE === "true" },
  connectionTimeout: 15_000, requestTimeout: 30_000,
});
try {
  const result = await pool.request().query(`
    SELECT s.name AS schema_name, t.name AS table_name, SUM(p.rows) AS row_count
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    GROUP BY s.name, t.name
    ORDER BY s.name, t.name;
  `);
  console.table(result.recordset);
} finally {
  await pool.close();
}
