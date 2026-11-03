/** @param {import('mongoose').Connection} connection */
export async function seed(connection) {
  // Add repeatable development fixtures here, using upserts and stable IDs.
  // Never overwrite user-created records or read data from another service.
  await connection.db.command({ ping: 1 });
}
